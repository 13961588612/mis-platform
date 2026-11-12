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

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from typing import Any

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
_shared_redis: aioredis.Redis | None = None
_shared_lock: "RedisSessionLock | None" = None
_shared_loop: asyncio.AbstractEventLoop | None = None


async def get_shared_redis_session_lock() -> "RedisSessionLock":
    """Return a process-wide Redis lock for non-inbound API paths."""
    global _shared_redis, _shared_lock, _shared_loop
    loop = asyncio.get_running_loop()
    if _shared_lock is not None and _shared_loop is loop and not loop.is_closed():
        return _shared_lock
    if _shared_redis is not None:
        with suppress(Exception):
            await _shared_redis.aclose()
        _shared_redis = None
        _shared_lock = None

    settings = get_settings()
    _shared_redis = aioredis.from_url(
        settings.redis_url,
        max_connections=settings.REDIS_MAX_CONNECTIONS,
        decode_responses=True,
        socket_connect_timeout=5,
    )
    _shared_lock = RedisSessionLock(
        _shared_redis,
        lock_ttl_s=settings.SESSION_LOCK_TTL_S,
        extend_s=settings.SESSION_LOCK_EXTEND_S,
        max_hold_s=settings.SESSION_LOCK_MAX_HOLD_S,
        core_id="http",
    )
    return _shared_lock

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
        retry: int = 8,
        retry_wait_s: float = 0.3,
        retry_max_wait_s: float = 4.0,
        max_hold_s: int = 30,
        core_id: str = "?",
    ) -> None:
        """初始化分布式 session 锁。

        Args:
            redis: 已连接的 ``redis.asyncio.Redis`` 实例。
            lock_ttl_s: 锁 TTL（秒），默认 30（处理窗口，带看门狗续期）。
            extend_s: 看门狗续期间隔（秒），默认 10。
            retry: 争锁失败重试次数，默认 8。
            retry_wait_s: 首次重试退避基数（秒），默认 0.3；后续按指数增长。
            retry_max_wait_s: 单次重试退避上限（秒），默认 4.0（防止退避失控）。
            max_hold_s: 锁持有上限（秒），默认 30。看门狗续期**累计不超过此窗口**：
                到时即停止续期，锁随 TTL 自然过期。用于兜底「持有方卡死 / 崩溃 /
                长耗时 LLM 调用不返回」导致锁永不释放、后续请求无限等待（如 120s
                超时）的极端场景——锁最终一定能在 ``max_hold_s + lock_ttl_s`` 内释放，
                使 XAUTOCLAIM 重投或后续请求在合理时间内拿到锁，而非无限阻塞。
            core_id: 本 Core 稳定 ID（写入 fencing token 便于观测）。
        """
        self._redis = redis
        self._lock_ttl_ms = max(1, lock_ttl_s) * 1000
        self._extend_s = max(1, extend_s)
        self._retry = max(0, retry)
        self._retry_wait_s = max(0.01, retry_wait_s)
        self._retry_max_wait_s = max(self._retry_wait_s, retry_max_wait_s)
        # 持有上限至少覆盖一个 TTL，避免正常多轮 LLM 跑刚起就被强制过期。
        self._max_hold_s = max(max_hold_s, lock_ttl_s)
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
        backoff = self._retry_wait_s
        for attempt in range(self._retry + 1):
            ok: Any = await self._redis.set(key, token, nx=True, px=self._lock_ttl_ms)
            if ok:
                acquired = True
                break
            # 指数退避：让重试总窗口覆盖锁 TTL（默认 30s），使锁一旦过期（TTL 到期）
            # 本 Core 能在下一轮立即抢到，无需退回分钟级 XAUTOCLAIM 重投。
            # 退避上限 retry_max_wait_s 防止单轮等待过长。
            if attempt < self._retry:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, self._retry_max_wait_s)

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
            self._extend_loop(key, token, stop, max_hold_s=self._max_hold_s)
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

    async def _extend_loop(
        self, key: str, token: str, stop: asyncio.Event, *, max_hold_s: int
    ) -> None:
        """看门狗：每 ``extend_s`` 续期一次；续租失败（易主）或达到持有上限即停止。

        Args:
            key: 锁键。
            token: 本持有者 fencing token。
            stop: 退出信号（持有方 ``acquire`` 体结束后置位）。
            max_hold_s: 累计持有上限（秒）；超出后**主动停止续期**，让锁随 TTL 自然
                过期，避免卡死的持有方无限续期、阻塞同 session 后续请求。
        """
        import time

        start: float = time.monotonic()
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=self._extend_s)
            except asyncio.TimeoutError:
                pass
            if stop.is_set():
                break
            # 持有上限兜底：超过窗口则停止续期，锁将在下一个 TTL 到期后自动释放。
            if time.monotonic() - start >= max_hold_s:
                logger.warning(
                    "Session lock exceeded max hold window; stopping watchdog "
                    "(lock will expire by TTL)",
                    key=key,
                    core_id=self._core_id,
                    max_hold_s=max_hold_s,
                )
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
