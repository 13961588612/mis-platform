"""T03 · MCP 命名准入（§2.9）+ S9 misUserId 5 跳透传链（§3.4）。

对应 spec §5 TC-48、TC-49、TC-50，以及 S9 决策 1/2/3/4。
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest

from src.mcp.naming import (
    MCP_SERVER_NAME_PATTERN,
    McpServerNameError,
    assert_valid_mcp_server_name,
    is_valid_mcp_server_name,
)
from src.runtime.mcp_identity import (
    IDENTITY_ARG_KEYS,
    IDENTITY_HEADER_MAP,
    build_mcp_identity,
    identity_from_tool_metadata,
    merge_identity_into_args,
)
from src.runtime.tool_registry_builder import _sanitize_tool_segment

# ---------------------------------------------------------------------------
# 准入正则：合法名
# ---------------------------------------------------------------------------

VALID_NAMES: list[str] = [
    "crm",
    "member_profile",
    "member-profile",
    "CRM",
    "a",
    "a1",
    "Srv_2-x",
    "a" * 64,
]

INVALID_NAMES: list[str] = [
    "member.profile",  # TC-48：点号
    "1srv",            # TC-49：数字开头
    "_srv",            # TC-49：下划线开头（Q4 mcp_ 前缀分支）
    "-srv",            # 连字符开头
    "srv name",        # 空格
    "服务",             # 中文
    "srv/x",           # 斜杠
    "srv:x",           # 冒号
    "a" * 65,          # 超长
    "",                # 空串
]


@pytest.mark.parametrize("name", VALID_NAMES)
def test_valid_names_accepted(name: str) -> None:
    """合法名通过准入。"""
    assert is_valid_mcp_server_name(name) is True
    assert assert_valid_mcp_server_name(name) == name


@pytest.mark.parametrize("name", INVALID_NAMES)
def test_tc48_tc49_invalid_names_rejected(name: str) -> None:
    """TC-48 / TC-49：非法名一律拒绝，并抛可定位的异常。"""
    assert is_valid_mcp_server_name(name) is False
    with pytest.raises(McpServerNameError) as exc:
        assert_valid_mcp_server_name(name)
    assert MCP_SERVER_NAME_PATTERN in str(exc.value), "错误信息须指明允许字符集"


def test_none_name_rejected() -> None:
    """None 一律不合法（fail-closed）。"""
    assert is_valid_mcp_server_name(None) is False
    with pytest.raises(McpServerNameError):
        assert_valid_mcp_server_name(None)


# ---------------------------------------------------------------------------
# 不动点性质：通过准入的名字，净化后必须**零改写**
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", VALID_NAMES)
def test_valid_names_are_sanitize_fixed_points(name: str) -> None:
    """核心性质：准入正则 == 净化的不动点集合 ⇒ 展示名与判别名一一对应。"""
    assert _sanitize_tool_segment(name) == name


@pytest.mark.parametrize(
    ("left", "right"),
    [
        pytest.param("member.profile", "member_profile", id="dot-vs-underscore"),
        pytest.param("a.b", "a_b", id="short-dot-vs-underscore"),
        pytest.param("x y", "x_y", id="space-vs-underscore"),
    ],
)
def test_sanitize_collision_is_real_and_blocked_at_admission(left: str, right: str) -> None:
    """证明折叠冲突真实存在，且非法侧已被准入正则挡在门外。"""
    # 折叠冲突客观存在
    assert _sanitize_tool_segment(left) == _sanitize_tool_segment(right)
    # 但只有合法的一侧能进系统 ⇒ 运行期不会出现两个同展示名的 server
    assert is_valid_mcp_server_name(left) is False
    assert is_valid_mcp_server_name(right) is True


def test_digit_leading_name_would_get_mcp_prefix() -> None:
    """数字开头会被净化加 ``mcp_`` 前缀（非不动点）—— 故准入禁止之。"""
    assert _sanitize_tool_segment("1srv") == "mcp_1srv"
    assert is_valid_mcp_server_name("1srv") is False


# ---------------------------------------------------------------------------
# TC-50 · yaml loader 与 admin API 共用同一条正则
# ---------------------------------------------------------------------------


def test_tc50_loader_and_route_use_shared_validator() -> None:
    """TC-50：yaml loader 与 admin API 必须引用同一命名权威（防两套规则漂移）。"""
    import src.api.routes.mcp as mcp_route
    import src.mcp.loader as loader

    loader_src = inspect.getsource(loader)
    route_src = inspect.getsource(mcp_route)

    for name, source in (("loader.py", loader_src), ("routes/mcp.py", route_src)):
        assert (
            "mcp_server_name" in source or "McpServerName" in source
        ), f"{name} 未接入 MCP 命名准入校验"


# ---------------------------------------------------------------------------
# S9 决策 1 · misUserId 第五键
# ---------------------------------------------------------------------------


def test_s9_identity_has_five_keys() -> None:
    """决策 1：identity 恒为五键，且 misUserId 在列。"""
    assert IDENTITY_ARG_KEYS == (
        "userId",
        "userMobile",
        "channel",
        "channelUserId",
        "misUserId",
    )
    assert set(build_mcp_identity().keys()) == set(IDENTITY_ARG_KEYS)


def test_s9_mis_user_id_not_leaked_to_http_headers() -> None:
    """决策 1：misUserId **不得**进 HTTP Header（防身份主键外泄）。"""
    assert "misUserId" not in IDENTITY_HEADER_MAP
    assert all("Mis" not in h for h in IDENTITY_HEADER_MAP.values())


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        pytest.param(1001, "1001", id="int"),
        pytest.param("1001", "1001", id="str"),
        pytest.param(None, "", id="none"),
        pytest.param("", "", id="empty"),
        pytest.param("  1001  ", "1001", id="whitespace-trimmed"),
    ],
)
def test_s9_build_identity_normalizes_mis_user_id(raw: Any, expected: str) -> None:
    """第五键统一为字符串；None/空 → 空串（下游 fail-closed）。"""
    assert build_mcp_identity(mis_user_id=raw)["misUserId"] == expected


def test_s9_build_identity_does_not_touch_legacy_keys() -> None:
    """决策 1：不动老 4 键（向后兼容）。"""
    identity = build_mcp_identity(
        user_id="u1", user_mobile="138", channel="wecom", channel_user_id="c1"
    )
    assert identity["userId"] == "u1"
    assert identity["userMobile"] == "138"
    assert identity["channel"] == "wecom"
    assert identity["channelUserId"] == "c1"


@pytest.mark.parametrize("key", ["misUserId", "mis_user_id"])
def test_s9_identity_from_metadata_reads_both_cases(key: str) -> None:
    """消费侧同时认 camelCase 与 snake_case。"""
    assert identity_from_tool_metadata({"identity": {key: "1001"}})["misUserId"] == "1001"
    assert identity_from_tool_metadata({key: "1001"})["misUserId"] == "1001"


def test_s9_identity_from_empty_metadata_is_blank() -> None:
    """无 metadata → 五键空串身份（下游一律拒）。"""
    assert identity_from_tool_metadata(None)["misUserId"] == ""
    assert identity_from_tool_metadata({})["misUserId"] == ""


def test_s9_merge_identity_into_args_includes_fifth_key() -> None:
    """注入 MCP arguments 的 identity 对象含五键。"""
    merged = merge_identity_into_args({"apiName": "x"}, build_mcp_identity(mis_user_id=7))
    assert merged["identity"]["misUserId"] == "7"
    assert set(merged["identity"].keys()) == set(IDENTITY_ARG_KEYS)


# ---------------------------------------------------------------------------
# S9 决策 2 · 5 跳透传链（签名级静态断言，一处漏则断）
# ---------------------------------------------------------------------------


def test_s9_hop1_session_carries_mis_user_id() -> None:
    """跳 ①：``Session.__init__`` / ``create_session`` / ``ensure_session`` 均带形参。"""
    from src.agent.session import Session, SessionManager

    assert "mis_user_id" in inspect.signature(Session.__init__).parameters
    assert "mis_user_id" in inspect.signature(SessionManager.create_session).parameters
    assert "mis_user_id" in inspect.signature(SessionManager.ensure_session).parameters


def test_s9_hop1_session_roundtrip_serialization() -> None:
    """跳 ①：``to_dict`` 序列化 mis_user_id（会话恢复不丢第五键）。"""
    from src.agent.session import Session

    session = Session(
        session_id="s1", agent_id="a1", user_id="u1", channel="web", mis_user_id=1001
    )
    assert session.to_dict()["mis_user_id"] == 1001


def test_s9_hop3_openharness_run_accepts_mis_user_id() -> None:
    """跳 ③：``OpenHarnessRuntime.run`` 带 mis_user_id 形参。"""
    from src.runtime.openharness import OpenHarnessRuntime

    assert "mis_user_id" in inspect.signature(OpenHarnessRuntime.run).parameters


def test_s9_hop4_builder_accepts_mis_user_id() -> None:
    """跳 ④：``build_native_query_engine`` 带 mis_user_id 形参。"""
    from src.runtime.oh_runtime_builder import build_native_query_engine

    assert "mis_user_id" in inspect.signature(build_native_query_engine).parameters


def test_s9_hop5_build_mcp_identity_accepts_mis_user_id() -> None:
    """跳 ⑤：``build_mcp_identity`` 带 mis_user_id 形参。"""
    assert "mis_user_id" in inspect.signature(build_mcp_identity).parameters


def test_s9_hop2_manager_forwards_session_mis_user_id() -> None:
    """跳 ②：Manager 把 ``session.mis_user_id`` 传给 runtime.run（源码级断言）。"""
    import src.agent.manager as manager

    assert "mis_user_id=session.mis_user_id" in inspect.getsource(manager).replace(" ", "")


def test_s9_hop3_openharness_forwards_to_builder() -> None:
    """跳 ③→④：OpenHarness 把 mis_user_id 透传给 builder。"""
    import src.runtime.openharness as openharness

    assert "mis_user_id=mis_user_id" in inspect.getsource(openharness).replace(" ", "")


def test_s9_hop4_builder_forwards_to_identity() -> None:
    """跳 ④→⑤：builder 把 mis_user_id 透传给 build_mcp_identity。"""
    import src.runtime.oh_runtime_builder as builder

    assert "mis_user_id=mis_user_id" in inspect.getsource(builder).replace(" ", "")


def test_s9_full_chain_end_to_end() -> None:
    """5 跳合流：Session 起点的 mis_user_id 最终出现在 identity 第五键。"""
    from src.agent.session import Session

    session = Session(
        session_id="s1",
        agent_id="a1",
        user_id="wecom_u1",
        channel="wecom_bot",
        mis_user_id=1001,
    )
    # 模拟 ②③④ 的逐跳透传（各跳签名已在上方断言存在）
    identity = build_mcp_identity(
        user_id=session.user_id,
        channel=session.channel,
        mis_user_id=session.mis_user_id,
    )
    assert identity["misUserId"] == "1001"
    # 消费侧（tool_registry_builder → AclToolWrapper）能读回
    assert identity_from_tool_metadata({"identity": identity})["misUserId"] == "1001"


def test_s9_unresolved_session_yields_blank_fifth_key() -> None:
    """企微未绑定：session.mis_user_id=None → 第五键空串 → 下游 fail-closed。"""
    from src.agent.session import Session

    session = Session(session_id="s1", agent_id="a1", user_id="wecom_u1", channel="wecom_bot")
    assert session.mis_user_id is None
    assert build_mcp_identity(mis_user_id=session.mis_user_id)["misUserId"] == ""
