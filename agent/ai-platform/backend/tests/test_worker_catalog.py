"""WorkerCatalog / role 配置化 / 工具注册与能力声明单测（T03 · C3）。

覆盖 design-impl.md §6 T03 验收项：

1. Catalog 构建：``role == worker and enabled`` ∩ ``INVOKE_AGENT_WHITELIST``；
   为空时回退 ``DEFAULT_WHITELIST`` 静态描述。
2. 动态 schema：``agent__invoke`` 的 ``input_schema.agent_id`` 为 ``enum``，
   取值与 ``worker_ids()` 一致；``description`` 含各 Worker 的 ``when_to_use``。
3. role 约束：``role=worker`` 构建出的 registry 不含 ``agent__invoke`` / ``agent``；
   ``coordinator`` 自动补齐；``None`` 保持既有行为（零回归）。
4. 双名过渡：``DELEGATE_TOOL_ALIAS_ENABLED`` 打开时两个工具名均可 ``get()`` 到。
5. 能力声明：``OpenHarnessFactory().capabilities().to_dict()`` 中
   ``multi_agent is False`` 且 ``delegation is True``。
6. 红线：``InvokeAgentTool()`` 无参构造行为与改造前完全一致。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from src.agent.config import AgentConfig, AgentMetadata, AgentRole
from src.coordinator import catalog as catalog_module
from src.coordinator.catalog import (
    WorkerCatalog,
    WorkerSpec,
    build_worker_catalog,
    get_worker_catalog,
    refresh_worker_catalog,
)
from src.runtime import tool_registry_builder as trb
from src.skills.tools.invoke_agent import (
    DEFAULT_WHITELIST,
    InvokeAgentInput,
    InvokeAgentTool,
)

# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_catalog_singleton() -> Any:
    """每个用例前后清空 Catalog 单例，避免用例间污染（§7.4）。"""
    catalog_module._reset_for_test()
    yield
    catalog_module._reset_for_test()


def _make_config(
    agent_id: str,
    *,
    role: AgentRole = AgentRole.WORKER,
    when_to_use: str = "",
    enabled: bool = True,
    output_contract: str = "text",
    safety_level: str = "read_only",
    with_metadata: bool = True,
) -> AgentConfig:
    """构造用于测试的 AgentConfig。

    Args:
        agent_id: Agent ID。
        role: 调度角色。
        when_to_use: metadata 中的适用场景。
        enabled: metadata 中的启用状态。
        output_contract: 输出契约。
        safety_level: 安全级别。
        with_metadata: 是否附带 metadata section。

    Returns:
        构造好的 :class:`AgentConfig`。
    """
    metadata: AgentMetadata | None = None
    if with_metadata:
        metadata = AgentMetadata(
            name=agent_id,
            display_name=f"{agent_id} 显示名",
            description=f"{agent_id} 描述。第二句被截断。",
            enabled=enabled,
            capabilities=["cap-a"],
            when_to_use=when_to_use,
            input_contract=["user_question"],
            output_contract=output_contract,
            safety_level=safety_level,
        )
    return AgentConfig(
        agent_id=agent_id,
        name=agent_id,
        display_name=f"{agent_id} 显示名",
        description=f"{agent_id} 描述。",
        role=role,
        metadata=metadata,
    )


def _patch_sources(
    monkeypatch: pytest.MonkeyPatch,
    configs: list[AgentConfig],
    whitelist: list[str] | None = None,
) -> None:
    """把 ConfigManager 与 Settings 替换为测试替身。

    Args:
        monkeypatch: pytest monkeypatch fixture。
        configs: `list_configs()` 的返回值。
        whitelist: `INVOKE_AGENT_WHITELIST` 配置值（None 表示未配置）。
    """
    fake_manager = SimpleNamespace(list_configs=lambda: list(configs))
    monkeypatch.setattr(
        "src.config_manager.manager.get_config_manager",
        lambda: fake_manager,
        raising=True,
    )
    monkeypatch.setattr(
        catalog_module,
        "get_settings",
        lambda: SimpleNamespace(INVOKE_AGENT_WHITELIST=whitelist),
        raising=True,
    )


# ---------------------------------------------------------------------------
# 1. WorkerSpec
# ---------------------------------------------------------------------------


def test_worker_spec_defaults_are_conservative() -> None:
    """WorkerSpec 默认值：只读、text 输出、启用。"""
    spec = WorkerSpec(agent_id="mis-rag")
    assert spec.enabled is True
    assert spec.output_contract == "text"
    assert spec.safety_level == "read_only"
    assert spec.is_read_only() is True
    assert spec.capabilities == []


def test_worker_spec_summary_line_contains_hint_and_output() -> None:
    """summary_line 同时渲染显示名、适用场景与输出契约。"""
    spec = WorkerSpec(
        agent_id="mis-rag",
        display_name="知识库问答",
        when_to_use="制度条款检索",
        output_contract="answer+citations",
    )
    line = spec.summary_line()
    assert line.startswith("- mis-rag（知识库问答）：")
    assert "制度条款检索" in line
    assert "answer+citations" in line


def test_worker_spec_non_read_only_blocks_parallel() -> None:
    """needs_hitl 的 Worker 不被视为只读（C5 并行闸口依赖）。"""
    assert WorkerSpec(agent_id="w", safety_level="needs_hitl").is_read_only() is False


# ---------------------------------------------------------------------------
# 2. Catalog 构建
# ---------------------------------------------------------------------------


def test_build_catalog_filters_role_and_whitelist(monkeypatch: pytest.MonkeyPatch) -> None:
    """只有 role=worker ∩ 白名单内的 Agent 进入目录。"""
    configs = [
        _make_config("mis-copilot", role=AgentRole.COORDINATOR),
        _make_config("mis-rag", when_to_use="制度检索"),
        _make_config("crm-assistant", when_to_use="CRM 查询"),
        _make_config("some-other", when_to_use="不在白名单"),
    ]
    _patch_sources(monkeypatch, configs, whitelist=["mis-rag", "crm-assistant"])

    catalog = build_worker_catalog()

    assert catalog.worker_ids() == ["crm-assistant", "mis-rag"]
    assert catalog.fallback is False
    assert catalog.get("mis-rag") is not None
    assert catalog.get("some-other") is None
    assert catalog.get("mis-copilot") is None


def test_build_catalog_collects_coordinators(monkeypatch: pytest.MonkeyPatch) -> None:
    """role=coordinator 的 Agent 进入 coordinators 且禁止被委派。"""
    configs = [
        _make_config("mis-copilot", role=AgentRole.COORDINATOR),
        _make_config("hr-copilot", role=AgentRole.COORDINATOR),
        _make_config("mis-rag", when_to_use="制度检索"),
    ]
    _patch_sources(monkeypatch, configs, whitelist=["mis-rag"])

    catalog = build_worker_catalog()

    assert catalog.coordinators == ["hr-copilot", "mis-copilot"]
    assert catalog.is_coordinator("mis-copilot") is True
    assert catalog.is_coordinator("hr-copilot") is True
    assert catalog.is_coordinator("mis-rag") is False


def test_build_catalog_skips_disabled_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    """metadata.enabled=false 的 Worker 不进入目录。"""
    configs = [
        _make_config("mis-rag", when_to_use="制度检索"),
        _make_config("mis-summary", when_to_use="摘要", enabled=False),
    ]
    _patch_sources(monkeypatch, configs, whitelist=["mis-rag", "mis-summary"])

    catalog = build_worker_catalog()

    assert catalog.worker_ids() == ["mis-rag"]


def test_build_catalog_uses_description_when_hint_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未声明 when_to_use 时回落到 description 首句（不为空串）。"""
    configs = [_make_config("some-worker", when_to_use="")]
    _patch_sources(monkeypatch, configs, whitelist=["some-worker"])

    spec = build_worker_catalog().get("some-worker")

    assert spec is not None
    assert spec.when_to_use == "some-worker 描述"


def test_build_catalog_prefers_static_hint_for_known_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """已知 Worker 未声明 when_to_use 时使用静态兜底文案。"""
    configs = [_make_config("mis-rag", when_to_use="")]
    _patch_sources(monkeypatch, configs, whitelist=["mis-rag"])

    spec = build_worker_catalog().get("mis-rag")

    assert spec is not None
    assert spec.when_to_use == catalog_module.STATIC_WORKER_HINTS["mis-rag"]["when_to_use"]


def test_build_catalog_falls_back_to_default_whitelist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没有任何 Worker 配置时回退 DEFAULT_WHITELIST 静态描述。"""
    _patch_sources(monkeypatch, [], whitelist=None)

    catalog = build_worker_catalog()

    assert catalog.fallback is True
    assert set(catalog.worker_ids()) == set(DEFAULT_WHITELIST)
    assert catalog.coordinators == ["mis-copilot"]
    assert catalog.get("mis-rag") is not None
    assert catalog.get("mis-rag").when_to_use  # 静态文案非空


def test_build_catalog_survives_config_manager_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ConfigManager 抛异常时降级为静态目录而非崩溃。"""

    def _boom() -> Any:
        raise RuntimeError("config manager not initialized")

    monkeypatch.setattr(
        "src.config_manager.manager.get_config_manager", _boom, raising=True
    )
    monkeypatch.setattr(
        catalog_module,
        "get_settings",
        lambda: SimpleNamespace(INVOKE_AGENT_WHITELIST=None),
        raising=True,
    )

    catalog = build_worker_catalog()

    assert catalog.fallback is True
    assert set(catalog.worker_ids()) == set(DEFAULT_WHITELIST)


def test_build_catalog_ignores_mock_like_whitelist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """settings 为 Mock 时（非 list）按未配置处理，避免污染白名单。"""
    from unittest.mock import MagicMock

    _patch_sources(monkeypatch, [], whitelist=None)
    monkeypatch.setattr(catalog_module, "get_settings", MagicMock(), raising=True)

    catalog = build_worker_catalog()

    assert set(catalog.worker_ids()) == set(DEFAULT_WHITELIST)


def test_singleton_and_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_worker_catalog 单例复用；refresh 后按新配置重建。"""
    _patch_sources(monkeypatch, [_make_config("mis-rag")], whitelist=["mis-rag"])
    first = get_worker_catalog()
    assert get_worker_catalog() is first
    assert first.worker_ids() == ["mis-rag"]

    _patch_sources(
        monkeypatch,
        [_make_config("mis-rag"), _make_config("mis-summary")],
        whitelist=["mis-rag", "mis-summary"],
    )
    second = refresh_worker_catalog()

    assert second is not first
    assert second.worker_ids() == ["mis-rag", "mis-summary"]
    assert get_worker_catalog() is second


# ---------------------------------------------------------------------------
# 3. description / 动态 schema
# ---------------------------------------------------------------------------


def test_render_tool_description_appends_when_to_use() -> None:
    """description 渲染出每个 Worker 的 when_to_use。"""
    catalog = WorkerCatalog(
        workers={
            "mis-rag": WorkerSpec(agent_id="mis-rag", when_to_use="制度条款检索"),
            "mis-summary": WorkerSpec(agent_id="mis-summary", when_to_use="文本摘要"),
        }
    )

    rendered = catalog.render_tool_description(base="BASE")

    assert rendered.startswith("BASE")
    assert "制度条款检索" in rendered
    assert "文本摘要" in rendered
    assert rendered.index("mis-rag") < rendered.index("mis-summary")


def test_render_tool_description_empty_catalog_returns_base() -> None:
    """空目录时 description 原样返回（零回归）。"""
    assert WorkerCatalog().render_tool_description(base="BASE") == "BASE"


def test_build_input_model_narrows_agent_id_to_enum() -> None:
    """agent_id 被收窄为 Literal，schema 中呈现为 enum。"""
    catalog = WorkerCatalog(
        workers={
            "mis-rag": WorkerSpec(agent_id="mis-rag", when_to_use="制度条款检索"),
            "crm-assistant": WorkerSpec(agent_id="crm-assistant", when_to_use="CRM"),
        }
    )

    model = catalog.build_input_model(InvokeAgentInput)
    schema = model.model_json_schema()

    assert model is not InvokeAgentInput
    assert issubclass(model, InvokeAgentInput)
    assert schema["properties"]["agent_id"]["enum"] == catalog.worker_ids()
    # 新增字段仍在（不破坏既有契约）
    assert {"content", "metadata", "task_brief", "intent", "mode"} <= set(
        schema["properties"]
    )


def test_build_input_model_is_cached() -> None:
    """同一 Catalog 重复构建返回同一个模型类（避免重复建模）。"""
    catalog = WorkerCatalog(workers={"mis-rag": WorkerSpec(agent_id="mis-rag")})
    assert catalog.build_input_model(InvokeAgentInput) is catalog.build_input_model(
        InvokeAgentInput
    )


def test_build_input_model_empty_catalog_returns_static_model() -> None:
    """空目录不改动入参模型。"""
    assert WorkerCatalog().build_input_model(InvokeAgentInput) is InvokeAgentInput


def test_dynamic_model_rejects_unknown_agent_id() -> None:
    """收窄后的模型拒绝白名单外的 agent_id。"""
    catalog = WorkerCatalog(workers={"mis-rag": WorkerSpec(agent_id="mis-rag")})
    model = catalog.build_input_model(InvokeAgentInput)

    assert model(agent_id="mis-rag", content="x").agent_id == "mis-rag"
    with pytest.raises(ValidationError):
        model(agent_id="mis-copilot", content="x")


# ---------------------------------------------------------------------------
# 4. InvokeAgentTool 注入 / 红线
# ---------------------------------------------------------------------------


def test_tool_with_catalog_exposes_enum_and_hints() -> None:
    """注入 Catalog 后工具 schema 与描述随目录同步。"""
    catalog = WorkerCatalog(
        workers={"mis-rag": WorkerSpec(agent_id="mis-rag", when_to_use="制度条款检索")}
    )

    tool = InvokeAgentTool(catalog=catalog)
    schema = tool.to_api_schema()

    assert schema["name"] == "agent__invoke"
    assert schema["input_schema"]["properties"]["agent_id"]["enum"] == ["mis-rag"]
    assert "制度条款检索" in schema["description"]


def test_tool_without_catalog_is_unchanged() -> None:
    """红线：无参构造行为与现网完全一致。"""
    tool = InvokeAgentTool()

    assert tool.name == "agent__invoke"
    assert tool.input_model is InvokeAgentInput
    assert tool.description == InvokeAgentTool.description
    assert "enum" not in tool.to_api_schema()["input_schema"]["properties"]["agent_id"]


def test_tool_alias_shares_implementation() -> None:
    """双名过渡：别名工具与规范名同实现，仅 name 不同。"""
    catalog = WorkerCatalog(workers={"mis-rag": WorkerSpec(agent_id="mis-rag")})

    alias = InvokeAgentTool(tool_name="agent", catalog=catalog)

    assert alias.name == "agent"
    assert type(alias) is InvokeAgentTool
    assert alias.input_model is catalog.build_input_model(InvokeAgentInput)


# ---------------------------------------------------------------------------
# 5. role 约束（tool_registry_builder）
# ---------------------------------------------------------------------------


def test_normalize_role_accepts_enum_and_str() -> None:
    """role 归一化：枚举 / 字符串 / 非法值。"""
    assert trb.normalize_role(AgentRole.COORDINATOR) == "coordinator"
    assert trb.normalize_role("Worker") == "worker"
    assert trb.normalize_role(None) is None
    assert trb.normalize_role("teammate") is None
    assert trb.normalize_role(object()) is None


def test_role_none_keeps_legacy_patterns() -> None:
    """role=None 时模式原样返回（零回归红线）。"""
    configured = ["skill", "mcp__*"]
    assert trb.apply_role_tool_constraint(configured, None) == configured
    assert trb.resolve_allowed_tool_patterns(configured, None) == configured


def test_role_coordinator_appends_delegate_tool() -> None:
    """coordinator 自动补齐 agent__invoke。"""
    patterns = trb.apply_role_tool_constraint(["skill"], AgentRole.COORDINATOR)

    assert "agent__invoke" in patterns
    assert "skill" in patterns


def test_role_coordinator_does_not_duplicate_delegate_tool() -> None:
    """已配置委派工具时不重复追加。"""
    patterns = trb.apply_role_tool_constraint(["skill", "agent__invoke"], "coordinator")

    assert patterns.count("agent__invoke") == 1


def test_role_worker_strips_delegate_tool() -> None:
    """worker 强制剔除委派工具模式（纵深防御第二道闸）。"""
    patterns = trb.apply_role_tool_constraint(
        ["skill", "agent__invoke", "agent"], AgentRole.WORKER
    )

    assert patterns == ["skill"]


def test_worker_registry_excludes_delegate_tools() -> None:
    """role=worker 构建的 registry 不含 agent__invoke / agent（即便 YAML 写 *）。"""
    registry = trb.create_platform_tool_registry(None, ["*"], AgentRole.WORKER)
    names = [tool.name for tool in registry.list_tools()]

    assert "agent__invoke" not in names
    assert "agent" not in names
    assert "skill" in names


def test_coordinator_registry_includes_delegate_tool() -> None:
    """role=coordinator 即便 allowed_tools 漏配也拿得到 agent__invoke。"""
    registry = trb.create_platform_tool_registry(None, ["skill"], AgentRole.COORDINATOR)
    names = [tool.name for tool in registry.list_tools()]

    assert "agent__invoke" in names


def test_legacy_registry_behaviour_unchanged() -> None:
    """不传 role 时注册结果与改造前一致（agent__invoke 需显式放开）。"""
    without = [
        tool.name for tool in trb.create_platform_tool_registry(None, ["skill"]).list_tools()
    ]
    with_delegate = [
        tool.name
        for tool in trb.create_platform_tool_registry(
            None, ["skill", "agent__invoke"]
        ).list_tools()
    ]

    assert without == ["skill"]
    assert with_delegate == ["skill", "agent__invoke"]


def test_alias_registered_only_when_flag_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """双名开关：默认关闭不注册别名；打开后两个名字都能 get 到。"""
    default_names = [tool.name for tool in trb.create_agent_source_registry(None).list_tools()]
    assert "agent" not in default_names
    assert "agent__invoke" in default_names

    monkeypatch.setattr(trb, "_delegate_alias_enabled", lambda: True, raising=True)
    registry = trb.create_platform_tool_registry(
        None, ["skill", "agent__invoke", "agent"], AgentRole.COORDINATOR
    )

    assert registry.get("agent__invoke") is not None
    assert registry.get("agent") is not None


# ---------------------------------------------------------------------------
# 6. AgentConfig role / metadata 解析
# ---------------------------------------------------------------------------


def test_from_yaml_dict_parses_role_and_metadata() -> None:
    """agent.yaml 的 role 与 metadata.yaml 的委派契约被正确解析。"""
    config = AgentConfig.from_yaml_dict(
        {
            "agent": {"name": "mis-rag", "role": "worker"},
            "metadata": {
                "name": "mis-rag",
                "display_name": "知识库问答",
                "when_to_use": "制度条款检索",
                "input_contract": ["user_question"],
                "output_contract": "answer+citations",
                "safety_level": "read_only",
                "capabilities": ["rag"],
            },
        }
    )

    assert config.role is AgentRole.WORKER
    assert config.metadata is not None
    assert config.metadata.when_to_use == "制度条款检索"
    assert config.metadata.output_contract == "answer+citations"
    assert config.metadata.input_contract == ["user_question"]


def test_from_yaml_dict_parses_coordinator_role() -> None:
    """role: coordinator 被正确解析（大小写与空格容错）。"""
    config = AgentConfig.from_yaml_dict(
        {"agent": {"name": "mis-copilot", "role": " Coordinator "}}
    )

    assert config.role is AgentRole.COORDINATOR


def test_from_yaml_dict_defaults_to_worker_role() -> None:
    """未配置或非法 role 一律降级为 worker（不抛异常）。"""
    assert AgentConfig.from_yaml_dict({"agent": {"name": "x"}}).role is AgentRole.WORKER
    assert (
        AgentConfig.from_yaml_dict({"agent": {"name": "x", "role": "boss"}}).role
        is AgentRole.WORKER
    )


def test_from_yaml_dict_without_metadata_keeps_none() -> None:
    """无 metadata section 时保持 None（既有行为）。"""
    assert AgentConfig.from_yaml_dict({"agent": {"name": "x"}}).metadata is None


def test_agent_metadata_new_fields_have_defaults() -> None:
    """既有 metadata.yaml（无新字段）仍可加载。"""
    metadata = AgentMetadata(name="mis-rag", display_name="知识库问答")

    assert metadata.when_to_use == ""
    assert metadata.input_contract == []
    assert metadata.output_contract == "text"
    assert metadata.safety_level == "read_only"


# ---------------------------------------------------------------------------
# 7. 能力声明
# ---------------------------------------------------------------------------


def test_openharness_capabilities_declare_delegation_not_swarm() -> None:
    """修正虚假声明：multi_agent=False，delegation=True。"""
    from src.runtime.factory import OpenHarnessFactory

    capabilities = OpenHarnessFactory().capabilities().to_dict()

    assert capabilities["multi_agent"] is False
    assert capabilities["delegation"] is True
    # 其余能力保持不变
    assert capabilities["streaming"] is True
    assert capabilities["generative_ui"] is True
    assert capabilities["mcp"] is True
    assert capabilities["hitl"] is True
    assert capabilities["stateful"] is True


def test_runtime_capabilities_delegation_defaults_false() -> None:
    """RuntimeCapabilities 新增字段默认 False（只增不改）。"""
    from src.runtime.registry import RuntimeCapabilities

    assert RuntimeCapabilities().to_dict()["delegation"] is False
