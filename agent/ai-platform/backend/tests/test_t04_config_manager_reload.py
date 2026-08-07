"""T04 任务1：``ConfigManager.reload_agent`` 与 ``AgentManager.reload_config`` / ``has_instance``。

覆盖 design-impl.md §8 Q12（新会话即刻生效）的两条热更新链路：

* ``ConfigManager.reload_agent``
  - 成功：重新加载缓存、触发已注册的 on_config_change 回调（change_type="updated"）；
  - 失败（文件不存在/解析失败）：清理缓存、回调 change_type="deleted"；
  - 若已存在运行实例，则级联调用 ``AgentManager.reload_config`` 做热更新（旧会话沿用旧配置至完成）。
* ``AgentManager``
  - ``has_instance`` 正确反映实例登记表；
  - ``reload_config`` 对运行实例更新 config 并重新初始化运行时；对不存在的实例静默跳过（不抛异常）。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

import src.agent.config as agent_config_mod
import src.agent.manager as agent_manager_mod
import src.config_manager.manager as mgr_mod
from src.agent.config import AgentConfig
from src.agent.manager import AgentInstance, AgentManager
from src.config_manager.manager import ConfigManager
from src.utils.exceptions import AgentNotFoundError


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_runtime_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """AgentManager.__init__ 依赖运行时注册表；用例不需要真实运行时，替换为 stub。"""
    monkeypatch.setattr(
        "src.agent.manager.get_runtime_registry", lambda: MagicMock()
    )


def _make_config(agent_id: str = "a1", version: str = "1.0") -> AgentConfig:
    """构造最小可加载的 AgentConfig。"""
    return AgentConfig(
        agent_id=agent_id,
        name=agent_id,
        display_name=agent_id,
        version=version,
        routing=agent_config_mod.RoutingConfig(enabled=True),
    )


def _build_manager(
    monkeypatch: pytest.MonkeyPatch,
    *,
    config: AgentConfig | None = None,
    loader_raises: Exception | None = None,
) -> ConfigManager:
    """构造一个用 stub 替换全部子组件的 ConfigManager。"""
    settings = SimpleNamespace(
        CONFIG_MODE="file_system",
        CONFIG_BASE_PATH="/tmp/unused-configs",
        CONFIG_WATCH_ENABLED=False,
    )
    monkeypatch.setattr(mgr_mod, "get_settings", lambda: settings)

    loader = MagicMock()
    if loader_raises is not None:
        loader.load_agent_config = AsyncMock(side_effect=loader_raises)
    else:
        loader.load_agent_config = AsyncMock(return_value=config)
    monkeypatch.setattr(mgr_mod, "get_config_loader", lambda: loader)
    monkeypatch.setattr(mgr_mod, "get_config_validator", lambda: MagicMock())
    monkeypatch.setattr(mgr_mod, "get_config_watcher", lambda: MagicMock())
    monkeypatch.setattr(mgr_mod, "get_config_sync", lambda: MagicMock())
    return ConfigManager()


def _make_instance(agent_id: str = "a1") -> AgentInstance:
    """构造一个运行时为 stub 的 AgentInstance。"""
    config = _make_config(agent_id)
    runtime = MagicMock()
    runtime.initialize = AsyncMock()
    runtime.shutdown = AsyncMock()
    runtime.set_llm_gateway = MagicMock()
    return AgentInstance(config, runtime)


# ---------------------------------------------------------------------------
# ConfigManager.reload_agent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reload_agent_success_updates_cache_and_fires_callbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """成功路径：更新缓存，并以 updated 类型触发回调。"""
    config = _make_config("a1")
    mgr = _build_manager(monkeypatch, config=config)
    cb = MagicMock()
    mgr.on_config_change(cb)

    result = await mgr.reload_agent("a1")

    assert result is config
    assert mgr.get_config_cached("a1") is config
    cb.assert_called_once_with("a1", "updated", config)


@pytest.mark.asyncio
async def test_reload_agent_failure_treated_as_deleted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """加载失败（文件不存在/解析错误）按 deleted 处理：清缓存 + 通知回调。"""
    mgr = _build_manager(monkeypatch, loader_raises=FileNotFoundError("no such file"))
    mgr._configs["a1"] = _make_config("a1")  # 先假装已缓存
    cb = MagicMock()
    mgr.on_config_change(cb)

    result = await mgr.reload_agent("a1")

    assert result is None
    assert mgr.get_config_cached("a1") is None
    cb.assert_called_once_with("a1", "deleted", None)


@pytest.mark.asyncio
async def test_reload_agent_hot_reloads_running_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """存在运行实例时，reload_agent 级联调用 AgentManager.reload_config。"""
    config = _make_config("a1")
    mgr = _build_manager(monkeypatch, config=config)

    agent_mgr = MagicMock()
    agent_mgr.has_instance.return_value = True
    agent_mgr.reload_config = AsyncMock()
    with monkeypatch.context() as mp:
        mp.setattr("src.agent.manager.get_agent_manager", lambda: agent_mgr)
        await mgr.reload_agent("a1")

    agent_mgr.reload_config.assert_awaited_once_with("a1", config)


@pytest.mark.asyncio
async def test_reload_agent_no_hot_reload_when_instance_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """无运行实例时，不应触发 reload_config（仅刷新缓存 + 通知）。"""
    config = _make_config("a1")
    mgr = _build_manager(monkeypatch, config=config)

    agent_mgr = MagicMock()
    agent_mgr.has_instance.return_value = False
    agent_mgr.reload_config = AsyncMock()
    with monkeypatch.context() as mp:
        mp.setattr("src.agent.manager.get_agent_manager", lambda: agent_mgr)
        await mgr.reload_agent("a1")

    agent_mgr.reload_config.assert_not_awaited()


# ---------------------------------------------------------------------------
# AgentManager.reload_config / has_instance
# ---------------------------------------------------------------------------


def test_has_instance_reflects_registry() -> None:
    """has_instance 随实例登记表变化。"""
    mgr = AgentManager()
    assert mgr.has_instance("a1") is False
    mgr._instances["a1"] = _make_instance("a1")
    assert mgr.has_instance("a1") is True


@pytest.mark.asyncio
async def test_reload_config_updates_running_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """热重载运行实例：替换 config 并重新初始化运行时（新会话生效）。"""
    mgr = AgentManager()
    inst = _make_instance("a1")
    mgr._instances["a1"] = inst
    new_cfg = _make_config("a1", version="2.0")

    with monkeypatch.context() as mp:
        mp.setattr(agent_manager_mod, "wire_agent_runtime", AsyncMock())
        await mgr.reload_config("a1", new_cfg)

    assert inst.config is new_cfg
    inst.runtime.initialize.assert_awaited_once_with(new_cfg)


@pytest.mark.asyncio
async def test_reload_config_no_instance_is_noop() -> None:
    """对不存在的实例调用 reload_config 仅静默跳过，不抛异常。"""
    mgr = AgentManager()
    new_cfg = _make_config("ghost", version="9.9")
    await mgr.reload_config("ghost", new_cfg)  # 不应抛 AgentNotFoundError


def test_get_agent_raises_for_unknown() -> None:
    """未注册实例应抛出 AgentNotFoundError（路由层据此返回 404）。"""
    mgr = AgentManager()
    with pytest.raises(AgentNotFoundError):
        mgr.get_agent("nope")
