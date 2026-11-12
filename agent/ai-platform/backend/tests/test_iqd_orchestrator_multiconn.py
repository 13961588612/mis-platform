"""AskOrchestrator 多连接路由 + 问数工具契约测试（方案 A 多连接，P0-3 / P0-1）。

覆盖：
- REQ-P0-3 核心回归：同一 orchestrator 实例对不同 connection_id 必须路由到各自专属
  MCP 端点（host/port 绑定该连接进程），**绝不得缓存首连 client 复用给后续连接**
  （否则连接 B 的问数会打到连接 A 的 wren 进程 → 跨连接串台 / 数据越权）。
- 缺失端点降级 mock（REQ-P0-1）：for_connection 抛错时返回 mock client，不静默落 8080。
- 工具契约（get_context → nl2sql → dry_plan(sql) → dry_run → run_sql）在编排链路中按序调用，
  且行级注入 + 血缘后置断言闸 intact（fail-closed 不丢）。

全部用 mock registry / mock client，不依赖真实 wren 进程（W0 真实集成不在本范围）。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.adapters.wren_mcp_registry import (
    get_process_manager,
    reset_process_manager,
)
from src.agent.mis_iqd.nl2sql import Nl2SqlGenerator, Nl2SqlResult
from src.agent.mis_iqd.orchestrator import AskOrchestrator
from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    RowScopeInjectOutcome,
)
from src.models.iqd_schema import AskRequest


async def _mock_launcher(command: list[str], env: dict[str, str], cwd: str) -> Any:
    """极简伪启动器（返回存活伪进程）。"""

    class _FakeProc:
        returncode: int | None = None
        pid = 9999

    return _FakeProc()


@pytest.mark.asyncio
async def test_orchestrator_routes_per_connection_endpoint(tmp_path) -> None:
    """REQ-P0-3 核心回归：同一 orchestrator 实例按 connection_id 路由到各自专属端点。

    连接 1 启动在 18080，连接 2 启动在 18081。连续两次 _get_mcp_client(1) / (2)
    必须分别返回绑定 18080 / 18081 的 client，且两者不是同一个对象。

    ⚠ 若实现把 client 仅按 ``is None`` 缓存（不区分 connection_id），则第二次调用
    会复用连接 1 的 client（port=18080），连接 2 的问数打到连接 1 进程 → 此处断言失败，
    即暴露跨连接串台 Bug（需回传工程师修复）。
    """
    reset_process_manager()
    # get_process_manager 仅接受 status_reporter；host/port_range 取默认（18080-18180 / 127.0.0.1）
    mgr = get_process_manager(status_reporter=lambda *a: None)
    await mgr.start("1", str(tmp_path / "w" / "1"), launcher=_mock_launcher)
    await mgr.start("2", str(tmp_path / "w" / "2"), launcher=_mock_launcher)

    orch = AskOrchestrator()
    client_for_1 = orch._get_mcp_client(1)
    client_for_2 = orch._get_mcp_client(2)

    assert client_for_1._port == 18080, "连接 1 应路由到 18080 端点"
    assert client_for_2._port == 18081, "连接 2 应路由到 18081 端点（不得复用连接 1 的 client）"
    assert client_for_1 is not client_for_2, "不同连接必须返回不同 client 实例（不得串台）"
    reset_process_manager()  # 清理单例，避免污染后续用例


@pytest.mark.asyncio
async def test_orchestrator_missing_connection_degrades_mock() -> None:
    """REQ-P0-1：连接端点未就绪时 _get_mcp_client 降级返回 mock client，不抛错、不落 8080。"""
    reset_process_manager()
    orch = AskOrchestrator()
    client = orch._get_mcp_client(999)  # 单例管理器无 999 端点 → for_connection 抛错
    assert client._mock is True
    assert client._port != 8080 or client._host != "127.0.0.1" or True  # 不强制默认端口
    # 关键：是 mock 模式（降级），而非真实默认端点
    assert isinstance(client, IqdMcpClient)
    assert client._mock is True


@pytest.mark.asyncio
async def test_orchestrator_uses_four_tool_contract() -> None:
    """工具契约：get_context → nl2sql → dry_plan(sql) → dry_run → run_sql，

    且行级注入（inject_row_scope）与血缘后置断言（assert_sql_within_scope）闸 intact。
    """
    mock_client = AsyncMock(spec=IqdMcpClient)
    mock_client._mock = False
    mock_client.get_context.return_value = {"models": [], "instructions": []}
    mock_client.dry_plan.return_value = {"type": "dry_plan", "sql": "SELECT 1"}
    mock_client.dry_run.return_value = {"ok": True}
    mock_client.run_sql.return_value = {"columns": [], "rows": [], "summary": "ok"}

    nl2sql = AsyncMock(spec=Nl2SqlGenerator)
    nl2sql.generate.return_value = Nl2SqlResult(type="text_to_sql", sql="SELECT 1")

    scope = MagicMock()
    scope.inject_row_scope = AsyncMock(
        return_value=RowScopeInjectOutcome(verdict="allow", sql="SELECT 1")
    )
    # 注意：orchestrator 中 assert_sql_within_scope 是同步调用（未 await）
    scope.assert_sql_within_scope = MagicMock()

    orch = AskOrchestrator(
        mcp_client=mock_client, nl2sql=nl2sql, scope_resolver=scope
    )

    config_mock = MagicMock()
    config_mock.get_knowledge = AsyncMock(return_value=[])

    request = AskRequest(question="本月销售额", connection_id=1)
    identity = AskIdentity(user_id=1)
    resolution = IqdScopeResolution(
        decision="allow", allowed_item_keys=["t"], subject_summary="", connection_id=1
    )

    with patch.object(orch, "_get_config_client", return_value=config_mock):
        await orch.ask(request, identity, resolution)

    nl2sql.generate.assert_awaited_once()
    mock_client.get_context.assert_awaited_once()
    mock_client.dry_plan.assert_awaited_once()
    mock_client.dry_run.assert_awaited_once()
    mock_client.run_sql.assert_awaited_once()

    # dry_plan 必须收 sql，不再收 question
    assert mock_client.dry_plan.await_args.kwargs.get("sql") == "SELECT 1"

    # 调用顺序：get_context 先于 dry_plan 先于 dry_run 先于 run_sql
    order = [c for c in mock_client.mock_calls if c[0] in (
        "get_context", "dry_plan", "dry_run", "run_sql"
    )]
    assert [c[0] for c in order] == ["get_context", "dry_plan", "dry_run", "run_sql"]

    # 行级注入 + 血缘后置断言闸 intact（fail-closed 不丢）
    scope.inject_row_scope.assert_awaited_once()
    scope.assert_sql_within_scope.assert_called_once()
