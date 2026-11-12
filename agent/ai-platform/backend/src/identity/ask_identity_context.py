"""Copilot / iframe 入站问数身份：回源 BFF ask-context，不采信客户端 X-Mis-*。"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx
import redis.asyncio as aioredis

from src.config import Settings, get_settings
from src.utils.logging import get_logger

logger = get_logger("identity.ask_identity_context")

X_MIS_HEADER_KEYS: tuple[str, ...] = (
    "X-Mis-Roles",
    "X-Mis-Depts",
    "X-Mis-Orgs",
    "X-Mis-Dept-Scope",
    "X-Mis-Stores",
    "X-Mis-Data-Scope",
)

#: Gateway 验签后写入入站 metadata 的角色码列表（不可被客户端伪造冒充 X-Mis-*）。
#: enrich 在 BFF ask-context 失败/空角色时用它兜底，避免 Copilot→mis-iqd 变成
#: ``user_id 有值、role_codes=[]`` → 45204。
VERIFIED_ROLES_META_KEY: str = "verified_roles"

BIZ_CODE_UNAVAILABLE: str = "40303"

#: 用户可见错误码（前端 / 日志检索统一用这个串）。
USER_ERROR_CODE: str = "ASK_IDENTITY_UNAVAILABLE"

#: 用户可见文案（入站立刻提示并停住，不再进 LLM / Worker）。
USER_ERROR_MESSAGE: str = (
    "身份服务暂时不可用，无法确认您的数据权限，本次问答已停止。"
    "请稍后重试；若持续出现请联系管理员。"
    f"（错误码 {USER_ERROR_CODE}）"
)


class AskIdentityUnavailable(Exception):
    """BFF 问数身份源不可用（超时 / 非 2xx / 解析失败 / 最终无角色）。"""

    def __init__(self, reason: str, user_id: int | str = "", detail: str = "") -> None:
        super().__init__(reason)
        self.reason = reason
        self.user_id = user_id
        self.detail = detail

    def user_message(self) -> str:
        """返回可直接展示给终端用户的说明。"""
        return USER_ERROR_MESSAGE


def _settings() -> Settings:
    return get_settings()


def _cache_key(user_id: int | str, settings: Settings) -> str:
    prefix: str = str(
        getattr(settings, "MIS_ASK_IDENTITY_CACHE_KEY_PREFIX", "mis:acl:askident:")
        or "mis:acl:askident:"
    )
    return f"{prefix}{user_id}"


def strip_untrusted_ask_fields(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """丢弃 WS / iframe 客户端可能伪造的身份头与模拟角色。"""
    merged: dict[str, Any] = dict(metadata or {})
    for key in list(merged.keys()):
        if key in X_MIS_HEADER_KEYS or str(key).lower() in {k.lower() for k in X_MIS_HEADER_KEYS}:
            merged.pop(key, None)
    nested = merged.get("identity")
    if isinstance(nested, dict):
        identity = dict(nested)
        for key in list(identity.keys()):
            if key in X_MIS_HEADER_KEYS or str(key).lower() in {k.lower() for k in X_MIS_HEADER_KEYS}:
                identity.pop(key, None)
        merged["identity"] = identity
    iqd = merged.get("iqd")
    if isinstance(iqd, dict):
        cleaned = dict(iqd)
        cleaned.pop("simulate_role_code", None)
        merged["iqd"] = cleaned
    return merged


def _parse_headers_payload(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise AskIdentityUnavailable("身份源响应非对象")
    code = payload.get("code")
    if code not in (0, "0", None):
        if str(code) == BIZ_CODE_UNAVAILABLE:
            raise AskIdentityUnavailable("身份源不可用", detail=str(payload.get("message") or ""))
        raise AskIdentityUnavailable("身份源业务错误", detail=str(code))
    data = payload.get("data") if "data" in payload else payload
    if not isinstance(data, dict):
        raise AskIdentityUnavailable("身份源 data 非对象")
    raw_headers = data.get("headers")
    if not isinstance(raw_headers, dict):
        return {}
    out: dict[str, str] = {}
    for key in X_MIS_HEADER_KEYS:
        value = raw_headers.get(key)
        if isinstance(value, str) and value.strip():
            out[key] = value
        elif isinstance(value, (list, dict)):
            out[key] = json.dumps(value, ensure_ascii=False)
    return out


def _role_count(headers: dict[str, str]) -> int:
    raw = str(headers.get("X-Mis-Roles") or "").strip()
    if not raw:
        return 0
    try:
        parsed: Any = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return 1 if raw else 0
    if isinstance(parsed, list):
        return len(parsed)
    return 1


async def fetch_ask_identity_headers(
    user_id: int,
    *,
    http: httpx.AsyncClient | None = None,
    redis: aioredis.Redis | None = None,
    settings: Settings | None = None,
) -> dict[str, str]:
    """回源 BFF GET /internal/identity/ask-context。失败抛 AskIdentityUnavailable。"""
    cfg = settings or _settings()
    ttl: int = int(getattr(cfg, "MIS_ASK_IDENTITY_CACHE_TTL", 60) or 60)
    cache_redis = redis
    if cache_redis is not None:
        try:
            cached = await cache_redis.get(_cache_key(user_id, cfg))
            if isinstance(cached, str) and cached:
                parsed = json.loads(cached)
                if isinstance(parsed, dict):
                    cached_roles = str(parsed.get("X-Mis-Roles") or "").strip()
                    # 忽略历史空角色缓存（曾导致 Copilot 连续 45204）
                    if cached_roles:
                        logger.info(
                            "ask-identity cache hit",
                            event_code="ask_identity_cache_hit",
                            user_id=user_id,
                            role_count=_role_count(
                                {str(k): str(v) for k, v in parsed.items() if v}
                            ),
                        )
                        return {str(k): str(v) for k, v in parsed.items() if v}
        except Exception:  # noqa: BLE001
            logger.warning(
                "ask-identity cache read failed",
                event_code="ask_identity_cache_read_fail",
                user_id=user_id,
                exc_info=True,
            )

    base: str = str(getattr(cfg, "MIS_ADMIN_BFF_BASE_URL", "") or "").rstrip("/")
    path: str = str(
        getattr(cfg, "MIS_ASK_IDENTITY_PATH", "/internal/identity/ask-context")
        or "/internal/identity/ask-context"
    )
    if not base:
        logger.error(
            "ask-identity misconfigured",
            event_code="ask_identity_fetch_fail",
            user_id=user_id,
            reason="MIS_ADMIN_BFF_BASE_URL 未配置",
        )
        raise AskIdentityUnavailable("MIS_ADMIN_BFF_BASE_URL 未配置", user_id)
    url = f"{base}{path if path.startswith('/') else '/' + path}"
    secret: str = str(getattr(cfg, "AI_PLATFORM_BFF_SHARED_SECRET", "") or "").strip()
    headers: dict[str, str] = {"Accept": "application/json"}
    if secret:
        headers["X-Platform-Token"] = secret
    timeout: float = float(getattr(cfg, "MIS_ACL_HTTP_TIMEOUT", 3.0) or 3.0)

    t0 = time.perf_counter()
    try:
        if http is not None:
            response = await http.get(
                url, params={"userId": str(user_id)}, headers=headers, timeout=timeout
            )
        else:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(
                    url, params={"userId": str(user_id)}, headers=headers
                )
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        logger.error(
            "ask-identity fetch failed",
            event_code="ask_identity_fetch_fail",
            user_id=user_id,
            reason="身份源连接失败",
            detail=str(exc),
            bff_base=base,
            latency_ms=latency_ms,
            timeout_sec=timeout,
        )
        raise AskIdentityUnavailable("身份源连接失败", user_id, str(exc)) from exc

    latency_ms = int((time.perf_counter() - t0) * 1000)
    if response.status_code < 200 or response.status_code >= 300:
        detail = f"HTTP {response.status_code} {response.text[:200]}"
        logger.error(
            "ask-identity fetch failed",
            event_code="ask_identity_fetch_fail",
            user_id=user_id,
            reason="身份源非 2xx",
            detail=detail,
            bff_base=base,
            http_status=response.status_code,
            latency_ms=latency_ms,
        )
        raise AskIdentityUnavailable("身份源非 2xx", user_id, detail)
    try:
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "ask-identity fetch failed",
            event_code="ask_identity_fetch_fail",
            user_id=user_id,
            reason="身份源非 JSON",
            bff_base=base,
            latency_ms=latency_ms,
        )
        raise AskIdentityUnavailable("身份源非 JSON", user_id) from exc

    try:
        out = _parse_headers_payload(payload)
    except AskIdentityUnavailable as exc:
        logger.error(
            "ask-identity fetch failed",
            event_code="ask_identity_fetch_fail",
            user_id=user_id,
            reason=exc.reason,
            detail=exc.detail or None,
            bff_base=base,
            latency_ms=latency_ms,
        )
        raise

    # 空角色快照不缓存：否则 60s 内 Copilot 会持续以零授权问数 → 45204。
    roles_raw = str(out.get("X-Mis-Roles") or "").strip()
    role_count = _role_count(out)
    if cache_redis is not None and roles_raw:
        try:
            await cache_redis.setex(_cache_key(user_id, cfg), ttl, json.dumps(out, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            logger.warning(
                "ask-identity cache write failed",
                event_code="ask_identity_cache_write_fail",
                user_id=user_id,
                exc_info=True,
            )
    if roles_raw:
        logger.info(
            "ask-identity fetch ok",
            event_code="ask_identity_fetch_ok",
            user_id=user_id,
            role_count=role_count,
            bff_base=base,
            latency_ms=latency_ms,
            source="bff",
        )
    else:
        logger.warning(
            "ask-identity returned empty X-Mis-Roles",
            event_code="ask_identity_fetch_empty_roles",
            user_id=user_id,
            bff_base=base,
            latency_ms=latency_ms,
            source="bff",
        )
    return out


def _coerce_connection_id(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _hint_connection_id(metadata: dict[str, Any]) -> int | None:
    refs: list[Any] = [
        metadata.get("contextRef"),
        (metadata.get("page_context") or {}).get("contextRef")
        if isinstance(metadata.get("page_context"), dict)
        else None,
    ]
    iqd = metadata.get("iqd")
    if isinstance(iqd, dict):
        refs.append(iqd)
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        for key in ("connection_id", "connectionId"):
            cid = _coerce_connection_id(ref.get(key))
            if cid is not None:
                return cid
    return None


def _connection_row_enabled(row: dict[str, Any]) -> bool:
    """连接是否启用（缺省视为启用；显式 0/false/off 为停用）。"""
    flag = row.get("enabled", 1)
    if isinstance(flag, bool):
        return flag
    if flag in (0, "0", False):
        return False
    return str(flag).strip().lower() not in ("false", "no", "off")


async def _enabled_connection_ids() -> list[int]:
    """仅返回已启用问数连接 id（停用项目绝不进入 Copilot 默认/候选）。"""
    try:
        from src.adapters.iqd_config_client import IqdConfigClient

        rows = await IqdConfigClient().get_connections()
    except Exception:  # noqa: BLE001
        logger.warning("list IQD connections for default id failed", exc_info=True)
        return []
    enabled: list[int] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if not _connection_row_enabled(row):
            continue
        cid = _coerce_connection_id(row.get("id"))
        if cid is not None:
            enabled.append(cid)
    return enabled


async def inject_connection_id(metadata: dict[str, Any]) -> dict[str, Any]:
    """注入默认 / 校验过的 connection_id（hint 与当前值必须落在**启用**连接内）。

    停用项目一律剔除：过期 hint、会话里残留的停用 ``connection_id`` 都不会放行，
    回退到启用清单首条；若无任何启用连接则清除无效 id，交给下游 45201。
    """
    merged = dict(metadata)
    enabled = await _enabled_connection_ids()
    hint = _hint_connection_id(merged)
    iqd = dict(merged.get("iqd") or {}) if isinstance(merged.get("iqd"), dict) else {}
    current = _coerce_connection_id(iqd.get("connection_id"))
    chosen: int | None = None
    if current is not None and current in enabled:
        chosen = current
    elif hint is not None and hint in enabled:
        chosen = hint
    elif enabled:
        chosen = enabled[0]
    if chosen is not None:
        iqd["connection_id"] = chosen
    else:
        iqd.pop("connection_id", None)
    merged["iqd"] = iqd
    return merged


def _roles_header_from_verified(metadata: dict[str, Any]) -> str:
    """把 Gateway 验签写入的 ``verified_roles`` 收成 ``X-Mis-Roles`` JSON。"""
    raw = metadata.get(VERIFIED_ROLES_META_KEY)
    codes: list[str] = []
    if isinstance(raw, str) and raw.strip():
        try:
            parsed: Any = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            parsed = [p.strip() for p in raw.split(",") if p.strip()]
        if isinstance(parsed, list):
            raw = parsed
        else:
            raw = [raw.strip()]
    if isinstance(raw, (list, tuple, set)):
        for item in raw:
            if isinstance(item, str) and item.strip():
                codes.append(item.strip())
            elif isinstance(item, dict):
                code = item.get("code") or item.get("id")
                if code is not None and str(code).strip():
                    codes.append(str(code).strip())
    if not codes:
        return ""
    return json.dumps([{"code": code} for code in codes], ensure_ascii=False)


async def enrich_inbound_ask_identity(
    metadata: dict[str, Any] | None,
    *,
    mis_user_id: int | None,
    http: httpx.AsyncClient | None = None,
    redis: aioredis.Redis | None = None,
    settings: Settings | None = None,
    session_id: str | None = None,
    require_roles: bool = True,
) -> dict[str, Any]:
    """WS 入站：剥伪造头 → 回源 BFF → JWT 角色兜底 → 注入默认连接。

    BFF ask-context 失败或返回空角色时，回落到 Gateway 验签写入的
    ``verified_roles``。若 ``mis_user_id`` 已解析且 ``require_roles=True``，
    最终仍无 ``X-Mis-Roles`` 则抛 :class:`AskIdentityUnavailable`——调用方必须
    **立刻提示用户并停住**，不得继续进 LLM / Worker（否则会伪装成 45204）。
    """
    merged = strip_untrusted_ask_fields(metadata)
    if mis_user_id is None:
        return await inject_connection_id(merged)

    bff_fail_reason: str | None = None
    bff_fail_detail: str | None = None
    try:
        headers = await fetch_ask_identity_headers(
            mis_user_id, http=http, redis=redis, settings=settings
        )
        merged.update(headers)
    except AskIdentityUnavailable as exc:
        bff_fail_reason = exc.reason
        bff_fail_detail = exc.detail or None
        logger.error(
            "ask-identity enrichment bff failed; try JWT role fallback",
            event_code="ask_identity_fetch_fail",
            user_id=mis_user_id,
            session_id=session_id,
            reason=exc.reason,
            detail=exc.detail or None,
        )

    if not str(merged.get("X-Mis-Roles") or "").strip():
        fallback = _roles_header_from_verified(merged)
        if fallback:
            merged["X-Mis-Roles"] = fallback
            logger.warning(
                "ask-identity used verified_roles fallback",
                event_code="ask_identity_fallback_jwt",
                user_id=mis_user_id,
                session_id=session_id,
                role_count=_role_count(merged),
                bff_fail_reason=bff_fail_reason,
                bff_fail_detail=bff_fail_detail,
            )
        elif require_roles:
            reason = bff_fail_reason or "问数身份无角色"
            detail = bff_fail_detail or "bff_empty_roles_and_no_jwt_fallback"
            logger.error(
                "ask-identity blocked: no roles after bff+fallback",
                event_code="ask_identity_blocked",
                user_id=mis_user_id,
                session_id=session_id,
                reason=reason,
                detail=detail,
                error_code=USER_ERROR_CODE,
            )
            raise AskIdentityUnavailable(reason, mis_user_id, detail)

    return await inject_connection_id(merged)
