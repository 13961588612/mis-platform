"""方案 A 多连接 MCP 边界 + 接线补充测试（T2/T3/T4 边界，单文件、mock 隔离、快速）。

聚焦本轮增量设计的边界与跨模块接线，避免长跑：
- 端口段边界（含端点、用尽报错、回收复用）              REQ-P0-2
- 重启复用 launcher 记录 + 稳定端口（崩溃恢复路径）       REQ-P0-1
- **显式重启 RUNNING 连接须真正重新拉起**（用户重启按钮路径，疑似源码缺陷探针）
- orchestrator._get_mcp_client 按 connection_id 路由（mock registry），未就绪降级 mock   REQ-P0-3
- service 自愈三按钮 per-connection：connId → project_dir 透传至 cli 各原子   §6 / REQ-P0-4
- IqdMcpLifecycleService 凭证链（secretRef→vault→env 注入，不落盘）mock 验证  REQ-P0-5
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from src.adapters.iqd_mcp_client import IqdMcpClient, IqdMcpClientError
from src.adapters.iqd_cli import IqdCli
from src.adapters.wren_mcp_registry import (
    McpStatus,
    PortExhaustedError,
    WrenMcpProcessManager,
    get_process_manager,
    reset_process_manager,
)
from src.agent.mis_iqd.orchestrator import AskOrchestrator
from src.agent.mis_iqd.service import IqdAskService
from src.agent.mis_iqd.mcp_lifecycle import (
    CredentialResolver,
    IqdMcpLifecycleError,
    IqdMcpLifecycleService,
)


class _FakeProc:
    """极简伪子进程（returncode=None 视作存活）。"""

    def __init__(self, pid: int = 9999) -> None:
        self.returncode: int | None = None
        self.pid = pid


async def _mock_launcher(command: list[str], env: dict[str, str], cwd: str) -> _FakeProc:
    return _FakeProc()


@pytest.fixture
def manager(tmp_path: Path) -> WrenMcpProcessManager:
    reset_process_manager()
    return WrenMcpProcessManager(
        host="127.0.0.1",
        port_range="18080-18083",
        projects_root=str(tmp_path / "wren-projects"),
        health_interval_seconds=1,
        status_reporter=None,
    )


# ================================================================ 端口段边界（REQ-P0-2）


@pytest.mark.asyncio
async def test_port_range_boundary_inclusive(manager: WrenMcpProcessManager) -> None:
    """端口段 18080-18083 含端点共 4 个；末位 = 最大端口；用尽后报错。"""
    ports = [await manager.allocate_port(f"c{i}") for i in range(4)]
    assert ports == [18080, 18081, 18082, 18083], "端口段分配应从最小到最大连续"
    # 超出段上限必须显式报错，而非越界绑定
    with pytest.raises(PortExhaustedError):
        await manager.allocate_port("overflow")
    # 回收最大边界端口后可复用
    await manager.release_port(18083)
    assert await manager.allocate_port("reuse") == 18083


# ================================================================ 重启复用 launcher + 稳定端口（REQ-P0-1）


@pytest.mark.asyncio
async def test_restart_reuses_launcher_and_port_after_crash(
    manager: WrenMcpProcessManager, tmp_path: Path
) -> None:
    """崩溃恢复（健康检查置 CRASHED 后 restart）：复用原 launcher 记录与原端口。"""
    launcher_calls: list[Any] = []

    async def counting_launcher(command, env, cwd):
        launcher_calls.append(1)
        return _FakeProc()

    ep_before = await manager.start("1", str(tmp_path / "1"), launcher=counting_launcher)
    assert len(launcher_calls) == 1
    assert ep_before is not None

    # 模拟健康循环：先置 CRASHED，再 restart（与 _health_iteration 同路径）
    async with manager._lock:
        manager._entries["1"].proc.returncode = 1
        manager._entries["1"].status = McpStatus.CRASHED

    await manager.restart("1")

    assert len(launcher_calls) == 2, "重启应复用 entry.launcher 重新拉起一次"
    ep_after = manager.get_endpoint("1")
    assert ep_after is not None and ep_before is not None
    assert ep_after.port == ep_before.port, "重启须复用稳定端口"
    assert manager.is_running("1")


# ================================================================ 显式重启 RUNNING 连接（缺陷探针）


@pytest.mark.asyncio
async def test_restart_running_connection_relaunches(
    manager: WrenMcpProcessManager, tmp_path: Path
) -> None:
    """显式重启一个 RUNNING 连接（用户点击重启按钮路径）必须真正重新拉起进程。

    预期：restart 应先终止旧进程并重新拉起（launcher 再次被调用、proc 重新存活）。
    若 start 因 entry 仍处 RUNNING 而短路返回旧 entry，则 launcher 不会再次被调用——
    这是方案 A 多连接下「重启按钮失效、连接显示 RUNNING 实为死进程」的源码缺陷探针。
    """
    launcher_calls: list[Any] = []

    async def counting_launcher(command, env, cwd):
        launcher_calls.append(1)
        return _FakeProc()

    await manager.start("1", str(tmp_path / "1"), launcher=counting_launcher)
    assert len(launcher_calls) == 1

    # 显式重启 RUNNING 连接
    await manager.restart("1")

    assert len(launcher_calls) == 2, (
        "restart 未重新拉起 RUNNING 连接进程（launcher 仅调用 1 次）；"
        "推测源码：start 在 entry.status==RUNNING 时短路返回旧 entry，导致显式重启失效"
    )
    # 重启后进程应重新存活
    async with manager._lock:
        proc = manager._entries["1"].proc
    assert proc is not None and proc.returncode is None


# ================================================================ orchestrator 按 connId 路由（REQ-P0-3）


@pytest.mark.asyncio
async def test_orchestrator_get_mcp_client_routes_by_conn(tmp_path: Path) -> None:
    """orchestrator._get_mcp_client 按 connection_id 取端点（mock registry）；未就绪降级 mock。"""
    reset_process_manager()
    mgr = WrenMcpProcessManager(
        host="127.0.0.1",
        port_range="18080-18083",
        projects_root=str(tmp_path / "wren-projects"),
        status_reporter=None,
    )
    ep = await mgr.start("42", str(tmp_path / "42"), launcher=_mock_launcher)

    # 就绪连接：返回的 client 绑定该连接专属端点
    orch = AskOrchestrator()  # mcp_client=None → 触发按 connection_id 构造
    with patch("src.adapters.iqd_mcp_client.get_process_manager", return_value=mgr):
        client = orch._get_mcp_client("42")
    assert isinstance(client, IqdMcpClient)
    assert client._host == ep.host and client._port == ep.port

    # 未就绪连接：不静默落默认端点，降级 mock（REQ-P0-3 / REQ-P0-1）
    orch2 = AskOrchestrator()
    with patch("src.adapters.iqd_mcp_client.get_process_manager", return_value=mgr):
        client2 = orch2._get_mcp_client("999")
    assert client2._mock is True, "未就绪连接须降级 mock，不得落到默认 8080 端点"


# ================================================================ service 自愈 per-connection project_dir 透传（§6）


@pytest.mark.asyncio
async def test_service_selfheal_passes_connid_project_dir(tmp_path: Path) -> None:
    """自愈三按钮 per-connection：connId=7 时 cli 各原子须收到 project_dir=/proj/7。"""
    # 让 project_home_of 按 connId 派生可断言的目录
    with patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdMcpLifecycleService.project_home_of",
        staticmethod(lambda cid: f"/proj/{cid}"),
    ):
        service = IqdAskService()
        with patch("src.adapters.iqd_cli.IqdCli") as MockCli, patch(
            "src.adapters.iqd_config_client.IqdConfigClient"
        ) as MockClient:
            cli = MockCli.return_value
            cli.context_build = AsyncMock(return_value={"stdout": '{"mdl_hash":"h"}'})
            cli.memory_reset = AsyncMock(return_value={"exit_code": 0})
            cli.memory_index = AsyncMock(return_value={"exit_code": 0})
            # 方案 A：知识下发（样本 memory store / 规则 knowledge/rules/*.md）
            cli.memory_store = AsyncMock(return_value={"exit_code": 0})
            cli.write_project_files = AsyncMock(return_value={"exit_code": 0})
            cli.list_project_files = AsyncMock(return_value=[])
            cli.delete_project_files = AsyncMock(return_value={"exit_code": 0})
            cli.context_validate = AsyncMock(return_value={"ok": True, "summary": "", "raw": "ok"})
            client = MockClient.return_value
            client.get_sql_pairs = AsyncMock(return_value=[])
            client.get_knowledge = AsyncMock(return_value=[])
            client.backfill_enhancement_sync = AsyncMock(return_value={"synced_count": 0})
            client.report_sync_job = AsyncMock(return_value={"id": 1})

            await service.trigger_force_rebuild(connection_id=7, wait=True)
            await service.trigger_reindex(connection_id=7, wait=True)
            await service.trigger_validate(connection_id=7, wait=True)

        assert cli.context_build.call_args.kwargs.get("project_dir") == "/proj/7"
        assert cli.memory_reset.call_args.kwargs.get("project_dir") == "/proj/7"
        assert cli.memory_index.call_args.kwargs.get("project_dir") == "/proj/7"
        assert cli.context_validate.call_args.kwargs.get("project_dir") == "/proj/7"


# ================================================================ 凭证链注入（REQ-P0-5，mock）


@pytest.mark.asyncio
async def test_lifecycle_injects_credential_env(tmp_path: Path) -> None:
    """凭证链（secretRef→vault→env）解析结果须注入 start 的 env，且不持久化到磁盘。

    以可注入 CredentialResolver 返回明文 env（代表 vault 解密产物），验证
    IqdMcpLifecycleService.start_connection 将其透传进进程管理器 start 的 env 参数，
    且进程管理器不把凭证明文写入本地文件（仅子进程环境变量）。
    """
    proj = tmp_path / "1"
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "target").mkdir(parents=True, exist_ok=True)
    (proj / "target" / "mdl.json").write_text("{}")  # 就绪门禁：mdl 已编译

    captured: dict[str, Any] = {}

    class SpyManager:
        async def start(self, conn_id, project_home, *, env=None, name="", launcher=None, port=None):
            captured["env"] = env
            captured["project_home"] = project_home
            return type("EP", (), {"host": "127.0.0.1", "port": 18080})()

        async def stop(self, conn_id, *, retain_dir=True):
            pass

        def get_endpoint(self, conn_id):
            return None

        async def restart(self, conn_id, *, env=None, launcher=None):
            return None

    class StubResolver(CredentialResolver):
        async def resolve_env(self, connection_id, conn):
            return {"WREN_PG_PASSWORD": "s3cr3t", "WREN_PG_HOST": "db.local"}

    with patch(
        "src.agent.mis_iqd.mcp_lifecycle.get_process_manager", return_value=SpyManager()
    ), patch("src.agent.mis_iqd.mcp_lifecycle.IqdConfigClient") as MockClient, patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdCli"
    ) as MockCli, patch(
        "src.agent.mis_iqd.mcp_lifecycle.IqdMcpLifecycleService.project_home_of",
        staticmethod(lambda cid: str(proj)),
    ), patch(
        # 本地 Plan A 用例：钉住 agent 不可用，走本地子进程管理器
        "src.agent.mis_iqd.mcp_lifecycle.WrenMcpAgentClient"
    ) as agent_cls:
        agent_cls.return_value.enabled = False
        MockClient.return_value.get_connection = AsyncMock(
            return_value={"id": 1, "enabled": True, "name": "x"}
        )
        MockCli.return_value.ensure_project = lambda *a, **k: None  # 不落盘脚手架

        svc = IqdMcpLifecycleService(credential_resolver=StubResolver())
        result = await svc.start_connection(1)

    assert captured["env"] == {"WREN_PG_PASSWORD": "s3cr3t", "WREN_PG_HOST": "db.local"}
    assert result["mcp_status"] == McpStatus.RUNNING
    assert str(proj) == captured["project_home"]
