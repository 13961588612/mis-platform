"""T03 · `skills/acl.py` —— 权限码黄金向量 + fail-closed 四规则。

对应 spec §2.2 / §4 / §4.1 黄金向量表 / §5 TC-02、TC-11/12/14、TC-17、
TC-18、TC-21、TC-22、TC-36、TC-37。
"""

from __future__ import annotations

import json

import pytest

from src.identity.mis_permission_resolver import PermissionUnavailable
from src.skills.acl import (
    CODE_ACL_UNAVAILABLE,
    CODE_SKILL_FORBIDDEN,
    SkillAclDenied,
    SkillAclGuard,
    permission_code_of,
)
from tests.t03_helpers import FakeResolver, make_settings

# ---------------------------------------------------------------------------
# TC-37 · 跨语言黄金向量（§4.1）—— 逐字节断言，防 normalize 漂移
# ---------------------------------------------------------------------------

GOLDEN_VECTORS: list[tuple[str, str]] = [
    ("member.profile", "ai:skill:member.profile:run"),
    ("member.points-account", "ai:skill:member.points-account:run"),
    ("member.coupons-account", "ai:skill:member.coupons-account:run"),
    ("user-fill", "ai:skill:user-fill:run"),
    ("CRM-Lookup", "ai:skill:CRM-Lookup:run"),
    # #16：MCP 判别名（点号原样，绝非展示名 mcp__member_profile__query）
    ("mcp-member.profile-query", "ai:skill:mcp-member.profile-query:run"),
]


@pytest.mark.parametrize(("skill_id", "expected"), GOLDEN_VECTORS)
def test_tc37_permission_code_golden_vectors(skill_id: str, expected: str) -> None:
    """§4.1 黄金向量：permission_code_of 输出与期望**逐字节**相等。"""
    assert permission_code_of(skill_id) == expected


@pytest.mark.parametrize(("skill_id", "expected"), GOLDEN_VECTORS)
def test_tc37_guard_method_matches_module_function(skill_id: str, expected: str) -> None:
    """``SkillAclGuard.permission_code`` 与模块级函数同源，避免双实现漂移。"""
    guard = SkillAclGuard(FakeResolver(), None, make_settings())
    assert guard.permission_code(skill_id) == expected


def test_tc37_no_normalize_zero_rewrite() -> None:
    """#1 裁定·作废 ``_normalize``：点号 / 大写 / 连字符零改写。"""
    code = permission_code_of("A.B_c-D")
    assert code == "ai:skill:A.B_c-D:run"
    # 逐项证明「没有发生任何字符替换」
    assert "." in code, "点号被改写"
    assert "A" in code and "B" in code and "D" in code, "大写被 lower"
    assert "-" in code and "_" in code, "连字符/下划线被改写"


def test_permission_code_is_pure_template() -> None:
    """码格式恒为 ``ai:skill:{id}:run``，前后缀不可漂移。"""
    for sid in ("x", "a.b.c", "UPPER", "with-dash", "with_underscore"):
        code = permission_code_of(sid)
        assert code.startswith("ai:skill:")
        assert code.endswith(":run")
        assert code[len("ai:skill:") : -len(":run")] == sid


# ---------------------------------------------------------------------------
# fail-closed 规则 1 · 无身份 / 匿名（TC-18）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "ctx",
    [
        pytest.param(None, id="ctx-None"),
        pytest.param({}, id="empty-dict"),
        pytest.param({"userId": "employee-42"}, id="only-userId-no-misUserId"),
        pytest.param({"misUserId": ""}, id="misUserId-empty-string"),
        pytest.param({"userId": "e1", "misUserId": ""}, id="userId-with-empty-misUserId"),
        pytest.param({"userMobile": "13800000000"}, id="only-mobile"),
    ],
)
async def test_rule1_no_identity_is_denied(ctx: object) -> None:
    """规则 1：解析不出 MIS userId → AI_SKILL_FORBIDDEN，且**绝不回源**。"""
    resolver = FakeResolver(codes={"ai:skill:member.profile:run"})
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run(ctx, "member.profile")

    assert exc.value.code == CODE_SKILL_FORBIDDEN
    # 关键：绝不拿 userId / userMobile 去查权限（#14 横向越权防线）
    assert resolver.hits == 0, "无 misUserId 时不得回源查权限"


async def test_rule1_never_falls_back_to_top_level_user_id() -> None:
    """即便 userId 恰好是个合法数字，也**不得**被当成 MIS userId。"""
    resolver = FakeResolver(codes={"ai:skill:member.profile:run"})
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"userId": "1001", "misUserId": ""}, "member.profile")

    assert exc.value.code == CODE_SKILL_FORBIDDEN
    assert resolver.hits == 0, "顶层 userId(=employeeId) 被误用作 MIS userId"


# ---------------------------------------------------------------------------
# fail-closed 规则 2 · 权限源不可达（TC-11 / TC-12 / TC-14）
# ---------------------------------------------------------------------------


async def test_rule2_source_unavailable_denies_with_acl_unavailable() -> None:
    """规则 2：源不可达 → AI_ACL_UNAVAILABLE，**禁止 fallback 放行**。"""
    resolver = FakeResolver(raise_unavailable=True)
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"misUserId": "1001"}, "member.profile")

    assert exc.value.code == CODE_ACL_UNAVAILABLE
    assert exc.value.skill_id == "member.profile"
    assert exc.value.required_permission == "ai:skill:member.profile:run"
    assert resolver.hits == 1, "应真实尝试过回源"


async def test_rule2_unavailable_is_not_downgraded_to_forbidden() -> None:
    """源不可用与无权限必须可区分（前端分支 / 运维告警依赖）。"""
    guard = SkillAclGuard(FakeResolver(raise_unavailable=True), None, make_settings())
    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"misUserId": "1001"}, "x")
    assert exc.value.code != CODE_SKILL_FORBIDDEN


async def test_rule2_unavailable_carries_diagnostics_but_keeps_user_message() -> None:
    """诊断信息进 ``extra``，面向用户的文案**一字不改**；内网地址**只落日志**。

    本次「所有工具都报权限服务暂不可用」的故障里，用户侧文案无法区分
    「BFF 少路由(404)」「端口写错(ConnectError)」「密钥不匹配(401)」，
    排障只能靠猜——因此 cause / reason 必须进 extra。但 upstream（BFF 内网 URL）
    **不得**进 extra / payload（信息泄露），只能进日志（见下一条回归用例
    ``test_rule2_unavailable_403_body_must_not_leak_internal_url``）。
    """
    resolver = FakeResolver(
        unavailable_exc=PermissionUnavailable(
            "权限源返回非 2xx",
            1001,
            "HTTP 404",
            "http://mis-admin-bff:8081/internal/permissions",
            "Not Found",
        )
    )
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"misUserId": "1001"}, "member.profile")

    assert exc.value.code == CODE_ACL_UNAVAILABLE
    # 用户可见文案保持稳定（前端可能已按此文案做过兜底提示）
    assert exc.value.message == "权限服务暂不可用，已按最小权限原则拒绝执行"
    # 运维可见的非敏感诊断落在 extra 里
    assert exc.value.extra["cause"] == "HTTP 404"
    assert exc.value.extra["reason"] == "权限源返回非 2xx"
    # 关键：内网地址绝不进 extra / payload（信息泄露红线）
    assert "upstream" not in exc.value.extra
    assert "mis-admin-bff" not in json.dumps(exc.value.to_payload(), ensure_ascii=False)
    # 不得把内网地址泄露到用户文案
    assert "mis-admin-bff" not in exc.value.message


async def test_rule2_unavailable_403_body_must_not_leak_internal_url() -> None:
    """回归（信息泄露红线）：回源 404 / ConnectError 时，403 响应体不得含内网地址。

    复现 QA 报告的现象：模拟回源失败后，拒绝响应的 ``data`` / HTTP body 曾经
    含 ``"upstream":"http://mis-admin-bff:8081/internal/permissions"``，暴露内网拓扑。
    本用例断言：无论 ``cause`` 是 HTTP 404 还是 ConnectError，
    ``SkillAclDenied.to_payload()["data"]`` 与等价的 403 HTTP 响应体都**不含**
    任何内网 URL / host（mis-admin-bff、端口、127.0.0.1、host.docker.internal 等），
    且 ``upstream`` 字段本身不存在。fail-closed 语义与用户文案一字不变。
    """
    from fastapi import HTTPException, status

    scenarios: list[PermissionUnavailable] = [
        PermissionUnavailable(
            "权限源返回非 2xx",
            1001,
            "HTTP 404",
            "http://mis-admin-bff:8081/internal/permissions",
            "Not Found",
        ),
        PermissionUnavailable(
            "连接失败",
            1001,
            "ConnectError",
            "http://mis-admin-bff:8081/internal/permissions",
            "name resolution failed",
        ),
        PermissionUnavailable(
            "连接失败",
            1001,
            "ConnectError",
            "http://127.0.0.1:8081/internal/permissions",
            "connection refused",
        ),
    ]

    for scenario in scenarios:
        resolver = FakeResolver(unavailable_exc=scenario)
        guard = SkillAclGuard(resolver, None, make_settings())

        with pytest.raises(SkillAclDenied) as exc:
            await guard.assert_can_run({"misUserId": "1001"}, "member.profile")
        denied = exc.value

        # 1) 结构化载体里压根不该有 upstream 字段
        assert "upstream" not in denied.extra, "upstream 不得进入 extra"

        # 2) to_payload() 的 data 不含内网 URL / host
        payload: dict[str, Any] = denied.to_payload()
        data: dict[str, Any] = payload["data"]
        assert "upstream" not in data
        payload_json: str = json.dumps(payload, ensure_ascii=False)
        assert "mis-admin-bff" not in payload_json
        assert "127.0.0.1" not in payload_json
        assert "host.docker.internal" not in payload_json
        assert ":8081" not in payload_json

        # 3) 模拟 403 HTTP 响应体（与 src/api/deps._denied_to_http 等价：detail=payload）
        http = HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=payload)
        body: str = json.dumps(http.detail, ensure_ascii=False)
        assert "upstream" not in body
        assert "mis-admin-bff" not in body
        assert "127.0.0.1" not in body
        assert "host.docker.internal" not in body
        assert ":8081" not in body

        # 4) fail-closed 语义与用户文案一字不变
        assert denied.code == CODE_ACL_UNAVAILABLE
        assert denied.message == "权限服务暂不可用，已按最小权限原则拒绝执行"
        # 5) 非敏感诊断仍可用（cause 在 payload，upstream 仅在日志）
        assert denied.extra.get("cause") in ("HTTP 404", "ConnectError")


# ---------------------------------------------------------------------------
# fail-closed 规则 3 · 空集合 / 缺码（TC-17 / TC-19）
# ---------------------------------------------------------------------------


async def test_rule3_empty_code_set_is_denied() -> None:
    """规则 3a：权限码集合为空 → 拒绝（空集不是放行）。"""
    resolver = FakeResolver(codes=set())
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"misUserId": "1001"}, "member.profile")

    assert exc.value.code == CODE_SKILL_FORBIDDEN
    assert resolver.hits == 1


async def test_rule3_missing_required_code_is_denied() -> None:
    """规则 3b：持有其它码但缺所需码 → 拒绝。"""
    resolver = FakeResolver(codes={"ai:skill:other.skill:run", "ai:mcp:call"})
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"misUserId": "1001"}, "member.profile")

    assert exc.value.code == CODE_SKILL_FORBIDDEN
    assert exc.value.required_permission == "ai:skill:member.profile:run"


async def test_rule3_case_sensitive_code_match() -> None:
    """码比对**大小写敏感**：持 lower 版不得放行 CRM-Lookup。"""
    resolver = FakeResolver(codes={"ai:skill:crm-lookup:run"})
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied):
        await guard.assert_can_run({"misUserId": "1001"}, "CRM-Lookup")


async def test_rule3_dot_and_underscore_do_not_collide() -> None:
    """``member.profile`` 与 ``member_profile`` 的码互不通用（防折叠越权）。"""
    resolver = FakeResolver(codes={"ai:skill:member_profile:run"})
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied):
        await guard.assert_can_run({"misUserId": "1001"}, "member.profile")


async def test_positive_path_allows_when_code_present() -> None:
    """正向基线（TC-01）：持码则放行，不抛异常。"""
    resolver = FakeResolver(codes={"ai:skill:member.profile:run"})
    guard = SkillAclGuard(resolver, None, make_settings())

    await guard.assert_can_run({"misUserId": "1001"}, "member.profile")

    assert resolver.hits == 1
    assert resolver.seen[0][0] == 1001, "应把 int 型 MIS userId 传给 resolver"


# ---------------------------------------------------------------------------
# fail-closed 规则 4 · 超管豁免默认关闭（TC-21 / TC-22）
# ---------------------------------------------------------------------------


async def test_rule4_superadmin_bypass_disabled_by_default() -> None:
    """规则 4a：未显式配置豁免角色 → 有 role 也照拒。"""
    resolver = FakeResolver(codes=set())
    guard = SkillAclGuard(resolver, None, make_settings())

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run(
            {"misUserId": "1001", "roles": ["superadmin", "admin"]}, "member.profile"
        )

    assert exc.value.code == CODE_SKILL_FORBIDDEN


async def test_rule4_superadmin_bypass_requires_role_hit() -> None:
    """规则 4b：配了豁免但角色不命中 → 仍拒。"""
    guard = SkillAclGuard(
        FakeResolver(codes=set()),
        None,
        make_settings(MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES=["superadmin"]),
    )

    with pytest.raises(SkillAclDenied):
        await guard.assert_can_run(
            {"misUserId": "1001", "roles": ["viewer"]}, "member.profile"
        )


async def test_rule4_superadmin_bypass_explicit_on_allows() -> None:
    """规则 4c（TC-22）：显式配置且角色命中 → 放行。"""
    guard = SkillAclGuard(
        FakeResolver(codes=set()),
        None,
        make_settings(MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES=["superadmin"]),
    )

    await guard.assert_can_run(
        {"misUserId": "1001", "roles": ["superadmin"]}, "member.profile"
    )


async def test_rule4_bypass_does_not_rescue_missing_identity() -> None:
    """超管豁免**不得**救回「无身份」——身份闸门优先于豁免。"""
    resolver = FakeResolver(codes=set())
    guard = SkillAclGuard(
        resolver, None, make_settings(MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES=["superadmin"])
    )

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run({"roles": ["superadmin"]}, "member.profile")

    assert exc.value.code == CODE_SKILL_FORBIDDEN
    assert resolver.hits == 0


async def test_rule4_bypass_does_not_rescue_unavailable_source() -> None:
    """超管豁免**不得**救回「源不可达」——仍报 AI_ACL_UNAVAILABLE。"""
    guard = SkillAclGuard(
        FakeResolver(raise_unavailable=True),
        None,
        make_settings(MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES=["superadmin"]),
    )

    with pytest.raises(SkillAclDenied) as exc:
        await guard.assert_can_run(
            {"misUserId": "1001", "roles": ["superadmin"]}, "member.profile"
        )

    assert exc.value.code == CODE_ACL_UNAVAILABLE


# ---------------------------------------------------------------------------
# 权限码回写 / filter_runnable（TC-36）
# ---------------------------------------------------------------------------


async def test_codes_written_back_to_ctx() -> None:
    """解析结果回写 ``ctx["permission_codes"]``（§4.1）。"""
    resolver = FakeResolver(codes={"ai:skill:a:run", "ai:skill:b:run"})
    guard = SkillAclGuard(resolver, None, make_settings())
    ctx: dict[str, object] = {"misUserId": "1001"}

    await guard.assert_can_run(ctx, "a")

    assert ctx["permission_codes"] == {"ai:skill:a:run", "ai:skill:b:run"}


def test_tc36_filter_runnable_returns_only_granted() -> None:
    """TC-36：``filter_runnable`` 只返回有码子集，且**不抛**。"""
    guard = SkillAclGuard(FakeResolver(), None, make_settings())
    ctx = {"permission_codes": {"ai:skill:has-code:run"}}

    assert guard.filter_runnable(ctx, ["has-code", "no-code"]) == ["has-code"]


def test_filter_runnable_empty_when_no_codes() -> None:
    """无码上下文 → 空列表（fail-closed，不抛）。"""
    guard = SkillAclGuard(FakeResolver(), None, make_settings())
    assert guard.filter_runnable({"permission_codes": set()}, ["a", "b"]) == []
    assert guard.filter_runnable({}, ["a", "b"]) == []
    assert guard.filter_runnable(None, ["a"]) == []


# ---------------------------------------------------------------------------
# 错误载体结构（§2.2 错误返回统一格式）
# ---------------------------------------------------------------------------


def test_denied_payload_shape() -> None:
    """``to_payload`` 结构与 spec §2.2 一致，供前端统一分支。"""
    payload = SkillAclDenied(
        code=CODE_SKILL_FORBIDDEN,
        skill_id="member.profile",
        required_permission="ai:skill:member.profile:run",
    ).to_payload()

    assert payload["code"] == "AI_SKILL_FORBIDDEN"
    assert payload["data"]["skill_id"] == "member.profile"
    assert payload["data"]["required_permission"] == "ai:skill:member.profile:run"
    assert "member.profile" in payload["message"]


def test_denied_is_an_exception() -> None:
    """``SkillAclDenied`` 同时是异常与结构化载体。"""
    assert isinstance(SkillAclDenied(skill_id="x"), Exception)
