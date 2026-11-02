"""父会话进度 ContextVar：tool.step + 正文流式 text.delta。"""

from __future__ import annotations

import pytest

from src.coordinator.parent_progress import (
    emit_parent_text_delta,
    emit_parent_tool_progress,
    parent_text_was_streamed,
    reset_parent_progress_emit,
    set_parent_progress_emit,
)
from src.runtime.events import AgentEvent, AgentEventType


@pytest.mark.asyncio
async def test_emit_parent_tool_progress_forwards_as_tool_step() -> None:
    received: list[AgentEvent] = []

    async def _emit(event: AgentEvent) -> None:
        received.append(event)

    token = set_parent_progress_emit(_emit)
    try:
        await emit_parent_tool_progress(
            AgentEvent.tool_call("skill", {"name": "sm-report-router"})
        )
        await emit_parent_tool_progress(
            AgentEvent.tool_result("skill", {"ok": True, "output": "..."})
        )
        await emit_parent_tool_progress(AgentEvent.text_delta("ignore me"))
    finally:
        reset_parent_progress_emit(token)

    assert len(received) == 2
    assert all(e.type == AgentEventType.TOOL_STEP for e in received)
    assert received[0].trace is not None
    assert received[0].trace["phase"] == "start"
    assert received[0].trace["toolName"] == "skill"
    assert received[0].trace["args"]["name"] == "sm-report-router"
    assert received[1].trace is not None
    assert received[1].trace["phase"] == "result"
    assert received[1].trace["toolCallId"] == received[0].trace["toolCallId"]


@pytest.mark.asyncio
async def test_emit_parent_tool_progress_noop_without_context() -> None:
    await emit_parent_tool_progress(AgentEvent.tool_call("skill", {}))


@pytest.mark.asyncio
async def test_emit_parent_text_delta_streams_and_sets_flag() -> None:
    received: list[AgentEvent] = []

    async def _emit(event: AgentEvent) -> None:
        received.append(event)

    token = set_parent_progress_emit(_emit)
    try:
        assert parent_text_was_streamed() is False
        await emit_parent_text_delta("溧阳区")
        await emit_parent_text_delta("共 7 家门店")
        assert parent_text_was_streamed() is True
    finally:
        reset_parent_progress_emit(token)

    assert parent_text_was_streamed() is False
    assert [e.content for e in received] == ["溧阳区", "共 7 家门店"]
    assert all(e.type == AgentEventType.TEXT_DELTA for e in received)


@pytest.mark.asyncio
async def test_emit_parent_text_delta_noop_without_context() -> None:
    await emit_parent_text_delta("无人接收")
    assert parent_text_was_streamed() is False
