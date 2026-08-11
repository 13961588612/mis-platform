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
    BIZ_CODE_SKILL_FORBIDDEN,
    MisPermissionResolver,
    PermissionUnavailable,
    _envelope_error,
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
        # 与 Java 侧 SkillPermissionChecker.CACHE_TTL = Duration.ofSeconds(60) 对齐。
        "MIS_ACL_CACHE_TTL": 60,
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
    """TC-16：未命中 → 回源 BFF → SETEX 60s 写回（TTL 与 Java 侧一致）。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(_settings(), redis, _http(_ok(["ai:skill:a:run"])))

    assert await resolver.resolve(1001) == {"ai:skill:a:run"}
    assert len(redis.setexs) == 1
    key, ttl, value = redis.setexs[0]
    assert key == "mis:acl:skillperm:1001"
    assert ttl == 60
    assert json.loads(value) == ["ai:skill:a:run"]


async def test_empty_result_from_bff_is_cached() -> None:
    """TC-17：BFF 返回空集 → 也写缓存 60s（防穿透）。"""
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


# ---------------------------------------------------------------------------
# 回归 · 「权限服务暂不可用」全量 fail-closed 故障（BFF 缺 /internal/permissions + 端口错配）
#
# 故障复盘：resolver 回源 ``http://mis-admin-bff:8080/internal/permissions``，
# 但 (a) BFF 根本没实现这个端点、(b) 8080 是 mis-gateway 且不路由 /internal/**、
# (c) BFF 真实端口是 8081。三重错配 ⇒ 每次工具调用都被 fail-closed 拒绝。
# 下面的用例把「修复后的契约」钉死，防止再次回归。
# ---------------------------------------------------------------------------


def _bff_internal_handler(
    codes: list[str], seen: dict[str, Any] | None = None
) -> Any:
    """模拟修复后的 BFF ``GET /internal/permissions``。

    响应体与 Java 侧 ``InternalPermissionController`` +
    ``InternalPermissionsVO`` 逐字段对齐：
    ``{"code":0,"message":"ok","data":{"userId":1001,"codes":[...]}}``。

    Args:
        codes: 端点返回的权限码列表（BFF 侧已排序）。
        seen: 传入则记录请求的 path / query / headers，供断言使用。

    Returns:
        httpx.MockTransport 可用的 handler。
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen["path"] = request.url.path
            seen["query"] = dict(request.url.params)
            seen["platform_token"] = request.headers.get("X-Platform-Token")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "data": {"userId": 1001, "codes": sorted(codes)},
            },
        )

    return handler


async def test_regression_bff_internal_endpoint_contract_resolves_codes() -> None:
    """修复后：BFF ``/internal/permissions`` 正常返回 → 拿到码，**不再抛不可用**。"""
    seen: dict[str, Any] = {}
    redis = FakeRedis()
    resolver = MisPermissionResolver(
        _settings(MIS_ACL_DEFAULT_APP_ID="ai-platform"),
        redis,
        _http(
            _bff_internal_handler(
                ["ai:skill:member.profile:run", "ai:skill:CRM-Lookup:run"], seen
            )
        ),
    )

    codes = await resolver.resolve(1001)

    assert codes == {"ai:skill:member.profile:run", "ai:skill:CRM-Lookup:run"}
    # 打到的必须是内部端点本身（不是 /api/v1/**，那条路由归网关且需要端用户 JWT）
    assert seen["path"] == "/internal/permissions"
    assert seen["query"]["userId"] == "1001"
    assert seen["query"]["appId"] == "ai-platform"
    # 服务间凭证必须带上，否则 BFF 的 InternalServiceTrustInterceptor 一律 401
    assert seen["platform_token"] == "s3cret"
    # 成功路径照常写缓存（与 Java 侧共享同一 key）
    assert redis.setexs[0][0] == "mis:acl:skillperm:1001"


async def test_regression_default_bff_base_url_points_to_bff_port_not_gateway() -> None:
    """默认 BFF 基址必须指向 **8081（BFF 自身）**，不得再退回 8080（网关）。

    8080 是 mis-gateway，只路由 ``/api/v1/**``——``/internal/**`` 在那儿恒 404，
    表现就是「权限服务暂不可用」。这条断言防止默认值被改回去。
    """
    from src.config import Settings

    default_base: str = str(Settings.model_fields["MIS_ADMIN_BFF_BASE_URL"].default)
    default_path: str = str(Settings.model_fields["MIS_ACL_PERMISSIONS_PATH"].default)

    assert default_base.endswith(":8081"), f"BFF 基址应指向 8081，实际 {default_base}"
    assert ":8080" not in default_base, "8080 是 mis-gateway，不路由 /internal/**"
    assert default_path == "/internal/permissions"


async def test_regression_route_missing_404_reports_upstream_url() -> None:
    """端点缺失（404）→ 异常里带上上游 URL 与状态码，别再让人猜。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(
        _settings(),
        redis,
        _http(lambda request: httpx.Response(404, text="Not Found")),
    )

    with pytest.raises(PermissionUnavailable) as exc:
        await resolver.resolve(1001)

    assert exc.value.cause == "HTTP 404"
    assert exc.value.url == "http://bff.test/internal/permissions"
    # 诊断信息要出现在异常字符串里（日志/告警直接可读）
    assert "http://bff.test/internal/permissions" in str(exc.value)
    assert redis.setexs == [], "失败路径不得写缓存"


async def test_regression_connect_error_reports_upstream_url() -> None:
    """地址写错 / 服务没起（ConnectError）→ 同样带 URL，与 404 可区分。"""
    resolver = MisPermissionResolver(
        _settings(MIS_ADMIN_BFF_BASE_URL="http://mis-admin-bff:8080"),
        FakeRedis(),
        _http(_raiser(httpx.ConnectError("name resolution failed"))),
    )

    with pytest.raises(PermissionUnavailable) as exc:
        await resolver.resolve(1001)

    assert exc.value.cause == "ConnectError"
    assert exc.value.url == "http://mis-admin-bff:8080/internal/permissions"
    assert "name resolution failed" in exc.value.detail


async def test_regression_timeout_reports_url_and_budget() -> None:
    """超时 → 带上 URL 与超时预算，便于判断是「慢」还是「不通」。"""
    resolver = MisPermissionResolver(
        _settings(MIS_ACL_HTTP_TIMEOUT=1.5),
        FakeRedis(),
        _http(_raiser(httpx.TimeoutException("timed out"))),
    )

    with pytest.raises(PermissionUnavailable) as exc:
        await resolver.resolve(1001)

    assert exc.value.url == "http://bff.test/internal/permissions"
    assert "1.5" in exc.value.detail


# ---------------------------------------------------------------------------
# 业务错误 envelope（HTTP 200 + code != 0）—— 仍 fail-closed，但原因要说清
# ---------------------------------------------------------------------------


async def test_business_error_envelope_raises_with_biz_code() -> None:
    """HTTP 200 + ``code=40303`` → 识别为上游业务错误，而非「契约对不上」。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(
        _settings(),
        redis,
        _http(
            lambda request: httpx.Response(
                200, json={"code": 40303, "message": "权限源不可用", "data": None}
            )
        ),
    )

    with pytest.raises(PermissionUnavailable) as exc:
        await resolver.resolve(1001)

    assert exc.value.cause == "biz 40303"
    assert exc.value.detail == "权限源不可用"
    assert exc.value.url == "http://bff.test/internal/permissions"
    assert redis.setexs == [], "业务错误同样不得写缓存"


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"code": 0, "data": {"codes": ["a"]}}, id="success-envelope"),
        pytest.param({"codes": ["a"]}, id="no-envelope-bare"),
        pytest.param({"code": "abc", "data": {"codes": ["a"]}}, id="non-numeric-code"),
        pytest.param(["a"], id="raw-array"),
    ],
)
def test_envelope_error_ignores_non_error_payloads(payload: Any) -> None:
    """非失败 envelope 一律返回 ``None``，不得误判成上游报错。"""
    assert _envelope_error(payload) is None


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        pytest.param({"code": 40100, "message": "未认证"}, ("40100", "未认证"), id="401"),
        pytest.param({"code": 50000}, ("50000", ""), id="no-message"),
    ],
)
def test_envelope_error_extracts_code_and_message(
    payload: Any, expected: tuple[str, str]
) -> None:
    """失败 envelope → 提取 ``(code, message)``。"""
    assert _envelope_error(payload) == expected


# ---------------------------------------------------------------------------
# K1 回归 · 40301（SKILL_FORBIDDEN）≠ 源不可用
#
# 缺陷复盘：``_fetch_from_bff`` 把**任何**非 0 业务码都当「权限源不可用」，
# 于是 BFF 明确回 40301「该用户无权限 / 用户不存在 / 反向信任降级」时，
# Python 侧误判为源故障 → 上层转成 40303「权限服务暂不可用」。
# 用户本该看到「无权执行技能」(40301)，却看到「系统坏了」(40303)，
# 既误导用户，也把权限问题伪装成可用性问题、污染 SLO 告警。
#
# 修复契约：40301 ⇒ 返回空集 ``set()``（合法的「零权限码」结论），
# 由 SkillAclGuard 判 ``required_permission not in codes`` 后回 SKILL_FORBIDDEN。
# 其余非 0 码（含 40303 与未知码）保持 fail-closed 抛 PermissionUnavailable。
# ---------------------------------------------------------------------------


def _biz_envelope(code: int, message: str, data: Any = None) -> Any:
    """构造 HTTP 200 + 业务码 envelope 的 handler。

    Args:
        code: MIS 统一响应体的业务码（0 = 成功）。
        message: 业务提示语。
        data: ``data`` 字段内容。

    Returns:
        httpx.MockTransport 可用的 handler。
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": code, "message": message, "data": data})

    return handler


async def test_k1_biz_40301_returns_empty_set_not_unavailable() -> None:
    """K1：BFF 回 ``code=40301`` → 返回空集 ``set()``，**不得**抛 PermissionUnavailable。

    40301 是上游**成功判定**出的「该用户权限码集合为空」，不是源故障。
    """
    resolver = MisPermissionResolver(
        _settings(),
        FakeRedis(),
        _http(
            _biz_envelope(
                40301, "用户无技能执行权限", {"userId": 1001, "reason": "user_not_found"}
            )
        ),
    )

    codes = await resolver._fetch_from_bff(1001, "", None)

    assert codes == set(), "40301 必须解读为「零权限码」，而不是源不可用"


async def test_k1_biz_40301_via_resolve_does_not_raise() -> None:
    """K1：走完整 ``resolve()`` 链路，40301 同样只得到空集，不抛不可用。"""
    resolver = MisPermissionResolver(
        _settings(), FakeRedis(), _http(_biz_envelope(40301, "用户无技能执行权限"))
    )

    assert await resolver.resolve(1001) == set()


async def test_k1_biz_40301_empty_set_is_cached_for_anti_penetration() -> None:
    """K1：40301 的空集走**成功路径**，照常写缓存 60s 防穿透。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(
        _settings(), redis, _http(_biz_envelope(40301, "用户无技能执行权限"))
    )

    assert await resolver.resolve(1001) == set()
    assert len(redis.setexs) == 1
    key, ttl, value = redis.setexs[0]
    assert key == "mis:acl:skillperm:1001"
    assert ttl == 60
    assert json.loads(value) == []


async def test_k1_guard_maps_biz_40301_to_skill_forbidden_not_unavailable() -> None:
    """K1 端到端：40301 → 上层判定为 ``AI_SKILL_FORBIDDEN``，而非 ``AI_ACL_UNAVAILABLE``。

    这是本缺陷对用户可见的那一层：文案必须是「无权执行技能」，不是「权限服务暂不可用」。
    """
    from src.skills.acl import (
        CODE_ACL_UNAVAILABLE,
        CODE_SKILL_FORBIDDEN,
        SkillAclDenied,
        SkillAclGuard,
    )

    resolver = MisPermissionResolver(
        _settings(), FakeRedis(), _http(_biz_envelope(40301, "用户无技能执行权限"))
    )
    guard = SkillAclGuard(
        resolver,
        settings=_settings(MIS_ACL_ENABLED=True, MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES=[]),
    )

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"misUserId": 1001}, "member.profile")

    assert exc.value.code == CODE_SKILL_FORBIDDEN
    assert exc.value.code != CODE_ACL_UNAVAILABLE
    assert exc.value.required_permission == "ai:skill:member.profile:run"


@pytest.mark.parametrize(
    ("biz_code", "message"),
    [
        pytest.param(40303, "权限源不可用", id="40303-acl-unavailable"),
        pytest.param(40100, "未认证", id="40100-unauthenticated"),
        pytest.param(50000, "内部错误", id="50000-unknown"),
    ],
)
async def test_k1_other_biz_codes_still_fail_closed(biz_code: int, message: str) -> None:
    """K1 边界：40301 之外的非 0 码**保持原行为** —— 抛不可用且不写缓存。"""
    redis = FakeRedis()
    resolver = MisPermissionResolver(
        _settings(), redis, _http(_biz_envelope(biz_code, message))
    )

    with pytest.raises(PermissionUnavailable) as exc:
        await resolver.resolve(1001)

    assert exc.value.cause == f"biz {biz_code}"
    assert redis.setexs == [], "源不可用路径不得写缓存"


def test_k1_biz_code_constant_matches_java_side() -> None:
    """K1：常量取值必须等于 Java ``AgentOpsErrorCodes.SKILL_FORBIDDEN`` = 40301。"""
    assert BIZ_CODE_SKILL_FORBIDDEN == "40301"


# ---------------------------------------------------------------------------
# K2 回归 · TTL 必须与 Java 侧 60s 对齐
#
# 缺陷复盘：Java ``SkillPermissionChecker.CACHE_TTL = 60s``，Python 侧写 300s。
# 两语言共享同一 key ``mis:acl:skillperm:{userId}``，谁先解析谁写入 ⇒ 缓存实际
# 寿命取决于「谁先写」，行为不确定；且 mis-iam 抖动后 Python 侧要多拖 240s 才自愈。
# ---------------------------------------------------------------------------


def test_k2_settings_default_ttl_aligns_with_java_60s() -> None:
    """K2：``Settings.MIS_ACL_CACHE_TTL`` 默认值必须是 60（不得改回 300）。"""
    from src.config import Settings

    default_ttl: int = int(Settings.model_fields["MIS_ACL_CACHE_TTL"].default)
    assert default_ttl == 60, f"须与 Java 侧 CACHE_TTL(60s) 一致，实际 {default_ttl}"


def test_k2_resolver_ttl_fallback_is_60_when_setting_absent() -> None:
    """K2：Settings 缺失 / 取值为 0 时，resolver 的兜底 TTL 也必须是 60s。"""
    without_ttl = _settings()
    delattr(without_ttl, "MIS_ACL_CACHE_TTL")

    assert MisPermissionResolver(without_ttl, FakeRedis())._ttl == 60
    assert MisPermissionResolver(_settings(MIS_ACL_CACHE_TTL=0), FakeRedis())._ttl == 60


async def test_missing_shared_secret_still_requests_without_platform_token() -> None:
    """未配共享密钥 → 不伪造头（让 BFF 明确 401），但请求照发以便暴露真实原因。"""
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["platform_token"] = request.headers.get("X-Platform-Token")
        return httpx.Response(200, json={"code": 0, "data": {"codes": []}})

    resolver = MisPermissionResolver(
        _settings(AI_PLATFORM_BFF_SHARED_SECRET=""), FakeRedis(), _http(handler)
    )

    assert await resolver.resolve(1001) == set()
    assert seen["platform_token"] is None
