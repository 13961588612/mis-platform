"""IQD 运维自愈三按钮路由（v1.10 / 自愈闭环）。

暴露受 MIS RS256 保护的端点，供 ``mis-admin-bff`` 适配层（IqdAclController →
AiPlatformClient）转发：
- ``POST /iqd/self-heal/force-rebuild``  body ``{connection_id?, wait:true}``
  → ``{build_status, index_status, build_mdl_hash, ...}``（context build(force) + memory index）
- ``POST /iqd/self-heal/re-index``       → ``{build_status, index_status, ...}``（memory reset + memory index）
- ``POST /iqd/self-heal/validate``       → ``{build_status, build_error, ...}``（context validate，build_error 含人可读摘要）

链路：BFF → AiPlatformClient → 本路由 → IqdAskService（trigger_force_rebuild /
trigger_reindex / trigger_validate）→ 经 IqdConfigClient 报作业写回 mis-iqd。
三动作的可选 WrenAI flag 全部来自 ``IqdMcpSettings.self_heal_*_args`` 配置（Q5），
方法体不硬编码。鉴权透传 Authorization / X-Trace-Id，沿用 get_current_user 保护。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, Field

from src.agent.mis_iqd.service import IqdAskService
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_selfheal")

router = APIRouter(prefix="/iqd/self-heal", tags=["iqd-selfheal"])


class SelfHealRequest(BaseModel):
    """运维自愈触发请求体（BFF → ai-platform）。

    Attributes:
        connection_id: 问数连接 id（缺省解析主连接 name='default'/首条 enabled）。
        wait: 是否阻塞至完成（自愈为运维主动触发，默认 True 返回完整 SyncResult）。
    """

    connection_id: int | None = Field(
        default=None, description="问数连接 id（缺省解析主连接）"
    )
    wait: bool = Field(
        default=True, description="true=阻塞至 build+index/validate 完成返回完整 SyncResult"
    )


@router.post("/force-rebuild")
async def force_rebuild(
    req: SelfHealRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """强制重建（context build(force) + memory index），action=force_rebuild。"""
    try:
        service = IqdAskService()
        result = await service.trigger_force_rebuild(req.connection_id, req.wait)
        return success(data=result.model_dump(), message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD self-heal force-rebuild failed", error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )


@router.post("/re-index")
async def re_index(
    req: SelfHealRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """重新索引（memory reset + memory index），action=reindex。"""
    try:
        service = IqdAskService()
        result = await service.trigger_reindex(req.connection_id, req.wait)
        return success(data=result.model_dump(), message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD self-heal re-index failed", error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )


@router.post("/validate")
async def validate(
    req: SelfHealRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """模型校验（context validate），action=validate，build_error 含人可读摘要。"""
    try:
        service = IqdAskService()
        result = await service.trigger_validate(req.connection_id, req.wait)
        return success(data=result.model_dump(), message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD self-heal validate failed", error=str(exc))
        return error_response(
            code=9000, message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR, trace_id=trace_id,
        )
