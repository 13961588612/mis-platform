"""问数上下文降级的**可观测性**单测（2026-09-28）。

<背景>
``get_context`` 失败时旧实现只写日志、把 ``native`` 置空 —— 界面上看不出「本轮没有
语义上下文」。真机踩坑（get_context 必填 question 却传了 role_scope）就是这样被静默
吞掉很久。现在降级会写进 ``plan[]``（``searching`` 步 = ``skipped`` + 原因）。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.agent.mis_iqd.nl2sql import Nl2SqlGenerator, Nl2SqlResult
from src.agent.mis_iqd.orchestrator import AskOrchestrator
from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    RowScopeInjectOutcome,
)
from src.models.iqd_schema import AskRequest


def _orch(mock_client, nl2sql) -> AskOrchestrator:
    scope = MagicMock()
    scope.inject_row_scope = AsyncMock(
        return_value=RowScopeInjectOutcome(verdict="allow", sql="SELECT 1")
    )
    scope.assert_sql_within_scope = MagicMock()
    return AskOrchestrator(mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=scope)


def _base_client() -> AsyncMock:
    c = AsyncMock(spec=IqdMcpClient)
    c._mock = False
    c.get_instructions.return_value = {}
    c.list_cubes.return_value = {"cubes": []}
    c.recall_queries.return_value = {"items": []}
    c.list_models.return_value = {"models": [{"name": "t"}]}
    c.describe_model.return_value = {"name": "t", "fields": []}
    c.dry_plan.return_value = {"sql": "SELECT 1"}
    c.dry_run.return_value = {"ok": True}
    c.run_sql.return_value = {"columns": [], "rows": [], "summary": "ok"}
    return c


def _resolution() -> IqdScopeResolution:
    return IqdScopeResolution(
        decision="allow", allowed_item_keys=["t"], subject_summary="", connection_id=1
    )


@pytest.mark.asyncio
async def test_get_context_failure_marks_plan_step_skipped() -> None:
    """核心：get_context 失败 → plan[searching] = skipped 且带上原因（可观测）。"""
    mock_client = _base_client()
    mock_client.get_context.side_effect = RuntimeError(
        "1 validation error for get_contextArguments / question / Field required"
    )
    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(type="text_to_sql", sql="SELECT 1")

    orch = _orch(mock_client, nl2sql)
    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    request = AskRequest(question="本月销售额", connection_id=1)
    with patch.object(orch, "_get_config_client", return_value=config_mock):
        result = await orch.ask(request, AskIdentity(user_id=1), _resolution())

    step = next(s for s in result.response.plan if s.code == "searching")
    assert step.status == "skipped", "降级必须可见（此前只写日志）"
    assert step.detail and "已降级" in step.detail
    assert "Field required" in step.detail  # 原因可读
    # 主链路不受影响
    assert result.response.status == "succeeded"


@pytest.mark.asyncio
async def test_get_context_success_keeps_done() -> None:
    """对照：正常时不标 skipped（避免误报降级）。"""
    mock_client = _base_client()
    mock_client.get_context.return_value = {"schema": "Catalog: wren", "strategy": "full"}
    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(type="text_to_sql", sql="SELECT 1")

    orch = _orch(mock_client, nl2sql)
    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    request = AskRequest(question="本月销售额", connection_id=1)
    with patch.object(orch, "_get_config_client", return_value=config_mock):
        result = await orch.ask(request, AskIdentity(user_id=1), _resolution())

    step = next(s for s in result.response.plan if s.code == "searching")
    assert step.status == "done"


def test_brief_error_is_single_line_and_clipped() -> None:
    assert AskOrchestrator._brief_error(RuntimeError("a\nb\nc")) == "a b c"
    assert len(AskOrchestrator._brief_error(RuntimeError("x" * 500))) <= 120
    assert AskOrchestrator._brief_error(RuntimeError("")) == "RuntimeError"
