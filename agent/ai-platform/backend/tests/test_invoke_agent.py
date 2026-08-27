"""agent__invoke（Copilot 调度）单元测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openharness.tools.base import ToolExecutionContext

from src.runtime.events import AgentEvent, AgentEventType
from src.skills.tools.invoke_agent import (
    DEFAULT_WHITELIST,
    FORBIDDEN_TARGETS,
    InvokeAgentInput,
    InvokeAgentTool,
    _invoke_depth,
    resolve_whitelist,
)
from src.utils.exceptions import AgentNotFoundError


def _ctx(metadata: dict | None = None) -> ToolExecutionContext:
    return ToolExecutionContext(cwd=Path("."), metadata=metadata or {})


def test_resolve_whitelist_default():
    assert resolve_whitelist(None) == DEFAULT_WHITELIST
    assert resolve_whitelist([]) == DEFAULT_WHITELIST
    assert "crm-assistant" in resolve_whitelist(None)


def test_resolve_whitelist_configured():
    assert resolve_whitelist(["mis-extract", " crm-assistant "]) == frozenset(
        {"mis-extract", "crm-assistant"}
    )


def test_invoke_input_coerces_task_brief_json_string() -> None:
    brief_json = (
        '{"goal":"检索PAD退货设置并给出条款依据","purpose":"直接回复用户",'
        '"inputs":{"user_question":"PAD退货设置"},"expected_output":"answer+citations"}'
    )
    parsed = InvokeAgentInput(
        agent_id="mis-rag",
        content="PAD退货设置",
        task_brief=brief_json,
    )
    assert isinstance(parsed.task_brief, dict)
    assert parsed.task_brief["goal"].startswith("检索PAD")


@pytest.mark.asyncio
async def test_invoke_rejects_empty_agent_id():
    tool = InvokeAgentTool()
    result = await tool.execute(
        InvokeAgentInput(agent_id="  ", content="hello"),
        _ctx(),
    )
    assert result.is_error
    assert "agent_id" in result.output


@pytest.mark.asyncio
async def test_invoke_rejects_empty_content():
    tool = InvokeAgentTool()
    result = await tool.execute(
        InvokeAgentInput(agent_id="mis-extract", content=""),
        _ctx(),
    )
    assert result.is_error
    assert "content" in result.output


@pytest.mark.asyncio
async def test_invoke_rejects_not_in_whitelist():
    tool = InvokeAgentTool()
    result = await tool.execute(
        InvokeAgentInput(agent_id="unknown-agent", content="x"),
        _ctx(),
    )
    assert result.is_error
    assert "白名单" in result.output


@pytest.mark.asyncio
async def test_invoke_rejects_copilot_self():
    assert "mis-copilot" in FORBIDDEN_TARGETS
    tool = InvokeAgentTool()
    result = await tool.execute(
        InvokeAgentInput(agent_id="mis-copilot", content="x"),
        _ctx(),
    )
    assert result.is_error
    assert "禁止委托" in result.output


@pytest.mark.asyncio
async def test_invoke_rejects_depth_overflow():
    tool = InvokeAgentTool()
    token = _invoke_depth.set(1)
    try:
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-extract", content="抽取姓名"),
            _ctx(),
        )
    finally:
        _invoke_depth.reset(token)
    assert result.is_error
    assert "深度超限" in result.output


@pytest.mark.asyncio
async def test_invoke_success_collects_text_deltas():
    tool = InvokeAgentTool()

    async def _events(*_a, **_k):
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content="字段A=1")
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content="；完成")
        yield AgentEvent(type=AgentEventType.DONE)

    child_session = MagicMock()
    child_session.session_id = "child-1"
    child_session.state = {}

    session_mgr = MagicMock()
    session_mgr.get_session = AsyncMock(side_effect=Exception("no parent"))
    session_mgr.create_session = AsyncMock(return_value=child_session)
    session_mgr.save_session = AsyncMock()

    instance = MagicMock()
    instance.process_message = _events

    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=instance)

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch(
            "src.skills.tools.invoke_agent.get_settings",
            return_value=MagicMock(
                INVOKE_AGENT_WHITELIST=list(DEFAULT_WHITELIST),
                INVOKE_AGENT_MAX_DEPTH=1,
                INVOKE_AGENT_TIMEOUT_SECONDS=30,
            ),
        ),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-extract", content="请抽取"),
            _ctx(
                {
                    "session_id": "parent-1",
                    "identity": {
                        "userId": "u1",
                        "channel": "mis_bff",
                        "userMobile": "",
                        "channelUserId": "u1",
                    },
                }
            ),
        )

    assert not result.is_error
    assert result.output.endswith("字段A=1；完成")
    session_mgr.create_session.assert_awaited()
    agent_mgr.ensure_agent_ready.assert_awaited_with("mis-extract")


@pytest.mark.asyncio
async def test_invoke_crm_tool_errors_friendly():
    tool = InvokeAgentTool()

    async def _events(*_a, **_k):
        yield AgentEvent(
            type=AgentEventType.TOOL_RESULT,
            tool_name="mcp__mcp-api-suite__callApi",
            result={"error": "connection refused"},
        )
        yield AgentEvent(type=AgentEventType.DONE)

    child_session = MagicMock()
    child_session.session_id = "child-crm"
    child_session.state = {}

    session_mgr = MagicMock()
    session_mgr.get_session = AsyncMock(side_effect=Exception("no parent"))
    session_mgr.create_session = AsyncMock(return_value=child_session)
    session_mgr.save_session = AsyncMock()

    instance = MagicMock()
    instance.process_message = _events
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=instance)

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch(
            "src.skills.tools.invoke_agent.get_settings",
            return_value=MagicMock(
                INVOKE_AGENT_WHITELIST=list(DEFAULT_WHITELIST),
                INVOKE_AGENT_MAX_DEPTH=1,
                INVOKE_AGENT_TIMEOUT_SECONDS=30,
            ),
        ),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="crm-assistant", content="查会员"),
            _ctx({"identity": {"userId": "u1", "channel": "mis_bff"}}),
        )

    assert result.is_error
    assert "CRM" in result.output or "mcp-api-suite" in result.output


@pytest.mark.asyncio
async def test_invoke_agent_not_found():
    tool = InvokeAgentTool()
    session_mgr = MagicMock()
    session_mgr.get_session = AsyncMock(side_effect=Exception("no parent"))
    session_mgr.create_session = AsyncMock(
        return_value=MagicMock(session_id="c1", state={})
    )
    session_mgr.save_session = AsyncMock()
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(side_effect=AgentNotFoundError("mis-rag"))

    with (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch(
            "src.skills.tools.invoke_agent.get_settings",
            return_value=MagicMock(
                INVOKE_AGENT_WHITELIST=list(DEFAULT_WHITELIST),
                INVOKE_AGENT_MAX_DEPTH=1,
                INVOKE_AGENT_TIMEOUT_SECONDS=30,
            ),
        ),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-rag", content="查制度"),
            _ctx(),
        )

    assert result.is_error
    assert "不存在" in result.output


@pytest.mark.asyncio
async def test_invoke_rejects_admin_helper_explicit():
    """T05 硬约束·闸②+闸③（belt-and-suspenders）：即便 mis-admin-helper 被误配进白名单，
    InvokeAgentTool 也必须显式拒绝，绝不经调度链接触达后台操作员专属 Agent。

    该判定在白名单校验**之前**发生，故这里把 mis-admin-helper 放进白名单以证明
    显式拒与白名单无关（双保险）。
    """
    from src.coordinator.catalog import ADMIN_HELPER_AGENT_IDS

    assert "mis-admin-helper" in ADMIN_HELPER_AGENT_IDS
    tool = InvokeAgentTool()
    result = await tool.execute(
        InvokeAgentInput(agent_id="mis-admin-helper", content="建个技能"),
        _ctx(),
    )
    assert result.is_error
    assert "不可经调度链接触达" in result.output


@pytest.mark.asyncio
async def test_invoke_rejects_admin_helper_even_within_whitelist():
    """同上一例，但显式把 mis-admin-helper 塞进白名单，证明显式拒优先于白名单判定。"""
    tool = InvokeAgentTool()
    with patch(
        "src.skills.tools.invoke_agent.get_settings",
        return_value=MagicMock(
            INVOKE_AGENT_WHITELIST=["mis-admin-helper", "mis-extract"],
            INVOKE_AGENT_MAX_DEPTH=1,
            INVOKE_AGENT_TIMEOUT_SECONDS=30,
        ),
    ):
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-admin-helper", content="建个技能"),
            _ctx(),
        )
    assert result.is_error
    assert "不可经调度链接触达" in result.output
