"""T04 任务6：Admin 路由的 Worker Catalog 与 Dispatch Traces 端点（O1g / O2）。

覆盖 spec.md §3.8 与 C1：

* GET  /admin/worker-catalog      — 聚合 Worker Catalog（workers / coordinators / fallback）；
* PUT  /admin/worker-catalog      — 批量改写 enabled / when_to_use 并写回各 Agent metadata；
* GET  /admin/dispatch-traces     — 只读展示内存委派轨迹（按 session / worker / intent 过滤）。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.config as src_config
import src.config_manager.file_service as fs
import src.config_manager.manager as mgr_mod
import src.coordinator.catalog as catalog_mod
from src.api.deps import get_current_user
from src.api.routes.admin import router
from src.coordinator import trace as trace_mod
from src.coordinator.trace import DispatchTraceEntry


@pytest.fixture
def admin_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, Path]:
    base = tmp_path / "configs"
    (base / "agents").mkdir(parents=True)
    settings = SimpleNamespace(
        CONFIG_MODE="file_system",
        CONFIG_BASE_PATH=str(base),
        CONFIG_WATCH_ENABLED=False,
        INVOKE_AGENT_WHITELIST=None,
    )
    monkeypatch.setattr(fs, "get_settings", lambda: settings)
    monkeypatch.setattr(src_config, "get_settings", lambda: settings, raising=False)
    monkeypatch.setattr(catalog_mod, "get_settings", lambda: settings, raising=False)

    # 隔离 Catalog 单例，并让目录构建走「空配置 -> 静态兜底」分支
    catalog_mod._reset_for_test()
    fake_cm = MagicMock()
    fake_cm.list_configs = MagicMock(return_value=[])
    monkeypatch.setattr(mgr_mod, "get_config_manager", lambda: fake_cm)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app), base


def test_get_worker_catalog_shape(
    admin_client: tuple[TestClient, Path]
) -> None:
    client, _ = admin_client

    resp = client.get("/api/v1/admin/worker-catalog")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert set(data.keys()) >= {"workers", "coordinators", "fallback"}
    assert isinstance(data["workers"], list)


def test_put_worker_catalog_writes_back_enabled(
    admin_client: tuple[TestClient, Path]
) -> None:
    client, base = admin_client
    agent_dir = base / "agents" / "w1"
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "metadata.yaml").write_text(
        "metadata:\n  enabled: true\n  when_to_use: old\n", encoding="utf-8"
    )

    resp = client.put(
        "/api/v1/admin/worker-catalog",
        json={"updates": [{"agent_id": "w1", "enabled": False}]},
    )

    assert resp.status_code == 200
    meta = (agent_dir / "metadata.yaml").read_text(encoding="utf-8")
    assert "enabled: false" in meta


def test_get_dispatch_traces_filters(
    admin_client: tuple[TestClient, Path]
) -> None:
    client, _ = admin_client
    trace_mod._reset_for_test()
    asyncio.run(
        trace_mod.push_dispatch_trace(
            "sess-1", DispatchTraceEntry(intent="rag", worker_id="mis-rag", task_id="t1")
        )
    )

    resp = client.get("/api/v1/admin/dispatch-traces?session_id=sess-1")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] >= 1
    assert data["traces"][0]["worker_id"] == "mis-rag"

    # 不存在的过滤条件应返回空
    empty = client.get("/api/v1/admin/dispatch-traces?worker_id=no-such")
    assert empty.json()["data"]["total"] == 0
