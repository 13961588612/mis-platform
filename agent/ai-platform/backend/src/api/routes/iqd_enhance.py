"""IQD 样本对增强端点（v1.10 / §4.2.3）：方言转化 + 试运行。

暴露受 MIS RS256 保护的端点，供 ``mis-admin-bff`` 适配层（IqdAclController →
AiPlatformClient）转发：
- ``POST /iqd/sql-pairs/translate``  body ``{db_type, native_sql}``
  → ``{wren_sql, warnings}``（sqlglot 源方言 → WrenAI 方言）
- ``POST /iqd/sql-pairs/trial``      body ``{wren_sql}``
  → ``{columns, rows, error, duration_ms}``（经 MCP run_sql 在 WrenAI 引擎侧执行）

链路：BFF → AiPlatformClient → 本路由 → MisIqdService（IqdAskService 实例）。
端点内部取 service 实例的方式参照 mis_capability.py 的 chat 端点（直接构造
服务实例；鉴权透传 Authorization / X-Trace-Id，沿用 get_current_user 保护）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, Field

from src.agent.mis_iqd.service import IqdAskService
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_enhance")

router = APIRouter(prefix="/iqd", tags=["iqd-enhance"])


class TranslateRequest(BaseModel):
    """样本对方言转化请求体。"""

    db_type: str = Field(..., description="关系库类型：oracle|mysql|postgres|clickhouse")
    native_sql: str = Field(..., description="原生 SQL（源方言）")


class TrialRequest(BaseModel):
    """样本对试运行请求体。"""

    wren_sql: str = Field(..., description="转化后的 WrenAI 方言 SQL（可经前端手改）")


@router.post("/sql-pairs/translate")
async def translate_sql_pair(
    req: TranslateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """样本对方言转化（v1.10）：源方言 → WrenAI 方言。"""
    try:
        service = IqdAskService()
        result = await service.translate_sql_pair(req.db_type, req.native_sql)
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD translate_sql_pair failed", error=str(exc))
        return error_response(
            code=9000,
            message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )


@router.post("/sql-pairs/trial")
async def trial_sql_pair(
    req: TrialRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """样本对试运行（v1.10）：在 WrenAI 引擎侧执行转化后的 wren_sql。"""
    try:
        service = IqdAskService()
        result = await service.trial_sql_pair(req.wren_sql)
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD trial_sql_pair failed", error=str(exc))
        return error_response(
            code=9000,
            message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )
