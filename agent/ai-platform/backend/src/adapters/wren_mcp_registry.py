"""WrenMcpProcessManager — 方案 A 多连接 WrenAI MCP 进程管理器。

每连接一个 ``wren serve mcp`` 进程（绑定该连接 project 目录 + 独立端口），本模块
统一负责其生命周期：

- **端口分配 / 回收**：从配置端口段（``wren_mcp_port_range``）按连接分配，停止/删除
  后回收复用（REQ-P0-2）；段用尽显式报错（不越界绑定）。
- **启停 / 崩溃重启**：``kill -9`` 后在后台健康检查循环内按 ``wren_mcp_health_interval_seconds``
  自动重新拉起（新 pid ≠ 旧 pid），重启期间对进行中问数请求不可达 → orchestrator 走
  既有 mock 降级（REQ-P0-1 / R2）。
- **凭证注入不落盘**：启动期经 ``${ENV}`` 占位把明文凭证注入子进程环境变量
  （D6 铁律：仅 env、不落盘、用后即忘），进程管理器不持久化任何凭证明文（REQ-P0-5）。
- **就绪门禁**：调用方（service/bootstrap）应先确保 ``target/mdl.json`` 已编译（build 完成）
  再调用 :meth:`start`，避免问数打到未就绪 project（REQ-P1-3 / R4）。
- **目录 7 天保留**：连接禁用/删除时先回收端口，project 目录打保留标记，到期由
  :meth:`cleanup_retained_dirs` 清理（设计 §3.2）。
- **可观测**：经 ``status_reporter`` 回调把 ``mcp_status`` / ``mcp_port`` 回写
  mis-iqd（REQ-P1-2），前端轮询即得，无需登机 ``ps``。

注册表为**进程内单例**（:func:`get_process_manager`），多 Worker 实例各自管理本地连接
（一期单 Worker 常驻，符合设计 §2.4）。
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("adapters.wren_mcp_registry")


# ===== 进程状态常量（与 mis-iqd iqd_connection.mcp_status 同义）=====
class McpStatus:
    """MCP 进程状态机取值（前端状态徽标语义）。"""

    RUNNING = "running"
    STARTING = "starting"
    STOPPED = "stopped"
    CRASHED = "crashed"
    UNHEALTHY = "unhealthy"


@dataclass
class McpEndpoint:
    """MCP server 网络端点（orchestrator 按 connection_id 取此构造 client）。"""

    host: str
    port: int


@dataclass
class McpProcessEntry:
    """单连接 MCP 进程注册表条目。"""

    conn_id: str
    host: str
    port: int
    project_home: str
    status: str = McpStatus.STARTING
    proc: Any = None
    name: str = ""
    command: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    launcher: Callable[..., Any] | None = None
    started_at: float = 0.0
    last_health_at: float = 0.0
    failure_count: int = 0


class PortExhaustedError(RuntimeError):
    """端口段用尽（无法为新连接分配端口）。"""


def _parse_port_range(port_range: str) -> list[int]:
    """解析端口段字符串（``"18080-18180"`` 或逗号分隔多段）。

    Returns:
        升序去重后的端口整数列表（含端点）。

    Raises:
        ValueError: 段不合法（起 > 止 / 非整数）。
    """
    ports: set[int] = set()
    for seg in port_range.split(","):
        seg = seg.strip()
        if not seg:
            continue
        if "-" in seg:
            low_s, high_s = seg.split("-", 1)
            low, high = int(low_s.strip()), int(high_s.strip())
            if low > high:
                raise ValueError(f"端口段非法（起>止）: {seg}")
            ports.update(range(low, high + 1))
        else:
            ports.add(int(seg))
    return sorted(ports)


class WrenMcpProcessManager:
    """多连接 WrenAI MCP 进程管理器（进程内单例）。"""

    def __init__(
        self,
        *,
        host: str | None = None,
        port_range: str | None = None,
        projects_root: str | None = None,
        start_timeout_seconds: float | None = None,
        health_interval_seconds: float | None = None,
        health_failure_threshold: int | None = None,
        dir_retention_days: int | None = None,
        status_reporter: Callable[[int, str, int | None], Any] | None = None,
    ) -> None:
        """初始化进程管理器。

        Args:
            host: MCP 监听地址（缺省 ``wren_mcp_default_host``=127.0.0.1）。
            port_range: 端口段字符串（缺省 ``wren_mcp_port_range``）。
            projects_root: project 根目录（缺省 ``wren_projects_root``）。
            start_timeout_seconds: 单进程拉起超时（缺省 ``wren_mcp_start_timeout_seconds``）。
            health_interval_seconds: 健康检查间隔（缺省 ``wren_mcp_health_interval_seconds``）。
            health_failure_threshold: 健康失败阈值（缺省 ``wren_mcp_health_failure_threshold``）。
            dir_retention_days: project 目录保留天数（缺省 ``wren_mcp_dir_retention_days``）。
            status_reporter: 异步可调用 ``(conn_id, status, port) -> awaitable``，
                用于把状态回写 mis-iqd（REQ-P1-2）；为 ``None`` 时跳过。
        """
        settings = get_settings()
        wren = settings.iqd_mcp
        self._host: str = host or wren.wren_mcp_default_host
        self._port_range_str: str = port_range or wren.wren_mcp_port_range
        self._projects_root: str = projects_root or wren.wren_projects_root
        self._start_timeout: float = (
            start_timeout_seconds
            if start_timeout_seconds is not None
            else wren.wren_mcp_start_timeout_seconds
        )
        self._health_interval: float = (
            health_interval_seconds
            if health_interval_seconds is not None
            else wren.wren_mcp_health_interval_seconds
        )
        self._health_failure_threshold: int = (
            health_failure_threshold
            if health_failure_threshold is not None
            else wren.wren_mcp_health_failure_threshold
        )
        self._dir_retention_days: int = (
            dir_retention_days
            if dir_retention_days is not None
            else wren.wren_mcp_dir_retention_days
        )
        self._status_reporter = status_reporter
        self._ports: set[int] = set()
        self._entries: dict[str, McpProcessEntry] = {}
        self._lock = asyncio.Lock()
        self._health_task: asyncio.Task[Any] | None = None

    # ================================================================ 端口分配

    def parse_port_range(self) -> list[int]:
        """返回配置端口段的升序端口列表（便于测试与诊断）。"""
        return _parse_port_range(self._port_range_str)

    def is_port_free(self, port: int) -> bool:
        """端口是否未被本管理器分配。"""
        return port not in self._ports

    async def allocate_port(self, conn_id: str) -> int:
        """为连接分配一个未占用端口（记入使用集）。

        Args:
            conn_id: 连接 id（仅用于日志）。

        Returns:
            分配的端口整数。

        Raises:
            PortExhaustedError: 端口段全部占用。
        """
        async with self._lock:
            return self._allocate_port_locked(conn_id)

    def _allocate_port_locked(self, conn_id: str) -> int:
        """分配端口（调用方须已持 ``self._lock``；供 :meth:`start` 在临界区内复用，
        避免 ``asyncio.Lock`` 不可重入导致的死锁）。"""
        for port in self.parse_port_range():
            if port not in self._ports:
                self._ports.add(port)
                logger.info("IQD MCP port allocated", conn_id=conn_id, port=port)
                return port
        raise PortExhaustedError(
            f"MCP 端口段 {self._port_range_str} 已用尽，无法为连接 {conn_id} 分配端口"
        )

    async def release_port(self, port: int) -> None:
        """回收端口（停止/删除连接时调用）。"""
        async with self._lock:
            self._ports.discard(port)
            logger.info("IQD MCP port released", port=port)

    # ================================================================ 启停

    async def start(
        self,
        conn_id: int | str,
        project_home: str,
        *,
        env: dict[str, str] | None = None,
        name: str = "",
        launcher: Callable[..., Any] | None = None,
        port: int | None = None,
    ) -> McpEndpoint:
        """拉起某连接的 MCP 进程。

        就绪门禁：调用方须保证 ``{project_home}/target/mdl.json`` 已就绪（build 完成）。
        凭证经 ``env`` 注入子进程环境变量（明文不落盘，REQ-P0-5）。

        Args:
            conn_id: 问数连接 id。
            project_home: 该连接 project 绝对目录。
            env: 额外注入子进程的环境变量（如 ``WREN_PG_PASSWORD=xxx``）。
            name: profile 名（用于日志/命令标识）。
            launcher: 可注入启动器（测试用）；缺省拉起真实 ``wren serve mcp``。
            port: 显式端口（restart 复用）；缺省自动分配。

        Returns:
            :class:`McpEndpoint`（host/port）。

        Raises:
            PortExhaustedError: 端口分配失败。
        """
        cid = str(conn_id)
        async with self._lock:
            # 早返回守卫：仅当「RUNNING 且进程存活」才跳过（保留已运行连接不重拉优化）；
            # RUNNING 但 proc 已死（如 restart 先 terminate 置 proc=None）须继续重拉，
            # 否则 restart 会短路成空操作、问数打到死端口（Bug B）。
            if (
                cid in self._entries
                and self._entries[cid].status == McpStatus.RUNNING
                and self._entries[cid].proc is not None
            ):
                entry = self._entries[cid]
                logger.info("IQD MCP already running", conn_id=cid, port=entry.port)
                return McpEndpoint(host=entry.host, port=entry.port)

            # 临界区内复用锁内分配（asyncio.Lock 不可重入，禁止在持锁时 await allocate_port）
            use_port = port if port is not None else self._allocate_port_locked(cid)
            # 若显式端口与已占用冲突（极端），以分配集为准
            if port is not None and port not in self._ports:
                self._ports.add(port)

            full_env = {**os.environ, **(env or {})}
            command = [
                get_settings().iqd_mcp.wren_cli_bin,
                "serve", "mcp",
                "--transport", get_settings().iqd_mcp.wren_mcp_transport,
                "--host", self._host,
                "--port", str(use_port),
                "--project", project_home,
            ]
            entry = McpProcessEntry(
                conn_id=cid,
                host=self._host,
                port=use_port,
                project_home=project_home,
                status=McpStatus.STARTING,
                name=name or f"iqd-conn-{cid}",
                command=command,
                env=full_env,
                launcher=launcher,  # 记录启动器，崩溃重启须复用（测试/离线场景仍为 mock）
                started_at=time.time(),
            )
            self._entries[cid] = entry

        launch = launcher or self._default_launcher
        try:
            proc = await launch(command, full_env, project_home)
        except Exception as exc:  # noqa: BLE001 - 启动失败须回退端口并标记
            async with self._lock:
                self._entries[cid].status = McpStatus.CRASHED
                self._ports.discard(use_port)
            logger.error("IQD MCP start failed", conn_id=cid, error=str(exc))
            await self._report(cid, McpStatus.CRASHED, use_port)
            raise

        async with self._lock:
            entry.proc = proc
            entry.status = McpStatus.RUNNING
            entry.last_health_at = time.time()
        logger.info("IQD MCP started", conn_id=cid, port=use_port, name=entry.name)
        await self._report(cid, McpStatus.RUNNING, use_port)
        return McpEndpoint(host=self._host, port=use_port)

    async def stop(
        self,
        conn_id: int | str,
        *,
        retain_dir: bool = True,
    ) -> None:
        """停止某连接的 MCP 进程并回收端口（保留目录按 retention 策略清理）。

        Args:
            conn_id: 问数连接 id。
            retain_dir: 是否打保留标记（默认 True；连接删除时便于 7 天回溯）。
        """
        cid = str(conn_id)
        async with self._lock:
            entry = self._entries.pop(cid, None)
            if entry is None:
                logger.info("IQD MCP stop: not running", conn_id=cid)
                return
            port = entry.port
        await self._terminate(entry)
        await self.release_port(port)
        if retain_dir:
            self._mark_dir_retained(entry.project_home)
        logger.info("IQD MCP stopped", conn_id=cid, port=port, retain_dir=retain_dir)
        await self._report(cid, McpStatus.STOPPED, None)

    async def restart(
        self,
        conn_id: int | str,
        *,
        env: dict[str, str] | None = None,
        launcher: Callable[..., Any] | None = None,
    ) -> McpEndpoint | None:
        """重启某连接的 MCP 进程（复用原端口，保持稳定端点）。

        Args:
            conn_id: 问数连接 id。
            env: 重新注入的环境变量。
            launcher: 可注入启动器（测试用）。

        Returns:
            重启后的 :class:`McpEndpoint`；连接本就未运行且无法定位 project 时返回 ``None``。
        """
        cid = str(conn_id)
        async with self._lock:
            entry = self._entries.get(cid)
            project_home = entry.project_home if entry else None
            port = entry.port if entry else None

        if project_home is None:
            logger.warning("IQD MCP restart: 未知连接，无法定位 project", conn_id=cid)
            return None

        # 先终止旧进程（不回收端口，便于复用）
        if entry is not None and entry.proc is not None:
            await self._terminate(entry)

        return await self.start(
            cid, project_home, env=env, name=entry.name if entry else "",
            launcher=launcher or (entry.launcher if entry else None),
            port=port,
        )

    # ================================================================ 查询

    def get_endpoint(self, conn_id: int | str) -> McpEndpoint | None:
        """取连接的 MCP 端点（用于 orchestrator 按 connId 路由）。

        Returns:
            ``McpEndpoint``（仅当进程 RUNNING/STARTING 且端口已分配）；
            连接不存在或已停止返回 ``None``（调用方据 REQ-P0-3 返回明确错误，
            **不静默落到默认 8080 端点**）。
        """
        entry = self._entries.get(str(conn_id))
        if entry is None or entry.status in (McpStatus.STOPPED, McpStatus.CRASHED):
            return None
        return McpEndpoint(host=entry.host, port=entry.port)

    def is_running(self, conn_id: int | str) -> bool:
        """连接 MCP 进程是否处于 RUNNING。"""
        entry = self._entries.get(str(conn_id))
        return entry is not None and entry.status == McpStatus.RUNNING

    def list_endpoints(self) -> list[dict[str, Any]]:
        """列出全部注册表条目（可观测 / 调试）。"""
        return [
            {
                "conn_id": e.conn_id,
                "host": e.host,
                "port": e.port,
                "status": e.status,
                "project_home": e.project_home,
                "name": e.name,
                "pid": e.proc.pid if e.proc is not None else None,
                "started_at": e.started_at,
                "last_health_at": e.last_health_at,
                "failure_count": e.failure_count,
            }
            for e in self._entries.values()
        ]

    # ================================================================ 健康检查 + 崩溃重启

    async def health_check(self, conn_id: int | str) -> dict[str, Any]:
        """检查单连接进程健康（探测进程存活 + 可选 HTTP probe）。

        Returns:
            ``{"conn_id", "status", "pid", "alive", "last_health_at"}``。
        """
        cid = str(conn_id)
        async with self._lock:
            entry = self._entries.get(cid)
        if entry is None:
            return {"conn_id": cid, "status": McpStatus.STOPPED, "alive": False}
        alive = entry.proc is not None and entry.proc.returncode is None
        if not alive and entry.status == McpStatus.RUNNING:
            entry.status = McpStatus.CRASHED
        entry.last_health_at = time.time()
        return {
            "conn_id": cid,
            "status": entry.status,
            "pid": entry.proc.pid if entry.proc is not None else None,
            "alive": alive,
            "last_health_at": entry.last_health_at,
        }

    async def run_health_loop(
        self,
        interval_seconds: float | None = None,
        *,
        probe: Callable[[McpEndpoint], Any] | None = None,
        stop_event: asyncio.Event | None = None,
    ) -> None:
        """后台健康检查循环（崩溃重启 + 不健康重启 + 状态回写）。

        - 进程 ``returncode is not None``（被 kill -9）→ 置 CRASHED 并自动重启（REQ-P0-1）；
        - 连续 ``failure_count >= 阈值``（HTTP probe 失败）→ 置 UNHEALTHY 并重启（REQ-P1-1）；
        - 每次循环把最新状态经 ``status_reporter`` 回写 mis-iqd（REQ-P1-2）。

        健康检查**不阻塞**问数主链路（REQ-P1-1③）；循环可被 ``stop_event`` 或取消中断。

        Args:
            interval_seconds: 轮询间隔（缺省 ``wren_mcp_health_interval_seconds``）。
            probe: 可选 async ``(endpoint) -> bool``，做 HTTP/TCP 健康探测；
                为 ``None`` 时仅凭进程存活判定（测试/无真实 server 场景）。
            stop_event: 停止信号（``set()`` 后退出循环）。
        """
        interval = interval_seconds if interval_seconds is not None else self._health_interval
        logger.info("IQD MCP health loop started", interval=interval)
        while True:
            if stop_event is not None and stop_event.is_set():
                break
            try:
                await self._health_iteration(probe)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - 单次循环失败不终止整体
                logger.warning("IQD MCP health loop iteration error", error=str(exc))
            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break

    async def _health_iteration(
        self, probe: Callable[[McpEndpoint], Any] | None
    ) -> None:
        """单次健康检查迭代（遍历所有 RUNNING/STARTING 连接）。"""
        snapshot = list(self._entries.values())
        for entry in snapshot:
            cid = entry.conn_id
            if entry.status in (McpStatus.STOPPED,):
                continue
            alive = entry.proc is not None and entry.proc.returncode is None
            if not alive:
                # 崩溃：自动重启（复用端口）
                logger.warning("IQD MCP process crashed, restarting", conn_id=cid, port=entry.port)
                entry.status = McpStatus.CRASHED
                await self._report(cid, McpStatus.CRASHED, entry.port)
                try:
                    await self.restart(cid, env=entry.env or None, launcher=entry.launcher)
                except Exception as exc:  # noqa: BLE001
                    logger.error("IQD MCP crash restart failed", conn_id=cid, error=str(exc))
                continue

            # 进程存活：可选 HTTP probe
            if probe is not None:
                try:
                    ok = bool(await probe(McpEndpoint(host=entry.host, port=entry.port)))
                except Exception:  # noqa: BLE001
                    ok = False
                if ok:
                    entry.failure_count = 0
                    entry.status = McpStatus.RUNNING
                else:
                    entry.failure_count += 1
                    if entry.failure_count >= self._health_failure_threshold:
                        logger.warning(
                            "IQD MCP unhealthy, restarting",
                            conn_id=cid, failures=entry.failure_count,
                        )
                        entry.status = McpStatus.UNHEALTHY
                        await self._report(cid, McpStatus.UNHEALTHY, entry.port)
                        try:
                            await self.restart(cid, env=entry.env or None, launcher=entry.launcher)
                        except Exception as exc:  # noqa: BLE001
                            logger.error("IQD MCP unhealthy restart failed", conn_id=cid, error=str(exc))
                    else:
                        entry.status = McpStatus.UNHEALTHY
                entry.last_health_at = time.time()
                await self._report(cid, entry.status, entry.port)
            else:
                entry.last_health_at = time.time()
                await self._report(cid, entry.status, entry.port)

    # ================================================================ 目录保留清理

    def _retained_marker(self, project_home: str) -> str:
        return os.path.join(project_home, ".iqd-retained")

    def _mark_dir_retained(self, project_home: str) -> None:
        """打保留标记（记录停用时间，供到期清理）。"""
        try:
            os.makedirs(project_home, exist_ok=True)
            marker = self._retained_marker(project_home)
            with open(marker, "w", encoding="utf-8") as fh:
                fh.write(str(int(time.time())))
        except OSError as exc:
            logger.warning("IQD retained marker write failed", project_home=project_home, error=str(exc))

    def cleanup_retained_dirs(self, retention_days: int | None = None) -> int:
        """清理超过保留期的 project 目录（设计 §3.2：禁用/删除保留 7 天）。

        Args:
            retention_days: 保留天数（缺省 ``wren_mcp_dir_retention_days``）。

        Returns:
            已删除目录数量。
        """
        retention = retention_days if retention_days is not None else self._dir_retention_days
        deadline = time.time() - retention * 86400.0
        removed = 0
        try:
            if not os.path.isdir(self._projects_root):
                return 0
            for name in os.listdir(self._projects_root):
                home = os.path.join(self._projects_root, name)
                marker = self._retained_marker(home)
                if not os.path.exists(marker):
                    continue
                try:
                    with open(marker, "r", encoding="utf-8") as fh:
                        ts = int(fh.read().strip() or "0")
                except (OSError, ValueError):
                    ts = 0
                if ts > 0 and ts < deadline:
                    self._rmtree(home)
                    removed += 1
                    logger.info("IQD retained project dir cleaned", home=home)
        except OSError as exc:
            logger.warning("IQD retained dir cleanup failed", error=str(exc))
        return removed

    @staticmethod
    def _rmtree(path: str) -> None:
        """递归删除目录（尽力而为）。"""
        import shutil

        try:
            shutil.rmtree(path, ignore_errors=True)
        except OSError as exc:  # noqa: BLE001
            logger.warning("IQD rmtree failed", path=path, error=str(exc))

    # ================================================================ 内部

    async def stop_all(self) -> None:
        """停止全部 MCP 进程（Worker 关闭时调用）。"""
        conns = list(self._entries.keys())
        for cid in conns:
            try:
                await self.stop(cid, retain_dir=True)
            except Exception as exc:  # noqa: BLE001
                logger.warning("IQD MCP stop_all entry failed", conn_id=cid, error=str(exc))

    async def _terminate(self, entry: McpProcessEntry) -> None:
        """SIGTERM 后等待，未退出再 SIGKILL（Windows 兼容）。"""
        proc = entry.proc
        if proc is None:
            return
        try:
            if proc.returncode is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=10.0)
                except (asyncio.TimeoutError, ProcessLookupError):
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=5.0)
                    except (asyncio.TimeoutError, ProcessLookupError):
                        pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("IQD MCP terminate error", conn_id=entry.conn_id, error=str(exc))
        finally:
            entry.proc = None

    async def _default_launcher(
        self, command: list[str], env: dict[str, str], cwd: str
    ) -> Any:
        """默认启动器：拉起真实 ``wren serve mcp`` 子进程（cwd + env 注入）。"""
        return await asyncio.create_subprocess_exec(
            *command,
            env=env,
            cwd=cwd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )

    async def _report(self, conn_id: str, status: str, port: int | None) -> None:
        """回写状态到 mis-iqd（若配置了 reporter）。"""
        if self._status_reporter is None:
            return
        try:
            await self._status_reporter(int(conn_id), status, port)
        except Exception as exc:  # noqa: BLE001
            logger.warning("IQD MCP status report failed", conn_id=conn_id, error=str(exc))


_manager: WrenMcpProcessManager | None = None


def get_process_manager(
    *, status_reporter: Callable[[int, str, int | None], Any] | None = None
) -> WrenMcpProcessManager:
    """返回进程管理器单例（首次调用可注入 status_reporter）。"""
    global _manager
    if _manager is None:
        _manager = WrenMcpProcessManager(status_reporter=status_reporter)
    elif status_reporter is not None and _manager._status_reporter is None:
        _manager._status_reporter = status_reporter
    return _manager


def reset_process_manager() -> None:
    """重置单例（测试用）。"""
    global _manager
    _manager = None
