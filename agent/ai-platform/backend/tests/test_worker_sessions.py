"""C5 增强单元测试：Worker 子会话续聊 / 并行闸口 / 停止 / 失败熔断。

对齐 design-impl.md §4.5 与任务 T05。全部断言只针对**结构化状态与调用事实**
（session.state / 轨迹 / mock 调用次数），不对 LLM 文本断言。
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openharness.tools.base import ToolExecutionContext

from src.coordinator import sessions as sessions_mod
from src.coordinator import trace as trace_mod
from src.coordinator.sessions import (
    FAILURE_COOLDOWN_SECONDS,
    WORKER_FAILURES_STATE_KEY,
    WORKER_SESSIONS_STATE_KEY,
    cancel_running_task,
    get_parallel_semaphore,
    get_serial_lock,
    get_worker_session_registry,
    is_circuit_open,
    record_failure,
    record_success,
    register_running_task,
    unregister_running_task,
)
from src.runtime.events import AgentEvent, AgentEventType
from src.skills.tools.invoke_agent import (
    DEFAULT_WHITELIST,
    InvokeAgentInput,
    InvokeAgentTool,
)


@pytest.fixture(autouse=True)
def _clean_process_state() -> Any:
    """清空进程内并发/任务/轨迹状态，避免用例间串味。"""
    sessions_mod._reset_for_test()
    trace_mod._reset_for_test()
    yield
    sessions_mod._reset_for_test()
    trace_mod._reset_for_test()


def _ctx(metadata: dict[str, Any] | None = None) -> ToolExecutionContext:
    """构造工具执行上下文。

    Args:
        metadata: 上下文元数据。

    Returns:
        :class:`ToolExecutionContext`。
    """
    return ToolExecutionContext(cwd=Path("."), metadata=metadata or {})


def _settings(**overrides: Any) -> MagicMock:
    """构造 settings mock（新开关默认交给 flags 安全回落）。

    Args:
        **overrides: 显式覆盖项。

    Returns:
        `MagicMock` 形态的 settings。
    """
    base: dict[str, Any] = {
        "INVOKE_AGENT_WHITELIST": list(DEFAULT_WHITELIST),
        "INVOKE_AGENT_MAX_DEPTH": 1,
        "INVOKE_AGENT_TIMEOUT_SECONDS": 30,
    }
    base.update(overrides)
    return MagicMock(**base)


class _FakeSession:
    """最小可用的会话替身（只暴露 session_id / state / 身份字段）。"""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.state: dict[str, Any] = {}
        self.user_id = "u1"
        self.channel = "mis_bff"
        self.user_mobile = ""
        self.channel_user_id = "u1"


class _FakeSessionManager:
    """按 ID 存取 :class:`_FakeSession` 的会话管理器替身。"""

    def __init__(self, *sessions: _FakeSession) -> None:
        self.store: dict[str, _FakeSession] = {s.session_id: s for s in sessions}
        self.created: list[str] = []
        self.saved: list[str] = []
        self._seq = 0

    async def get_session(self, session_id: str) -> _FakeSession | None:
        """按 ID 取会话。

        Args:
            session_id: 会话 ID。

        Returns:
            会话对象或 `None`。
        """
        return self.store.get(session_id)

    async def create_session(self, **kwargs: Any) -> _FakeSession:
        """新建子会话。

        Args:
            **kwargs: agent_id / user_id / channel。

        Returns:
            新建的会话对象。
        """
        self._seq += 1
        session = _FakeSession(f"child-{self._seq}")
        self.store[session.session_id] = session
        self.created.append(session.session_id)
        return session

    async def save_session(self, session: _FakeSession) -> None:
        """保存会话。

        Args:
            session: 会话对象。
        """
        self.saved.append(session.session_id)
        self.store[session.session_id] = session


def _worker_instance(text: str = "结果正文") -> MagicMock:
    """构造正常返回文本的 Worker 实例 mock。

    Args:
        text: 输出文本。

    Returns:
        agent instance mock。
    """

    async def _events(*_a: Any, **_k: Any) -> Any:
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content=text)
        yield AgentEvent(type=AgentEventType.DONE)

    instance = MagicMock()
    instance.process_message = _events
    return instance


# ===== WorkerSessionRegistry =====


@pytest.mark.asyncio
async def test_registry_bind_get_list_unbind() -> None:
    """绑定 → 查询 → 列举 → 解绑 全链路落在 session.state。"""
    parent = _FakeSession("p1")
    manager = _FakeSessionManager(parent)
    registry = get_worker_session_registry()

    with patch("src.agent.session.get_session_manager", return_value=manager):
        assert await registry.get_or_none("p1", "mis-rag") is None
        await registry.bind("p1", "mis-rag", "child-a")
        assert await registry.get_or_none("p1", "mis-rag") == "child-a"
        assert await registry.list_active("p1") == {"mis-rag": "child-a"}
        await registry.unbind("p1", "mis-rag")
        assert await registry.get_or_none("p1", "mis-rag") is None

    assert parent.state[WORKER_SESSIONS_STATE_KEY] == {}


@pytest.mark.asyncio
async def test_registry_degrades_when_session_missing() -> None:
    """父会话不可用时全部方法静默降级，不抛异常。"""
    manager = _FakeSessionManager()
    registry = get_worker_session_registry()

    with patch("src.agent.session.get_session_manager", return_value=manager):
        await registry.bind("missing", "mis-rag", "child-a")
        assert await registry.get_or_none("missing", "mis-rag") is None
        assert await registry.list_active("missing") == {}
        await registry.unbind("missing", "mis-rag")

    assert manager.saved == []


# ===== 熔断 =====


@pytest.mark.asyncio
async def test_circuit_opens_after_threshold_and_clears_on_success() -> None:
    """连续失败达阈值开启熔断；一次成功即清零。"""
    parent = _FakeSession("p2")
    manager = _FakeSessionManager(parent)

    with patch("src.agent.session.get_session_manager", return_value=manager):
        assert await is_circuit_open("p2", "crm-assistant") is False
        assert await record_failure("p2", "crm-assistant", threshold=3) is False
        assert await record_failure("p2", "crm-assistant", threshold=3) is False
        assert await is_circuit_open("p2", "crm-assistant") is False
        assert await record_failure("p2", "crm-assistant", threshold=3) is True
        assert await is_circuit_open("p2", "crm-assistant") is True

        bucket = parent.state[WORKER_FAILURES_STATE_KEY]["crm-assistant"]
        assert bucket["count"] == 3
        assert bucket["until_ts"] <= time.time() + FAILURE_COOLDOWN_SECONDS

        await record_success("p2", "crm-assistant")
        assert await is_circuit_open("p2", "crm-assistant") is False


@pytest.mark.asyncio
async def test_circuit_closes_after_cooldown_expires() -> None:
    """冷却窗口过期后自动恢复。"""
    parent = _FakeSession("p3")
    parent.state[WORKER_FAILURES_STATE_KEY] = {
        "mis-rag": {"count": 9, "until_ts": time.time() - 1}
    }
    manager = _FakeSessionManager(parent)

    with patch("src.agent.session.get_session_manager", return_value=manager):
        assert await is_circuit_open("p3", "mis-rag") is False


@pytest.mark.asyncio
async def test_circuit_disabled_when_threshold_zero() -> None:
    """阈值为 0 表示关闭熔断，不写任何状态。"""
    parent = _FakeSession("p4")
    manager = _FakeSessionManager(parent)

    with patch("src.agent.session.get_session_manager", return_value=manager):
        assert await record_failure("p4", "mis-rag", threshold=0) is False

    assert WORKER_FAILURES_STATE_KEY not in parent.state


@pytest.mark.asyncio
async def test_invoke_short_circuits_when_worker_circuit_open() -> None:
    """熔断窗口内直接返回 FAILED，不再触达 Worker。"""
    parent = _FakeSession("p5")
    parent.state[WORKER_FAILURES_STATE_KEY] = {
        "crm-assistant": {"count": 3, "until_ts": time.time() + 30}
    }
    manager = _FakeSessionManager(parent)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock()
    settings = _settings(INVOKE_AGENT_FAILURE_THRESHOLD=3)
    tool = InvokeAgentTool()

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="crm-assistant", content="查询会员积分余额与等级"),
            _ctx({"session_id": "p5"}),
        )

    assert result.is_error
    assert "熔断" in result.output
    agent_mgr.ensure_agent_ready.assert_not_awaited()

    items = await trace_mod.drain_dispatch_traces("p5")
    assert items[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_invoke_records_failure_then_clears_on_success() -> None:
    """一次失败累计计数，随后一次成功清空计数。"""
    parent = _FakeSession("p6")
    manager = _FakeSessionManager(parent)
    settings = _settings(INVOKE_AGENT_FAILURE_THRESHOLD=3)
    tool = InvokeAgentTool()

    failing_mgr = MagicMock()
    failing_mgr.ensure_agent_ready = AsyncMock(side_effect=RuntimeError("boom"))
    ok_mgr = MagicMock()
    ok_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=failing_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        failed = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p6"}),
        )
    assert failed.is_error
    assert parent.state[WORKER_FAILURES_STATE_KEY]["mis-rag"]["count"] == 1

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=ok_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        ok = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p6"}),
        )
    assert not ok.is_error
    assert parent.state[WORKER_FAILURES_STATE_KEY] == {}


# ===== 续聊（mode="continue"）=====


@pytest.mark.asyncio
async def test_spawn_binds_child_session() -> None:
    """spawn 成功后把子会话绑定到父会话状态，供后续续聊。"""
    parent = _FakeSession("p7")
    manager = _FakeSessionManager(parent)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())
    tool = InvokeAgentTool()

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p7"}),
        )

    assert not result.is_error
    assert parent.state[WORKER_SESSIONS_STATE_KEY] == {"mis-rag": manager.created[0]}


@pytest.mark.asyncio
async def test_continue_disabled_falls_back_to_spawn() -> None:
    """开关关闭（默认）时 continue 静默降级为新建子会话。"""
    parent = _FakeSession("p8")
    parent.state[WORKER_SESSIONS_STATE_KEY] = {"mis-rag": "child-old"}
    manager = _FakeSessionManager(parent, _FakeSession("child-old"))
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())
    tool = InvokeAgentTool()

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        result = await tool.execute(
            InvokeAgentInput(
                agent_id="mis-rag",
                content="继续检索上一条制度的适用范围与例外条款",
                mode="continue",
            ),
            _ctx({"session_id": "p8"}),
        )

    assert not result.is_error
    assert manager.created, "开关关闭时应新建子会话"
    assert parent.state[WORKER_SESSIONS_STATE_KEY]["mis-rag"] == manager.created[0]


@pytest.mark.asyncio
async def test_continue_reuses_bound_child_session() -> None:
    """开关开启且已绑定时复用原子会话，不再新建。"""
    parent = _FakeSession("p9")
    parent.state[WORKER_SESSIONS_STATE_KEY] = {"mis-rag": "child-old"}
    manager = _FakeSessionManager(parent, _FakeSession("child-old"))
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())
    settings = _settings(INVOKE_AGENT_CONTINUE_ENABLED=True)
    tool = InvokeAgentTool()

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        result = await tool.execute(
            InvokeAgentInput(
                agent_id="mis-rag",
                content="继续检索上一条制度的适用范围与例外条款",
                mode="continue",
            ),
            _ctx({"session_id": "p9"}),
        )

    assert not result.is_error
    assert manager.created == [], "命中续聊锚点时不应新建子会话"
    assert parent.state[WORKER_SESSIONS_STATE_KEY]["mis-rag"] == "child-old"


@pytest.mark.asyncio
async def test_continue_miss_falls_back_to_spawn() -> None:
    """开关开启但无锚点时静默降级为 spawn。"""
    parent = _FakeSession("p10")
    manager = _FakeSessionManager(parent)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())
    settings = _settings(INVOKE_AGENT_CONTINUE_ENABLED=True)
    tool = InvokeAgentTool()

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        result = await tool.execute(
            InvokeAgentInput(
                agent_id="mis-rag",
                content="检索差旅报销标准并给出条款依据",
                mode="continue",
            ),
            _ctx({"session_id": "p10"}),
        )

    assert not result.is_error
    assert len(manager.created) == 1


# ===== 停止（mode="stop"）=====


@pytest.mark.asyncio
async def test_stop_cancels_running_task_and_unbinds() -> None:
    """stop 取消运行中任务、解绑子会话并返回 killed 轨迹。"""
    parent = _FakeSession("p11")
    parent.state[WORKER_SESSIONS_STATE_KEY] = {"mis-rag": "child-old"}
    manager = _FakeSessionManager(parent, _FakeSession("child-old"))
    tool = InvokeAgentTool()

    started = asyncio.Event()

    async def _never_ends() -> None:
        started.set()
        await asyncio.sleep(30)

    task: asyncio.Task[None] = asyncio.ensure_future(_never_ends())
    await started.wait()
    register_running_task("p11", "mis-rag", task)

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="停止", mode="stop"),
            _ctx({"session_id": "p11"}),
        )

    await asyncio.sleep(0)
    assert task.cancelled() or task.done()
    assert not result.is_error
    assert parent.state[WORKER_SESSIONS_STATE_KEY] == {}

    items = await trace_mod.drain_dispatch_traces("p11")
    assert items[0]["status"] == "killed"
    unregister_running_task("p11", "mis-rag")


@pytest.mark.asyncio
async def test_stop_without_active_task_is_idempotent() -> None:
    """没有进行中任务时 stop 也返回正常结果，不抛异常。"""
    parent = _FakeSession("p12")
    manager = _FakeSessionManager(parent)
    tool = InvokeAgentTool()

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-summary", content="停止", mode="stop"),
            _ctx({"session_id": "p12"}),
        )

    assert not result.is_error
    assert cancel_running_task("p12", "mis-summary") is False


# ===== 并发闸口 =====


@pytest.mark.asyncio
async def test_parallel_semaphore_reflects_limit() -> None:
    """信号量按配置上限创建，同 loop 内复用；上限变化时重建。"""
    first = get_parallel_semaphore(1)
    assert get_parallel_semaphore(1) is first
    assert first._value == 1

    second = get_parallel_semaphore(3)
    assert second is not first
    assert second._value == 3
    # 非法下限被裁剪为 1
    assert get_parallel_semaphore(0)._value == 1


@pytest.mark.asyncio
async def test_serial_lock_is_shared_per_loop() -> None:
    """同一事件循环内共享同一把串行锁。"""
    assert get_serial_lock() is get_serial_lock()


@pytest.mark.asyncio
async def test_default_max_parallel_serializes_dispatch() -> None:
    """默认 INVOKE_AGENT_MAX_PARALLEL=1 时两次委派串行执行（语义等价现网）。"""
    parent = _FakeSession("p13")
    manager = _FakeSessionManager(parent)
    tool = InvokeAgentTool()

    concurrency = {"now": 0, "peak": 0}

    async def _events(*_a: Any, **_k: Any) -> Any:
        concurrency["now"] += 1
        concurrency["peak"] = max(concurrency["peak"], concurrency["now"])
        await asyncio.sleep(0.02)
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content="ok")
        yield AgentEvent(type=AgentEventType.DONE)
        concurrency["now"] -= 1

    instance = MagicMock()
    instance.process_message = _events
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=instance)

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        results = await asyncio.gather(
            tool.execute(
                InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
                _ctx({"session_id": "p13"}),
            ),
            tool.execute(
                InvokeAgentInput(agent_id="mis-summary", content="对本页审批意见做要点摘要"),
                _ctx({"session_id": "p13"}),
            ),
        )

    assert all(not r.is_error for r in results)
    assert concurrency["peak"] == 1


@pytest.mark.asyncio
async def test_raised_max_parallel_allows_overlap() -> None:
    """上调 INVOKE_AGENT_MAX_PARALLEL 后只读 Worker 可并行。"""
    parent = _FakeSession("p14")
    manager = _FakeSessionManager(parent)
    tool = InvokeAgentTool()

    concurrency = {"now": 0, "peak": 0}

    async def _events(*_a: Any, **_k: Any) -> Any:
        concurrency["now"] += 1
        concurrency["peak"] = max(concurrency["peak"], concurrency["now"])
        await asyncio.sleep(0.02)
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content="ok")
        yield AgentEvent(type=AgentEventType.DONE)
        concurrency["now"] -= 1

    instance = MagicMock()
    instance.process_message = _events
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=instance)
    settings = _settings(INVOKE_AGENT_MAX_PARALLEL=2)

    with (
        patch("src.agent.session.get_session_manager", return_value=manager),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        results = await asyncio.gather(
            tool.execute(
                InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
                _ctx({"session_id": "p14"}),
            ),
            tool.execute(
                InvokeAgentInput(agent_id="mis-summary", content="对本页审批意见做要点摘要"),
                _ctx({"session_id": "p14"}),
            ),
        )

    assert all(not r.is_error for r in results)
    assert concurrency["peak"] == 2
