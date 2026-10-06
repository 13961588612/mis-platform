"""IQD 行级范围字典同步路由（dept，2026-10-06）。

把某连接的 dept 字典物化行（mis-iqd 默认覆盖裁剪后的 ``(external_value, dept_path)``）
写入该连接业务库 ``mis_dept_scope``，供 Worker ``PATH_PREFIX`` EXISTS 谓词使用。

- ``POST /iqd/scope/dict-sync`` body ``{connection_id, dimension_code?}``
  → ``{connection_id, dimension_code, rows, written, status}``

链路：BFF → 本路由 → :class:`ScopeDictSyncService`（mis-iqd 裁剪结果 + 路线 A 凭证
→ 直连业务库 upsert）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, Field

from src.agent.mis_iqd.scope_dict_sync_service import ScopeDictSyncError, ScopeDictSyncService
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_scope_dict_sync")

router = APIRouter(prefix="/iqd/scope", tags=["iqd-scope-dict-sync"])


class ScopeDictSyncRequest(BaseModel):
    """字典同步请求体（BFF → ai-platform）。"""

    connection_id: int = Field(..., description="问数连接 id")
    dimension_code: str = Field(default="dept", description="维度码（当前仅 dept 物化）")


@router.post("/dict-sync")
async def sync_scope_dict(
    req: ScopeDictSyncRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
):
    """把某连接的 dept 字典物化行写入业务库 mis_dept_scope。"""
    try:
        data = await ScopeDictSyncService().sync_dimension(req.connection_id, req.dimension_code)
        return success(data=data, message="ok", trace_id=trace_id)
    except ScopeDictSyncError as exc:
        logger.warning("IQD scope dict sync failed", error=str(exc))
        return error_response(
            code=exc.code,
            message=f"字典同步失败: {exc}",
            http_status=status.HTTP_502_BAD_GATEWAY,
            trace_id=trace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD scope dict sync unexpected error", error=str(exc))
        return error_response(
            code=9000,
            message=f"字典同步失败: {exc}",
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )
