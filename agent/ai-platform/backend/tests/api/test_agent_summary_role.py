"""`AgentSummary.role` 暴露测试（C4 T01，design-c4.md §5 T01）。

覆盖：

* `AgentSummary` 契约：新增 `role` 字段可选（有默认值），既有字段不变；
* `list_agents` 投影：`mis-copilot` → ``coordinator``，
  `mis-rag` / `mis-summary` / `mis-extract` / `crm-assistant` → ``worker``；
* 真实 `configs/agents/*/agent.yaml` 的 `role` 声明与投影一致（防配置漂移）；
* 角色解析降级：缺失 / 非法 role 一律回落 ``worker``，不抛异常。

Note:
    本文件只断言 role 契约与投影，不触碰其它 `/agents` 字段与生命周期行为。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
import yaml

from src.agent.config import AgentConfig, AgentRole
from src.api.routes.agent import AgentSummary, _resolve_role_value, list_agents

# ===== 期望角色（与 configs/agents/*/agent.yaml 一致）=====

EXPECTED_ROLES: dict[str, str] = {
    "mis-copilot": "coordinator",
    "mis-rag": "worker",
    "mis-summary": "worker",
    "mis-extract": "worker",
    "crm-assistant": "worker",
}

_CONFIGS_DIR: Path = (
    Path(__file__).resolve().parents[3] / "configs" / "agents"
)


# ===== 测试替身 =====


def _instance(agent_id: str, role: Any) -> MagicMock:
    """构造一个 `/agents` 列表项所需的最小 agent 实例替身。

    Args:
        agent_id: Agent ID。
        role: 注入到 `config.role` 的取值（枚举 / 字符串 / None）。

    Returns:
        `MagicMock` 形态的 agent instance。
    """
    config = MagicMock()
    config.display_name = f"{agent_id} 显示名"
    config.runtime.type = "openharness"
    config.role = role

    instance = MagicMock()
    instance.id = agent_id
    instance.config = config
    instance.active_sessions = 0
    instance.lifecycle.current_state.value = "running"
    instance.lifecycle.is_active.return_value = True
    return instance


def _agent_manager(instances: list[MagicMock]) -> MagicMock:
    """构造返回给定实例列表的 AgentManager 替身。

    Args:
        instances: `list_agents()` 返回的实例列表。

    Returns:
        `MagicMock` 形态的 AgentManager。
    """
    manager = MagicMock()
    manager.list_agents.return_value = instances
    return manager


# ===== AgentSummary 契约 =====


def test_agent_summary_declares_role_field() -> None:
    """`AgentSummary` 必须声明 `role` 字段，且为可选（带默认值）。"""
    assert "role" in AgentSummary.model_fields
    field = AgentSummary.model_fields["role"]
    assert field.is_required() is False, "role 必须可选，避免破坏既有构造"
    assert field.default == AgentRole.WORKER.value


def test_agent_summary_legacy_fields_unchanged() -> None:
    """既有字段的必填性不得因新增 role 而改变（兼容红线）。"""
    fields = AgentSummary.model_fields
    for legacy in (
        "agent_id",
        "display_name",
        "state",
        "runtime_type",
        "active_sessions",
        "is_active",
    ):
        assert legacy in fields, f"既有字段缺失：{legacy}"
        assert fields[legacy].is_required() is True


def test_agent_summary_dump_contains_role() -> None:
    """`model_dump()` 输出必须携带 role 字符串。"""
    summary = AgentSummary(
        agent_id="mis-copilot",
        display_name="MIS 智能对话助手（Copilot）",
        state="running",
        runtime_type="openharness",
        active_sessions=0,
        is_active=True,
        role=AgentRole.COORDINATOR.value,
    )
    dumped: dict[str, Any] = summary.model_dump()
    assert dumped["role"] == "coordinator"
    assert dumped["agent_id"] == "mis-copilot"


# ===== list_agents 投影 =====


@pytest.mark.asyncio
async def test_list_agents_projects_role_for_all_agents() -> None:
    """`list_agents` 为每个实例填充 role：copilot=coordinator，其余=worker。"""
    instances = [
        _instance(
            agent_id,
            AgentRole.COORDINATOR if expected == "coordinator" else AgentRole.WORKER,
        )
        for agent_id, expected in EXPECTED_ROLES.items()
    ]

    response: dict[str, Any] = await list_agents(
        agent_manager=_agent_manager(instances),
        user={"user_id": "u001"},
    )

    summaries: list[dict[str, Any]] = response["data"]
    roles: dict[str, str] = {item["agent_id"]: item["role"] for item in summaries}
    assert roles == EXPECTED_ROLES


@pytest.mark.asyncio
async def test_list_agents_marks_mis_copilot_as_coordinator() -> None:
    """唯一 Coordinator（mis-copilot）必须被标记为 coordinator。"""
    response: dict[str, Any] = await list_agents(
        agent_manager=_agent_manager(
            [_instance("mis-copilot", AgentRole.COORDINATOR)]
        ),
        user={"user_id": "u001"},
    )
    assert response["data"][0]["role"] == "coordinator"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "agent_id", ["mis-rag", "mis-summary", "mis-extract", "crm-assistant"]
)
async def test_list_agents_marks_workers_as_worker(agent_id: str) -> None:
    """4 个 Worker 必须被标记为 worker（前端据此过滤掉）。"""
    response: dict[str, Any] = await list_agents(
        agent_manager=_agent_manager([_instance(agent_id, AgentRole.WORKER)]),
        user={"user_id": "u001"},
    )
    assert response["data"][0]["role"] == "worker"


@pytest.mark.asyncio
async def test_list_agents_keeps_legacy_fields() -> None:
    """新增 role 不得挤掉既有字段（前端 normalizeAgentList 依赖）。"""
    response: dict[str, Any] = await list_agents(
        agent_manager=_agent_manager(
            [_instance("mis-copilot", AgentRole.COORDINATOR)]
        ),
        user={"user_id": "u001"},
    )
    item: dict[str, Any] = response["data"][0]
    assert set(item) == {
        "agent_id",
        "display_name",
        "state",
        "runtime_type",
        "active_sessions",
        "is_active",
        "role",
    }


@pytest.mark.asyncio
async def test_list_agents_degrades_unknown_role_to_worker() -> None:
    """role 缺失 / 非法时回落 worker，接口不抛异常。"""
    response: dict[str, Any] = await list_agents(
        agent_manager=_agent_manager(
            [_instance("legacy-agent", None), _instance("weird-agent", "captain")]
        ),
        user={"user_id": "u001"},
    )
    assert [item["role"] for item in response["data"]] == ["worker", "worker"]


# ===== 角色解析助手 =====


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (AgentRole.COORDINATOR, "coordinator"),
        (AgentRole.WORKER, "worker"),
        ("coordinator", "coordinator"),
        (" Coordinator ", "coordinator"),
        ("worker", "worker"),
        ("unknown", "worker"),
        ("", "worker"),
        (None, "worker"),
        (123, "worker"),
    ],
)
def test_resolve_role_value_matrix(raw: Any, expected: str) -> None:
    """角色解析矩阵：枚举 / 字符串 / 非法值均得到合法 role 字符串。"""
    config = MagicMock()
    config.role = raw
    assert _resolve_role_value(config) == expected


# ===== 真实配置一致性（防漂移）=====


@pytest.mark.skipif(
    not _CONFIGS_DIR.exists(), reason="缺少 configs/agents 目录，跳过配置一致性校验"
)
@pytest.mark.parametrize(("agent_id", "expected"), sorted(EXPECTED_ROLES.items()))
def test_agent_yaml_declares_expected_role(agent_id: str, expected: str) -> None:
    """真实 agent.yaml 的 role 声明与前端过滤预期一致。"""
    yaml_path: Path = _CONFIGS_DIR / agent_id / "agent.yaml"
    if not yaml_path.exists():
        pytest.skip(f"缺少配置文件：{yaml_path}")

    data: dict[str, Any] = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    config: AgentConfig = AgentConfig.from_yaml_dict(data)
    assert config.role.value == expected
