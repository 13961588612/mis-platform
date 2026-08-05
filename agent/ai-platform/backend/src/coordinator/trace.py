"""dispatch_trace 挂起缓冲（解耦委派工具与 OpenHarness 事件流）。

`InvokeAgentTool.execute()` 在 agent 循环内部运行，无法直接 yield AgentEvent。
因此工具在完成一次委派后，把 :class:`DispatchTraceEntry` 推入按 session_id
分组的缓冲；`OpenHarnessRuntime.run` 在每轮 engine 结束后统一 drain，写入
`session.state["dispatch_trace"]` + 结构化日志，并按 feature flag 决定是否
额外 yield `AgentEvent.dispatch_trace(...)`。

本模块完全复刻 `src/runtime/a2ui_pending.py` 的 `dict + asyncio.Lock` 范式，
零新架构发明（design-impl.md §1.1 D1）。
"""

from __future__ import annotations

import asyncio
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.coordinator.flags import bool_flag
from src.utils.logging import get_logger

logger = get_logger("coordinator.trace")

DISPATCH_TRACE_STATE_KEY: str = "dispatch_trace"
"""`session.state` 中承载委派轨迹的键名。"""

DISPATCH_TRACE_STATE_LIMIT: int = 50
"""`session.state["dispatch_trace"]` 的条数上限（FIFO 淘汰，防 Redis 值膨胀）。"""

TRACE_STATUS_REJECTED: str = "rejected"
"""Brief 校验拒绝时的 trace 状态（**不进** `TaskStatus` 枚举，它不是一次真实委派）。"""


class DispatchTraceEntry(BaseModel):
    """单次委派的可观测记录（spec.md §7.2）。"""

    model_config = ConfigDict(extra="ignore")

    intent: str = Field(
        default="unknown",
        description="rag/crm/extract/summary/formfill/chitchat/unknown",
    )
    worker_id: str = ""
    tool: str = Field(
        default="agent__invoke", description="实际使用的委派工具名（双名过渡可为 agent）"
    )
    status: str = "completed"
    latency_ms: int = 0
    task_id: str = ""
    brief_rejected: bool = Field(
        default=False, description="是否因 Brief 校验失败而未真正委派"
    )


_pending: dict[str, list[dict[str, Any]]] = {}
_last_turn: dict[str, list[dict[str, Any]]] = {}
_lock = asyncio.Lock()


# ===== feature flag（三通道开关，统一经 flags 安全读取）=====


def dispatch_trace_enabled() -> bool:
    """通道 A：是否写 `session.state["dispatch_trace"]` + 结构化日志（默认开）。

    Returns:
        开启返回 True。
    """
    from src.config import get_settings

    return bool_flag(get_settings(), "DISPATCH_TRACE_ENABLED", True)


def dispatch_trace_sse_enabled() -> bool:
    """通道 B：SSE `done` 帧是否附加 `dispatchTrace` 字段（默认关）。

    Returns:
        开启返回 True。
    """
    from src.config import get_settings

    return bool_flag(get_settings(), "DISPATCH_TRACE_SSE_ENABLED", False)


def dispatch_trace_event_enabled() -> bool:
    """通道 C：是否额外 yield `AgentEvent.dispatch_trace` 事件（默认开）。

    Returns:
        开启返回 True。
    """
    from src.config import get_settings

    return bool_flag(get_settings(), "DISPATCH_TRACE_EVENT_ENABLED", True)


async def push_dispatch_trace(session_id: str, entry: DispatchTraceEntry) -> None:
    """将一条委派轨迹推入指定会话缓冲（与 a2ui_pending 同款范式）。

    Args:
        session_id: 父会话 ID；为空串时静默丢弃（无宿主会话可归属）。
        entry: 委派轨迹条目。
    """
    if not session_id:
        logger.debug("dispatch trace dropped (no session)", worker_id=entry.worker_id)
        return
    async with _lock:
        _pending.setdefault(session_id, []).append(entry.model_dump())
    logger.info(
        "dispatch trace pushed",
        session_id=session_id,
        worker_id=entry.worker_id,
        intent=entry.intent,
        status=entry.status,
        latency_ms=entry.latency_ms,
        task_id=entry.task_id,
    )


async def drain_dispatch_traces(session_id: str) -> list[dict[str, Any]]:
    """取出并清空指定会话的委派轨迹缓冲。

    Args:
        session_id: 会话 ID。

    Returns:
        本轮产生的委派轨迹列表（可能为空）。
    """
    if not session_id:
        return []
    async with _lock:
        items = _pending.pop(session_id, []) or []
        if items:
            # 保留一份「本轮快照」：SSE done 帧（通道 B）在 runtime drain 之后
            # 才组装，直接读 _pending 必然为空，故另存一份供其二次读取。
            _last_turn[session_id] = list(items)
    return items


async def peek_dispatch_traces(session_id: str) -> list[dict[str, Any]]:
    """只读查看指定会话**尚未 drain** 的委派轨迹缓冲。

    Args:
        session_id: 会话 ID。

    Returns:
        当前缓冲内容的浅拷贝（可能为空）。
    """
    if not session_id:
        return []
    async with _lock:
        return list(_pending.get(session_id, []))


async def take_last_turn_traces(session_id: str) -> list[dict[str, Any]]:
    """取出并清空「最近一轮已 drain」的委派轨迹快照。

    仅供 SSE `done` 帧（通道 B）使用；未开启通道 B 时不应调用，
    快照会随下一轮 drain 覆盖或在会话结束后自然消失。

    Args:
        session_id: 会话 ID。

    Returns:
        最近一轮的委派轨迹列表（可能为空）。
    """
    if not session_id:
        return []
    async with _lock:
        return _last_turn.pop(session_id, []) or []


async def persist_dispatch_traces(
    session_id: str, entries: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """把本轮委派轨迹追加写入 `session.state["dispatch_trace"]`（通道 A）。

    采用 FIFO 上限 :data:`DISPATCH_TRACE_STATE_LIMIT`，防止长会话把 Redis
    单值撑爆。会话不可用（未创建 / Redis 故障）时静默降级，**绝不**影响主链路。

    Args:
        session_id: 父会话 ID。
        entries: 本轮 drain 出的轨迹字典列表。

    Returns:
        写入后的完整 `dispatch_trace` 列表；降级时返回空列表。
    """
    if not (session_id and entries):
        return []
    # 懒导入：避免 coordinator ↔ agent.session 循环依赖（红线：保持既有懒导入范式）。
    from src.agent.session import get_session_manager

    try:
        manager = get_session_manager()
        session = await manager.get_session(session_id)
        if session is None:
            return []
        state = getattr(session, "state", None)
        if not isinstance(state, dict):
            return []
        history = state.get(DISPATCH_TRACE_STATE_KEY)
        if not isinstance(history, list):
            history = []
        history = [*history, *entries]
        if len(history) > DISPATCH_TRACE_STATE_LIMIT:
            history = history[-DISPATCH_TRACE_STATE_LIMIT:]
        state[DISPATCH_TRACE_STATE_KEY] = history
        await manager.save_session(session)
        return history
    except Exception as exc:  # noqa: BLE001 - 可观测性不得影响主链路
        logger.debug(
            "dispatch trace persist skipped", session_id=session_id, error=str(exc)
        )
        return []


def _reset_for_test() -> None:
    """清空全部会话缓冲（仅供单测 fixture 调用，见 design-impl.md §7.7）。"""
    _pending.clear()
    _last_turn.clear()
