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

from src.adapters.wren_mcp_registry import get_process_manager
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
            await IqdMcpLifecycleService().start_connection(cid_int, wait=False)
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
