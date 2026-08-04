"""KbClient — mis-kb 内部端点的异步 HTTP 客户端（T10）。

按 §13 第 1/2 项裁定，``mis-rag`` 内部完成问答编排：带**用户 JWT** 调 mis-kb
内部端点解析可见库、检索片段，生成答案后再回调 mis-kb 落库
``session`` / ``message`` / ``citation``。ACL 与审计一律留在 Java 侧，
mis-rag **不直连业务库**。

覆盖端点（``com.mis.kb.api.controller.QaInternalController``）：
- ``GET  /internal/v1/kb/rag/resolve-visible``  — 解析用户可见知识库 ID
- ``POST /internal/v1/kb/rag/retrieve``         — 可见范围内检索
- ``POST /internal/v1/kb/qa/sessions``          — 创建问答会话
- ``POST /internal/v1/kb/qa/messages``          — 追加问答消息
- ``POST /internal/v1/kb/qa/citations/batch``   — 批量落库引用

响应统一为 MIS ``Result`` 信封 ``{"code":0,"data":...,"message":...}``，
``code != 0`` 视为业务失败并抛 :class:`KbClientError`。

透传头（与 BFF→mis-kb 同一套，见设计文档 §12 约定表）：
``Authorization`` / ``X-User-Id`` / ``X-Tenant-Id`` / ``X-App-Id`` / ``X-Trace-Id``。
"""

from __future__ import annotations
from typing import Any

from dataclasses import dataclass, field

import httpx

from src.config import get_settings
from src.models.retrieve import CitationItem, RetrieveHits, VisibleLibraries
from src.utils.logging import get_logger

logger = get_logger("adapters.kb_client")

# ===== 端点常量（与 Java QaInternalController 一一对应）=====
RESOLVE_VISIBLE_PATH = "/internal/v1/kb/rag/resolve-visible"
RETRIEVE_PATH = "/internal/v1/kb/rag/retrieve"
QA_SESSIONS_PATH = "/internal/v1/kb/qa/sessions"
QA_MESSAGES_PATH = "/internal/v1/kb/qa/messages"
QA_CITATIONS_BATCH_PATH = "/internal/v1/kb/qa/citations/batch"

# 日志脱敏的敏感头
_SENSITIVE_HEADERS = {"Authorization"}


class KbClientError(RuntimeError):
    """mis-kb 内部端点调用异常（网络失败、非 JSON、业务 code != 0）。"""


@dataclass
class KbCallContext:
    """一次 KB 调用的身份与追踪上下文。

    Attributes:
        user_id: MIS 用户 ID（JWT ``sub``）；落库与可见性计算的主键。
        tenant_id: 租户 ID（P0 不启用多租户，允许为 ``None``）。
        app_id: 应用 ID（知识 APP 的 ``SysApp.id``，用于会话归属）。
        authorization: 完整的 ``Bearer <token>`` 头值（用户 JWT，优先透传）。
        trace_id: 链路追踪 ID，贯穿 BFF → ai-platform → mis-kb。
        extra_headers: 额外透传头（如 ``X-Employee-Id`` / ``X-Username``）。
    """

    user_id: int | None = None
    tenant_id: int | None = None
    app_id: int | None = None
    authorization: str = ""
    trace_id: str = ""
    extra_headers: dict[str, str] = field(default_factory=dict)


class KbClient:
    """mis-kb 内部端点异步客户端。

    默认从全局 ``Settings`` 读取 ``MIS_KB_BASE_URL`` 与 ``MIS_KB_TIMEOUT_SECONDS``；
    当调用方未携带用户 JWT 时，回退到服务账号令牌 ``MIS_KB_AGENT_TOKEN``。
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: float | None = None,
        agent_token: str | None = None,
    ) -> None:
        """初始化客户端。

        Args:
            base_url: mis-kb 基址（缺省取 ``MIS_KB_BASE_URL``）。
            timeout: 请求超时（秒，缺省取 ``MIS_KB_TIMEOUT_SECONDS``）。
            agent_token: 内部服务账号 JWT（缺省取 ``MIS_KB_AGENT_TOKEN``）。
        """
        settings = get_settings()
        self._base_url: str = (base_url or settings.MIS_KB_BASE_URL).rstrip("/")
        self._timeout: float = (
            timeout if timeout is not None else float(settings.MIS_KB_TIMEOUT_SECONDS)
        )
        self._agent_token: str = (
            agent_token if agent_token is not None else settings.MIS_KB_AGENT_TOKEN
        )
        self._client: httpx.AsyncClient = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
        )

    async def aclose(self) -> None:
        """关闭底层 httpx 客户端，释放连接池。"""
        await self._client.aclose()

    async def __aenter__(self) -> KbClient:
        """支持 ``async with KbClient() as kb:`` 用法。"""
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        """退出上下文时自动关闭连接。"""
        await self.aclose()

    # ================================================================ 检索侧

    async def resolve_visible_libraries(self, ctx: KbCallContext) -> VisibleLibraries:
        """解析当前用户可见的知识库 ID 列表。

        Args:
            ctx: 身份与追踪上下文；``user_id`` 为空时由 mis-kb 回退读 ``X-User-Id``。

        Returns:
            :class:`VisibleLibraries`；用户无任何可见库时返回空列表。

        Raises:
            KbClientError: 网络失败或 mis-kb 返回 ``code != 0``。
        """
        params = self._identity_params(ctx)
        data = await self._request("GET", RESOLVE_VISIBLE_PATH, ctx, params=params)
        result = VisibleLibraries.from_api(data if isinstance(data, dict) else None)
        logger.info(
            "KB visible libraries resolved",
            user_id=ctx.user_id,
            count=len(result.library_ids),
            trace_id=ctx.trace_id,
        )
        return result

    async def retrieve(
        self,
        ctx: KbCallContext,
        *,
        question: str,
        library_ids: list[int] | None = None,
        top_k: int | None = None,
        threshold: float | None = None,
    ) -> RetrieveHits:
        """在用户可见范围内检索片段。

        Args:
            ctx: 身份与追踪上下文。
            question: 用户问题原文。
            library_ids: 前端收敛的库范围；``None``/空表示全部可见库。
                最终范围仍由 mis-kb 二次裁定（不可见库会被剔除）。
            top_k: 召回条数。
            threshold: 相关性阈值（0~1）。

        Returns:
            :class:`RetrieveHits`；无 RAGFlow 实例（NoopAdapter）时为空集合。

        Raises:
            KbClientError: 网络失败或 mis-kb 返回 ``code != 0``。
        """
        payload: dict[str, Any] = {"question": question}
        if library_ids:
            payload["libraryIds"] = library_ids
        if top_k is not None:
            payload["topK"] = top_k
        if threshold is not None:
            payload["threshold"] = threshold

        params = self._identity_params(ctx)
        data = await self._request(
            "POST", RETRIEVE_PATH, ctx, params=params, payload=payload
        )
        hits = RetrieveHits.from_api(data if isinstance(data, dict) else None)
        logger.info(
            "KB retrieve done",
            user_id=ctx.user_id,
            hit_count=len(hits.hits),
            top_k=top_k,
            trace_id=ctx.trace_id,
        )
        return hits

    # ================================================================ 落库侧

    async def create_session(
        self,
        ctx: KbCallContext,
        *,
        user_id: int | None = None,
        app_id: int | None = None,
    ) -> int | None:
        """创建问答会话。

        Args:
            ctx: 身份与追踪上下文。
            user_id: 会话归属用户；缺省取 ``ctx.user_id``。
            app_id: 会话归属应用；缺省取 ``ctx.app_id``。

        Returns:
            新建会话 ID；``user_id`` 缺失导致无法落库时返回 ``None``。

        Raises:
            KbClientError: 网络失败或 mis-kb 返回 ``code != 0``。
        """
        effective_user = user_id if user_id is not None else ctx.user_id
        if effective_user is None:
            logger.warning("Skip KB session create: user_id missing", trace_id=ctx.trace_id)
            return None
        payload: dict[str, Any] = {
            "userId": effective_user,
            "appId": app_id if app_id is not None else ctx.app_id,
        }
        data = await self._request("POST", QA_SESSIONS_PATH, ctx, payload=payload)
        session_id = self._pick_int(data, "sessionId")
        logger.info("KB session created", session_id=session_id, trace_id=ctx.trace_id)
        return session_id

    async def append_message(
        self,
        ctx: KbCallContext,
        *,
        session_id: int,
        role: str,
        content: str,
    ) -> int | None:
        """向会话追加一条消息。

        Args:
            ctx: 身份与追踪上下文。
            session_id: 目标会话 ID。
            role: 消息角色（``user`` / ``assistant``，对齐 Java ``QaRole``）。
            content: 消息正文；空串会被规约为单空格以通过 ``@NotBlank`` 校验。

        Returns:
            新建消息 ID；失败时抛异常而非返回 ``None``。

        Raises:
            KbClientError: 网络失败或 mis-kb 返回 ``code != 0``。
        """
        payload: dict[str, Any] = {
            "sessionId": session_id,
            "role": role,
            "content": content if content.strip() else " ",
        }
        data = await self._request("POST", QA_MESSAGES_PATH, ctx, payload=payload)
        message_id = self._pick_int(data, "messageId")
        logger.debug(
            "KB message appended",
            session_id=session_id,
            role=role,
            message_id=message_id,
            trace_id=ctx.trace_id,
        )
        return message_id

    async def save_citations(
        self,
        ctx: KbCallContext,
        *,
        message_id: int,
        citations: list[CitationItem],
    ) -> int:
        """批量落库某条助手消息的引用。

        仅提交 ``libraryId``/``documentId`` 均非空的引用项（mis-kb 侧为 ``@NotNull``）。

        Args:
            ctx: 身份与追踪上下文。
            message_id: 归属的助手消息 ID。
            citations: 待落库引用项列表。

        Returns:
            实际落库条数；无合法引用时返回 ``0`` 且不发起请求。

        Raises:
            KbClientError: 网络失败或 mis-kb 返回 ``code != 0``。
        """
        persistable = [c for c in citations if c.is_persistable()]
        if not persistable:
            return 0
        payload: dict[str, Any] = {
            "messageId": message_id,
            "citations": [c.to_api() for c in persistable],
        }
        data = await self._request("POST", QA_CITATIONS_BATCH_PATH, ctx, payload=payload)
        saved = data if isinstance(data, int) else len(persistable)
        logger.debug(
            "KB citations saved",
            message_id=message_id,
            saved=saved,
            trace_id=ctx.trace_id,
        )
        return int(saved)

    # ================================================================ 内部工具

    def _identity_params(self, ctx: KbCallContext) -> dict[str, Any]:
        """构造 ``userId``/``tenantId`` 查询参数（供 mis-kb 以服务身份代查）。"""
        params: dict[str, Any] = {}
        if ctx.user_id is not None:
            params["userId"] = ctx.user_id
        if ctx.tenant_id is not None:
            params["tenantId"] = ctx.tenant_id
        return params

    def _headers(self, ctx: KbCallContext) -> dict[str, str]:
        """构造透传头。

        优先透传用户 JWT（``ctx.authorization``）；缺失时回退服务账号
        ``MIS_KB_AGENT_TOKEN``。两者皆无则不带 ``Authorization``，
        由 mis-kb / Gateway 侧按内部端点策略裁定。
        """
        headers: dict[str, str] = {"Accept": "application/json"}

        auth = (ctx.authorization or "").strip()
        if not auth and self._agent_token:
            token = self._agent_token.strip()
            auth = token if token.lower().startswith("bearer ") else f"Bearer {token}"
        if auth:
            headers["Authorization"] = auth

        if ctx.user_id is not None:
            headers["X-User-Id"] = str(ctx.user_id)
        if ctx.tenant_id is not None:
            headers["X-Tenant-Id"] = str(ctx.tenant_id)
        if ctx.app_id is not None:
            headers["X-App-Id"] = str(ctx.app_id)
        if ctx.trace_id:
            headers["X-Trace-Id"] = ctx.trace_id
        for key, value in ctx.extra_headers.items():
            if value:
                headers[key] = value
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        ctx: KbCallContext,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        """发起请求并 unwrap ``Result`` 信封。

        Args:
            method: HTTP 方法（``GET`` / ``POST``）。
            path: 端点路径（相对 ``base_url``）。
            ctx: 身份与追踪上下文。
            params: 查询参数。
            payload: JSON 请求体（``GET`` 时忽略）。

        Returns:
            ``Result.data`` 的原始值（dict / int / list）。

        Raises:
            KbClientError: 超时、网络错误、5xx、非 JSON 响应或 ``code != 0``。
        """
        headers = self._headers(ctx)
        safe_headers = {
            k: ("<redacted>" if k in _SENSITIVE_HEADERS else v) for k, v in headers.items()
        }
        logger.debug("KB request", method=method, path=path, headers=safe_headers)

        try:
            if method.upper() == "GET":
                resp = await self._client.get(path, params=params, headers=headers)
            else:
                resp = await self._client.post(
                    path, params=params, json=payload or {}, headers=headers
                )
        except httpx.TimeoutException as exc:
            raise KbClientError(f"mis-kb 调用超时: {path}") from exc
        except httpx.HTTPError as exc:
            raise KbClientError(f"mis-kb 调用失败: {path} -> {exc}") from exc

        if resp.status_code >= 500:
            raise KbClientError(f"mis-kb 服务端错误 {resp.status_code}: {path}")
        if resp.status_code in (401, 403):
            raise KbClientError(f"mis-kb 鉴权失败 {resp.status_code}: {path}")

        try:
            body: Any = resp.json()
        except ValueError as exc:
            raise KbClientError(
                f"mis-kb 响应非 JSON (status={resp.status_code}): {resp.text[:500]}"
            ) from exc

        # unwrap Result 信封 {"code":0,"data":...}；code != 0 一律视为业务失败
        if isinstance(body, dict) and "code" in body:
            code = body.get("code", 0)
            if code != 0:
                raise KbClientError(
                    f"mis-kb 业务错误 code={code} message={body.get('message')} path={path}"
                )
            return body.get("data")
        return body

    @staticmethod
    def _pick_int(data: Any, key: str) -> int | None:
        """从 ``Result.data`` 中提取整型字段；兼容 data 直接为数值的情形。"""
        if isinstance(data, dict):
            raw = data.get(key)
        else:
            raw = data
        if raw is None or isinstance(raw, bool):
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
