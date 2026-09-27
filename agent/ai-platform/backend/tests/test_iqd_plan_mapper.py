"""PlanMapper 逐步耗时。"""

from __future__ import annotations

import time

from src.agent.mis_iqd.plan_mapper import PlanMapper


def test_plan_step_duration_accumulates() -> None:
    mapper = PlanMapper()
    steps = mapper.build_empty()
    time.sleep(0.02)
    mapper.mark_done(steps, "scope_check")
    time.sleep(0.03)
    mapper.mark(steps, "executing", "running")
    time.sleep(0.04)
    mapper.mark_done(steps, "executing", detail="ok")

    by_code = {s.code: s for s in steps}
    assert by_code["scope_check"].status == "done"
    assert by_code["scope_check"].duration_ms >= 15
    assert by_code["executing"].status == "done"
    assert by_code["executing"].duration_ms >= 30
    assert by_code["executing"].detail == "ok"
