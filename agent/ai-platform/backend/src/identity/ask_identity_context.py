"""Copilot / iframe 入站问数身份：回源 BFF ask-context，不采信客户端 X-Mis-*。"""

from __future__ import annotations

import json
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

BIZ_CODE_UNAVAILABLE: str = "40303"


class AskIdentityUnavailable(Exception):
    """BFF 问数身份源不可用（超时 / 非 2xx / 解析失败）。"""

    def __init__(self, reason: str, user_id: int | str = "", detail: str = "") -> None:
        super().__init__(reason)
        self.reason = reason
        self.user_id = user_id
        self.detail = detail


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
                    return {str(k): str(v) for k, v in parsed.items() if v}
        except Exception:  # noqa: BLE001
            logger.warning("ask-identity cache read failed", user_id=user_id, exc_info=True)

    base: str = str(getattr(cfg, "MIS_ADMIN_BFF_BASE_URL", "") or "").rstrip("/")
    path: str = str(
        getattr(cfg, "MIS_ASK_IDENTITY_PATH", "/internal/identity/ask-context")
        or "/internal/identity/ask-context"
    )
    if not base:
        raise AskIdentityUnavailable("MIS_ADMIN_BFF_BASE_URL 未配置", user_id)
    url = f"{base}{path if path.startswith('/') else '/' + path}"
    secret: str = str(getattr(cfg, "AI_PLATFORM_BFF_SHARED_SECRET", "") or "").strip()
    headers: dict[str, str] = {"Accept": "application/json"}
    if secret:
        headers["X-Platform-Token"] = secret
    timeout: float = float(getattr(cfg, "MIS_ACL_HTTP_TIMEOUT", 3.0) or 3.0)

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
        raise AskIdentityUnavailable("身份源连接失败", user_id, str(exc)) from exc

    if response.status_code < 200 or response.status_code >= 300:
        raise AskIdentityUnavailable(
            "身份源非 2xx", user_id, f"HTTP {response.status_code} {response.text[:200]}"
        )
    try:
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        raise AskIdentityUnavailable("身份源非 JSON", user_id) from exc

    out = _parse_headers_payload(payload)
    if cache_redis is not None:
        try:
            await cache_redis.setex(_cache_key(user_id, cfg), ttl, json.dumps(out, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            logger.warning("ask-identity cache write failed", user_id=user_id, exc_info=True)
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


async def _enabled_connection_ids() -> list[int]:
    try:
        from src.adapters.iqd_config_client import IqdConfigClient

        rows = await IqdConfigClient().get_connections()
    except Exception:  # noqa: BLE001
        logger.warning("list IQD connections for default id failed", exc_info=True)
        return []
    enabled: list[int] = []
    others: list[int] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        cid = _coerce_connection_id(row.get("id"))
        if cid is None:
            continue
        flag = row.get("enabled")
        if flag in (1, True, "1", "true", "TRUE"):
            enabled.append(cid)
        else:
            others.append(cid)
    return enabled or others


async def inject_connection_id(metadata: dict[str, Any]) -> dict[str, Any]:
    """注入默认 / 校验过的 connection_id（hint 必须落在 enabled 连接内）。"""
    merged = dict(metadata)
    enabled = await _enabled_connection_ids()
    hint = _hint_connection_id(merged)
    iqd = dict(merged.get("iqd") or {}) if isinstance(merged.get("iqd"), dict) else {}
    current = _coerce_connection_id(iqd.get("connection_id"))
    chosen: int | None = None
    if current is not None and (not enabled or current in enabled):
        chosen = current
    elif hint is not None and (not enabled or hint in enabled):
        chosen = hint
    elif enabled:
        chosen = enabled[0]
    if chosen is not None:
        iqd["connection_id"] = chosen
        merged["iqd"] = iqd
    return merged


async def enrich_inbound_ask_identity(
    metadata: dict[str, Any] | None,
    *,
    mis_user_id: int | None,
    http: httpx.AsyncClient | None = None,
    redis: aioredis.Redis | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """WS 入站：剥伪造头 → 回源 BFF → 注入默认连接。源失败则保持无角色（问数 45204）。"""
    merged = strip_untrusted_ask_fields(metadata)
    if mis_user_id is None:
        return await inject_connection_id(merged)
    try:
        headers = await fetch_ask_identity_headers(
            mis_user_id, http=http, redis=redis, settings=settings
        )
        merged.update(headers)
    except AskIdentityUnavailable as exc:
        logger.warning(
            "ask-identity enrichment failed; IQD will fail-closed",
            user_id=mis_user_id,
            reason=exc.reason,
            detail=exc.detail or None,
        )
    return await inject_connection_id(merged)
