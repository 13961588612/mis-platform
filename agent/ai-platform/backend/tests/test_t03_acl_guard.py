"""T03 · `skills/acl.py` —— 权限码黄金向量 + fail-closed 四规则。

对应 spec §2.2 / §4 / §4.1 黄金向量表 / §5 TC-02、TC-11/12/14、TC-17、
TC-18、TC-21、TC-22、TC-36、TC-37。
"""

from __future__ import annotations

import pytest

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
    resolver = FakeResolver(codes={"ai:skill:other.skill:run", "agent:mcp:call"})
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
