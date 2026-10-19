"""清单列约束：city_name 不在门店维表里，真实列是 city。"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.agent.mis_iqd.catalog_schema import (
    index_catalog_columns,
    unknown_sql_columns,
)
from src.agent.mis_iqd.nl2sql import Nl2SqlResult
from src.agent.mis_iqd.orchestrator import AskOrchestrator
from src.models.iqd_schema import AskRequest


STORE = "dim_mall_chl_store_df"
STORE_COLUMNS = [
    "store_id",
    "store_name",
    "store_shotr_name",
    "store_type",
    "business_name",
    "strt_time",
    "store_level",
    "busi_type",
    "status",
    "cst_flow_type_sort",
    "cst_flow_store_sort",
    "sale_sort",
    "city",
    "belong_area",
]
BAD_SQL = (
    "SELECT DISTINCT store_name FROM dim_mall_chl_store_df "
    "WHERE city_name = '无锡' ORDER BY store_name"
)
GOOD_SQL = (
    "SELECT DISTINCT store_name FROM dim_mall_chl_store_df "
    "WHERE city = '无锡' ORDER BY store_name"
)


def _catalog_items() -> list[dict[str, str]]:
    parent = f"pg_main.result.{STORE}"
    rows: list[dict[str, str]] = [
        {
            "item_key": f"mdl:model:{STORE}",
            "kind": "model",
            "parent_key": "",
            "display_name": STORE,
        }
    ]
    for name in STORE_COLUMNS:
        rows.append(
            {
                "item_key": f"{parent}.{name}",
                "kind": "column",
                "parent_key": parent,
                "display_name": name,
            }
        )
    rows.append(
        {
            "item_key": "pg_main.result.other_table.city_name",
            "kind": "column",
            "parent_key": "pg_main.result.other_table",
            "display_name": "city_name",
        }
    )
    return rows


def test_store_catalog_rejects_city_name_and_accepts_city() -> None:
    index = index_catalog_columns(_catalog_items())
    assert index[STORE] == STORE_COLUMNS
    assert unknown_sql_columns(BAD_SQL, index) == ["city_name"]
    assert unknown_sql_columns(GOOD_SQL, index) == []


@pytest.mark.asyncio
async def test_context_uses_catalog_columns_when_describe_is_empty() -> None:
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client.list_models.return_value = {"models": []}
    mock_client.describe_model.side_effect = TimeoutError("describe_model")
    mock_client.recall_queries.side_effect = TimeoutError("recall")
    mock_client.get_instructions.side_effect = TimeoutError("rules")
    orch = AskOrchestrator(mcp_client=mock_client)
    index = index_catalog_columns(_catalog_items())
    text, described = await orch._build_nl2sql_context(
        mock_client,
        {},
        [f"pg_main.result.{STORE}"],
        question="无锡有哪几家店",
        column_index=index,
    )
    assert described == []
    assert "city" in text
    assert STORE in text
    ranked = AskOrchestrator._rank_model_candidates(
        list(index.keys()),
        question="无锡有哪几家店",
        allowed=[f"pg_main.result.{STORE}"],
    )
    assert ranked[0] == STORE


@pytest.mark.asyncio
async def test_catalog_columns_survive_long_allowed_list() -> None:
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client.list_models.return_value = {"models": []}
    mock_client.describe_model.side_effect = TimeoutError("describe_model")
    mock_client.recall_queries.side_effect = TimeoutError("recall")
    mock_client.get_instructions.side_effect = TimeoutError("rules")
    orch = AskOrchestrator(mcp_client=mock_client)
    index = index_catalog_columns(_catalog_items())
    allowed = [f"pg_main.result.padding_table_{i:03d}" for i in range(80)]
    allowed.append(f"pg_main.result.{STORE}")
    text, _described = await orch._build_nl2sql_context(
        mock_client,
        {},
        allowed,
        question="无锡有哪几家店",
        column_index=index,
    )
    assert "columns:" in text
    assert "city" in text
    assert len(text) <= 8000


@pytest.mark.asyncio
async def test_repair_rewrites_unknown_column_once() -> None:
    class _Gen:
        def __init__(self) -> None:
            self.calls = 0

        async def generate(self, **_kwargs: Any) -> Nl2SqlResult:
            self.calls += 1
            return Nl2SqlResult(type="text_to_sql", sql=GOOD_SQL, raw=GOOD_SQL)

    gen = _Gen()
    attempts: list[dict[str, Any]] = []

    def _record(outcome: Any, *, label: str) -> None:
        attempts.append({"label": label, "sql": outcome.sql})

    orch = AskOrchestrator()
    index = index_catalog_columns(_catalog_items())
    sql, error = await orch._repair_unknown_columns(
        BAD_SQL,
        index,
        nl2sql=gen,  # type: ignore[arg-type]
        request=AskRequest(question="无锡有哪几家店"),
        identity=MagicMock(user_id=1),
        query_id="q1",
        nl2sql_attempts=attempts,
        record_attempt=_record,
    )
    assert error is None
    assert sql == GOOD_SQL
    assert gen.calls == 1
    assert attempts[0]["label"] == "column_repair"


@pytest.mark.asyncio
async def test_repair_reports_missing_column_when_rewrite_still_wrong() -> None:
    class _Gen:
        async def generate(self, **_kwargs: Any) -> Nl2SqlResult:
            return Nl2SqlResult(type="text_to_sql", sql=BAD_SQL, raw=BAD_SQL)

    orch = AskOrchestrator()
    index = index_catalog_columns(_catalog_items())
    sql, error = await orch._repair_unknown_columns(
        BAD_SQL,
        index,
        nl2sql=_Gen(),  # type: ignore[arg-type]
        request=AskRequest(question="无锡有哪几家店"),
        identity=MagicMock(user_id=1),
        query_id="q1",
        nl2sql_attempts=[],
        record_attempt=lambda *_a, **_k: None,
    )
    assert sql == BAD_SQL
    assert error is not None
    assert "city_name" in error
    assert "city" in error
    assert "other_table" not in error
