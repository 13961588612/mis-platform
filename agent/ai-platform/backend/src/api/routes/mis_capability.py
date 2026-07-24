"""MIS 业务能力适配层端点（阶段1 认证对齐 + 阶段2 BFF 调用目标）。

暴露受 MIS RS256 保护的 Agent 调用面，供 ``mis-admin-bff`` 适配层转发：
- ``POST /api/v1/agents/{agent_id}/chat``      — 非流式对话
- ``POST /api/v1/agents/{agent_id}/chat/stream`` — SSE 流式对话（兼容契约 ``event: delta|done|error``）

两个端点均要求 ``Depends(get_current_user)``，MIS 身份经 ``alg==RS256`` 分支
由 :class:`~src.identity.mis_token.MisTokenVerifier` 验签并映射为平台 ``UserContext``。
原有 ``/sessions``、``/ws/chat``、``/wecom/**`` 等端点不在本文件，零改动。

统一响应包络：``{ code, data, message, traceId }``。
"""

from __future__ import annotations
from typing import Any

import json

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.agent.manager import AgentManager, get_agent_manager
from src.agent.session import Message, SessionManager, get_session_manager
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.runtime.events import AgentEventType
from src.utils.exceptions import AgentNotFoundError
from src.utils.logging import get_logger

logger = get_logger("api.routes.mis_capability")

router = APIRouter(tags=["mis-capability"])


# ===== 请求模型 =====


class AgentChatRequest(BaseModel):
    """受 MIS RS256 保护的 Agent 对话请求体。"""

    content: str = Field(..., description="用户消息内容")
    role: str = Field(default="user", description="消息角色：user | system")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="透传元数据（source / capability / page_context / employee_id 等）",
    )


# ===== SSE 辅助 =====


def _sse_frame(event: str, data: dict[str, Any]) -> str:
    """构造一个 SSE 事件帧：``event: <name>\\ndata: <json>\\n\\n``。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ===== 端点 =====


@router.post("/agents/{agent_id}/chat")
async def agent_chat(
    agent_id: str,
    req: AgentChatRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
) -> dict[str, Any]:
    """受 MIS RS256 保护的 Agent 非流式对话端点（供 BFF 适配层调用）。"""
    try:
        session_manager: SessionManager = get_session_manager()
        agent_manager: AgentManager = get_agent_manager()
        user_id: str = current_user.get("user_id", "mis-user")
        channel: str = current_user.get("channel", "mis_bff")

        session = await session_manager.create_session(
            agent_id=agent_id,
            user_id=user_id,
            channel=channel,
        )
        instance = await agent_manager.ensure_agent_ready(agent_id)

        response_parts: list[str] = []
        runtime_error: str | None = None
        tool_errors: list[str] = []

        async for event in instance.process_message(
            session=session,
            message=Message(role=req.role, content=req.content, metadata=req.metadata),
        ):
            if event.type == AgentEventType.TEXT_DELTA and event.content:
                response_parts.append(event.content)
            elif event.type == AgentEventType.TOOL_RESULT and event.result:
                err: Any | None = event.result.get("error")
                if err:
                    tool_errors.append(f"{event.tool_name}: {err}")
            elif event.type == AgentEventType.ERROR:
                runtime_error = event.message or "Agent runtime error"

        response_text: str = "".join(response_parts)

        # 保存助手响应，便于后续多轮会话
        await session_manager.add_message(
            session_id=session.session_id,
            role="assistant",
            content=response_text,
        )

        if runtime_error and not response_text.strip():
            return error_response(
                code=9000,
                message=runtime_error,
                http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                trace_id=trace_id,
            )
        if runtime_error:
            logger.warning(
                "Agent completed with runtime warning",
                agent_id=agent_id,
                error=runtime_error,
                tool_errors=tool_errors,
            )

        return success(
            data={
                "response": response_text,
                "session_id": session.session_id,
                "warnings": [runtime_error] if runtime_error else [],
                "tool_errors": tool_errors,
            },
            message="ok",
            trace_id=trace_id,
        )
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND, trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to process MIS agent chat", error=str(exc), agent_id=agent_id)
        return error_response(
            code=9000,
            message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )


@router.post("/agents/{agent_id}/chat/stream")
async def agent_chat_stream(
    agent_id: str,
    req: AgentChatRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
) -> StreamingResponse:
    """受 MIS RS256 保护的 Agent SSE 流式对话端点（供 BFF 适配层调用）。

    事件契约（与 BFF 侧一致）：
    - ``event: delta`` → ``{ traceId, delta }``
    - ``event: done``  → ``{ traceId, finishReason, sessionId }``
    - ``event: error`` → ``{ traceId, message }``
    """

    async def event_stream() -> Any:
        session_id: str | None = None
        response_parts: list[str] = []
        try:
            session_manager: SessionManager = get_session_manager()
            agent_manager: AgentManager = get_agent_manager()
            user_id: str = current_user.get("user_id", "mis-user")
            channel: str = current_user.get("channel", "mis_bff")

            session = await session_manager.create_session(
                agent_id=agent_id,
                user_id=user_id,
                channel=channel,
            )
            session_id = session.session_id
            instance = await agent_manager.ensure_agent_ready(agent_id)

            async for event in instance.process_message(
                session=session,
                message=Message(role=req.role, content=req.content, metadata=req.metadata),
            ):
                if event.type == AgentEventType.TEXT_DELTA and event.content:
                    response_parts.append(event.content)
                    yield _sse_frame(
                        "delta", {"traceId": trace_id, "delta": event.content}
                    )
                elif event.type == AgentEventType.ERROR:
                    yield _sse_frame(
                        "error",
                        {"traceId": trace_id, "message": event.message or "Agent runtime error"},
                    )
                    return

            await session_manager.add_message(
                session_id=session_id,
                role="assistant",
                content="".join(response_parts),
            )
            yield _sse_frame(
                "done",
                {
                    "traceId": trace_id,
                    "finishReason": "stop",
                    "sessionId": session_id,
                },
            )
        except AgentNotFoundError as exc:
            yield _sse_frame("error", {"traceId": trace_id, "message": exc.message})
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Failed to stream MIS agent chat", error=str(exc), agent_id=agent_id
            )
            yield _sse_frame("error", {"traceId": trace_id, "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
