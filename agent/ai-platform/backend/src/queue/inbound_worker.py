"""入站 Redis Stream 消费者 — 消费 Gateway 消息并回写 AgentEvent 流。

进程内有界并发：不同 session 可并行处理；同一 session 严格串行。
"""

from __future__ import annotations
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import asyncio
import json
import os
import time
import uuid

import redis.asyncio as aioredis
from redis.exceptions import TimeoutError as RedisTimeoutError

from src.agent.manager import AgentInstance, AgentManager, get_agent_manager
from src.agent.session import Message, Session, SessionManager, get_session_manager
from src.cluster.session_lock import LockAcquireResult, RedisSessionLock
from src.config import Settings, get_settings
from src.queue.redis_stream import (
    BLOCK_MS,
    CONSUMER_GROUP,
    DEFAULT_INBOUND_CHANNELS,
    InboundStreamMessage,
    MAX_STREAM_LENGTH,
    StreamKeys,
    StreamProducer,
    ensure_consumer_group,
    normalize_stream_fields,
    parse_inbound_fields,
)
from src.runtime.events import AgentEvent, AgentEventType
from src.skills.tools.formfill_execute import resume_formfill
from src.utils.exceptions import AgentNotFoundError, SessionNotFoundError
from src.utils.logging import get_logger

logger = get_logger("queue.inbound_worker")


class _RerouteToOwner(Exception):
    """首条消息归属的 agent 由其他 Core 持有（租约），需重投到 owning core 的 agent 流。

    抛出后由 ``_handle_message`` 捕获，XADD 到 ``stream:agent:{agent_id}`` 并 ACK
    原流，交由真正持有运行时的 Core 处理（同构问题①路由，决策 1）。
    """

    def __init__(self, agent_id: str) -> None:
        """记录需要重投的目标 agent ID。"""
        super().__init__(f"reroute to owning core: agent={agent_id}")
        self.agent_id = agent_id


_worker: InboundStreamWorker | None = None


async def _resolve_inbound_mis_user_id(
    inbound: InboundStreamMessage,
) -> int | None:
    """解析入站消息对应的 MIS userId（T03 S9 · 企微渠道档 2）。

    企微渠道的 ``user_id`` / ``channel_user_id`` 是企微 userid 字符串（F28），
    需查 ``users.mis_user_id`` 换取 MIS 权限主体。

    **fail-closed 契约**：未绑定 / DB 不可用 → 返回 ``None``（**不阻断消息处理**，
    但下游 E1–E5 会拒绝执行）。**绝不**把企微 userid 当 MIS userId 回退。

    Args:
        inbound: 入站流消息。

    Returns:
        MIS userId 或 ``None``。
    """
    from src.identity.mis_user_id import resolve_mis_user_id_async

    identity: dict[str, Any] = {
        "user_id": inbound.user_id or "",
        "channel_user_id": inbound.channel_user_id or "",
        "channel": inbound.channel or "",
    }
    try:
        from src.db.session import db_session_context

        async with db_session_context() as db:
            return await resolve_mis_user_id_async(identity, db=db)
    except Exception as exc:  # noqa: BLE001 - DB 不可用不得阻断入站消息处理
        logger.warning(
            "Inbound MIS userId lookup unavailable; downstream will fail-closed",
            session_id=inbound.session_id,
            error=str(exc),
        )
        return None


class InboundStreamWorker:
    """消费 stream:agent:{agentId} 与 stream:inbound:{channel}。"""

    def __init__(self) -> None:
        """初始化 Redis 连接占位、并发控制与 session 级串行锁。"""
        self._settings = get_settings()
        self._redis: aioredis.Redis | None = None
        self._producer: StreamProducer | None = None
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._stream_keys: list[str] = []
        self._consumer_name = f"agent-core-{os.getpid()}"
        self._max_concurrency = max(1, self._settings.INBOUND_MAX_CONCURRENCY)
        self._read_count = max(1, self._settings.INBOUND_READ_COUNT)
        self._semaphore = asyncio.Semaphore(self._max_concurrency)
        self._inflight: set[asyncio.Task[None]] = set()
        # T9 / 同构问题①：用 Redis 分布式 session 锁替代进程内 asyncio.Lock，
        # 多 Core 下跨进程同一会话严格串行；Core 崩溃后锁随 TTL 自然释放。
        self._session_lock: RedisSessionLock | None = None
        self._core_id: str = ""
        self._core_ownership: Any = None
        # T6 / N1：Core 侧崩溃重投循环配置（沿用 agent-core-group 拓扑 + Redis 分布式锁）。
        self._xclaim_interval_ms = max(1, self._settings.XCLAIM_INTERVAL_MS)
        self._xclaim_min_idle_ms = max(1, self._settings.XCLAIM_MIN_IDLE_MS)
        self._reclaim_task: asyncio.Task[None] | None = None

    async def _get_redis(self) -> aioredis.Redis:
        """懒创建 Redis 异步客户端；``socket_timeout`` 须大于 XREADGROUP 阻塞时长。

        Returns:
            已配置的 ``redis.asyncio.Redis`` 实例。
        """
        if self._redis is None:
            # socket_timeout 须大于 XREADGROUP block，否则空闲等待会被误判为读超时
            self._redis = aioredis.from_url(
                self._settings.redis_url,
                max_connections=self._settings.REDIS_MAX_CONNECTIONS,
                decode_responses=True,
                socket_timeout=(BLOCK_MS / 1000) + 10,
                socket_connect_timeout=5,
            )
        return self._redis

    def bind_core(
        self, core_id: str, core_ownership: Any, redis: aioredis.Redis
    ) -> None:
        """注入 Core 身份 + 租约协调器，启用 Redis 分布式 session 锁与 agent owner 路由（T9）。

        未注入时退化为单 Core 旧行为：进程内仅由 semaphore 限并发、全量订阅入站流、
        agent owner 路由跳过（向后兼容单 Core）。

        Args:
            core_id: 本 Core 稳定 ID（``get_core_id()``）。
            core_ownership: ``CoreOwnership`` 实例（读 ``aip:agent:{agentId}:owner``）。
            redis: 已连接的 ``redis.asyncio.Redis``（与 CoreOwnership 共享，写锁键）。
        """
        self._core_id = core_id
        self._core_ownership = core_ownership
        self._session_lock = RedisSessionLock(
            redis,
            lock_ttl_s=self._settings.SESSION_LOCK_TTL_S,
            extend_s=self._settings.SESSION_LOCK_EXTEND_S,
            core_id=core_id,
        )
        # 多 Core 下各实例消费名需唯一（同 group 内区分消费者），避免互相抢消息。
        self._consumer_name = f"agent-core-{os.getpid()}-{core_id}"
        logger.info("Inbound worker bound to core", core_id=core_id)

    @asynccontextmanager
    async def _acquire_session_lock(
        self, session_id: str
    ) -> AsyncIterator[LockAcquireResult]:
        """获取指定 session 的串行处理锁（多 Core 走 Redis 分布式锁）。

        单 Core 未绑定 Core 时退化为直接放行（由 semaphore 限并发，旧行为）。

        Args:
            session_id: 会话 ID。

        Yields:
            ``LockAcquireResult``：是否成功持有锁（``locked=False`` 时调用方应放弃）。
        """
        if self._session_lock is not None:
            async with self._session_lock.acquire(session_id) as result:
                yield result
        else:
            yield LockAcquireResult(True)

    async def _resolve_stream_keys(self, agent_ids: list[str]) -> list[str]:
        """拼接入站 stream 键名列表（多 Core 下只订阅本 core 拥有的 agent stream）。

        T9 / 同构问题①路由：绑定 Core 后，仅订阅 ``aip:stream:agent:{agentId}`` 中本
        core 持有租约的 agent，其余 agent 的入站消息由 owning core 消费；渠道入站流
        （``aip:stream:inbound:{channel}``）所有 Core 共享订阅，再由 agent owner 路由
        重投到 owning core。

        Args:
            agent_ids: 候选 Agent 实例 ID 列表。

        Returns:
            去重并排序后的 stream key 列表。
        """
        owned_agent_ids: list[str] = list(agent_ids)
        if self._core_ownership is not None:
            # 仅保留本 core 拥有的 agent（其余交给 owning core 消费），避免双活消费。
            owned_agent_ids = []
            for agent_id in agent_ids:
                try:
                    owner: str | None = await self._core_ownership.current_owner(agent_id)
                except Exception:
                    owner = None
                if owner == self._core_id:
                    owned_agent_ids.append(agent_id)

        keys: list[str] = []
        for agent_id in owned_agent_ids:
            keys.append(StreamKeys.agent_inbound(agent_id))
        for channel in DEFAULT_INBOUND_CHANNELS:
            keys.append(StreamKeys.channel_inbound(channel))
        return sorted(set(keys))

    async def start(self, agent_ids: list[str] | None = None) -> None:
        """创建消费者组、启动 XREADGROUP 消费循环。

        Args:
            agent_ids: 要订阅的 Agent ID；为 ``None`` 时使用当前已注册的全部 Agent。
        """
        if self._running:
            return

        manager: AgentManager = get_agent_manager()
        ids: Any = agent_ids or [inst.id for inst in manager.list_agents()]
        self._stream_keys = await self._resolve_stream_keys(ids)
        if not self._stream_keys:
            logger.warning("No inbound streams to consume; waiting for agent sync")
            self._stream_keys = [
                StreamKeys.channel_inbound("h5"),
            ]

        redis: aioredis.Redis = await self._get_redis()
        self._producer = StreamProducer(redis)

        for stream_key in self._stream_keys:
            await ensure_consumer_group(redis, stream_key)
        await ensure_consumer_group(redis, StreamKeys.agent_events())

        self._running = True
        self._task = asyncio.create_task(self._consume_loop(), name="inbound-stream-worker")
        self._reclaim_task = asyncio.create_task(self._reclaim_loop(), name="inbound-reclaim-loop")
        logger.info(
            "Inbound stream worker started",
            consumer=self._consumer_name,
            streams=self._stream_keys,
            max_concurrency=self._max_concurrency,
            read_count=self._read_count,
        )

    async def stop(self) -> None:
        """停止消费循环、取消在飞任务并关闭 Redis 连接。"""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        if self._reclaim_task is not None:
            self._reclaim_task.cancel()
            try:
                await self._reclaim_task
            except asyncio.CancelledError:
                pass
            self._reclaim_task = None

        inflight: list[Any] = list(self._inflight)
        for task in inflight:
            task.cancel()
        if inflight:
            await asyncio.gather(*inflight, return_exceptions=True)
        self._inflight.clear()

        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None
        logger.info("Inbound stream worker stopped")

    async def refresh_streams(self, agent_ids: list[str]) -> None:
        """Agent 同步后更新订阅的 stream 列表。"""
        new_keys: list[str] = await self._resolve_stream_keys(agent_ids)
        redis: aioredis.Redis = await self._get_redis()
        for stream_key in new_keys:
            if stream_key not in self._stream_keys:
                await ensure_consumer_group(redis, stream_key)
        self._stream_keys = new_keys
        logger.info("Inbound stream subscriptions updated", streams=self._stream_keys)

    def _spawn_handler(
        self,
        stream_key: str,
        message_id: str,
        inbound: InboundStreamMessage,
    ) -> None:
        """为单条入站消息创建异步处理任务并注册完成回调。

        Args:
            stream_key: Redis stream 键名。
            message_id: Redis 消息 ID。
            inbound: 解析后的入站消息体。
        """
        task: Any = asyncio.create_task(
            self._handle_message(stream_key, message_id, inbound),
            name=f"inbound-{inbound.session_id}-{message_id}",
        )
        self._inflight.add(task)

        def _on_done(done: asyncio.Task[None]) -> None:
            """任务结束时从在飞集合移除，并记录未捕获异常。"""
            self._inflight.discard(done)
            if done.cancelled():
                return
            exc: Any = done.exception()
            if exc is not None:
                logger.error(
                    "Inbound handler task failed",
                    session_id=inbound.session_id,
                    message_id=message_id,
                    error=str(exc),
                    exc_info=exc,
                )

        task.add_done_callback(_on_done)

    async def _consume_loop(self) -> None:
        """主消费循环：背压控制下 XREADGROUP 拉取并分发入站消息。"""
        redis: aioredis.Redis = await self._get_redis()
        while self._running:
            try:
                if not self._stream_keys:
                    await asyncio.sleep(1)
                    continue

                # 背压：在飞任务已达上限时暂停拉取，避免无界 create_task
                while self._running and len(self._inflight) >= self._max_concurrency:
                    await asyncio.sleep(0.05)

                if not self._running:
                    break

                streams: dict[Any, Any] = {key: ">" for key in self._stream_keys}
                result: Any = await redis.xreadgroup(
                    groupname=CONSUMER_GROUP,
                    consumername=self._consumer_name,
                    streams=streams,
                    count=self._read_count,
                    block=BLOCK_MS,
                )
                if not result:
                    continue

                for stream_key, messages in result:
                    for message_id, raw_fields in messages:
                        fields: dict[str, str] = normalize_stream_fields(raw_fields)
                        inbound: InboundStreamMessage = parse_inbound_fields(fields)
                        self._spawn_handler(str(stream_key), str(message_id), inbound)
            except asyncio.CancelledError:
                raise
            except (RedisTimeoutError, asyncio.TimeoutError):
                # XREADGROUP 阻塞超时 = 暂无新消息，属正常空闲
                continue
            except Exception as exc:
                logger.error("Inbound stream consume loop error", error=str(exc))
                await asyncio.sleep(1)

    async def _reclaim_loop(self) -> None:
        """周期性 XAUTOCLAIM 重投 PEL 孤儿消息（T6 / N1 闭环，Core 侧）。

        多 Core 下消费者崩溃会在 PEL 滞留孤儿消息；本循环对每个订阅 stream
        （含 ``agent_events`` 兜底流）做 XAUTOCLAIM，把 idle 超过阈值的消息
        重投到本消费者重新处理，保证 kill -9 后孤儿消息恰好一次重投（不丢不重）。
        沿用既有 ``agent-core-group`` 拓扑与 Redis 分布式 session 锁（同会话串行，跨 Core）。
        """
        redis: aioredis.Redis = await self._get_redis()
        while self._running:
            await asyncio.sleep(self._xclaim_interval_ms / 1000.0)
            if not self._running:
                break
            for stream_key in self._stream_keys:
                await self._reclaim_stream(redis, stream_key)
            # 兜底：agent_events 流（若曾被投递）一并重投
            await self._reclaim_stream(redis, StreamKeys.agent_events())

    async def _reclaim_stream(self, redis: aioredis.Redis, stream_key: str) -> None:
        """对单个 stream 执行一次 XAUTOCLAIM 重投（Core 侧 N1 闭环）。

        Args:
            redis: 已连接的 Redis 客户端。
            stream_key: 目标 stream 键名。
        """
        try:
            # redis-py xautoclaim 返回 (next_cursor, claimed_list, deleted_list)
            claimed: Any = await redis.xautoclaim(
                stream_key,
                CONSUMER_GROUP,
                self._consumer_name,
                self._xclaim_min_idle_ms,
                "0-0",
                100,
            )
        except Exception as exc:  # noqa: BLE001 - 单流重投失败不应中断整轮循环
            logger.warning(
                "Inbound reclaim pass failed",
                stream_key=stream_key,
                error=str(exc),
            )
            return
        if not claimed or len(claimed) < 2:
            return
        messages: list[Any] = claimed[1]
        if not messages:
            return
        for message_id, raw_fields in messages:
            fields: dict[str, str] = normalize_stream_fields(raw_fields)
            inbound: InboundStreamMessage = parse_inbound_fields(fields)
            self._spawn_handler(str(stream_key), str(message_id), inbound)

    async def _check_owned(self, agent_id: str) -> None:
        """多 Core（T9）：若 agent 由其他 Core 持有，抛 ``_RerouteToOwner`` 重投到 owning core。

        单 Core（未绑定 Core）或 agent_id 为空 / owner 未知时直接放行（本地处理 / 兜底）。

        Args:
            agent_id: 待处理的 Agent ID。

        Raises:
            _RerouteToOwner: agent 由其他 Core 持有，需重投。
        """
        if self._core_ownership is None or not agent_id:
            return
        try:
            owner: str | None = await self._core_ownership.current_owner(agent_id)
        except Exception as exc:  # noqa: BLE001 - owner 读失败不阻断，退化为本地处理
            logger.warning(
                "Agent owner lookup failed; processing locally",
                agent_id=agent_id,
                error=str(exc),
            )
            return
        if owner is not None and owner != self._core_id:
            raise _RerouteToOwner(agent_id)

    async def _reroute_to_owner(
        self,
        agent_id: str,
        inbound: InboundStreamMessage,
        redis: aioredis.Redis,
    ) -> None:
        """把非本 core 拥有的 agent 首条消息重投到 owning core 的 agent 流（T9 路由）。

        用与 Gateway ``publishInbound`` 完全一致的字段 schema 重建入站字段，XADD 到
        ``aip:stream:agent:{agentId}``；owning core 订阅该流并消费处理（同构问题①路由，
        决策 1）。

        Args:
            agent_id: 目标 agent ID（owning core 持有）。
            inbound: 原始入站消息（用于重建字段）。
            redis: 已连接的 Redis 客户端（写重投流）。
        """
        fields: dict[str, Any] = {
            "sessionId": inbound.session_id,
            "userId": inbound.user_id,
            "channel": inbound.channel or "h5",
            "content": inbound.content,
            "messageType": inbound.message_type,
            "traceId": inbound.trace_id,
            "timestamp": inbound.timestamp,
        }
        if inbound.user_mobile:
            fields["userMobile"] = inbound.user_mobile
        if inbound.channel_user_id:
            fields["channelUserId"] = inbound.channel_user_id
        # 显式标注目标 agent，便于 owning core 直接定位（与 stream key 一致）。
        fields["agentId"] = agent_id
        if inbound.metadata is not None:
            fields["metadata"] = json.dumps(inbound.metadata, ensure_ascii=False)
        if inbound.resume_token:
            fields["resumeToken"] = inbound.resume_token
        if inbound.selected_candidate is not None:
            fields["selectedCandidate"] = json.dumps(
                inbound.selected_candidate, ensure_ascii=False
            )
        if inbound.selection_action:
            fields["action"] = inbound.selection_action
        try:
            await redis.xadd(
                StreamKeys.agent_inbound(agent_id),
                fields,
                maxlen=MAX_STREAM_LENGTH,
                approximate=True,
            )
        except Exception as exc:  # noqa: BLE001 - 重投失败：原流仍不 ACK，交由 XAUTOCLAIM 重投
            logger.error(
                "Failed to reroute inbound message to owning core",
                agent_id=agent_id,
                session_id=inbound.session_id,
                error=str(exc),
            )

    async def _handle_message(
        self,
        stream_key: str,
        message_id: str,
        inbound: InboundStreamMessage,
    ) -> None:
        """有界并发 + 同 session 串行（Redis 分布式锁）；成功后 ACK；非本 core 拥有的
        agent 首条消息重投到 owning core（T9 / 同构问题①路由）。"""
        redis: aioredis.Redis = await self._get_redis()
        async with self._semaphore:
            async with self._acquire_session_lock(inbound.session_id) as lock_result:
                if not lock_result.locked:
                    # 争锁失败（达到重试上限）：放弃，不 ACK，交由 XAUTOCLAIM 重投
                    # （不丢不重，消息留在 PEL 由 owning core / 本 core 后续重投）。
                    logger.debug(
                        "Session lock not acquired; giving up (will be reclaimed)",
                        session_id=inbound.session_id,
                    )
                    return
                try:
                    await self._process_inbound(inbound, stream_key)
                    await redis.xack(stream_key, CONSUMER_GROUP, message_id)
                except _RerouteToOwner as reroute:
                    # 非本 core 拥有的 agent：重投到 owning core 的 agent 流并 ACK 原流。
                    await self._reroute_to_owner(reroute.agent_id, inbound, redis)
                    await redis.xack(stream_key, CONSUMER_GROUP, message_id)
                    logger.info(
                        "Inbound message rerouted to owning core",
                        agent_id=reroute.agent_id,
                        target_stream=StreamKeys.agent_inbound(reroute.agent_id),
                        from_stream=stream_key,
                        session_id=inbound.session_id,
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.error(
                        "Failed to process inbound stream message",
                        stream_key=stream_key,
                        message_id=message_id,
                        session_id=inbound.session_id,
                        error=str(exc),
                        exc_info=True,
                    )
                    # 暂不 ACK，留给 XAUTOCLAIM 重投（不丢不重）

    async def _process_inbound(
        self,
        inbound: InboundStreamMessage,
        stream_key: str,
    ) -> None:
        """解析入站消息、写入会话、驱动 Agent 并将事件发布到出站 stream。

        处理会话/Agent 不存在、超时及运行时错误，必要时通过
        ``_publish_error`` 下发错误事件。

        Args:
            inbound: Gateway 写入的入站消息。
            stream_key: 消息来源 stream 键名（用于推断 ``agent_id``）。
        """
        if inbound.message_type == "entity_select":
            # HITL 实体选择回调（企微按钮 / H5 提交）→ 续跑表单填充（T05）
            await self._process_formfill_resume(inbound, stream_key)
            return

        has_attachments = False
        if inbound.metadata and isinstance(inbound.metadata, dict):
            atts = inbound.metadata.get("attachments")
            has_attachments = isinstance(atts, list) and len(atts) > 0

        if not inbound.content.strip() and not has_attachments:
            logger.debug("Skip empty inbound message", session_id=inbound.session_id)
            return

        t0: float = time.perf_counter()
        perf_t0_ms: Any = None
        if inbound.metadata and isinstance(inbound.metadata, dict):
            perf_t0_ms = inbound.metadata.get("perfT0")

        def _ms_since_start() -> int:
            return int((time.perf_counter() - t0) * 1000)

        def _ms_since_gw() -> int | None:
            if perf_t0_ms is None:
                return None
            try:
                return int(time.time() * 1000) - int(perf_t0_ms)
            except (TypeError, ValueError):
                return None

        logger.info(
            "Inbound process start",
            session_id=inbound.session_id,
            channel=inbound.channel,
            content_len=len(inbound.content),
            ms_since_gw=_ms_since_gw(),
            perf_phase="be_start",
        )

        agent_id: Any = inbound.agent_id
        agent_stream_marker = f"{get_settings().REDIS_KEY_PREFIX}stream:agent:"
        if not agent_id and stream_key.startswith(agent_stream_marker):
            agent_id = stream_key.removeprefix(agent_stream_marker)

        session_manager: SessionManager = get_session_manager()
        agent_manager: AgentManager = get_agent_manager()
        producer: Any = self._producer
        if producer is None:
            raise RuntimeError("Stream producer not initialized")

        t_session0: float = time.perf_counter()
        session_created: bool = False
        try:
            session: Session = await session_manager.get_session(inbound.session_id)
            # 刷新入站身份到会话（供 MCP 注入）
            identity_changed: bool = False
            if inbound.user_id and session.user_id != inbound.user_id:
                session.user_id = inbound.user_id
                identity_changed = True
            if inbound.channel and session.channel != inbound.channel:
                session.channel = inbound.channel
                identity_changed = True
            inbound_mobile: str = inbound.user_mobile or ""
            if inbound_mobile and session.user_mobile != inbound_mobile:
                session.user_mobile = inbound_mobile
                identity_changed = True
            inbound_channel_uid: str = inbound.channel_user_id or ""
            if inbound_channel_uid and session.channel_user_id != inbound_channel_uid:
                session.channel_user_id = inbound_channel_uid
                identity_changed = True
            # T03 S9：企微渠道走档 2（查 users.mis_user_id）。仅在会话尚未持有
            # mis_user_id 时才查库，避免每条入站消息都打 DB。
            if session.mis_user_id is None:
                resolved_mis_uid: int | None = await _resolve_inbound_mis_user_id(inbound)
                if resolved_mis_uid is not None:
                    session.mis_user_id = resolved_mis_uid
                    identity_changed = True
            if identity_changed:
                await session_manager.save_session(session)
        except SessionNotFoundError:
            session_created = True
            # Gateway 渠道消息常带稳定 session_id（如 wecom-bot-{userId}），首次需自动建会话
            resolved_for_create: str | None = agent_id
            if not resolved_for_create:
                try:
                    from src.router.agent_router import get_agent_router
                    from src.router.models import UserRequest

                    route_result: Any = await get_agent_router().route(
                        UserRequest(
                            text=inbound.content,
                            user_id=inbound.user_id,
                            session_id=inbound.session_id,
                            channel=inbound.channel,
                            metadata=inbound.metadata,
                        ),
                    )
                    resolved_for_create = route_result.agent_id
                except Exception as route_exc:
                    logger.warning(
                        "Inbound agent route failed, falling back to running agents",
                        error=str(route_exc),
                    )
                    resolved_for_create = None

            running: list[Any] = [
                inst
                for inst in agent_manager.list_agents()
                if inst.lifecycle.current_state.value == "running"
            ]
            running_ids: set[str] = {inst.id for inst in running}
            if not resolved_for_create or resolved_for_create not in running_ids:
                if running:
                    resolved_for_create = running[0].id
                    logger.info(
                        "Inbound using running agent",
                        agent_id=resolved_for_create,
                    )
                else:
                    resolved_for_create = self._settings.AGENT_ROUTER_DEFAULT_AGENT

            if not resolved_for_create:
                await self._publish_error(
                    producer,
                    inbound,
                    "unknown",
                    "agent_not_found",
                    "No agent available to create session",
                )
                return

            logger.info(
                "Creating session for inbound message",
                session_id=inbound.session_id,
                user_id=inbound.user_id,
                agent_id=resolved_for_create,
                channel=inbound.channel,
            )
            session = await session_manager.ensure_session(
                session_id=inbound.session_id,
                agent_id=resolved_for_create,
                user_id=inbound.user_id,
                channel=inbound.channel,
                user_mobile=inbound.user_mobile or "",
                channel_user_id=inbound.channel_user_id or "",
                # T03 S9：企微渠道创建点解析 MIS userId（档 2，查 users.mis_user_id）。
                # 未绑定 → None → 下游 E1–E5 fail-closed 拒绝（#15-c 绑定流程在 T06）。
                mis_user_id=await _resolve_inbound_mis_user_id(inbound),
            )

        ms_session: int = int((time.perf_counter() - t_session0) * 1000)
        logger.info(
            "Inbound session ready",
            session_id=inbound.session_id,
            session_created=session_created,
            ms_session=ms_session,
            ms_since_start=_ms_since_start(),
            ms_since_gw=_ms_since_gw(),
            perf_phase="be_session",
        )

        resolved_agent_id: Any = agent_id or session.agent_id
        # T9 / 同构问题①路由：若目标 agent 由其他 Core 持有，重投到 owning core，
        # 在 running_now 回退（可能改派本 core 其它 agent）之前判定，避免误本地处理。
        await self._check_owned(resolved_agent_id)
        # 会话已有 agent，但可能未处于 running；纠正为当前可用实例
        running_now: list[Any] = [
            inst
            for inst in agent_manager.list_agents()
            if inst.lifecycle.current_state.value == "running"
        ]
        running_now_ids: set[str] = {inst.id for inst in running_now}
        if resolved_agent_id not in running_now_ids and running_now:
            resolved_agent_id = running_now[0].id
            session.agent_id = resolved_agent_id
            await session_manager.save_session(session)

        # 持久化上游 MIS JWT / 租户（供 FormFill 反向信任复用；T01）
        await self._persist_upstream_identity(session, inbound)

        user_content = inbound.content.strip()
        if not user_content and has_attachments:
            att_names: list[str] = []
            for item in inbound.metadata.get("attachments") or []:  # type: ignore[union-attr]
                if isinstance(item, dict):
                    name = item.get("name") or item.get("fileId") or item.get("file_id")
                    if name:
                        att_names.append(str(name))
            user_content = "（用户发送了附件）" + (
                "：" + "、".join(att_names) if att_names else ""
            )

        user_msg: Message = await session_manager.add_message(
            session_id=session.session_id,
            role="user",
            content=user_content or inbound.content,
            metadata=inbound.metadata,
        )

        t_agent0: float = time.perf_counter()
        try:
            instance: AgentInstance = await agent_manager.ensure_agent_ready(resolved_agent_id)
        except AgentNotFoundError as exc:
            await self._publish_error(
                producer,
                inbound,
                resolved_agent_id,
                "agent_not_found",
                str(exc),
            )
            return

        ms_ensure_agent: int = int((time.perf_counter() - t_agent0) * 1000)
        logger.info(
            "Inbound agent ready",
            session_id=session.session_id,
            agent_id=resolved_agent_id,
            ms_ensure_agent=ms_ensure_agent,
            ms_since_start=_ms_since_start(),
            ms_since_gw=_ms_since_gw(),
            perf_phase="be_agent_ready",
        )

        response_parts: list[str] = []
        runtime_error: str | None = None
        timeout_sec: Any = self._settings.AGENT_MESSAGE_TIMEOUT
        first_event_ms: int | None = None
        first_text_ms: int | None = None
        event_count: int = 0
        t_run0: float = time.perf_counter()
        # 2.1：本轮 assistant 消息 id 预先生成，计时按轮（turn_key=该 id）落库。
        assistant_id: str = str(uuid.uuid4())

        try:
            async with asyncio.timeout(timeout_sec):
                async for event in instance.process_message(
                    session=session,
                    message=user_msg,
                    assistant_message_id=assistant_id,
                ):
                    if first_event_ms is None:
                        first_event_ms = int((time.perf_counter() - t_run0) * 1000)
                        logger.info(
                            "Inbound first agent event",
                            session_id=session.session_id,
                            event_type=event.type.value if hasattr(event.type, "value") else str(event.type),
                            ms_first_event=first_event_ms,
                            ms_since_start=_ms_since_start(),
                            ms_since_gw=_ms_since_gw(),
                            perf_phase="be_first_event",
                        )
                    event_count += 1
                    if event.type == AgentEventType.DONE:
                        pending_fence = session.state.pop("pending_kb_sources_fence", None)
                        if pending_fence is not None:
                            await session_manager.save_session(session)
                        assembled = "".join(response_parts)
                        if pending_fence and "```kb-sources" not in assembled:
                            fence_text = (
                                pending_fence
                                if pending_fence.startswith("\n")
                                else f"\n\n{pending_fence}"
                            )
                            await producer.publish_agent_event(
                                session_id=session.session_id,
                                user_id=inbound.user_id,
                                channel=session.channel,
                                agent_id=resolved_agent_id,
                                trace_id=inbound.trace_id,
                                event=AgentEvent.text_delta(fence_text),
                            )
                            response_parts.append(fence_text)
                    await producer.publish_agent_event(
                        session_id=session.session_id,
                        user_id=inbound.user_id,
                        channel=session.channel,
                        agent_id=resolved_agent_id,
                        trace_id=inbound.trace_id,
                        event=event,
                    )
                    if event.type == AgentEventType.TEXT_DELTA and event.content:
                        if first_text_ms is None:
                            first_text_ms = int((time.perf_counter() - t_run0) * 1000)
                            logger.info(
                                "Inbound first text.delta",
                                session_id=session.session_id,
                                ms_first_text=first_text_ms,
                                ms_since_start=_ms_since_start(),
                                ms_since_gw=_ms_since_gw(),
                                perf_phase="be_first_text",
                            )
                        response_parts.append(event.content)
                    elif event.type == AgentEventType.ERROR:
                        runtime_error: Any = event.message or "Agent runtime error"
        except TimeoutError:
            logger.error(
                "Agent message processing timed out",
                session_id=session.session_id,
                agent_id=resolved_agent_id,
                timeout_sec=timeout_sec,
                ms_since_start=_ms_since_start(),
                perf_phase="be_timeout",
            )
            await self._publish_error(
                producer,
                inbound,
                resolved_agent_id,
                "agent_timeout",
                f"处理超时（{timeout_sec}s），请稍后重试",
            )
            return
        except Exception as exc:
            logger.error(
                "Agent message processing failed",
                session_id=session.session_id,
                agent_id=resolved_agent_id,
                error=str(exc),
                ms_since_start=_ms_since_start(),
                perf_phase="be_error",
                exc_info=True,
            )
            await self._publish_error(
                producer,
                inbound,
                resolved_agent_id,
                "agent_processing_error",
                str(exc) or "Agent processing failed",
            )
            return

        ms_agent_run: int = int((time.perf_counter() - t_run0) * 1000)
        response_text: str = "".join(response_parts)
        if response_text.strip():
            await session_manager.add_message(
                session_id=session.session_id,
                role="assistant",
                content=response_text,
                message_id=assistant_id,
            )
        elif runtime_error:
            logger.warning(
                "Agent completed without text response",
                session_id=session.session_id,
                error=runtime_error,
            )

        logger.info(
            "Inbound message processed (perf summary)",
            session_id=session.session_id,
            agent_id=resolved_agent_id,
            response_length=len(response_text),
            event_count=event_count,
            session_created=session_created,
            ms_session=ms_session,
            ms_ensure_agent=ms_ensure_agent,
            ms_first_event=first_event_ms,
            ms_first_text=first_text_ms,
            ms_agent_run=ms_agent_run,
            ms_total=_ms_since_start(),
            ms_since_gw=_ms_since_gw(),
            perf_phase="be_done",
        )

    async def _publish_error(
        self,
        producer: StreamProducer,
        inbound: InboundStreamMessage,
        agent_id: str,
        error_code: str,
        message: str,
    ) -> None:
        """向出站 stream 发布错误事件并紧跟 ``done`` 事件。

        Args:
            producer: 出站 ``StreamProducer``。
            inbound: 原始入站消息（用于 session/user/channel/trace）。
            agent_id: 关联的 Agent ID。
            error_code: 平台错误码。
            message: 用户可见错误说明。
        """
        from src.runtime.events import AgentEvent

        await producer.publish_agent_event(
            session_id=inbound.session_id,
            user_id=inbound.user_id,
            channel=inbound.channel,
            agent_id=agent_id,
            trace_id=inbound.trace_id,
            event=AgentEvent.error(error_code, message),
        )
        await producer.publish_agent_event(
            session_id=inbound.session_id,
            user_id=inbound.user_id,
            channel=inbound.channel,
            agent_id=agent_id,
            trace_id=inbound.trace_id,
            event=AgentEvent.done(),
        )

    async def _persist_upstream_identity(
        self, session: Session, inbound: InboundStreamMessage
    ) -> None:
        """将入站 metadata 中的上游 MIS JWT / 租户写入 session.state（供反向信任复用；T01）。

        仅当 gateway 在 inbound.metadata 中携带 ``misUpstreamJwt`` / ``tenantId`` 时生效；
        非 MIS 门户渠道（H5/企微）无上游 MIS JWT，依赖 X-User-Id/X-Tenant-Id 透传。
        """
        meta = inbound.metadata
        if not isinstance(meta, dict):
            return
        mis_jwt = meta.get("misUpstreamJwt") or meta.get("mis_upstream_jwt")
        tenant = meta.get("tenantId") or meta.get("tenant_id")
        changed = False
        if mis_jwt and session.state.get("mis_upstream_jwt") != mis_jwt:
            session.state["mis_upstream_jwt"] = mis_jwt
            changed = True
        if tenant and session.state.get("tenant_id") != tenant:
            session.state["tenant_id"] = tenant
            changed = True
        if changed:
            await get_session_manager().save_session(session)

    async def _process_formfill_resume(
        self, inbound: InboundStreamMessage, stream_key: str
    ) -> None:
        """处理 entity_select 入站（用户已选候选），续跑表单填充（T05）。

        解析 resume_token / 选择结果，调用 ``resume_formfill`` 提交 apply，
        并按结果继续驱动 agent 或下发自然语言回执。
        """
        t0 = time.perf_counter()

        def _ms_since_start() -> int:
            return int((time.perf_counter() - t0) * 1000)

        session_manager = get_session_manager()
        agent_manager = get_agent_manager()
        producer = self._producer
        if producer is None:
            raise RuntimeError("Stream producer not initialized")

        try:
            session = await session_manager.get_session(inbound.session_id)
        except SessionNotFoundError:
            logger.warning(
                "FormFill resume: session not found",
                session_id=inbound.session_id,
            )
            return

        await self._persist_upstream_identity(session, inbound)

        resolved_agent_id = session.agent_id
        # T9 / 同构问题①路由：表单填充恢复回调同样需先判定 agent owner，非本 core
        # 拥有则重投到 owning core 处理。
        await self._check_owned(resolved_agent_id)
        running_now = [
            inst
            for inst in agent_manager.list_agents()
            if inst.lifecycle.current_state.value == "running"
        ]
        running_now_ids = {inst.id for inst in running_now}
        if resolved_agent_id not in running_now_ids and running_now:
            resolved_agent_id = running_now[0].id
            session.agent_id = resolved_agent_id
            await session_manager.save_session(session)

        t_agent0 = time.perf_counter()
        try:
            instance = await agent_manager.ensure_agent_ready(resolved_agent_id)
        except AgentNotFoundError as exc:
            await self._publish_error(
                producer, inbound, resolved_agent_id, "agent_not_found", str(exc)
            )
            return
        ms_ensure_agent = int((time.perf_counter() - t_agent0) * 1000)
        logger.info(
            "FormFill resume agent ready",
            session_id=session.session_id,
            agent_id=resolved_agent_id,
            ms_ensure_agent=ms_ensure_agent,
            ms_since_start=_ms_since_start(),
            perf_phase="be_ff_agent_ready",
        )

        outcome = await resume_formfill(
            instance=instance, session=session, inbound=inbound, producer=producer
        )

        if outcome.kind == "continue":
            # 续跑：把 apply 结果作为用户消息，继续驱动 agent
            user_msg = await session_manager.add_message(
                session_id=session.session_id,
                role="user",
                content=outcome.content,
                metadata={**(inbound.metadata or {}), "formfill_resume": True},
            )
            await self._run_formfill_and_publish(instance, session, user_msg, inbound, producer)
        elif outcome.kind == "error":
            await self._publish_error(
                producer, inbound, resolved_agent_id, "formfill_error", outcome.content
            )
        else:  # message
            await producer.publish_agent_event(
                session_id=session.session_id,
                user_id=inbound.user_id,
                channel=session.channel,
                agent_id=resolved_agent_id,
                trace_id=inbound.trace_id,
                event=AgentEvent.text_delta(outcome.content),
            )
            await producer.publish_agent_event(
                session_id=session.session_id,
                user_id=inbound.user_id,
                channel=session.channel,
                agent_id=resolved_agent_id,
                trace_id=inbound.trace_id,
                event=AgentEvent.done(),
            )
            if outcome.content.strip():
                await session_manager.add_message(
                    session_id=session.session_id, role="assistant", content=outcome.content
                )

    async def _run_formfill_and_publish(
        self,
        instance: AgentInstance,
        session: Session,
        user_msg: Message,
        inbound: InboundStreamMessage,
        producer: StreamProducer,
    ) -> None:
        """运行 agent 并发布事件流（表单填充续跑专用，复用标准发布逻辑）。"""
        response_parts: list[str] = []
        runtime_error: str | None = None
        timeout_sec: Any = self._settings.AGENT_MESSAGE_TIMEOUT
        first_event_ms: int | None = None
        first_text_ms: int | None = None
        event_count: int = 0
        t_run0: float = time.perf_counter()
        # 2.1：本轮 assistant 消息 id 预先生成，计时按轮（turn_key=该 id）落库。
        assistant_id: str = str(uuid.uuid4())

        try:
            async with asyncio.timeout(timeout_sec):
                async for event in instance.process_message(
                    session=session, message=user_msg, assistant_message_id=assistant_id
                ):
                    if first_event_ms is None:
                        first_event_ms = int((time.perf_counter() - t_run0) * 1000)
                    event_count += 1
                    await producer.publish_agent_event(
                        session_id=session.session_id,
                        user_id=inbound.user_id,
                        channel=session.channel,
                        agent_id=session.agent_id,
                        trace_id=inbound.trace_id,
                        event=event,
                    )
                    if event.type == AgentEventType.TEXT_DELTA and event.content:
                        if first_text_ms is None:
                            first_text_ms = int((time.perf_counter() - t_run0) * 1000)
                        response_parts.append(event.content)
                    elif event.type == AgentEventType.ERROR:
                        runtime_error = event.message or "Agent runtime error"
        except TimeoutError:
            await self._publish_error(
                producer,
                inbound,
                session.agent_id,
                "agent_timeout",
                f"处理超时（{timeout_sec}s），请稍后重试",
            )
            return
        except Exception as exc:
            await self._publish_error(
                producer,
                inbound,
                session.agent_id,
                "agent_processing_error",
                str(exc) or "Agent processing failed",
            )
            return

        ms_agent_run = int((time.perf_counter() - t_run0) * 1000)
        response_text = "".join(response_parts)
        if response_text.strip():
            await session_manager.add_message(
                session_id=session.session_id,
                role="assistant",
                content=response_text,
                message_id=assistant_id,
            )
        elif runtime_error:
            logger.warning(
                "FormFill resume completed without text response",
                session_id=session.session_id,
                error=runtime_error,
            )

        logger.info(
            "FormFill resume processed (perf summary)",
            session_id=session.session_id,
            agent_id=session.agent_id,
            response_length=len(response_text),
            event_count=event_count,
            ms_agent_run=ms_agent_run,
            ms_total=_ms_since_start(),
            perf_phase="be_ff_done",
        )


def get_inbound_stream_worker() -> InboundStreamWorker:
    """返回进程内单例 ``InboundStreamWorker``。"""
    global _worker
    if _worker is None:
        _worker = InboundStreamWorker()
    return _worker


async def start_inbound_stream_worker(agent_ids: list[str] | None = None) -> None:
    """按配置启动入站 stream 消费者；``STREAM_CONSUMER_ENABLED=False`` 时跳过。

    Args:
        agent_ids: 要订阅的 Agent ID 列表；为 ``None`` 时使用全部已注册 Agent。
    """
    settings: Settings = get_settings()
    if not settings.STREAM_CONSUMER_ENABLED:
        logger.info("Inbound stream worker disabled by config")
        return
    await get_inbound_stream_worker().start(agent_ids)


async def stop_inbound_stream_worker() -> None:
    """停止已创建的入站 stream 消费者（若存在）。"""
    if _worker is not None:
        await _worker.stop()
