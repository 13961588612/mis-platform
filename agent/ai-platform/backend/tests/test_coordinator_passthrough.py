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
    assert args["mode"] == "continue"
    brief = args["task_brief"]
    assert "江阴" in brief["goal"]
    assert brief["inputs"]["user_question"] == "江阴有哪些超市门店"
    assert brief["inputs"]["attachments_text"] == ""
    assert brief["purpose"] == "直接回复用户"


def test_build_hard_dispatch_carries_conversation_context() -> None:
    ctx = (
        "【对话上文】\n"
        "用户: 宜兴城中店\n"
        "助手: 已确认宜兴城中店(0001)\n"
        "【本轮用户】\n"
        "各部门销售情况"
    )
    args = build_hard_dispatch_invoke_args(
        worker_id="spm-report",
        user_text="各部门销售情况",
        intent="spm_report",
        conversation_context=ctx,
    )
    brief = args["task_brief"]
    assert brief["inputs"]["user_question"] == "各部门销售情况"
    assert "宜兴城中店" in brief["inputs"]["attachments_text"]
    assert any("一律沿用" in c for c in brief["constraints"])
    assert "已确认的全部条件" in brief["goal"]


def test_build_hard_dispatch_expands_short_affirmation() -> None:
    from src.coordinator.passthrough import is_short_affirmation

    assert is_short_affirmation("需要")
    assert is_short_affirmation("好的")
    assert not is_short_affirmation("需要看毛利")

    ctx = (
        "【对话上文】\n"
        "用户: 宜兴城北店昨天销售\n"
        "助手: 毛利转负。需要的话，可以只看生鲜类柜组（肉品/水产/蔬菜/水果）"
        "这两天的折扣与出清结构。\n"
        "【本轮用户】\n"
        "需要"
    )
    args = build_hard_dispatch_invoke_args(
        worker_id="spm-report",
        user_text="需要",
        intent="spm_report",
        conversation_context=ctx,
    )
    brief = args["task_brief"]
    assert brief["inputs"]["user_question"] == "需要"
    assert "确认执行" in brief["goal"]
    assert "折扣与出清" in brief["goal"]
    assert any("短确认" in c for c in brief["constraints"])


def test_extract_passthrough_rejects_garbage_body() -> None:
    junk = (
        'i1=70659843={"2ba3b0p0p99<ceava2.;p3012P013F1120131401314031403140'
        "3140314031314031403131403140314031403140314031403140314031403140"
    )
    raw = f"[task:abc123def456] worker=spm-report status=completed latency=1ms\n\n{junk}"
    # 乱码不得当成功正文透传（应由委派层显式失败）
    assert extract_passthrough_worker_text(raw) is None

    from src.runtime.gateway_api_client import MODEL_GARBAGE_RETRY_MESSAGE

    legacy = (
        f"[task:abc123def456] worker=spm-report status=completed latency=1ms\n\n"
        f"{MODEL_GARBAGE_RETRY_MESSAGE}"
    )
    assert extract_passthrough_worker_text(legacy) is None
