"""CoreOwnership — Agent 运行时租约选主（同构 bot 租约 / 决策 1）。

与 Gateway 侧 ``BotOwnership`` 同构：每个 Agent 的运行时全局同一时刻只能由一个
Agent Core 实例持有（一 agent 一 owner，避免双活）。用 Redis 租约
（``SET key value NX PX ttl`` + 心跳续租手写，无外部锁库）把
``agent → owner core`` 提升为分布式契约：

- ``get_core_id()``：env ``CORE_ID`` → ``os.hostname()`` → 告警随机（重启不变优先）。
- ``CoreOwnership.claim/renew/release/current_owner/prev_owner``：租约抢注 / 续租 /
  释放 / 读当前与上一任 owner。
- ``start_heartbeat``：周期续租持有中的 agent 租约 + 写 core 存活集合；
  续租失败（已易主）触发 ``on_lost`` 回调（上层据此停本地 agent 运行时）。

下游入站 worker 按 ``aip:agent:{agentId}:owner`` 把非本 core 拥有的 agent 首条消息
重投到 owning core（交给真正持有运行时的 core 处理，同构问题①路由）。

@module cluster/core_ownership
"""

from __future__ import annotations

from typing import Any, Callable

import asyncio
import os
import socket
import uuid

import redis.asyncio as aioredis

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("cluster.core_ownership")

# agent Redis 键统一命名空间前缀（与 Gateway TS 端 `cluster/ownership.ts` 的 `aip:` 一致）。
# 共享 Redis 实例下避免与 MIS(`mis:`)键冲突；db index 已做物理隔离。
_PREFIX = get_settings().REDIS_KEY_PREFIX


def _rk(name: str) -> str:
    """为 agent Redis 键统一添加命名空间前缀。"""
    return f"{_PREFIX}{name}"


# ---------------------------------------------------------------------------
# Redis 键（与共享知识约定一致，集中定义避免散落）
# ---------------------------------------------------------------------------


def agent_owner_key(agent_id: str) -> str:
    """``aip:agent:{agentId}:owner`` — agent 运行时租约（value = coreId）。"""
    return _rk(f"agent:{agent_id}:owner")


def agent_prev_owner_key(agent_id: str) -> str:
    """``aip:agent:{agentId}:prev_owner`` — 上一任 owner（接管 drain 用）。"""
    return _rk(f"agent:{agent_id}:prev_owner")


def agent_registry_key() -> str:
    """``aip:agent:registry`` — 全局 Agent 注册表 hash。"""
    return _rk("agent:registry")


def cores_members_key() -> str:
    """``aip:cores:members`` — 存活 coreId 心跳集合。"""
    return _rk("cores:members")


def core_alive_key(core_id: str) -> str:
    """``aip:core:{coreId}:alive`` — 单成员存活 TTL 键（members 集合无法给成员设 TTL）。"""
    return _rk(f"core:{core_id}:alive")


# ---------------------------------------------------------------------------
# 稳定 CoreId
# ---------------------------------------------------------------------------


def get_core_id() -> str:
    """解析稳定 CoreId。

    优先级：``CORE_ID`` 环境变量 → ``os.hostname()`` → 随机（告警）。
    稳定且重启不变（k8s StatefulSet Pod 名 ``core-1``）是故障转移 drain 可定向的前提；
    随机兜底仅用于本地无配置场景，并明确告警「非稳定 ID」。

    Returns:
        当前 Agent Core 的稳定实例 ID。
    """
    env = os.environ.get("CORE_ID")
    if env is not None and env.strip() != "":
        return env.strip()

    try:
        host = socket.gethostname()
        if host is not None and host.strip() != "":
            return host
    except OSError as exc:
        logger.warning("Failed to read hostname for CoreId", error=str(exc))

    random_id = f"core-{uuid.uuid4().hex[:8]}"
    logger.warning(
        "CORE_ID env not set and hostname unavailable; generated ephemeral id "
        "(NOT stable across restarts)",
        core_id=random_id,
    )
    return random_id


# ---------------------------------------------------------------------------
# Agent 运行时租约选主
# ---------------------------------------------------------------------------

# 抢注 / 续租 Lua：同主刷新 TTL、他主拒绝、无主 SET NX PX。
_CLAIM_SCRIPT = """
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
end
if cur and cur ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
return 1
"""

# 续租 Lua：仅当仍为本核心时刷新 TTL，否则返回 0（已易主）。
_RENEW_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
end
return 0
"""

# 释放 Lua：仅当仍为本核心时 DEL，避免误删他者。
_RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


class CoreOwnership:
    """基于 Redis 租约的 Agent 运行时所有权协调器（同构 BotOwnership）。

    并发安全：抢注走 Lua 脚本（``SET NX PX`` + 同主续租 + 他主拒绝），保证任一时刻
    全局最多一个 owner。``claim`` 成功即把 agentId 记入 ``_owned``，供心跳续租；
    心跳续租失败（已易主）触发 ``on_lost`` 回调。
    """

    def __init__(
        self,
        redis: aioredis.Redis,
        core_id: str,
        *,
        lease_ttl_s: int = 30,
        heartbeat_s: int = 10,
    ) -> None:
        """初始化 Core 租约协调器。

        Args:
            redis: 已连接的 ``redis.asyncio.Redis`` 实例。
            core_id: 本 Core 稳定 ID（``get_core_id()``）。
            lease_ttl_s: 租约 TTL（秒），默认 30。
            heartbeat_s: 心跳续租间隔（秒），默认 10。
        """
        self._redis = redis
        self._core_id = core_id
        self._lease_ttl_s = max(1, lease_ttl_s)
        self._lease_ttl_ms = self._lease_ttl_s * 1000
        self._heartbeat_s = max(1, heartbeat_s)
        self._owned: set[str] = set()
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._on_lost: Callable[[str], Any] | None = None

    async def claim(self, agent_id: str) -> bool:
        """抢注 / 续租 Agent 运行时租约。

        - key 不存在 → ``SET value=coreId NX PX ttl``，成为 owner（返回 True）。
        - key 已属本核心 → 刷新 TTL，仍是 owner（返回 True，覆盖重启同 ID 重认领）。
        - key 属其他存活核心 → 拒绝（返回 False，不抢活运行时）。

        Args:
            agent_id: 目标 Agent ID。

        Returns:
            是否成为/保持 owner。
        """
        result: Any = await self._redis.eval(
            _CLAIM_SCRIPT,
            1,
            agent_owner_key(agent_id),
            self._core_id,
            self._lease_ttl_ms,
        )
        owned = result == 1
        if owned:
            self._owned.add(agent_id)
        else:
            self._owned.discard(agent_id)
        return owned

    async def renew(self, agent_id: str) -> bool:
        """续租（仅 owner 调用；失败表示已易主）。

        Args:
            agent_id: 目标 Agent ID。

        Returns:
            续租是否成功（仍持有租约）。
        """
        result: Any = await self._redis.eval(
            _RENEW_SCRIPT,
            1,
            agent_owner_key(agent_id),
            self._core_id,
            self._lease_ttl_ms,
        )
        ok = result == 1
        if not ok:
            self._owned.discard(agent_id)
        return ok

    async def release(self, agent_id: str) -> None:
        """主动释放租约（优雅关闭）；仅当本核心仍是 owner 时才 DEL。

        Args:
            agent_id: 目标 Agent ID。
        """
        await self._redis.eval(
            _RELEASE_SCRIPT,
            1,
            agent_owner_key(agent_id),
            self._core_id,
        )
        self._owned.discard(agent_id)

    async def release_all(self) -> None:
        """释放本核心持有的全部租约（优雅关闭时批量调用）。"""
        for agent_id in list(self._owned):
            await self.release(agent_id)

    async def current_owner(self, agent_id: str) -> str | None:
        """读取当前 owner（入站路由读）。

        Args:
            agent_id: 目标 Agent ID。

        Returns:
            owner coreId 或 None（无人持有）。
        """
        return await self._redis.get(agent_owner_key(agent_id))

    async def prev_owner(self, agent_id: str) -> str | None:
        """读取上一任 owner（drain 旧 stream 用）。

        Args:
            agent_id: 目标 Agent ID。

        Returns:
            上一任 coreId 或 None。
        """
        return await self._redis.get(agent_prev_owner_key(agent_id))

    async def set_prev_owner(self, agent_id: str, core_id: str) -> None:
        """写入上一任 owner（本核心接管成功时记录）。

        Args:
            agent_id: 目标 Agent ID。
            core_id: 上一任 coreId。
        """
        await self._redis.set(agent_prev_owner_key(agent_id), core_id, ex=300)

    async def list_members(self) -> list[str]:
        """列出存活 coreId 集合（故障转移 drain 时定位历史 owner）。"""
        return list(await self._redis.smembers(cores_members_key()))

    def start_heartbeat(self, on_lost: Callable[[str], Any] | None = None) -> None:
        """启动心跳：周期续租持有中的 agent 租约 + 写 core 存活集合。

        续租失败（已易主）触发 ``on_lost`` 回调。

        Args:
            on_lost: 失主回调（可选，可后续通过 ``set_on_lost`` 设置）。
        """
        if on_lost is not None:
            self._on_lost = on_lost
        if self._task is not None:
            logger.warning("CoreOwnership heartbeat already running")
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._heartbeat_loop())
        logger.info("CoreOwnership heartbeat started", core_id=self._core_id)

    def set_on_lost(self, on_lost: Callable[[str], Any]) -> None:
        """设置 / 替换失主回调。"""
        self._on_lost = on_lost

    def stop_heartbeat(self) -> None:
        """停止心跳。"""
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            self._task = None
        logger.info("CoreOwnership heartbeat stopped", core_id=self._core_id)

    async def _heartbeat_loop(self) -> None:
        """心跳单轮：写存活集合 + 续租已持有 agent；失主触发回调。"""
        try:
            await self._redis.sadd(cores_members_key(), self._core_id)
            await self._redis.set(
                core_alive_key(self._core_id), "1", ex=max(1, self._lease_ttl_s)
            )
        except Exception as exc:  # noqa: BLE001 - 存活心跳失败不影响续租逻辑
            logger.warning("Core liveness heartbeat failed", error=str(exc))

        while not self._stop.is_set():
            await asyncio.sleep(self._heartbeat_s)
            if self._stop.is_set():
                break
            try:
                await self._redis.sadd(cores_members_key(), self._core_id)
                await self._redis.set(
                    core_alive_key(self._core_id), "1", ex=max(1, self._lease_ttl_s)
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Core liveness heartbeat failed", error=str(exc))

            for agent_id in list(self._owned):
                try:
                    ok = await self.renew(agent_id)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Agent lease renew failed", agent_id=agent_id, error=str(exc)
                    )
                    ok = False
                if not ok:
                    self._owned.discard(agent_id)
                    if self._on_lost is not None:
                        try:
                            await self._on_lost(agent_id)
                        except Exception as exc:  # noqa: BLE001
                            logger.error(
                                "on_lost callback threw",
                                agent_id=agent_id,
                                error=str(exc),
                            )
