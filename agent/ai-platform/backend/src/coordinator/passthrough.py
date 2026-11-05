"""Coordinator 委派透传与硬委派：跳过收尾 / 首轮 LLM。"""

from __future__ import annotations

import re
from typing import Any

from src.runtime.step_timing import INVOKE_TOOL_NAMES
from src.utils.logging import get_logger

logger = get_logger("coordinator.passthrough")

#: 用户短确认 / 同意执行上一轮助手建议（不含业务实体词）
_AFFIRM_RE = re.compile(
    r"^(需要|要|好的?|可以|行|确认|同意|继续|查一下|麻烦了|嗯+|恩+|是的?|对)$"
)


def is_skipped_invoke_output(tool_output: str) -> bool:
    """``agent__invoke`` 输出是否为 ``status=skipped``（Worker 本轮不适用）。"""
    text = (tool_output or "").strip()
    if not text.startswith("[task:"):
        return False
    first_line, _, _rest = text.partition("\n")
    return "status=skipped" in first_line


def extract_passthrough_worker_text(tool_output: str) -> str | None:
    """从 ``agent__invoke`` 成功信封中取出可直出的 Worker 正文。

    仅接受 ``status=completed`` 的 ``text_with_header`` 形态；失败/超时/skipped 返回 None。
    拒绝 forceLiveQuery 历史占位复述（如 ``[prior_assistant_answer_omitted]``），
    避免透传到 Copilot 气泡。
    """
    text = (tool_output or "").strip()
    if not text.startswith("[task:"):
        return None
    first_line, _, rest = text.partition("\n")
    if "status=completed" not in first_line:
        return None
    body = rest.lstrip("\n").strip()
    if not body:
        return None
    # 开卡标记由 Coordinator 消费，不作为用户正文透传
    try:
        from src.agent.template_report.pipeline import OPEN_CARD_MARKER_PREFIX

        if body.startswith(OPEN_CARD_MARKER_PREFIX):
            return None
    except Exception:  # noqa: BLE001
        pass
    try:
        from src.runtime.openharness import (
            is_force_live_stub_echo,
            strip_force_live_stub_markers,
        )

        if is_force_live_stub_echo(body):
            logger.warning(
                "passthrough rejected forceLiveQuery stub echo",
                body_preview=body[:80],
            )
            return None
        cleaned = strip_force_live_stub_markers(body).strip()
        if not cleaned:
            return None
        try:
            from src.runtime.gateway_api_client import is_model_garbage_payload

            if is_model_garbage_payload(cleaned):
                logger.warning(
                    "passthrough rejected garbage worker text (fail, not success)",
                    body_preview=cleaned[:80],
                )
                return None
        except Exception:  # noqa: BLE001 - 乱码检测失败时仍返回已剥离正文
            pass
        return cleaned
    except Exception:  # noqa: BLE001 - 剥离失败时仍返回原正文
        return body


def should_passthrough_invoke(
    *,
    tool_name: str,
    worker_id: str | None,
    tool_result: dict[str, Any],
    passthrough_workers: frozenset[str],
) -> str | None:
    """若本工具结果应透传，返回 Worker 正文；否则 None。"""
    if tool_name not in INVOKE_TOOL_NAMES:
        return None
    wid = (worker_id or "").strip()
    if not wid or wid not in passthrough_workers:
        return None
    if not tool_result.get("ok"):
        return None
    return extract_passthrough_worker_text(str(tool_result.get("output") or ""))


def should_hard_dispatch(
    *,
    worker_id: str | None,
    hard_dispatch_workers: frozenset[str],
) -> bool:
    """意图预路由命中的 Worker 是否走硬委派（跳过 Coordinator 首轮 LLM）。"""
    wid = (worker_id or "").strip()
    return bool(wid and wid in hard_dispatch_workers)


def is_short_affirmation(user_text: str) -> bool:
    """是否为「需要/好的/确认」类短确认（无门店等实体词）。"""
    raw = (user_text or "").strip()
    if not raw or len(raw) > 12:
        return False
    # 去掉常见标点后再判
    compact = re.sub(r"[\s，。！？、,.!?;；：:]+", "", raw)
    return bool(_AFFIRM_RE.match(compact))


def last_assistant_offer_from_context(conversation_context: str) -> str:
    """从拼好的上文块中取出最近一条助手发言（用于展开短确认）。"""
    text = (conversation_context or "").strip()
    if not text:
        return ""
    # 兼容 format_conversation_context_for_jev 的「助手: …」行块
    parts = re.split(r"(?=^(?:用户|助手): )", text, flags=re.MULTILINE)
    last_asst = ""
    for part in parts:
        chunk = part.strip()
        if chunk.startswith("助手:"):
            last_asst = chunk[len("助手:") :].strip()
    return last_asst


def build_hard_dispatch_invoke_args(
    *,
    worker_id: str,
    user_text: str,
    intent: str = "",
    conversation_context: str | None = None,
    mode: str = "continue",
) -> dict[str, Any]:
    """构造 ``agent__invoke`` 入参（自包含 TaskBrief，无需 Coordinator LLM）。

    Args:
        worker_id: 目标 Worker。
        user_text: 本轮用户原文（不改写语义；短确认时 goal 会展开上一轮建议）。
        intent: 预路由 intent。
        conversation_context: 近几轮上文（含本轮亦可）；写入 attachments，
            供 spawn/无子会话时承接门店等已确认信息。
        mode: 默认 ``continue`` 复用同 Worker 子会话；未命中锚点时工具侧降级 spawn。
    """
    question = (user_text or "").strip()
    wid = (worker_id or "").strip()
    intent_s = (intent or "").strip()
    ctx = (conversation_context or "").strip()
    # 仅本轮原文不算上文，避免空转附件
    if ctx and ctx == question:
        ctx = ""

    affirm = bool(ctx) and is_short_affirmation(question)
    offer = last_assistant_offer_from_context(ctx) if affirm else ""
    if affirm and offer:
        # user_question 仍保留原文；goal 明确「执行上一轮建议」，避免 Worker 把「需要」当闲聊
        goal = (
            f"用户确认执行你上一轮提出的下一步建议。请立刻按该建议取数并直接回复，"
            f"不要再追问是否需要。"
            f"用户原话：{question}。"
            f"上一轮建议：{offer[:600]}"
        )
    else:
        goal = (
            f"按用户问题完成查询并直接回复用户：{question}"
            if question
            else f"完成对 {wid} 的委派查询"
        )
        if ctx:
            goal = f"{goal}（须承接对话上文中已确认的全部条件，勿重复追问）"

    constraints = [
        "仅返回真实存在的数据，无匹配时如实说明",
        "不得臆造业务数据或编码",
    ]
    if ctx:
        constraints.append(
            "附件/上文中用户或助手已确认的条件（门店、区域、时间、指标、品类等）一律沿用；"
            "用户本轮未改口则不要再次请其选择或确认"
        )
    if affirm and offer:
        constraints.append(
            "本轮用户为短确认：必须执行上一轮助手建议的具体查询（如折扣/出清/柜组等），"
            "禁止只复述建议或再次询问「需要吗」"
        )
    mode_s = (mode or "continue").strip().lower()
    if mode_s not in {"spawn", "continue", "stop"}:
        mode_s = "continue"
    return {
        "agent_id": wid,
        "content": question or goal,
        "intent": intent_s,
        "mode": mode_s,
        "task_brief": {
            "goal": goal,
            "purpose": "直接回复用户",
            "inputs": {
                "user_question": question,
                "page_context_slice": {},
                "attachments_text": ctx,
            },
            "constraints": constraints,
            "expected_output": "text",
        },
    }


async def load_passthrough_workers(coordinator_id: str) -> frozenset[str]:
    """读取 Coordinator ``delegation.passthrough_workers``；失败则空集。"""
    passthrough, _ = await load_delegation_worker_sets(coordinator_id)
    return passthrough


async def load_hard_dispatch_workers(coordinator_id: str) -> frozenset[str]:
    """读取 Coordinator ``delegation.hard_dispatch_workers``；失败则空集。"""
    _, hard = await load_delegation_worker_sets(coordinator_id)
    return hard


async def load_delegation_worker_sets(
    coordinator_id: str,
) -> tuple[frozenset[str], frozenset[str]]:
    """一次读取 ``passthrough_workers`` 与 ``hard_dispatch_workers``。"""
    if not (coordinator_id or "").strip():
        return frozenset(), frozenset()
    try:
        from src.coordinator.coordination_service import read_coordination

        coord = await read_coordination(coordinator_id)
        delegation = coord.delegation
        if delegation is None:
            return frozenset(), frozenset()

        def _set(values: list[str] | None) -> frozenset[str]:
            return frozenset(str(x).strip() for x in (values or []) if str(x).strip())

        return _set(delegation.passthrough_workers), _set(delegation.hard_dispatch_workers)
    except Exception:  # noqa: BLE001 - 配置缺失不阻断主链路
        logger.warning(
            "load delegation worker sets failed",
            coordinator_id=coordinator_id,
            exc_info=True,
        )
        return frozenset(), frozenset()
