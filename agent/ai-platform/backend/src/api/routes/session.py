"""Session API 路由 — 会话生命周期和消息处理。

运行时端点（既有）：
- POST   /api/v1/sessions                 — 创建新会话
- GET    /api/v1/sessions/{session_id}    — 获取会话详情
- DELETE /api/v1/sessions/{session_id}    — 关闭 / 删除会话
- POST   /api/v1/sessions/{session_id}/messages — 发送消息（非流式）
- GET    /api/v1/sessions/{session_id}/messages — 获取会话消息
- POST   /api/v1/sessions/route           — 路由请求（AgentRouter）

运营端点（T04 #27–#31，本次新增）：
- GET    /api/v1/sessions                 — #27 会话列表（分页 + 过滤）
- POST   /api/v1/sessions/batch-delete    — #31 批量删除会话

读路径一律走 PostgreSQL（``agent_session`` / ``agent_session_message``）：
Redis 没有分页 / 范围过滤能力，``KEYS`` 扫描在生产是禁用项。
PG 查不到时会自动回落 Redis，保证「刚建的会话点不开详情」不会发生。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


from fastapi import APIRouter, Depends, Header, Query, status
from pydantic import BaseModel, Field

from src.agent.manager import AgentInstance
from src.agent.session import SessionManager
from src.agent.session_store import (
    WIRE_CHANNELS,
    MessagePage,
    SessionListQuery,
    SessionPage,
)
from src.api.deps import (
    get_agent_manager_dep,
    get_agent_router_dep,
    get_current_user,
    get_optional_current_user,
    get_session_manager_dep,
    get_trace_id,
    resolve_request_mis_user_id,
)
from src.api.response import error_response, success
from src.router.agent_router import AgentRouter
from src.router.models import RouteResult, UserRequest
from src.utils.exceptions import AgentNotFoundError, SessionNotFoundError
from src.utils.logging import get_logger

logger = get_logger("api.routes.session")

router = APIRouter(prefix="/sessions", tags=["sessions"])

#: 列表接口单页上限。防止前端传 page_size=100000 把 PG 拖死。
MAX_PAGE_SIZE: int = 200

#: 单次批量删除的会话数上限。
MAX_BATCH_DELETE: int = 200


def _parse_iso_datetime(value: str | None, field_name: str) -> datetime | None:
    """把前端传来的 ISO 时间串解析成带时区的 datetime。

    前端用 ``Date.toISOString()`` 生成，形如 ``2025-07-01T00:00:00.000Z``。
    Python 3.10 的 ``fromisoformat`` 不认结尾的 ``Z``，这里统一换成 ``+00:00``；
    解析出来还是 naive 的（前端也可能传不带时区的本地串）就补 UTC，
    否则和 ``TIMESTAMPTZ`` 列比较时会被按服务器时区解释，产生 8 小时偏移。

    Args:
        value: ISO 时间字符串，可能为 ``None`` 或空串。
        field_name: 字段名，用于报错信息。

    Returns:
        带时区的 datetime；入参为空时返回 ``None``。

    Raises:
        ValueError: 字符串无法解析为时间。
    """
    if value is None:
        return None
    text: str = value.strip()
    if not text:
        return None
    normalized: str = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed: datetime = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"Invalid datetime for '{field_name}': {value}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


class BatchDeleteSessionsRequest(BaseModel):
    """#31 批量删除会话的请求体。

    字段名 ``ids`` 与前端 ``batchDeleteSessions`` 的 ``{ ids }`` 一致。
    """

    ids: list[str] = Field(default_factory=list, description="待删除的 session_id 列表")


# ===== 请求/响应模型 =====


class CreateSessionRequest(BaseModel):
    """创建新会话的请求体。"""

    agent_id: str = Field(..., description="绑定到此会话的 Agent ID")
    user_id: str = Field(..., description="用户标识符")
    channel: str = Field(default="web", description="来源渠道：web | wecom_h5 | wecom_bot")
    runtime_type: str = Field(default="openharness")
    user_mobile: str = Field(default="", description="用户手机号（透传至 MCP identity）")
    channel_user_id: str = Field(default="", description="渠道侧 userId（透传至 MCP identity）")


class SendMessageRequest(BaseModel):
    """在会话中发送消息的请求体。"""

    content: str = Field(..., description="消息内容")
    role: str = Field(default="user", description="消息角色：user | system")
    metadata: dict[str, Any] = Field(default_factory=dict)


class RouteRequest(BaseModel):
    """通过 AgentRouter 路由用户请求的请求体。"""

    text: str = Field(..., description="用户输入文本")
    user_id: str = Field(..., description="用户标识符")
    session_id: str = Field(..., description="会话标识符")
    channel: str = Field(default="web")
    department: str = Field(default="")
    metadata: dict[str, Any] = Field(default_factory=dict)


class SessionResponse(BaseModel):
    """会话详情响应（与前端 ``Session`` 契约对齐）。

    ``status`` / ``runtime_type`` 是契约外的附加字段，供运营排障用；
    TypeScript 侧多出的键无害。
    """

    session_id: str
    agent_id: str
    agent_name: str | None = None
    channel: str
    user_id: str | None = None
    user_name: str | None = None
    title: str | None = None
    status: str = "active"
    runtime_type: str | None = None
    message_count: int = 0
    created_at: str
    updated_at: str


class MessageResponse(BaseModel):
    """会话中的一条消息（与前端 ``SessionMessage`` 契约对齐）。

    字段名是 ``timestamp`` / ``metadata``（**不是** ``created_at`` / ``meta``），
    改名会让 ``agent-message-stream.tsx`` 的时间戳与 metadata 展开区直接失效。
    """

    id: str
    session_id: str = ""
    role: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: str


# ===== 运营端点（T04 #27 / #31）=====
#
# 声明顺序有讲究：``POST /batch-delete`` 必须排在任何 ``POST /{...}`` 形式的
# 路由之前，否则 FastAPI 会把字面量 "batch-delete" 当成路径参数吃掉。
# 当前文件里没有 ``POST /{session_id}``，但把它放在最前面能避免后人新增时踩坑。


@router.get("")
async def list_sessions(
    page: int = Query(default=1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(
        default=20, ge=1, le=MAX_PAGE_SIZE, description="每页条数", alias="page_size"
    ),
    agent_id: str | None = Query(default=None, description="按 Agent 过滤"),
    channel: str | None = Query(
        default=None, description="按渠道过滤：web | wecom | api | unknown"
    ),
    user_id: str | None = Query(default=None, description="按用户过滤"),
    keyword: str | None = Query(
        default=None, description="关键字，匹配标题 / session_id / user_id"
    ),
    time_from: str | None = Query(
        default=None, alias="from", description="创建时间下界（ISO 8601）"
    ),
    time_to: str | None = Query(
        default=None, alias="to", description="创建时间上界（ISO 8601）"
    ),
    session_manager: SessionManager = Depends(get_session_manager_dep),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#27 会话列表：分页 + 按 Agent / 渠道 / 用户 / 关键字 / 时间范围过滤。

    数据来自 PostgreSQL ``agent_session``（Redis 无分页与范围查询能力）。
    查询参数名与前端 ``SessionQuery`` 完全一致，其中 ``from`` 是 Python 关键字，
    故用 ``alias`` 映射到 ``time_from``。

    Returns:
        ``AgentPage<Session>`` 形状：``{items, total, page, page_size}``。
    """
    try:
        parsed_from = _parse_iso_datetime(time_from, "from")
        parsed_to = _parse_iso_datetime(time_to, "to")
    except ValueError as exc:
        return error_response(4000, str(exc), status.HTTP_400_BAD_REQUEST)

    normalized_channel: str | None = None
    if channel:
        candidate: str = channel.strip().lower()
        # 'all' 前端本来就不会发；这里再挡一层，避免把它当成真渠道查出空列表。
        if candidate and candidate != "all":
            if candidate not in WIRE_CHANNELS:
                return error_response(
                    4000,
                    f"Unsupported channel: {channel}",
                    status.HTTP_400_BAD_REQUEST,
                )
            normalized_channel = candidate

    query: SessionListQuery = SessionListQuery(
        page=page,
        page_size=page_size,
        agent_id=(agent_id or "").strip() or None,
        channel=normalized_channel,
        user_id=(user_id or "").strip() or None,
        keyword=(keyword or "").strip() or None,
        time_from=parsed_from,
        time_to=parsed_to,
    )

    try:
        result: SessionPage = await session_manager.list_sessions(query)
        return success(data=result.to_wire())
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to list sessions", error=str(exc))
        return error_response(9001, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post("/batch-delete")
async def batch_delete_sessions(
    req: BatchDeleteSessionsRequest,
    session_manager: SessionManager = Depends(get_session_manager_dep),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#31 批量删除会话（PG 软删除 + Redis 热数据清理）。

    去重后执行，返回实际删除条数。请求里含不存在的 ID **不算错误**——
    批量删除的语义是「让这些 ID 消失」，已经不在了就是达成目标；
    为个别脏 ID 整批失败只会让运营反复重试。

    Returns:
        ``{"deleted": <实际软删除行数>, "requested": <去重后请求条数>}``。
    """
    unique_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in req.ids:
        candidate: str = (raw_id or "").strip()
        if candidate and candidate not in seen:
            seen.add(candidate)
            unique_ids.append(candidate)

    if not unique_ids:
        return error_response(4000, "ids must not be empty", status.HTTP_400_BAD_REQUEST)
    if len(unique_ids) > MAX_BATCH_DELETE:
        return error_response(
            4000,
            f"Too many ids: {len(unique_ids)} > {MAX_BATCH_DELETE}",
            status.HTTP_400_BAD_REQUEST,
        )

    try:
        deleted: int = await session_manager.delete_sessions(unique_ids)
        return success(
            data={"deleted": deleted, "requested": len(unique_ids)},
            message="Sessions deleted",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to batch delete sessions", error=str(exc))
        return error_response(9001, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


# ===== 端点 =====


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_session(
    req: CreateSessionRequest,
    session_manager: SessionManager = Depends(get_session_manager_dep),
    mis_user_id: int | None = Depends(resolve_request_mis_user_id),
) -> dict[str, Any]:
    """创建带有渠道特定 ID 命名的新聊天会话。

    T03 S9：在此创建点解析一次 MIS userId 并写入会话，后续全链透传；
    解析不出（``None``）不阻断建会话，但下游 E1–E5 会 fail-closed 拒绝执行。
    """
    try:
        session: dict[str, Any] = await session_manager.create_session(
            agent_id=req.agent_id,
            user_id=req.user_id,
            channel=req.channel,
            runtime_type=req.runtime_type,
            user_mobile=req.user_mobile,
            channel_user_id=req.channel_user_id,
            mis_user_id=mis_user_id,
        )
        return success(
            data={
                "session_id": session.session_id,
                "agent_id": session.agent_id,
                "user_id": session.user_id,
                "channel": session.channel,
                "runtime_type": session.runtime_type,
            },
            message="Session created",
        )
    except Exception as exc:
        logger.error("Failed to create session", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    session_manager: SessionManager = Depends(get_session_manager_dep),
) -> dict[str, Any]:
    """#28 获取会话详情（PG 优先，Redis 兜底）。

    返回的字段集与 #27 列表项**完全一致**，前端详情抽屉才能直接复用列表行做兜底
    （``fallbackSession``）。PG 查不到时回落 Redis 现场拼装，保证「刚创建的会话
    点不开详情」不会发生。

    Returns:
        前端 ``Session`` 契约的对象。
    """
    try:
        record: dict[str, Any] | None = await session_manager.get_session_record(session_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get session", error=str(exc), session_id=session_id)
        return error_response(9001, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)

    if record is None:
        return error_response(
            9000, f"Session not found: {session_id}", status.HTTP_404_NOT_FOUND
        )
    return success(data=record)


@router.delete("/{session_id}")
async def close_session(
    session_id: str,
    session_manager: SessionManager = Depends(get_session_manager_dep),
) -> dict[str, Any]:
    """#30 删除会话：PG 软删除（``deleted_at`` 置位）+ Redis 热数据清理。

    ⚠ 语义变更说明：改造前这里只做「关闭」（删 Redis key）。#30 在运营控制台的
    语义是**删除**，会话必须从列表里消失，因此现在会同时把 PG 记录软删除。
    选软删除而不是物理删除，是为了保留审计追溯——误点删除按钮不该让消息永久蒸发。

    删除不存在的会话返回成功（幂等）：目标状态「这个会话不在了」已经达成。
    """
    try:
        deleted: int = await session_manager.delete_sessions([session_id])
        return success(data={"deleted": deleted}, message="Session deleted")
    except SessionNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to delete session", error=str(exc), session_id=session_id)
        return error_response(9001, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/{session_id}/messages")
async def get_messages(
    session_id: str,
    page: int = Query(default=1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(
        default=MAX_PAGE_SIZE, ge=1, le=1000, description="每页条数"
    ),
    session_manager: SessionManager = Depends(get_session_manager_dep),
) -> dict[str, Any]:
    """#29 获取会话消息（PG 优先，Redis 兜底）。

    ⚠ 返回的是**扁平数组**而非分页对象：前端 ``listSessionMessages`` 的签名是
    ``Promise<SessionMessage[]>``，套一层 ``{items,...}`` 会让详情抽屉直接崩。
    ``page`` / ``page_size`` 仍然保留，供超长会话按需截取，默认一次给到
    ``MAX_PAGE_SIZE`` 条，覆盖绝大多数会话。

    Returns:
        ``SessionMessage[]``：每项含 ``id / session_id / role / content /
        timestamp / metadata``。
    """
    try:
        result: MessagePage = await session_manager.list_session_messages(
            session_id, page=page, page_size=page_size
        )
        messages: list[dict[str, Any]] = [
            MessageResponse(
                id=str(item.get("id") or ""),
                session_id=str(item.get("session_id") or session_id),
                role=str(item.get("role") or "unknown"),
                content=str(item.get("content") or ""),
                metadata=dict(item.get("metadata") or {}),
                timestamp=str(item.get("timestamp") or ""),
            ).model_dump()
            for item in result.items
        ]
        return success(data=messages)
    except SessionNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to list messages", error=str(exc), session_id=session_id)
        return error_response(9001, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


async def _run_session_kb_qa(
    *,
    session: Any,
    instance: AgentInstance,
    req: SendMessageRequest,
    current_user: dict[str, Any] | None,
    authorization: str,
    tenant_id: str,
    app_id: str,
    trace_id: str,
) -> tuple[str, str | None, list[str]]:
    """运营台本地对话命中 ``mis-rag`` 时走 KB 检索管线。

    与 BFF ``POST /api/v1/agents/mis-rag/chat`` 共用 :class:`KbQaPipeline`，
    差异仅在于回复要整理成可读 Markdown（不要 JSON 信封）。
    """
    from src.adapters.kb_client import KbClientError
    from src.agent.mis_rag import (
        KbQaPipeline,
        KbQaRequest,
        build_kb_call_context,
        format_kb_answer_for_chat,
    )
    from src.agent.session import Message
    from src.config import get_settings
    from src.runtime.events import AgentEventType

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
        nonlocal captured_error, captured_tool_errors
        parts: list[str] = []
        async for event in instance.process_message(
            session=session,
            message=Message(role=req.role, content=prompt, metadata=req.metadata),
        ):
            if event.type == AgentEventType.TEXT_DELTA and event.content:
                parts.append(event.content)
            elif event.type == AgentEventType.TOOL_RESULT and event.result:
                err: Any | None = event.result.get("error")
                if err:
                    captured_tool_errors.append(f"{event.tool_name}: {err}")
            elif event.type == AgentEventType.ERROR:
                captured_error = event.message or "Agent runtime error"
        return "".join(parts)

    pipeline = KbQaPipeline()
    try:
        answer = await pipeline.run(kb_req, ctx, _generate, structured=False)
    except KbClientError as exc:
        logger.warning(
            "KB QA retrieve failed in local chat",
            agent_id=session.agent_id,
            error=str(exc),
            trace_id=trace_id,
        )
        return f"知识库检索失败：{exc}", None, []
    finally:
        await pipeline.aclose()

    return format_kb_answer_for_chat(answer), captured_error, captured_tool_errors


@router.post("/{session_id}/messages")
async def send_message(
    session_id: str,
    req: SendMessageRequest,
    session_manager: SessionManager = Depends(get_session_manager_dep),
    agent_manager=Depends(get_agent_manager_dep),
    current_user: dict[str, Any] | None = Depends(get_optional_current_user),
    authorization: str = Header(default=""),
    x_tenant_id: str = Header(default="", alias="X-Tenant-Id"),
    x_app_id: str = Header(default="", alias="X-App-Id"),
    trace_id: str = Depends(get_trace_id),
) -> dict[str, Any]:
    """
    向会话发送消息并获取非流式响应。

    目标 Agent 为 ``mis-rag`` 时走知识库检索管线（与 ``/ai/rag`` 同源），
    否则保持原有通用 Agent 流程。流式响应请使用 WebSocket 端点。
    """
    try:
        from src.agent.mis_rag import is_kb_qa_request
        from src.agent.session import Message
        from src.runtime.events import AgentEventType

        # 获取会话
        session = await session_manager.get_session(session_id)

        # 添加用户消息
        user_msg: Message = await session_manager.add_message(
            session_id=session_id,
            role=req.role,
            content=req.content,
            metadata=req.metadata,
        )

        # 确保 Agent 已注册并处于 RUNNING（支持启动时未同步的懒加载）
        instance: AgentInstance = await agent_manager.ensure_agent_ready(session.agent_id)

        if is_kb_qa_request(session.agent_id, req.metadata):
            response_text, runtime_error, tool_errors = await _run_session_kb_qa(
                session=session,
                instance=instance,
                req=req,
                current_user=current_user,
                authorization=authorization if isinstance(authorization, str) else "",
                tenant_id=x_tenant_id if isinstance(x_tenant_id, str) else "",
                app_id=x_app_id if isinstance(x_app_id, str) else "",
                trace_id=trace_id if isinstance(trace_id, str) else "",
            )
        else:
            # 收集 runtime 流式事件
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

            response_text = "".join(response_parts)

        # 工具失败已转为 tool.result，不应中断；仅无有效回复时的致命错误返回 500
        if runtime_error and not response_text.strip():
            return error_response(
                9000,
                runtime_error,
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if runtime_error:
            logger.warning(
                "Agent completed with runtime warning",
                session_id=session_id,
                error=runtime_error,
                tool_errors=tool_errors,
            )

        # 保存助手响应
        await session_manager.add_message(
            session_id=session_id,
            role="assistant",
            content=response_text,
        )

        return success(
            data={
                "message_id": user_msg.id,
                "response": response_text,
                "session_id": session_id,
                "warnings": [runtime_error] if runtime_error else [],
                "tool_errors": tool_errors,
            },
            message="Message processed",
        )
    except SessionNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except Exception as exc:
        logger.error("Failed to process message", error=str(exc), session_id=session_id)
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post("/route")
async def route_request(
    req: RouteRequest,
    agent_router: AgentRouter = Depends(get_agent_router_dep),
) -> dict[str, Any]:
    """
    通过 AgentRouter 策略链路由用户请求。

    返回匹配的 agent_id、使用的策略和置信度分数。
    不处理消息——请使用 /sessions/{id}/messages 处理消息。
    """
    try:
        user_request: UserRequest = UserRequest(
            text=req.text,
            user_id=req.user_id,
            session_id=req.session_id,
            channel=req.channel,
            department=req.department,
            metadata=req.metadata,
        )

        result: RouteResult = await agent_router.route(user_request)

        return success(
            data={
                "agent_id": result.agent_id,
                "strategy_used": result.strategy_used,
                "confidence": result.confidence,
                "latency_ms": result.latency_ms,
                "metadata": result.metadata,
            },
            message="Route completed",
        )
    except Exception as exc:
        logger.error("Routing failed", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)
