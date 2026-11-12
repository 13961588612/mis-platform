"""业务规则上下文（RuleContext）+ 接入问数链路 单测。

背景（2026-09-28 真机实测）：
- ``get_context`` 在 wren 0.13.3 **必填 question**；旧实现只传 role_scope → 校验失败 →
  异常被吞 → 语义上下文一直为空；
- ``get_instructions``（读 knowledge/rules/*.md）此前**从未被调用** → 下发的规则对问数无效。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.agent.mis_iqd.nl2sql import Nl2SqlGenerator, Nl2SqlResult
from src.agent.mis_iqd.orchestrator import AskOrchestrator
from src.agent.mis_iqd.rules_context import MAX_RULES_CHARS, RuleContext
from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    RowScopeInjectOutcome,
)
from src.models.iqd_schema import AskRequest


# ---------------------------------------------------------------- RuleContext 归一


def test_extract_real_machine_shape() -> None:
    """真机返回 {"instructions": str, "used_legacy": bool}。"""
    payload = {"instructions": "# 规则\n- ads_* 必须过滤 data_type", "used_legacy": False}
    assert RuleContext.extract(payload) == "# 规则\n- ads_* 必须过滤 data_type"


def test_extract_various_shapes() -> None:
    assert RuleContext.extract({"instructions": [{"content": "A"}, {"text": "B"}]}) == "A\nB"
    assert RuleContext.extract(["X", "Y"]) == "X\nY"
    assert RuleContext.extract({"content": "C"}) == "C"
    assert RuleContext.extract("# raw") == "# raw"
    assert RuleContext.extract({"items": [{"rule": "R"}]}) == "R"


def test_extract_empty_or_unknown() -> None:
    assert RuleContext.extract(None) == ""
    assert RuleContext.extract({"instructions": "", "used_legacy": False}) == ""
    assert RuleContext.extract({}) == ""
    assert RuleContext.extract(123) == ""


def test_extract_clips_overlong_rules() -> None:
    out = RuleContext.extract({"instructions": "x" * (MAX_RULES_CHARS + 500)})
    assert len(out) <= MAX_RULES_CHARS + 40
    assert out.endswith("）")


# ---------------------------------------------------------------- get_context 入参契约


@pytest.mark.asyncio
async def test_get_context_sends_question_not_role_scope() -> None:
    """真机契约：get_context 必须带 question（传 role_scope 会 validation error）。"""
    client = IqdMcpClient(mock=False)
    captured: dict[str, Any] = {}

    async def _fake_call(tool: str, args: dict[str, Any]) -> dict[str, Any]:
        captured["tool"] = tool
        captured["args"] = args
        return {"schema": "S", "strategy": "full"}

    with patch.object(client, "_call_tool", side_effect=_fake_call):
        out = await client.get_context(question="各门店销售额")

    assert captured["tool"] == "get_context"
    assert captured["args"]["question"] == "各门店销售额"
    assert "role_scope" not in captured["args"]
    assert out == {"schema": "S", "strategy": "full"}


# ---------------------------------------------------------------- 端到端：规则进上下文


def _orch(mock_client, nl2sql) -> AskOrchestrator:
    scope = MagicMock()
    scope.inject_row_scope = AsyncMock(
        return_value=RowScopeInjectOutcome(verdict="allow", sql="SELECT 1")
    )
    scope.assert_sql_within_scope = MagicMock()
    return AskOrchestrator(mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=scope)


@pytest.mark.asyncio
async def test_rules_are_injected_into_nl2sql_context() -> None:
    """下发的业务规则必须出现在 NL→SQL 上下文里（此前完全没有）。"""
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {"schema": "Catalog: wren", "strategy": "full"}
    mock_client.get_instructions.return_value = {
        "instructions": "- ads_* 查询必须显式过滤 data_type",
        "used_legacy": False,
    }
    mock_client.list_cubes.return_value = {"cubes": []}
    mock_client.recall_queries.return_value = {"items": []}
    mock_client.list_models.return_value = {"models": [{"name": "ads"}]}
    mock_client.describe_model.return_value = {"name": "ads", "fields": [{"name": "data_type"}]}

    orch = AskOrchestrator(mcp_client=mock_client, nl2sql=AsyncMock(spec=Nl2SqlGenerator))
    text, _ = await orch._build_nl2sql_context(
        mock_client, {}, ["ads"], question="各门店销售额"
    )
    assert "business_rules" in text
    assert "必须显式过滤 data_type" in text


@pytest.mark.asyncio
async def test_rules_absent_does_not_break_context() -> None:
    """规则不可得（异常/空）时上下文照常构建，不阻断主链路。"""
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {}
    mock_client.get_instructions.side_effect = RuntimeError("tool unavailable")
    mock_client.list_cubes.return_value = {"cubes": []}
    mock_client.recall_queries.return_value = {"items": []}
    mock_client.list_models.return_value = {"models": []}
    mock_client.describe_model.return_value = {}

    orch = AskOrchestrator(mcp_client=mock_client, nl2sql=AsyncMock(spec=Nl2SqlGenerator))
    text, _ = await orch._build_nl2sql_context(mock_client, {}, [], question="q")
    assert "business_rules" not in text  # 降级：不注入脏段


@pytest.mark.asyncio
async def test_orchestrator_passes_question_to_get_context() -> None:
    """端到端：orchestrator 调 get_context 时必须带 question（回归保护）。"""
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {}
    mock_client.get_instructions.return_value = {}
    mock_client.list_cubes.return_value = {"cubes": []}
    mock_client.recall_queries.return_value = {"items": []}
    mock_client.list_models.return_value = {"models": [{"name": "t"}]}
    mock_client.describe_model.return_value = {"name": "t", "fields": []}
    mock_client.dry_plan.return_value = {"sql": "SELECT 1"}
    mock_client.dry_run.return_value = {"ok": True}
    mock_client.run_sql.return_value = {"columns": [], "rows": [], "summary": "ok"}

    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(type="text_to_sql", sql="SELECT 1")

    orch = _orch(mock_client, nl2sql)
    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    request = AskRequest(question="本月销售额", connection_id=1)
    resolution = IqdScopeResolution(
        decision="allow", allowed_item_keys=["t"], subject_summary="", connection_id=1
    )
    with patch.object(orch, "_get_config_client", return_value=config_mock):
        await orch.ask(request, AskIdentity(user_id=1), resolution)

    kwargs = mock_client.get_context.await_args.kwargs
    assert kwargs.get("question") == "本月销售额"
