"""RedisSessionLock — Core 入站分区用分布式 session 锁（同构问题①）。

替代 inbound_worker 进程内 ``asyncio.Lock``：把同一 session 的并发处理串行化从
「单进程内存」提升为「Redis 分布式契约」，使多 Core 下跨进程的同一会话处理严格
串行，且 Core 崩溃后锁随 TTL 自然释放、无死锁。

实现（不引入外部锁库，手写 ``SET key value NX PX ttl`` + fencing token + 看门狗续期，
与 BotOwnership / CoreOwnership 同构）：

- ``acquire(session_id)``：``SET aip:session:{sid}:lock NX PX(ttl) value={coreId}:{uuid}``
  （fencing token 含 coreId 便于观测）。失败则 sleep 重试，仍失败则放弃（消息保持未
  ACK，交由 XAUTOCLAIM 重投），不阻塞其他 session 处理。
- 持锁期间看门狗每 ``extend_s`` 续期 PX，仅当仍持有（GET==value）才续；续租失败（易主）
  停止续期，锁自然过期。
- 退出时仅当 value 仍为自己才 DEL（fencing），避免误删接管者的锁。

@module cluster/session_lock
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Any

import asyncio
import uuid

import redis.asyncio as aioredis

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("cluster.session_lock")

_PREFIX = get_settings().REDIS_KEY_PREFIX


def _rk(name: str) -> str:
    """为 agent Redis 键统一添加命名空间前缀。"""
    return f"{_PREFIX}{name}"


def session_lock_key(session_id: str) -> str:
    """``aip:session:{sessionId}:lock`` — 分布式 session 锁。"""
    return _rk(f"session:{session_id}:lock")


# 续租 Lua：仅当仍为本持有者时刷新 TTL，否则返回 0（已易主）。
_RENEW_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
end
return 0
"""

# 释放 Lua：仅当仍为本持有者时 DEL，避免误删接管者的锁（fencing）。
_RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


@dataclass
class LockAcquireResult:
    """``acquire`` 上下文产出：``locked=False`` 表示争锁失败，调用方应放弃（不 ACK）。"""

    locked: bool


class RedisSessionLock:
    """基于 Redis 的分布式 session 锁（fencing token + 看门狗续期）。"""

    def __init__(
        self,
        redis: aioredis.Redis,
        *,
        lock_ttl_s: int = 30,
        extend_s: int = 10,
        retry: int = 5,
        retry_wait_s: float = 0.2,
        core_id: str = "?",
    ) -> None:
        """初始化分布式 session 锁。

        Args:
            redis: 已连接的 ``redis.asyncio.Redis`` 实例。
            lock_ttl_s: 锁 TTL（秒），默认 30（处理窗口，带看门狗续期）。
            extend_s: 看门狗续期间隔（秒），默认 10。
            retry: 争锁失败重试次数，默认 5。
            retry_wait_s: 每次重试间隔（秒），默认 0.2。
            core_id: 本 Core 稳定 ID（写入 fencing token 便于观测）。
        """
        self._redis = redis
        self._lock_ttl_ms = max(1, lock_ttl_s) * 1000
        self._extend_s = max(1, extend_s)
        self._retry = max(0, retry)
        self._retry_wait_s = max(0.0, retry_wait_s)
        self._core_id = core_id

    @asynccontextmanager
    async def acquire(self, session_id: str) -> AsyncIterator[LockAcquireResult]:
        """争用指定 session 的分布式锁。

        争锁失败（达到重试上限）时产出 ``LockAcquireResult(locked=False)``，调用方应
        直接返回、不 ACK，让消息留在 PEL 由 XAUTOCLAIM 重投（不丢不重）。争锁成功时产出
        ``locked=True``，并启动看门狗续期；退出时仅当仍持有才释放。

        Args:
            session_id: 会话 ID。

        Yields:
            ``LockAcquireResult``：是否成功持有锁。
        """
        token = f"{self._core_id}:{uuid.uuid4().hex}"
        key = session_lock_key(session_id)
        acquired = False
        for _ in range(self._retry + 1):
            ok: Any = await self._redis.set(key, token, nx=True, px=self._lock_ttl_ms)
            if ok:
                acquired = True
                break
            await asyncio.sleep(self._retry_wait_s)

        if not acquired:
            logger.debug(
                "Session lock acquire failed after retries; giving up (will be reclaimed)",
                session_id=session_id,
                core_id=self._core_id,
            )
            yield LockAcquireResult(False)
            return

        stop = asyncio.Event()
        watchdog: asyncio.Task[None] = asyncio.create_task(
            self._extend_loop(key, token, stop)
        )
        try:
            yield LockAcquireResult(True)
        finally:
            stop.set()
            watchdog.cancel()
            try:
                await watchdog
            except asyncio.CancelledError:
                pass
            await self._release_if_owner(key, token)

    async def _extend_loop(self, key: str, token: str, stop: asyncio.Event) -> None:
        """看门狗：每 ``extend_s`` 续期一次；续租失败（易主）即停止续期。"""
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=self._extend_s)
            except asyncio.TimeoutError:
                pass
            if stop.is_set():
                break
            try:
                ok: Any = await self._redis.eval(
                    _RENEW_SCRIPT, 1, key, token, self._lock_ttl_ms
                )
            except Exception as exc:  # noqa: BLE001 - 续期失败不应抛断主流程
                logger.warning(
                    "Session lock renew failed", key=key, error=str(exc)
                )
                break
            if not ok:
                # 锁已易主：停止续期，交由新持有者处理（本处理继续跑完当前循环体）。
                logger.info(
                    "Session lock lost during processing (fencing); stopping watchdog",
                    key=key,
                    core_id=self._core_id,
                )
                break

    async def _release_if_owner(self, key: str, token: str) -> None:
        """仅当锁仍为自己持有时释放（fencing，避免误删接管者锁）。"""
        try:
            await self._redis.eval(_RELEASE_SCRIPT, 1, key, token)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Session lock release failed", key=key, error=str(exc))
