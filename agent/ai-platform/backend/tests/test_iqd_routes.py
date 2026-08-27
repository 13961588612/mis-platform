"""方案 A 多连接 MCP 路由前缀对齐 E2E（与 BFF AiPlatformClient 契约一致）。

验证 Python 路由注册在 /api/v1 下，且路径与 BFF 完全对齐：
- /api/v1/iqd/mcp/{start,stop,restart,status,list}
- /api/v1/iqd/self-heal/{force-rebuild,re-index,validate}

用 FastAPI TestClient + dependency_overrides 替换鉴权，mock 内部服务方法，
仅验证「路由可达 + 前缀正确 + 转发到对应服务方法」。若前缀写错，TestClient 返回 404 → 断言失败。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.deps import get_current_user, get_trace_id
from src.api.routes.iqd_mcp_manager import router as mcp_router
from src.api.routes.iqd_selfheal import router as heal_router
from src.agent.mis_iqd.mcp_lifecycle import IqdMcpLifecycleService
from src.agent.mis_iqd.service import IqdAskService, SyncResult


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(mcp_router, prefix="/api/v1")
    app.include_router(heal_router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": 1}
    app.dependency_overrides[get_trace_id] = lambda: "trace-x"
    return TestClient(app)


def test_mcp_start_route_prefix(client: TestClient) -> None:
    """POST /api/v1/iqd/mcp/start 可达并转发到 lifecycle.start_connection。"""
    with patch.object(
        IqdMcpLifecycleService,
        "start_connection",
        new=AsyncMock(
            return_value={"connection_id": 1, "mcp_status": "running", "host": "127.0.0.1", "port": 18080}
        ),
    ):
        resp = client.post("/api/v1/iqd/mcp/start", json={"connection_id": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["mcp_status"] == "running"


def test_mcp_status_route_prefix(client: TestClient) -> None:
    """GET /api/v1/iqd/mcp/status?connection_id=1 可达并转发到 lifecycle.status_connection。

    status_connection 是同步方法（非 async），必须用 MagicMock 而非 AsyncMock 垫底，
    否则路由会把协程塞进响应体导致 PydanticSerializationError。
    """
    with patch.object(
        IqdMcpLifecycleService,
        "status_connection",
        new=MagicMock(return_value={"connection_id": 1, "mcp_status": "running"}),
    ):
        resp = client.get("/api/v1/iqd/mcp/status", params={"connection_id": 1})
    assert resp.status_code == 200
    assert resp.json()["data"]["connection_id"] == 1


def test_mcp_list_route_prefix(client: TestClient) -> None:
    """GET /api/v1/iqd/mcp/list 可达。list_connections 为同步方法，用 MagicMock 垫底。"""
    with patch.object(
        IqdMcpLifecycleService, "list_connections", new=MagicMock(return_value=[])
    ):
        resp = client.get("/api/v1/iqd/mcp/list")
    assert resp.status_code == 200
    assert resp.json()["code"] == 0


def test_selfheal_force_rebuild_route_prefix(client: TestClient) -> None:
    """POST /api/v1/iqd/self-heal/force-rebuild 可达并转发到 service.trigger_force_rebuild。"""
    with patch.object(
        IqdAskService,
        "trigger_force_rebuild",
        new=AsyncMock(return_value=SyncResult(connection_id=1, build_status="success")),
    ):
        resp = client.post("/api/v1/iqd/self-heal/force-rebuild", json={"connection_id": 1})
    assert resp.status_code == 200
    assert resp.json()["data"]["connection_id"] == 1


def test_selfheal_reindex_route_prefix(client: TestClient) -> None:
    """POST /api/v1/iqd/self-heal/re-index 可达并转发到 service.trigger_reindex。"""
    with patch.object(
        IqdAskService,
        "trigger_reindex",
        new=AsyncMock(return_value=SyncResult(connection_id=1, build_status="success")),
    ):
        resp = client.post("/api/v1/iqd/self-heal/re-index", json={"connection_id": 1})
    assert resp.status_code == 200
    assert resp.json()["data"]["connection_id"] == 1


def test_selfheal_validate_route_prefix(client: TestClient) -> None:
    """POST /api/v1/iqd/self-heal/validate 可达并转发到 service.trigger_validate。"""
    with patch.object(
        IqdAskService,
        "trigger_validate",
        new=AsyncMock(return_value=SyncResult(connection_id=1, build_status="success")),
    ):
        resp = client.post("/api/v1/iqd/self-heal/validate", json={"connection_id": 1})
    assert resp.status_code == 200
    assert resp.json()["data"]["connection_id"] == 1
