"""formfill__apply 工具 — 将选定字段值写回 MIS（BFF /apply）（T02/T04）。

对应表单填充的「确认」阶段：将用户选择的候选实体值（或手动输入值）
通过 mis-admin-bff POST /api/v1/ai/skill/apply 写回目标单据。
"""
from __future__ import annotations
from typing import Any

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.agent.session import get_session_manager
from src.skills.field_mapping import is_writable_field
from src.skills.formfill_client import FormFillClient, FormFillClientError
from src.utils.logging import get_logger

logger = get_logger("skills.formfill_apply")


class FormFillApplyInput(BaseModel):
    """formfill__apply 工具入参。"""

    skill_id: str = Field(default="user-fill", description="MIS FormFill Skill ID")
    doc_type: str = Field(default="purchase-order", description="目标单据类型")
    doc_id: str = Field(default="", description="目标单据 ID")
    field: str = Field(..., description="要写入的字段名（须为 doc_type 的可写字段）")
    value: Any = Field(..., description="要写入的字段值")
    resume_token: str | None = Field(default=None, description="关联的 HITL 恢复令牌（可选）")


async def submit_formfill_apply(
    *,
    session: Any | None,
    skill_id: str,
    doc_type: str,
    doc_id: str,
    field: str | None = None,
    value: Any = None,
    values: dict[str, Any] | None = None,
    identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """实际提交 apply 到 BFF（供 formfill_execute.resume_formfill 复用）。

    支持两种模式：
    - 单字段（HITL confirm 路径）：传 ``field`` + ``value``。
    - 批量写回（success 直接成功路径）：传 ``values``（dict），将整个字段映射写回目标单据。

    无论哪种模式都执行可写字段白名单校验，仅允许写回 doc_type 声明的可写字段。
    """
    # 归一化为统一的 values dict
    if values:
        payload = dict(values)
    elif field is not None:
        payload = {field: value}
    else:
        raise FormFillClientError("submit_formfill_apply 需要 field+value 或 values 参数")

    # 白名单校验：仅允许 doc_type 的可写字段，避免越权写回
    non_writable = [f for f in payload if not is_writable_field(doc_type, f)]
    if non_writable:
        raise FormFillClientError(
            f"字段 {non_writable} 不在单据 {doc_type} 的可写字段白名单内"
        )

    client = FormFillClient()
    try:
        return await client.apply_skill(
            skill_id=skill_id,
            doc_type=doc_type,
            doc_id=doc_id,
            values=payload,
            session=session,
            identity=identity,
        )
    finally:
        await client.aclose()


class FormFillApplyTool(BaseTool):
    """将表单字段值写回 MIS 目标单据（BFF /apply）。"""

    name = "formfill__apply"
    description = (
        "将表单字段值写回 MIS 目标单据（BFF /apply）。"
        "通常在用户确认候选实体后由系统自动调用；也可在用户手动给出字段值时调用。"
        "仅允许写入 doc_type 白名单内的字段。"
    )
    input_model = FormFillApplyInput

    async def execute(
        self, arguments: FormFillApplyInput, context: ToolExecutionContext
    ) -> ToolResult:
        """执行字段写回，返回成功/失败结果。"""
        meta = context.metadata or {}
        session_id = meta.get("session_id") or ""
        identity = meta.get("identity") or {}
        session_manager = get_session_manager()
        try:
            session = await session_manager.get_session(session_id)
        except Exception:
            session = None

        try:
            resp = await submit_formfill_apply(
                session=session,
                skill_id=arguments.skill_id,
                doc_type=arguments.doc_type,
                doc_id=arguments.doc_id,
                field=arguments.field,
                value=arguments.value,
                identity=identity,
            )
        except FormFillClientError as exc:
            return ToolResult(output=f"表单写回失败：{exc}", is_error=True)

        status = (resp.get("status") or "").lower()
        if status == "success":
            return ToolResult(
                output=f"已成功将字段「{arguments.field}」写入单据 {arguments.doc_id or arguments.doc_type}。",
                metadata={"formfill_apply": {"status": "success", "docId": resp.get("docId")}},
            )
        return ToolResult(
            output=f"表单写回未完成：{resp.get('message') or 'BFF 返回非成功状态'}",
            is_error=True,
        )
