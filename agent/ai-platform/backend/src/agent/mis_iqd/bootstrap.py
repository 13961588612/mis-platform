"""IQD MCP 进程管理器引导（方案 A 多连接，T4/T5）。

Worker 启动阶段：
- 把状态回写回调（``status_reporter``）注入进程管理器单例（REQ-P1-2），使
  ``mcp_status`` / ``mcp_port`` 实时回写 mis-iqd（前端轮询即得，无需登机 ``ps``）；
- 批量拉起所有「启用」连接的 WrenAI MCP 进程（best-effort，单连接失败不阻断其它）；
- 启动后台健康检查循环（崩溃自动重启 + 不健康重启 + 状态回写），可被 ``stop_event`` 中断。

关闭阶段：置 ``stop_event`` 并 ``stop_all`` 回收端口 + 回写 stopped。

就绪门禁（build 完成才有 ``target/mdl.json``）由
:class:`~src.agent.mis_iqd.mcp_lifecycle.IqdMcpLifecycleService`.``start_connection``
强制，未就绪连接启动失败并在日志提示先执行语义模型同步 / 自愈 force-rebuild（不阻断
其它连接）。
"""

from __future__ import annotations

import asyncio
from typing import Any

from src.adapters.wren_mcp_agent_client import WrenMcpAgentClient
from src.adapters.wren_mcp_registry import get_agent_registry, get_process_manager
from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.bootstrap")


async def mcp_status_reporter(conn_id: int, status: str, port: int | None) -> None:
    """把连接级 MCP 状态回写 mis-iqd（REQ-P1-2）。

    供 ``WrenMcpProcessManager.status_reporter`` 回调；异常仅告警（不阻断健康循环）。
    """
    try:
        from src.adapters.iqd_config_client import IqdConfigClient

        await IqdConfigClient().report_mcp_status(int(conn_id), status, port)
    except Exception as exc:  # noqa: BLE001 - 回写失败不得影响健康循环
        logger.warning("IQD MCP status report failed", conn_id=conn_id, error=str(exc))


async def ensure_process_manager_with_reporter() -> Any:
    """返回注入 ``status_reporter`` 的进程管理器单例（幂等）。"""
    return get_process_manager(status_reporter=mcp_status_reporter)


async def bulk_start_enabled_iqd_mcp() -> int:
    """Worker 启动批量拉起所有启用连接的 MCP 进程（best-effort）。

    逐连接调用 :meth:`IqdMcpLifecycleService.start_connection`（内部强制就绪门禁 +
    凭证 env 注入）。单连接启动失败（如 MDL 未构建）仅告警跳过，不阻断其它连接与
    Worker 主进程；运维可经自愈 force-rebuild 后手动 ``/iqd/mcp/start`` 拉起。

    Returns:
        成功拉起（含已运行）的连接数。
    """
    from src.adapters.iqd_config_client import IqdConfigClient, IqdConfigClientError
    from src.agent.mis_iqd.mcp_lifecycle import IqdMcpLifecycleService

    try:
        connections = await IqdConfigClient().get_configs()  # 仅启用连接清单
    except IqdConfigClientError as exc:
        logger.warning("IQD MCP bulk-start skipped: 连接清单拉取失败", error=str(exc))
        return 0

    get_process_manager(status_reporter=mcp_status_reporter)
    started = 0
    total = 0
    for conn in connections:
        if not isinstance(conn, dict):
            continue
        total += 1
        cid = conn.get("id")
        if cid is None:
            continue
        cid_int = int(cid) if str(cid).isdigit() else None
        if cid_int is None:
            continue
        try:
            # 远程优先：WREN_AGENT_ENDPOINT 已配置时经 WrenMcpAgentClient.ensure 批量拉起
            # wren 机部署（v0.2 跨机器落地）；否则退回本地 Plan A 子进程模型（测试/单机路径）。
            service = IqdMcpLifecycleService()
            if WrenMcpAgentClient().enabled:
                await service.ensure_connection(cid_int, wait=False)
            else:
                await service.start_connection(cid_int, wait=False)
            started += 1
        except Exception as exc:  # noqa: BLE001 - 单连接失败不阻断其它
            logger.warning(
                "IQD MCP bulk-start connection failed (skipped)",
                connection_id=cid_int, error=str(exc),
            )
    logger.info("IQD MCP bulk-start done", started=started, total=total)
    return started


async def start_iqd_mcp_supervisor(
    *, stop_event: asyncio.Event | None = None
) -> tuple[asyncio.Event, asyncio.Task[Any]]:
    """启动后台健康监督循环（崩溃重启 + 不健康重启 + 状态回写）。

    Args:
        stop_event: 外部停止信号（``set()`` 后退出循环）；缺省内部新建。

    Returns:
        ``(stop_event, task)``：关闭时置 ``stop_event`` 并对 ``task`` 取消。
    """
    mgr = get_process_manager(status_reporter=mcp_status_reporter)
    if stop_event is None:
        stop_event = asyncio.Event()
    task = asyncio.create_task(
        mgr.run_health_loop(stop_event=stop_event), name="iqd-mcp-health-loop"
    )
    logger.info("IQD MCP supervisor started")
    return stop_event, task


async def start_iqd_mcp_reconciler(
    *, stop_event: asyncio.Event | None = None
) -> tuple[asyncio.Event, asyncio.Task[Any]]:
    """启动后台跨机器部署 reconcile 循环（仅远程模式生效；决策 ①⑧）。

    ai-platform 侧对每条远程部署周期性调用 :meth:`WrenMcpAgentClient.status` 取健康快照，
    更新本地跨机器注册表状态并回写 mis-iqd ``mcp_status``（可观测 + 前端定位）。wren 机
    侧崩溃自愈由 agent 自身负责（决策 ①），本循环只做状态对账（不重拉进程）。

    Args:
        stop_event: 外部停止信号（``set()`` 后退出循环）；缺省内部新建。

    Returns:
        ``(stop_event, task)``：关闭时置 ``stop_event`` 并对 ``task`` 取消。
    """
    if stop_event is None:
        stop_event = asyncio.Event()
    task = asyncio.create_task(
        _run_reconcile_loop(stop_event=stop_event), name="iqd-mcp-reconciler"
    )
    logger.info("IQD MCP reconciler started")
    return stop_event, task


async def _run_reconcile_loop(stop_event: asyncio.Event) -> None:
    """远程部署 reconcile 循环主逻辑。"""
    interval = float(get_settings().iqd_mcp.wren_mcp_health_interval_seconds)
    while True:
        if stop_event.is_set():
            break
        try:
            await _reconcile_once()
        except Exception as exc:  # noqa: BLE001
            logger.warning("IQD MCP reconcile iteration error", error=str(exc))
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            break


async def _reconcile_once() -> None:
    """单次 reconcile：遍历远程部署，刷新状态 + 回写 mis-iqd（单连接失败仅告警）。"""
    registry = get_agent_registry()
    deployments = registry.list()
    if not deployments:
        return
    agent_client = WrenMcpAgentClient()
    if not agent_client.enabled:
        return
    from src.adapters.iqd_config_client import IqdConfigClient

    for dep in deployments:
        conn_id = dep.get("conn_id")
        if conn_id is None:
            continue
        try:
            status = await agent_client.status(conn_id)
            registry.set_status(conn_id, status.status, health_msg=status.last_health_msg)
            await IqdConfigClient().report_mcp_deployment(
                int(conn_id), status.mcp_endpoint, status.agent_handle, status.status
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "IQD MCP reconcile connection failed", connection_id=conn_id, error=str(exc)
            )


async def shutdown_iqd_mcp(
    stop_event: asyncio.Event | None, task: asyncio.Task[Any] | None
) -> None:
    """关闭 IQD MCP 监督循环并停止全部进程（回收端口 + 回写 stopped）。"""
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001 - 取消/异常均忽略
            pass
    try:
        await get_process_manager().stop_all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("IQD MCP stop_all failed", error=str(exc))
