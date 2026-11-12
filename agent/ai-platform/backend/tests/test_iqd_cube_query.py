"""cube 分支单测：命中 cube → query_cube(sql_only) → 走原有安全管线。

覆盖（2026-09-28 新增）：
- ``_pick_cube``：命中 / 无信号不命中 / 平局不命中；
- ``_cube_child_names``：camelCase 与 snake_case 兼容；
- ``Nl2SqlGenerator.generate_cube_query`` + ``_parse_cube_response``：mock 与解析容错；
- orchestrator 端到端：命中 cube 时 **不调 nl2sql.generate**，而是用 query_cube 生成的 SQL，
  且仍经过 inject_row_scope / lineage_check / dry_run / run_sql（安全链路不被绕过）。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.agent.mis_iqd.nl2sql import CubeQuerySpec, Nl2SqlGenerator
from src.agent.mis_iqd.orchestrator import AskOrchestrator
from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    RowScopeInjectOutcome,
)
from src.models.iqd_schema import AskRequest

CUBES = [
    {
        "name": "sale_by_store",
        "measures": [{"name": "kds_sum"}, {"name": "cust_cnt_sum"}],
        "dimensions": [{"name": "store_id"}, {"name": "ord_date"}],
    },
    {
        "name": "cost_by_category",
        "measures": [{"name": "cost_sum"}],
        "dimensions": [{"name": "category_id"}],
    },
]


# ---------------------------------------------------------------- 纯函数：选 cube


def test_pick_cube_matches_by_name() -> None:
    picked = AskOrchestrator._pick_cube(CUBES, question="看下 sale_by_store 的销售")
    assert picked is not None and picked["name"] == "sale_by_store"


def test_pick_cube_matches_by_measure() -> None:
    picked = AskOrchestrator._pick_cube(CUBES, question="各门店 kds_sum 是多少")
    assert picked is not None and picked["name"] == "sale_by_store"


def test_pick_cube_none_when_no_signal() -> None:
    """普通明细问题不应被强行套上 cube（cube 只适合聚合）。"""
    assert AskOrchestrator._pick_cube(CUBES, question="查一下订单明细") is None


def test_pick_cube_none_on_tie() -> None:
    cubes = [
        {"name": "a", "measures": [{"name": "kds_sum"}]},
        {"name": "b", "measures": [{"name": "kds_sum"}]},
    ]
    assert AskOrchestrator._pick_cube(cubes, question="kds_sum") is None


def test_cube_child_names_accepts_camel_and_snake() -> None:
    assert AskOrchestrator._cube_child_names(
        {"measures": [{"name": "m1"}, "m2"]}, "measures"
    ) == ["m1", "m2"]
    assert AskOrchestrator._cube_child_names(
        {"timeDimensions": [{"name": "ord_date"}]}, "time_dimensions", "timeDimensions"
    ) == ["ord_date"]


# ---------------------------------------------------------------- LLM 规格解析


def test_parse_cube_response_extracts_spec() -> None:
    gen = Nl2SqlGenerator(mock=True)
    spec = gen._parse_cube_response(
        '{"type":"cube_query","cube":"sale_by_store","measures":["kds_sum"],'
        '"dimensions":["store_id"],"filters":["store_id=0001"],"limit":10}',
        cube="sale_by_store",
    )
    assert spec.type == "cube_query"
    assert spec.measures == ["kds_sum"]
    assert spec.dimensions == ["store_id"]
    assert spec.filters == ["store_id=0001"]
    assert spec.limit == 10
    assert spec.to_payload()["sql_only"] if False else "sql_only" not in spec.to_payload()


def test_parse_cube_response_general() -> None:
    gen = Nl2SqlGenerator(mock=True)
    spec = gen._parse_cube_response('{"type":"GENERAL","summary":"闲聊"}', cube="c")
    assert spec.type == "GENERAL" and spec.summary == "闲聊"


def test_parse_cube_response_tolerates_garbage() -> None:
    gen = Nl2SqlGenerator(mock=True)
    spec = gen._parse_cube_response("完全不合法", cube="c")
    assert spec.type == "cube_query" and spec.measures == []


@pytest.mark.asyncio
async def test_generate_cube_query_mock() -> None:
    gen = Nl2SqlGenerator(mock=True)
    spec = await gen.generate_cube_query(
        question="各门店销售", cube="sale_by_store", measures=["kds_sum", "cust_cnt_sum"],
        dimensions=["store_id"],
    )
    assert spec.type == "cube_query"
    assert spec.cube == "sale_by_store"
    assert spec.measures == ["kds_sum"]


# ---------------------------------------------------------------- orchestrator 端到端


def _make_orch(mock_client: Any, nl2sql: Any) -> AskOrchestrator:
    scope = MagicMock()
    scope.inject_row_scope = AsyncMock(
        return_value=RowScopeInjectOutcome(verdict="allow", sql="SELECT store_id, SUM(kds) FROM ads GROUP BY 1")
    )
    scope.assert_sql_within_scope = MagicMock()
    return AskOrchestrator(mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=scope)


@pytest.mark.asyncio
async def test_orchestrator_uses_cube_sql_and_skips_nl2sql() -> None:
    """命中 cube：用 query_cube 生成的 SQL，且 **不** 调 nl2sql.generate。"""
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {"models": [], "instructions": []}
    mock_client.list_cubes.return_value = {"cubes": CUBES}
    mock_client.recall_queries.return_value = {"items": []}
    mock_client.list_models.return_value = {"models": [{"name": "ads_spm_trd_sale_category_day_df"}]}
    mock_client.describe_model.return_value = {
        "name": "ads_spm_trd_sale_category_day_df",
        "fields": [{"name": "store_id", "type": "VARCHAR"}, {"name": "kds", "type": "DOUBLE"}],
    }
    cube_sql = "SELECT store_id, SUM(kds) AS kds_sum FROM ads_spm_trd_sale_category_day_df GROUP BY 1"
    mock_client.query_cube.return_value = {"sql": cube_sql}
    mock_client.dry_plan.return_value = {"type": "dry_plan", "sql": cube_sql}
    mock_client.dry_run.return_value = {"ok": True}
    mock_client.run_sql.return_value = {"columns": [], "rows": [], "summary": "ok", "row_count": 0}

    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate_cube_query.return_value = CubeQuerySpec(
        type="cube_query", cube="sale_by_store", measures=["kds_sum"], dimensions=["store_id"]
    )

    orch = _make_orch(mock_client, nl2sql)
    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    request = AskRequest(question="各门店 kds_sum 是多少", connection_id=1)
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=["ads_spm_trd_sale_category_day_df"],
        subject_summary="",
        connection_id=1,
    )

    with patch.object(orch, "_get_config_client", return_value=config_mock):
        result = await orch.ask(request, AskIdentity(user_id=1), resolution)

    # cube 生成 SQL：
    mock_client.query_cube.assert_awaited_once()
    cube_kwargs = mock_client.query_cube.await_args.kwargs
    assert cube_kwargs["cube"] == "sale_by_store"
    assert cube_kwargs["sql_only"] is True
    assert cube_kwargs["measures"] == ["kds_sum"]
    # **未**走手写 SQL 通道：
    nl2sql.generate.assert_not_awaited()
    # 安全管线仍在跑：注入 + 血缘 + dry_run + run_sql
    orch._scope_resolver.inject_row_scope.assert_awaited()
    mock_client.dry_run.assert_awaited_once()
    mock_client.run_sql.assert_awaited_once()
    assert result.response.sql


@pytest.mark.asyncio
async def test_orchestrator_falls_back_to_nl2sql_when_no_cube() -> None:
    """无 cube 信号：正常降级到 NL→SQL（回归保护）。"""
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {"models": [], "instructions": []}
    mock_client.list_cubes.return_value = {"cubes": []}
    mock_client.recall_queries.return_value = {"items": []}
    mock_client.list_models.return_value = {"models": [{"name": "orders"}]}
    mock_client.describe_model.return_value = {"name": "orders", "fields": [{"name": "gmv"}]}
    mock_client.dry_plan.return_value = {"sql": "SELECT 1"}
    mock_client.dry_run.return_value = {"ok": True}
    mock_client.run_sql.return_value = {"columns": [], "rows": [], "summary": "ok"}

    from src.agent.mis_iqd.nl2sql import Nl2SqlResult

    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(type="text_to_sql", sql="SELECT 1")

    orch = _make_orch(mock_client, nl2sql)
    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    request = AskRequest(question="本月销售额", connection_id=1)
    resolution = IqdScopeResolution(
        decision="allow", allowed_item_keys=["orders"], subject_summary="", connection_id=1
    )

    with patch.object(orch, "_get_config_client", return_value=config_mock):
        await orch.ask(request, AskIdentity(user_id=1), resolution)

    nl2sql.generate.assert_awaited_once()
    mock_client.query_cube.assert_not_awaited()
