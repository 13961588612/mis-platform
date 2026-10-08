"""Memory injection / isolation integration tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agent.config import AgentConfig, MemoryConfig
from src.agent.lifecycle import LifecycleEvent
from src.agent.manager import AgentInstance
from src.agent.session import Message, Session
from src.memory.injector import AgentRunContext, MemoryInjector
from src.memory.models import ExtractedMemory, MemoryType
from src.runtime.events import AgentEvent


class _FakeRuntime:
    def __init__(self, events: list[AgentEvent] | None = None) -> None:
        self.events = events or [AgentEvent.text_delta("answer"), AgentEvent.done()]
        self.calls: list[dict[str, Any]] = []

    async def initialize(self, config: Any) -> None:
        return None

    async def run(self, **kwargs: Any):
        self.calls.append(kwargs)
        for event in self.events:
            yield event

    async def health_check(self):
        return MagicMock(healthy=True)


def _config(agent_id: str = "agent-a") -> AgentConfig:
    return AgentConfig(
        agent_id=agent_id,
        name=agent_id,
        display_name=agent_id,
        memory=MemoryConfig(static_enabled=True, dynamic_enabled=True, write_back=True),
    )


def _session(
    session_id: str = "s1",
    user_id: str = "u1",
    mis_user_id: int | None = 1001,
) -> Session:
    return Session(
        session_id=session_id,
        agent_id="agent-a",
        user_id=user_id,
        channel="web",
        mis_user_id=mis_user_id,
    )


def test_resolve_memory_owner_prefers_mis_user_id() -> None:
    ctx = AgentRunContext(
        agent_id="a",
        agent_name="a",
        user_id="u1",
        session_id="s1",
        metadata={"mis_user_id": 123},
    )
    assert MemoryInjector._resolve_memory_owner(ctx) == ("mis:123", True)


def test_resolve_memory_owner_falls_back_to_session_for_anonymous() -> None:
    ctx = AgentRunContext(
        agent_id="a",
        agent_name="a",
        user_id="",
        session_id="s1",
        metadata={},
    )
    assert MemoryInjector._resolve_memory_owner(ctx) == ("session-owner:s1", False)


@pytest.mark.asyncio
async def test_before_agent_run_builds_memory_only_context_and_canonical_owner() -> None:
    manager = MagicMock()
    manager.check_static_reload = MagicMock()
    manager.load_static_memory = MagicMock(return_value="personality")
    manager.retrieve_dynamic_memory = AsyncMock(return_value=[])
    injector = MemoryInjector(memory_manager=manager)
    ctx = AgentRunContext(
        agent_id="a",
        agent_name="a",
        user_id="u1",
        session_id="s1",
        query="hello",
        system_prompt="sys",
        metadata={"mis_user_id": 123},
    )

    await injector.before_agent_run(ctx)

    assert ctx.memory_owner_id == "mis:123"
    assert ctx.user_level_eligible is True
    assert "# Static Memory" in ctx.memory_context
    assert "sys" not in ctx.memory_context
    manager.retrieve_dynamic_memory.assert_awaited_once()
    assert manager.retrieve_dynamic_memory.await_args.kwargs["user_id"] == "mis:123"


@pytest.mark.asyncio
async def test_write_extracted_prefers_user_scope_for_stable_owner() -> None:
    from src.memory.manager import MemoryManager

    manager = MemoryManager.__new__(MemoryManager)
    manager.write_dynamic_memory = AsyncMock(return_value=MagicMock())
    extracted = [
        ExtractedMemory(
            memory_type=MemoryType.PREFERENCE,
            content="prefers zh",
            importance=0.8,
        )
    ]

    await manager.write_extracted_memories(
        agent_name="a",
        user_id="mis:123",
        session_id="s1",
        extracted=extracted,
        metadata={"user_level_eligible": True},
    )

    assert manager.write_dynamic_memory.await_args.kwargs["session_id"] is None
    assert manager.write_dynamic_memory.await_args.kwargs["user_id"] == "mis:123"


@pytest.mark.asyncio
async def test_write_extracted_keeps_session_scope_for_anonymous_owner() -> None:
    from src.memory.manager import MemoryManager

    manager = MemoryManager.__new__(MemoryManager)
    manager.write_dynamic_memory = AsyncMock(return_value=MagicMock())
    extracted = [
        ExtractedMemory(
            memory_type=MemoryType.PREFERENCE,
            content="prefers zh",
            importance=0.8,
        )
    ]

    await manager.write_extracted_memories(
        agent_name="a",
        user_id="session-owner:s1",
        session_id="s1",
        extracted=extracted,
        metadata={"user_level_eligible": False},
    )

    assert manager.write_dynamic_memory.await_args.kwargs["session_id"] == "s1"


@pytest.mark.asyncio
async def test_agent_instance_calls_memory_injector_before_and_after() -> None:
    runtime = _FakeRuntime()
    instance = AgentInstance(_config(), runtime)  # type: ignore[arg-type]
    instance.lifecycle.transition(LifecycleEvent.START)
    session = _session()
    message = Message(role="user", content="remember I prefer Chinese")

    injector = MagicMock()
    injector.before_agent_run = AsyncMock()
    injector.after_agent_run = AsyncMock()

    with patch("src.agent.manager.get_memory_injector", return_value=injector):
        with patch("src.agent.manager.RedisTimingStore") as timing_store_cls:
            timing_store_cls.return_value.save = AsyncMock()
            events = [event async for event in instance.process_message(session, message)]

    assert [event.type for event in events] == [event.type for event in runtime.events]
    injector.before_agent_run.assert_awaited_once()
    injector.after_agent_run.assert_awaited_once()
    ctx = injector.before_agent_run.await_args.args[0]
    assert ctx.metadata["mis_user_id"] == 1001
    assert runtime.calls[0]["memory_context"] == ""
    written_ctx = injector.after_agent_run.await_args.args[0]
    assert written_ctx is ctx
    assert written_ctx.assistant_response == "answer"
