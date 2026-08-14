"""技能解析 / 详情端点回归测试（R1/R4/R8）。

覆盖：
- R1  create 不传 handler 返回 201 且 handler==""
- R4  POST /skills/parse：标准 SKILL.md → metadata+body；无 FM → {metadata:{}, body:原文}；坏 YAML → 400
- R8  GET /skills/{id}：package skill 返回非空 body+附件；custom 返回 body=null
"""

from __future__ import annotations

import textwrap
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes.skill import router, set_registry
from src.skills.models import Skill

SKILL_MD = textwrap.dedent(
    """
    ---
    name: 会员积分查询
    handler: mcp:crm-server:query_points
    description: 按会员 ID 查询积分
    ---
    # 执行流程
    1. 读取 member_id
    2. 调用积分服务
    """
).strip()


@pytest.fixture
def client_with_registry() -> TestClient:
    # 真实装配见 src/main.py: skill_router 挂在 /api/v1/skills
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/skills")
    registry = MagicMock()
    registry.register = AsyncMock()
    registry.get = MagicMock(return_value=None)
    set_registry(registry)
    return TestClient(app)


def test_create_skill_without_handler_defaults_empty(
    client_with_registry: TestClient,
) -> None:
    resp = client_with_registry.post(
        "/api/v1/skills",
        json={"skill_id": "demo-skill", "name": "Demo", "description": "d"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["data"]["handler"] == ""


def test_parse_standard_skill_md(client_with_registry: TestClient) -> None:
    resp = client_with_registry.post("/api/v1/skills/parse", json={"content": SKILL_MD})
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["metadata"]["name"] == "会员积分查询"
    assert data["metadata"]["handler"] == "mcp:crm-server:query_points"
    assert "执行流程" in data["body"]


def test_parse_without_front_matter_returns_empty_metadata(
    client_with_registry: TestClient,
) -> None:
    raw = "只是普通正文，没有 Front Matter。"
    resp = client_with_registry.post("/api/v1/skills/parse", json={"content": raw})
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["metadata"] == {}
    assert data["body"] == raw


def test_parse_bad_yaml_returns_400(client_with_registry: TestClient) -> None:
    # 本 API 错误走信封 code（与重复创建返回 code=3001 同款约定，HTTP 仍为 200），
    # 前端由 unwrap 在 code!=0 时抛错。
    bad = "---\nname: foo\nkey: [unclosed\n---\n正文"
    resp = client_with_registry.post("/api/v1/skills/parse", json={"content": bad})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["code"] == 400
    assert "解析失败" in body["message"]


def test_get_skill_package_loads_body_and_attachments(
    client_with_registry: TestClient, tmp_path: Path
) -> None:
    pkg = tmp_path / "member-profile"
    (pkg / "scripts").mkdir(parents=True)
    (pkg / "references").mkdir()
    (pkg / "assets").mkdir()
    (pkg / "scripts" / "run.py").write_text("print(1)", encoding="utf-8")
    (pkg / "references" / "guide.md").write_text("# guide", encoding="utf-8")
    (pkg / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")

    skill = Skill(
        skill_id="member-profile",
        name="会员画像",
        description="d",
        package_dir=str(pkg),
    )
    registry = MagicMock()
    registry.register = AsyncMock()
    registry.get = MagicMock(return_value=skill)
    set_registry(registry)

    resp = client_with_registry.get("/api/v1/skills/member-profile")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["body"] is not None and "执行流程" in data["body"]
    assert "scripts/run.py" in data["scripts"]
    assert "references/guide.md" in data["references"]


def test_get_skill_custom_has_null_body(client_with_registry: TestClient) -> None:
    skill = Skill(skill_id="custom-1", name="自建", description="d")
    registry = MagicMock()
    registry.register = AsyncMock()
    registry.get = MagicMock(return_value=skill)
    set_registry(registry)

    resp = client_with_registry.get("/api/v1/skills/custom-1")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["body"] is None
    assert data["scripts"] == []
