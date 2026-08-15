"""技能参考资料读取回归测试（UI#1.5）。

覆盖：
- ``Skill.read_reference_file`` 按相对路径读出 references / scripts 文本内容；
- 路径穿越（``..``）与绝对路径被拒绝（返回 None，满足「安全读」）；
- ``GET /skills/{id}`` 对 package 技能把 references 文件内容填入 ``reference_contents``。
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
    name: 会员画像
    handler: mcp:crm-server:query
    description: d
    ---
    # 执行流程
    """
).strip()


@pytest.fixture
def package_skill(tmp_path: Path) -> Skill:
    pkg = tmp_path / "member-profile"
    (pkg / "scripts").mkdir(parents=True)
    (pkg / "references").mkdir()
    (pkg / "references" / "guide.md").write_text("# guide\n详情见正文。", encoding="utf-8")
    (pkg / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
    return Skill(
        skill_id="member-profile",
        name="会员画像",
        description="d",
        package_dir=str(pkg),
    )


def test_read_reference_file_returns_content(package_skill: Skill) -> None:
    assert package_skill.read_reference_file("references/guide.md") == "# guide\n详情见正文。"


def test_read_reference_file_blocks_traversal(package_skill: Skill) -> None:
    assert package_skill.read_reference_file("references/../../etc/passwd") is None


def test_read_reference_file_rejects_absolute_path(package_skill: Skill) -> None:
    assert package_skill.read_reference_file("/etc/passwd") is None


def test_read_reference_file_missing_file(package_skill: Skill) -> None:
    assert package_skill.read_reference_file("references/nope.md") is None


def test_get_skill_populates_reference_contents(
    package_skill: Skill, tmp_path: Path
) -> None:
    skill = package_skill
    skill.references = ["references/guide.md"]

    registry = MagicMock()
    registry.register = AsyncMock()
    registry.get = MagicMock(return_value=skill)
    set_registry(registry)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/skills")
    client = TestClient(app)

    resp = client.get("/api/v1/skills/member-profile")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["reference_contents"] == {"references/guide.md": "# guide\n详情见正文。"}
