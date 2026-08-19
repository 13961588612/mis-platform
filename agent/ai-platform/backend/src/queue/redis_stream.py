"""Redis Streams 生产/消费 — 与 Gateway redisStream.ts 字段对齐。"""

from __future__ import annotations
from typing import Any

import json
import os
from dataclasses import dataclass

import redis.asyncio as aioredis
from redis.exceptions import ResponseError

from src.config import get_settings
from src.runtime.events import AgentEvent
from src.utils.logging import get_logger

logger = get_logger("queue.redis_stream")


def _rk(name: str) -> str:
    """为 agent Redis 键统一添加命名空间前缀。

    与 TS gateway 端 ioredis 约定的 ``aip:`` 前缀保持一致，确保
    Gateway <-> Agent Core 之间的 Redis Stream 键在共享 Redis 实例中物理隔离。
    """
    return f"{get_settings().REDIS_KEY_PREFIX}{name}"


AGENT_EVENTS_STREAM = _rk("stream:agent:events")
CONSUMER_GROUP = "agent-core-group"
MAX_STREAM_LENGTH = 10_000
BLOCK_MS = 5000

# 每 Gateway 独立出站事件流（决策 2：per-owner 持久 stream，修 K3/N7）。
# 仅 owner Gateway 消费自己的 `aip:stream:gw:{gatewayId}:events`，
# 杜绝「每 gateway 独立消费组读全量」导致的重复投递（N7）。
PENDING_OUTBOUND_STREAM = _rk("stream:gw:pending:events")

# Backend 会话渠道 → Gateway EventTransformer 渠道
GATEWAY_CHANNEL_MAP: dict[str, str] = {
    "web": "h5",
    "h5": "h5",
    "wecom_h5": "wecom-h5",
    "wecom-h5": "wecom-h5",
    "wecom_bot": "wecom-bot",
    "wecom-bot": "wecom-bot",
}

DEFAULT_INBOUND_CHANNELS = ("h5", "wecom-h5", "wecom-bot")


# ---------------------------------------------------------------------------
# 出站 owner 解析链所需的 Redis 键（与 TS Gateway 端 `cluster/ownership.ts` 对齐）
# ---------------------------------------------------------------------------


def _session_bot_key(session_id: str) -> str:
    """``aip:session:{sid}:bot`` — session → botId 映射（回程精准定向，修 N3）。"""
    return _rk(f"session:{session_id}:bot")


def _session_gateway_key(session_id: str) -> str:
    """``aip:session:{sid}:gateway`` — 持有该会话 WS 的 gatewayId（H5/wecom-h5 粘性，修 N5）。"""
    return _rk(f"session:{session_id}:gateway")


def _bot_owner_key(bot_id: str) -> str:
    """``aip:bot:{botId}:owner`` — bot → owner gatewayId 租约（修 K1/N2）。"""
    return _rk(f"bot:{bot_id}:owner")


@dataclass
class InboundStreamMessage:
    """Gateway 写入 Redis 的入站消息。"""

    id: str
    session_id: str
    user_id: str
    channel: str
    content: str
    message_type: str
    trace_id: str
    timestamp: str
    agent_id: str | None = None
    metadata: dict[str, Any] | None = None
    user_mobile: str | None = None
    channel_user_id: str | None = None
    # entity_select 入站（T05）：表单填充 HITL 恢复
    resume_token: str | None = None
    selected_candidate: dict[str, Any] | None = None
    selection_action: str | None = None


class StreamKeys:
    """Stream 键名规范（与 Gateway StreamProducer 一致）。"""

    @staticmethod
    def agent_inbound(agent_id: str) -> str:
        """返回指定 Agent 的入站 stream 键名。

        Args:
            agent_id: Agent 实例 ID。

        Returns:
            ``aip:stream:agent:{agentId}`` 格式的键名（含命名空间前缀）。
        """
        return _rk(f"stream:agent:{agent_id}")

    @staticmethod
    def channel_inbound(channel: str) -> str:
        """返回指定渠道的入站 stream 键名。

        Args:
            channel: Gateway 渠道标识（如 ``h5``）。

        Returns:
            ``aip:stream:inbound:{channel}`` 格式的键名（含命名空间前缀）。
        """
        return _rk(f"stream:inbound:{channel}")

    @staticmethod
    def agent_events() -> str:
        """返回 Agent 出站事件 stream 的全局键名。"""
        return AGENT_EVENTS_STREAM

    @staticmethod
    def gateway_outbound(gateway_id: str) -> str:
        """返回指定 Gateway 的出站事件 stream 键名（per-owner）。

        Args:
            gateway_id: 持有该会话 Bot 的 owner Gateway ID。

        Returns:
            ``aip:stream:gw:{gatewayId}:events`` 格式的键名（含命名空间前缀）。
        """
        return _rk(f"stream:gw:{gateway_id}:events")


def parse_inbound_fields(fields: dict[str, str]) -> InboundStreamMessage:
    """将 Redis Stream 字段解析为 InboundStreamMessage。"""
    metadata_raw: str | None = fields.get("metadata")
    metadata: Any = json.loads(metadata_raw) if metadata_raw else None
    user_mobile: str | None = fields.get("userMobile") or None
    channel_user_id: str | None = fields.get("channelUserId") or None
    selected_candidate_raw: str | None = fields.get("selectedCandidate")
    selected_candidate: Any = (
        json.loads(selected_candidate_raw) if selected_candidate_raw else None
    )
    return InboundStreamMessage(
        id=fields.get("id", ""),
        session_id=fields.get("sessionId", ""),
        user_id=fields.get("userId", ""),
        channel=fields.get("channel", "h5"),
        content=fields.get("content", ""),
        message_type=fields.get("messageType", "text"),
        trace_id=fields.get("traceId", ""),
        timestamp=fields.get("timestamp", ""),
        agent_id=fields.get("agentId"),
        metadata=metadata,
        user_mobile=user_mobile,
        channel_user_id=channel_user_id,
        resume_token=fields.get("resumeToken"),
        selected_candidate=selected_candidate,
        selection_action=fields.get("action") or fields.get("selectionAction"),
    )


def fields_to_dict(raw_fields: list[Any]) -> dict[str, str]:
    """Redis XREADGROUP flat list → dict。"""
    result: dict[str, str] = {}
    for index in range(0, len(raw_fields), 2):
        key: Any = raw_fields[index]
        value: Any = raw_fields[index + 1] if index + 1 < len(raw_fields) else ""
        if isinstance(key, bytes):
            key: str = key.decode()
        if isinstance(value, bytes):
            value: str = value.decode()
        result[str(key)] = str(value)
    return result


def normalize_stream_fields(raw_fields: Any) -> dict[str, str]:
    """兼容 redis-py 返回 dict 或 flat list。"""
    if isinstance(raw_fields, dict):
        return {str(k): str(v) for k, v in raw_fields.items()}
    return fields_to_dict(list(raw_fields))


def to_gateway_channel(channel: str) -> str:
    """将 Backend 会话渠道名映射为 Gateway EventTransformer 渠道名。

    Args:
        channel: Backend 侧渠道标识。

    Returns:
        Gateway 识别的渠道名；无映射时原样返回。
    """
    return GATEWAY_CHANNEL_MAP.get(channel, channel)


class StreamProducer:
    """将 AgentEvent 写入 per-owner 出站 stream，供 owner Gateway 消费。"""

    def __init__(self, redis: aioredis.Redis) -> None:
        """绑定 Redis 客户端，用于向出站 stream 写入 Agent 事件。

        Args:
            redis: 已连接的 ``redis.asyncio.Redis`` 实例。
        """
        self._redis = redis

    @staticmethod
    def get_outbound_stream_key(gateway_id: str) -> str:
        """构造 per-owner 出站 stream 键名（与 TS Gateway 端一致）。

        Args:
            gateway_id: 目标 Gateway ID。

        Returns:
            ``aip:stream:gw:{gatewayId}:events`` 格式的键名。
        """
        return StreamKeys.gateway_outbound(gateway_id)

    async def publish_agent_event(
        self,
        *,
        session_id: str,
        user_id: str,
        channel: str,
        agent_id: str,
        trace_id: str,
        event: AgentEvent,
        target_gw: str | None = None,
    ) -> str:
        """将 ``AgentEvent`` 序列化后 XADD 到 **owner Gateway 的** 出站 stream。

        出站精准送达核心（决策 2，修 K3/N7）：事件只进入 owner Gateway 独占的
        ``aip:stream:gw:{ownerGw}:events``，避免「每 gateway 独立消费组读全量」
        造成的重复投递（N7）。

        目标 stream 解析链（与共享知识约定一致）：
        ``sessionId → GET aip:session:{sid}:bot → botId → GET aip:bot:{botId}:owner
        → gatewayId → XADD aip:stream:gw:{gatewayId}:events``。
        显式传入 ``target_gw`` 时直接使用（跳过查询）；owner 解析失败（无 bot 绑定
        或 owner 未知）则落入兜底流 ``aip:stream:gw:pending:events`` 并告警。

        Args:
            session_id: 会话 ID。
            user_id: 用户 ID。
            channel: Backend 渠道名（会经 ``to_gateway_channel`` 转换）。
            agent_id: Agent 实例 ID。
            trace_id: 分布式追踪 ID。
            event: 要发布的 Agent 事件。
            target_gw: 显式指定目标 Gateway ID（可选，优先于 owner 解析）。

        Returns:
            Redis 分配的 stream 消息 ID。
        """
        payload: dict[str, Any] = event.model_dump(mode="json", exclude_none=True)
        fields: dict[str, Any] = {
            "sessionId": session_id,
            "userId": user_id,
            "channel": to_gateway_channel(channel),
            "agentId": agent_id,
            "traceId": trace_id,
            "eventType": str(event.type.value),
            "event": json.dumps(payload, ensure_ascii=False),
        }
        stream_key = await self._resolve_outbound_stream(session_id, target_gw, channel)
        message_id: Any = await self._redis.xadd(
            stream_key,
            fields,
            maxlen=MAX_STREAM_LENGTH,
            approximate=True,
        )
        logger.debug(
            "Agent event published",
            stream=stream_key,
            session_id=session_id,
            event_type=event.type.value,
            message_id=message_id,
            target_gw=target_gw,
        )
        return str(message_id)

    async def _resolve_outbound_stream(
        self, session_id: str, target_gw: str | None, channel: str = ""
    ) -> str:
        """解析出站事件应写入的 per-owner stream 键名。

        解析链（与共享知识约定一致）：
        - 显式 ``target_gw`` 优先，直接构造返回；
        - H5 / wecom-h5 渠道优先读 ``aip:session:{sid}:gateway``（客户端粘性 WS 落点，
          修 N5），命中即 XADD 到该 gateway 的流；
        - 其余（及 H5 未命中时）回退 ``sessionId → aip:session:{sid}:bot → botId →
          aip:bot:{botId}:owner → gatewayId``（决策 2，修 K3/N7）；
        - 仍未知 → 兜底 ``aip:stream:gw:pending:events`` 并告警。

        Args:
            session_id: 会话 ID（owner 解析链入口）。
            target_gw: 显式指定的目标 Gateway；非空时直接构造返回。
            channel: Backend 渠道名（H5 类走 session→gateway 粘性）。

        Returns:
            owner Gateway 的出站 stream 键名；无法解析时返回兜底 pending 流键名。
        """
        if target_gw:
            return StreamProducer.get_outbound_stream_key(target_gw)

        try:
            # H5 / wecom-h5：优先按客户端粘性 WS 落点（修 N5）。仅当该 gateway 仍存活
            # 时生效；gateway 崩溃后映射 TTL 过期自然失效，回退 owner 解析链。
            # 同时兼容 backend 渠道名（wecom_h5）与 gateway 渠道名（wecom-h5）两种写法。
            if channel in ("h5", "wecom-h5", "wecom_h5"):
                gw: str | None = await self._redis.get(_session_gateway_key(session_id))
                if gw:
                    return StreamProducer.get_outbound_stream_key(gw)

            bot_id: str | None = await self._redis.get(_session_bot_key(session_id))
            if bot_id:
                owner: str | None = await self._redis.get(_bot_owner_key(bot_id))
                if owner:
                    return StreamProducer.get_outbound_stream_key(owner)
            logger.warning(
                "Outbound target gateway unknown; falling back to pending stream",
                session_id=session_id,
                channel=channel,
                bot_id=bot_id,
            )
        except Exception as exc:  # noqa: BLE001 - 解析失败不应阻断出站，落兜底并告警
            logger.error(
                "Failed to resolve outbound stream; using pending fallback",
                session_id=session_id,
                error=str(exc),
            )
        return PENDING_OUTBOUND_STREAM


async def ensure_consumer_group(redis: aioredis.Redis, stream_key: str) -> None:
    """确保消费者组存在。"""
    try:
        await redis.xgroup_create(stream_key, CONSUMER_GROUP, id="$", mkstream=True)
        logger.info("Consumer group created", stream_key=stream_key, group=CONSUMER_GROUP)
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


def build_consumer_name() -> str:
    """生成基于当前进程 ID 的 Redis 消费者名称。

    Returns:
        形如 ``agent-core-{pid}`` 的消费者名。
    """
    return f"agent-core-{os.getpid()}"
