"""coordinator__decide — Coordinator 结构化决策工具（只路由，不写业务正文）。

LLM 仅允许输出决策结构；真正的 ``agent__invoke`` / 对用户话术由 A2UI 通道代码执行。
``action=route`` 时本工具只校验并返回决策，**不**在此委派 Worker。
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult
from pydantic import BaseModel, Field

from src.utils.logging import get_logger

logger = get_logger("skills.coordinator_decide")

DECIDE_TOOL_NAME: str = "coordinator__decide"

DecideAction = Literal["route", "clarify", "refuse", "chitchat"]

REFUSE_FIXED_MESSAGE: str = (
    "【信息不足，缺少必要业务数据，无法给出有效结果，不编造数据】"
)

#: 疑似经营数字表 / 指标行（禁止塞进 clarify/chitchat/message）
_BUSINESS_NUMBER_RE = re.compile(
    r"(营业额|客单|毛利|销售额|损耗率|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\|\s*[-:]+\s*\|)"
)


class CoordinatorDecideInput(BaseModel):
    """决策工具入参：只表达路由意图，不承载报表正文。"""

    action: DecideAction = Field(
        description=(
            "route=委派 Worker；clarify=缺槽位澄清（一句话）；"
            "refuse=信息不足拒答；chitchat=非业务闲聊短答"
        )
    )
    worker_id: str | None = Field(
        default=None,
        description="action=route 时必填；必须是可委派执行者表中的 agent_id",
    )
    intent: str | None = Field(
        default=None,
        description="可选意图标签（如 spm_report / rag / crm）；可与 worker 场景一致",
    )
    content: str | None = Field(
        default=None,
        description="转给 Worker 的用户问法（含上文条件的完整问句）；route 时建议填写",
    )
    message: str | None = Field(
        default=None,
        description=(
            "clarify/chitchat 时对用户的短文案；禁止经营数字与 Markdown 数据表。"
            "refuse 时可省略（系统用固定拒答话术）"
        ),
    )


def message_looks_like_business_data(text: str) -> bool:
    """粗检文案是否像经营数据/表格（禁止经决策工具直出）。"""
    raw = (text or "").strip()
    if not raw:
        return False
    if raw.count("|") >= 4 and _BUSINESS_NUMBER_RE.search(raw):
        return True
    if _BUSINESS_NUMBER_RE.search(raw) and len(re.findall(r"\d", raw)) >= 8:
        return True
    return False


def build_decide_result(
    *,
    action: str,
    worker_id: str = "",
    intent: str = "",
    content: str = "",
    message: str = "",
    ok: bool = True,
    error: str = "",
) -> dict[str, Any]:
    """构造决策工具标准 JSON 载荷。"""
    return {
        "ok": ok,
        "action": action,
        "worker_id": worker_id or "",
        "intent": intent or "",
        "content": content or "",
        "message": message or "",
        "error": error or "",
    }


class CoordinatorDecideTool(BaseTool):
    """校验并回传结构化决策；不执行委派、不生成报表。"""

    name = DECIDE_TOOL_NAME
    description = (
        "协调者唯一决策出口：只返回路由/澄清/拒答/闲聊决策，禁止输出经营数字或数据表。"
        "业务问题必须 action=route 并指定 worker_id；系统随后委派 Worker 并结束本轮。"
        "缺槽位用 clarify；无法回答用 refuse；纯闲聊用 chitchat。"
        "不要用本工具撰写报表正文。"
    )
    input_model = CoordinatorDecideInput

    async def execute(
        self,
        arguments: CoordinatorDecideInput,
        context: ToolExecutionContext | None = None,
    ) -> ToolResult:
        """校验决策并返回 JSON 字符串结果。"""
        action = str(arguments.action or "").strip().lower()
        worker_id = (arguments.worker_id or "").strip()
        intent = (arguments.intent or "").strip()
        content = (arguments.content or "").strip()
        message = (arguments.message or "").strip()

        coordinator_id = ""
        if context is not None:
            meta = getattr(context, "metadata", None) or {}
            if isinstance(meta, dict):
                coordinator_id = str(
                    meta.get("agent_id") or meta.get("coordinator_id") or ""
                ).strip()

        allowed: frozenset[str] = frozenset()
        if coordinator_id:
            try:
                from src.skills.tools.invoke_agent import load_coordinator_worker_ids

                allowed = load_coordinator_worker_ids(coordinator_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "decide load worker_ids failed",
                    coordinator_id=coordinator_id,
                    error=str(exc),
                )

        if action == "route":
            if not worker_id:
                payload = build_decide_result(
                    action="refuse",
                    message=REFUSE_FIXED_MESSAGE,
                    ok=False,
                    error="route_missing_worker_id",
                )
                return ToolResult(
                    output=json.dumps(payload, ensure_ascii=False),
                    is_error=True,
                )
            if allowed and worker_id not in allowed:
                payload = build_decide_result(
                    action="refuse",
                    message=REFUSE_FIXED_MESSAGE,
                    ok=False,
                    error=f"worker_not_allowed:{worker_id}",
                )
                return ToolResult(
                    output=json.dumps(payload, ensure_ascii=False),
                    is_error=True,
                )
            if message_looks_like_business_data(message):
                message = ""
            payload = build_decide_result(
                action="route",
                worker_id=worker_id,
                intent=intent,
                content=content,
                message=message,
                ok=True,
            )
            logger.info(
                "coordinator_decide route",
                coordinator_id=coordinator_id or None,
                worker_id=worker_id,
                intent=intent or None,
            )
            return ToolResult(output=json.dumps(payload, ensure_ascii=False))

        if action == "refuse":
            payload = build_decide_result(
                action="refuse",
                message=message if message and not message_looks_like_business_data(message) else REFUSE_FIXED_MESSAGE,
                ok=True,
            )
            return ToolResult(output=json.dumps(payload, ensure_ascii=False))

        if action in {"clarify", "chitchat"}:
            if not message:
                payload = build_decide_result(
                    action="refuse",
                    message=REFUSE_FIXED_MESSAGE,
                    ok=False,
                    error=f"{action}_empty_message",
                )
                return ToolResult(
                    output=json.dumps(payload, ensure_ascii=False),
                    is_error=True,
                )
            if message_looks_like_business_data(message):
                payload = build_decide_result(
                    action="refuse",
                    message=REFUSE_FIXED_MESSAGE,
                    ok=False,
                    error=f"{action}_business_data_forbidden",
                )
                return ToolResult(
                    output=json.dumps(payload, ensure_ascii=False),
                    is_error=True,
                )
            payload = build_decide_result(
                action=action,
                message=message,
                ok=True,
            )
            return ToolResult(output=json.dumps(payload, ensure_ascii=False))

        payload = build_decide_result(
            action="refuse",
            message=REFUSE_FIXED_MESSAGE,
            ok=False,
            error=f"unknown_action:{action}",
        )
        return ToolResult(
            output=json.dumps(payload, ensure_ascii=False),
            is_error=True,
        )


def parse_decide_tool_output(raw: str | dict[str, Any] | None) -> dict[str, Any] | None:
    """解析决策工具输出为 dict；失败返回 None。"""
    if isinstance(raw, dict):
        return raw
    text = (raw or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None
