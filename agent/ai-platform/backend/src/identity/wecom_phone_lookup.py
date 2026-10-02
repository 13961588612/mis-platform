"""BFF 内部查询客户端 —— 按租户 + 手机号反查唯一 MIS 用户。

复用 :class:`~src.identity.mis_permission_resolver.MisPermissionResolver` 的
调用约定：``MIS_ADMIN_BFF_BASE_URL`` + 服务间共享密钥 ``X-Platform-Token``。
BFF 的 ``/internal/**`` 由 ``InternalServiceTrustInterceptor`` 强制鉴权，
绝不经外网暴露。

对应 BFF 端点（设计 §10）::

    GET /internal/wecom/user-by-phone?tenantId=<id>&phone=<phone>

返回语义是**精确一命中**：0 个或多个都视为未命中（``exact-one``）。
"""

from __future__ import annotations

import httpx
import structlog

from src.channels.wecom_binding_errors import PhoneLookupResult
from src.config import get_settings

logger = structlog.get_logger(__name__)

#: 默认查询路径，挂在 ``MIS_ADMIN_BFF_BASE_URL`` 之下。
DEFAULT_USER_BY_PHONE_PATH: str = "/internal/wecom/user-by-phone"


class BffWecomPhoneLookup:
    """调 BFF ``/internal/wecom/user-by-phone`` 的手机号反查实现。"""

    def __init__(self, path: str | None = None) -> None:
        """初始化。

        Args:
            path: 覆盖默认查询路径（测试用）。
        """
        self._path: str = path or DEFAULT_USER_BY_PHONE_PATH

    async def lookup(self, tenant_id: int, phone: str) -> PhoneLookupResult:
        """按租户 + 手机号查询唯一 MIS 用户；任何失败都 fail-closed。"""
        settings = get_settings()
        base: str = str(settings.MIS_ADMIN_BFF_BASE_URL or "").rstrip("/")
        if not base:
            return PhoneLookupResult(matched=False, reason="config_missing")
        secret: str = str(settings.AI_PLATFORM_BFF_SHARED_SECRET or "").strip()
        if not secret:
            logger.warning("Wecom phone lookup unavailable: shared secret not configured")
            return PhoneLookupResult(matched=False, reason="config_missing")
        url = f"{base}{self._path}"
        try:
            async with httpx.AsyncClient(timeout=settings.MIS_ACL_HTTP_TIMEOUT) as client:
                resp = await client.get(
                    url,
                    params={"tenantId": tenant_id, "phone": phone},
                    headers={"Accept": "application/json", "X-Platform-Token": secret},
                )
                resp.raise_for_status()
                body = resp.json()
        except Exception as exc:  # noqa: BLE001 - 一律 fail-closed
            logger.warning("Wecom phone lookup failed", error=str(exc))
            return PhoneLookupResult(matched=False, reason="error")

        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            return PhoneLookupResult(matched=False, reason="error")
        if not data.get("matched"):
            return PhoneLookupResult(
                matched=False, reason=str(data.get("reason") or "not_found")
            )
        user_id = data.get("user_id")
        if user_id is None:
            return PhoneLookupResult(matched=False, reason="error")
        try:
            return PhoneLookupResult(
                matched=True,
                user_id=int(user_id),
                username=str(data.get("username") or "") or None,
            )
        except (TypeError, ValueError):
            return PhoneLookupResult(matched=False, reason="error")
