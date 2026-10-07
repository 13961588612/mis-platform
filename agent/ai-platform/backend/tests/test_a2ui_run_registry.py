"""a2ui_run_registry + cancel_all_running_tasks 单测。"""

from __future__ import annotations

import asyncio

import pytest

from src.coordinator.sessions import (
    cancel_all_running_tasks,
    register_running_task,
    unregister_running_task,
    _reset_for_test as reset_sessions,
)
from src.runtime.a2ui_run_registry import (
    cancel_a2ui_run,
    register_a2ui_run,
    unregister_a2ui_run,
    _reset_for_test as reset_a2ui,
)


@pytest.fixture(autouse=True)
def _clean() -> None:
    reset_sessions()
    reset_a2ui()
    yield
    reset_sessions()
    reset_a2ui()


@pytest.mark.asyncio
async def test_cancel_a2ui_run_cancels_registered_task() -> None:
    async def _hang() -> None:
        await asyncio.sleep(60)

    task = asyncio.create_task(_hang())
    register_a2ui_run("web-s1", task)
    assert cancel_a2ui_run("web-s1") is True
    await asyncio.sleep(0)
    assert task.cancelled() or task.done()
    unregister_a2ui_run("web-s1", task)


@pytest.mark.asyncio
async def test_cancel_all_running_tasks_for_parent() -> None:
    async def _hang() -> None:
        await asyncio.sleep(60)

    t1 = asyncio.create_task(_hang())
    t2 = asyncio.create_task(_hang())
    register_running_task("web-parent", "mis-iqd", t1)
    register_running_task("web-parent", "mis-rag", t2)
    assert cancel_all_running_tasks("web-parent") == 2
    await asyncio.sleep(0)
    assert t1.cancelled() or t1.done()
    assert t2.cancelled() or t2.done()
    unregister_running_task("web-parent", "mis-iqd")
    unregister_running_task("web-parent", "mis-rag")
