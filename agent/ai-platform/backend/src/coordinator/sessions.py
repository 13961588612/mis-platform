"""C5 增强：Worker 子会话注册表 / 并发闸口 / 失败熔断 / 运行任务停止。

对齐实现级设计 §3.1、§4.5 与任务 T05。

三块能力共用**同一份**会话态（`session.state`，已由 Redis 持久化 24h），
不引入任何新存储与新第三方依赖：

* `session.state["worker_sessions"]`：父会话 → `{worker_id: child_session_id}`，
  支撑 `mode="continue"` 续聊与 `mode="stop"` 停止；
* `session.state["worker_failures"]`：`{worker_id: {count, until_ts}}`，
  支撑单 Worker 连续失败后的会话内短路熔断；
* 进程内（按事件循环隔离）的 `Semaphore` / `Lock` / 运行任务表，
  支撑并行上限与主动取消。
"""

from __future__ import annotations

import asyncio
import time
import weakref
from typing import Any

from src.utils.logging import get_logger

logger = get_logger("coordinator.sessions")

WORKER_SESSIONS_STATE_KEY: str = "worker_sessions"
"""`session.state` 中承载父→子会话映射的键名。"""

WORKER_FAILURES_STATE_KEY: str = "worker_failures"
"""`session.state` 中承载熔断计数的键名。"""

FAILURE_COOLDOWN_SECONDS: int = 60
"""熔断触发后的短路时长（秒），design-impl.md §4.5 固定为 60s。"""

SAFETY_LEVEL_READ_ONLY: str = "read_only"
"""只读安全级别；只有该级别的 Worker 允许并行。"""


async def _load_session(session_id: str) -> Any | None:
    """按 ID 载入会话对象（异常静默降级为 None）。

    Args:
        session_id: 会话 ID。

    Returns:
        会话对象；不可用时返回 `None`。
    """
    if not session_id:
        return None
    # 懒导入：避免 tool_registry_builder ↔ agent.session 循环依赖，
    # 同时保证单测可 patch ``src.agent.session.get_session_manager``。
    from src.agent.session import get_session_manager

    try:
        manager = get_session_manager()
        return await manager.get_session(session_id)
    except Exception as exc:  # noqa: BLE001 - 会话不可用不应影响主链路
        logger.debug("worker session state unavailable", session_id=session_id, error=str(exc))
        return None


async def _save_session(session: Any) -> None:
    """保存会话对象（异常静默忽略）。

    Args:
        session: 会话对象。
    """
    from src.agent.session import get_session_manager

    try:
        await get_session_manager().save_session(session)
    except Exception as exc:  # noqa: BLE001 - 落盘失败不应影响主链路
        logger.debug("worker session state save failed", error=str(exc))


def _state_dict(session: Any, key: str) -> dict[str, Any]:
    """取出（必要时初始化）会话状态中的子字典。

    Args:
        session: 会话对象。
        key: 状态键名。

    Returns:
        可原地修改的字典。
    """
    state = getattr(session, "state", None)
    if not isinstance(state, dict):
        return {}
    bucket = state.get(key)
    if not isinstance(bucket, dict):
        bucket = {}
        state[key] = bucket
    return bucket


class WorkerSessionRegistry:
    """父会话 → Worker 子会话映射，落在 session.state["worker_sessions"]。"""

    async def get_or_none(self, parent_session_id: str, worker_id: str) -> str | None:
        """查询父会话下某 Worker 已绑定的子会话 ID。

        Args:
            parent_session_id: 父会话 ID。
            worker_id: Worker Agent ID。

        Returns:
            已绑定的子会话 ID；未绑定或会话不可用时返回 `None`。
        """
        session = await _load_session(parent_session_id)
        if session is None:
            return None
        value = _state_dict(session, WORKER_SESSIONS_STATE_KEY).get(worker_id)
        return str(value) if value else None

    async def bind(
        self, parent_session_id: str, worker_id: str, child_session_id: str
    ) -> None:
        """绑定父会话与 Worker 子会话。

        Args:
            parent_session_id: 父会话 ID。
            worker_id: Worker Agent ID。
            child_session_id: 子会话 ID。
        """
        if not (parent_session_id and worker_id and child_session_id):
            return
        session = await _load_session(parent_session_id)
        if session is None:
            return
        _state_dict(session, WORKER_SESSIONS_STATE_KEY)[worker_id] = child_session_id
        await _save_session(session)
        logger.info(
            "worker session bound",
            parent_session_id=parent_session_id,
            worker_id=worker_id,
            child_session_id=child_session_id,
        )

    async def unbind(self, parent_session_id: str, worker_id: str) -> None:
        """解除父会话与 Worker 子会话的绑定。

        Args:
            parent_session_id: 父会话 ID。
            worker_id: Worker Agent ID。
        """
        session = await _load_session(parent_session_id)
        if session is None:
            return
        bucket = _state_dict(session, WORKER_SESSIONS_STATE_KEY)
        if bucket.pop(worker_id, None) is None:
            return
        await _save_session(session)
        logger.info(
            "worker session unbound",
            parent_session_id=parent_session_id,
            worker_id=worker_id,
        )

    async def list_active(self, parent_session_id: str) -> dict[str, str]:
        """列出父会话当前持有的全部 Worker 子会话。

        Args:
            parent_session_id: 父会话 ID。

        Returns:
            `{worker_id: child_session_id}`；会话不可用时返回空字典。
        """
        session = await _load_session(parent_session_id)
        if session is None:
            return {}
        return {
            str(k): str(v)
            for k, v in _state_dict(session, WORKER_SESSIONS_STATE_KEY).items()
            if v
        }


_registry_singleton: WorkerSessionRegistry | None = None


def get_worker_session_registry() -> WorkerSessionRegistry:
    """返回进程内单例的 Worker 子会话注册表。

    Returns:
        :class:`WorkerSessionRegistry` 单例。
    """
    global _registry_singleton
    if _registry_singleton is None:
        _registry_singleton = WorkerSessionRegistry()
    return _registry_singleton


# ===== 失败熔断（会话内短路）=====


async def is_circuit_open(parent_session_id: str, worker_id: str) -> bool:
    """判断某 Worker 在当前会话内是否处于熔断短路窗口。

    Args:
        parent_session_id: 父会话 ID。
        worker_id: Worker Agent ID。

    Returns:
        仍在冷却窗口内返回 True。
    """
    session = await _load_session(parent_session_id)
    if session is None:
        return False
    entry = _state_dict(session, WORKER_FAILURES_STATE_KEY).get(worker_id)
    if not isinstance(entry, dict):
        return False
    try:
        until_ts = float(entry.get("until_ts") or 0)
    except (TypeError, ValueError):
        return False
    return until_ts > time.time()


async def record_failure(
    parent_session_id: str, worker_id: str, *, threshold: int
) -> bool:
    """记录一次 Worker 失败，达到阈值时开启熔断窗口。

    Args:
        parent_session_id: 父会话 ID。
        worker_id: Worker Agent ID。
        threshold: 连续失败阈值（<=0 表示不启用熔断）。

    Returns:
        本次调用是否触发了熔断窗口。
    """
    if threshold <= 0:
        return False
    session = await _load_session(parent_session_id)
    if session is None:
        return False
    bucket = _state_dict(session, WORKER_FAILURES_STATE_KEY)
    entry = bucket.get(worker_id)
    count = 0
    if isinstance(entry, dict):
        try:
            count = int(entry.get("count") or 0)
        except (TypeError, ValueError):
            count = 0
    count += 1
    tripped = count >= threshold
    bucket[worker_id] = {
        "count": count,
        "until_ts": time.time() + FAILURE_COOLDOWN_SECONDS if tripped else 0,
    }
    await _save_session(session)
    if tripped:
        logger.warning(
            "worker circuit opened",
            parent_session_id=parent_session_id,
            worker_id=worker_id,
            failures=count,
            cooldown_seconds=FAILURE_COOLDOWN_SECONDS,
        )
    return tripped


async def record_success(parent_session_id: str, worker_id: str) -> None:
    """记录一次 Worker 成功，清空其连续失败计数。

    Args:
        parent_session_id: 父会话 ID。
        worker_id: Worker Agent ID。
    """
    session = await _load_session(parent_session_id)
    if session is None:
        return
    bucket = _state_dict(session, WORKER_FAILURES_STATE_KEY)
    if bucket.pop(worker_id, None) is None:
        return
    await _save_session(session)


# ===== 并发闸口（按事件循环隔离，避免跨 loop 复用 Semaphore）=====

_semaphores: "weakref.WeakKeyDictionary[Any, tuple[int, asyncio.Semaphore]]" = (
    weakref.WeakKeyDictionary()
)
_serial_locks: "weakref.WeakKeyDictionary[Any, asyncio.Lock]" = weakref.WeakKeyDictionary()


def _current_loop() -> Any:
    """返回当前事件循环（优先运行中的循环，避免 3.12 弃用告警）。

    Returns:
        当前事件循环对象。
    """
    try:
        return asyncio.get_running_loop()
    except RuntimeError:  # pragma: no cover - 仅同步上下文调用时触发
        return asyncio.get_event_loop()


def get_parallel_semaphore(limit: int) -> asyncio.Semaphore:
    """返回当前事件循环上的并行委派信号量。

    Args:
        limit: 并行上限（<1 时按 1 处理）。

    Returns:
        当前事件循环共享的 :class:`asyncio.Semaphore`。
    """
    bounded = max(1, int(limit))
    loop = _current_loop()
    cached = _semaphores.get(loop)
    if cached is None or cached[0] != bounded:
        semaphore = asyncio.Semaphore(bounded)
        _semaphores[loop] = (bounded, semaphore)
        return semaphore
    return cached[1]


def get_serial_lock() -> asyncio.Lock:
    """返回当前事件循环上的「写类 Worker 串行锁」。

    Returns:
        当前事件循环共享的 :class:`asyncio.Lock`。
    """
    loop = _current_loop()
    lock = _serial_locks.get(loop)
    if lock is None:
        lock = asyncio.Lock()
        _serial_locks[loop] = lock
    return lock


# ===== 运行中任务表（支撑 mode="stop" 主动取消）=====

_running_tasks: dict[tuple[str, str], asyncio.Task[Any]] = {}


def register_running_task(
    parent_session_id: str, worker_id: str, task: asyncio.Task[Any]
) -> None:
    """登记一个运行中的 Worker 任务，供 `mode="stop"` 取消。

    Args:
        parent_session_id: 父会话 ID。
        worker_id: Worker Agent ID。
        task: 正在运行的 asyncio 任务。
    """
    if not parent_session_id or not worker_id:
        return
    _running_tasks[(parent_session_id, worker_id)] = task


def unregister_running_task(parent_session_id: str, worker_id: str) -> None:
    """注销运行中的 Worker 任务登记。

    Args:
        parent_session_id: 父会话 ID。
        worker_id: Worker Agent ID。
    """
    _running_tasks.pop((parent_session_id, worker_id), None)


def cancel_running_task(parent_session_id: str, worker_id: str) -> bool:
    """取消运行中的 Worker 任务。

    Args:
        parent_session_id: 父会话 ID。
        worker_id: Worker Agent ID。

    Returns:
        确实发出了取消信号返回 True。
    """
    task = _running_tasks.get((parent_session_id, worker_id))
    if task is None or task.done():
        return False
    task.cancel()
    logger.info(
        "worker task cancelled",
        parent_session_id=parent_session_id,
        worker_id=worker_id,
    )
    return True


def _reset_for_test() -> None:
    """清空进程内并发/任务状态（仅供单测 fixture 调用）。"""
    _running_tasks.clear()
    _semaphores.clear()
    _serial_locks.clear()
