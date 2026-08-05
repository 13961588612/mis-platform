"""Coordinator–Worker 语义适配层。

对上暴露 OpenHarness 风格的调度语义（TaskBrief / task_notification /
dispatch_trace / Worker Catalog），对下调用平台既有 `AgentManager` +
`SessionManager`（in-process，非 subprocess Swarm，见 adr.md）。

分层原则（design-impl.md §1.2）：`src/skills/tools/invoke_agent.py` 只做编排
与治理（白名单 / 深度 / 超时），业务语义全部下沉到本包，便于后续替换适配层。

Note:
    `catalog` / `sessions` 两个子模块依赖 `ConfigManager` 与 `SessionManager`，
    为避免包导入期产生循环依赖，这里通过 PEP 562 `__getattr__` **惰性**导出。
"""

from __future__ import annotations

from typing import Any

from src.coordinator.brief import (
    LAZY_PATTERNS,
    MIN_BRIEF_CHARS,
    BriefValidationError,
    TaskBrief,
    TaskBriefBuilder,
    TaskBriefInputs,
    sanitize_page_context,
)
from src.coordinator.notification import (
    TaskNotification,
    TaskStatus,
    TaskUsage,
)
from src.coordinator.trace import (
    DISPATCH_TRACE_STATE_KEY,
    DISPATCH_TRACE_STATE_LIMIT,
    TRACE_STATUS_REJECTED,
    DispatchTraceEntry,
    dispatch_trace_enabled,
    dispatch_trace_event_enabled,
    dispatch_trace_sse_enabled,
    drain_dispatch_traces,
    peek_dispatch_traces,
    persist_dispatch_traces,
    push_dispatch_trace,
    take_last_turn_traces,
)

_LAZY_EXPORTS: dict[str, str] = {
    "WorkerCatalog": "src.coordinator.catalog",
    "WorkerSpec": "src.coordinator.catalog",
    "build_worker_catalog": "src.coordinator.catalog",
    "get_worker_catalog": "src.coordinator.catalog",
    "refresh_worker_catalog": "src.coordinator.catalog",
    "WorkerSessionRegistry": "src.coordinator.sessions",
    "get_worker_session_registry": "src.coordinator.sessions",
}

__all__ = [
    "BriefValidationError",
    "DISPATCH_TRACE_STATE_KEY",
    "DISPATCH_TRACE_STATE_LIMIT",
    "DispatchTraceEntry",
    "LAZY_PATTERNS",
    "MIN_BRIEF_CHARS",
    "TRACE_STATUS_REJECTED",
    "TaskBrief",
    "TaskBriefBuilder",
    "TaskBriefInputs",
    "TaskNotification",
    "TaskStatus",
    "TaskUsage",
    "WorkerCatalog",
    "WorkerSessionRegistry",
    "WorkerSpec",
    "build_worker_catalog",
    "dispatch_trace_enabled",
    "dispatch_trace_event_enabled",
    "dispatch_trace_sse_enabled",
    "drain_dispatch_traces",
    "get_worker_catalog",
    "get_worker_session_registry",
    "peek_dispatch_traces",
    "persist_dispatch_traces",
    "push_dispatch_trace",
    "refresh_worker_catalog",
    "sanitize_page_context",
    "take_last_turn_traces",
]


def __getattr__(name: str) -> Any:
    """惰性解析 catalog / sessions 子模块导出（PEP 562）。

    Args:
        name: 属性名。

    Returns:
        目标符号。

    Raises:
        AttributeError: 名称不在惰性导出表中。
    """
    module_path = _LAZY_EXPORTS.get(name)
    if module_path is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from importlib import import_module

    return getattr(import_module(module_path), name)
