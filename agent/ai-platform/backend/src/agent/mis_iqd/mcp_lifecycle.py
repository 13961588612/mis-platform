"""IqdMcpLifecycleService — 方案 A 多连接 WrenAI MCP 进程生命周期编排（v1.10 / T3）。

把「连接 → 专属 wren project 目录 → 就绪门禁 → 凭证 env 注入 → 进程启停/重启/状态」
串成单一入口，供 :mod:`src.api.routes.iqd_mcp_manager` 的连接级路由调用。

设计要点：
- **每连接独立 project 目录**：``project_home = {wren_projects_root}/{connId}``
  （设计 §3.2）；目录骨架由 :meth:`IqdCli.ensure_project` 创建（不含凭证明文）。
- **就绪门禁（REQ-P1-3 / R4）**：MCP 进程仅在 ``{project_home}/target/mdl.json``
  已编译（build 完成）后启动；缺失即拒绝启动并提示先执行语义模型同步/自愈 build。
- **凭证注入不落盘（D6）**：明文凭证经 :class:`CredentialResolver` 解析为 env 映射，
  **仅**在 ``wren serve mcp`` 启动期注入子进程环境变量（用后即忘），进程管理器不
  持久化任何凭证明文。
- **可注入**：``credential_resolver`` 可注入（测试用 mock），缺省走
  :class:`IqdConfigCredentialResolver`（经 mis-iqd 取 secretRef → ai-platform
  CredentialVault 解析 → 映射 wren env）。
- **状态可观测（REQ-P1-2）**：启停/健康状态经进程管理器 ``status_reporter`` 回调
  回写 mis-iqd（见 T5 Worker 启动注入 reporter）；本服务仅驱动注册表。

端口分配/回收、崩溃自动重启、7 天目录保留见 :mod:`src.adapters.wren_mcp_registry`。
"""

from __future__ import annotations

import json
import os
from typing import Any

from src.adapters.iqd_cli import IqdCli
from src.adapters.iqd_config_client import IqdConfigClient
from src.adapters.wren_mcp_registry import McpStatus, get_process_manager
from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.mcp_lifecycle")


class IqdMcpLifecycleError(RuntimeError):
    """MCP 进程生命周期操作异常（连接不存在 / 未启用 / MDL 未就绪 / 凭证不可得）。"""


class CredentialResolver:
    """连接凭证 → wren env 映射解析器（D6 铁律：仅 env、不落盘）。

    默认实现 :class:`IqdConfigCredentialResolver` 经 mis-iqd 取 ``secretRef``
    再经 ai-platform ``CredentialVault`` 解析明文；测试可注入 mock。
    """

    async def resolve_env(
        self, connection_id: int, conn: dict[str, Any] | None
    ) -> dict[str, str]:
        """解析连接凭证为 wren 启动期 env 映射。

        Args:
            connection_id: 问数连接 id。
            conn: 连接配置视图（含 ``secretRef`` / ``defaultConnector`` 等）。

        Returns:
            env 名 → 明文值 的字典（不含 ``None``/空值）。
        """
        raise NotImplementedError


class IqdConfigCredentialResolver(CredentialResolver):
    """默认凭证解析器：mis-iqd secretRef → ai-platform CredentialVault → wren env。

    解析链路（D6）：
    1. ``IqdConfigClient.get_connection_env(connection_id)`` 经 mis-iqd 内部端点取
       ``secretRef``，再经 ai-platform ``CredentialVault.resolve_by_ref`` 解析为明文
       凭证字典（{host, port, user, password, database, ...}）；
    2. 映射为 wren 启动期 env（postgres 标准占位名 + 整份凭证 JSON 透传）。
    """

    async def resolve_env(
        self, connection_id: int, conn: dict[str, Any] | None
    ) -> dict[str, str]:
        client = IqdConfigClient()
        try:
            return await client.get_connection_env(connection_id)
        except Exception as exc:  # noqa: BLE001 - 凭证不可得需透传给调用方.fail-closed
            logger.warning(
                "IQD resolve connection env failed", connection_id=connection_id, error=str(exc)
            )
            raise IqdMcpLifecycleError(
                f"连接 {connection_id} 凭证不可得（secretRef 解析失败）：{exc}"
            ) from exc


class IqdMcpLifecycleService:
    """问数 MCP 进程生命周期编排（连接级 start/stop/restart/status）。"""

    def __init__(
        self,
        *,
        credential_resolver: CredentialResolver | None = None,
    ) -> None:
        """初始化服务。

        Args:
            credential_resolver: 凭证解析器（缺省 :class:`IqdConfigCredentialResolver`）。
        """
        self._credential_resolver: CredentialResolver = (
            credential_resolver or IqdConfigCredentialResolver()
        )

    # ================================================================ 目录派生

    @staticmethod
    def project_home_of(connection_id: int | str) -> str:
        """派生连接专属 wren project 目录（设计 §3.2）。"""
        settings = get_settings()
        return os.path.join(settings.iqd_mcp.wren_projects_root, str(connection_id))

    # ================================================================ 启动

    async def start_connection(
        self, connection_id: int, *, wait: bool = True
    ) -> dict[str, Any]:
        """拉起某连接的 WrenAI MCP 进程（方案 A 每连接一进程）。

        流程：解析连接 → 派生 project 目录 → 确保目录骨架 → 就绪门禁（mdl.json）
        → 解析凭证 env → 经进程管理器启动（端口分配/注册/健康注册）。

        Args:
            connection_id: 问数连接 id。
            wait: 保留参数（启动为异步，无需阻塞等待；兼容路由语义）。

        Returns:
            ``{"connection_id", "mcp_status", "host", "port"}``。

        Raises:
            IqdMcpLifecycleError: 连接不存在 / 未启用 / MDL 未就绪 / 凭证不可得 / 端口用尽。
        """
        client = IqdConfigClient()
        conn = await client.get_connection(connection_id)
        if conn is None:
            raise IqdMcpLifecycleError(f"连接 {connection_id} 不存在")
        if not conn.get("enabled", True):
            raise IqdMcpLifecycleError(f"连接 {connection_id} 未启用，拒绝启动 MCP")

        project_home = self.project_home_of(connection_id)
        # ① 确保 project 目录骨架（不含凭证明文）
        IqdCli().ensure_project(connection_id, project_home)

        # ② 就绪门禁：target/mdl.json 必须已编译（build 完成）
        mdl_path = os.path.join(project_home, "target", "mdl.json")
        if not os.path.exists(mdl_path):
            raise IqdMcpLifecycleError(
                f"连接 {connection_id} 的 MDL 尚未构建（{mdl_path} 缺失）；"
                "请先执行语义模型同步 / 自愈 force-rebuild 再启动 MCP"
            )

        # ③ 解析凭证 env（D6：仅 env 注入，不落盘）
        env = await self._credential_resolver.resolve_env(connection_id, conn)

        # ④ 经进程管理器启动（端口分配 + 注册 + 健康循环注册）
        mgr = get_process_manager()
        try:
            endpoint = await mgr.start(
                connection_id,
                project_home,
                env={**env} if env else None,
                name=conn.get("name") or f"iqd-conn-{connection_id}",
            )
        except Exception as exc:  # noqa: BLE001 - 端口用尽/启动失败透传
            raise IqdMcpLifecycleError(f"连接 {connection_id} MCP 启动失败：{exc}") from exc

        logger.info(
            "IQD MCP connection started", connection_id=connection_id, port=endpoint.port
        )
        return {
            "connection_id": connection_id,
            "mcp_status": McpStatus.RUNNING,
            "host": endpoint.host,
            "port": endpoint.port,
        }

    # ================================================================ 停止

    async def stop_connection(self, connection_id: int, *, retain_dir: bool = True) -> dict[str, Any]:
        """停止某连接的 WrenAI MCP 进程并回收端口。

        Args:
            connection_id: 问数连接 id。
            retain_dir: 是否保留 project 目录（默认保留，7 天到期清理）。

        Returns:
            ``{"connection_id", "mcp_status": "stopped"}``。
        """
        mgr = get_process_manager()
        await mgr.stop(connection_id, retain_dir=retain_dir)
        logger.info("IQD MCP connection stopped", connection_id=connection_id)
        return {"connection_id": connection_id, "mcp_status": McpStatus.STOPPED}

    # ================================================================ 重启

    async def restart_connection(self, connection_id: int, *, wait: bool = True) -> dict[str, Any]:
        """重启某连接的 WrenAI MCP 进程（复用端口，重新注入凭证 env）。

        Args:
            connection_id: 问数连接 id。
            wait: 保留参数（兼容路由语义）。

        Returns:
            ``{"connection_id", "mcp_status", "host", "port"}``；连接未运行时返回 stopped。

        Raises:
            IqdMcpLifecycleError: 连接不存在 / 凭证不可得 / 启动失败。
        """
        mgr = get_process_manager()
        entry = mgr.get_endpoint(connection_id)
        env: dict[str, str] | None = None
        if entry is not None:
            # 重新解析凭证 env（连接存在且曾运行）
            client = IqdConfigClient()
            conn = await client.get_connection(connection_id)
            if conn is not None:
                env = await self._credential_resolver.resolve_env(connection_id, conn)
        endpoint = await mgr.restart(connection_id, env={**env} if env else None)
        if endpoint is None:
            return {"connection_id": connection_id, "mcp_status": McpStatus.STOPPED}
        logger.info("IQD MCP connection restarted", connection_id=connection_id, port=endpoint.port)
        return {
            "connection_id": connection_id,
            "mcp_status": McpStatus.RUNNING,
            "host": endpoint.host,
            "port": endpoint.port,
        }

    # ================================================================ 状态

    def status_connection(self, connection_id: int) -> dict[str, Any]:
        """取某连接的 MCP 进程状态（来自进程管理器内存注册表）。

        Returns:
            ``{"connection_id", "mcp_status", "host", "port",
            "pid", "started_at", "last_health_at", "failure_count"}``；
            连接未注册时 ``mcp_status="stopped"``、端点为 ``None``。
        """
        mgr = get_process_manager()
        for e in mgr.list_endpoints():
            if str(e.get("conn_id")) == str(connection_id):
                return {
                    "connection_id": connection_id,
                    "mcp_status": e.get("status"),
                    "host": e.get("host"),
                    "port": e.get("port"),
                    "pid": e.get("pid"),
                    "project_home": e.get("project_home"),
                    "started_at": e.get("started_at"),
                    "last_health_at": e.get("last_health_at"),
                    "failure_count": e.get("failure_count"),
                }
        return {
            "connection_id": connection_id,
            "mcp_status": McpStatus.STOPPED,
            "host": None,
            "port": None,
        }

    def list_connections(self) -> list[dict[str, Any]]:
        """列出全部连接的 MCP 进程状态（可观测 / 调试）。"""
        return get_process_manager().list_endpoints()
