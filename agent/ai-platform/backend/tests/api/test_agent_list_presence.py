"""`list_agents` 全量配置 + 内存 / 租约标记。"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.agent.config import AgentRole
from src.api.routes.agent import list_agents


def _config(agent_id: str, role: Any = AgentRole.WORKER) -> MagicMock:
    config = MagicMock()
    config.agent_id = agent_id
    config.display_name = f"{agent_id} 显示名"
    config.runtime.type = "openharness"
    config.role = role
    return config


def _instance(agent_id: str, role: Any = AgentRole.WORKER) -> MagicMock:
    instance = MagicMock()
    instance.id = agent_id
    instance.config = _config(agent_id, role)
    instance.active_sessions = 2
    instance.lifecycle.current_state.value = "running"
    instance.lifecycle.is_active.return_value = True
    return instance


@pytest.mark.asyncio
async def test_list_agents_includes_configs_not_in_process() -> None:
    """行集合以 configs 为准：无实例的配置仍出现，且 in_process=false。"""
    configs = [
        _config("crm-assistant"),
        _config("mis-copilot", AgentRole.COORDINATOR),
        _config("mis-rag"),
    ]
    # 本机内存仅有 mis-copilot
    agent_manager = MagicMock()
    agent_manager.list_agents.return_value = [
        _instance("mis-copilot", AgentRole.COORDINATOR)
    ]
    agent_manager._core_id = "core-a"
    ownership = MagicMock()
    ownership.current_owner = AsyncMock(
        side_effect=lambda aid: "core-a" if aid == "mis-copilot" else "core-b"
    )
    agent_manager._core_ownership = ownership

    config_manager = MagicMock()
    config_manager.list_configs.return_value = configs

    response: dict[str, Any] = await list_agents(
        agent_manager=agent_manager,
        config_manager=config_manager,
        user={"user_id": "u001"},
    )
    rows = {item["agent_id"]: item for item in response["data"]}
    assert set(rows) == {"crm-assistant", "mis-copilot", "mis-rag"}

    assert rows["mis-copilot"]["in_process"] is True
    assert rows["mis-copilot"]["state"] == "running"
    assert rows["mis-copilot"]["active_sessions"] == 2
    assert rows["mis-copilot"]["lease_owner"] == "core-a"
    assert rows["mis-copilot"]["lease_held_locally"] is True
    assert rows["mis-copilot"]["core_id"] == "core-a"

    assert rows["mis-rag"]["in_process"] is False
    assert rows["mis-rag"]["state"] == "stopped"
    assert rows["mis-rag"]["active_sessions"] == 0
    assert rows["mis-rag"]["lease_owner"] == "core-b"
    assert rows["mis-rag"]["lease_held_locally"] is False

    assert rows["crm-assistant"]["lease_owner"] == "core-b"
    assert rows["crm-assistant"]["lease_held_locally"] is False


@pytest.mark.asyncio
async def test_list_agents_no_ownership_marks_null_lease() -> None:
    """未注入 CoreOwnership 时 lease_owner/core_id 为 null，lease_held_locally=false。"""
    configs = [_config("mis-rag")]
    agent_manager = MagicMock()
    agent_manager.list_agents.return_value = [_instance("mis-rag")]
    agent_manager._core_id = ""
    agent_manager._core_ownership = None

    config_manager = MagicMock()
    config_manager.list_configs.return_value = configs

    response: dict[str, Any] = await list_agents(
        agent_manager=agent_manager,
        config_manager=config_manager,
        user={"user_id": "u001"},
    )
    item = response["data"][0]
    assert item["in_process"] is True
    assert item["lease_owner"] is None
    assert item["lease_held_locally"] is False
    assert item["core_id"] is None


@pytest.mark.asyncio
async def test_list_agents_sorted_by_agent_id() -> None:
    configs = [_config("z-agent"), _config("a-agent")]
    agent_manager = MagicMock()
    agent_manager.list_agents.return_value = []
    agent_manager._core_id = ""
    agent_manager._core_ownership = None
    config_manager = MagicMock()
    config_manager.list_configs.return_value = configs

    response: dict[str, Any] = await list_agents(
        agent_manager=agent_manager,
        config_manager=config_manager,
        user={"user_id": "u001"},
    )
    assert [r["agent_id"] for r in response["data"]] == ["a-agent", "z-agent"]
