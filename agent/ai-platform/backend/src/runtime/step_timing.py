"""Agent 回合逐步耗时观测（OpenHarness / A2UI 共用）。

事件名：
- ``对话步骤``：中文可读（会话号 / 步骤名 / 耗时）
- ``agent_step_timing``：单轮 LLM 或单次 tool/skill（结构化）
- ``route_timing``：本轮汇总（含 ``ms_to_first_invoke``）
"""

from __future__ import annotations

from time import perf_counter
from typing import Any

from src.utils.logging import get_logger

logger = get_logger("runtime.step_timing")

INVOKE_TOOL_NAMES: frozenset[str] = frozenset({"agent__invoke", "agent"})
FORMFILL_TOOL_PREFIX: str = "formfill__"

_ROLE_ZH: dict[str, str] = {
    "coordinator": "协调者",
    "worker": "执行者",
}


def log_turn_step(
    *,
    session_id: str,
    step_name: str,
    duration_ms: int,
    agent_id: str = "",
    detail: str = "",
) -> None:
    """本轮一步耗时（中文）：会话号、步骤名、耗时。"""
    logger.info(
        "对话步骤",
        会话号=session_id or "-",
        步骤=step_name,
        耗时_ms=max(0, int(duration_ms)),
        agent_id=agent_id or None,
        说明=detail or None,
    )


def _role_zh(role: str) -> str:
    return _ROLE_ZH.get((role or "").strip().lower(), role or "未知角色")


def _zh_name_agent_step(
    *,
    role: str,
    kind: str,
    index: int,
    tool: str | None,
    skill_id: str | None,
) -> str:
    prefix = _role_zh(role)
    if kind == "llm":
        return f"{prefix}·大模型第{index}轮"
    if kind == "tool":
        t = tool or ""
        if t in INVOKE_TOOL_NAMES:
            return f"{prefix}·委派Worker"
        if t == "skill" or skill_id:
            return f"{prefix}·加载Skill({skill_id or '?'})"
        if t.startswith("formfill__"):
            return f"{prefix}·填单工具({t})"
        if t.startswith("mcp__"):
            short = t.rsplit("__", 1)[-1]
            return f"{prefix}·MCP工具({short})"
        if t == "render_a2ui":
            return f"{prefix}·渲染A2UI"
        return f"{prefix}·工具({t or '?'})"
    return f"{prefix}·{kind}"


def elapsed_ms(started_at: float) -> int:
    """``perf_counter`` 起点到当前的毫秒数。"""
    return max(0, int((perf_counter() - started_at) * 1000))


def intent_from_tool_input(tool_input: Any) -> str | None:
    """从工具入参中读取 ``intent``（若有）。"""
    if not isinstance(tool_input, dict):
        return None
    raw = tool_input.get("intent")
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def worker_from_tool_input(tool_input: Any) -> str | None:
    """从 ``agent__invoke`` 入参读取目标 Worker。"""
    if not isinstance(tool_input, dict):
        return None
    for key in ("agent_id", "worker_id", "target_agent_id"):
        raw = tool_input.get(key)
        if raw is not None and str(raw).strip():
            return str(raw).strip()
    return None


def skill_id_from_tool_input(tool_name: str, tool_input: Any) -> str | None:
    """``skill`` 工具入参中的正式 skill_id；其它工具返回 None。"""
    if tool_name != "skill" or not isinstance(tool_input, dict):
        return None
    raw = tool_input.get("name")
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def infer_route_kind(
    *,
    ms_to_first_invoke: int | None,
    ms_to_first_formfill: int | None,
    ms_to_first_tool: int | None,
    ms_to_first_text: int | None,
) -> str:
    """根据首次动作推断本轮路由形态。"""
    if ms_to_first_invoke is not None:
        return "invoke"
    if ms_to_first_formfill is not None:
        return "formfill"
    if ms_to_first_tool is not None:
        return "other_tool"
    if ms_to_first_text is not None:
        return "direct"
    return "empty"


def log_agent_step_timing(
    *,
    agent_id: str,
    role: str,
    session_id: str,
    model: str,
    kind: str,
    step: int,
    index: int,
    duration_ms: int,
    since_turn_ms: int,
    tool: str | None = None,
    skill_id: str | None = None,
    is_error: bool | None = None,
    finish_reason: str | None = None,
    tokens: int | None = None,
    ttft_ms: int | None = None,
) -> None:
    """单步耗时：``kind=llm`` 为大模型一轮；``kind=tool`` 为一次工具/skill。"""
    step_zh = _zh_name_agent_step(
        role=role, kind=kind, index=index, tool=tool, skill_id=skill_id
    )
    detail_parts: list[str] = [f"自回合起{since_turn_ms}ms"]
    if is_error:
        detail_parts.append("失败")
    if finish_reason:
        detail_parts.append(f"finish={finish_reason}")
    if tokens is not None:
        detail_parts.append(f"tokens={tokens}")
    log_turn_step(
        session_id=session_id,
        step_name=step_zh,
        duration_ms=duration_ms,
        agent_id=agent_id,
        detail="；".join(detail_parts),
    )
    logger.info(
        "agent_step_timing",
        agent_id=agent_id,
        role=role,
        session_id=session_id,
        model=model,
        kind=kind,
        step=step,
        index=index,
        duration_ms=duration_ms,
        since_turn_ms=since_turn_ms,
        tool=tool,
        skill_id=skill_id,
        is_error=is_error,
        finish_reason=finish_reason,
        tokens=tokens,
        ttft_ms=ttft_ms,
    )


def log_route_timing(
    *,
    agent_id: str,
    role: str,
    session_id: str,
    model: str,
    total_ms: int,
    ms_to_first_text: int | None,
    ms_to_first_tool: int | None,
    first_tool: str | None,
    ms_to_first_invoke: int | None,
    invoke_intent: str | None,
    invoke_worker: str | None,
    ms_to_first_formfill: int | None,
    route_kind: str,
    dispatch_count: int,
    dispatch_worker_latency_ms: int | None,
    llm_turns: int = 0,
    tool_calls: int = 0,
    skill_calls: int = 0,
    sum_llm_ms: int = 0,
    sum_tool_ms: int = 0,
    sum_skill_ms: int = 0,
) -> None:
    """本轮路由相关耗时汇总（始终写入，便于与预路由方案对比）。"""
    detail_parts = [
        f"形态={route_kind}",
        f"LLM轮次={llm_turns}",
        f"工具={tool_calls}",
        f"LLM合计={sum_llm_ms}ms",
        f"工具合计={sum_tool_ms}ms",
    ]
    if ms_to_first_invoke is not None:
        detail_parts.append(f"首次委派={ms_to_first_invoke}ms")
    if invoke_worker:
        detail_parts.append(f"Worker={invoke_worker}")
    if invoke_intent:
        detail_parts.append(f"intent={invoke_intent}")
    if dispatch_worker_latency_ms is not None:
        detail_parts.append(f"Worker执行={dispatch_worker_latency_ms}ms")
    log_turn_step(
        session_id=session_id,
        step_name=f"{_role_zh(role)}·本轮汇总",
        duration_ms=total_ms,
        agent_id=agent_id,
        detail="；".join(detail_parts),
    )
    logger.info(
        "route_timing",
        agent_id=agent_id,
        role=role,
        session_id=session_id,
        model=model,
        total_ms=total_ms,
        ms_to_first_text=ms_to_first_text,
        ms_to_first_tool=ms_to_first_tool,
        first_tool=first_tool,
        ms_to_first_invoke=ms_to_first_invoke,
        invoke_intent=invoke_intent,
        invoke_worker=invoke_worker,
        ms_to_first_formfill=ms_to_first_formfill,
        route_kind=route_kind,
        dispatch_count=dispatch_count,
        dispatch_worker_latency_ms=dispatch_worker_latency_ms,
        llm_turns=llm_turns,
        tool_calls=tool_calls,
        skill_calls=skill_calls,
        sum_llm_ms=sum_llm_ms,
        sum_tool_ms=sum_tool_ms,
        sum_skill_ms=sum_skill_ms,
    )
