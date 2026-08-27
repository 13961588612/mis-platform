"""T05 硬约束一致性单测：scoped catalog 与 coordination 写回拒绝接入后台操作员专属 Agent。

覆盖四道闸中的运行时段：
- 闸③ ``build_scoped_catalog``：coordinator 的 ``agent__invoke`` 枚举恒定不含 ``mis-admin-helper``；
- 闸④ ``write_coordination``：把 ``mis-admin-helper`` 写进任一 coordinator 的 ``worker_ids`` 直接拒绝。

后端单一事实源 ``ADMIN_HELPER_AGENT_IDS`` 与前端 ``LOCKED_WORKERS`` 镜像常量不应漂移，
本文件断言逻辑而非具体 ID，避免未来增减时漏改。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.coordinator.catalog import (
    ADMIN_HELPER_AGENT_IDS,
    WorkerCatalog,
    WorkerSpec,
    build_scoped_catalog,
)
from src.coordinator.coordination_service import (
    AgentCoordination,
    CoordinationDelegation,
    write_coordination,
)
from src.utils.exceptions import ConfigValidationError


def _sample_spec(agent_id: str) -> WorkerSpec:
    return WorkerSpec(
        agent_id=agent_id,
        display_name=agent_id,
        when_to_use="",
        capabilities=[],
        input_contract=["user_question"],
        output_contract="text",
        safety_level="read_only",
        enabled=True,
    )


def test_admin_helper_ids_non_empty():
    """事实源不能空，否则四道闸全部形同虚设。"""
    assert ADMIN_HELPER_AGENT_IDS
    assert "mis-admin-helper" in ADMIN_HELPER_AGENT_IDS


def test_build_scoped_catalog_excludes_admin_helper():
    """闸③：scoped catalog 只含 coordinator 声明且非后台操作员专属的 worker。"""
    assert ADMIN_HELPER_AGENT_IDS
    helper_id = next(iter(ADMIN_HELPER_AGENT_IDS))

    global_catalog = WorkerCatalog(
        workers={
            "mis-user-helper": _sample_spec("mis-user-helper"),
            helper_id: _sample_spec(helper_id),
        },
        coordinators=["mis-copilot"],
        fallback=False,
    )
    coordination_yaml = {
        "role": "coordinator",
        "delegation": {
            "spawn_tools_enabled": True,
            "worker_ids": ["mis-user-helper", helper_id],
        },
    }

    with (
        patch(
            "src.coordinator.catalog.get_worker_catalog",
            return_value=global_catalog,
        ),
        patch(
            "src.coordinator.catalog._read_yaml",
            return_value=coordination_yaml,
        ),
    ):
        scoped = build_scoped_catalog("mis-copilot")

    assert "mis-user-helper" in scoped.workers
    assert helper_id not in scoped.workers
    # 即便 coordinator 误声明，后台操作员专属 Agent 也不会出现在可委派枚举里
    for wid in scoped.workers:
        assert wid not in ADMIN_HELPER_AGENT_IDS


def test_build_scoped_catalog_empty_when_non_coordinator():
    """非 coordinator / 无 delegation → 空 scoped 目录（fail-closed，绝不回落全局）。"""
    global_catalog = WorkerCatalog(
        workers={"mis-user-helper": _sample_spec("mis-user-helper")},
        coordinators=["mis-copilot"],
        fallback=False,
    )
    with (
        patch(
            "src.coordinator.catalog.get_worker_catalog",
            return_value=global_catalog,
        ),
        patch(
            "src.coordinator.catalog._read_yaml",
            return_value={"role": "worker"},
        ),
    ):
        scoped = build_scoped_catalog("mis-user-helper")

    assert scoped.workers == {}
    assert scoped.fallback is False


@pytest.mark.asyncio
async def test_write_coordination_rejects_admin_helper_in_worker_ids():
    """闸④：任一 coordinator 把后台操作员专属 Agent 纳入 worker_ids 直接拒绝。"""
    assert ADMIN_HELPER_AGENT_IDS
    helper_id = next(iter(ADMIN_HELPER_AGENT_IDS))

    req = AgentCoordination(
        agent_id="mis-copilot",
        role="coordinator",
        routing_enabled=True,
        delegation=CoordinationDelegation(worker_ids=[helper_id, "mis-user-helper"]),
    )
    manager = MagicMock()
    manager.get_config = AsyncMock(return_value=MagicMock())
    with (
        patch(
            "src.coordinator.coordination_service.get_config_manager",
            return_value=manager,
        ),
    ):
        with pytest.raises(ConfigValidationError) as exc:
            await write_coordination("mis-copilot", req)

    assert helper_id in str(exc.value)
    manager.get_config.assert_awaited_once()
