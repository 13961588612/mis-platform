"""渠道管理 API 路由 —— 企业微信多 Bot（T04 O1f / UI#3，端点 #48–#54）。

路由前缀 ``/channels``，在 :mod:`src.main` 中以 ``prefix="/api/v1"`` 注册，
最终实际路径为 ``/api/v1/channels/wecom/bots**``。BFF 侧
``/api/v1/agent-ops/channels/wecom/**`` 透明转发到这里（不做 key 转换）。

端点对照（impl-plan §7 端点台账）：

===== ======================================================= ==================
  #   路径                                                    权限码
===== ======================================================= ==================
 48   ``GET    /channels/wecom/bots``                          ``agent:wecom:list``
 49   ``POST   /channels/wecom/bots``                          ``agent:wecom:manage``
 50   ``PUT    /channels/wecom/bots/{bot_id}``                  ``agent:wecom:manage``
 51   ``DELETE /channels/wecom/bots/{bot_id}``                  ``agent:wecom:manage``
 52   ``POST   /channels/wecom/bots/{bot_id}/enable``           ``agent:wecom:manage``
 53   ``POST   /channels/wecom/bots/{bot_id}/disable``          ``agent:wecom:manage``
 54   ``GET    /channels/wecom/bots/health``                    ``agent:wecom:list``
===== ======================================================= ==================

**鉴权**：与 #22–#24（``agent_config_files.py``）保持一致，本批次只挂
:func:`~src.api.deps.get_current_user`（登录即可，MIS RS256 / 平台 HS256 双验签）；
T03 的 :func:`~src.api.deps.require_ops_permission` fail-closed 权限闸门由 T03
批次统一叠加，不在这里重复实现，避免两批人各写一份判权逻辑。

**路由顺序**：``/wecom/bots/health`` 必须声明在 ``/wecom/bots/{bot_id}`` **之前**，
否则 FastAPI 会把字面量 ``health`` 当成 ``bot_id`` 捕获（经典坑）。

**wire 契约**：响应体一律 snake_case（``bot_id`` / ``bot_secret_id`` / ``secret_masked``
/ ``bound_agent_id`` / ``health``），与 ``features/agent/types.ts`` 的
``WecomBot`` 逐字段对齐。``#48`` 返回**扁平数组**（不是 ``AgentPage``），
``#54`` 返回 ``Record<bot_id, health>``，均以前端
``agent-ops-api.ts`` 的实际签名为准。
"""

from __future__ import annotations

from typing import Any

import hmac
from fastapi import APIRouter, Depends, Header, Path as PathParam, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.response import error_response, success
from src.channels.models import WecomBotCreateRequest, WecomBotRecord, WecomBotUpdateRequest
from src.channels.wecom_binding_service import WecomUserBindingService
from src.channels.wecom_corp_secret_service import WecomCorpSecretService
from src.channels.wecom_corp_store import (
    WecomCorpCreateRequest,
    WecomCorpUpdateRequest,
    get_wecom_corp_store,
)
from src.channels.wecom_bot_store import (
    WecomBotConflictError,
    WecomBotNotFoundError,
    WecomBotStore,
    get_wecom_bot_store,
)
from src.config import get_settings
from src.db.session import get_db_session
from src.utils.exceptions import AIPlatformError
from src.utils.logging import get_logger

logger = get_logger("api.routes.channels")

router = APIRouter(prefix="/channels", tags=["channels"])


def get_wecom_bot_store_dep() -> WecomBotStore:
    """提供单例 :class:`WecomBotStore`（便于测试用 ``dependency_overrides`` 替换）。"""
    return get_wecom_bot_store()


def _store_error_to_response(exc: Exception) -> JSONResponse:
    """把 Store 层异常统一映射为响应信封。

    Args:
        exc: Store 或底层抛出的异常。

    Returns:
        对应 HTTP 状态与错误码的 ``JSONResponse``。
    """
    if isinstance(exc, WecomBotNotFoundError):
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    if isinstance(exc, WecomBotConflictError):
        return error_response(exc.code, exc.message, status.HTTP_409_CONFLICT)
    if isinstance(exc, AIPlatformError):
        return error_response(exc.code, exc.message, status.HTTP_500_INTERNAL_SERVER_ERROR)
    return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


# ===========================================================================
# #54 GET /channels/wecom/bots/health —— 必须在 /{bot_id} 之前声明
# ===========================================================================


@router.get("/wecom/bots/health")
async def get_wecom_bots_health(
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#54 查询所有企微 Bot 的运行时健康状态。

    健康状态由 Gateway ``/admin/bots/health`` 提供（backend 不持有 WS 连接）。
    Gateway 不可达时启用中的 Bot 降级为 ``unknown``，停用的 Bot 直接判
    ``disconnected``，**不会 500**（运营台列表必须始终可打开）。

    Returns:
        ``{code:0, data:{bot_id: 'connected'|'disconnected'|'unknown'}}``，
        与前端 ``getWecomBotsHealth(): Record<string, WecomBot['health']>`` 对齐。
    """
    try:
        health: dict[str, str] = await store.fetch_health_map()
        return success(data=health)
    except Exception as exc:  # noqa: BLE001 - 健康查询绝不打断运营台
        logger.error("Failed to fetch wecom bots health", error=str(exc))
        return success(data={}, message="health unavailable")


# ===========================================================================
# Gateway 专用：运行时清单（含明文 secret）—— 同样必须在 /{bot_id} 之前
# ===========================================================================


@router.get("/wecom/bots/runtime")
async def list_wecom_bots_runtime(
    enabled: bool = Query(default=True, description="只返回启用中的 Bot（Gateway 默认 true）"),
    x_internal_token: str = Header(default="", alias="X-Internal-Token"),
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
) -> dict[str, Any]:
    """Gateway 启动拉取用的**运行时清单**（含明文 ``secret``）。

    为什么单独开一个端点而不是给 #48 加 ``include_secret`` 开关：#48 是运营台
    端点，任何登录用户都能调；一旦加开关，明文密钥的暴露面就等于「所有登录
    用户」。这里改用**服务间共享令牌**闸门，与用户身份体系完全隔离。

    安全约束：

    * ``GATEWAY_INTERNAL_TOKEN`` 未配置 ⇒ 直接 503（**fail-closed**），
      Gateway 会自动降级为 ``WECOM_BOT_*`` 环境变量单 Bot 模式。
    * 令牌比对用 :func:`hmac.compare_digest`，避免时序侧信道。
    * 响应**永不落日志**（只记条数）。

    Args:
        enabled: 是否只返回启用中的 Bot。
        x_internal_token: ``X-Internal-Token`` 头。
        store: Bot 配置存储。

    Returns:
        ``{code:0, data:[{bot_id, name, enabled, bot_secret_id, secret, bound_agent_id}]}``。
    """
    expected: str = get_settings().GATEWAY_INTERNAL_TOKEN
    if not expected:
        logger.warning(
            "Gateway runtime endpoint disabled: GATEWAY_INTERNAL_TOKEN not configured"
        )
        return error_response(
            5003,
            "Gateway internal token not configured; runtime bot list is disabled",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        logger.warning("Gateway runtime endpoint rejected: bad internal token")
        return error_response(1003, "Invalid internal token", status.HTTP_403_FORBIDDEN)

    try:
        records: list[WecomBotRecord] = store.list_records(enabled_only=enabled)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to list wecom bots for gateway", error=str(exc))
        return _store_error_to_response(exc)

    payload: list[dict[str, Any]] = [
        {
            "bot_id": r.bot_id,
            "name": r.name,
            "enabled": r.enabled,
            "bot_secret_id": r.bot_secret_id,
            "secret": r.secret,
            "bound_agent_id": r.bound_agent_id,
            "corp_id": r.corp_id,
            "tenant_id": r.tenant_id,
        }
        for r in records
    ]
    # 只记条数，绝不记内容（含明文 secret）。
    logger.info("Gateway runtime bot list served", count=len(payload), enabled_only=enabled)
    return success(data=payload)


# ===========================================================================
# #48 GET /channels/wecom/bots
# ===========================================================================


@router.get("/wecom/bots")
async def list_wecom_bots(
    enabled: bool | None = Query(
        default=None,
        description="只返回启用/停用的 Bot；缺省返回全部。Gateway 启动拉取用 enabled=true",
    ),
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#48 列出全部企微 Bot（secret 脱敏，含运行时 health）。

    返回**扁平数组**而非 ``AgentPage``：前端
    ``listWecomBots(): Promise<WecomBot[]>`` 直接 ``unwrap`` 成数组，
    包成分页对象会让页面拿到 ``undefined.map``。

    Args:
        enabled: 可选过滤；Gateway 启动时以 ``?enabled=true`` 拉取待启动清单。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        ``{code:0, data: WecomBot[]}``。
    """
    try:
        if enabled is None:
            bots: list[dict[str, Any]] = await store.list_wire(enabled_only=False)
        elif enabled:
            bots = await store.list_wire(enabled_only=True)
        else:
            # enabled=false：取全量后筛出停用项（Store 只支持 enabled_only 正向过滤）。
            all_bots: list[dict[str, Any]] = await store.list_wire(enabled_only=False)
            bots = [b for b in all_bots if not b.get("enabled", False)]
        return success(data=bots)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to list wecom bots", error=str(exc))
        return _store_error_to_response(exc)


# ===========================================================================
# #49 POST /channels/wecom/bots
# ===========================================================================


@router.post("/wecom/bots", status_code=status.HTTP_200_OK)
async def create_wecom_bot(
    req: WecomBotCreateRequest,
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#49 新建一个企微 Bot。

    新建的 Bot 默认 ``enabled=true``；``bot_id`` 由后端生成（前端不传）。
    落盘后**需要重启 Gateway 才生效**（O1f-1 只做启动时拉取，热重载 O1f-2
    本期不做），前端页面已常驻该提示横幅。

    Args:
        req: 创建请求体（对应前端 ``WecomBotPayload``）。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        ``{code:0, data: WecomBot}``（新建记录，health 恒为 ``unknown``）。
    """
    try:
        record: WecomBotRecord = await store.create(req)
        logger.info(
            "WeCom bot created",
            bot_id=record.bot_id,
            name=record.name,
            operator=user.get("user_id", ""),
        )
        # 刚创建的 Bot 一定还没被 Gateway 拉起，health 直接给 unknown，
        # 省掉一次必然超时的 Gateway 往返。
        return success(data=record.to_wire(health="unknown"), message="WeCom bot created")
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to create wecom bot", error=str(exc))
        return _store_error_to_response(exc)


# ===========================================================================
# #50 PUT /channels/wecom/bots/{bot_id}
# ===========================================================================


@router.put("/wecom/bots/{bot_id}")
async def update_wecom_bot(
    req: WecomBotUpdateRequest,
    bot_id: str = PathParam(..., description="Bot ID"),
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#50 更新一个企微 Bot。

    ``secret`` 缺省或空串 = **不修改**（前端不勾选「更换 Secret」时根本不发送
    该字段）；需要清空必须显式传 ``secret_clear=true``。

    Args:
        req: 更新请求体。
        bot_id: 目标 Bot ID。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        ``{code:0, data: WecomBot}``（更新后的记录）。
    """
    try:
        record: WecomBotRecord = await store.update(bot_id, req)
        logger.info(
            "WeCom bot updated",
            bot_id=bot_id,
            operator=user.get("user_id", ""),
            secret_changed=bool(req.secret) or req.secret_clear,
        )
        health: dict[str, str] = await store.fetch_health_map()
        return success(
            data=record.to_wire(health=health.get(bot_id, "unknown")),
            message="WeCom bot updated",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to update wecom bot", bot_id=bot_id, error=str(exc))
        return _store_error_to_response(exc)


# ===========================================================================
# #51 DELETE /channels/wecom/bots/{bot_id}
# ===========================================================================


@router.delete("/wecom/bots/{bot_id}")
async def delete_wecom_bot(
    bot_id: str = PathParam(..., description="Bot ID"),
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#51 删除一个企微 Bot（幂等：不存在也返回成功）。

    Args:
        bot_id: 目标 Bot ID。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        ``{code:0, data:{bot_id, deleted}}``。
    """
    try:
        deleted: bool = await store.delete(bot_id)
        logger.info(
            "WeCom bot deleted",
            bot_id=bot_id,
            deleted=deleted,
            operator=user.get("user_id", ""),
        )
        return success(
            data={"bot_id": bot_id, "deleted": deleted},
            message="WeCom bot deleted" if deleted else "WeCom bot not found (idempotent)",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to delete wecom bot", bot_id=bot_id, error=str(exc))
        return _store_error_to_response(exc)


# ===========================================================================
# #52 / #53 启停
# ===========================================================================


@router.post("/wecom/bots/{bot_id}/enable")
async def enable_wecom_bot(
    bot_id: str = PathParam(..., description="Bot ID"),
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#52 启用一个企微 Bot（幂等）。

    Args:
        bot_id: 目标 Bot ID。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        ``{code:0, data: WecomBot}``。
    """
    return await _set_enabled(bot_id, True, store, user)


@router.post("/wecom/bots/{bot_id}/disable")
async def disable_wecom_bot(
    bot_id: str = PathParam(..., description="Bot ID"),
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#53 停用一个企微 Bot（幂等）。

    停用后 Gateway 重启时不再为它创建 ``WecomBotAdapter`` 实例，
    满足 B4 验收「≥2 个 Bot 并存、可独立停用」。

    Args:
        bot_id: 目标 Bot ID。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        ``{code:0, data: WecomBot}``。
    """
    return await _set_enabled(bot_id, False, store, user)


async def _set_enabled(
    bot_id: str,
    enabled: bool,
    store: WecomBotStore,
    user: dict[str, Any],
) -> dict[str, Any]:
    """#52 / #53 的公共实现。

    Args:
        bot_id: 目标 Bot ID。
        enabled: 目标状态。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        统一响应信封。
    """
    try:
        record: WecomBotRecord = await store.set_enabled(bot_id, enabled)
        logger.info(
            "WeCom bot enabled state changed",
            bot_id=bot_id,
            enabled=enabled,
            operator=user.get("user_id", ""),
        )
        if not enabled:
            return success(data=record.to_wire(health="disconnected"), message="WeCom bot disabled")
        health: dict[str, str] = await store.fetch_health_map()
        return success(
            data=record.to_wire(health=health.get(bot_id, "unknown")),
            message="WeCom bot enabled",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Failed to change wecom bot enabled state",
            bot_id=bot_id,
            enabled=enabled,
            error=str(exc),
        )
        return _store_error_to_response(exc)


# ===========================================================================
# 附加：单条查询（前端未用，供 BFF / 排障使用；声明在 health 之后不会抢路由）
# ===========================================================================


@router.get("/wecom/bots/{bot_id}")
async def get_wecom_bot(
    bot_id: str = PathParam(..., description="Bot ID"),
    store: WecomBotStore = Depends(get_wecom_bot_store_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """查询单个企微 Bot（secret 脱敏）。

    Args:
        bot_id: 目标 Bot ID。
        store: Bot 配置存储。
        user: 已认证身份。

    Returns:
        ``{code:0, data: WecomBot}``。
    """
    try:
        return success(data=await store.get_wire(bot_id))
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get wecom bot", bot_id=bot_id, error=str(exc))
        return _store_error_to_response(exc)
# ===========================================================================
# 企微用户身份绑定（wecom-user-binding-design.md §11）—— 运营台子页
#
# endpoints:
#   59 GET    /channels/wecom/users                              agent:wecom:user:list
#   60 POST   /channels/wecom/users/{corp_id}/{wecom_user_id}/bind    agent:wecom:user:manage
#   61 POST   /channels/wecom/users/{corp_id}/{wecom_user_id}/unbind  agent:wecom:user:manage
#   62 POST   /channels/wecom/users/{corp_id}/{wecom_user_id}/verify  agent:wecom:user:manage
#
# 说明：BFF 侧路径是 /api/v1/agent-ops/channels/wecom/users**，透明透传到本文件
# （不加 /admin 段，与 #48–#54 同款）。绑定事实落 ai_platform 库的
# wecom_identity_bindings 表；解绑 = 置 disabled（保留审计），不物理删除。
# ===========================================================================


def _binding_error_to_response(exc: Exception) -> JSONResponse:
    """把绑定域异常映射为响应信封（统一 500，交由前端提示）。"""
    logger.error("WeCom binding operation failed", error=str(exc))
    return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/wecom/users")
async def list_wecom_bindings(
    corp_id: str | None = Query(default=None, description="按 corp 过滤"),
    tenant_id: int | None = Query(default=None, description="按租户过滤"),
    status_filter: str | None = Query(
        default=None, alias="status", description="active / disabled"
    ),
    keyword: str | None = Query(default=None, description="userid 或 mis_user_id 模糊匹配"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#59 绑定列表（运营台「企微用户绑定」子页）。

    Returns:
        ``{code:0, data:{items:[...], total, page, page_size}}``，每项含
        ``corp_id / wecom_user_id / tenant_id / mis_user_id / bind_source /
        status / phone_masked / last_verified_at``（**不含明文手机号**）。
    """
    try:
        rows, total = await WecomUserBindingService().list_bindings(
            db,
            corp_id=(corp_id or "").strip(),
            tenant_id=tenant_id,
            status=(status_filter or "").strip(),
            keyword=(keyword or "").strip(),
            limit=page_size,
            offset=(page - 1) * page_size,
        )
        return success(
            data={
                "items": [r.to_dict() for r in rows],
                "total": total,
                "page": page,
                "page_size": page_size,
            }
        )
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)


class WecomBindingBindRequest(BaseModel):
    """#60 人工绑定请求体。"""

    tenant_id: int = Field(..., description="MIS 租户 ID")
    mis_user_id: int = Field(..., description="MIS 用户 ID（权限主体）")
    phone: str = Field(default="", max_length=32, description="手机号（可选，仅存哈希）")


@router.post("/wecom/users/{corp_id}/{wecom_user_id}/bind")
async def bind_wecom_user(
    req: WecomBindingBindRequest,
    corp_id: str = PathParam(..., description="企微企业 ID"),
    wecom_user_id: str = PathParam(..., description="企微成员 userid"),
    db: AsyncSession = Depends(get_db_session),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#60 人工绑定：创建或覆盖为 ``manual`` 来源（优先级最高）。"""
    try:
        binding = await WecomUserBindingService().manual_bind(
            db,
            corp_id=corp_id.strip(),
            wecom_user_id=wecom_user_id.strip(),
            tenant_id=int(req.tenant_id),
            mis_user_id=int(req.mis_user_id),
            phone=(req.phone or "").strip(),
        )
        logger.info(
            "WeCom identity manually bound",
            corp_id=corp_id,
            wecom_user_id=wecom_user_id,
            mis_user_id=req.mis_user_id,
            operator=user.get("user_id", ""),
        )
        return success(data=binding.to_dict(), message="WeCom user bound")
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)


@router.post("/wecom/users/{corp_id}/{wecom_user_id}/unbind")
async def unbind_wecom_user(
    corp_id: str = PathParam(..., description="企微企业 ID"),
    wecom_user_id: str = PathParam(..., description="企微成员 userid"),
    db: AsyncSession = Depends(get_db_session),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#61 解绑：置 ``disabled``（保留审计），后续不做自动重生。"""
    try:
        ok = await WecomUserBindingService().unbind(
            db, corp_id=corp_id.strip(), wecom_user_id=wecom_user_id.strip()
        )
        logger.info(
            "WeCom identity unbound",
            corp_id=corp_id,
            wecom_user_id=wecom_user_id,
            found=ok,
            operator=user.get("user_id", ""),
        )
        return success(
            data={"corp_id": corp_id, "wecom_user_id": wecom_user_id, "unbound": ok},
            message="WeCom user unbound" if ok else "WeCom binding not found (idempotent)",
        )
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)


@router.post("/wecom/users/{corp_id}/{wecom_user_id}/verify")
async def verify_wecom_user(
    corp_id: str = PathParam(..., description="企微企业 ID"),
    wecom_user_id: str = PathParam(..., description="企微成员 userid"),
    db: AsyncSession = Depends(get_db_session),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#62 校验：刷新 ``last_verified_at``（人工确认绑定仍有效）。"""
    try:
        binding = await WecomUserBindingService().verify(
            db, corp_id=corp_id.strip(), wecom_user_id=wecom_user_id.strip()
        )
        if binding is None:
            return error_response(4040, "绑定不存在", status.HTTP_404_NOT_FOUND)
        return success(data=binding.to_dict(), message="WeCom binding verified")
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)
@router.post("/wecom/users/sync-backfill")
async def sync_backfill_wecom_bindings(
    corp_id: str | None = Query(default=None, description="限定单个 corp；缺省=全部已配置 corp"),
    db: AsyncSession = Depends(get_db_session),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#63 P5 同步回填：按通讯录批量发现未绑定用户并落 ``sync`` 绑定。

    规则与首次入站自动绑定完全一致：**只对未绑定用户、手机号 exact-one**
    才写绑定；绝不覆盖 ``manual`` / ``disabled``，也不为 0 个 / 多个命中建立绑定。

    Returns:
        ``{code:0, data:{corps:[{corp_id, entries, bound, skipped, conflict, unmatched}]}}``。
    """
    from src.channels.wecom_contacts_client import WecomContactsClient
    from src.channels.wecom_corp_store import get_wecom_corp_store

    try:
        corp_store = get_wecom_corp_store()
        corp_filter = (corp_id or "").strip()
        corps = [
            c
            for c in corp_store.list_corps()
            if not corp_filter or c.corp_id == corp_filter
        ]
        contacts = WecomContactsClient()
        service = WecomUserBindingService()
        reports: list[dict[str, Any]] = []
        for corp in corps:
            entries = await contacts.list_all_users(corp.corp_id)
            stats = await service.backfill_from_entries(
                db,
                corp_id=corp.corp_id,
                tenant_id=corp.tenant_id,
                entries=entries,
            )
            reports.append(
                {
                    "corp_id": corp.corp_id,
                    "entries": len(entries),
                    **stats,
                }
            )
        logger.info(
            "WeCom binding sync backfill completed",
            corps=len(reports),
            operator=user.get("user_id", ""),
        )
        return success(data={"corps": reports})
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)
# ===========================================================================
# 企微企业配置（方案 B）—— 运营台管「企业清单 + 密钥」
#
#   #64 GET    /channels/wecom/corps                        agent:wecom:manage
#   #65 POST   /channels/wecom/corps                        agent:wecom:manage
#   #66 PUT    /channels/wecom/corps/{corp_id}              agent:wecom:manage
#   #67 DELETE /channels/wecom/corps/{corp_id}              agent:wecom:manage
#   #68 PUT    /channels/wecom/corps/{corp_id}/secret       agent:wecom:manage
#   #69 DELETE /channels/wecom/corps/{corp_id}/secret       agent:wecom:manage
#   #70 POST   /channels/wecom/corps/{corp_id}/test         agent:wecom:manage
#
# 企业清单落 configs/channels/wecom-corps.yaml（corp_id/tenant_id/绑定模式）；
# corpsecret 加密落 ai_platform.credential_mappings，YAML 只存 secret:// 引用。
# 明文 corpsecret 永不回传、永不入日志。
# ===========================================================================


class WecomCorpSecretRequest(BaseModel):
    """#68 写入 corpsecret 请求体。"""

    corpsecret: str = Field(..., min_length=1, max_length=512, description="企微应用 corpsecret")


@router.get("/wecom/corps")
async def list_wecom_corps(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#64 列出全部企业配置（含密钥配置状态，不含明文）。"""
    try:
        store = get_wecom_corp_store()
        records = store.list_corps()
        flags = await WecomCorpSecretService().configured_map([r.corp_id for r in records])
        return success(data=store.list_wire(secret_configured=flags))
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)


@router.post("/wecom/corps")
async def create_wecom_corp(
    req: WecomCorpCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#65 新增企业条目（corpsecret 另经 #68 单独配置）。"""
    try:
        record = await get_wecom_corp_store().create(req)
        logger.info(
            "WeCom corp created", corp_id=record.corp_id, operator=user.get("user_id", "")
        )
        return success(
            data={
                "corp_id": record.corp_id,
                "tenant_id": record.tenant_id,
                "name": record.name,
                "secret_ref": record.secret_ref,
                "secret_ref_kind": "vault",
                "secret_configured": False,
                "user_bind_mode": record.user_bind_mode,
            },
            message="WeCom corp created",
        )
    except Exception as exc:  # noqa: BLE001
        return _store_error_to_response(exc)


@router.put("/wecom/corps/{corp_id}")
async def update_wecom_corp(
    req: WecomCorpUpdateRequest,
    corp_id: str = PathParam(..., description="企微企业 ID"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#66 更新企业条目（tenant / name / 绑定模式；缺省字段不修改）。"""
    try:
        record = await get_wecom_corp_store().update(corp_id, req)
        flags = await WecomCorpSecretService().configured_map([record.corp_id])
        return success(
            data={
                "corp_id": record.corp_id,
                "tenant_id": record.tenant_id,
                "name": record.name,
                "secret_ref": record.secret_ref,
                "secret_configured": flags.get(record.corp_id, False),
                "user_bind_mode": record.user_bind_mode,
            },
            message="WeCom corp updated",
        )
    except Exception as exc:  # noqa: BLE001
        return _store_error_to_response(exc)


@router.delete("/wecom/corps/{corp_id}")
async def delete_wecom_corp(
    corp_id: str = PathParam(..., description="企微企业 ID"),
    delete_secret: bool = Query(default=False, description="同时删除已存的 corpsecret"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#67 删除企业条目（幂等）；``delete_secret=true`` 时一并清理密钥。"""
    try:
        deleted = await get_wecom_corp_store().delete(corp_id)
        secret_deleted = False
        if delete_secret:
            secret_deleted = await WecomCorpSecretService().delete_secret(corp_id)
        logger.info(
            "WeCom corp deleted",
            corp_id=corp_id,
            deleted=deleted,
            secret_deleted=secret_deleted,
            operator=user.get("user_id", ""),
        )
        return success(
            data={
                "corp_id": corp_id,
                "deleted": deleted,
                "secret_deleted": secret_deleted,
            },
            message="WeCom corp deleted" if deleted else "WeCom corp not found (idempotent)",
        )
    except Exception as exc:  # noqa: BLE001
        return _store_error_to_response(exc)


@router.put("/wecom/corps/{corp_id}/secret")
async def set_wecom_corp_secret(
    req: WecomCorpSecretRequest,
    corp_id: str = PathParam(..., description="企微企业 ID"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#68 写入 / 覆盖 corpsecret（明文只在请求体短暂存在，随即加密落库）。"""
    try:
        if get_wecom_corp_store().get(corp_id) is None:
            return error_response(4040, "企业配置不存在", status.HTTP_404_NOT_FOUND)
        await WecomCorpSecretService().set_secret(corp_id, req.corpsecret)
        logger.info(
            "WeCom corp secret updated", corp_id=corp_id, operator=user.get("user_id", "")
        )
        return success(
            data={"corp_id": corp_id, "secret_configured": True},
            message="WeCom corp secret stored",
        )
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)


@router.delete("/wecom/corps/{corp_id}/secret")
async def delete_wecom_corp_secret(
    corp_id: str = PathParam(..., description="企微企业 ID"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#69 删除 corpsecret（软删除，企业条目保留）。"""
    try:
        deleted = await WecomCorpSecretService().delete_secret(corp_id)
        return success(
            data={"corp_id": corp_id, "secret_deleted": deleted},
            message="WeCom corp secret deleted" if deleted else "secret not found (idempotent)",
        )
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)


@router.post("/wecom/corps/{corp_id}/test")
async def test_wecom_corp_connection(
    corp_id: str = PathParam(..., description="企微企业 ID"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """#70 连通性测试：用该 corp 的 corpsecret 换一次 access_token。"""
    try:
        record = get_wecom_corp_store().get(corp_id)
        if record is None:
            return error_response(4040, "企业配置不存在", status.HTTP_404_NOT_FOUND)
        from src.channels.wecom_contacts_client import WecomContactsClient

        client = WecomContactsClient()
        ok = await client.check_connection(corp_id)
        return success(
            data={"corp_id": corp_id, "ok": ok},
            message="corp connection ok" if ok else "corp secret invalid or unreachable",
        )
    except Exception as exc:  # noqa: BLE001
        return _binding_error_to_response(exc)
