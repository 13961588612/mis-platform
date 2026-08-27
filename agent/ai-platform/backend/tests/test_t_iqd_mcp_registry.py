"""方案 A 多连接 WrenAI MCP 进程管理器 + 连接级路由测试（T2/T3）。

覆盖：
- 端口分配 / 回收（REQ-P0-2）
- 启停 + endpoint 查询（RUNNING 可路由 / STOPPED/CRASHED 不可路由，REQ-P0-3）
- 后台健康循环崩溃自动重启 + status_reporter 回写（REQ-P0-1 / REQ-P1-2）
- project 目录 7 天保留清理（设计 §3.2）
- IqdMcpClient.for_connection 按 connId 路由（端点缺失显式抛错，不静默落默认端口）
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import pytest

from src.adapters.wren_mcp_registry import (
    McpStatus,
    PortExhaustedError,
    WrenMcpProcessManager,
    _parse_port_range,
    get_process_manager,
    reset_process_manager,
)
from src.adapters.iqd_mcp_client import IqdMcpClient, IqdMcpClientError


class _FakeProc:
    """极简伪子进程（returncode=None 视作存活）。"""

    def __init__(self, pid: int = 9999) -> None:
        self.returncode: int | None = None
        self.pid = pid


@pytest.fixture
def tmp_projects_root(tmp_path: Path) -> Path:
    root = tmp_path / "wren-projects"
    root.mkdir(parents=True, exist_ok=True)
    return root


@pytest.fixture
def manager(tmp_projects_root: Path) -> WrenMcpProcessManager:
    """每测试一个干净的进程管理器（重置单例，避免跨测试污染）。"""
    reset_process_manager()
    reported: list[tuple[int, str, int | None]] = []

    def reporter(conn_id: int, status: str, port: int | None) -> None:
        reported.append((conn_id, status, port))

    mgr = WrenMcpProcessManager(
        host="127.0.0.1",
        port_range="18080-18083",
        projects_root=str(tmp_projects_root),
        health_interval_seconds=1,
        status_reporter=reporter,
    )
    mgr._test_reported = reported  # type: ignore[attr-defined]
    return mgr


async def _mock_launcher(command: list[str], env: dict[str, str], cwd: str) -> _FakeProc:
    return _FakeProc()


# ================================================================ 端口分配 / 回收


@pytest.mark.asyncio
async def test_port_allocate_and_recycle(manager: WrenMcpProcessManager) -> None:
    """分配端口 → 停止后回收 → 可再次分配。"""
    p1 = await manager.allocate_port("1")
    assert p1 == 18080
    assert not manager.is_port_free(p1)

    await manager.release_port(p1)
    assert manager.is_port_free(p1)
    # 回收后同一端口可重新分配
    p2 = await manager.allocate_port("2")
    assert p2 == 18080


@pytest.mark.asyncio
async def test_port_exhausted_raises(manager: WrenMcpProcessManager) -> None:
    """端口段用尽显式报错（不越界）。"""
    for _ in range(4):  # 18080-18083 共 4 个
        await manager.allocate_port("x")
    with pytest.raises(PortExhaustedError):
        await manager.allocate_port("overflow")


# ================================================================ 启停 + 路由


@pytest.mark.asyncio
async def test_start_then_endpoint_routable(
    manager: WrenMcpProcessManager, tmp_projects_root: Path
) -> None:
    """启动后 endpoint 可路由；停止后不可路由（REQ-P0-3）。"""
    ep = await manager.start("1", str(tmp_projects_root / "1"), launcher=_mock_launcher)
    assert ep.port == 18080
    assert manager.is_running("1")

    rt = manager.get_endpoint("1")
    assert rt is not None and rt.port == 18080

    await manager.stop("1")
    assert manager.get_endpoint("1") is None


@pytest.mark.asyncio
async def test_get_endpoint_none_for_crashed(
    manager: WrenMcpProcessManager, tmp_projects_root: Path
) -> None:
    """CRASHED 状态的 endpoint 返回 None（不静默落默认端口）。"""
    await manager.start("1", str(tmp_projects_root / "1"), launcher=_mock_launcher)
    async with manager._lock:
        manager._entries["1"].status = McpStatus.CRASHED
    assert manager.get_endpoint("1") is None


@pytest.mark.asyncio
async def test_for_connection_routing(manager: WrenMcpProcessManager, tmp_projects_root: Path) -> None:
    """IqdMcpClient.for_connection 按 connId 路由到正确端点。"""
    ep = await manager.start("7", str(tmp_projects_root / "7"), launcher=_mock_launcher)
    client = IqdMcpClient.for_connection("7", registry=manager)
    assert client._host == ep.host
    assert client._port == ep.port


@pytest.mark.asyncio
async def test_for_connection_raises_when_not_ready(
    manager: WrenMcpProcessManager,
) -> None:
    """端点缺失时 for_connection 显式抛错（REQ-P0-3，不静默落 8080）。"""
    with pytest.raises(IqdMcpClientError):
        IqdMcpClient.for_connection("99", registry=manager)


# ================================================================ 健康循环 + 崩溃重启


@pytest.mark.asyncio
async def test_health_loop_crash_restart(
    manager: WrenMcpProcessManager, tmp_projects_root: Path
) -> None:
    """进程崩溃（returncode 置非 None）后健康迭代自动重启，status 回写 RUNNING。"""
    launcher_calls: list[Any] = []

    async def counting_launcher(command, env, cwd):
        launcher_calls.append(1)
        return _FakeProc()

    await manager.start(
        "1", str(tmp_projects_root / "1"), launcher=counting_launcher
    )
    assert len(launcher_calls) == 1

    # 模拟进程崩溃
    async with manager._lock:
        manager._entries["1"].proc.returncode = 1

    await manager._health_iteration(probe=None)

    async with manager._lock:
        entry = manager._entries["1"]
    assert entry.status == McpStatus.RUNNING
    assert entry.proc.returncode is None
    assert len(launcher_calls) == 2  # 已重启一次


@pytest.mark.asyncio
async def test_status_reporter_invoked_on_start_and_crash(
    manager: WrenMcpProcessManager, tmp_projects_root: Path
) -> None:
    """status_reporter 在启动与崩溃重启时均被回调（REQ-P1-2）。"""
    await manager.start("1", str(tmp_projects_root / "1"), launcher=_mock_launcher)
    async with manager._lock:
        manager._entries["1"].proc.returncode = 1
    await manager._health_iteration(probe=None)

    reported = manager._test_reported  # type: ignore[attr-defined]
    statuses = {s for _, s, _ in reported}
    assert McpStatus.RUNNING in statuses
    assert McpStatus.CRASHED in statuses


# ================================================================ 目录 7 天保留


@pytest.mark.asyncio
async def test_cleanup_retained_dirs(manager: WrenMcpProcessManager, tmp_projects_root: Path) -> None:
    """超过保留期的 project 目录被清理；未到期保留。"""
    old = tmp_projects_root / "old-conn"
    old.mkdir(parents=True)
    (old / ".iqd-retained").write_text(str(int(time.time()) - 100 * 86400))

    fresh = tmp_projects_root / "fresh-conn"
    fresh.mkdir(parents=True)
    (fresh / ".iqd-retained").write_text(str(int(time.time())))

    removed = manager.cleanup_retained_dirs(retention_days=7)
    assert removed == 1
    assert not old.exists()
    assert fresh.exists()


@pytest.mark.asyncio
async def test_stop_marks_dir_retained(
    manager: WrenMcpProcessManager, tmp_projects_root: Path
) -> None:
    """stop(retain_dir=True) 给 project 目录打保留标记。"""
    home = str(tmp_projects_root / "1")
    await manager.start("1", home, launcher=_mock_launcher)
    await manager.stop("1", retain_dir=True)
    assert (Path(home) / ".iqd-retained").exists()


# ================================================================ 端口段边界（方案 A 多段/单端口）

@pytest.mark.asyncio
async def test_parse_port_range_single_port() -> None:
    """单端口字符串 '18080' 解析为 [18080]（边界：一段仅一个端口）。"""
    assert _parse_port_range("18080") == [18080]


@pytest.mark.asyncio
async def test_parse_port_range_multi_segment() -> None:
    """多段逗号分隔 '18080-18081,19000-19001' 解析为升序去重列表。"""
    assert _parse_port_range("18080-18081,19000-19001") == [18080, 18081, 19000, 19001]


@pytest.mark.asyncio
async def test_parse_port_range_reverse_raises() -> None:
    """起>止的非法段（'18180-18080'）必须显式抛 ValueError。"""
    with pytest.raises(ValueError):
        _parse_port_range("18180-18080")


@pytest.mark.asyncio
async def test_parse_port_range_default_range_size() -> None:
    """默认端口段 '18080-18180' 含 101 个端口（含端点，边界计数）。"""
    mgr = WrenMcpProcessManager()  # 取默认配置段
    ports = mgr.parse_port_range()
    assert len(ports) == 101
    assert ports[0] == 18080
    assert ports[-1] == 18180


@pytest.mark.asyncio
async def test_port_segment_boundary_exact_count(manager: WrenMcpProcessManager) -> None:
    """18080-18083 端口段恰含 4 个端口，分配满且互不越界。"""
    ports = manager.parse_port_range()
    assert ports == [18080, 18081, 18082, 18083]
    for _ in range(4):
        await manager.allocate_port("x")
    with pytest.raises(PortExhaustedError):
        await manager.allocate_port("overflow")


@pytest.mark.asyncio
async def test_concurrency_allocation_unique_ports(tmp_projects_root: Path) -> None:
    """并发 allocate_port（asyncio.Lock 临界区）不产生重复端口，且全部落在段内。

    多连接方案下同一 Worker 可能并发拉起多个连接，端口分配必须无竞态。
    """
    reset_process_manager()
    mgr = WrenMcpProcessManager(
        host="127.0.0.1",
        port_range="18080-18200",
        projects_root=str(tmp_projects_root / "w"),
        status_reporter=lambda *a: None,
    )
    conns = [str(i) for i in range(20)]
    ports = await asyncio.gather(*[mgr.allocate_port(c) for c in conns])
    assert len(set(ports)) == len(ports)  # 无重复 = 无竞态分配
    allowed = set(mgr.parse_port_range())
    assert all(p in allowed for p in ports)
    # 释放后再次分配仍落在段内且不越界
    for p in ports:
        await mgr.release_port(p)
    reused = await mgr.allocate_port("again")
    assert reused in allowed
