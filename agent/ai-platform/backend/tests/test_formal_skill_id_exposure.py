"""收紧 skill 暴露面：提示词 / 工具枚举只使用正式 skill_id。"""

from __future__ import annotations

from pathlib import Path

import pytest
from openharness.tools.base import ToolExecutionContext
from pydantic import ValidationError

from src.agent.config import AgentConfig, SkillRef
from src.runtime.oh_runtime_builder import (
    build_formal_skill_ids_prompt,
    enabled_package_skill_ids,
    materialize_oh_skill_view,
    resolve_extra_skill_dirs,
)
from src.runtime.platform_skill_tool import PlatformSkillTool
from src.runtime.tool_registry_builder import create_agent_source_registry


def _crm_config(*skill_ids: str) -> AgentConfig:
    return AgentConfig(
        agent_id="crm-assistant",
        name="crm-assistant",
        display_name="CRM",
        skills=[SkillRef(skill_id=sid, enabled=True) for sid in skill_ids],
    )


def test_enabled_package_skill_ids_skips_mcp_discriminants() -> None:
    cfg = _crm_config(
        "mcp-mcp-api-suite-callApi",
        "member.profile",
        "member.points-account",
    )
    assert enabled_package_skill_ids(cfg) == [
        "member.points-account",
        "member.profile",
    ]


def test_from_yaml_dict_accepts_string_enabled_skills() -> None:
    cfg = AgentConfig.from_yaml_dict(
        {
            "agent": {"name": "crm-assistant", "display_name": "CRM"},
            "skills": {
                "enabled": [
                    "member.profile",
                    {"skill_id": "member.points-account", "enabled": True},
                ]
            },
        }
    )
    assert [s.skill_id for s in cfg.skills] == [
        "member.profile",
        "member.points-account",
    ]


def test_materialize_oh_skill_view_uses_formal_skill_id_dirs(tmp_path: Path) -> None:
    packages = tmp_path / "skills" / "packages" / "crm"
    pkg = packages / "member-points-account"
    pkg.mkdir(parents=True)
    (pkg / "SKILL.md").write_text(
        "---\nname: member.points-account\nskill_id: member.points-account\n"
        "description: points\n---\nbody\n",
        encoding="utf-8",
    )
    cfg = _crm_config("member.points-account", "mcp-foo")

    dirs, exposed = materialize_oh_skill_view(cfg, tmp_path)
    assert exposed == ["member.points-account"]
    assert len(dirs) == 1
    view_md = Path(dirs[0]) / "member.points-account" / "SKILL.md"
    assert view_md.is_file()
    assert "member.points-account" in view_md.read_text(encoding="utf-8")

    # resolve_extra_skill_dirs 与物化结果一致，且不再暴露 packages/crm 整类目录
    assert resolve_extra_skill_dirs(cfg, tmp_path) == dirs
    assert not any(Path(d).name == "crm" for d in dirs)


def test_formal_skill_ids_prompt_lists_ids_only() -> None:
    text = build_formal_skill_ids_prompt(
        ["member.points-account", "member.profile"]
    )
    assert "member.points-account" in text
    assert "member.profile" in text
    assert "禁止缩写" in text
    assert "member-profile" in text  # 作为反例


def test_platform_skill_tool_enum_rejects_bare_member() -> None:
    tool = PlatformSkillTool(
        allowed_skill_ids=["member.profile", "member.points-account"]
    )
    schema = tool.input_model.model_json_schema()
    name_schema = schema["properties"]["name"]
    assert set(name_schema.get("enum") or []) == {
        "member.points-account",
        "member.profile",
    }
    with pytest.raises(ValidationError):
        tool.input_model(name="member")


@pytest.mark.asyncio
async def test_platform_skill_tool_rejects_unknown_when_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = PlatformSkillTool(allowed_skill_ids=["member.profile"])

    class _Reg:
        def resolve_canonical_id(self, raw: str) -> str:
            return raw

    monkeypatch.setattr(
        "src.bootstrap.skills_mcp.get_skill_registry",
        lambda: _Reg(),
    )
    # bypass Literal：用自由字段模型直接测 execute 拒识分支
    free = PlatformSkillTool(allowed_skill_ids=None)
    result = await tool.execute(
        free.input_model(name="member"),
        ToolExecutionContext(cwd=Path("."), metadata={}),
    )
    assert result.is_error
    assert "member.profile" in (result.output or "")
    assert "member" in (result.output or "")


def test_create_agent_source_registry_registers_platform_skill_tool() -> None:
    registry = create_agent_source_registry(
        None, allowed_skill_ids=["member.profile"]
    )
    skill = registry.get("skill")
    assert skill is not None
    assert isinstance(skill, PlatformSkillTool)
    assert "member.profile" in skill.description
