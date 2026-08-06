"""Admin API 路由 — 系统监控、路由日志和 LLM 网关状态。

端点：
- GET  /api/v1/admin/health              — 系统健康概览
- GET  /api/v1/admin/route-logs          — 查询路由决策日志
- GET  /api/v1/admin/route-stats         — 路由统计仪表板
- GET  /api/v1/admin/llm/status          — LLM 网关状态
- GET  /api/v1/admin/llm/token-usage     — token 用量摘要
- GET  /api/v1/admin/llm/quota/{user_id} — 用户配额信息
- POST /api/v1/admin/llm/quota/{user_id}/reset — 重置用户配额
- GET  /api/v1/admin/proxy/status        — 出站代理池状态
- POST /api/v1/admin/failover/reset      — 重置故障转移到主节点
- GET  /api/v1/admin/configs             — 列出所有 Agent 配置
"""

from __future__ import annotations
from typing import Any

from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from src.api.deps import (
    get_config_manager_dep,
    get_current_user,
    get_llm_gateway_dep,
    get_route_logger_dep,
)
from src.api.response import error_response, success
from src.config_manager.manager import ConfigManager
from src.llm.failover import FailoverManager
from src.llm.gateway import LLMGateway
from src.llm.models import QuotaInfo
from src.llm.quota_manager import QuotaManager, get_quota_manager
from src.llm.token_tracker import TokenTracker
from src.router.models import RouteLog, RouteLogFilter, RouteStats
from src.router.route_logger import RouteLogger
from src.coordinator.catalog import serialize_worker_catalog, update_catalog_entry
from src.coordinator.trace import query_dispatch_traces
from src.utils.logging import get_logger

logger = get_logger("api.routes.admin")

router = APIRouter(prefix="/admin", tags=["admin"])


# ===== 请求/响应模型 =====


class RouteLogQuery(BaseModel):
    """路由日志查询参数。"""

    session_id: str | None = None
    user_id: str | None = None
    agent_id: str | None = None
    strategy: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


# ===== 端点 =====


@router.get("/health")
async def system_health(
    llm_gateway: LLMGateway = Depends(get_llm_gateway_dep),
) -> dict[str, Any]:
    """获取所有子系统的整体健康概览。"""
    try:
        llm_status: dict[str, Any] = llm_gateway.get_status()
        return success(
            data={
                "llm_gateway": {
                    "initialized": llm_status["initialized"],
                    "active_provider": llm_status["failover"]["active_provider"],
                    "is_failover_active": llm_status["failover"]["is_failover_active"],
                },
                "proxy_nodes": len(llm_status.get("proxy_pool", [])),
                "healthy_proxy_nodes": sum(
                    1 for n in llm_status.get("proxy_pool", []) if n.get("is_healthy")
                ),
            }
        )
    except Exception as exc:
        logger.error("Health check failed", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/route-logs")
async def get_route_logs(
    session_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    strategy: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    route_logger: RouteLogger = Depends(get_route_logger_dep),
) -> dict[str, Any]:
    """按条件筛选查询路由决策日志。"""
    try:
        filter_obj: RouteLogFilter = RouteLogFilter(
            session_id=session_id,
            user_id=user_id,
            agent_id=agent_id,
            strategy=strategy,
            limit=limit,
            offset=offset,
        )
        logs: list[RouteLog] = await route_logger.query_logs(filter_obj)
        return success(
            data=[log.model_dump() for log in logs],
            message=f"Found {len(logs)} route logs",
        )
    except Exception as exc:
        logger.error("Failed to query route logs", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/route-stats")
async def get_route_stats(
    route_logger: RouteLogger = Depends(get_route_logger_dep),
) -> dict[str, Any]:
    """获取仪表板所用的聚合路由统计数据。"""
    try:
        stats: RouteStats = await route_logger.get_stats()
        return success(data=stats.model_dump())
    except Exception as exc:
        logger.error("Failed to get route stats", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/llm/status")
async def get_llm_status(
    llm_gateway: LLMGateway = Depends(get_llm_gateway_dep),
) -> dict[str, Any]:
    """获取当前 LLM 网关状态，包括故障转移和代理信息。"""
    try:
        status_info: dict[str, Any] = llm_gateway.get_status()
        return success(data=status_info)
    except Exception as exc:
        logger.error("Failed to get LLM status", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/llm/token-usage")
async def get_token_usage(
    user_id: str | None = Query(default=None),
    department: str | None = Query(default=None),
    model: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    llm_gateway: LLMGateway = Depends(get_llm_gateway_dep),
) -> dict[str, Any]:
    """按可选条件筛选获取 token 用量记录。"""
    try:
        from src.llm.token_tracker import get_token_tracker

        tracker: TokenTracker = get_token_tracker()
        records: list[dict[str, Any]] = await tracker.query_usage(
            user_id=user_id,
            dept=department,
            model=model,
            limit=limit,
            offset=offset,
        )
        return success(data=records)
    except Exception as exc:
        logger.error("Failed to get token usage", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/llm/token-summary")
async def get_token_summary(
    user_id: str | None = Query(default=None),
    department: str | None = Query(default=None),
) -> dict[str, Any]:
    """获取聚合 token 用量摘要。"""
    try:
        from src.llm.token_tracker import get_token_tracker

        tracker: TokenTracker = get_token_tracker()
        summary: dict[str, Any] = await tracker.get_summary(user_id=user_id, dept=department)
        return success(data=summary)
    except Exception as exc:
        logger.error("Failed to get token summary", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/llm/quota/{user_id}")
async def get_user_quota(
    user_id: str,
    department: str = Query(default=""),
) -> dict[str, Any]:
    """获取用户的当前 token 配额信息。"""
    try:
        quota_manager: QuotaManager = get_quota_manager()
        info: QuotaInfo = await quota_manager.get_quota_info(user_id, department)
        return success(data=info.model_dump())
    except Exception as exc:
        logger.error("Failed to get quota info", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post("/llm/quota/{user_id}/reset")
async def reset_user_quota(
    user_id: str,
) -> dict[str, Any]:
    """重置用户的每日 token 配额（管理员覆盖）。"""
    try:
        quota_manager: QuotaManager = get_quota_manager()
        await quota_manager.reset_quota(user_id)
        return success(message=f"Quota reset for user {user_id}")
    except Exception as exc:
        logger.error("Failed to reset quota", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/proxy/status")
async def get_proxy_status(
    llm_gateway: LLMGateway = Depends(get_llm_gateway_dep),
) -> dict[str, Any]:
    """获取出站代理池状态。"""
    try:
        status_info: dict[str, Any] = llm_gateway.get_status()
        return success(data=status_info.get("proxy_pool", []))
    except Exception as exc:
        logger.error("Failed to get proxy status", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post("/failover/reset")
async def reset_failover() -> dict[str, Any]:
    """将 LLM 故障转移管理器重置为使用主提供商。"""
    try:
        from src.llm.failover import get_failover_manager

        manager: FailoverManager = get_failover_manager()
        manager.reset()
        return success(
            data={"active_provider": manager.active_provider},
            message="Failover reset to primary provider",
        )
    except Exception as exc:
        logger.error("Failed to reset failover", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/configs")
async def list_configs(
    config_manager: ConfigManager = Depends(get_config_manager_dep),
) -> dict[str, Any]:
    """列出所有 Agent 配置。"""
    try:
        configs: dict[str, Any] = config_manager.list_configs()
        return success(
            data=[
                {
                    "agent_id": c.agent_id,
                    "display_name": c.display_name,
                    "description": c.description,
                    "version": c.version,
                    "runtime_type": c.runtime.type,
                    "model_primary": c.model.primary,
                    "model_fallback": c.model.fallback,
                    "routing_enabled": c.routing.enabled,
                    "routing_priority": c.routing.priority,
                    "routing_keywords": c.routing.keywords,
                }
                for c in configs
            ]
        )
    except Exception as exc:
        logger.error("Failed to list configs", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


# ===== O1g / O2：Worker Catalog 与调度 Traces（UI#10 / C1） =====


class WorkerCatalogUpdateItem(BaseModel):
    """单个 Worker catalog 的批量更新项。"""

    agent_id: str = Field(..., description="Worker Agent ID")
    enabled: bool | None = Field(default=None, description="新的启用状态（None = 不改）")
    when_to_use: str | None = Field(default=None, description="新的适用场景（None = 不改）")


class WorkerCatalogUpdateRequest(BaseModel):
    """``PUT /admin/worker-catalog`` 请求体。"""

    updates: list[WorkerCatalogUpdateItem] = Field(default_factory=list)


@router.get("/worker-catalog")
async def get_worker_catalog_admin() -> dict[str, Any]:
    """获取聚合的 Worker Catalog（由各 Worker catalog 段聚合，spec.md §3.8）。"""
    try:
        return success(data=serialize_worker_catalog())
    except Exception as exc:
        logger.error("Failed to serialize worker catalog", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.put("/worker-catalog")
async def update_worker_catalog_admin(
    req: WorkerCatalogUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """批量改写 Worker 的 ``enabled`` / ``when_to_use``（转调各 Agent metadata）。"""
    try:
        results: list[dict[str, Any]] = []
        for item in req.updates:
            result: dict[str, Any] = update_catalog_entry(
                item.agent_id,
                enabled=item.enabled,
                when_to_use=item.when_to_use,
            )
            results.append(result)
        return success(data={"updated": results}, message="Worker catalog updated")
    except Exception as exc:
        logger.error("Failed to update worker catalog", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/dispatch-traces")
async def get_dispatch_traces(
    session_id: str | None = Query(default=None),
    worker_id: str | None = Query(default=None),
    intent: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """获取委派轨迹（O2 / C1，只读内存环形缓冲）。"""
    try:
        result: dict[str, Any] = await query_dispatch_traces(
            session_id=session_id,
            worker_id=worker_id,
            intent=intent,
            limit=limit,
            offset=offset,
        )
        return success(data=result)
    except Exception as exc:
        logger.error("Failed to query dispatch traces", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)
