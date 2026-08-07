"""T04 任务4：Agent 技能绑定路由 ``GET/PUT /agents/{agent_id}/skills``。

验证运营台「技能绑定」编辑器的两条端点：

* GET  — 返回当前启用技能 ID 列表 + 可选技能池（仅 status=active）；
* PUT  — 校验请求技能均在池中且 active，写回 ``skills/enabled-skills.yaml`` 并触发热更新；
        请求了不可绑定技能应返回 400(码7001)；未知 Agent 返回 404。
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from src.skills.models import SkillStatus
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.config as src_config
import src.config_manager.file_service as fs
from src.api.deps import (
    get_agent_manager_dep,
    get_config_manager_dep,
    get_current_user,
)
from src.api.routes.agent import router
from src.utils.exceptions import AgentNotFoundError


class _FakeSkill:
    def __init__(self, skill_id: str, status: str = "active") -> None:
        self.skill_id = skill_id
        self.name = skill_id
        self.description = f"desc-{skill_id}"
        self.category = "built_in"
        self.status = status


@pytest.fixture
def skills_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, Path, MagicMock, MagicMock]:
    base = tmp_path / "configs"
    (base / "agents").mkdir(parents=True)
    settings = SimpleNamespace(
        CONFIG_MODE="file_system",
        CONFIG_BASE_PATH=str(base),
        CONFIG_WATCH_ENABLED=False,
    )
    monkeypatch.setattr(fs, "get_settings", lambda: settings)
    monkeypatch.setattr(src_config, "get_settings", lambda: settings, raising=False)

    # 技能注册表 stub
    registry = MagicMock()
    s1 = _FakeSkill("s1", status=SkillStatus.ACTIVE)
    registry.get = MagicMock(side_effect=lambda sid: s1 if sid == "s1" else None)
    registry.list_active = MagicMock(return_value=[s1])
    monkeypatch.setattr(
        "src.bootstrap.skills_mcp.get_skill_registry", lambda: registry
    )

    # AgentManager / ConfigManager stub
    cfg = MagicMock()
    cfg.skills = []
    inst = MagicMock()
    inst.config = cfg

    def _get_agent(agent_id: str) -> Any:
        if agent_id == "nope":
            raise AgentNotFoundError(agent_id)
        return inst

    agent_mgr = MagicMock()
    agent_mgr.get_agent = _get_agent
    config_mgr = MagicMock()
    config_mgr.reload_agent = AsyncMock()

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    app.dependency_overrides[get_agent_manager_dep] = lambda: agent_mgr
    app.dependency_overrides[get_config_manager_dep] = lambda: config_mgr
    return TestClient(app), base, agent_mgr, config_mgr


def test_get_agent_skills_returns_pool(
    skills_client: tuple[TestClient, Path, MagicMock, MagicMock]
) -> None:
    client, base, _, _ = skills_client

    resp = client.get("/api/v1/agents/a1/skills")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["agent_id"] == "a1"
    assert data["enabled_skill_ids"] == []
    assert len(data["pool"]) == 1
    assert data["pool"][0]["skill_id"] == "s1"


def test_put_agent_skills_writes_enabled_skills(
    skills_client: tuple[TestClient, Path, MagicMock, MagicMock]
) -> None:
    client, base, _, config_mgr = skills_client

    resp = client.put("/api/v1/agents/a1/skills", json={"skill_ids": ["s1"]})

    assert resp.status_code == 200
    assert resp.json()["data"]["enabled_skill_ids"] == ["s1"]
    config_mgr.reload_agent.assert_awaited_once_with("a1")

    written = (base / "agents" / "a1" / "skills" / "enabled-skills.yaml").read_text(
        encoding="utf-8"
    )
    assert "enabled:" in written
    assert "s1" in written


def test_put_agent_skills_rejects_unavailable_skill(
    skills_client: tuple[TestClient, Path, MagicMock, MagicMock]
) -> None:
    client, base, _, _ = skills_client

    resp = client.put("/api/v1/agents/a1/skills", json={"skill_ids": ["bad-id"]})

    assert resp.status_code == 400
    assert resp.json()["code"] == 7001


def test_skills_endpoints_unknown_agent_404(
    skills_client: tuple[TestClient, Path, MagicMock, MagicMock]
) -> None:
    client, base, _, _ = skills_client

    assert client.get("/api/v1/agents/nope/skills").status_code == 404
    assert client.put("/api/v1/agents/nope/skills", json={"skill_ids": ["s1"]}).status_code == 404
