"""父会话进度透传（Worker 工具步骤 + 正文流式 → 父 SSE）。

A2UI Copilot 只订父会话出站流。本模块用 ContextVar 挂上父会话 ``emit``：

- 工具：发 ``tool.step``（仅 CUSTOM，避免嵌套 ``tool.call`` 被 A2UI 中间件吞掉）
- 正文：发 ``text.delta``，实现委派报告真流式；收尾透传时若已流式则不再整段重推

诊断：``parent_text_stream_stats()`` 给出 chunk 数 / 字数 / 跨度，可区分
「多段真流式」与「终稿一整包 dump」。
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from collections.abc import Awaitable, Callable
from time import perf_counter
from typing import Any
from uuid import uuid4

from src.runtime.events import AgentEvent, AgentEventType
from src.utils.logging import get_logger

logger = get_logger("coordinator.parent_progress")

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

#: 本轮委派正文流式统计（None = 未挂父 emit / 已复位）。
_PARENT_TEXT_STATS_CV: ContextVar[dict[str, Any] | None] = ContextVar(
    "parent_text_stream_stats",
    default=None,
)


def _empty_text_stats() -> dict[str, Any]:
    return {
        "delta_count": 0,
        "total_chars": 0,
        "first_chunk_chars": 0,
        "last_chunk_chars": 0,
        "max_chunk_chars": 0,
        "span_ms": 0,
        "emit_ok": 0,
        "emit_fail": 0,
        "_t0": None,
        "_t_last": None,
    }


def set_parent_progress_emit(
    emit: Callable[[AgentEvent], Awaitable[None]],
) -> Token[Callable[[AgentEvent], Awaitable[None]] | None]:
    """在 Coordinator 工具执行前挂上父会话 emit。"""
    _TOOL_STEP_IDS_CV.set([])
    _PARENT_TEXT_STATS_CV.set(_empty_text_stats())
    return _PARENT_EMIT_CV.set(emit)


def reset_parent_progress_emit(
    token: Token[Callable[[AgentEvent], Awaitable[None]] | None],
) -> None:
    """恢复 ContextVar。"""
    _TOOL_STEP_IDS_CV.set(None)
    _PARENT_TEXT_STATS_CV.set(None)
    _PARENT_EMIT_CV.reset(token)


def parent_text_was_streamed() -> bool:
    """本轮委派是否已向父会话成功推送过至少一段 Worker 正文。"""
    stats = _PARENT_TEXT_STATS_CV.get()
    return bool(stats and int(stats.get("emit_ok") or 0) > 0)


def parent_text_stream_stats() -> dict[str, Any]:
    """本轮委派正文回灌统计（供透传收尾日志判断真流式 vs 整包）。

    ``stream_mode``:
    - ``none``：未向父会话推过正文
    - ``single_dump``：仅 1 段（通常是 Worker 终稿 turn_complete 整包）
    - ``multi_chunk``：≥2 段（更接近真流式）
    """
    raw = _PARENT_TEXT_STATS_CV.get()
    if not raw:
        return {
            "delta_count": 0,
            "total_chars": 0,
            "first_chunk_chars": 0,
            "last_chunk_chars": 0,
            "max_chunk_chars": 0,
            "span_ms": 0,
            "emit_ok": 0,
            "emit_fail": 0,
            "stream_mode": "none",
        }
    count = int(raw.get("delta_count") or 0)
    emit_ok = int(raw.get("emit_ok") or 0)
    if emit_ok <= 0:
        mode = "none"
    elif count <= 1:
        mode = "single_dump"
    else:
        mode = "multi_chunk"
    return {
        "delta_count": count,
        "total_chars": int(raw.get("total_chars") or 0),
        "first_chunk_chars": int(raw.get("first_chunk_chars") or 0),
        "last_chunk_chars": int(raw.get("last_chunk_chars") or 0),
        "max_chunk_chars": int(raw.get("max_chunk_chars") or 0),
        "span_ms": int(raw.get("span_ms") or 0),
        "emit_ok": emit_ok,
        "emit_fail": int(raw.get("emit_fail") or 0),
        "stream_mode": mode,
    }


def format_parent_stream_detail(stats: dict[str, Any] | None = None) -> str:
    """一步耗时说明用短文案。"""
    s = stats if stats is not None else parent_text_stream_stats()
    mode = str(s.get("stream_mode") or "none")
    if mode == "none":
        return "父SSE正文=未流式"
    return (
        f"父SSE正文={mode}"
        f"(段数={s.get('delta_count')}"
        f"/字={s.get('total_chars')}"
        f"/跨度{s.get('span_ms')}ms"
        f"/首段{s.get('first_chunk_chars')}字"
        f"/最大段{s.get('max_chunk_chars')}字)"
    )


async def emit_parent_text_delta(content: str) -> None:
    """把 Worker ``text.delta`` 实时转到父会话（失败吞掉）。"""
    text = content or ""
    if not text:
        return
    emit = _PARENT_EMIT_CV.get()
    if emit is None:
        return
    stats = _PARENT_TEXT_STATS_CV.get()
    if stats is None:
        stats = _empty_text_stats()
        _PARENT_TEXT_STATS_CV.set(stats)
    now = perf_counter()
    try:
        await emit(AgentEvent.text_delta(text))
    except Exception:  # noqa: BLE001 - 进度失败不阻断 Worker
        stats["emit_fail"] = int(stats.get("emit_fail") or 0) + 1
        logger.warning(
            "parent_text_delta_emit_fail",
            chunk_chars=len(text),
            emit_fail=stats["emit_fail"],
        )
        return

    n = int(stats.get("delta_count") or 0) + 1
    chars = len(text)
    stats["delta_count"] = n
    stats["emit_ok"] = int(stats.get("emit_ok") or 0) + 1
    stats["total_chars"] = int(stats.get("total_chars") or 0) + chars
    stats["last_chunk_chars"] = chars
    stats["max_chunk_chars"] = max(int(stats.get("max_chunk_chars") or 0), chars)
    if n == 1:
        stats["first_chunk_chars"] = chars
        stats["_t0"] = now
    t0 = stats.get("_t0")
    stats["_t_last"] = now
    if isinstance(t0, float):
        stats["span_ms"] = max(0, int((now - t0) * 1000))

    # 首段 + 每 20 段打一次，避免 token 级刷屏；单段大包必打（整包 dump 诊断）
    if n == 1 or n % 20 == 0 or chars >= 80:
        logger.info(
            "parent_text_delta",
            chunk_index=n,
            chunk_chars=chars,
            total_chars=stats["total_chars"],
            span_ms=stats["span_ms"],
            preview=text[:48],
        )


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
