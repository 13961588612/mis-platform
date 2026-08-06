"""T03 · `identity/mis_permission_resolver.py` —— 缓存 + BFF 回源 fail-closed。

对应 spec §2.1 / §5 TC-11、TC-12、TC-13、TC-14、TC-15、TC-16、TC-17。

**红线**：源失败一律抛 ``PermissionUnavailable``，**绝不返回空集**（空集会被
上层误读为「查到了但没权限」，语义降级）；源失败**不写缓存**。
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from src.identity.mis_permission_resolver import (
    MisPermissionResolver,
    PermissionUnavailable,
    _parse_codes,
)


class FakeRedis:
    """异步 Redis 替身，记录 get/setex/delete 调用。"""

    def __init__(self, initial: dict[str, str] | None = None, broken: bool = False) -> None:
        self.store: dict[str, str] = dict(initial or {})
        self.broken = broken
        self.gets: list[str] = []
        self.setexs: list[tuple[str, int, str]] = []
        self.deletes: list[str] = []

    async def get(self, key: str) -> str | None:
        """读缓存。"""
        self.gets.append(key)
        if self.broken:
            raise ConnectionError("redis down")
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        """写缓存（含 TTL）。"""
        if self.broken:
            raise ConnectionError("redis down")
        self.setexs.append((key, ttl, value))
        self.store[key] = value

    async def delete(self, key: str) -> None:
        """删缓存。"""
        self.deletes.append(key)
        self.store.pop(key, None)


def _settings(**overrides: Any) -> SimpleNamespace:
    """构造 resolver 用的 Settings 替身。"""
    base: dict[str, Any] = {
        "MIS_ACL_CACHE_TTL": 300,
        "MIS_ACL_CACHE_KEY_PREFIX": "mis:acl:skillperm:",
        "MIS_ADMIN_BFF_BASE_URL": "http://bff.test",
        "MIS_ACL_PERMISSIONS_PATH": "/internal/permissions",
        "MIS_ACL_HTTP_TIMEOUT": 1.5,
        "MIS_ACL_DEFAULT_APP_ID": "",
        "AI_PLATFORM_BFF_SHARED_SECRET": "s3cret",
        "redis_url": "redis://localhost:6379/0",
        "REDIS_MAX_CONNECTIONS": 10,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _http(handler: Any) -> httpx.AsyncClient:
    """构造走 MockTransport 的 httpx 客户端。"""
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _ok(codes: list[str]) -> Any:
    """返回 200 + 标准 envelope 的 handler。"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 0, "data": {"codes": codes}})

    return handler


# ---------------------------------------------------------------------------
# 缓存键（跨语言共享，逐字节对齐 Java 侧）
# ---------------------------------------------------------------------------


def test_cache_key_matches_java_side() -> None:
    """缓存 key 必须是 ``mis:acl:skillperm:{userId}``（无 aip: 前缀）。"""
    resolver = MisPermissionResolver(settings=_settings(), redis_client=FakeRedis())
    assert resolver.cache_key(1001) == "mis:acl:skillperm:1001"


# ---------------------------------------------------------------------------
# TC-15 · 缓存命中（不回源）
# ---------------------------------------------------------------------------


async def test_tc15_cache_hit_skips_bff() -> None:
    """TC-15：命中缓存 → 不发起任何 HTTP 请求。"""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"data": {"codes": []}})

    redis = FakeRedis({"mis:acl:skillperm:1001": json.dumps(["ai:skill:a:run"])})
    resolver = MisPermissionResolver(_settings(), redis, _http(handler))

    assert await resolver.resolve(1001) == {"ai:skill:a:run"}
    assert calls == [], "缓存命中不应回源"


async def test_tc17_empty_set_is_cached_and_returned() -> None:
    """TC-17：空集合是**合法缓存值**，命中后直接返回空集（防穿透）。"""
    redis = FakeRedis({"mis:acl:skillperm:1001": json.dumps([])})
    resolver = MisPermissionResolver(_settings(), redis, _http(_ok(["x"])))

    assert await resolver.resolve(1001) == set()


# ---------------------------------------------------------------------------
# TC-16 · 未命中回源 + 写缓存
# ---------------------------------------------------------------------------


async def test_tc16_cache_miss_fetches_and_writes_cache() -> None:
    """TC-16：未命中 → 回源 BFF → SETEX 300s 写回。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(_settings(), redis, _http(_ok(["ai:skill:a:run"])))

    assert await resolver.resolve(1001) == {"ai:skill:a:run"}
    assert len(redis.setexs) == 1
    key, ttl, value = redis.setexs[0]
    assert key == "mis:acl:skillperm:1001"
    assert ttl == 300
    assert json.loads(value) == ["ai:skill:a:run"]


async def test_empty_result_from_bff_is_cached() -> None:
    """TC-17：BFF 返回空集 → 也写缓存 300s（防穿透）。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(_settings(), redis, _http(_ok([])))

    assert await resolver.resolve(1001) == set()
    assert len(redis.setexs) == 1
    assert json.loads(redis.setexs[0][2]) == []


async def test_request_carries_user_id_and_auth_headers() -> None:
    """回源请求带 userId 参数 + Bearer JWT + X-Platform-Token。"""
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["platform"] = request.headers.get("X-Platform-Token")
        return httpx.Response(200, json={"data": {"codes": []}})

    resolver = MisPermissionResolver(_settings(), FakeRedis(), _http(handler))
    await resolver.resolve(1001, "system", "jwt-abc")

    assert "userId=1001" in seen["url"]
    assert "appId=system" in seen["url"]
    assert seen["auth"] == "Bearer jwt-abc"
    assert seen["platform"] == "s3cret"


# ---------------------------------------------------------------------------
# TC-11 / 12 / 14 · 源失败一律 PermissionUnavailable 且不写缓存
# ---------------------------------------------------------------------------


def _raiser(exc: Exception) -> Any:
    """构造抛异常的 handler。"""

    def handler(request: httpx.Request) -> httpx.Response:
        raise exc

    return handler


@pytest.mark.parametrize(
    ("name", "handler_factory"),
    [
        pytest.param(
            "timeout", lambda: _raiser(httpx.TimeoutException("timeout")), id="TC-11-timeout"
        ),
        pytest.param(
            "connect", lambda: _raiser(httpx.ConnectError("refused")), id="TC-14-conn-refused"
        ),
        pytest.param(
            "http500",
            lambda: (lambda request: httpx.Response(500, text="boom")),
            id="TC-12-http-500",
        ),
        pytest.param(
            "http403",
            lambda: (lambda request: httpx.Response(403, text="nope")),
            id="http-403",
        ),
        pytest.param(
            "http404",
            lambda: (lambda request: httpx.Response(404, text="missing")),
            id="http-404",
        ),
        pytest.param(
            "non-json",
            lambda: (lambda request: httpx.Response(200, text="<html>oops</html>")),
            id="non-json-body",
        ),
        pytest.param(
            "bad-schema",
            lambda: (lambda request: httpx.Response(200, json={"data": {"oops": 1}})),
            id="schema-mismatch",
        ),
    ],
)
async def test_source_failures_raise_unavailable_and_skip_cache(
    name: str, handler_factory: Any
) -> None:
    """源失败 → 抛 PermissionUnavailable；**绝不返回空集**、**绝不写缓存**。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(_settings(), redis, _http(handler_factory()))

    with pytest.raises(PermissionUnavailable):
        await resolver.resolve(1001)

    assert redis.setexs == [], f"{name}: 源失败路径不得写缓存"


async def test_missing_base_url_raises_unavailable() -> None:
    """BFF 基址未配置 → 不可用（而非静默放行）。"""
    resolver = MisPermissionResolver(_settings(MIS_ADMIN_BFF_BASE_URL=""), FakeRedis())
    with pytest.raises(PermissionUnavailable) as exc:
        await resolver.resolve(1001)
    assert exc.value.cause == "config_missing"


@pytest.mark.parametrize("user_id", [None, "", 0])
async def test_blank_user_id_raises_unavailable(user_id: Any) -> None:
    """无身份走到 resolver → 视为不可用，绝不当空集处理。"""
    resolver = MisPermissionResolver(_settings(), FakeRedis(), _http(_ok([])))
    with pytest.raises(PermissionUnavailable):
        await resolver.resolve(user_id)


# ---------------------------------------------------------------------------
# TC-13 · Redis 故障不影响回源（缓存降级 ≠ 权限源不可用）
# ---------------------------------------------------------------------------


async def test_tc13_redis_down_still_fetches_from_bff() -> None:
    """TC-13：Redis 挂但 BFF 可达 → 回源成功、正常放行。"""
    resolver = MisPermissionResolver(
        _settings(), FakeRedis(broken=True), _http(_ok(["ai:skill:a:run"]))
    )
    assert await resolver.resolve(1001) == {"ai:skill:a:run"}


async def test_corrupted_cache_treated_as_miss() -> None:
    """缓存内容损坏 → 视为未命中并回源，不崩溃。"""
    redis = FakeRedis({"mis:acl:skillperm:1001": "{not-json"})
    resolver = MisPermissionResolver(_settings(), redis, _http(_ok(["ai:skill:a:run"])))
    assert await resolver.resolve(1001) == {"ai:skill:a:run"}


async def test_invalidate_deletes_cache_key() -> None:
    """``invalidate`` 删除对应 key。"""
    redis = FakeRedis({"mis:acl:skillperm:1001": json.dumps([])})
    resolver = MisPermissionResolver(_settings(), redis)
    await resolver.invalidate(1001)
    assert redis.deletes == ["mis:acl:skillperm:1001"]


# ---------------------------------------------------------------------------
# 响应解析：兼容多形态 + 权限码原样保留
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"code": 0, "data": {"codes": ["a", "b"]}}, id="envelope-codes"),
        pytest.param({"data": {"permissionCodes": ["a", "b"]}}, id="envelope-camel"),
        pytest.param({"data": {"permission_codes": ["a", "b"]}}, id="envelope-snake"),
        pytest.param({"codes": ["a", "b"]}, id="bare-codes"),
        pytest.param({"data": ["a", "b"]}, id="data-array"),
        pytest.param(["a", "b"], id="raw-array"),
    ],
)
def test_parse_codes_accepts_known_shapes(payload: Any) -> None:
    """兼容 BFF 的多种响应形态。"""
    assert _parse_codes(payload) == {"a", "b"}


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"data": {"oops": 1}}, id="unknown-keys"),
        pytest.param({"data": {"codes": "not-a-list"}}, id="codes-not-list"),
        pytest.param({}, id="empty-dict"),
    ],
)
def test_parse_codes_returns_none_on_unknown_shape(payload: Any) -> None:
    """结构无法识别 → None（调用方转不可用），**不是**空集。"""
    assert _parse_codes(payload) is None


def test_parse_codes_preserves_dots_and_case() -> None:
    """权限码原样保留：不 lower、不改写点号（跨语言逐字节一致）。"""
    parsed = _parse_codes({"data": {"codes": ["ai:skill:CRM-Lookup:run", "ai:skill:a.b:run"]}})
    assert parsed == {"ai:skill:CRM-Lookup:run", "ai:skill:a.b:run"}
