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

from src.agent.mis_iqd.service import IqdAskService, SyncResult
from src.agent.mis_iqd.sync_coordinator import SyncCoordinator
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


class EnhanceSyncRequest(BaseModel):
    """增强物料同步请求体（闭环触发；BFF → ai-platform）。

    Attributes:
        connection_id: 问数连接 id（缺省解析主连接 name='default'/首条 enabled）。
        wait: ``False``=保存后自动触发（接受即返回 ``{accepted,coalesced}``）；
            ``True``=立即同步/重试按钮（阻塞至 build+index 完成，返回完整 ``SyncResult``）。
    """

    connection_id: int | None = Field(
        default=None, description="问数连接 id（缺省解析主连接）"
    )
    wait: bool = Field(
        default=False, description="false=自动触发接受即返回; true=立即同步/重试阻塞完成"
    )
    scope: str = Field(
        default="materials",
        description="构建范围 materials(一期物料) | model(二期模型写回)",
    )


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


@router.post("/enhance/sync")
async def enhance_sync(
    req: EnhanceSyncRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """增强物料同步（闭环 P0-3 / P1-1 / P1-2）。

    经 :class:`SyncCoordinator` 合并窗口触发 ``IqdAskService.trigger_build_index``：
    拉待下发物料 → ``context build`` → ``memory index`` → 经 ``IqdConfigClient`` 回填 +
    报作业（写回 mis-iqd 内部端点）。

    - ``wait=false``：接受即返回 ``{accepted, coalesced}``（保存后自动触发，前端列表刷新 + 状态条转「同步中」）。
    - ``wait=true``：阻塞至 build+index 完成，返回完整 ``SyncResult``（立即同步/重试按钮）。
    """
    try:
        coordinator = SyncCoordinator()
        result: SyncResult = await coordinator.trigger(req.connection_id, req.wait, req.scope)
        return success(
            data=result.model_dump(),
            message="accepted" if not req.wait else "ok",
            trace_id=trace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD enhance_sync failed", error=str(exc))
        return error_response(
            code=9000,
            message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )


@router.post("/enhance/reconcile")
async def enhance_reconcile(
    req: EnhanceSyncRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """对账清扫（S3 / 周期或手动）：比对 WrenAI 当前 mdl_hash 与 built_mdl_hash，漂移则重建模。

    先经 :class:`IqdCli.get_current_mdl_hash` 取 WrenAI 当前部署 hash，与
    mis-iqd 记录的 ``built_mdl_hash`` 比对：不一致 ⇒ 置 ``stale_drift=true``；
    随后按 ``model`` 范围触发重建（重新派生完整 MDL 并部署），使平台基线重新收敛为权威。

    - 比对失败（WrenAI 不可达返回 None）→ 不判定漂移，仍尝试按 model 重建（恢复兜底）。
    - 重建走与 ``/enhance/sync(scope=model)`` 相同的 :class:`SyncCoordinator` 窗口。
    """
    from src.adapters.iqd_cli import IqdCli
    from src.adapters.iqd_config_client import IqdConfigClient
    from src.agent.mis_iqd.mcp_lifecycle import IqdMcpLifecycleService

    try:
        client = IqdConfigClient()
        status = await client.get_catalog_sync_status(req.connection_id)
        built_hash = status.get("mdl_hash") if isinstance(status, dict) else None
        # ⚠️ 多连接（方案 A）：必须传本连接的 project_dir —— 此前不传，远端拿不到 cwd →
        # `get_current_mdl_hash` 恒为 None → 漂移检测从未真正执行过（2026-09-28 复核发现）。
        cid = status.get("connection_id") or req.connection_id
        project_home = IqdMcpLifecycleService.project_home_of(cid) if cid else None
        current = await IqdCli().get_current_mdl_hash(project_dir=project_home)
        # 漂移判定：能取到双方 hash 且不一致 ⇒ 标记 stale_drift
        if current is not None and built_hash is not None and current != built_hash:
            await client.set_stale_drift(status.get("connection_id") or req.connection_id, True)
            logger.info(
                "IQD external drift detected",
                built=built_hash,
                current=current,
            )
        # 按 model 范围触发重建（收敛平台基线为权威）
        coordinator = SyncCoordinator()
        result: SyncResult = await coordinator.trigger(req.connection_id, req.wait, "model")
        return success(
            data=result.model_dump(),
            message="reconcile accepted" if not req.wait else "ok",
            trace_id=trace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD enhance_reconcile failed", error=str(exc))
        return error_response(
            code=9000,
            message=str(exc),
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )
