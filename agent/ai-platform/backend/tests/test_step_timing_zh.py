"""对话步骤中文耗时日志。"""

from __future__ import annotations

from src.runtime.step_timing import (
    _zh_name_agent_step,
    log_agent_step_timing,
    log_route_timing,
    log_turn_step,
)


def test_zh_step_names() -> None:
    assert (
        _zh_name_agent_step(
            role="coordinator", kind="llm", index=1, tool=None, skill_id=None
        )
        == "协调者·大模型第1轮"
    )
    assert (
        _zh_name_agent_step(
            role="coordinator",
            kind="tool",
            index=1,
            tool="agent__invoke",
            skill_id=None,
        )
        == "协调者·委派Worker"
    )
    assert "加载Skill(sm-report-router)" in _zh_name_agent_step(
        role="worker",
        kind="tool",
        index=1,
        tool="skill",
        skill_id="sm-report-router",
    )


def test_log_turn_step_and_wrappers_do_not_raise(caplog) -> None:
    log_turn_step(
        session_id="web-test",
        step_name="意图预路由·JEV意图识别",
        duration_ms=120,
        agent_id="mis-copilot",
        detail="命中=spm_report",
    )
    log_agent_step_timing(
        agent_id="mis-copilot",
        role="coordinator",
        session_id="web-test",
        model="qwen",
        kind="llm",
        step=1,
        index=1,
        duration_ms=9000,
        since_turn_ms=9000,
    )
    log_route_timing(
        agent_id="mis-copilot",
        role="coordinator",
        session_id="web-test",
        model="qwen",
        total_ms=30000,
        ms_to_first_text=9000,
        ms_to_first_tool=9000,
        first_tool="agent__invoke",
        ms_to_first_invoke=9000,
        invoke_intent="spm",
        invoke_worker="spm-report",
        ms_to_first_formfill=None,
        route_kind="invoke",
        dispatch_count=1,
        dispatch_worker_latency_ms=18000,
        llm_turns=2,
        tool_calls=1,
        sum_llm_ms=18000,
        sum_tool_ms=18000,
    )
