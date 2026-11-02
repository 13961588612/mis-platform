"""父会话进度透传（Worker 工具步骤 + 正文流式 → 父 SSE）。

A2UI Copilot 只订父会话出站流。本模块用 ContextVar 挂上父会话 ``emit``：

- 工具：发 ``tool.step``（仅 CUSTOM，避免嵌套 ``tool.call`` 被 A2UI 中间件吞掉）
- 正文：发 ``text.delta``，实现委派报告真流式；收尾透传时若已流式则不再整段重推
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from src.runtime.events import AgentEvent, AgentEventType

#: 父会话事件下发回调；未设置时转发为空操作（单测 / 非 A2UI 路径）。
_PARENT_EMIT_CV: ContextVar[Callable[[AgentEvent], Awaitable[None]] | None] = ContextVar(
    "parent_tool_progress_emit",
    default=None,
)

#: 当前委派栈内 toolCallId FIFO（start/result 配对）。
_TOOL_STEP_IDS_CV: ContextVar[list[str] | None] = ContextVar(
    "parent_tool_step_ids",
    default=None,
)

#: 本轮委派是否已向父会话流式推送过正文（避免透传收尾重复整段）。
_PARENT_TEXT_STREAMED_CV: ContextVar[bool] = ContextVar(
    "parent_text_streamed",
    default=False,
)


def set_parent_progress_emit(
    emit: Callable[[AgentEvent], Awaitable[None]],
) -> Token[Callable[[AgentEvent], Awaitable[None]] | None]:
    """在 Coordinator 工具执行前挂上父会话 emit。"""
    _TOOL_STEP_IDS_CV.set([])
    _PARENT_TEXT_STREAMED_CV.set(False)
    return _PARENT_EMIT_CV.set(emit)


def reset_parent_progress_emit(
    token: Token[Callable[[AgentEvent], Awaitable[None]] | None],
) -> None:
    """恢复 ContextVar。"""
    _TOOL_STEP_IDS_CV.set(None)
    _PARENT_TEXT_STREAMED_CV.set(False)
    _PARENT_EMIT_CV.reset(token)


def parent_text_was_streamed() -> bool:
    """本轮委派是否已向父会话流式推送过 Worker 正文。"""
    return bool(_PARENT_TEXT_STREAMED_CV.get())


async def emit_parent_text_delta(content: str) -> None:
    """把 Worker ``text.delta`` 实时转到父会话（失败吞掉）。"""
    text = content or ""
    if not text:
        return
    emit = _PARENT_EMIT_CV.get()
    if emit is None:
        return
    try:
        await emit(AgentEvent.text_delta(text))
        _PARENT_TEXT_STREAMED_CV.set(True)
    except Exception:  # noqa: BLE001 - 进度失败不阻断 Worker
        return


async def emit_parent_tool_progress(event: AgentEvent) -> None:
    """若当前在委派上下文中，把 Worker 工具事件以 ``tool.step`` 转到父会话。

    失败吞掉，避免进度影响主流程。
    """
    if event.type not in (AgentEventType.TOOL_CALL, AgentEventType.TOOL_RESULT):
        return
    emit = _PARENT_EMIT_CV.get()
    if emit is None:
        return

    tool_name = (event.tool_name or "unknown").strip() or "unknown"
    try:
        if event.type == AgentEventType.TOOL_CALL:
            tool_call_id = f"w-{uuid4().hex[:8]}"
            stack = _TOOL_STEP_IDS_CV.get()
            if stack is None:
                stack = []
                _TOOL_STEP_IDS_CV.set(stack)
            stack.append(tool_call_id)
            await emit(
                AgentEvent.tool_step(
                    phase="start",
                    tool_name=tool_name,
                    tool_call_id=tool_call_id,
                    args=dict(event.args or {}),
                )
            )
            return

        stack = _TOOL_STEP_IDS_CV.get() or []
        tool_call_id = stack.pop() if stack else f"w-{uuid4().hex[:8]}"
        result: dict[str, Any] = (
            dict(event.result) if isinstance(event.result, dict) else {"value": event.result}
        )
        await emit(
            AgentEvent.tool_step(
                phase="result",
                tool_name=tool_name,
                tool_call_id=tool_call_id,
                result=result,
            )
        )
    except Exception:  # noqa: BLE001 - 进度失败不阻断 Worker
        return
