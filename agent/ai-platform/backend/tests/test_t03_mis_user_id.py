"""T03 · `identity/mis_user_id.py` —— MIS userId 三档解析。

对应 spec §2.8 / #15-a / §5 TC-43（RS256 档1）、TC-44（HS256 未绑定拒）、
TC-45（HS256 已绑定放行）。

**核心红线**：严禁返回顶层 ``user_id``（= employeeId / 企微 userid）。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from src.identity.mis_user_id import resolve_mis_user_id, resolve_mis_user_id_async


class FakeQuery:
    """同步 SQLAlchemy ``db.query(...).filter(...).first()`` 链的替身。"""

    def __init__(self, row: tuple[Any, ...] | None) -> None:
        self._row = row

    def filter(self, *args: Any, **kwargs: Any) -> "FakeQuery":
        """忽略条件，直接返回自身。"""
        return self

    def first(self) -> tuple[Any, ...] | None:
        """返回预置行。"""
        return self._row


class FakeDb:
    """同步 DB 会话替身，记录是否被查询。"""

    def __init__(self, row: tuple[Any, ...] | None = None, raises: bool = False) -> None:
        self._row = row
        self._raises = raises
        self.queried = 0

    def query(self, *args: Any, **kwargs: Any) -> FakeQuery:
        """记录一次查询并返回链式替身。"""
        self.queried += 1
        if self._raises:
            raise RuntimeError("DB down")
        return FakeQuery(self._row)


# ---------------------------------------------------------------------------
# 红线：绝不返回顶层 user_id
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "identity",
    [
        pytest.param({"user_id": "1001"}, id="plain-user-id"),
        pytest.param({"userId": "1001"}, id="camel-user-id"),
        pytest.param({"user_id": 1001, "channel": "web"}, id="int-user-id"),
        pytest.param({"user_id": "E12345", "channel": "reverse_trust"}, id="employee-id"),
        pytest.param({"mis": True, "user_id": "1001", "profile": {}}, id="rs256-no-profile"),
        pytest.param(
            {"mis": True, "user_id": "1001", "profile": {"mis_user_id": None}},
            id="rs256-null-profile-mis-uid",
        ),
    ],
)
def test_never_returns_top_level_user_id(identity: dict[str, Any]) -> None:
    """无 DB 时，任何形态的顶层 user_id 都不得被当成 MIS userId 返回。"""
    assert resolve_mis_user_id(identity, db=None) is None


def test_rs256_missing_profile_mis_user_id_is_none() -> None:
    """档 1：RS256 但 profile 缺 mis_user_id → None（不回退 employeeId）。"""
    identity = {"mis": True, "user_id": "E9999", "profile": {"tenant_id": "t1"}}
    assert resolve_mis_user_id(identity) is None


def test_mis_identity_never_downgrades_to_wecom_lookup() -> None:
    """档 1 一旦成立就不再降档 —— 不得拿 MIS 身份去查企微绑定表。"""
    db = FakeDb(row=(777,))
    identity = {"mis": True, "user_id": "E9999", "profile": {}}

    assert resolve_mis_user_id(identity, db=db) is None
    assert db.queried == 0, "MIS 身份不应触发企微查库"


# ---------------------------------------------------------------------------
# 档 1 · RS256（MIS JWT）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "identity",
    [
        pytest.param(
            {"mis": True, "user_id": "E1", "profile": {"mis_user_id": 1001}},
            id="mis-flag-int",
        ),
        pytest.param(
            {"mis": True, "user_id": "E1", "profile": {"mis_user_id": "1001"}},
            id="mis-flag-str",
        ),
        pytest.param(
            {"channel": "mis_bff", "user_id": "E1", "profile": {"mis_user_id": "1001"}},
            id="channel-mis-bff",
        ),
        pytest.param(
            {"user_id": "E1", "profile": {"mis_user_id": "1001"}},
            id="profile-only",
        ),
    ],
)
def test_tc43_rs256_reads_profile_mis_user_id(identity: dict[str, Any]) -> None:
    """TC-43：档 1 从 ``profile["mis_user_id"]`` 取真 MIS userId。"""
    assert resolve_mis_user_id(identity) == 1001


def test_rs256_works_on_object_identity() -> None:
    """对象型身份（``UserContext`` 风格）同样支持。"""
    identity = SimpleNamespace(mis=True, user_id="E1", profile={"mis_user_id": 2002})
    assert resolve_mis_user_id(identity) == 2002


# ---------------------------------------------------------------------------
# 档 0 · 已解析直取（S9 misUserId 第五键回传）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("identity", "expected"),
    [
        pytest.param({"misUserId": "1001"}, 1001, id="camel"),
        pytest.param({"mis_user_id": 1001}, 1001, id="snake"),
        pytest.param({"misUserId": 1001, "userId": "E1"}, 1001, id="prefer-mis-over-user"),
    ],
)
def test_tier0_direct_mis_user_id(identity: dict[str, Any], expected: int) -> None:
    """档 0：身份上已带 misUserId（工具层第五键）→ 原样返回。"""
    assert resolve_mis_user_id(identity) == expected


# ---------------------------------------------------------------------------
# 档 2 · HS256（企微）查库
# ---------------------------------------------------------------------------


def test_tc44_wecom_unbound_is_fail_closed() -> None:
    """TC-44：企微用户未绑定（查不到行）→ None（不回退企微 userid）。"""
    db = FakeDb(row=None)
    assert resolve_mis_user_id({"user_id": "wecom_zhangsan"}, db=db) is None
    assert db.queried == 1


def test_tc44_wecom_bound_but_null_column_is_none() -> None:
    """查到行但 ``mis_user_id`` 为 NULL（加列未回填）→ None。"""
    assert resolve_mis_user_id({"user_id": "wecom_zhangsan"}, db=FakeDb(row=(None,))) is None


def test_tc45_wecom_bound_returns_mis_user_id() -> None:
    """TC-45：企微已绑定 → 返回库中 MIS userId。"""
    assert resolve_mis_user_id({"user_id": "wecom_zhangsan"}, db=FakeDb(row=(3003,))) == 3003


def test_wecom_without_db_is_fail_closed() -> None:
    """无 DB 会话（工具层链路）→ 档 2 直接 None，不猜测。"""
    assert resolve_mis_user_id({"user_id": "wecom_zhangsan"}, db=None) is None


def test_db_error_degrades_to_none() -> None:
    """DB 异常 → 降级为「解析不出」，不抛、不放行。"""
    assert resolve_mis_user_id({"user_id": "wecom_x"}, db=FakeDb(raises=True)) is None


# ---------------------------------------------------------------------------
# 档 3 · 反向信任 / 空身份
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "identity",
    [
        pytest.param(None, id="none"),
        pytest.param({}, id="empty"),
        pytest.param({"channel": "reverse_trust"}, id="reverse-trust-no-uid"),
        pytest.param({"userMobile": "13800000000"}, id="mobile-only"),
    ],
)
def test_tier3_and_empty_identity_return_none(identity: Any) -> None:
    """档 3 / 空身份 → None（fail-closed）。"""
    assert resolve_mis_user_id(identity) is None


# ---------------------------------------------------------------------------
# 类型安全边界
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(True, id="bool-true"),
        pytest.param(0, id="zero"),
        pytest.param(-1, id="negative"),
        pytest.param("abc", id="non-numeric"),
        pytest.param("", id="empty-string"),
        pytest.param("  ", id="whitespace"),
    ],
)
def test_invalid_mis_user_id_values_rejected(raw: Any) -> None:
    """非法 misUserId（bool / 0 / 负数 / 非数字）一律 None，不得误判为身份。"""
    assert resolve_mis_user_id({"mis": True, "profile": {"mis_user_id": raw}}) is None


def test_numeric_string_with_whitespace_is_accepted() -> None:
    """带空白的数字串正常解析（Redis 反序列化容错）。"""
    assert resolve_mis_user_id({"misUserId": " 1001 "}) == 1001


# ---------------------------------------------------------------------------
# 异步版语义一致性
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("identity", "expected"),
    [
        pytest.param({"mis": True, "profile": {"mis_user_id": 1001}}, 1001, id="tier1"),
        pytest.param({"misUserId": "2002"}, 2002, id="tier0"),
        pytest.param({"user_id": "1001"}, None, id="top-level-user-id-rejected"),
        pytest.param(None, None, id="none"),
        pytest.param({}, None, id="empty"),
    ],
)
async def test_async_matches_sync_semantics(identity: Any, expected: int | None) -> None:
    """异步版在档 0/1/3 上与同步版语义完全一致。"""
    assert await resolve_mis_user_id_async(identity, db=None) == expected
    assert resolve_mis_user_id(identity, db=None) == expected
