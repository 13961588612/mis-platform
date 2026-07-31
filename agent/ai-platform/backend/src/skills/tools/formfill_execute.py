"""formfill__execute 工具 — 触发 MIS FormFill 引擎执行一次表单填充（T02/T05）。

当 BFF 返回 ``hitl_required`` 时：
- 在 FormFillPendingStore 登记挂起任务（TTL 30min）
- 通过 A2UI 挂起缓冲推送 entity-select 渲染（后端 → gateway → H5/wecom）
- 写入 session.state.pending_formfill
- 工具返回自然语言描述，交由 LLM 向用户说明「已生成选择卡片」

当返回 ``success`` 时若具备单据上下文则自动写回目标单据（设计时序图 SUCCESS → POST /apply；与 HITL confirm 写回保持一致），并返回字段填充结果；``manual_required`` 时请求手动输入；
``error`` 时返回错误（is_error=True）。

此外导出 ``resume_formfill`` 供入站-worker 在收到 entity_select 回调时续跑（T05）。
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.agent.session import get_session_manager
from src.config import get_settings
from src.hitl.formfill_pending import FormFillStatus, get_formfill_pending_store
from src.runtime.a2ui_pending import push_a2ui_render
from src.skills.formfill_client import FormFillClient, FormFillClientError
from src.utils.logging import get_logger

logger = get_logger("skills.formfill_execute")

# A2UI 命名空间（设计 §4.1 entity-select schema）
A2UI_NAMESPACE = "mis-formfill"

# entity-select 候选人按钮动作
ENTITY_SELECT_ACTIONS = ["confirm", "manual", "cancel"]


@dataclass
class FormFillResumeOutcome:
    """entity_select 入站处理结果，供入站-worker 决定如何续跑。"""

    kind: str  # "continue" | "message" | "error"
    content: str = ""


def _default_skill_id() -> str:
    """白名单中的第一个 Skill ID 作为默认。"""
    allowed = get_settings().FORMFILL_ALLOWED_SKILLS or ["user-fill"]
    return allowed[0]


# 意图 → MIS skillId 映射（P0: user-fill）
_INTENT_SKILL_MAP: dict[str, str] = {
    "user-fill": "user-fill",
    "fill": "user-fill",
}


def resolve_skill_id(intent_or_id: str | None) -> str:
    """将意图或原始 ID 解析为合法的 MIS Skill ID。"""
    if not intent_or_id:
        return _default_skill_id()
    return _INTENT_SKILL_MAP.get(intent_or_id, intent_or_id)


class FormFillExecuteInput(BaseModel):
    """formfill__execute 工具入参。"""

    skill_id: str = Field(default="user-fill", description="MIS FormFill 引擎 Skill ID（P0: user-fill）")
    user_input: str = Field(default="", description="触发本次表单填充的自然语言输入/上下文")
    doc_type: str | None = Field(default=None, description="目标单据类型（如 purchase-order）；来自 pageContext")
    doc_id: str | None = Field(default=None, description="目标单据 ID；来自 pageContext")
    page_context: dict[str, Any] = Field(
        default_factory=dict, description="前端页面上下文（含 docType/docId 及已填字段值）"
    )
    conversation_id: str | None = Field(
        default=None, description="与 resumeToken 绑定的会话 ID（首次执行可为空）"
    )


class FormFillExecuteTool(BaseTool):
    """触发 MIS FormFill 引擎执行一次表单填充。"""

    name = "formfill__execute"
    description = (
        "触发 MIS FormFill 引擎执行一次表单填充（如根据上下文自动填充采购订单的供应商/单号）。"
        "当引擎需要人工在候选实体中选择时返回 hitl_required，并通过 entity-select 卡片征求用户确认；"
        "用户选择后由系统自动续填。仅在用户明确要『填充/补全表单字段』时调用。"
    )
    input_model = FormFillExecuteInput

    async def execute(
        self, arguments: FormFillExecuteInput, context: ToolExecutionContext
    ) -> ToolResult:
        """执行表单填充，并按 BFF 状态决定 HITL / 成功 / 错误分支。"""
        meta = context.metadata or {}
        session_id = meta.get("session_id") or ""
        identity = meta.get("identity") or {}

        # 优先从 pageContext 取单据上下文
        page_ctx = dict(arguments.page_context or {})
        doc_type = arguments.doc_type or page_ctx.get("docType") or page_ctx.get("doc_type")
        doc_id = arguments.doc_id or page_ctx.get("docId") or page_ctx.get("doc_id")
        skill_id = resolve_skill_id(arguments.skill_id)

        session_manager = get_session_manager()
        try:
            session = await session_manager.get_session(session_id)
        except Exception:
            session = None

        client = FormFillClient()
        try:
            try:
                response = await client.execute_skill(
                    skill_id=skill_id,
                    session_id=session_id,
                    user_input=arguments.user_input or "",
                    context={
                        "docType": doc_type,
                        "docId": doc_id,
                        "pageContext": page_ctx,
                    },
                    conversation_id=arguments.conversation_id,
                    session=session,
                    identity=identity,
                )
            except FormFillClientError as exc:
                return ToolResult(output=f"调用 FormFill 引擎失败：{exc}", is_error=True)

            status = (response.get("status") or "").lower()
            resume_token = response.get("resumeToken") or response.get("resume_token")

            if status == "success":
                fields = response.get("fields") or {}
                # 直接成功路径：若具备单据上下文则自动写回目标单据
                # （设计时序图 SUCCESS → POST /apply；与 HITL confirm 写回保持一致）。
                # 无论是否写回，均回带 docType/docId + applied 标记，
                # 便于 LLM 在需要时显式调用 formfill__apply 或做幂等重试。
                if doc_type and doc_id and fields:
                    from src.skills.tools.formfill_apply import submit_formfill_apply

                    try:
                        apply_resp = await submit_formfill_apply(
                            session=session,
                            skill_id=skill_id,
                            doc_type=doc_type,
                            doc_id=doc_id,
                            values=fields,
                            identity=identity,
                        )
                    except FormFillClientError as exc:
                        return ToolResult(
                            output=f"表单填充完成，但写回单据失败：{exc}",
                            is_error=True,
                            metadata={
                                "formfill": {
                                    "status": "success",
                                    "fields": fields,
                                    "applied": False,
                                    "docType": doc_type,
                                    "docId": doc_id,
                                }
                            },
                        )
                    apply_status = (apply_resp.get("status") or "").lower()
                    if apply_status == "success":
                        applied_doc = apply_resp.get("docId") or doc_id
                        return ToolResult(
                            output=(
                                f"表单填充完成，已写回单据 {applied_doc}。"
                                + (f"填充字段：{fields}" if fields else "")
                            ),
                            metadata={
                                "formfill": {
                                    "status": "success",
                                    "fields": fields,
                                    "applied": True,
                                    "docType": doc_type,
                                    "docId": applied_doc,
                                }
                            },
                        )
                    # apply 返回非成功（error / no_match 等）
                    return ToolResult(
                        output=(
                            "表单填充完成，但写回单据未完成："
                            f"{apply_resp.get('message') or 'BFF 返回非成功状态'}"
                        ),
                        is_error=True,
                        metadata={
                            "formfill": {
                                "status": "success",
                                "fields": fields,
                                "applied": False,
                                "docType": doc_type,
                                "docId": doc_id,
                            }
                        },
                    )

                # 无单据上下文：仅返回提取结果，由 LLM 后续调用 formfill__apply 写回
                return ToolResult(
                    output=("表单填充完成。" + (f"填充字段：{fields}" if fields else "")),
                    metadata={
                        "formfill": {
                            "status": "success",
                            "fields": fields,
                            "applied": False,
                            "docType": doc_type,
                            "docId": doc_id,
                        }
                    },
                )

            if status == "hitl_required":
                hitl = response.get("hitl") or {}
                field = hitl.get("field") or ""
                original_value = hitl.get("originalValue") or hitl.get("original_value") or ""
                prompt = hitl.get("prompt") or f"请为字段「{field}」选择一个候选实体"
                candidates = hitl.get("candidates") or []

                store = get_formfill_pending_store()
                record = await store.create(
                    resume_token=resume_token or f"ff-{session_id}-{skill_id}",
                    session_id=session_id,
                    agent_id=(session.agent_id if session else ""),
                    skill_id=skill_id,
                    user_id=(session.user_id if session else (identity.get("userId") or "")),
                    field=field,
                    doc_type=doc_type or "",
                    doc_id=doc_id or "",
                    candidates=candidates,
                    original_value=original_value,
                    prompt=prompt,
                )
                if session is not None:
                    session.set_pending_formfill(record.resume_token)
                    await session_manager.save_session(session)

                await push_a2ui_render(
                    session_id,
                    "entity-select",
                    {
                        "namespace": A2UI_NAMESPACE,
                        "resumeToken": record.resume_token,
                        "field": field,
                        "originalValue": original_value,
                        "prompt": prompt,
                        "candidates": candidates,
                        "actions": ENTITY_SELECT_ACTIONS,
                    },
                )
                return ToolResult(
                    output=(
                        f"字段「{field}」需要人工确认：{prompt}。"
                        "已为你生成候选实体选择卡片，请从中选择或手动输入。"
                    ),
                    metadata={
                        "formfill": {"status": "hitl_required", "resumeToken": record.resume_token}
                    },
                )

            if status == "manual_required":
                return ToolResult(
                    output=(
                        response.get("message")
                        or "表单填充需要你手动提供该字段的值，请直接告诉我。"
                    ),
                )

            if status == "error":
                return ToolResult(
                    output=f"表单填充出错：{response.get('message') or '未知错误'}",
                    is_error=True,
                )

            return ToolResult(output=f"表单填充返回未知状态：{status}", is_error=True)
        finally:
            await client.aclose()


async def resume_formfill(
    *,
    instance: Any,
    session: Any,
    inbound: Any,
    producer: Any | None = None,
) -> FormFillResumeOutcome:
    """处理一次 entity_select 入站（用户已选候选），提交 apply 并决定如何续跑（T05）。

    Args:
        instance: 已就绪的 AgentInstance（用于 kind="continue" 时续跑）。
        session: 当前会话对象。
        inbound: 入站消息（含 resume_token / selected_candidate / selection_action）。
        producer: 出站 StreamProducer（本函数不自行发布事件，仅返回结果）。

    Returns:
        FormFillResumeOutcome：
        - kind="continue"：content 作为用户消息，由调用方继续驱动 agent。
        - kind="message"：直接下发文本（无需再跑 agent）。
        - kind="error"：下发错误。
    """
    meta = getattr(inbound, "metadata", None) or {}
    resume_token = getattr(inbound, "resume_token", None) or meta.get("resumeToken")
    action = (
        getattr(inbound, "selection_action", None)
        or meta.get("action")
        or "confirm"
    )
    selected = getattr(inbound, "selected_candidate", None) or meta.get("selectedCandidate") or {}

    store = get_formfill_pending_store()
    record = await store.get(resume_token) if resume_token else None
    if record is None:
        return FormFillResumeOutcome("message", "未找到对应的表单填充任务（可能已超时），请重新发起。")
    if record.status != FormFillStatus.PENDING:
        return FormFillResumeOutcome("message", "该表单填充任务已处理，无需重复操作。")

    if action == "cancel":
        await store.update_status(resume_token, FormFillStatus.CANCELLED)
        if session is not None:
            session.clear_pending_formfill()
            await get_session_manager().save_session(session)
        return FormFillResumeOutcome("message", "已取消本次表单填充。")

    if action == "manual":
        # 引导用户在对话中直接输入字段值（wecom 无自由文本按钮）
        await store.update_status(resume_token, FormFillStatus.CANCELLED)
        if session is not None:
            session.clear_pending_formfill()
            await get_session_manager().save_session(session)
        return FormFillResumeOutcome(
            "message",
            f"请直接告诉我字段「{record.field}」应该填写的值，我会继续为你填充。",
        )

    # confirm：提交候选实体值到 BFF apply
    value = selected.get("value") if isinstance(selected, dict) else None
    if value is None and isinstance(selected, dict):
        value = selected.get("id")
    if value is None:
        return FormFillResumeOutcome("message", "未识别到所选候选实体，请重新选择。")

    from src.skills.tools.formfill_apply import submit_formfill_apply

    try:
        apply_resp = await submit_formfill_apply(
            session=session,
            skill_id=record.skill_id,
            doc_type=record.doc_type,
            doc_id=record.doc_id,
            field=record.field,
            value=value,
            identity=meta.get("identity"),
        )
    except Exception as exc:
        logger.warning("FormFill apply failed on resume", error=str(exc))
        return FormFillResumeOutcome("error", f"提交表单填充失败：{exc}")

    apply_status = (apply_resp.get("status") or "").lower()
    if apply_status == "success":
        await store.update_status(resume_token, FormFillStatus.APPLIED)
        if session is not None:
            session.clear_pending_formfill()
            await get_session_manager().save_session(session)
        summary = f"已成功将字段「{record.field}」填充为「{value}」"
        if apply_resp.get("docId"):
            summary += f"（单据 {apply_resp.get('docId')}）"
        return FormFillResumeOutcome(
            "continue",
            f"{summary}。请继续后续流程或告知是否还有其他需要填充的字段。",
        )

    # error / no_match / 其它
    await store.update_status(resume_token, FormFillStatus.EXPIRED)
    if session is not None:
        session.clear_pending_formfill()
        await get_session_manager().save_session(session)
    return FormFillResumeOutcome(
        "message",
        f"表单填充未能完成：{apply_resp.get('message') or 'BFF 返回非成功状态'}。",
    )
