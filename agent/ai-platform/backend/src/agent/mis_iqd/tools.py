"""mis-iqd Worker 工具面（v1.9 / B2）。

- ``iqd__ask``：只读问数（范围裁定 → 编排 → 审计 → 投影）；返回 JSON（
  ``IqdAskResponse`` 投影后形态）。
- ``iqd__describe_scope``：只读描述当前身份可问范围（供 LLM 判断是否可答）。

与 :class:`KbRetrieveTool` 同范式：由 ``tool_registry_builder`` 注册，mis-iqd
``runtime.yaml`` 的 ``allowed_tools=[iqd__ask, iqd__describe_scope]`` 显式放行后
对 Worker LLM 可见。身份经 ``context.metadata`` 透传（T03 S9 第五键
``misUserId`` + ``X-Mis-Roles`` 等头）。

降级铁律（NFR-2）：``iqd__ask`` 工具失败时如实返回 452xx 错误 JSON，**禁止**基于
记忆/常识编造数据；``system.md`` 已显式声明。
"""

from __future__ import annotations

from typing import Any

import json

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.agent.mis_iqd.errors import IqdError
from src.agent.mis_iqd.projector import compact_ask_payload_for_llm
from src.agent.mis_iqd.scope_resolver import AskIdentity
from src.agent.mis_iqd.service import IqdAskService
from src.models.iqd_schema import AskRequest, VIEW_USER
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.tools")

#: 工具名（runtime.yaml allowed_tools 必须一致）
TOOL_IQD_ASK = "iqd__ask"
TOOL_IQD_DESCRIBE_SCOPE = "iqd__describe_scope"


def _build_identity(metadata: dict[str, Any] | None) -> AskIdentity:
    """从工具执行上下文 metadata 构造问数身份。

    身份优先取自 ``metadata["identity"]``（T03 S9 第五键 ``misUserId``），
    ``X-Mis-Roles/Depts/Stores/Orgs`` 从 metadata 顶层或 identity 内嵌读取。

    B6 模拟角色（后台测试页）：``metadata.iqd.simulate_role_code`` 有值则覆写
    身份 role_codes（模拟该角色的数据范围裁定），**保留真实 user_id 不变**；
    无值则走真实身份（现有逻辑不变）。

    安全约束（不放大权限）：模拟只允许降权/等权——若模拟角色权限 ⊄ 真实用户权限，
    按真实用户权限收紧（由 :meth:`ScopeResolver.resolve_effective` 求交实现）。
    """
    meta = metadata or {}
    nested = meta.get("identity") if isinstance(meta.get("identity"), dict) else {}

    def _first(*keys: str) -> Any:
        for key in keys:
            if nested.get(key) is not None:
                return nested.get(key)
            if meta.get(key) is not None:
                return meta.get(key)
        return None

    headers: dict[str, str] = {}
    for header_key in (
        "X-Mis-Roles",
        "X-Mis-Depts",
        "X-Mis-Dept-Scope",
        "X-Mis-Stores",
        "X-Mis-Orgs",
        "X-Mis-Data-Scope",
        "X-Trace-Id",
        "X-User-Id",
        "X-Employee-Id",
    ):
        value = _first(header_key, header_key.lower())
        if value:
            headers[header_key] = str(value)

    identity = AskIdentity.from_headers(headers)

    # 真实 user_id / employee_id：保留真实身份（模拟时不得被覆写）
    user_id = _first("X-User-Id", "misUserId", "userId", "user_id")
    if user_id is not None:
        parsed_user_id = _coerce_int(user_id)
        identity.user_id = parsed_user_id if parsed_user_id is not None else str(user_id)
    employee_id = _first("X-Employee-Id", "employeeId", "employee_id")
    if employee_id is not None:
        identity.employee_id = str(employee_id)

    # B6 模拟角色：metadata.iqd.simulate_role_code（BFF IqdAskFacadeService 已透传）
    iqd_meta = meta.get("iqd") if isinstance(meta.get("iqd"), dict) else {}
    nested_iqd = nested.get("iqd") if isinstance(nested.get("iqd"), dict) else {}
    simulate_role_code = iqd_meta.get("simulate_role_code") or nested_iqd.get(
        "simulate_role_code"
    )
    if simulate_role_code:
        sim_code = str(simulate_role_code).strip()
        if sim_code:
            identity = identity.with_simulated_role(sim_code)
            logger.info(
                "IQD simulate role applied",
                simulated_role_code=sim_code,
                user_id=identity.user_id,
                real_role_codes=identity.real_role_codes,
            )

    return identity


def _coerce_int(value: Any) -> int | None:
    """尽力规约为 int；None/非法返回 None。"""
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


class IqdAskInput(BaseModel):
    """iqd__ask 工具入参。"""

    question: str = Field(
        ...,
        description=(
            "用户原始问数问题（不改写语义）。例：本月各渠道销售额。"
            "仅数据类问题可调用本工具；闲聊/文案类问题不要调用。"
        ),
    )
    connection_id: int | None = Field(default=None, description="连接 ID（缺省取 enabled）")
    view: str = Field(
        default="user",
        description="视图：user（默认，无 SQL）| admin（含 SQL，仅后台测试用）",
    )
    scope_hint: list[str] = Field(
        default_factory=list, description="限定表集合（后台测试用，可空）"
    )
    thread_id: str | None = Field(default=None, description="WrenAI 线程（追问透传）")


class IqdDescribeScopeInput(BaseModel):
    """iqd__describe_scope 工具入参。"""

    question_hint: str = Field(
        default="",
        description="可空：想判断的问题，便于返回更贴近的可问范围描述。",
    )


class IqdAskTool(BaseTool):
    """mis-iqd 只读问数工具。"""

    name = TOOL_IQD_ASK
    description = (
        "调用 WrenAI 问数引擎回答数据类问题（只读）：范围裁定 → 生成 SQL → 血缘复核"
        " → 执行 → 返回结构化答案与引用。\n"
        "**调用纪律**：\n"
        "1. 仅数据类问题（销售额/统计/对比/明细）才调用；\n"
        "2. `question` 必须传用户原始问题原文，不得改写；\n"
        "3. 返回 JSON 含 `answer_summary` / `citations` / `plan` / `data`，"
        "`view=user` 时不含 `sql`；\n"
        "4. 工具失败（452xx）时如实报告错误，禁止编造数据。"
    )
    input_model = IqdAskInput

    def __init__(self, service: IqdAskService | None = None) -> None:
        """可注入问数服务（便于单测 mock）。"""
        self._service: IqdAskService | None = service

    def is_read_only(self, arguments: BaseModel) -> bool:
        """问数只读，恒为 True。"""
        del arguments
        return True

    async def execute(self, arguments: IqdAskInput, context: ToolExecutionContext) -> ToolResult:
        """执行问数并返回 JSON 字符串。

        Args:
            arguments: 工具入参。
            context: OpenHarness 执行上下文（身份在 ``context.metadata``）。

        Returns:
            成功时为 ``IqdAskResponse`` JSON；失败时 ``is_error=True`` 且输出 452xx 错误 JSON。
        """
        question: str = (arguments.question or "").strip()
        if not question:
            return ToolResult(
                output=json.dumps(
                    {"error_code": 40001, "message": "问题不能为空"}, ensure_ascii=False
                ),
                is_error=True,
            )

        identity: AskIdentity = _build_identity(context.metadata)
        service = self._get_service()
        request = AskRequest(
            question=question,
            session_id=str(context.metadata.get("session_id") or ""),
            thread_id=arguments.thread_id,
            connection_id=arguments.connection_id,
            view=arguments.view if arguments.view in ("user", "admin") else "user",
            scope_hint=arguments.scope_hint or [],
            # B6：模拟角色透传（identity 已覆写 role_codes；wire 层字段保持同构）
            simulate_role_code=identity.simulated_role_code,
        )
        try:
            payload: dict[str, Any] = await service.ask(request, identity, view=request.view)
        except IqdError as exc:
            logger.warning(
                "iqd__ask failed",
                question=question,
                error_code=exc.code,
                user_id=identity.user_id,
            )
            return ToolResult(
                output=json.dumps(exc.to_error_payload(), ensure_ascii=False),
                is_error=True,
            )
        except Exception as exc:  # noqa: BLE001 - 未捕获异常转 45202 兜底
            logger.exception("iqd__ask unexpected error", question=question)
            return ToolResult(
                output=json.dumps(
                    {"code": 45202, "message": f"问数服务暂不可用: {exc}"},
                    ensure_ascii=False,
                ),
                is_error=True,
            )

        # 给 LLM 的回传必须瘦身：全量 rows 曾导致 Worker/Coordinator 超时与空气泡。
        compact = compact_ask_payload_for_llm(payload)
        logger.info(
            "iqd__ask done",
            query_id=payload.get("query_id"),
            user_id=identity.user_id,
            rows=payload.get("data", {}).get("row_count") if isinstance(payload.get("data"), dict) else None,
            preview_rows=(
                compact.get("data", {}).get("preview_rows")
                if isinstance(compact.get("data"), dict)
                else None
            ),
        )
        return ToolResult(output=json.dumps(compact, ensure_ascii=False))

    def _get_service(self) -> IqdAskService:
        """懒加载问数服务。"""
        if self._service is None:
            self._service = IqdAskService()
        return self._service


class IqdDescribeScopeTool(BaseTool):
    """mis-iqd 只读范围描述工具。"""

    name = TOOL_IQD_DESCRIBE_SCOPE
    description = (
        "描述当前用户/角色可问的数据范围（表集合），用于判断某问题是否在可问范围内。"
        "只读、不执行查询。"
    )
    input_model = IqdDescribeScopeInput

    def is_read_only(self, arguments: BaseModel) -> bool:
        """范围描述只读，恒为 True。"""
        del arguments
        return True

    async def execute(
        self, arguments: IqdDescribeScopeInput, context: ToolExecutionContext
    ) -> ToolResult:
        """解析当前身份可问范围并返回 JSON。

        Args:
            arguments: 工具入参。
            context: OpenHarness 执行上下文。

        Returns:
            成功时为 ``{decision, allowed_item_keys, subject_summary}`` JSON；
            范围裁定 deny 时返回 ``{"decision":"deny",...}``（不抛错）。
        """
        identity: AskIdentity = _build_identity(context.metadata)
        from src.agent.mis_iqd.scope_resolver import ScopeResolver

        resolver = ScopeResolver()
        try:
            # 使用 resolve_effective：模拟角色时按模拟 role_codes 裁定并做不放大收紧
            resolution = await resolver.resolve_effective(identity, None)
            payload: dict[str, Any] = {
                "decision": resolution.decision,
                "allowed_item_keys": resolution.allowed_item_keys,
                "subject_summary": resolution.subject_summary,
                "question_hint": arguments.question_hint,
            }
        except IqdError as exc:
            payload = {
                "decision": "deny",
                "allowed_item_keys": [],
                "subject_summary": identity.subject_summary(),
                "reason": exc.message,
                "question_hint": arguments.question_hint,
            }
        return ToolResult(output=json.dumps(payload, ensure_ascii=False))
