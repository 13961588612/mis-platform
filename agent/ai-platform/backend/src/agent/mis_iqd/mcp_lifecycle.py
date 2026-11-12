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
from src.adapters.wren_mcp_agent_client import (
    WrenMcpAgentClient,
    WrenMcpAgentClientError,
    WrenMcpAgentEnsureResult,
)
from src.adapters.wren_mcp_registry import (
    McpStatus,
    _split_endpoint,
    get_agent_registry,
    get_process_manager,
)
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
        auth = ""
        if isinstance(conn, dict):
            auth = str(conn.get("authType") or conn.get("auth_type") or "").strip().lower()
        try:
            return await client.get_connection_env(connection_id)
        except Exception as exc:  # noqa: BLE001 - 凭证不可得需透传给调用方.fail-closed
            # auth_type=none：业务库凭证在 wren profile 侧，平台 vault 可无条目；
            # 允许空 env 继续 ensure（agent 仅推送 secret_ref / 已有 profile）。
            if auth in ("", "none"):
                logger.warning(
                    "IQD resolve connection env skipped (auth_type=none)",
                    connection_id=connection_id,
                    error=str(exc),
                )
                return {}
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
        """派生连接专属 wren project 目录（设计 §3.2）。

        一律用 POSIX ``/`` 拼接：远程 WrenMcpAgent 跑在 Linux，Windows 本机
        ``os.path.join`` 会产生反斜杠路径（日志里曾出现
        ``/var/lib/...\\900001``），导致 wren 机目录对不上。
        """
        settings = get_settings()
        root = (settings.iqd_mcp.wren_projects_root or "").rstrip("/\\")
        return f"{root}/{connection_id}"

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

        # ① 跨机器优先：WrenMcpAgent 已配置 ⇒ MCP 进程在 wren 机（MDL 也在那里）。
        #   此时本机 `os.path.exists(/var/.../mdl.json)` 没意义（ai-platform 跑在 Windows /
        #   不同主机），也不能走本地子进程管理器。“启动”应与“启用/创建项目”
        #   同路径（声明式 ensure → WrenMcpAgentClient.ensure）。
        if WrenMcpAgentClient().enabled:
            logger.info(
                "IQD start: cross-machine agent enabled; delegate to ensure",
                connection_id=connection_id,
            )
            return await self.ensure_connection(connection_id, wait=wait)

        # ② 本地 Plan A：确保 project 目录骨架 + 就绪门禁（本机 target/mdl.json）
        IqdCli().ensure_project(connection_id, project_home)
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

    # ================================================================ 声明式 ensure（跨机器优先）

    async def ensure_connection(self, connection_id: int, *, wait: bool = True) -> dict[str, Any]:
        """声明式 ensure：远程 wren 机部署优先，本地 Plan A 子进程兜底。

        跨机器部署（v0.2，决策 ①⑧）：wren 机常驻 :class:`WrenMcpAgent`，本方法经
        :class:`~src.adapters.wren_mcp_agent_client.WrenMcpAgentClient`.``ensure``
        推凭证 + 拉起 wren 机进程，回传数据面 ``mcp_endpoint`` / ``agent_handle``，
        登记到跨机器注册表并回写 mis-iqd ``mcp_host`` / ``agent_handle`` / ``mcp_status``。

        未配置 ``WREN_AGENT_ENDPOINT`` 时（测试/单机）退回本地 Plan A 子进程模型
        （:meth:`start_connection`），保持既有结构不变（测试可继续 pin 本地启动器）。

        Args:
            connection_id: 问数连接 id。
            wait: 保留参数（启动为异步，无需阻塞等待）。

        Returns:
            ``{"connection_id", "mcp_status", "mcp_host", "agent_handle", "remote"}``。

        Raises:
            IqdMcpLifecycleError: 连接不存在 / 未启用 / MDL 未就绪 / 凭证不可得 / 远程部署失败。
        """
        client = IqdConfigClient()
        conn = await client.get_connection(connection_id)
        if conn is None:
            raise IqdMcpLifecycleError(f"连接 {connection_id} 不存在")
        if not conn.get("enabled", True):
            raise IqdMcpLifecycleError(f"连接 {connection_id} 未启用，拒绝启动 MCP")

        # 远程优先：wren 机常驻 WrenMcpAgent（决策 ①⑧，单 wren 机 ⑧）
        agent_client = WrenMcpAgentClient()
        if agent_client.enabled:
            return await self._ensure_remote(connection_id, conn, agent_client)

        # 本地 Plan A 子进程模型（缺省路径，测试/单机）
        return await self.start_connection(connection_id, wait=wait)

    async def _ensure_remote(
        self,
        connection_id: int,
        conn: dict[str, Any],
        agent_client: WrenMcpAgentClient,
    ) -> dict[str, Any]:
        """远程 ensure：经 WrenMcpAgent.ensure 推凭证 + 拉起 wren 机进程（S1）。

        - project 目录骨架（不含凭证明文）；
        - 就绪门禁（target/mdl.json 已编译）；
        - 解析凭证 env（D6）→ 经控制面一次性推送（bearer+内网，去 mTLS ②⑥）；
        - agent 注入 wren 子进程 env（不落盘，S1）→ 回传数据面 mcp_endpoint/agent_handle；
        - 登记跨机器注册表 + 回写 mis-iqd mcp_host/agent_handle/mcp_status。
        """
        project_home = self.project_home_of(connection_id)
        # ① 确保 project 目录骨架（不含凭证明文）
        IqdCli().ensure_project(connection_id, project_home)
        # ② 就绪门禁（真相以 **wren 机产物** 为准）：
        #   本机 target/mdl.json 在跨机器下无意义（ai-platform 可能跑在 Windows），
        #   但 wren 机上的 target/mdl.json 必须存在——否则 wren serve mcp 会启动即崩，
        #   agent 自愈反复重拉（实测：pid 不断变化而 status 恒为 running，
        #   用户看到「已运行」却查不了数）。故这里先向 agent 探一次远程产物，
        #   缺失则**明确报错**，而不是去拉一个必崩的进程。
        await self._assert_remote_mdl_ready(connection_id, agent_client)
        # ③ 解析凭证 env（D6：仅 env 注入，不落盘）
        # 远程模式：业务库凭证常已在 wren 机 profile；本地 vault 缺表/无条目时
        # 不得阻断 ensure（否则 bootstrap 后 agent_registry 丢连接 → 建模台「MCP 就绪失败」）。
        try:
            env = await self._credential_resolver.resolve_env(connection_id, conn)
        except IqdMcpLifecycleError as exc:
            logger.warning(
                "IQD remote ensure: credential resolve failed; continue with empty env",
                connection_id=connection_id,
                error=str(exc),
            )
            env = {}
        secret_ref = conn.get("secret_ref") or conn.get("secretRef") or ""
        try:
            result = await agent_client.ensure(
                connection_id,
                project_home=project_home,
                credential=env or None,
                desired_state="running",
                name=conn.get("name") or f"iqd-conn-{connection_id}",
                secret_ref=secret_ref,
            )
        except WrenMcpAgentClientError as exc:
            raise IqdMcpLifecycleError(
                f"连接 {connection_id} 远程 wren 部署失败：{exc}"
            ) from exc

        # ④ 登记到跨机器部署注册表（供 orchestrator 按 connId 路由到数据面反向代理）
        get_agent_registry().register(
            connection_id,
            wren_host=result.wren_host or "",
            control_endpoint=result.control_endpoint,
            mcp_endpoint=result.mcp_endpoint,
            agent_handle=result.agent_handle,
            status=result.status,
            secret_ref=secret_ref,
            desired_state="running",
            project_home=result.project_home or project_home,
        )
        # ⑤ 回写 mis-iqd mcp_host/agent_handle/mcp_status（可观测 + 前端定位）
        await self._report_deployment(connection_id, result)
        logger.info(
            "IQD MCP remote deployment ensured",
            connection_id=connection_id,
            agent_handle=result.agent_handle,
            mcp_endpoint=result.mcp_endpoint,
            status=result.status,
        )
        return {
            "connection_id": connection_id,
            "mcp_status": result.status,
            "mcp_host": result.mcp_endpoint,
            "agent_handle": result.agent_handle,
            "remote": True,
        }

    async def _assert_remote_mdl_ready(
        self, connection_id: int, agent_client: WrenMcpAgentClient
    ) -> None:
        """向 wren 机探本连接的 `target/mdl.json`；缺失则明确报错。

        <p>为什么不用本机文件判定：跨机器下本机目录只是骨架镜像，
        真正被 `wren serve mcp` 读取的是 wren 机持久卷上的产物。缺失时不报错
        会让 agent 反复重拉一个必崩的进程，前端却显示「已运行」。
        """
        try:
            data = await agent_client.run_cli(
                connection_id,
                [],
                list_path="target",
                list_prefix="",
                raise_on_error=False,
            )
        except Exception as exc:  # noqa: BLE001 - 探测失败不硬拦（避免误伤已有 profile 的连接）
            logger.warning(
                "IQD remote mdl probe failed; continue",
                connection_id=connection_id,
                error=str(exc),
            )
            return
        listed = [str(f.get("path") or "") for f in (data.get("listed") or [])]
        if not any(p.endswith("mdl.json") for p in listed):
            raise IqdMcpLifecycleError(
                f"连接 {connection_id} 的 MDL 尚未构建（wren 机 "
                f"target/mdl.json 缺失）；请先在模型发布流水线执行 "
                "MDL 构建（或自愈 force-rebuild）再启动 MCP"
            )

    async def _report_deployment(
        self, connection_id: int, result: WrenMcpAgentEnsureResult
    ) -> None:
        """回写跨机器部署句柄到 mis-iqd（best-effort，失败仅告警）。"""
        try:
            await IqdConfigClient().report_mcp_deployment(
                int(connection_id), result.mcp_endpoint, result.agent_handle, result.status
            )
        except Exception as exc:  # noqa: BLE001 - 回写失败不得阻断 ensure
            logger.warning(
                "IQD MCP deployment report failed", connection_id=connection_id, error=str(exc)
            )

    # ================================================================ 停止

    async def stop_connection(self, connection_id: int, *, retain_dir: bool = True) -> dict[str, Any]:
        """停止某连接的 WrenAI MCP 进程并回收端口。

        Args:
            connection_id: 问数连接 id。
            retain_dir: 是否保留 project 目录（默认保留，7 天到期清理）。

        Returns:
            ``{"connection_id", "mcp_status": "stopped"}``。
        """
        # 跨机器优先：WrenMcpAgent 已配置 ⇒ 进程在 wren 机，必须经控制面叫它 stop；
        # 否则只停本地 Plan A 进程管理器，wren 机进程照旧跑，状态查询马上又回 running（真机踩坑）。
        agent_client = WrenMcpAgentClient()
        if agent_client.enabled:
            try:
                data = await agent_client.stop(connection_id)
                logger.info(
                    "IQD MCP remote connection stopped",
                    connection_id=connection_id,
                    result=str(data)[:200],
                )
            except Exception as exc:  # noqa: BLE001 - 远程 stop 失败不得静默：回验状态
                logger.warning(
                    "IQD MCP remote stop failed",
                    connection_id=connection_id,
                    error=str(exc),
                )
                raise IqdMcpLifecycleError(
                    f"连接 {connection_id} 远程停止失败：{exc}"
                ) from exc
            # 注销本地跨机器登记（避免 status 从注册表读到旧 running）
            try:
                get_agent_registry().remove(connection_id)
            except Exception:  # noqa: BLE001
                pass
            # 只回写状态（不动 mcp_host/agent_handle，避免把部署引用清空）
            try:
                await IqdConfigClient().report_mcp_status(
                    int(connection_id), McpStatus.STOPPED, None
                )
            except Exception:  # noqa: BLE001
                pass
            return {"connection_id": connection_id, "mcp_status": McpStatus.STOPPED}

        mgr = get_process_manager()
        await mgr.stop(connection_id, retain_dir=retain_dir)
        logger.info("IQD MCP connection stopped", connection_id=connection_id)
        return {"connection_id": connection_id, "mcp_status": McpStatus.STOPPED}


    # ================================================================ 重启

    async def restart_connection(self, connection_id: int, *, wait: bool = True) -> dict[str, Any]:
        """重启某连接的 WrenAI MCP 进程（复用端口，重新注入凭证 env）。

        跨机器模式走 :meth:`ensure_connection`（远程 agent 幂等 ensure + 回填注册表），
        避免本地 Plan A 注册表空时 ``restart`` 误报「未知连接」并把流水线打成 stopped。

        Args:
            connection_id: 问数连接 id。
            wait: 保留参数（兼容路由语义）。

        Returns:
            ``{"connection_id", "mcp_status", "host", "port"}``；连接未运行时返回 stopped。

        Raises:
            IqdMcpLifecycleError: 连接不存在 / 凭证不可得 / 启动失败。
        """
        agent_client = WrenMcpAgentClient()
        if agent_client.enabled:
            return await self.ensure_connection(connection_id, wait=wait)

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

    async def status_connection(self, connection_id: int) -> dict[str, Any]:
        """取某连接的 MCP 进程状态。

        优先本地 Plan A 进程管理器；其次跨机器部署注册表；再回退实时调
        WrenMcpAgent ``/status``（并回填注册表）。仅查内存时，ai-platform 重启后
        会把远端仍 running 的连接误报 ``stopped`` → 建模台「MCP 就绪失败」。

        Returns:
            ``{"connection_id", "mcp_status", "host", "port", ...}``；
            三边都未命中时 ``mcp_status="stopped"``。
        """
        local = self._status_from_local(connection_id)
        if local is not None:
            return local
        dep = get_agent_registry().get(connection_id)
        if dep is not None:
            return self._status_from_deployment(connection_id, dep)

        agent_client = WrenMcpAgentClient()
        if agent_client.enabled:
            try:
                st = await agent_client.status(connection_id)
            except WrenMcpAgentClientError as exc:
                logger.warning(
                    "IQD MCP remote status probe failed",
                    connection_id=connection_id,
                    error=str(exc),
                )
                st = None
            if st is not None and st.status and st.status != McpStatus.STOPPED:
                control = (get_settings().iqd_mcp.wren_agent_endpoint or "").rstrip("/")
                get_agent_registry().register(
                    connection_id,
                    wren_host=st.wren_host or "",
                    control_endpoint=control,
                    mcp_endpoint=st.mcp_endpoint or "",
                    agent_handle=st.agent_handle or "",
                    status=st.status,
                    project_home=st.project_home or self.project_home_of(connection_id),
                )
                host: str | None = None
                port: int | None = None
                if st.mcp_endpoint:
                    host, port = _split_endpoint(st.mcp_endpoint)
                return {
                    "connection_id": connection_id,
                    "mcp_status": st.status,
                    "host": host or st.wren_host or None,
                    "port": port,
                    "mcp_endpoint": st.mcp_endpoint,
                    "agent_handle": st.agent_handle,
                    "project_home": st.project_home,
                    "last_health_at": st.last_health_at or None,
                    "last_health_msg": st.last_health_msg or None,
                    "remote": True,
                }

        return {
            "connection_id": connection_id,
            "mcp_status": McpStatus.STOPPED,
            "host": None,
            "port": None,
            "remote": False,
        }

    @staticmethod
    def _status_from_local(connection_id: int) -> dict[str, Any] | None:
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
                    "remote": False,
                }
        return None

    @staticmethod
    def _status_from_deployment(connection_id: int, dep: Any) -> dict[str, Any]:
        host: str | None = None
        port: int | None = None
        if dep.mcp_endpoint:
            host, port = _split_endpoint(dep.mcp_endpoint)
        return {
            "connection_id": connection_id,
            "mcp_status": dep.status,
            "host": host or dep.wren_host or None,
            "port": port,
            "mcp_endpoint": dep.mcp_endpoint,
            "agent_handle": dep.agent_handle,
            "project_home": dep.project_home,
            "last_health_at": dep.last_health_at,
            "last_health_msg": dep.last_health_msg,
            "remote": True,
        }

    def list_connections(self) -> list[dict[str, Any]]:
        """列出全部连接的 MCP 状态（本地 + 远程部署合并，可观测 / 调试）。"""
        local = get_process_manager().list_endpoints()
        seen = {str(e.get("conn_id")) for e in local}
        merged: list[dict[str, Any]] = [{**e, "remote": False} for e in local]
        for dep in get_agent_registry().list():
            cid = str(dep.get("conn_id", ""))
            if not cid or cid in seen:
                continue
            host: str | None = None
            port: int | None = None
            endpoint = dep.get("mcp_endpoint") or ""
            if endpoint:
                host, port = _split_endpoint(str(endpoint))
            merged.append(
                {
                    "conn_id": cid,
                    "host": host or dep.get("wren_host"),
                    "port": port,
                    "status": dep.get("status"),
                    "project_home": dep.get("project_home"),
                    "mcp_endpoint": dep.get("mcp_endpoint"),
                    "agent_handle": dep.get("agent_handle"),
                    "last_health_at": dep.get("last_health_at"),
                    "remote": True,
                }
            )
        return merged
