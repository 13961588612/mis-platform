"""T03 · `runtime/acl_tool_wrapper.py` —— E1–E5 执行前闸门。

对应 spec §2.3 / §5 TC-02、TC-03、TC-04、TC-04b、TC-06、TC-08、TC-09、
TC-33（零副作用）、TC-46、TC-47（#16 判权名来源）。
"""

from __future__ import annotations

import pytest

from src.runtime.acl_tool_wrapper import (
    DELEGATE_SENTINEL,
    DENY_SENTINEL,
    AclToolWrapper,
)
from src.skills.acl import SkillAclGuard
from tests.t03_helpers import (
    AnyArgs,
    FakeRegistry,
    FakeResolver,
    InnerTool,
    McpInnerTool,
    SafeLikeWrapper,
    make_ctx,
    make_settings,
)


def _wrap(
    inner: InnerTool,
    codes: set[str] | None = None,
    registry: FakeRegistry | None = None,
    *,
    unavailable: bool = False,
) -> tuple[AclToolWrapper, FakeResolver]:
    """按 T03 装配铁律包装：``AclToolWrapper(SafeToolWrapper(tool))``。"""
    resolver = FakeResolver(codes=codes, raise_unavailable=unavailable)
    guard = SkillAclGuard(resolver, registry, make_settings())
    return AclToolWrapper(SafeLikeWrapper(inner), guard, registry), resolver


def _identity(mis_user_id: str = "1001", **extra: str) -> dict[str, object]:
    """构造工具层身份 metadata（S9 五键结构）。"""
    ident: dict[str, str] = {
        "userId": "employee-42",
        "userMobile": "13800000000",
        "channel": "web",
        "channelUserId": "ch-42",
        "misUserId": mis_user_id,
    }
    ident.update(extra)
    return {"identity": ident}


# ---------------------------------------------------------------------------
# 装配铁律
# ---------------------------------------------------------------------------


def test_wrapper_is_outermost_and_transparent() -> None:
    """AclToolWrapper 包在最外层，且透传 name/description/input_model。"""
    inner = InnerTool(name="skill")
    wrapper, _ = _wrap(inner)
    assert wrapper.name == "skill"
    assert wrapper.description == inner.description
    assert wrapper.input_model is inner.input_model


# ---------------------------------------------------------------------------
# E1 · SkillTool（args.skill_id）
# ---------------------------------------------------------------------------


async def test_e1_allows_with_code() -> None:
    """TC-01 正向：持码 → 内层被执行。"""
    inner = InnerTool(name="skill")
    wrapper, resolver = _wrap(inner, codes={"ai:skill:member.profile:run"})

    result = await wrapper.execute(
        AnyArgs(skill_id="member.profile"), make_ctx(_identity())
    )

    assert result.is_error is False
    assert inner.calls == 1
    assert resolver.hits == 1


async def test_e1_denies_without_code_and_has_no_side_effect() -> None:
    """TC-02 + TC-33：无码 → ToolResult(is_error) 且 **inner 调用次数 = 0**。"""
    inner = InnerTool(name="skill")
    wrapper, _ = _wrap(inner, codes=set())

    result = await wrapper.execute(
        AnyArgs(skill_id="member.profile"), make_ctx(_identity())
    )

    assert result.is_error is True
    assert inner.calls == 0, "被拒调用不得进入内层（零副作用）"
    acl = result.metadata["acl"]
    assert acl["code"] == "AI_SKILL_FORBIDDEN"
    assert acl["data"]["required_permission"] == "ai:skill:member.profile:run"


async def test_e1_denies_when_source_unavailable() -> None:
    """TC-11/12/14：源不可达 → AI_ACL_UNAVAILABLE，inner 不执行。"""
    inner = InnerTool(name="skill")
    wrapper, _ = _wrap(inner, unavailable=True)

    result = await wrapper.execute(
        AnyArgs(skill_id="member.profile"), make_ctx(_identity())
    )

    assert result.is_error is True
    assert result.metadata["acl"]["code"] == "AI_ACL_UNAVAILABLE"
    assert inner.calls == 0


async def test_e1_falls_back_to_name_argument() -> None:
    """OpenHarness ``SkillTool`` 入参字段名是 ``name`` —— 也须被判权覆盖。"""
    inner = InnerTool(name="skill")
    wrapper, _ = _wrap(inner, codes=set())

    result = await wrapper.execute(AnyArgs(name="member.profile"), make_ctx(_identity()))

    assert result.is_error is True
    assert inner.calls == 0
    assert result.metadata["acl"]["data"]["skill_id"] == "member.profile"


# ---------------------------------------------------------------------------
# 身份缺失 fail-closed（S9 决策 4）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "metadata",
    [
        pytest.param({}, id="no-metadata"),
        pytest.param({"identity": {}}, id="empty-identity"),
        pytest.param(
            {"identity": {"userId": "employee-42", "misUserId": ""}},
            id="userId-only-empty-misUserId",
        ),
        pytest.param(
            {"identity": {"userId": "1001"}},
            id="userId-numeric-no-misUserId",
        ),
    ],
)
async def test_missing_mis_user_id_is_fail_closed(metadata: dict[str, object]) -> None:
    """S9 决策 4：拿不到 misUserId → 拒绝；且**绝不回退 userId/userMobile**。"""
    inner = InnerTool(name="skill")
    wrapper, resolver = _wrap(inner, codes={"ai:skill:member.profile:run"})

    result = await wrapper.execute(AnyArgs(skill_id="member.profile"), make_ctx(metadata))

    assert result.is_error is True
    assert result.metadata["acl"]["code"] == "AI_SKILL_FORBIDDEN"
    assert inner.calls == 0
    assert resolver.hits == 0, "无 misUserId 时不得回源（横向越权防线）"


async def test_mis_user_id_is_passed_to_resolver() -> None:
    """透传到底：identity["misUserId"] 被真实喂给 resolver。"""
    inner = InnerTool(name="skill")
    wrapper, resolver = _wrap(inner, codes={"ai:skill:x:run"})

    await wrapper.execute(AnyArgs(skill_id="x"), make_ctx(_identity(mis_user_id="20250806")))

    assert resolver.seen[0][0] == 20250806


# ---------------------------------------------------------------------------
# E2 · MCP 三档解析（#5 / #16）
# ---------------------------------------------------------------------------


async def test_e2_tier1_uses_raw_tool_info_not_display_name() -> None:
    """TC-46：判权名取 ``_tool_info`` 原始名 ``mcp-member.profile-query``。"""
    inner = McpInnerTool("member.profile", "query", "mcp__member_profile__query")
    registry = FakeRegistry({"mcp-member.profile-query": "mcp-member.profile-query"})
    wrapper, _ = _wrap(
        inner, codes={"ai:skill:mcp-member.profile-query:run"}, registry=registry
    )

    result = await wrapper.execute(AnyArgs(), make_ctx(_identity()))

    assert result.is_error is False
    assert inner.calls == 1
    # 关键：查表用的是判别名（点号原样），不是展示名
    assert registry.queried == ["mcp-member.profile-query"]
    assert "mcp__member_profile__query" not in registry.queried


async def test_e2_never_reverse_parses_display_name() -> None:
    """#16 铁律：严禁从 ``self.name`` 反解 / split("__") 得到判别名。"""
    inner = McpInnerTool("member.profile", "query", "mcp__member_profile__query")
    registry = FakeRegistry()
    wrapper, _ = _wrap(inner, codes=set(), registry=registry)

    await wrapper.execute(AnyArgs(), make_ctx(_identity()))

    for queried in registry.queried:
        assert "__" not in queried, f"疑似从展示名反解: {queried}"
        assert queried == "mcp-member.profile-query"


async def test_tc47_dot_and_underscore_servers_do_not_cross_match() -> None:
    """TC-47（越权重灾区）：净化后同展示名，判别名必须各归各位。"""
    registry = FakeRegistry(
        {
            "mcp-member.profile-query": "mcp-member.profile-query",
            "mcp-member_profile-query": "mcp-member_profile-query",
        }
    )

    dotted = McpInnerTool("member.profile", "query", "mcp__member_profile__query")
    scored = McpInnerTool("member_profile", "query", "mcp__member_profile__query")
    # 两者展示名确实撞车 —— 这正是必须靠原始名区分的原因
    assert dotted.name == scored.name

    w1, _ = _wrap(dotted, codes={"ai:skill:mcp-member.profile-query:run"}, registry=registry)
    w2, _ = _wrap(scored, codes={"ai:skill:mcp-member.profile-query:run"}, registry=registry)

    r1 = await w1.execute(AnyArgs(), make_ctx(_identity()))
    r2 = await w2.execute(AnyArgs(), make_ctx(_identity()))

    assert r1.is_error is False, "点号 server 应命中自己的码"
    assert r2.is_error is True, "下划线 server 不得借用点号 server 的码（跨站越权）"
    assert r2.metadata["acl"]["data"]["skill_id"] == "mcp-member_profile-query"


async def test_e2_tier2_falls_back_to_ai_mcp_call() -> None:
    """TC-04：registry 未命中 → 退判 ``ai:mcp:call``（V22 执行码，Q7 方案 B+）。"""
    inner = McpInnerTool("unknown", "x", "mcp__unknown__x")
    wrapper, _ = _wrap(inner, codes={"ai:mcp:call"}, registry=FakeRegistry())

    result = await wrapper.execute(AnyArgs(), make_ctx(_identity()))

    assert result.is_error is False
    assert inner.calls == 1


async def test_e2_tier3_denies_and_names_server_and_tool() -> None:
    """TC-04b：三档皆失 → 拒绝，且 output 显式带 server + tool 名。"""
    inner = McpInnerTool("crm", "lookup", "mcp__crm__lookup")
    wrapper, _ = _wrap(inner, codes=set(), registry=FakeRegistry())

    result = await wrapper.execute(AnyArgs(), make_ctx(_identity()))

    assert result.is_error is True
    assert inner.calls == 0
    assert "crm" in result.output and "lookup" in result.output, (
        "运维需据此补码，output 必须点名 server/tool"
    )
    data = result.metadata["acl"]["data"]
    assert data["server"] == "crm"
    assert data["tool"] == "lookup"


async def test_e2_missing_tool_info_is_fail_closed() -> None:
    """MCP 展示名但取不到 ``_tool_info`` → 拒绝，不退回反解。"""
    inner = InnerTool(name="mcp__crm__lookup")  # 无 _tool_info
    wrapper, resolver = _wrap(inner, codes={"ai:mcp:call"}, registry=FakeRegistry())

    result = await wrapper.execute(AnyArgs(), make_ctx(_identity()))

    assert result.is_error is True
    assert inner.calls == 0
    assert result.metadata["acl"]["code"] == "AI_SKILL_FORBIDDEN"
    assert resolver.hits == 0, "结构异常应直接拒，不必回源"


async def test_e2_ignores_business_skill_id_argument() -> None:
    """MCP 入参里恰好有 skill_id 业务字段时，**不得**拿它判权。"""
    inner = McpInnerTool("crm", "lookup", "mcp__crm__lookup")
    registry = FakeRegistry()
    wrapper, _ = _wrap(inner, codes={"ai:skill:attacker-controlled:run"}, registry=registry)

    result = await wrapper.execute(
        AnyArgs(skill_id="attacker-controlled"), make_ctx(_identity())
    )

    assert result.is_error is True, "LLM 可控入参不得成为判权依据"
    assert inner.calls == 0


def test_e2_resolve_skill_ids_returns_deny_sentinel() -> None:
    """``_resolve_skill_ids`` 对结构异常返回 DENY 哨兵（spec §2.3 签名）。"""
    inner = InnerTool(name="mcp__crm__lookup")
    wrapper, _ = _wrap(inner)
    assert wrapper._resolve_skill_ids(AnyArgs(), make_ctx()) == DENY_SENTINEL


# ---------------------------------------------------------------------------
# E3 / E4 · FormFill（args.skill_id）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tool_name", ["formfill__execute", "formfill__apply"])
async def test_e3_e4_denied_without_code(tool_name: str) -> None:
    """TC-06 / TC-08：FormFill 无码 → 拒绝且零副作用。"""
    inner = InnerTool(name=tool_name)
    wrapper, _ = _wrap(inner, codes=set())

    result = await wrapper.execute(AnyArgs(skill_id="user-fill"), make_ctx(_identity()))

    assert result.is_error is True
    assert inner.calls == 0
    assert result.metadata["acl"]["data"]["required_permission"] == "ai:skill:user-fill:run"


@pytest.mark.parametrize("tool_name", ["formfill__execute", "formfill__apply"])
async def test_e3_e4_allowed_with_code(tool_name: str) -> None:
    """TC-05 / TC-07：持 ``ai:skill:user-fill:run`` → 放行。"""
    inner = InnerTool(name=tool_name)
    wrapper, _ = _wrap(inner, codes={"ai:skill:user-fill:run"})

    result = await wrapper.execute(AnyArgs(skill_id="user-fill"), make_ctx(_identity()))

    assert result.is_error is False
    assert inner.calls == 1


# ---------------------------------------------------------------------------
# E5 · 委派工具跳过判权（#6 裁定）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tool_name", ["agent__invoke", "agent"])
async def test_e5_delegate_skips_skill_code_check(tool_name: str) -> None:
    """TC-09：E5 跳过 skill 码判定，直接委托下游（递归 fail-closed）。"""
    inner = InnerTool(name=tool_name)
    wrapper, resolver = _wrap(inner, codes=set())

    result = await wrapper.execute(AnyArgs(agent_id="crm-assistant"), make_ctx(_identity()))

    assert result.is_error is False
    assert inner.calls == 1
    assert resolver.hits == 0, "E5 本层不判 skill 码，不应回源"


def test_e5_resolve_returns_delegate_sentinel() -> None:
    """``_resolve_skill_ids`` 对 E5 返回 ``__delegate__``（spec §2.3）。"""
    wrapper, _ = _wrap(InnerTool(name="agent__invoke"))
    assert wrapper._resolve_skill_ids(AnyArgs(), make_ctx()) == DELEGATE_SENTINEL


async def test_e5_delegate_passes_through_even_without_identity() -> None:
    """E5 无身份也放行本层 —— 治理靠白名单 + 子 Agent 的 E1–E5。"""
    inner = InnerTool(name="agent__invoke")
    wrapper, _ = _wrap(inner, codes=set())

    result = await wrapper.execute(AnyArgs(), make_ctx({}))

    assert inner.calls == 1
    assert result.is_error is False
