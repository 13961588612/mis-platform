"""C4 独立验证：dispatch.trace 通道 C 端到端产出（QA 复核，非工程师自测）。

验证目标（design-c4.md T01/T02 + spec.md §7.2）：
1. `Settings()` 真实默认值：通道 C 已开、通道 A 保持开、通道 B 保持关。
2. 驱动**真实** `OpenHarnessRuntime.run()`，证明委派发生时确实 yield 了
   `dispatch.trace` 事件，且位于 `done` 之前、`trace.entries` 非空且字段齐全。
3. 证明该事件经 Redis Stream 的序列化口径（`model_dump(mode="json",
   exclude_none=True)`）后 `trace` 字段仍在 —— 即真能到达 Gateway。
4. 回归红线：未委派时不得产出 `dispatch.trace`；既有事件序列化不得多出
   `trace` 键。

本文件只读生产代码，不修改任何生产源码。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.config import Settings
from src.coordinator.trace import (
    DispatchTraceEntry,
    _reset_for_test,
    drain_dispatch_traces,
    push_dispatch_trace,
)
from src.runtime.events import AgentEvent, AgentEventType
from src.runtime.openharness import OpenHarnessRuntime

# ===== 夹具 =====


@pytest.fixture(autouse=True)
def _clean_trace_buffer() -> Any:
    """每个用例前后清空全局委派轨迹缓冲，保证用例互不污染。"""
    _reset_for_test()
    yield
    _reset_for_test()


class _FakeEngine:
    """最小 QueryEngine 替身：不产生任何引擎事件，只让 run() 走完主循环。

    目的是把 `OpenHarnessRuntime.run()` 的**真实** drain/分发代码段
    （openharness.py 通道 A/B/C 接线）暴露出来验证，而不去 mock 它本身。
    """

    def load_messages(self, _messages: list[Any]) -> None:
        """兼容 run() 的历史消息装载调用。"""
        return None

    async def submit_message(self, _prompt: Any) -> Any:
        """不产出任何引擎事件（本轮只验证委派轨迹分发段）。"""
        return
        yield  # pragma: no cover - 使函数成为 async generator


def _build_runtime() -> OpenHarnessRuntime:
    """构造一个已初始化、可直接调用 run() 的运行时实例。"""
    runtime = OpenHarnessRuntime()
    runtime._initialized = True
    runtime._llm_gateway = MagicMock()
    runtime._config = MagicMock()
    return runtime


async def _collect_events(session_id: str) -> list[AgentEvent]:
    """驱动真实 run()，收集本轮产出的全部 AgentEvent。"""
    runtime = _build_runtime()
    config = MagicMock()

    with (
        patch(
            "src.runtime.openharness._ensure_native_mcp_manager",
            return_value=None,
        ),
        patch(
            "src.runtime.openharness.build_native_query_engine",
            return_value=_FakeEngine(),
        ),
        patch(
            "src.runtime.openharness.resolve_extra_skill_dirs",
            return_value=[],
        ),
        patch("src.runtime.openharness.drain_a2ui_renders", return_value=[]),
        patch("src.runtime.openharness.persist_dispatch_traces", return_value=None),
    ):
        return [
            event
            async for event in runtime.run(
                messages=[{"role": "user", "content": "查一下报销制度"}],
                config=config,
                session_id=session_id,
            )
        ]


# ===== 1. 真实 Settings 默认值（Q3 裁定：通道 C 应为 True）=====


class TestChannelFlagDefaults:
    """三通道开关的**真实** Settings 默认值。"""

    def test_channel_c_enabled_by_default(self) -> None:
        """通道 C 已在 C4 打开，前端才可能收到 dispatch.trace。"""
        assert Settings().DISPATCH_TRACE_EVENT_ENABLED is True

    def test_channel_a_still_on_and_b_still_off(self) -> None:
        """通道 A 保持开、通道 B 保持关（C4 只动 C，不得误伤 A/B）。"""
        settings = Settings()
        assert settings.DISPATCH_TRACE_ENABLED is True
        assert settings.DISPATCH_TRACE_SSE_ENABLED is False


# ===== 2. 真实 run() 产出 dispatch.trace =====


class TestChannelCEmitsDispatchTrace:
    """驱动真实 OpenHarnessRuntime.run()，证明通道 C 确实产出事件。"""

    @pytest.mark.asyncio
    async def test_run_yields_dispatch_trace_before_done(self) -> None:
        """发生委派时，run() 应在 done 之前 yield dispatch.trace。"""
        session_id = "cw4-e2e-1"
        await push_dispatch_trace(
            session_id,
            DispatchTraceEntry(
                intent="rag",
                worker_id="mis-rag",
                tool="agent__invoke",
                status="completed",
                latency_ms=1200,
                task_id="task-1",
            ),
        )

        events = await _collect_events(session_id)
        types = [e.type for e in events]

        assert AgentEventType.DISPATCH_TRACE in types, (
            f"通道 C 未产出 dispatch.trace，实际事件序列={types}"
        )
        assert types.index(AgentEventType.DISPATCH_TRACE) < types.index(
            AgentEventType.DONE
        ), "dispatch.trace 必须早于 done 下发"

    @pytest.mark.asyncio
    async def test_dispatch_trace_entries_carry_spec_fields(self) -> None:
        """trace.entries 非空，且条目含 spec §7.2 的 5 个核心字段。"""
        session_id = "cw4-e2e-2"
        await push_dispatch_trace(
            session_id,
            DispatchTraceEntry(
                intent="rag",
                worker_id="mis-rag",
                tool="agent__invoke",
                status="completed",
                latency_ms=1200,
                task_id="task-2",
            ),
        )

        events = await _collect_events(session_id)
        trace_event = next(
            e for e in events if e.type == AgentEventType.DISPATCH_TRACE
        )

        assert trace_event.trace is not None
        entries = trace_event.trace["entries"]
        assert len(entries) == 1

        entry = entries[0]
        for field in ("intent", "worker_id", "tool", "status", "latency_ms"):
            assert field in entry, f"spec §7.2 要求的字段 {field} 缺失"
        assert entry["intent"] == "rag"
        assert entry["worker_id"] == "mis-rag"
        assert entry["tool"] == "agent__invoke"
        assert entry["status"] == "completed"
        assert entry["latency_ms"] == 1200

    @pytest.mark.asyncio
    async def test_multiple_dispatches_are_batched_in_one_event(self) -> None:
        """同轮多次委派应合并为一个事件的多条 entries，保持顺序。"""
        session_id = "cw4-e2e-3"
        await push_dispatch_trace(
            session_id, DispatchTraceEntry(intent="rag", worker_id="mis-rag")
        )
        await push_dispatch_trace(
            session_id, DispatchTraceEntry(intent="crm", worker_id="crm-assistant")
        )

        events = await _collect_events(session_id)
        trace_event = next(
            e for e in events if e.type == AgentEventType.DISPATCH_TRACE
        )
        assert trace_event.trace is not None
        entries = trace_event.trace["entries"]
        assert [e["worker_id"] for e in entries] == ["mis-rag", "crm-assistant"]

    @pytest.mark.asyncio
    async def test_no_dispatch_means_no_trace_event(self) -> None:
        """未发生委派时不得产出 dispatch.trace（回归红线：纯对话零变化）。"""
        events = await _collect_events("cw4-e2e-empty")
        types = [e.type for e in events]

        assert AgentEventType.DISPATCH_TRACE not in types
        assert AgentEventType.DONE in types

    @pytest.mark.asyncio
    async def test_channel_c_off_suppresses_event(self) -> None:
        """通道 C 显式关闭时不产出事件（灰度回滚开关有效）。"""
        session_id = "cw4-e2e-off"
        await push_dispatch_trace(
            session_id, DispatchTraceEntry(intent="rag", worker_id="mis-rag")
        )

        with patch(
            "src.runtime.openharness.dispatch_trace_event_enabled",
            return_value=False,
        ):
            events = await _collect_events(session_id)

        assert AgentEventType.DISPATCH_TRACE not in [e.type for e in events]

    @pytest.mark.asyncio
    async def test_buffer_is_drained_after_emit(self) -> None:
        """事件下发后缓冲被清空，下一轮不会重复推送同一批轨迹。"""
        session_id = "cw4-e2e-drain"
        await push_dispatch_trace(
            session_id, DispatchTraceEntry(intent="rag", worker_id="mis-rag")
        )

        await _collect_events(session_id)

        assert await drain_dispatch_traces(session_id) == []


# ===== 3. 上线序列化口径（Redis Stream → Gateway）=====


class TestWireSerialization:
    """`publish_agent_event` 的序列化口径下 trace 必须存活。"""

    def test_trace_survives_exclude_none_json_dump(self) -> None:
        """dispatch.trace 事件序列化后仍带 trace，Gateway 才拿得到。"""
        event = AgentEvent.dispatch_trace(
            [
                {
                    "intent": "rag",
                    "worker_id": "mis-rag",
                    "tool": "agent__invoke",
                    "status": "completed",
                    "latency_ms": 1200,
                }
            ]
        )
        payload = event.model_dump(mode="json", exclude_none=True)

        assert payload["type"] == "dispatch.trace"
        assert payload["trace"] == {
            "entries": [
                {
                    "intent": "rag",
                    "worker_id": "mis-rag",
                    "tool": "agent__invoke",
                    "status": "completed",
                    "latency_ms": 1200,
                }
            ]
        }

    def test_existing_events_gain_no_trace_key(self) -> None:
        """既有事件序列化不得多出 trace 键（现网零回归）。"""
        for event in (
            AgentEvent.text_delta("hi"),
            AgentEvent.done(),
            AgentEvent.error("E", "boom"),
        ):
            payload = event.model_dump(mode="json", exclude_none=True)
            assert "trace" not in payload, f"{event.type} 意外携带 trace 字段"
