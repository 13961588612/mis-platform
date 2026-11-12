"""coordinator__decide 决策工具校验。"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from openharness.tools.base import ToolExecutionContext

from src.skills.tools.coordinator_decide import (
    REFUSE_FIXED_MESSAGE,
    CoordinatorDecideInput,
    CoordinatorDecideTool,
    message_looks_like_business_data,
    parse_decide_tool_output,
)


@pytest.mark.asyncio
async def test_decide_route_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.skills.tools.invoke_agent.load_coordinator_worker_ids",
        lambda _cid: frozenset({"spm-report", "mis-rag"}),
    )
    tool = CoordinatorDecideTool()
    ctx = ToolExecutionContext(
        cwd=".",
        metadata={"agent_id": "mis-copilot"},
    )
    result = await tool.execute(
        CoordinatorDecideInput(
            action="route",
            worker_id="spm-report",
            intent="spm_report",
            content="宜兴城中店昨天销售",
        ),
        ctx,
    )
    assert result.is_error is False
    payload = json.loads(result.output)
    assert payload["action"] == "route"
    assert payload["worker_id"] == "spm-report"
    assert payload["ok"] is True


@pytest.mark.asyncio
async def test_decide_route_rejects_unknown_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.skills.tools.invoke_agent.load_coordinator_worker_ids",
        lambda _cid: frozenset({"spm-report"}),
    )
    tool = CoordinatorDecideTool()
    ctx = ToolExecutionContext(
        cwd=".",
        metadata={"agent_id": "mis-copilot"},
    )
    result = await tool.execute(
        CoordinatorDecideInput(action="route", worker_id="evil-agent"),
        ctx,
    )
    assert result.is_error is True
    payload = json.loads(result.output)
    assert payload["action"] == "refuse"


@pytest.mark.asyncio
async def test_decide_clarify_blocks_business_table() -> None:
    tool = CoordinatorDecideTool()
    result = await tool.execute(
        CoordinatorDecideInput(
            action="clarify",
            message="营业额 | 289,005.28 |\n| 客单数 | 2617 |",
        ),
        ToolExecutionContext(cwd=".", metadata={}),
    )
    assert result.is_error is True
    payload = json.loads(result.output)
    assert payload["action"] == "refuse"
    assert REFUSE_FIXED_MESSAGE in payload["message"]


def test_message_looks_like_business_data() -> None:
    assert message_looks_like_business_data(
        "| 指标 | 数值 |\n|---|---|\n| 营业额 | 100 |"
    )
    assert not message_looks_like_business_data("请问要查哪个门店？")


def test_parse_decide_tool_output() -> None:
    raw = json.dumps({"ok": True, "action": "chitchat", "message": "你好"})
    parsed = parse_decide_tool_output(raw)
    assert parsed is not None
    assert parsed["action"] == "chitchat"


def test_decide_tool_exposes_input_model_for_registry_wrap() -> None:
    """SafeToolWrapper 依赖 inner.input_model；缺属性会导致整表装配失败。"""
    from src.runtime.tool_registry_builder import SafeToolWrapper

    tool = CoordinatorDecideTool()
    assert tool.input_model is CoordinatorDecideInput
    wrapped = SafeToolWrapper(tool)
    assert wrapped.name == "coordinator__decide"
    assert wrapped.input_model is CoordinatorDecideInput
