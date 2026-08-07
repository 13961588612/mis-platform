"""T04 任务5：``coordinator/coordination_service.py`` 读写 + catalog 写回 + 级联清理。

覆盖 spec.md §3.8 的四条校验与持久化映射（impl-plan §10.3 约定 12）：

* ``read_coordination``：worker 从 metadata 推导 catalog；coordinator 返回 delegation；
* ``write_coordination``：
  - coordinator 必须 spawn_tools_enabled；worker_ids 不得含自身（校验1）；
  - worker 强制剥离 delegation，catalog 为必填结构（校验2）；
  - 落盘 coordination.yaml / agent.yaml(role,routing.enabled) / metadata.yaml(catalog)；
  - **禁用 worker 须从所有 coordinator 的 worker_ids 级联摘除（校验2 友好实现）**；
* 触发 ``refresh_worker_catalog`` 与 ``ConfigManager.reload_agent`` 热更新链路。
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import yaml

import src.config as src_config
import src.config_manager.file_service as fs
import src.coordinator.coordination_service as coord_mod
from src.coordinator.coordination_service import (
    CoordinationCatalog,
    CoordinationDelegation,
    read_coordination,
    write_coordination,
)
from src.utils.exceptions import AgentNotFoundError, ConfigValidationError


# ---------------------------------------------------------------------------
# fake 配置对象（模拟 AgentConfig 的 role / routing / metadata 切面）
# ---------------------------------------------------------------------------


class _FakeRouting:
    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled


class _FakeMeta:
    enabled = True
    when_to_use = "do the thing"
    capabilities = ["c1"]
    input_contract = ["u"]
    output_contract = "text"
    safety_level = "read_only"


class _FakeConfig:
    def __init__(self, agent_id: str = "w1", role: str = "worker") -> None:
        self.agent_id = agent_id
        self.role = role  # 字符串形式，对齐 _role_value 归一化
        self.routing = _FakeRouting(enabled=True)
        self.metadata = _FakeMeta()


def _write_agent_dir(base: Path, agent_id: str, **files: str) -> None:
    d = base / "agents" / agent_id
    d.mkdir(parents=True, exist_ok=True)
    for rel, content in files.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")


@pytest.fixture
def make_coord_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """返回工厂：按给定 AgentConfig 构建隔离的 coordination 测试环境。"""

    def _make(config_obj: Any) -> Path:
        base = tmp_path / "configs"
        (base / "agents").mkdir(parents=True)
        settings = SimpleNamespace(
            CONFIG_MODE="file_system",
            CONFIG_BASE_PATH=str(base),
            CONFIG_WATCH_ENABLED=False,
        )
        monkeypatch.setattr(fs, "get_settings", lambda: settings)
        monkeypatch.setattr(src_config, "get_settings", lambda: settings, raising=False)
        monkeypatch.setattr(coord_mod, "get_settings", lambda: settings, raising=False)

        fake_cm = MagicMock()
        fake_cm.get_config = AsyncMock(return_value=config_obj)
        fake_cm.reload_agent = AsyncMock(return_value=None)
        monkeypatch.setattr(coord_mod, "get_config_manager", lambda: fake_cm)
        # 避免真实 catalog 重建副作用
        monkeypatch.setattr(coord_mod, "refresh_worker_catalog", lambda: None)
        return base

    return _make


# ===========================================================================
# 读取
# ===========================================================================


@pytest.mark.asyncio
async def test_read_coordination_worker_from_metadata(make_coord_env) -> None:
    base = make_coord_env(_FakeConfig(role="worker"))

    saved = await read_coordination("w1")

    assert saved.role == "worker"
    assert saved.delegation is None
    assert saved.catalog is not None
    assert saved.catalog.when_to_use == "do the thing"


@pytest.mark.asyncio
async def test_read_coordination_coordinator(make_coord_env) -> None:
    base = make_coord_env(_FakeConfig(role="coordinator"))

    saved = await read_coordination("w1")

    assert saved.role == "coordinator"
    assert saved.delegation is not None
    assert saved.catalog is None


@pytest.mark.asyncio
async def test_read_coordination_unknown_agent_raises(make_coord_env) -> None:
    base = make_coord_env(_FakeConfig(role="worker"))
    cm = MagicMock()
    cm.get_config = MagicMock(side_effect=KeyError("w9"))
    # 复写当前 fixture 已注入的 manager：直接调用会 KeyError -> AgentNotFoundError
    import src.coordinator.coordination_service as _m

    saved_cm = _m.get_config_manager()
    try:
        _m.get_config_manager = lambda: cm  # type: ignore[assignment]
        with pytest.raises(AgentNotFoundError):
            await read_coordination("w9")
    finally:
        _m.get_config_manager = saved_cm  # type: ignore[assignment]


# ===========================================================================
# 写入：coordinator
# ===========================================================================


@pytest.mark.asyncio
async def test_write_coordination_coordinator_writes_files(make_coord_env) -> None:
    base = make_coord_env(_FakeConfig(role="coordinator"))
    req = coord_mod.AgentCoordination(
        agent_id="w1",
        role="coordinator",
        routing_enabled=True,
        delegation=CoordinationDelegation(worker_ids=[]),
    )

    saved, affected = await write_coordination("w1", req)

    assert saved.role == "coordinator"
    agent_yaml = yaml.safe_load((base / "agents" / "w1" / "agent.yaml").read_text(encoding="utf-8"))
    assert agent_yaml["agent"]["role"] == "coordinator"
    coord_yaml = yaml.safe_load((base / "agents" / "w1" / "coordination.yaml").read_text(encoding="utf-8"))
    assert coord_yaml["role"] == "coordinator"
    assert "catalog" not in coord_yaml  # coordinator 不应写 catalog 段
    assert "w1" in affected


@pytest.mark.asyncio
async def test_write_coordination_coordinator_self_in_workers_rejected(
    make_coord_env,
) -> None:
    base = make_coord_env(_FakeConfig(role="coordinator"))
    req = coord_mod.AgentCoordination(
        agent_id="w1",
        role="coordinator",
        delegation=CoordinationDelegation(worker_ids=["w1"]),
    )

    with pytest.raises(ConfigValidationError):
        await write_coordination("w1", req)


# ===========================================================================
# 写入：worker
# ===========================================================================


@pytest.mark.asyncio
async def test_write_coordination_worker_writes_catalog(make_coord_env) -> None:
    base = make_coord_env(_FakeConfig(role="worker"))
    req = coord_mod.AgentCoordination(
        agent_id="w1",
        role="worker",
        routing_enabled=False,
        catalog=CoordinationCatalog(when_to_use="do x", capabilities=["c1"]),
    )

    saved, _ = await write_coordination("w1", req)

    assert saved.role == "worker"
    assert saved.catalog.when_to_use == "do x"
    meta = yaml.safe_load((base / "agents" / "w1" / "metadata.yaml").read_text(encoding="utf-8"))
    assert meta["metadata"]["when_to_use"] == "do x"
    assert meta["metadata"]["enabled"] is True


# ===========================================================================
# 级联清理（禁用 worker 须从 coordinator 白名单摘除）
# ===========================================================================


@pytest.mark.asyncio
async def test_write_coordination_worker_disabled_cascades(make_coord_env) -> None:
    """禁用 w1 时，所有 coordinator 的 worker_ids 必须剔除 w1（校验2 级联清理）。"""
    base = make_coord_env(_FakeConfig(role="worker"))
    _write_agent_dir(
        base,
        "coord1",
        **{"coordination.yaml": "role: coordinator\ndelegation:\n  worker_ids: [w1]\n"},
    )
    req = coord_mod.AgentCoordination(
        agent_id="w1",
        role="worker",
        routing_enabled=True,
        catalog=CoordinationCatalog(enabled=False),
    )

    saved, affected = await write_coordination("w1", req)

    assert "coord1" in affected
    coord_data = yaml.safe_load(
        (base / "agents" / "coord1" / "coordination.yaml").read_text(encoding="utf-8")
    )
    assert "w1" not in coord_data["delegation"]["worker_ids"]
