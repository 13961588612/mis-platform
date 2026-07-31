"""A2UI 挂起渲染缓冲（解耦工具与 OpenHarness 事件流）。

工具的 execute 在 agent 循环内部运行，无法直接 yield AgentEvent。
因此工具在需要下发 ui.render 时，将 (component, props) 推入按 session_id
分组的缓冲；OpenHarnessRuntime.run 在每轮 engine 结束后统一 drain 并
yield AgentEvent.ui_render，保证实体选择卡片可靠下发，且不依赖
OpenHarness 内部是否透传 ToolExecutionCompleted.metadata。
"""
from __future__ import annotations
from typing import Any

import asyncio

from src.utils.logging import get_logger

logger = get_logger("runtime.a2ui_pending")

_pending: dict[str, list[dict[str, Any]]] = {}
_lock = asyncio.Lock()


async def push_a2ui_render(
    session_id: str, component: str, props: dict[str, Any]
) -> None:
    """将一次 A2UI 渲染请求推入指定会话的缓冲。

    Args:
        session_id: 会话 ID。
        component: A2UI 组件名（须登记于 ``A2UI_COMPONENTS``）。
        props: 组件属性（纯数据 JSON）。
    """
    async with _lock:
        _pending.setdefault(session_id, []).append(
            {"component": component, "props": props}
        )
    logger.info("A2UI render pushed", session_id=session_id, component=component)


async def drain_a2ui_renders(session_id: str) -> list[dict[str, Any]]:
    """取出并清空指定会话的 A2UI 渲染缓冲。

    Args:
        session_id: 会话 ID。

    Returns:
        本轮回填产生的渲染请求列表（可能为空）。
    """
    async with _lock:
        items = _pending.pop(session_id, []) or []
    return items
