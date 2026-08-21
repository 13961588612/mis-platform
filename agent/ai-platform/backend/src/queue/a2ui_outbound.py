"""A2UI run 出站发布器 — XADD AgentEvent 到 `aip:outbound:{sessionId}`。

A2UI 全链路时序（docs/ai-fusion/a2ui/02-task-breakdown.md §6）中，Python Agent Core
在 A2UI run 期间的 AgentEvent 必须写入 **会话私有出站流** ``aip:outbound:{sessionId}``，
由 Gateway 的 ``RedisStreamAgent`` 订阅（``$`` 起点）逐条读取 → ``EventConverter``
转 AG-UI BaseEvent → 中间件拦截 / 下发前端。

本模块与 Gateway 侧 ``gateway/src/a2ui/types.ts`` 的 ``OutboundStreamMessage``
**逐字段对齐**（权威契约）：

.. code-block:: text

    XADD aip:outbound:{sessionId} * sessionId <sid> eventType <type> event '<AgentEvent JSON>' timestamp <iso>

- ``eventType``：AgentEvent 类型冗余字段（便于流过滤/调试）；
- ``event``：AgentEvent 的 snake_case JSON（``AgentEvent.model_dump(exclude_none=True)``），
  与 ``parseBackendAgentEvent`` 完全兼容（``tool_name`` / ``error_code`` 等字段）；
- 与存量 ``StreamProducer`` 的 per-owner 出站流（``aip:stream:gw:{gatewayId}:events``）
  **互不影响**：A2UI run 是独立新约定（02 §6 时序图），不回退到 per-owner 解析链。

.. note::
    回包必须以 ``done`` 或 ``error`` 事件收尾，Gateway ``RedisStreamAgent`` 依赖
    这两个终止事件 ``complete`` Observable；否则订阅会一直阻塞空转。
"""

from __future__ import annotations
from typing import Any

import json
from datetime import datetime, timezone

from src.config import get_settings
from src.queue.redis_stream import MAX_STREAM_LENGTH
from src.runtime.events import AgentEvent
from src.utils.logging import get_logger

logger = get_logger("queue.a2ui_outbound")


def a2ui_outbound_key(session_id: str) -> str:
    """构造 A2UI 会话私有出站流键名。

    与 Gateway ``types.ts`` 的 ``outboundStreamKey(sessionId)`` 逐字一致：
    ``REDIS_KEY_PREFIX``（``aip:``）+ ``outbound:{sessionId}``。

    Args:
        session_id: 会话 ID。

    Returns:
        ``aip:outbound:{sessionId}`` 格式的流键名。
    """
    return f"{get_settings().REDIS_KEY_PREFIX}outbound:{session_id}"


class A2uiOutboundPublisher:
    """将 AgentEvent 序列化后 XADD 到会话私有出站流。

    供 ``A2uiRunLoop`` 在 A2UI run 期间回包；单消费者（Gateway RedisStreamAgent
    XREAD ``$`` 起点），无需消费者组。
    """

    def __init__(self, redis: Any) -> None:
        """绑定 Redis 客户端，用于向 A2UI 出站流写入 Agent 事件。

        Args:
            redis: 已连接的 ``redis.asyncio.Redis`` 实例。
        """
        self._redis = redis

    async def publish(self, session_id: str, event: AgentEvent) -> str:
        """将单个 AgentEvent 序列化后 XADD 到 ``aip:outbound:{sessionId}``。

        Args:
            session_id: 会话 ID。
            event: 要发布的 Agent 事件。

        Returns:
            Redis 分配的 stream 消息 ID。
        """
        payload: dict[str, Any] = event.model_dump(mode="json", exclude_none=True)
        fields: dict[str, Any] = {
            "sessionId": session_id,
            "eventType": event.type.value,
            "event": json.dumps(payload, ensure_ascii=False),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        message_id: Any = await self._redis.xadd(
            a2ui_outbound_key(session_id),
            fields,
            maxlen=MAX_STREAM_LENGTH,
            approximate=True,
        )
        logger.debug(
            "A2UI outbound event published",
            stream=a2ui_outbound_key(session_id),
            session_id=session_id,
            event_type=event.type.value,
            message_id=str(message_id),
        )
        return str(message_id)

    async def publish_error(
        self, session_id: str, error_code: str, message: str
    ) -> None:
        """发布错误事件并紧跟 ``done`` 事件（终止当前 run 的 Observable）。

        Gateway ``RedisStreamAgent`` 收到 ``error`` 或 ``done`` 即 complete；
        因此 A2UI run 任一步失败都必须以 error + done 收尾，避免订阅空转。

        Args:
            session_id: 会话 ID。
            error_code: 平台错误码（如 ``A2UI_RUN_ERROR`` / ``A2UI_TIMEOUT``）。
            message: 用户可见错误说明。
        """
        await self.publish(session_id, AgentEvent.error(error_code, message))
        await self.publish(session_id, AgentEvent.done())
