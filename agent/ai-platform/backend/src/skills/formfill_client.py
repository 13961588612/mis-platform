"""FormFillClient — 反向调用 mis-admin-bff 的 AI Skill 接口。

封装两个端点（设计 §4 / mis-admin-bff AiProxyController）：
- POST /api/v1/ai/skill/execute  → SkillExecuteResponse
- POST /api/v1/ai/skill/apply     → SkillApplyResponse

响应统一包裹在 Result 信封：{"code":0,"data":{...}}，需 unwrap .data。
所有请求携带 reverse_trust 头（见 reverse_trust.build_reverse_trust_headers）。
"""
from __future__ import annotations
from typing import Any

import httpx

from src.config import get_settings
from src.skills.reverse_trust import build_reverse_trust_headers
from src.utils.logging import get_logger

logger = get_logger("skills.formfill_client")

SKILL_EXECUTE_PATH = "/api/v1/ai/skill/execute"
SKILL_APPLY_PATH = "/api/v1/ai/skill/apply"

# 日志脱敏的敏感头
_SENSITIVE_HEADERS = {"X-Platform-Token", "X-Mis-Upstream-Jwt"}


class FormFillClientError(RuntimeError):
    """FormFill 调用异常。"""


class FormFillClient:
    """mis-admin-bff AI Skill 反向 HTTP 客户端。"""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: float | None = None,
    ) -> None:
        """初始化客户端。

        Args:
            base_url: BFF 基址（缺省取 ``MIS_ADMIN_BFF_BASE_URL``）。
            timeout: 请求超时（秒），缺省取 ``MCP_TOOL_CALL_TIMEOUT``。
        """
        settings = get_settings()
        self._base_url = (base_url or settings.MIS_ADMIN_BFF_BASE_URL).rstrip("/")
        self._timeout = timeout or float(settings.MCP_TOOL_CALL_TIMEOUT)
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout)

    async def aclose(self) -> None:
        """关闭底层 httpx 客户端。"""
        await self._client.aclose()

    async def execute_skill(
        self,
        *,
        skill_id: str,
        session_id: str,
        user_input: str = "",
        context: dict[str, Any] | None = None,
        conversation_id: str | None = None,
        session: Any | None = None,
        identity: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """调用 /execute，返回 unwrap 后的 SkillExecuteResponse(dict)。

        Args:
            skill_id: MIS FormFill 引擎 Skill ID（如 user-fill）。
            session_id: agent 会话 ID（仅用于本地日志/追踪，不再进入请求体；
                Java 契约 SkillExecuteRequest 无 sessionId 字段）。
            user_input: 触发填充的自然语言输入。
            context: 业务上下文，直接放到顶层 ``pageContext`` 键（含 docType/
                docId 及内层表单上下文 pageContext）。Java 契约仅认顶层
                pageContext，不认 context/sessionId/conversationId。
            conversation_id: 与 resumeToken 绑定的会话 ID（可选；Java 契约无此
                字段，故不再进入请求体，保留参数以兼容调用方）。
            session: 当前会话对象（注入反向信任头）。
            identity: 平台身份（注入反向信任头）。

        Returns:
            SkillExecuteResponse 字典（已 unwrap .data）。
        """
        # 契约对齐：mis-admin-bff SkillExecuteRequest 仅含
        # skillId / userInput / pageContext(顶层) / resumeToken / selectedCandidate，
        # 无 sessionId / conversationId。业务上下文必须放在顶层 pageContext，
        # 否则引擎拿到的 pageContext 为空，实体解析（如按 orgId 限定候选范围）
        # 会退化。
        payload: dict[str, Any] = {
            "skillId": skill_id,
            "userInput": user_input,
            "pageContext": context or {},
        }
        headers = await build_reverse_trust_headers(session=session, identity=identity)
        return await self._post(SKILL_EXECUTE_PATH, payload, headers)

    async def apply_skill(
        self,
        *,
        skill_id: str,
        doc_type: str,
        doc_id: str,
        values: dict[str, Any],
        session: Any | None = None,
        identity: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """调用 /apply，返回 unwrap 后的 SkillApplyResponse(dict)。

        Args:
            skill_id: MIS FormFill Skill ID。
            doc_type: 目标单据类型（如 purchase-order）。
            doc_id: 目标单据 ID。
            values: 要写回的字段值映射 {field: value}。
            session: 当前会话对象（注入反向信任头）。
            identity: 平台身份（注入反向信任头）。

        Returns:
            SkillApplyResponse 字典（已 unwrap .data）。
        """
        payload: dict[str, Any] = {
            "skillId": skill_id,
            "docType": doc_type,
            "docId": doc_id,
            "values": values,
        }
        headers = await build_reverse_trust_headers(session=session, identity=identity)
        return await self._post(SKILL_APPLY_PATH, payload, headers)

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        headers: dict[str, str],
    ) -> dict[str, Any]:
        """POST JSON 并 unwrap Result 信封；网络/业务错误转为 FormFillClientError。"""
        safe_headers = {
            k: ("<redacted>" if k in _SENSITIVE_HEADERS else v) for k, v in headers.items()
        }
        logger.info(
            "FormFill POST",
            path=path,
            skill_id=payload.get("skillId"),
            session_id=payload.get("sessionId"),
            doc_type=payload.get("docType"),
            headers=safe_headers,
        )
        try:
            resp = await self._client.post(path, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise FormFillClientError(f"FormFill 调用超时: {path}") from exc
        except httpx.HTTPError as exc:
            raise FormFillClientError(f"FormFill 调用失败: {path} -> {exc}") from exc

        if resp.status_code >= 500:
            raise FormFillClientError(
                f"FormFill BFF 服务端错误 {resp.status_code}: {path}"
            )

        try:
            body: Any = resp.json()
        except ValueError as exc:
            raise FormFillClientError(
                f"FormFill 响应非 JSON (status={resp.status_code}): {resp.text[:500]}"
            ) from exc

        # unwrap Result 信封 {"code":0,"data":{...}}；业务错误 code!=0 一律抛错
        # （无论 data 是否存在，避免非标准错误响应被误判为成功）。
        if isinstance(body, dict) and "code" in body:
            code = body.get("code", 0)
            if code != 0:
                raise FormFillClientError(
                    f"FormFill 业务错误 code={code} message={body.get('message')}"
                )
            return body.get("data", body)

        # 部分实现可能直接返回 data；兜底返回原 body
        return body
