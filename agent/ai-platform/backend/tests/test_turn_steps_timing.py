"""逐步耗时采集：log_turn_step → SessionTiming.steps。"""

from __future__ import annotations

from src.agent.session_timing import SessionTimingRecorder
from src.runtime.step_timing import (
    log_turn_step,
    merge_steps_into,
    mirror_turn_steps,
    reset_mirror_turn_steps,
    steps_to_sub_stage_map,
)


def test_recorder_snapshot_includes_turn_steps() -> None:
    rec = SessionTimingRecorder("sess-parent", turn_key="msg-1")
    log_turn_step(
        session_id="sess-parent",
        step_name="意图预路由·JEV意图识别",
        duration_ms=400,
        agent_id="mis-copilot",
        detail="命中=spm_report",
    )
    log_turn_step(
        session_id="sess-parent",
        step_name="协调者·硬委派(跳过选人LLM)",
        duration_ms=0,
        agent_id="mis-copilot",
    )
    snap = rec.snapshot()
    rec.close()
    assert snap["schema_version"] == 3
    steps = snap["steps"]
    assert steps is not None
    assert len(steps) == 2
    assert steps[0]["name"] == "意图预路由·JEV意图识别"
    assert steps[0]["duration_ms"] == 400
    assert steps[1]["name"].startswith("协调者·硬委派")


def test_worker_steps_mirror_into_parent_list() -> None:
    parent = SessionTimingRecorder("sess-parent", turn_key="msg-p")
    token = mirror_turn_steps(parent._steps)
    try:
        worker = SessionTimingRecorder("sess-worker", turn_key="msg-w")
        log_turn_step(
            session_id="sess-worker",
            step_name="执行者·大模型第1轮",
            duration_ms=2000,
            agent_id="spm-report",
        )
        worker_snap = worker.snapshot()
        worker.close()
    finally:
        reset_mirror_turn_steps(token)

    parent_snap = parent.snapshot()
    parent.close()

    assert worker_snap["steps"] is not None
    assert any(s["name"] == "执行者·大模型第1轮" for s in worker_snap["steps"])
    assert parent_snap["steps"] is not None
    assert any(s["name"] == "执行者·大模型第1轮" for s in parent_snap["steps"])


def test_merge_steps_into_dedups_and_fills_parent() -> None:
    """委派结束后 Redis 回填：已镜像的不重复，缺失的可补上。"""
    parent: list[dict] = [
        {
            "name": "执行者·大模型第1轮",
            "duration_ms": 2000,
            "detail": None,
            "agent_id": "spm-report",
            "session_id": "sess-w",
        }
    ]
    from_redis = [
        {
            "name": "执行者·大模型第1轮",
            "duration_ms": 2000,
            "detail": None,
            "agent_id": "spm-report",
            "session_id": "sess-w",
        },
        {
            "name": "执行者·MCP工具(getStoreSales)",
            "duration_ms": 800,
            "detail": "自回合起3000ms",
            "agent_id": "spm-report",
            "session_id": "sess-w",
        },
    ]
    added = merge_steps_into(parent, from_redis)
    assert added == 1
    assert len(parent) == 2
    assert parent[1]["name"].startswith("执行者·MCP工具")


def test_steps_to_sub_stage_map_skips_summary() -> None:
    mapped = steps_to_sub_stage_map(
        [
            {"name": "执行者·大模型第1轮", "duration_ms": 1000},
            {"name": "执行者·本轮汇总", "duration_ms": 5000},
            {"name": "执行者·大模型第1轮", "duration_ms": 200},
        ]
    )
    assert mapped is not None
    assert mapped["执行者·大模型第1轮"] == 1200
    assert "执行者·本轮汇总" not in mapped
