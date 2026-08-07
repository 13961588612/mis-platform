"""T04 任务3：``agent_config_files`` API 路由（事件处理器层面验证）。

通过 FastAPI TestClient 直接驱动路由（不启动完整 lifespan），覆盖：

* GET  /agents/{agent_id}/config-files                — 文件树列举
* GET  /agents/{agent_id}/config-files/{path}         — 读取（密钥脱敏）
* PUT  /agents/{agent_id}/config-files/{path}         — 写入（校验 + 热更新）

错误码映射：路径越界 400 / 不存在 404 / 超限 413 / 含脱敏占位符 422。
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

import src.config as src_config
import src.config_manager.file_service as fs
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.api.deps import get_current_user
from src.api.routes.agent_config_files import router


@pytest.fixture
def client_and_base(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, Path, MagicMock]:
    """构建一个仅挂载 agent_config_files 路由的最小 App，并隔离磁盘与 ConfigManager。"""
    base = tmp_path / "configs"
    (base / "agents").mkdir(parents=True)
    settings = SimpleNamespace(
        CONFIG_MODE="file_system",
        CONFIG_BASE_PATH=str(base),
        CONFIG_WATCH_ENABLED=False,
    )
    monkeypatch.setattr(fs, "get_settings", lambda: settings)
    monkeypatch.setattr(src_config, "get_settings", lambda: settings, raising=False)

    mgr = MagicMock()
    mgr.reload_agent = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(fs, "get_config_manager", lambda: mgr)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app), base, mgr


def _seed_agent(base: Path, agent_id: str = "a1") -> Path:
    agent_dir = base / "agents" / agent_id
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "agent.yaml").write_text(
        "agent:\n  name: a1\n  display_name: A1\n  password: hunter2\n",
        encoding="utf-8",
    )
    return agent_dir


def test_list_config_files(client_and_base: tuple[TestClient, Path, MagicMock]) -> None:
    client, base, _ = client_and_base
    _seed_agent(base, "a1")

    resp = client.get("/api/v1/agents/a1/config-files")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert isinstance(data, list)
    assert "agent.yaml" in [f["path"] for f in data]


def test_read_config_file_masks_secret(
    client_and_base: tuple[TestClient, Path, MagicMock]
) -> None:
    client, base, _ = client_and_base
    _seed_agent(base, "a1")

    resp = client.get("/api/v1/agents/a1/config-files/agent.yaml")

    assert resp.status_code == 200
    payload = resp.json()["data"]
    assert payload["masked"] is True
    assert fs.MASKED_VALUE in payload["content"]


def test_read_config_file_not_found(
    client_and_base: tuple[TestClient, Path, MagicMock]
) -> None:
    client, base, _ = client_and_base

    resp = client.get("/api/v1/agents/a1/config-files/metadata.yaml")

    assert resp.status_code == 404
    assert resp.json()["code"] == 7003


def test_write_config_file_ok(
    client_and_base: tuple[TestClient, Path, MagicMock]
) -> None:
    client, base, mgr = client_and_base
    _seed_agent(base, "a1")
    content = "agent:\n  name: a1\n  display_name: A1\n  description: d\n"

    resp = client.put(
        "/api/v1/agents/a1/config-files/agent.yaml",
        json={"content": content},
    )

    assert resp.status_code == 200
    assert resp.json()["data"]["reloaded"] is True
    mgr.reload_agent.assert_called_once_with("a1")


def test_write_config_file_path_escape_rejected(
    client_and_base: tuple[TestClient, Path, MagicMock]
) -> None:
    client, base, _ = client_and_base

    resp = client.put(
        "/api/v1/agents/a1/config-files/" + "..%2F..%2Fetc%2Fpasswd",
        json={"content": "x: 1"},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == 7004


def test_write_config_file_too_large(
    client_and_base: tuple[TestClient, Path, MagicMock]
) -> None:
    client, base, _ = client_and_base
    _seed_agent(base, "a1")
    big = "agent:\n  name: a1\n  display_name: A1\n" + ("#" * (fs.MAX_FILE_SIZE_BYTES + 10)) + "\n"

    resp = client.put(
        "/api/v1/agents/a1/config-files/agent.yaml",
        json={"content": big},
    )

    assert resp.status_code == 413
    assert resp.json()["code"] == 7006


def test_write_config_file_masked_placeholder_rejected(
    client_and_base: tuple[TestClient, Path, MagicMock]
) -> None:
    client, base, _ = client_and_base
    _seed_agent(base, "a1")
    content = f"agent:\n  name: a1\n  display_name: A1\n  password: \"{fs.MASKED_VALUE}\"\n"

    resp = client.put(
        "/api/v1/agents/a1/config-files/agent.yaml",
        json={"content": content},
    )

    assert resp.status_code == 422
    assert resp.json()["code"] == 7005
