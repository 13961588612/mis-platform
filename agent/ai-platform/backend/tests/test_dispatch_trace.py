"""dispatch_trace 三通道单元测试（C2 可观测性）。

覆盖 design-impl.md §4.4 / §7.2：

* 通道 A（默认开）：缓冲 → drain → 写 `session.state["dispatch_trace"]`（FIFO 上限 50）；
* 通道 B（默认关）：SSE `done` 帧快照 `take_last_turn_traces`；
* 通道 C（默认关）：`AgentEvent.dispatch_trace` 事件形状；
* 委派链路端到端：成功 / Brief 拒绝 / Worker 不存在 三类 trace 字段。

Note:
    本文件**只对 trace 结构与开关行为断言**，不对任何 LLM 生成文本断言
    （团队裁定 Q1/Q5：黄金用例只断言 dispatch_trace）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openharness.tools.base import ToolExecutionContext

from src.coordinator import trace as trace_mod
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
from src.runtime.events import AgentEvent, AgentEventType
from src.skills.tools.invoke_agent import (
    DEFAULT_WHITELIST,
    InvokeAgentInput,
    InvokeAgentTool,
)
from src.utils.exceptions import AgentNotFoundError


@pytest.fixture(autouse=True)
def _clean_trace_buffer() -> Any:
    """每个用例前后清空进程内 trace 缓冲，避免用例间串味。"""
    trace_mod._reset_for_test()
    yield
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
    """构造只声明必要属性的 settings mock（其余交给 flags 安全回落）。

    Args:
        **overrides: 需要显式覆盖的配置项。

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


def _session_manager(child_session: Any, parent_session: Any = None) -> MagicMock:
    """构造会话管理器 mock。

    Args:
        child_session: `create_session` 返回的子会话。
        parent_session: `get_session` 返回的父会话；`None` 时抛异常模拟不可用。

    Returns:
        `MagicMock` 形态的 SessionManager。
    """
    manager = MagicMock()
    if parent_session is None:
        manager.get_session = AsyncMock(side_effect=Exception("no parent"))
    else:
        manager.get_session = AsyncMock(return_value=parent_session)
    manager.create_session = AsyncMock(return_value=child_session)
    manager.save_session = AsyncMock()
    return manager


def _worker_instance(text: str = "结果正文") -> MagicMock:
    """构造会产出两段文本增量与一次 DONE 的 Worker 实例 mock。

    Args:
        text: 输出文本。

    Returns:
        `MagicMock` 形态的 agent instance。
    """

    async def _events(*_a: Any, **_k: Any) -> Any:
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content=text)
        yield AgentEvent(type=AgentEventType.DONE)

    instance = MagicMock()
    instance.process_message = _events
    return instance


# ===== 开关默认值（红线：新开关默认不改变现网行为）=====


def test_flag_defaults_channel_a_c_on_b_off() -> None:
    """通道 A/C 默认开、通道 B 默认关；MagicMock settings 不得污染默认值。"""
    with patch("src.config.get_settings", return_value=MagicMock()):
        assert dispatch_trace_enabled() is True
        assert dispatch_trace_sse_enabled() is False
        assert dispatch_trace_event_enabled() is True


def test_flag_respects_explicit_values() -> None:
    """显式布尔配置可关闭通道 A / 打开通道 B、C。"""
    settings = MagicMock(
        DISPATCH_TRACE_ENABLED=False,
        DISPATCH_TRACE_SSE_ENABLED=True,
        DISPATCH_TRACE_EVENT_ENABLED=True,
    )
    with patch("src.config.get_settings", return_value=settings):
        assert dispatch_trace_enabled() is False
        assert dispatch_trace_sse_enabled() is True
        assert dispatch_trace_event_enabled() is True


# ===== 缓冲：push / drain / peek / 本轮快照 =====


@pytest.mark.asyncio
async def test_push_then_drain_roundtrip() -> None:
    """推入的条目可按序 drain，且 drain 后缓冲被清空。"""
    await push_dispatch_trace(
        "s1", DispatchTraceEntry(intent="rag", worker_id="mis-rag", task_id="t1")
    )
    await push_dispatch_trace(
        "s1", DispatchTraceEntry(intent="crm", worker_id="crm-assistant", task_id="t2")
    )

    assert len(await peek_dispatch_traces("s1")) == 2
    items = await drain_dispatch_traces("s1")
    assert [i["worker_id"] for i in items] == ["mis-rag", "crm-assistant"]
    assert await peek_dispatch_traces("s1") == []
    assert await drain_dispatch_traces("s1") == []


@pytest.mark.asyncio
async def test_push_enriches_coordinator_id_from_parent_session() -> None:
    """未显式传 coordinator_id 时，从父会话 agent_id 补齐。"""
    parent = MagicMock()
    parent.agent_id = "mis-copilot"
    session_manager = MagicMock()
    session_manager.get_session = AsyncMock(return_value=parent)

    with patch(
        "src.agent.session.get_session_manager", return_value=session_manager
    ):
        await push_dispatch_trace(
            "parent-sess",
            DispatchTraceEntry(intent="rag", worker_id="mis-rag", task_id="t1"),
        )

    items = await drain_dispatch_traces("parent-sess")
    assert len(items) == 1
    assert items[0]["coordinator_id"] == "mis-copilot"
    assert items[0]["worker_id"] == "mis-rag"
    session_manager.get_session.assert_awaited_once_with("parent-sess")


@pytest.mark.asyncio
async def test_push_keeps_explicit_coordinator_id() -> None:
    """调用方已填 coordinator_id 时不覆盖。"""
    with patch(
        "src.coordinator.trace._resolve_coordinator_id",
        new=AsyncMock(return_value="should-not-use"),
    ) as resolve:
        await push_dispatch_trace(
            "s1",
            DispatchTraceEntry(
                coordinator_id="explicit-coord",
                worker_id="mis-rag",
                task_id="t1",
            ),
        )
        resolve.assert_not_awaited()

    items = await drain_dispatch_traces("s1")
    assert items[0]["coordinator_id"] == "explicit-coord"


@pytest.mark.asyncio
async def test_push_without_session_is_dropped() -> None:
    """无宿主会话时静默丢弃，不抛异常。"""
    await push_dispatch_trace("", DispatchTraceEntry(worker_id="mis-rag"))
    assert await drain_dispatch_traces("") == []


@pytest.mark.asyncio
async def test_last_turn_snapshot_survives_drain_and_pops_once() -> None:
    """通道 B 快照在 drain 之后仍可读，且只能被取走一次。"""
    await push_dispatch_trace("s2", DispatchTraceEntry(worker_id="mis-summary"))
    await drain_dispatch_traces("s2")

    snapshot = await take_last_turn_traces("s2")
    assert [i["worker_id"] for i in snapshot] == ["mis-summary"]
    assert await take_last_turn_traces("s2") == []


@pytest.mark.asyncio
async def test_sessions_are_isolated() -> None:
    """不同会话的缓冲互不影响。"""
    await push_dispatch_trace("a", DispatchTraceEntry(worker_id="mis-rag"))
    await push_dispatch_trace("b", DispatchTraceEntry(worker_id="mis-extract"))

    assert [i["worker_id"] for i in await drain_dispatch_traces("a")] == ["mis-rag"]
    assert [i["worker_id"] for i in await drain_dispatch_traces("b")] == ["mis-extract"]


# ===== 通道 A：写 session.state["dispatch_trace"] =====


@pytest.mark.asyncio
async def test_persist_appends_to_session_state() -> None:
    """轨迹按序追加进 session.state，并触发一次 save_session。"""
    session = MagicMock()
    session.state = {}
    manager = MagicMock()
    manager.get_session = AsyncMock(return_value=session)
    manager.save_session = AsyncMock()

    with patch("src.agent.session.get_session_manager", return_value=manager):
        first = await persist_dispatch_traces("s1", [{"worker_id": "mis-rag"}])
        second = await persist_dispatch_traces("s1", [{"worker_id": "crm-assistant"}])

    assert [i["worker_id"] for i in first] == ["mis-rag"]
    assert [i["worker_id"] for i in second] == ["mis-rag", "crm-assistant"]
    assert session.state[DISPATCH_TRACE_STATE_KEY] == second
    assert manager.save_session.await_count == 2


@pytest.mark.asyncio
async def test_persist_caps_state_with_fifo_limit() -> None:
    """超出上限时按 FIFO 淘汰最旧条目，保留最近 50 条。"""
    session = MagicMock()
    session.state = {}
    manager = MagicMock()
    manager.get_session = AsyncMock(return_value=session)
    manager.save_session = AsyncMock()

    entries = [{"task_id": f"t{i}"} for i in range(DISPATCH_TRACE_STATE_LIMIT + 10)]
    with patch("src.agent.session.get_session_manager", return_value=manager):
        history = await persist_dispatch_traces("s1", entries)

    assert len(history) == DISPATCH_TRACE_STATE_LIMIT
    assert history[0]["task_id"] == "t10"
    assert history[-1]["task_id"] == f"t{DISPATCH_TRACE_STATE_LIMIT + 9}"


@pytest.mark.asyncio
async def test_persist_degrades_silently_when_session_unavailable() -> None:
    """会话不可用（Redis 故障等）时静默降级，绝不影响主链路。"""
    manager = MagicMock()
    manager.get_session = AsyncMock(side_effect=Exception("redis down"))
    manager.save_session = AsyncMock()

    with patch("src.agent.session.get_session_manager", return_value=manager):
        assert await persist_dispatch_traces("s1", [{"worker_id": "mis-rag"}]) == []
    manager.save_session.assert_not_awaited()


@pytest.mark.asyncio
async def test_persist_noop_for_empty_input() -> None:
    """空会话 ID 或空条目列表直接返回，不触碰会话。"""
    manager = MagicMock()
    manager.get_session = AsyncMock()
    with patch("src.agent.session.get_session_manager", return_value=manager):
        assert await persist_dispatch_traces("", [{"a": 1}]) == []
        assert await persist_dispatch_traces("s1", []) == []
    manager.get_session.assert_not_awaited()


# ===== 通道 C：AgentEvent 形状（红线：只增不改）=====


def test_agent_event_type_only_appends_dispatch_trace() -> None:
    """新增枚举值不改动既有成员取值。"""
    assert AgentEventType.DISPATCH_TRACE.value == "dispatch.trace"
    assert AgentEventType.TEXT_DELTA.value == "text.delta"
    assert AgentEventType.DONE.value == "done"


def test_agent_event_dispatch_trace_factory() -> None:
    """`AgentEvent.dispatch_trace` 产出规范事件，且默认事件 trace 为 None。"""
    entries = [{"worker_id": "mis-rag", "status": "completed"}]
    event = AgentEvent.dispatch_trace(entries)

    assert event.type == AgentEventType.DISPATCH_TRACE
    assert event.trace == {"entries": entries}
    assert AgentEvent(type=AgentEventType.DONE).trace is None


# ===== 端到端：委派链路产出的 trace =====


@pytest.mark.asyncio
async def test_invoke_records_completed_trace() -> None:
    """成功委派推入一条 completed 轨迹，字段齐全。"""
    tool = InvokeAgentTool()
    child = MagicMock(session_id="child-1", state={})
    session_mgr = _session_manager(child)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "parent-1"}),
        )

    assert not result.is_error
    items = await drain_dispatch_traces("parent-1")
    assert len(items) == 1
    entry = items[0]
    assert entry["worker_id"] == "mis-rag"
    assert entry["tool"] == "agent__invoke"
    assert entry["status"] == "completed"
    assert entry["intent"] == "rag"
    assert entry["brief_rejected"] is False
    assert len(entry["task_id"]) == 12
    assert entry["latency_ms"] >= 0
    # 信封头与轨迹的 task_id 必须同源，便于日志串联
    assert f"[task:{entry['task_id']}]" in result.output


@pytest.mark.asyncio
async def test_invoke_uses_explicit_intent() -> None:
    """Coordinator 自报 intent 时以自报值为准。"""
    tool = InvokeAgentTool()
    child = MagicMock(session_id="child-2", state={})
    session_mgr = _session_manager(child)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        await tool.execute(
            InvokeAgentInput(
                agent_id="mis-summary",
                content="对本页审批意见做要点摘要并给出结论",
                intent="summary",
            ),
            _ctx({"session_id": "parent-2"}),
        )

    items = await drain_dispatch_traces("parent-2")
    assert items[0]["intent"] == "summary"
    assert items[0]["worker_id"] == "mis-summary"


@pytest.mark.asyncio
async def test_invoke_records_rejected_trace_in_strict_mode() -> None:
    """严格模式下懒委托被拒：不真正委派，轨迹标记 rejected。"""
    tool = InvokeAgentTool()
    session_mgr = _session_manager(MagicMock(session_id="child-3", state={}))
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock()
    settings = _settings(TASK_BRIEF_STRICT=True)

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="帮我查一下"),
            _ctx({"session_id": "parent-3"}),
        )

    assert result.is_error
    assert "[任务书校验未通过]" in result.output
    agent_mgr.ensure_agent_ready.assert_not_awaited()

    items = await drain_dispatch_traces("parent-3")
    assert len(items) == 1
    assert items[0]["status"] == TRACE_STATUS_REJECTED
    assert items[0]["brief_rejected"] is True
    assert items[0]["worker_id"] == "mis-rag"


@pytest.mark.asyncio
async def test_invoke_lenient_mode_does_not_reject() -> None:
    """lenient 模式（显式 TASK_BRIEF_STRICT=False）不拦截短任务书，保持现网行为。"""
    tool = InvokeAgentTool()
    child = MagicMock(session_id="child-4", state={})
    session_mgr = _session_manager(child)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())
    settings = _settings(TASK_BRIEF_STRICT=False)

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-extract", content="请抽取"),
            _ctx({"session_id": "parent-4"}),
        )

    assert not result.is_error
    items = await drain_dispatch_traces("parent-4")
    assert items[0]["status"] == "completed"
    assert items[0]["brief_rejected"] is False


@pytest.mark.asyncio
async def test_invoke_records_failed_trace_without_envelope_header() -> None:
    """Worker 不存在时记 failed 轨迹，且错误文案逐字保留、不加信封头。"""
    tool = InvokeAgentTool()
    session_mgr = _session_manager(MagicMock(session_id="c1", state={}))
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(side_effect=AgentNotFoundError("mis-rag"))

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "parent-5"}),
        )

    assert result.is_error
    assert result.output == "目标智能体不存在或未加载：mis-rag"
    assert not result.output.startswith("[task:")

    items = await drain_dispatch_traces("parent-5")
    assert items[0]["status"] == "failed"
    assert items[0]["brief_rejected"] is False


@pytest.mark.asyncio
async def test_invoke_skips_trace_when_channel_a_disabled() -> None:
    """关闭 DISPATCH_TRACE_ENABLED 后不产生任何轨迹。"""
    tool = InvokeAgentTool()
    child = MagicMock(session_id="child-6", state={})
    session_mgr = _session_manager(child)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())
    settings = _settings(DISPATCH_TRACE_ENABLED=False)

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "parent-6"}),
        )

    assert not result.is_error
    assert await drain_dispatch_traces("parent-6") == []


@pytest.mark.asyncio
async def test_invoke_without_parent_session_keeps_working() -> None:
    """无父会话（无 session_id）时轨迹丢弃但委派本身照常成功。"""
    tool = InvokeAgentTool()
    child = MagicMock(session_id="child-7", state={})
    session_mgr = _session_manager(child)
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=_worker_instance())

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=_settings()),
        patch("src.config.get_settings", return_value=_settings()),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx(),
        )

    assert not result.is_error
    assert await drain_dispatch_traces("") == []
