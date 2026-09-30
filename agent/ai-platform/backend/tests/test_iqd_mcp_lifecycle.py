"""IqdMcpLifecycleService + bootstrap 测试（方案 A 多连接，T3/T4/T5）。

覆盖：
- project_home_of 目录派生格式（{wren_projects_root}/{connId}）。
- 就绪门禁（REQ-P1-3）：target/mdl.json 缺失 → start_connection 拒绝（不启动进程）。
- 启动 happy path：mdl 就绪 + 凭证 env 注入 → 进程注册（RUNNING + 端口）。
- 停止：回收端口 + 打 7 天保留标记（.iqd-retained），endpoint 不可路由。
- 未知连接 status_connection 返回 stopped（不报错）。
- bootstrap.mcp_status_reporter 经 IqdConfigClient.report_mcp_status 回写。
- bootstrap.bulk_start_enabled_iqd_mcp 仅对 enabled 连接启动（best-effort）。
- bootstrap.shutdown_iqd_mcp 调用 stop_all。

mock 外部 mis-iqd HTTP 与 wren 进程，不依赖真实环境。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.wren_mcp_registry import WrenMcpProcessManager
from src.agent.mis_iqd.bootstrap import (
    bulk_start_enabled_iqd_mcp,
    mcp_status_reporter,
    shutdown_iqd_mcp,
)
from src.agent.mis_iqd.mcp_lifecycle import (
    IqdConfigCredentialResolver,
    IqdMcpLifecycleError,
    IqdMcpLifecycleService,
)


async def _mock_launcher(command: list[str], env: dict[str, str], cwd: str) -> Any:
    class _FakeProc:
        returncode: int | None = None
        pid = 9999

    return _FakeProc()


async def _async_mock_launcher(command: list[str], env: dict[str, str], cwd: str) -> Any:
    """异步伪启动器（替换注册表默认 launcher，避免真实 spawn wren 进程）。"""

    class _FakeProc:
        returncode: int | None = None
        pid = 9999

    return _FakeProc()


def _make_manager(tmp_path: Path) -> WrenMcpProcessManager:
    return WrenMcpProcessManager(
        host="127.0.0.1",
        port_range="18080-18083",
        projects_root=str(tmp_path / "w"),
        status_reporter=lambda *a: None,
    )


@pytest.mark.asyncio
async def test_project_home_of_format() -> None:
    """project 目录 = {wren_projects_root}/{connId}（派生格式与每连接一进程目录对齐）。"""
    home = IqdMcpLifecycleService.project_home_of(7)
    # 用 os.path.basename 兼容 Windows 路径分隔符（os.path.join 在 win 下会混用 \）
    assert os.path.basename(home) == "7"
    assert "wren-projects" in home


@pytest.mark.asyncio
async def test_start_connection_readiness_gate_missing_mdl(tmp_path: Path) -> None:
    """REQ-P1-3：target/mdl.json 缺失 → start_connection 拒绝（不启动进程、不注册端点）。"""
    home = str(tmp_path / "w" / "1")
    mgr = _make_manager(tmp_path)
    config_mock = MagicMock()
    config_mock.get_connection = AsyncMock(return_value={"id": 1, "enabled": True, "name": "c1"})

    with patch(
        "src.agent.mis_iqd.mcp_lifecycle.get_process_manager", return_value=mgr
    ), patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdConfigClient", return_value=config_mock
    ), patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdCli"
    ) as cli_cls, patch.object(
        IqdMcpLifecycleService,
        "project_home_of",
        staticmethod(lambda cid: home),
    ):
        cli_cls.return_value.ensure_project.return_value = home
        # 本用例校验「本地 Plan A」的就绪门禁：显式钉住 agent 不可用（否则 start 会委派远程 ensure）
        with patch(
            "src.agent.mis_iqd.mcp_lifecycle.WrenMcpAgentClient"
        ) as agent_cls:
            agent_cls.return_value.enabled = False
            svc = IqdMcpLifecycleService()
            with pytest.raises(IqdMcpLifecycleError):
                await svc.start_connection(1)

    # 未就绪：进程管理器不应注册任何端点
    assert mgr.get_endpoint("1") is None


@pytest.mark.asyncio
async def test_start_connection_happy_path(tmp_path: Path) -> None:
    """mdl 就绪 + 凭证解析 → 进程注册 RUNNING，返回端口。"""
    home = str(tmp_path / "w" / "1")
    os.makedirs(os.path.join(home, "target"), exist_ok=True)
    Path(os.path.join(home, "target", "mdl.json")).write_text("{}")

    mgr = _make_manager(tmp_path)
    config_mock = MagicMock()
    config_mock.get_connection = AsyncMock(return_value={"id": 1, "enabled": True, "name": "c1"})

    resolver = MagicMock()
    resolver.resolve_env = AsyncMock(return_value={"WREN_PG_PASSWORD": "x"})

    # 替换实例级默认 launcher（_default_launcher 是实例属性，非模块级），避免真实 spawn wren
    mgr._default_launcher = _async_mock_launcher

    with patch(
        "src.agent.mis_iqd.mcp_lifecycle.get_process_manager", return_value=mgr
    ), patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdConfigClient", return_value=config_mock
    ), patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdCli"
    ) as cli_cls, patch.object(
        IqdMcpLifecycleService,
        "project_home_of",
        staticmethod(lambda cid: home),
    ):
        cli_cls.return_value.ensure_project.return_value = home
        # 本地 Plan A happy path：钉住 agent 不可用，走本地子进程管理器
        with patch(
            "src.agent.mis_iqd.mcp_lifecycle.WrenMcpAgentClient"
        ) as agent_cls:
            agent_cls.return_value.enabled = False
            svc = IqdMcpLifecycleService(credential_resolver=resolver)
            result = await svc.start_connection(1)

    assert result["mcp_status"] == "running"
    assert result["port"] == 18080
    ep = mgr.get_endpoint("1")
    assert ep is not None and ep.port == 18080
    resolver.resolve_env.assert_awaited_once()


@pytest.mark.asyncio
async def test_stop_connection_marks_retained(tmp_path: Path) -> None:
    """停止后端口回收 + endpoint 不可路由 + 打 .iqd-retained 保留标记。"""
    home = str(tmp_path / "w" / "1")
    mgr = _make_manager(tmp_path)
    await mgr.start("1", home, launcher=_mock_launcher)

    with patch(
        "src.agent.mis_iqd.mcp_lifecycle.get_process_manager", return_value=mgr
    ), patch.object(
        IqdMcpLifecycleService,
        "project_home_of",
        staticmethod(lambda cid: home),
    ), patch(
        # 本地 Plan A 用例：钉住 agent 不可用，否则 stop 会委派远程
        "src.agent.mis_iqd.mcp_lifecycle.WrenMcpAgentClient"
    ) as agent_cls:
        agent_cls.return_value.enabled = False
        svc = IqdMcpLifecycleService()
        result = await svc.stop_connection(1, retain_dir=True)

    assert result["mcp_status"] == "stopped"
    assert mgr.get_endpoint("1") is None
    assert (Path(home) / ".iqd-retained").exists()


@pytest.mark.asyncio
async def test_status_connection_unknown_returns_stopped() -> None:
    """未知连接 status_connection 返回 stopped（不抛错、不静默 RUNNING）。"""
    svc = IqdMcpLifecycleService()
    with patch("src.agent.mis_iqd.mcp_lifecycle.WrenMcpAgentClient") as agent_cls:
        agent_cls.return_value.enabled = False
        status = await svc.status_connection(999)
    assert status["mcp_status"] == "stopped"
    assert status["port"] is None


@pytest.mark.asyncio
async def test_remote_ensure_continues_when_credential_resolve_fails() -> None:
    """远程 ensure：vault 凭证解析失败时降级空 env，仍完成 agent ensure + 注册。"""
    home = "/var/lib/mis-iqd/wren-projects/900001"
    config_mock = MagicMock()
    config_mock.get_connection = AsyncMock(
        return_value={
            "id": 900001,
            "enabled": True,
            "name": "seed",
            "auth_type": "bearer",
            "secret_ref": "starrocks",
        }
    )
    resolver = MagicMock()
    resolver.resolve_env = AsyncMock(
        side_effect=IqdMcpLifecycleError("凭证不可得：credential_mappings missing")
    )
    ensure_result = MagicMock(
        wren_host="10.254.16.27",
        control_endpoint="http://10.254.16.27:9100",
        mcp_endpoint="http://10.254.16.27:9101",
        agent_handle="h1",
        status="running",
        project_home=home,
    )
    agent = MagicMock()
    agent.enabled = True
    agent.ensure = AsyncMock(return_value=ensure_result)
    registry = MagicMock()

    with patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdConfigClient", return_value=config_mock
    ), patch(
        "src.agent.mis_iqd.mcp_lifecycle.WrenMcpAgentClient", return_value=agent
    ), patch(
        "src.agent.mis_iqd.mcp_lifecycle.get_agent_registry", return_value=registry
    ), patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdCli"
    ) as cli_cls, patch.object(
        IqdMcpLifecycleService,
        "project_home_of",
        staticmethod(lambda cid: home),
    ), patch.object(
        IqdMcpLifecycleService, "_report_deployment", new=AsyncMock()
    ):
        cli_cls.return_value.ensure_project.return_value = home
        svc = IqdMcpLifecycleService(credential_resolver=resolver)
        result = await svc.ensure_connection(900001)

    assert result["mcp_status"] == "running"
    assert result["remote"] is True
    agent.ensure.assert_awaited_once()
    assert agent.ensure.call_args.kwargs.get("credential") in (None, {})
    registry.register.assert_called_once()


@pytest.mark.asyncio
async def test_mcp_status_reporter_calls_config_client() -> None:
    """bootstrap.mcp_status_reporter 经 IqdConfigClient.report_mcp_status 回写。"""
    config_mock = MagicMock()
    config_mock.report_mcp_status = AsyncMock()
    with patch("src.adapters.iqd_config_client.IqdConfigClient", return_value=config_mock):
        await mcp_status_reporter(1, "running", 18080)
    config_mock.report_mcp_status.assert_awaited_once_with(1, "running", 18080)


@pytest.mark.asyncio
async def test_bulk_start_only_enabled_connections() -> None:
    """bulk_start 仅对 enabled 连接调用 start_connection（best-effort，单连失败不阻断）。

    bulk_start 自身不过滤 enabled，而是在 start_connection 内部对未启用连接抛错后
    best-effort 跳过；因此 mock 须对未启用连接（id=2）抛 IqdMcpLifecycleError 以模拟真实行为。
    """
    config_mock = MagicMock()
    config_mock.get_configs = AsyncMock(
        return_value=[
            {"id": 1, "enabled": True},
            {"id": 2, "enabled": False},
            {"id": 3, "enabled": True},
        ]
    )

    async def _fake_start(connection_id: int, *, wait: bool = True) -> dict[str, Any]:
        if connection_id == 2:
            raise IqdMcpLifecycleError(f"连接 {connection_id} 未启用，拒绝启动 MCP")
        return {"connection_id": connection_id, "mcp_status": "running"}

    with patch("src.adapters.iqd_config_client.IqdConfigClient", return_value=config_mock), patch(
        "src.agent.mis_iqd.bootstrap.WrenMcpAgentClient"
    ) as agent_cls, patch.object(
        IqdMcpLifecycleService,
        "start_connection",
        new=AsyncMock(side_effect=_fake_start),
    ):
        agent_cls.return_value.enabled = False
        started = await bulk_start_enabled_iqd_mcp()

    assert started == 2  # 仅连接 1、3 启动，连接 2 未启用被 best-effort 跳过


@pytest.mark.asyncio
async def test_shutdown_calls_stop_all() -> None:
    """shutdown_iqd_mcp 调用进程管理器 stop_all 回收全部端口。"""
    mgr_mock = MagicMock()
    mgr_mock.stop_all = AsyncMock()
    with patch("src.agent.mis_iqd.bootstrap.get_process_manager", return_value=mgr_mock):
        await shutdown_iqd_mcp(stop_event=None, task=None)
    mgr_mock.stop_all.assert_awaited_once()
