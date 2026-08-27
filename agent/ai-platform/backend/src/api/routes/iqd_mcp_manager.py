"""IQD WrenAI MCP 连接级管理路由（v1.10 / 方案 A 多连接，T3）。

暴露受 MIS RS256 保护的端点，供 ``mis-admin-bff`` 适配层（IqdAclController →
AiPlatformClient）转发，实现「每连接一个 wren serve mcp 进程」的生命周期管控：
- ``POST /iqd/mcp/start``    body ``{connection_id, wait}``
  → 派生 project 目录 + 就绪门禁 + 凭证 env 注入 + 启动进程
- ``POST /iqd/mcp/stop``     body ``{connection_id, retain_dir}`` → 停止 + 回收端口
- ``POST /iqd/mcp/restart``  body ``{connection_id, wait}`` → 重启（复用端口 + 重注凭证）
- ``GET  /iqd/mcp/status``   ``?connection_id=`` → 单连接状态（缺省全部）
- ``GET  /iqd/mcp/list``     → 全部连接进程状态

鉴权透传 Authorization / X-Trace-Id，沿用 get_current_user 保护；链路：
BFF → AiPlatformClient → 本路由 → IqdMcpLifecycleService（→ WrenMcpProcessManager）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, Query, status
from pydantic import BaseModel, Field

from src.agent.mis_iqd.mcp_lifecycle import IqdMcpLifecycleService
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_mcp_manager")

router = APIRouter(prefix="/iqd/mcp", tags=["iqd-mcp-manager"])


class McpStartRequest(BaseModel):
    """MCP 启停请求体（BFF → ai-platform）。"""

    connection_id: int = Field(..., description="问数连接 id（方案 A 每连接独立进程）")
    wait: bool = Field(default=True, description="保留参数（启动为异步，兼容自愈语义）")
    retain_dir: bool = Field(
        default=True, description="stop 时是否保留 project 目录（默认保留，7 天到期清理）"
    )


@router.post("/start")
async def start_mcp(
    req: McpStartRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """拉起某连接的 WrenAI MCP 进程（就绪门禁 + 凭证 env 注入）。"""
    try:
        service = IqdMcpLifecycleService()
        result = await service.start_connection(req.connection_id, wait=req.wait)
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD MCP start failed", connection_id=req.connection_id, error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )


@router.post("/ensure")
async def ensure_mcp(
    req: McpStartRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """声明式 ensure（跨机器部署优先，本地 Plan A 兜底）。

    远程模式（WREN_AGENT_ENDPOINT 已配置）经 WrenMcpAgentClient.ensure 推凭证 +
    拉起 wren 机进程，回写 mis-iqd mcp_host/agent_handle/mcp_status；本地模式退回
    既有本地子进程模型。业务按钮「启用/创建项目」走本端点。
    """
    try:
        service = IqdMcpLifecycleService()
        result = await service.ensure_connection(req.connection_id, wait=req.wait)
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD MCP ensure failed", connection_id=req.connection_id, error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )


@router.post("/stop")
async def stop_mcp(
    req: McpStartRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """停止某连接的 WrenAI MCP 进程并回收端口。"""
    try:
        service = IqdMcpLifecycleService()
        result = await service.stop_connection(
            req.connection_id, retain_dir=req.retain_dir
        )
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD MCP stop failed", connection_id=req.connection_id, error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )


@router.post("/restart")
async def restart_mcp(
    req: McpStartRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """重启某连接的 WrenAI MCP 进程（复用端口 + 重新注入凭证 env）。"""
    try:
        service = IqdMcpLifecycleService()
        result = await service.restart_connection(req.connection_id, wait=req.wait)
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD MCP restart failed", connection_id=req.connection_id, error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )


@router.get("/status")
async def status_mcp(
    connection_id: int | None = Query(default=None, description="问数连接 id；缺省返回全部"),
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """取连接级 MCP 进程状态（内存注册表视角）。"""
    try:
        service = IqdMcpLifecycleService()
        if connection_id is not None:
            result = service.status_connection(connection_id)
        else:
            result = service.list_connections()
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD MCP status failed", connection_id=connection_id, error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )


@router.get("/list")
async def list_mcp(
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """列出全部连接的 MCP 进程状态（可观测 / 调试）。"""
    try:
        service = IqdMcpLifecycleService()
        return success(data=service.list_connections(), message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD MCP list failed", error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )
