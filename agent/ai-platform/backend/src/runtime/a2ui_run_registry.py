"""A2UI run 任务登记 — 支撑 generation.cancel 主动取消当前会话生成。

进程内表（与 coordinator.sessions._running_tasks 同档）：单实例本地可用；
多副本 cancel 跨进程为二期（见 agent-multi-replica-scaling）。
"""

from __future__ import annotations

import asyncio
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

_a2ui_runs: dict[str, asyncio.Task[Any]] = {}


def register_a2ui_run(session_id: str, task: asyncio.Task[Any]) -> None:
    """登记会话当前 A2UI run 任务（同会话新 run 覆盖旧登记）。"""
    sid = (session_id or "").strip()
    if not sid:
        return
    _a2ui_runs[sid] = task


def unregister_a2ui_run(session_id: str, task: asyncio.Task[Any] | None = None) -> None:
    """注销登记；若传入 task 则仅当仍是该 task 时才删（避免误清新 run）。"""
    sid = (session_id or "").strip()
    if not sid:
        return
    current = _a2ui_runs.get(sid)
    if current is None:
        return
    if task is not None and current is not task:
        return
    _a2ui_runs.pop(sid, None)


def cancel_a2ui_run(session_id: str) -> bool:
    """取消会话当前 A2UI run。

    Returns:
        确实发出了取消信号返回 True。
    """
    sid = (session_id or "").strip()
    if not sid:
        return False
    task = _a2ui_runs.get(sid)
    if task is None or task.done():
        return False
    task.cancel()
    logger.info("a2ui run cancelled", session_id=sid)
    return True


def _reset_for_test() -> None:
    """清空登记（仅单测）。"""
    _a2ui_runs.clear()
