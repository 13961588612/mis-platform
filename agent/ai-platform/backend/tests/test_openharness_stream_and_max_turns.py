"""Worker 真流式补齐 + MaxTurns soft-finish 辅助函数。

工具轮旁白可由前端在 tool.step start 时清空气泡；
``user_facing_text_for_llm_turn(has_tool_uses=True)`` 仍用于未直播缓冲路径。
"""

from __future__ import annotations

from src.runtime.openharness import (
    MAX_TURNS_USER_MESSAGE,
    is_max_turns_error_message,
    is_max_turns_exceeded,
    remainder_text_after_live_stream,
    user_facing_text_for_llm_turn,
)


def test_user_facing_hides_tool_turn_scratchpad() -> None:
    assert (
        user_facing_text_for_llm_turn(
            buffered_parts=["先加载 skill…"],
            has_tool_uses=True,
        )
        == ""
    )
    assert (
        user_facing_text_for_llm_turn(
            buffered_parts=["宜兴", "城北店"],
            has_tool_uses=False,
        )
        == "宜兴城北店"
    )


def test_remainder_after_live_stream() -> None:
    assert remainder_text_after_live_stream(full_text="abc", already_streamed="") == "abc"
    assert remainder_text_after_live_stream(full_text="abcdef", already_streamed="abc") == "def"
    assert remainder_text_after_live_stream(full_text="abc", already_streamed="abc") == ""
    assert remainder_text_after_live_stream(full_text="xyz", already_streamed="abc") == ""


def test_max_turns_message_helpers() -> None:
    assert is_max_turns_error_message("Exceeded maximum turn limit (20)")
    assert is_max_turns_error_message("MaxTurnsExceeded")
    assert not is_max_turns_error_message("timeout")
    assert is_max_turns_exceeded(RuntimeError("Exceeded maximum turn limit (20)"))
    assert MAX_TURNS_USER_MESSAGE.startswith("查询步骤过多")
