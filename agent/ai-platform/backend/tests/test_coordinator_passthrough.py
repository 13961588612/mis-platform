"""Coordinator 透传 / 硬委派：信封解析与判定。"""

from __future__ import annotations

from src.coordinator.coordination_service import CoordinationDelegation
from src.coordinator.passthrough import (
    build_hard_dispatch_invoke_args,
    extract_passthrough_worker_text,
    should_hard_dispatch,
    should_passthrough_invoke,
)


def test_extract_completed_envelope() -> None:
    raw = (
        "[task:abc123def456] worker=spm-report status=completed latency=100ms\n\n"
        "溧阳区共 7 家门店"
    )
    assert extract_passthrough_worker_text(raw) == "溧阳区共 7 家门店"


def test_extract_rejects_failed_or_plain() -> None:
    assert extract_passthrough_worker_text("子智能体超时") is None
    assert (
        extract_passthrough_worker_text(
            "[task:x] worker=spm-report status=failed latency=1ms\n\nerr"
        )
        is None
    )


def test_should_passthrough_only_listed_worker() -> None:
    ok_result = {
        "ok": True,
        "output": (
            "[task:abc123def456] worker=spm-report status=completed latency=1ms\n\n"
            "正文"
        ),
    }
    allow = frozenset({"spm-report"})
    assert (
        should_passthrough_invoke(
            tool_name="agent__invoke",
            worker_id="spm-report",
            tool_result=ok_result,
            passthrough_workers=allow,
        )
        == "正文"
    )
    assert (
        should_passthrough_invoke(
            tool_name="agent__invoke",
            worker_id="mis-rag",
            tool_result=ok_result,
            passthrough_workers=allow,
        )
        is None
    )
    assert (
        should_passthrough_invoke(
            tool_name="agent__invoke",
            worker_id="spm-report",
            tool_result={"ok": False, "output": "fail", "error": "fail"},
            passthrough_workers=allow,
        )
        is None
    )


def test_coordination_delegation_accepts_passthrough_workers() -> None:
    d = CoordinationDelegation(
        worker_ids=["spm-report"],
        passthrough_workers=["spm-report"],
        hard_dispatch_workers=["spm-report"],
    )
    assert d.passthrough_workers == ["spm-report"]
    assert d.hard_dispatch_workers == ["spm-report"]


def test_should_hard_dispatch_only_listed_worker() -> None:
    allow = frozenset({"spm-report"})
    assert should_hard_dispatch(worker_id="spm-report", hard_dispatch_workers=allow)
    assert not should_hard_dispatch(worker_id="mis-rag", hard_dispatch_workers=allow)
    assert not should_hard_dispatch(worker_id="", hard_dispatch_workers=allow)


def test_build_hard_dispatch_invoke_args_has_brief() -> None:
    args = build_hard_dispatch_invoke_args(
        worker_id="spm-report",
        user_text="江阴有哪些超市门店",
        intent="spm_report",
    )
    assert args["agent_id"] == "spm-report"
    assert args["intent"] == "spm_report"
    assert args["content"] == "江阴有哪些超市门店"
    brief = args["task_brief"]
    assert "江阴" in brief["goal"]
    assert brief["inputs"]["user_question"] == "江阴有哪些超市门店"
    assert brief["purpose"] == "直接回复用户"
