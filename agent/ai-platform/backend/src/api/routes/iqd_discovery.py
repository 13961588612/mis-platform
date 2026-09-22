"""表发现路由（MR-02 / 系统设计 §4.1 a 点）。

暴露受 MIS RS256 保护的 4 个端点，供 ``mis-admin-bff`` 适配层
（``IqdModelingController`` → ``AiPlatformDiscoveryClient``）转发：

* ``GET  /api/v1/iqd/discovery/schemas``  ``?connectionId=``        → ``{schemas: [string]}``
* ``GET  /api/v1/iqd/discovery/tables``   ``?connectionId=&schema=&page=&keyword=``
  → ``{tables: [{name, comment, row_count_estimate}], total, page}``
* ``GET  /api/v1/iqd/discovery/columns``  ``?connectionId=&schema=&table=``
  → ``{columns: [{name, type, comment, is_pk_inferred, nullable}]}``
* ``POST /api/v1/iqd/discovery/import``   body ``{connection_id, tables[], mode, in_scope}``
  → ``{imported: [item_key], skipped: [item_key]}``

链路：BFF → 本路由 → :class:`src.agent.mis_iqd.discovery_service.IqdDiscoveryService`
→ WrenAI MCP（``list_models`` / ``describe_model``）→ 导入写路径走 mis-iqd 内部面。

前缀说明
--------
本路由自带前缀 ``/iqd/discovery``，由 ``src/main.py`` 以 ``prefix="/api/v1"`` 挂载 ——
与既有 ``/api/v1/iqd/self-heal``、``/api/v1/iqd/enhance``、``/api/v1/iqd/mcp`` 同口径
（ai-platform 所有业务路由统一 include 于 ``/api/v1``）。设计稿 §4.1 写的
``/internal/v1/iqd/discovery/**`` 是 **Java 侧内部面**的命名，Python Worker 从不使用；
此处以代码基线为准（详见 T01 报告偏离 7）。

查询参数命名
------------
对外 wire 用 ``connectionId``（对齐系统设计 §4.1 / 与 BFF 侧 Java
``@RequestParam Long connectionId`` 一致）；函数参数保持 pythonic 的 ``connection_id``
（经 ``Query(alias=...)`` 映射）。**T02b 的 ``AiPlatformDiscoveryClient`` 按此命名对接。**

错误码映射
----------
* 42200（入参校验：空清单 / 缺 connection_id）→ HTTP 422 + ``{code:42200}``
* 50201（profile 未注入 / 连接不可达 / MCP 未就绪）→ HTTP 502 + ``{code:50201}``
* 其它未预期异常 → HTTP 500 + ``{code:9000}``（沿用既有 iqd 路由口径）
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, Query, status
from pydantic import BaseModel, Field

from src.agent.mis_iqd.discovery_service import (
    DiscoveryUnavailableError,
    DiscoveryValidationError,
    IqdDiscoveryService,
)
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_discovery")

router = APIRouter(prefix="/iqd/discovery", tags=["iqd-discovery"])

#: 入参校验失败（设计 §3.3：42200 空清单 / 参数不合法）。
VALIDATION_CODE: int = 42200

#: 连接不可达 / profile 未注入（设计 §3.3：50201）。
UNAVAILABLE_CODE: int = 50201

#: 未预期异常（沿用既有 iqd 路由口径）。
INTERNAL_CODE: int = 9000


class ImportTablesRequest(BaseModel):
    """批量导入请求体（BFF → ai-platform）。

    Attributes:
        connection_id: 问数连接 id。
        tables: 待导入表清单 ``[{"schema": "...", "name": "..."}]``。
        mode: ``create_or_skip``（幂等，已存在则跳过）| ``create_or_update``。
        in_scope: 是否同时纳入问数范围。**缺省不传即「不纳入」**（PRD §6.3「导入 ≠ 可问」：
            导入的表默认不进问数范围，引导用户去 ``/iqd/scope`` 勾选）；
            仅显式传 ``true`` 才随导入一并纳入。
    """

    connection_id: int = Field(description="问数连接 id")
    tables: list[dict[str, Any]] = Field(
        default_factory=list, description="待导入表清单 [{schema,name}]"
    )
    mode: str = Field(default="create_or_skip", description="create_or_skip | create_or_update")
    in_scope: bool | None = Field(default=None, description="是否同时纳入问数范围")


def _error_response(exc: Exception, trace_id: str, logger_msg: str) -> Any:
    """按异常类型映射 HTTP 状态与业务码（42200 / 50201 / 9000）。"""
    if isinstance(exc, DiscoveryValidationError):
        return error_response(
            code=getattr(exc, "code", VALIDATION_CODE),
            message=str(exc),
            http_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            trace_id=trace_id,
        )
    if isinstance(exc, DiscoveryUnavailableError):
        logger.warning(logger_msg, error=str(exc))
        return error_response(
            code=getattr(exc, "code", UNAVAILABLE_CODE),
            message=str(exc),
            http_status=status.HTTP_502_BAD_GATEWAY,
            trace_id=trace_id,
        )
    logger.error(logger_msg, error=str(exc))
    return error_response(
        code=INTERNAL_CODE,
        message=str(exc),
        http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        trace_id=trace_id,
    )


@router.get("/schemas")
async def list_schemas(
    connection_id: int = Query(alias="connectionId", description="问数连接 id"),
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """列出连接下可见 schema。"""
    try:
        schemas = await IqdDiscoveryService().list_schemas(connection_id)
        return success(data={"schemas": schemas}, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001 - 统一在 _error_response 内分流
        return _error_response(exc, trace_id, "IQD discovery list_schemas failed")


@router.get("/tables")
async def list_tables(
    connection_id: int = Query(alias="connectionId", description="问数连接 id"),
    schema: str = Query(description="schema 名"),
    page: int = Query(default=1, description="页码（从 1 起）"),
    keyword: str | None = Query(default=None, description="表名关键字"),
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """分页列出表清单。"""
    try:
        result = await IqdDiscoveryService().list_tables(connection_id, schema, page, keyword)
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc, trace_id, "IQD discovery list_tables failed")


@router.get("/columns")
async def list_columns(
    connection_id: int = Query(alias="connectionId", description="问数连接 id"),
    schema: str = Query(description="schema 名"),
    table: str = Query(description="表名"),
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """列出表字段（含主键推断）。"""
    try:
        columns = await IqdDiscoveryService().list_columns(connection_id, schema, table)
        return success(data={"columns": columns}, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc, trace_id, "IQD discovery list_columns failed")


@router.post("/import")
async def import_tables(
    req: ImportTablesRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """批量导入表为平台 catalog 节点（``kind=table/model/column``, ``source='modeling'``）。"""
    try:
        result = await IqdDiscoveryService().import_tables(req.model_dump())
        return success(data=result, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        return _error_response(exc, trace_id, "IQD discovery import_tables failed")
