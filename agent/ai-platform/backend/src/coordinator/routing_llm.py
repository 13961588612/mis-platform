"""Coordinator 选人轮加速：瘦 prompt、裁工具、模板补全 TaskBrief。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.config import get_settings
from src.coordinator.passthrough import build_hard_dispatch_invoke_args
from src.llm.models import LLMMessage, LLMRole
from src.runtime.step_timing import FORMFILL_TOOL_PREFIX, INVOKE_TOOL_NAMES
from src.utils.logging import get_logger

logger = get_logger("coordinator.routing_llm")

#: 选人轮允许的工具名（仅委派；填单仍留给后续轮）
ROUTING_TOOL_NAMES: frozenset[str] = frozenset(INVOKE_TOOL_NAMES)

#: 选人轮对话历史上限（一轮 ≈ user+assistant）
ROUTING_MAX_HISTORY_TURNS = 2
#: 选人轮单条消息截断
ROUTING_MAX_MSG_CHARS = 400

_ROUTING_PROMPT_CACHE: dict[str, str] = {}


def load_routing_system_prompt(agent_id: str) -> str:
    """读取 ``runtime/prompts/routing.md``；缺失则返回内置短文案。"""
    aid = (agent_id or "").strip()
    if not aid:
        return _FALLBACK_ROUTING_PROMPT
    if aid in _ROUTING_PROMPT_CACHE:
        return _ROUTING_PROMPT_CACHE[aid]
    try:
        base = Path(get_settings().CONFIG_BASE_PATH)
        path = base / "agents" / aid / "runtime" / "prompts" / "routing.md"
        if path.is_file():
            text = path.read_text(encoding="utf-8").strip()
            if text:
                _ROUTING_PROMPT_CACHE[aid] = text
                return text
    except Exception as exc:  # noqa: BLE001
        logger.warning("load routing.md failed", agent_id=aid, error=str(exc))
    _ROUTING_PROMPT_CACHE[aid] = _FALLBACK_ROUTING_PROMPT
    return _FALLBACK_ROUTING_PROMPT


_FALLBACK_ROUTING_PROMPT = (
    "你是 MIS Copilot 调度器。需要专用能力时只调用 agent__invoke，"
    "仅填 agent_id、intent、content（用户原问）；不要写完整 task_brief。"
    "超市门店/报表 → spm-report；制度 → mis-rag；会员 → crm-assistant；闲聊直接短答。"
)


def build_routing_llm_messages(
    *,
    agent_id: str,
    history_and_user: list[LLMMessage],
) -> list[LLMMessage]:
    """选人轮消息：瘦 system + 截断后的对话（不含 A2UI 长 hint / 完整 system.md）。"""
    prompt = load_routing_system_prompt(agent_id)
    truncated = truncate_messages_for_routing(history_and_user)
    # 去掉原有 system，换瘦 prompt
    non_system = [m for m in truncated if m.role != LLMRole.SYSTEM]
    return [LLMMessage(role=LLMRole.SYSTEM, content=prompt), *non_system]


def truncate_messages_for_routing(
    messages: list[LLMMessage],
    *,
    max_turns: int = ROUTING_MAX_HISTORY_TURNS,
    max_msg_chars: int = ROUTING_MAX_MSG_CHARS,
) -> list[LLMMessage]:
    """保留最近 N 轮 user/assistant，单条截断；system 原样保留（调用方会替换）。"""
    if max_turns <= 0:
        return list(messages)
    systems = [m for m in messages if m.role == LLMRole.SYSTEM]
    dialogue = [m for m in messages if m.role in (LLMRole.USER, LLMRole.ASSISTANT)]
    # 按「条」近似轮次：每轮最多 2 条
    keep_n = max_turns * 2
    clipped = dialogue[-keep_n:] if len(dialogue) > keep_n else dialogue

    def _clip(msg: LLMMessage) -> LLMMessage:
        text = (msg.content or "").strip()
        if len(text) <= max_msg_chars:
            return msg
        return LLMMessage(
            role=msg.role,
            content=text[: max_msg_chars - 1] + "…",
            tool_calls=msg.tool_calls,
            tool_call_id=msg.tool_call_id,
        )

    return [*systems, *(_clip(m) for m in clipped)]


def filter_openai_tools_for_routing(
    tools: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """选人轮只保留 ``agent__invoke`` / ``agent``（去掉 render_a2ui / skill / formfill）。"""
    out: list[dict[str, Any]] = []
    for item in tools or []:
        if not isinstance(item, dict):
            continue
        function = item.get("function") if isinstance(item.get("function"), dict) else None
        name = str((function or {}).get("name") or "")
        if name in ROUTING_TOOL_NAMES:
            out.append(item)
    return out


def invoke_args_need_template(args: dict[str, Any] | None) -> bool:
    """LLM 未给出可用 TaskBrief 时需要模板补全。"""
    if not isinstance(args, dict):
        return True
    brief = args.get("task_brief")
    if not isinstance(brief, dict) or not brief:
        return True
    goal = str(brief.get("goal") or "").strip()
    inputs = brief.get("inputs") if isinstance(brief.get("inputs"), dict) else {}
    user_q = str((inputs or {}).get("user_question") or "").strip()
    if len(goal) < 16:
        return True
    if not user_q:
        return True
    return False


def enrich_invoke_args_with_template(
    args: dict[str, Any],
    *,
    user_text: str,
    conversation_context: str | None = None,
) -> dict[str, Any]:
    """用硬委派同款模板补全 / 加固 ``agent__invoke`` 入参。

    - 缺 brief 或 brief 过薄 → 整份替换为模板；
    - brief 已完整但缺 attachments → 只补上文附件。
    """
    if not isinstance(args, dict):
        return args
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return args

    question = (user_text or "").strip() or str(args.get("content") or "").strip()
    intent = str(args.get("intent") or "").strip()
    mode = str(args.get("mode") or "continue").strip() or "continue"
    ctx = (conversation_context or "").strip()

    if invoke_args_need_template(args):
        templated = build_hard_dispatch_invoke_args(
            worker_id=agent_id,
            user_text=question,
            intent=intent,
            conversation_context=ctx or None,
            mode=mode,
        )
        # 保留 LLM 自报 intent（若有）
        if intent:
            templated["intent"] = intent
        if mode:
            templated["mode"] = mode
        return templated

    # brief 够用：仅补 attachments_text
    brief = dict(args.get("task_brief") or {})
    inputs = dict(brief.get("inputs") or {}) if isinstance(brief.get("inputs"), dict) else {}
    if ctx and not str(inputs.get("attachments_text") or "").strip():
        inputs["attachments_text"] = ctx
        if not str(inputs.get("user_question") or "").strip():
            inputs["user_question"] = question
        brief["inputs"] = inputs
        merged = dict(args)
        merged["task_brief"] = brief
        if not str(merged.get("content") or "").strip():
            merged["content"] = question
        return merged
    return args


def is_routing_tool_name(name: str) -> bool:
    """是否为选人轮允许的工具。"""
    return (name or "").strip() in ROUTING_TOOL_NAMES


def should_keep_formfill_in_routing(name: str) -> bool:
    """预留：若策略改为选人轮也放行填单。"""
    return (name or "").startswith(FORMFILL_TOOL_PREFIX)
