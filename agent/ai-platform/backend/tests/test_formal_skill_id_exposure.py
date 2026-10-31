"""收紧 skill 暴露面：提示词 / 工具枚举只使用正式 skill_id。"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import src.config_manager.loader as config_loader_mod
from openharness.tools.base import ToolExecutionContext, ToolResult
from pydantic import BaseModel, ValidationError

from src.agent.config import AgentConfig, SkillRef
from src.config_manager.loader import ConfigLoader
from src.runtime.oh_runtime_builder import (
    build_formal_skill_ids_prompt,
    enabled_package_skill_ids,
    materialize_oh_skill_view,
    prompt_exposed_skill_ids,
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
    assert all(s.prompt_expose is True for s in cfg.skills)


def test_from_yaml_dict_prompt_expose_default_true_and_false() -> None:
    cfg = AgentConfig.from_yaml_dict(
        {
            "agent": {"name": "spm-report", "display_name": "SPM"},
            "skills": {
                "enabled": [
                    {"skill_id": "sm-report-router", "prompt_expose": True},
                    {"skill_id": "sm-shop-sale", "prompt_expose": False},
                    "sm-common-info-calendar",
                ]
            },
        }
    )
    by_id = {s.skill_id: s for s in cfg.skills}
    assert by_id["sm-report-router"].prompt_expose is True
    assert by_id["sm-shop-sale"].prompt_expose is False
    assert by_id["sm-common-info-calendar"].prompt_expose is True


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

    view = materialize_oh_skill_view(cfg, tmp_path)
    assert view.loadable_ids == ["member.points-account"]
    assert view.prompt_ids == ["member.points-account"]
    assert len(view.load_dirs) == 1
    view_md = Path(view.load_dirs[0]) / "member.points-account" / "SKILL.md"
    assert view_md.is_file()
    assert "member.points-account" in view_md.read_text(encoding="utf-8")

    # resolve_extra_skill_dirs 与可加载视图一致，且不再暴露 packages/crm 整类目录
    assert resolve_extra_skill_dirs(cfg, tmp_path) == view.load_dirs
    assert not any(Path(d).name == "crm" for d in view.load_dirs)


def test_materialize_splits_prompt_and_load_views(tmp_path: Path) -> None:
    packages = tmp_path / "skills" / "packages" / "spm"
    for sid, desc in (
        ("sm-report-router", "router"),
        ("sm-shop-sale", "sale"),
    ):
        pkg = packages / sid
        pkg.mkdir(parents=True)
        (pkg / "SKILL.md").write_text(
            f"---\nname: {sid}\nskill_id: {sid}\ndescription: {desc}\n---\nbody\n",
            encoding="utf-8",
        )
    cfg = AgentConfig(
        agent_id="spm-report",
        name="spm-report",
        display_name="SPM",
        skills=[
            SkillRef(skill_id="sm-report-router", enabled=True, prompt_expose=True),
            SkillRef(skill_id="sm-shop-sale", enabled=True, prompt_expose=False),
        ],
    )
    assert prompt_exposed_skill_ids(cfg) == ["sm-report-router"]
    view = materialize_oh_skill_view(cfg, tmp_path)
    assert view.loadable_ids == ["sm-report-router", "sm-shop-sale"]
    assert view.prompt_ids == ["sm-report-router"]
    assert (Path(view.load_dirs[0]) / "sm-shop-sale" / "SKILL.md").is_file()
    assert (Path(view.prompt_dirs[0]) / "sm-report-router" / "SKILL.md").is_file()
    assert not (Path(view.prompt_dirs[0]) / "sm-shop-sale").exists()


@pytest.mark.asyncio
async def test_mis_iqd_business_analysis_skill_materializes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_base = Path(__file__).resolve().parents[2] / "configs"
    settings = SimpleNamespace(CONFIG_BASE_PATH=str(config_base), CONFIG_MODE="file_system")
    monkeypatch.setattr(config_loader_mod, "get_settings", lambda: settings)

    cfg = await ConfigLoader().load_agent_config("mis-iqd")

    assert "skill" in cfg.runtime.allowed_tools
    assert "iqd__ask" in cfg.runtime.allowed_tools
    assert "business.analysis" in {skill.skill_id for skill in cfg.skills}

    view = materialize_oh_skill_view(cfg, config_base)
    assert view.loadable_ids == ["business.analysis"]
    skill_md = Path(view.load_dirs[0]) / "business.analysis" / "SKILL.md"
    assert skill_md.is_file()
    assert "iqd__ask" in skill_md.read_text(encoding="utf-8")


def test_formal_skill_ids_prompt_lists_ids_only() -> None:
    text = build_formal_skill_ids_prompt(
        ["member.points-account", "member.profile"]
    )
    assert "member.points-account" in text
    assert "member.profile" in text
    assert "禁止缩写" in text
    assert "member-profile" in text  # 作为反例


def test_formal_skill_ids_prompt_mentions_deferred_loadables() -> None:
    text = build_formal_skill_ids_prompt(
        ["sm-report-router"],
        loadable_ids=["sm-report-router", "sm-shop-sale"],
    )
    assert "sm-report-router" in text
    assert "总控路由" in text
    assert "sm-shop-sale" not in text  # 不把下游 id 刷进列表，只提示按路由加载


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


@pytest.mark.asyncio
async def test_platform_skill_tool_delegates_model_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """成功路径必须实例化 SkillTool.input_model，不能调用其元类。"""
    captured: dict[str, object] = {}

    class _Input(BaseModel):
        name: str

    class _FakeSkillTool:
        input_model = _Input

        def __init__(self) -> None:
            return None

        async def execute(self, arguments: BaseModel, context: ToolExecutionContext) -> ToolResult:
            del context
            captured["arguments"] = arguments
            return ToolResult(output="skill body")

    monkeypatch.setattr("src.runtime.platform_skill_tool.SkillTool", _FakeSkillTool)
    tool = PlatformSkillTool(allowed_skill_ids=["member.coupons-account"])
    result = await tool.execute(
        tool.input_model(name="member.coupons-account"),
        ToolExecutionContext(cwd=Path("."), metadata={}),
    )
    assert result.is_error is False
    assert result.output == "skill body"
    arguments = captured["arguments"]
    assert isinstance(arguments, _Input)
    assert arguments.name == "member.coupons-account"


def test_create_agent_source_registry_registers_platform_skill_tool() -> None:
    registry = create_agent_source_registry(
        None, allowed_skill_ids=["member.profile"]
    )
    skill = registry.get("skill")
    assert skill is not None
    assert isinstance(skill, PlatformSkillTool)
    assert "member.profile" in skill.description
