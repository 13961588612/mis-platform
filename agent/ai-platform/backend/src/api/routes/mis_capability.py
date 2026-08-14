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
from typing import Any, AsyncIterator

import json

from fastapi import APIRouter, Depends, Header, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.agent.manager import AgentManager, get_agent_manager
from src.agent.mis_rag import (
    EVENT_DELTA,
    EVENT_DONE,
    EVENT_ERROR,
    KbQaPipeline,
    KbQaRequest,
    build_kb_call_context,
    is_kb_qa_request,
)
from src.agent.session import Message, SessionManager, get_session_manager
from src.api.deps import get_current_user, get_trace_id, resolve_mis_user_id_with_db
from src.api.response import error_response, success
from src.config import get_settings
from src.coordinator.trace import dispatch_trace_sse_enabled, take_last_turn_traces
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


# ===== Agent 运行辅助 =====


async def _collect_agent_response(
    instance: Any,
    session: Any,
    message: Message,
) -> tuple[str, str | None, list[str]]:
    """驱动 Agent 处理一条消息，并汇总文本增量 / 运行时错误 / 工具错误。

    Args:
        instance: 已就绪的 Agent 实例。
        session: 平台会话对象。
        message: 待处理消息。

    Returns:
        ``(response_text, runtime_error, tool_errors)``。
    """
    response_parts: list[str] = []
    runtime_error: str | None = None
    tool_errors: list[str] = []

    async for event in instance.process_message(session=session, message=message):
        if event.type == AgentEventType.TEXT_DELTA and event.content:
            response_parts.append(event.content)
        elif event.type == AgentEventType.TOOL_RESULT and event.result:
            err: Any | None = event.result.get("error")
            if err:
                tool_errors.append(f"{event.tool_name}: {err}")
        elif event.type == AgentEventType.ERROR:
            runtime_error = event.message or "Agent runtime error"

    return "".join(response_parts), runtime_error, tool_errors


async def _run_kb_qa(
    *,
    agent_id: str,
    req: AgentChatRequest,
    instance: Any,
    session: Any,
    current_user: dict[str, Any],
    authorization: str,
    tenant_id: str,
    app_id: str,
    trace_id: str,
) -> tuple[str, str | None, list[str]]:
    """[DEPRECATED @ T4] 不再被端点调用：KB 预检索编排已收敛到 mis-rag 的 kb_retrieve。

    原职责：``visible-libraries → retrieve → 拼 Prompt → 生成 → citations → 落库``，
    把检索后的片段**预注入** mis-rag 的 prompt。T4 起该编排被移除——mis-rag 改为
    通过内部 ``kb_retrieve`` 工具自行检索（路径 A 与 Copilot B 路径同一执行体），
    因此预检索成为双重检索且绕过 B 路径。

    本函数仅作检索库参考保留（避免破坏其他潜在引用），请勿在新流程中使用。
    返回可直接作为 ``response`` 的 JSON 文本。

    链路：``visible-libraries → retrieve → 拼 Prompt → 生成 → citations → 落库``。
    生成步骤复用既有 Agent 运行时（``instance.process_message``），
    管线只负责检索增强与结构化落库。

    Returns:
        ``(response_json_text, runtime_error, tool_errors)``；
        ``response_json_text`` 形如
        ``{"answer":...,"citations":[...],"sessionId":...,"messageId":...}``。
    """
    settings = get_settings()
    kb_req = KbQaRequest.from_message(
        req.content,
        req.metadata,
        default_top_k=settings.MIS_KB_RETRIEVE_TOP_K,
    )
    ctx = build_kb_call_context(
        current_user,
        authorization=authorization,
        trace_id=trace_id,
        tenant_id=tenant_id,
        app_id=app_id,
        metadata=req.metadata,
    )

    captured_error: str | None = None
    captured_tool_errors: list[str] = []

    async def _generate(prompt: str) -> str:
        """把增强后的提示词交给 mis-rag Agent 运行时生成答案。"""
        nonlocal captured_error, captured_tool_errors
        text, err, tool_errs = await _collect_agent_response(
            instance,
            session,
            Message(role=req.role, content=prompt, metadata=req.metadata),
        )
        captured_error = err
        captured_tool_errors = tool_errs
        return text

    pipeline = KbQaPipeline()
    try:
        answer = await pipeline.run(kb_req, ctx, _generate)
    finally:
        await pipeline.aclose()

    logger.info(
        "KB QA completed",
        agent_id=agent_id,
        kb_session_id=answer.session_id,
        citation_count=len(answer.citations),
        trace_id=trace_id,
    )
    payload = json.dumps(answer.to_api(), ensure_ascii=False)
    return payload, captured_error, captured_tool_errors


async def _stream_kb_qa(
    *,
    agent_id: str,
    req: AgentChatRequest,
    instance: Any,
    session: Any,
    current_user: dict[str, Any],
    authorization: str,
    tenant_id: str,
    app_id: str,
    trace_id: str,
) -> AsyncIterator[str]:
    """[DEPRECATED @ T4] 不再被端点调用：KB 预检索编排已收敛到 mis-rag 的 kb_retrieve。

    原职责：与 :func:`_run_kb_qa` 共用同一条检索增强链路，差异仅在生成回调为异步
    生成器、落库在流结束后一次性完成。T4 起由 mis-rag 内部 ``kb_retrieve`` 统一检索，
    端点直接 ``process_message`` 原始问题并转发 SSE。

    本函数仅作检索库参考保留（避免破坏其他潜在引用），请勿在新流程中使用。
    流式执行 KB 问答管线（F-01），逐帧产出 SSE 文本。

    与 :func:`_run_kb_qa` 共用同一条检索增强链路，差异仅在生成回调为异步生成器、
    落库在流结束后一次性完成（设计 §7-Q1）。

    事件契约：
    - ``delta`` → ``{traceId, text, delta}``（``text``/``delta`` 同值，兼容新旧前端）
    - ``done``  → ``{traceId, sessionId, messageId, citations, finishReason, platformSessionId}``
    - ``error`` → ``{traceId, code, message}``

    Yields:
        已格式化的 SSE 帧字符串。
    """
    settings = get_settings()
    kb_req = KbQaRequest.from_message(
        req.content,
        req.metadata,
        default_top_k=settings.MIS_KB_RETRIEVE_TOP_K,
    )
    ctx = build_kb_call_context(
        current_user,
        authorization=authorization,
        trace_id=trace_id,
        tenant_id=tenant_id,
        app_id=app_id,
        metadata=req.metadata,
    )

    runtime_error: str | None = None
    produced_text: bool = False

    async def _generate_stream(prompt: str) -> AsyncIterator[str]:
        """把增强提示词交给 Agent 运行时，转发其 TEXT_DELTA 增量。"""
        nonlocal runtime_error, produced_text
        async for event in instance.process_message(
            session=session,
            message=Message(role=req.role, content=prompt, metadata=req.metadata),
        ):
            if event.type == AgentEventType.TEXT_DELTA and event.content:
                produced_text = True
                yield event.content
            elif event.type == AgentEventType.ERROR:
                runtime_error = event.message or "Agent runtime error"
                return

    answer_parts: list[str] = []
    pipeline = KbQaPipeline()
    try:
        async for frame in pipeline.run_stream(kb_req, ctx, _generate_stream):
            payload = frame.to_payload()
            payload["traceId"] = trace_id

            if frame.event == EVENT_DELTA:
                answer_parts.append(frame.text)
                yield _sse_frame(EVENT_DELTA, payload)
                continue

            if frame.event == EVENT_ERROR:
                yield _sse_frame(EVENT_ERROR, payload)
                return

            # done：运行时报错且一个字都没产出 ⇒ 降级为 error 帧，避免前端渲染空答案
            if runtime_error and not produced_text:
                yield _sse_frame(
                    EVENT_ERROR,
                    {"traceId": trace_id, "code": 9000, "message": runtime_error},
                )
                return
            if runtime_error:
                logger.warning(
                    "KB QA stream completed with runtime warning",
                    agent_id=agent_id,
                    error=runtime_error,
                    trace_id=trace_id,
                )
            await _save_platform_message(session, "".join(answer_parts))
            payload["platformSessionId"] = session.session_id
            logger.info(
                "KB QA stream done",
                agent_id=agent_id,
                kb_session_id=frame.session_id,
                citation_count=len(frame.citations),
                trace_id=trace_id,
            )
            yield _sse_frame(EVENT_DONE, payload)
    finally:
        await pipeline.aclose()


async def _save_platform_message(session: Any, content: str) -> None:
    """把助手最终答案写回平台会话，供多轮续聊；失败仅告警不影响流。"""
    if not content:
        return
    try:
        await get_session_manager().add_message(
            session_id=session.session_id,
            role="assistant",
            content=content,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to save platform session message", error=str(exc))


# ===== 端点 =====


@router.post("/agents/{agent_id}/chat")
async def agent_chat(
    agent_id: str,
    req: AgentChatRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
    x_tenant_id: str = Header(default="", alias="X-Tenant-Id"),
    x_app_id: str = Header(default="", alias="X-App-Id"),
) -> dict[str, Any]:
    """受 MIS RS256 保护的 Agent 非流式对话端点（供 BFF 适配层调用）。

    当目标为 ``mis-rag``（或 ``metadata.capability == "rag"``）且 KB 问答开关开启时，
    走 :func:`_run_kb_qa` 的知识库增强管线；其余 Agent 保持原有通用流程零改动。
    """
    try:
        session_manager: SessionManager = get_session_manager()
        agent_manager: AgentManager = get_agent_manager()
        user_id: str = current_user.get("user_id", "mis-user")
        channel: str = current_user.get("channel", "mis_bff")

        # T03 S9：MIS RS256 身份 → profile["mis_user_id"]（档 1），在创建点解析并落会话。
        session = await session_manager.create_session(
            agent_id=agent_id,
            user_id=user_id,
            channel=channel,
            mis_user_id=await resolve_mis_user_id_with_db(current_user),
        )
        instance = await agent_manager.ensure_agent_ready(agent_id)

        # T4：移除 KbQaPipeline 预检索编排。mis-rag 通过内部 kb_retrieve 工具自行
        # 检索（与 Copilot B 路径同一执行体），故两路统一为把**原始问题**直接交给
        # mis-rag 的 process_message。is_kb_qa_request 仍作为路由信号保留
        # （仅选 mis-rag，不再触发预检索）。
        if is_kb_qa_request(agent_id, req.metadata):
            logger.info(
                "KB QA routed via mis-rag native kb_retrieve (no pre-retrieval)",
                agent_id=agent_id,
                trace_id=trace_id,
            )
        response_text, runtime_error, tool_errors = await _collect_agent_response(
            instance,
            session,
            Message(role=req.role, content=req.content, metadata=req.metadata),
        )

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
    authorization: str = Header(default=""),
    x_tenant_id: str = Header(default="", alias="X-Tenant-Id"),
    x_app_id: str = Header(default="", alias="X-App-Id"),
) -> StreamingResponse:
    """受 MIS RS256 保护的 Agent SSE 流式对话端点（供 BFF 适配层调用）。

    当目标为 ``mis-rag``（或 ``metadata.capability == "rag"``）且 KB 问答开关开启时，
    走 :func:`_stream_kb_qa` 的知识库增强流式管线（F-01）；其余 Agent 保持原有通用流程。

    事件契约（与 BFF / 前端 ``ai-sse-client.ts`` 一致）：
    - ``event: delta`` → 通用 ``{ traceId, delta }``；KB 分支额外带同值 ``text``
    - ``event: done``  → 通用 ``{ traceId, finishReason, sessionId }``；
      KB 分支 ``sessionId`` 为 **mis-kb 业务会话 ID（数值）**，
      平台会话 UUID 另置于 ``platformSessionId``，并附 ``messageId`` / ``citations``
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

            # T03 S9：与非流式分支同源，创建点解析一次 MIS userId 后全链透传。
            session = await session_manager.create_session(
                agent_id=agent_id,
                user_id=user_id,
                channel=channel,
                mis_user_id=await resolve_mis_user_id_with_db(current_user),
            )
            session_id = session.session_id
            instance = await agent_manager.ensure_agent_ready(agent_id)

            # T4：移除 KbQaPipeline 预检索编排，原始问题直接交给 mis-rag 的
            # process_message（与 Copilot B 路径同一执行体）；mis-rag 自行检索。
            if is_kb_qa_request(agent_id, req.metadata):
                logger.info(
                    "KB QA stream routed via mis-rag native kb_retrieve (no pre-retrieval)",
                    agent_id=agent_id,
                    trace_id=trace_id,
                )
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
            done_payload: dict[str, Any] = {
                "traceId": trace_id,
                "finishReason": "stop",
                "sessionId": session_id,
            }
            # 通道 B（DISPATCH_TRACE_SSE_ENABLED，默认关）：在 done 帧尾部追加
            # dispatchTrace。开关关闭时 payload 与改动前**逐字节一致**，
            # 既有 BFF / 前端契约零影响（design-impl.md §4.4 / §7.5）。
            if dispatch_trace_sse_enabled():
                dispatch_trace: list[dict[str, Any]] = await take_last_turn_traces(
                    session_id
                )
                if dispatch_trace:
                    done_payload["dispatchTrace"] = dispatch_trace
            yield _sse_frame("done", done_payload)
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
