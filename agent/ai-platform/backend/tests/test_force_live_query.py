"""forceLiveQuery：历史助手占位不得写成可复述的正式回复。"""

from __future__ import annotations

from src.coordinator.passthrough import extract_passthrough_worker_text
from src.runtime.openharness import (
    _HISTORY_ASSISTANT_STUB,
    _apply_force_live_query,
    _platform_messages_to_conversation,
    is_force_live_stub_echo,
    strip_force_live_stub_markers,
)


def test_history_assistant_stub_is_empty() -> None:
    """占位须为空，避免模型原样输出到 UI。"""
    assert _HISTORY_ASSISTANT_STUB == ""
    assert "历史查询回复已省略" not in _HISTORY_ASSISTANT_STUB
    assert "prior_assistant_answer_omitted" not in _HISTORY_ASSISTANT_STUB


def test_apply_force_live_query_clears_prior_assistant_only() -> None:
    """非末条 assistant 正文清空；末条 user 追加强制提醒。"""
    platform = [
        {"role": "user", "content": "查卡号 818 画像"},
        {"role": "assistant", "content": "画像报告：积分 100"},
        {"role": "user", "content": "再生成一次画像报告"},
    ]
    messages = _platform_messages_to_conversation(platform)
    if not messages:
        # OpenHarness 不可用时跳过（CI 无依赖）
        return

    out = _apply_force_live_query(messages, turn_reminder="【强制】必须先调工具")
    assert len(out) == 3
    assert (getattr(out[1], "text", None) or "") == ""
    last_text = getattr(out[2], "text", None) or ""
    assert "再生成一次画像报告" in last_text
    assert "【强制】必须先调工具" in last_text
    assert "画像报告：积分 100" not in (getattr(out[1], "text", None) or "")


def test_is_force_live_stub_echo_detects_legacy_marker() -> None:
    assert is_force_live_stub_echo("[prior_assistant_answer_omitted]")
    assert is_force_live_stub_echo("  [prior_assistant_answer_omitted]  ")
    assert not is_force_live_stub_echo("宜兴城北店销售额 100 万")
    assert strip_force_live_stub_markers(
        "前缀[prior_assistant_answer_omitted]后缀"
    ) == "前缀后缀"


def test_passthrough_rejects_stub_echo_body() -> None:
    raw = (
        "[task:abc123def456] worker=spm-report status=completed latency=1ms\n\n"
        "[prior_assistant_answer_omitted]"
    )
    assert extract_passthrough_worker_text(raw) is None
    ok = (
        "[task:abc123def456] worker=spm-report status=completed latency=1ms\n\n"
        "宜兴城北店销售额"
    )
    assert extract_passthrough_worker_text(ok) == "宜兴城北店销售额"
