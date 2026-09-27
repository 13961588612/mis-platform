"""NL→SQL 生成器 + AskOrchestrator 链路（LLM Gateway → dry_plan 转译）单测。"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.agent.mis_iqd.errors import QuestionUnsupportedError
from src.agent.mis_iqd.nl2sql import Nl2SqlGenerator, Nl2SqlResult
from src.agent.mis_iqd.orchestrator import AskOrchestrator
from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    RowScopeInjectOutcome,
)
from src.models.iqd_schema import AskRequest


def test_nl2sql_parse_json() -> None:
    gen = Nl2SqlGenerator(mock=True)
    out = gen._parse_response('{"type":"text_to_sql","sql":"SELECT 1"}')
    assert out.type == "text_to_sql"
    assert out.sql == "SELECT 1"


def test_nl2sql_parse_general() -> None:
    gen = Nl2SqlGenerator(mock=True)
    out = gen._parse_response('{"type":"GENERAL","summary":"这不是数据问题"}')
    assert out.type == "GENERAL"
    assert "数据" in out.summary


def test_nl2sql_parse_sql_fence() -> None:
    gen = Nl2SqlGenerator(mock=True)
    out = gen._parse_response("```sql\nSELECT a FROM t\n```")
    assert out.sql == "SELECT a FROM t"


def test_nl2sql_user_payload_includes_repair_hint() -> None:
    payload = Nl2SqlGenerator._build_user_payload(
        question="上季度门店销售",
        context="model: ads_spm\n  columns: ord_date, gmv",
        allowed_tables=["orders"],
        language="zh-CN",
        repair_hint="Column 'dt' cannot be resolved",
    )
    assert "previous_sql_error" in payload
    assert "Column 'dt'" in payload
    assert "ord_date" in payload


def test_rank_model_candidates_prefers_sale_for_store_sales() -> None:
    ranked = AskOrchestrator._rank_model_candidates(
        [
            "ads_spm_trd_cost_category_day_df",
            "ads_spm_trd_sale_category_day_df",
            "customers",
        ],
        question="上季度门店销售",
        allowed=["pg_main.public.orders"],
    )
    assert ranked[0] == "ads_spm_trd_sale_category_day_df"


def test_is_column_error_detects_dt() -> None:
    assert AskOrchestrator._is_column_error(
        Exception("Column 'dt' cannot be resolved")
    )
    assert not AskOrchestrator._is_column_error(Exception("timeout connecting"))


@pytest.mark.asyncio
async def test_nl2sql_mock_generate() -> None:
    gen = Nl2SqlGenerator(mock=True)
    out = await gen.generate(question="本月销售额", allowed_tables=["orders"])
    assert out.type == "text_to_sql"
    assert "SELECT" in out.sql.upper()


@pytest.mark.asyncio
async def test_build_nl2sql_context_injects_describe_columns() -> None:
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client.list_models.return_value = {
        "models": [{"name": "ads_spm_trd_sale_category_day_df"}]
    }

    async def _describe(name: str, **_kwargs: Any) -> dict[str, Any]:
        if name != "ads_spm_trd_sale_category_day_df":
            raise RuntimeError(f"Model '{name}' not found")
        return {
            "name": "ads_spm_trd_sale_category_day_df",
            "description": "门店销售",
            "fields": [
                {"name": "ord_date", "type": "DATE"},
                {"name": "gmv", "type": "DOUBLE"},
            ],
        }

    mock_client.describe_model.side_effect = _describe
    orch = AskOrchestrator(mcp_client=mock_client)
    text, described = await orch._build_nl2sql_context(
        mock_client,
        {},
        ["pg_main.public.orders"],
        question="上季度门店销售",
    )
    assert "ord_date" in text
    assert "gmv" in text
    assert described == ["ads_spm_trd_sale_category_day_df"]
    mock_client.describe_model.assert_awaited()


def test_lineage_extra_models_when_allowed_missing_in_wren() -> None:
    extra = AskOrchestrator._lineage_extra_models(
        ["pg_main.public.orders"],
        ["ads_spm_trd_sale_category_day_df"],
    )
    assert extra == ["ads_spm_trd_sale_category_day_df"]
    assert (
        AskOrchestrator._lineage_extra_models(
            ["ads_spm_trd_sale_category_day_df"],
            ["ads_spm_trd_sale_category_day_df"],
        )
        == []
    )


@pytest.mark.asyncio
async def test_orchestrator_nl2sql_then_dry_plan_sql() -> None:
    """契约：get_context → nl2sql → dry_plan(sql=…) → dry_run → run_sql。"""
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {
        "models": [{"name": "orders", "description": "订单", "columns": [{"name": "gmv"}]}],
        "instructions": [],
    }
    mock_client.list_models.return_value = {"models": [{"name": "orders"}]}
    mock_client.describe_model.return_value = {
        "name": "orders",
        "fields": [{"name": "gmv", "type": "DOUBLE"}],
    }
    mock_client.recall_queries.return_value = {"items": []}
    mock_client.dry_plan.return_value = {"type": "dry_plan", "sql": "SELECT 1"}
    mock_client.dry_run.return_value = {"ok": True}
    mock_client.run_sql.return_value = {"columns": [], "rows": [], "summary": "ok"}

    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(
        type="text_to_sql",
        sql="SELECT 1",
        prompt_system="SYS",
        prompt_user="USER_PROMPT",
        raw='{"type":"text_to_sql","sql":"SELECT 1"}',
    )

    scope = MagicMock()
    scope.inject_row_scope = AsyncMock(
        return_value=RowScopeInjectOutcome(verdict="allow", sql="SELECT 1")
    )
    scope.assert_sql_within_scope = MagicMock()

    orch = AskOrchestrator(
        mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=scope
    )
    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    request = AskRequest(question="本月销售额", connection_id=1)
    identity = AskIdentity(user_id=1)
    resolution = IqdScopeResolution(
        decision="allow", allowed_item_keys=["orders"], subject_summary="", connection_id=1
    )

    with patch.object(orch, "_get_config_client", return_value=config_mock):
        result = await orch.ask(request, identity, resolution)

    nl2sql.generate.assert_awaited_once()
    mock_client.dry_plan.assert_awaited_once()
    call_kwargs: dict[str, Any] = mock_client.dry_plan.await_args.kwargs
    assert "sql" in call_kwargs
    assert call_kwargs["sql"] == "SELECT 1"
    assert "question" not in call_kwargs

    mock_client.dry_run.assert_awaited_once()
    mock_client.run_sql.assert_awaited_once()
    scope.inject_row_scope.assert_awaited_once()
    scope.assert_sql_within_scope.assert_called_once()
    assert result.response.nl2sql_debug is not None
    assert result.response.nl2sql_debug.get("prompt_user") == "USER_PROMPT"


@pytest.mark.asyncio
async def test_orchestrator_dry_run_column_error_retries_once() -> None:
    """dry_run 报列不存在时，带 repair_hint 重生成一次后再 dry_run。"""
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {
        "models": [
            {
                "name": "ads_spm_trd_sale_category_day_df",
                "columns": [{"name": "ord_date"}, {"name": "gmv"}],
            }
        ],
        "instructions": [],
    }
    mock_client.list_models.return_value = {
        "models": [{"name": "ads_spm_trd_sale_category_day_df"}]
    }
    mock_client.describe_model.return_value = {
        "name": "ads_spm_trd_sale_category_day_df",
        "fields": [
            {"name": "ord_date", "type": "DATE"},
            {"name": "gmv", "type": "DOUBLE"},
        ],
    }
    mock_client.recall_queries.return_value = {"items": []}
    mock_client.dry_plan.side_effect = [
        {
            "type": "dry_plan",
            "sql": (
                "SELECT gmv FROM ads_spm_trd_sale_category_day_df "
                "WHERE dt >= '2024-01-01'"
            ),
        },
        {
            "type": "dry_plan",
            "sql": (
                "SELECT gmv FROM ads_spm_trd_sale_category_day_df "
                "WHERE ord_date >= '2024-01-01'"
            ),
        },
    ]
    mock_client.dry_run.side_effect = [
        Exception("Column 'dt' cannot be resolved"),
        {"ok": True},
    ]
    mock_client.run_sql.return_value = {
        "columns": [],
        "rows": [],
        "summary": "ok",
    }

    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.side_effect = [
        Nl2SqlResult(
            type="text_to_sql",
            sql=(
                "SELECT gmv FROM ads_spm_trd_sale_category_day_df "
                "WHERE dt >= '2024-01-01'"
            ),
            prompt_system="sys",
            prompt_user="attempt1",
            raw="raw1",
        ),
        Nl2SqlResult(
            type="text_to_sql",
            sql=(
                "SELECT gmv FROM ads_spm_trd_sale_category_day_df "
                "WHERE ord_date >= '2024-01-01'"
            ),
            prompt_system="sys",
            prompt_user="attempt2-repair",
            raw="raw2",
        ),
    ]

    scope = MagicMock()
    scope.inject_row_scope = AsyncMock(
        side_effect=[
            RowScopeInjectOutcome(
                verdict="allow",
                sql=(
                    "SELECT gmv FROM ads_spm_trd_sale_category_day_df "
                    "WHERE dt >= '2024-01-01'"
                ),
            ),
            RowScopeInjectOutcome(
                verdict="allow",
                sql=(
                    "SELECT gmv FROM ads_spm_trd_sale_category_day_df "
                    "WHERE ord_date >= '2024-01-01'"
                ),
            ),
        ]
    )
    scope.assert_sql_within_scope = MagicMock()

    orch = AskOrchestrator(
        mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=scope
    )
    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    with patch.object(orch, "_get_config_client", return_value=config_mock):
        result = await orch.ask(
            AskRequest(question="上季度门店销售", connection_id=1),
            AskIdentity(user_id=1),
            IqdScopeResolution(
                decision="allow",
                allowed_item_keys=["ads_spm_trd_sale_category_day_df"],
                connection_id=1,
            ),
        )

    assert result.response.status == "succeeded"
    assert nl2sql.generate.await_count == 2
    second_kwargs = nl2sql.generate.await_args_list[1].kwargs
    assert "dt" in (second_kwargs.get("repair_hint") or "")
    assert mock_client.dry_run.await_count == 2
    assert "ord_date" in (result.response.sql or "")
    assert len((result.response.nl2sql_debug or {}).get("attempts") or []) == 2


@pytest.mark.asyncio
async def test_orchestrator_general_question_raises() -> None:
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {"models": [], "instructions": []}
    mock_client.list_models.return_value = {"models": []}

    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(
        type="GENERAL", summary="这是闲聊，无法查数"
    )

    orch = AskOrchestrator(mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=MagicMock())
    # 无授权表时才走 45206；有授权表时 GENERAL 降级为 SqlFailedError
    with pytest.raises(QuestionUnsupportedError):
        await orch.ask(
            AskRequest(question="你好"),
            AskIdentity(user_id=1),
            IqdScopeResolution(decision="allow", allowed_item_keys=[], connection_id=1),
        )
    mock_client.dry_plan.assert_not_awaited()


@pytest.mark.asyncio
async def test_orchestrator_general_with_tables_becomes_sql_failed() -> None:
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {"models": [], "instructions": []}
    mock_client.list_models.return_value = {"models": []}
    mock_client.recall_queries.return_value = {"items": []}
    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(
        type="GENERAL",
        summary="无法生成",
        prompt_system="sys",
        prompt_user="user",
        raw='{"type":"GENERAL"}',
    )

    orch = AskOrchestrator(mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=MagicMock())
    result = await orch.ask(
        AskRequest(question="查销售额"),
        AskIdentity(user_id=1),
        IqdScopeResolution(decision="allow", allowed_item_keys=["orders"], connection_id=1),
    )
    assert result.response.status == "failed"
    assert result.response.nl2sql_debug is not None
    assert result.response.nl2sql_debug.get("prompt_user") == "user"


@pytest.mark.asyncio
async def test_orchestrator_empty_sql_raises() -> None:
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {"models": [], "instructions": []}
    mock_client.list_models.return_value = {"models": []}
    mock_client.recall_queries.return_value = {"items": []}
    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(
        type="text_to_sql",
        sql="",
        prompt_system="sys",
        prompt_user="user-q",
        raw="{}",
    )

    orch = AskOrchestrator(mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=MagicMock())
    result = await orch.ask(
        AskRequest(question="查一下"),
        AskIdentity(user_id=1),
        IqdScopeResolution(decision="allow", allowed_item_keys=["t"], connection_id=1),
    )
    assert result.response.status == "failed"
    assert "user-q" in (result.response.nl2sql_debug or {}).get("prompt_user", "")
