"""端用户 Skill 权限码解析器（T03 spec §2.1）。

从 **mis-admin-bff** 拉取端用户权限码集合，并以 Redis 缓存
``mis:acl:skillperm:{userId}``（TTL 300s）加速。缓存键与 Java 侧
``SkillPermissionChecker`` **逐字节对齐**，两语言共享同一份缓存。

**fail-closed 语义（§4.2 规则 2 / §8.3）**：

- 超时 / 连接拒绝 / 非 2xx / 解析异常 → 抛 :class:`PermissionUnavailable`，
  **绝不返回空集合当作「拉到了但没权限」，更不 fallback 到放行**。
- 空集合是**合法结果**（该用户确实没有任何码）→ 缓存 300s 防穿透，
  由 :class:`~src.skills.acl.SkillAclGuard` 判 ``contains`` 失败后拒绝。
- **源失败不写缓存**：避免把「一次抖动」钉死成 300s 的拒绝或放行。
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import redis.asyncio as aioredis

from src.config import Settings, get_settings
from src.utils.logging import get_logger

logger = get_logger("identity.mis_permission_resolver")

__all__ = [
    "PermissionUnavailable",
    "MisPermissionResolver",
    "get_mis_permission_resolver",
    "reset_mis_permission_resolver",
]


class PermissionUnavailable(Exception):
    """权限源（Redis 未命中且 BFF 不可达 / 响应不可解析）不可用。

    **只代表「源不可用」**，不代表「无权限」。
    :class:`~src.skills.acl.SkillAclGuard` 捕获后转
    ``SkillAclDenied(code="AI_ACL_UNAVAILABLE")``，最终仍是**拒绝**。
    """

    def __init__(self, reason: str, user_id: int | str = "", cause: str = "") -> None:
        """记录不可用原因与关联用户，便于运维定位。

        Args:
            reason: 人类可读的失败原因。
            user_id: 触发本次解析的 MIS userId。
            cause: 底层异常类型名或 HTTP 状态码。
        """
        self.reason = reason
        self.user_id = user_id
        self.cause = cause
        super().__init__(f"{reason} (user_id={user_id}, cause={cause})" if cause else reason)


def _parse_codes(payload: Any) -> set[str] | None:
    """从 BFF 响应体解析权限码集合。

    兼容三种形态：

    - ``{"code":0,"data":{"codes":[...]}}`` / ``{"data":{"permissionCodes":[...]}}``
    - ``{"codes":[...]}`` / ``{"permissionCodes":[...]}``（无 envelope）
    - ``{"data":[...]}`` / ``[...]``（裸数组）

    Args:
        payload: 已 ``json()`` 反序列化的响应体。

    Returns:
        权限码集合（可能为空集）；结构无法识别时返回 ``None``（调用方转不可用）。
    """
    node: Any = payload
    if isinstance(node, dict) and "data" in node:
        node = node.get("data")

    if isinstance(node, dict):
        raw: Any = node.get("codes")
        if raw is None:
            raw = node.get("permissionCodes")
        if raw is None:
            raw = node.get("permission_codes")
    else:
        raw = node

    if raw is None:
        return None
    if not isinstance(raw, (list, tuple, set)):
        return None
    # 权限码**原样保留**：不 lower、不转义、不改写（#1 裁定，跨语言逐字节一致）。
    return {str(item).strip() for item in raw if str(item).strip()}


class MisPermissionResolver:
    """端用户权限码解析器：Redis 缓存 + mis-admin-bff 回源。"""

    def __init__(
        self,
        settings: Settings | None = None,
        redis_client: aioredis.Redis | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        """构造解析器（Redis / HTTP 客户端均可注入，便于单测替身）。

        Args:
            settings: 平台配置；省略时取全局单例。
            redis_client: 已建立的异步 Redis 客户端；省略时懒创建。
            http_client: 已建立的 httpx 异步客户端；省略时每次请求现开现关。
        """
        self._settings: Settings = settings or get_settings()
        self._redis: aioredis.Redis | None = redis_client
        self._http: httpx.AsyncClient | None = http_client
        self._ttl: int = int(getattr(self._settings, "MIS_ACL_CACHE_TTL", 300) or 300)
        self._key_prefix: str = str(
            getattr(self._settings, "MIS_ACL_CACHE_KEY_PREFIX", "mis:acl:skillperm:")
            or "mis:acl:skillperm:"
        )

    # ------------------------------------------------------------------
    # 基础设施
    # ------------------------------------------------------------------

    def cache_key(self, user_id: int | str) -> str:
        """返回权限码缓存 key（与 Java 侧同名，跨语言共享）。

        Args:
            user_id: MIS userId。

        Returns:
            形如 ``mis:acl:skillperm:1001`` 的 key。
        """
        return f"{self._key_prefix}{user_id}"

    async def _get_redis(self) -> aioredis.Redis | None:
        """懒创建 Redis 客户端；创建失败返回 ``None``（降级为「缓存未命中」）。"""
        if self._redis is not None:
            return self._redis
        try:
            self._redis = aioredis.from_url(
                self._settings.redis_url,
                max_connections=self._settings.REDIS_MAX_CONNECTIONS,
                decode_responses=True,
            )
        except Exception as exc:  # noqa: BLE001 - 缓存不可用不等于权限源不可用
            logger.warning(
                "ACL cache unavailable; falling back to BFF on every call",
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )
            self._redis = None
        return self._redis

    async def _cache_get(self, user_id: int | str) -> set[str] | None:
        """读缓存；未命中 / Redis 故障均返回 ``None``（视为未命中，继续回源）。"""
        redis: aioredis.Redis | None = await self._get_redis()
        if redis is None:
            return None
        try:
            raw: Any = await redis.get(self.cache_key(user_id))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "ACL cache read failed; treating as miss",
                user_id=user_id,
                error=str(exc),
            )
            return None
        if raw is None:
            return None
        try:
            items: Any = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            logger.warning("ACL cache payload corrupted; treating as miss", user_id=user_id)
            return None
        if not isinstance(items, list):
            return None
        # 空集合也是有效缓存（防穿透），此处如实返回 set()。
        return {str(item) for item in items}

    async def _cache_set(self, user_id: int | str, codes: set[str]) -> None:
        """写缓存（含空集合）；写失败仅告警，不影响本次判定。"""
        redis: aioredis.Redis | None = await self._get_redis()
        if redis is None:
            return
        try:
            await redis.setex(
                self.cache_key(user_id),
                self._ttl,
                json.dumps(sorted(codes), ensure_ascii=False),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ACL cache write failed", user_id=user_id, error=str(exc))

    def _build_headers(self, raw_jwt: str | None) -> dict[str, str]:
        """构造回源请求头。

        端用户 JWT 可用时透传 ``Authorization: Bearer``（BFF 据此识别端用户）；
        工具执行链路（E1–E5）无 JWT，改用平台 ↔ BFF 共享密钥
        ``X-Platform-Token`` 走反向信任（与 ``ReverseTrustInterceptor`` 对齐）。

        Args:
            raw_jwt: 原始 JWT（不含 ``Bearer `` 前缀）；可为 ``None``。

        Returns:
            HTTP 请求头字典。
        """
        headers: dict[str, str] = {"Accept": "application/json"}
        token: str = (raw_jwt or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        shared_secret: str = str(
            getattr(self._settings, "AI_PLATFORM_BFF_SHARED_SECRET", "") or ""
        ).strip()
        if shared_secret:
            headers["X-Platform-Token"] = shared_secret
        return headers

    async def _fetch_from_bff(
        self,
        user_id: int | str,
        app_id: str,
        raw_jwt: str | None,
    ) -> set[str]:
        """回源 mis-admin-bff 拉权限码。

        Args:
            user_id: MIS userId。
            app_id: 应用 ID（可为空串）。
            raw_jwt: 端用户原始 JWT（可为 ``None``）。

        Returns:
            权限码集合（可能为空集）。

        Raises:
            PermissionUnavailable: 超时 / 连接失败 / 非 2xx / 响应不可解析。
        """
        base: str = str(
            getattr(self._settings, "MIS_ADMIN_BFF_BASE_URL", "") or ""
        ).rstrip("/")
        path: str = str(
            getattr(self._settings, "MIS_ACL_PERMISSIONS_PATH", "/internal/permissions")
            or "/internal/permissions"
        )
        if not base:
            raise PermissionUnavailable(
                "MIS_ADMIN_BFF_BASE_URL 未配置，无法解析权限码", user_id, "config_missing"
            )

        url: str = f"{base}{path if path.startswith('/') else '/' + path}"
        params: dict[str, str] = {"userId": str(user_id)}
        if app_id:
            params["appId"] = app_id
        timeout: float = float(getattr(self._settings, "MIS_ACL_HTTP_TIMEOUT", 3.0) or 3.0)
        headers: dict[str, str] = self._build_headers(raw_jwt)

        try:
            if self._http is not None:
                response: httpx.Response = await self._http.get(
                    url, params=params, headers=headers, timeout=timeout
                )
            else:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.get(url, params=params, headers=headers)
        except httpx.TimeoutException as exc:
            raise PermissionUnavailable(
                "权限源请求超时", user_id, exc.__class__.__name__
            ) from exc
        except httpx.HTTPError as exc:
            raise PermissionUnavailable(
                "权限源连接失败", user_id, exc.__class__.__name__
            ) from exc
        except Exception as exc:  # noqa: BLE001 - 任何意外都必须 fail-closed
            raise PermissionUnavailable(
                "权限源请求异常", user_id, exc.__class__.__name__
            ) from exc

        if response.status_code < 200 or response.status_code >= 300:
            raise PermissionUnavailable(
                "权限源返回非 2xx", user_id, f"HTTP {response.status_code}"
            )

        try:
            payload: Any = response.json()
        except Exception as exc:  # noqa: BLE001
            raise PermissionUnavailable(
                "权限源响应非 JSON", user_id, exc.__class__.__name__
            ) from exc

        codes: set[str] | None = _parse_codes(payload)
        if codes is None:
            raise PermissionUnavailable(
                "权限源响应结构无法解析（缺 data.codes / data.permissionCodes）",
                user_id,
                "schema_mismatch",
            )
        return codes

    # ------------------------------------------------------------------
    # 对外 API
    # ------------------------------------------------------------------

    async def resolve(
        self,
        user_id: int | str,
        app_id: str = "",
        raw_jwt: str | None = None,
    ) -> set[str]:
        """解析端用户权限码集合（先查缓存，未命中回源 BFF）。

        Args:
            user_id: **MIS userId**（不是 employeeId / 企微 userid）。
            app_id: 应用 ID；省略时取 ``MIS_ACL_DEFAULT_APP_ID``。
            raw_jwt: 端用户原始 JWT（不含 ``Bearer `` 前缀）。

        Returns:
            权限码集合，**可能为空集**（= 该用户无任何码 → 调用方拒绝）。

        Raises:
            PermissionUnavailable: 权限源不可达 / 不可解析（→ fail-closed 拒绝）。
        """
        if user_id in (None, "", 0):
            # 无身份不该走到这里；真走到了也必须视为源不可用而非「空集」。
            raise PermissionUnavailable("缺少 MIS userId，无法解析权限码", user_id or "", "no_identity")

        cached: set[str] | None = await self._cache_get(user_id)
        if cached is not None:
            logger.debug("ACL cache hit", user_id=user_id, code_count=len(cached))
            return cached

        effective_app_id: str = app_id or str(
            getattr(self._settings, "MIS_ACL_DEFAULT_APP_ID", "") or ""
        )
        codes: set[str] = await self._fetch_from_bff(user_id, effective_app_id, raw_jwt)
        # 仅成功路径写缓存（含空集合防穿透）；失败路径已在上面抛出，不落缓存。
        await self._cache_set(user_id, codes)
        logger.info(
            "ACL codes resolved from BFF",
            user_id=user_id,
            app_id=effective_app_id or None,
            code_count=len(codes),
        )
        return codes

    async def invalidate(self, user_id: int | str) -> None:
        """失效指定用户的权限码缓存（授权变更后由 BFF 主动调用，或依赖 TTL 自然过期）。

        Args:
            user_id: MIS userId。
        """
        redis: aioredis.Redis | None = await self._get_redis()
        if redis is None:
            return
        try:
            await redis.delete(self.cache_key(user_id))
            logger.info("ACL cache invalidated", user_id=user_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ACL cache invalidate failed", user_id=user_id, error=str(exc))


# ---------------------------------------------------------------------------
# 单例
# ---------------------------------------------------------------------------
_resolver: MisPermissionResolver | None = None


def get_mis_permission_resolver() -> MisPermissionResolver:
    """返回单例 :class:`MisPermissionResolver`（进程内复用 Redis 连接池）。"""
    global _resolver
    if _resolver is None:
        _resolver = MisPermissionResolver()
    return _resolver


def reset_mis_permission_resolver() -> None:
    """清空单例（仅供测试隔离使用）。"""
    global _resolver
    _resolver = None
