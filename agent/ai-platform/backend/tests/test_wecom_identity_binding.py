"""?????????????wecom-user-binding-design.md ?13.1??

???
- ?????? active / disabled?
- ????????? exact-one ?????
- not_found / ambiguous fail-closed ??????
- manual ?? auto_phone ???
- corp ? mis_user ?????????
- ????????? hash + masked??

DB-free????? session ??????????? aiosqlite/asyncpg?
"""

from __future__ import annotations

from typing import Any

import pytest

from src.channels.wecom_binding_errors import PhoneLookupResult
from src.channels.wecom_binding_service import (
    WecomIdentityInput,
    WecomUserBindingService,
    mask_phone,
    phone_hash,
)
from src.models.wecom_binding import (
    BIND_SOURCE_AUTO_PHONE,
    BIND_SOURCE_MANUAL,
    BIND_STATUS_ACTIVE,
    BIND_STATUS_DISABLED,
    WecomIdentityBinding,
    utcnow,
)


class _FakePhoneLookup:
    def __init__(self, result: PhoneLookupResult) -> None:
        self._result = result
        self.calls: list[tuple[int, str]] = []

    async def lookup(self, tenant_id: int, phone: str) -> PhoneLookupResult:
        self.calls.append((tenant_id, phone))
        return self._result


class _FakeContacts:
    def __init__(self, mobile: str = "") -> None:
        self._mobile = mobile
        self.calls = 0

    async def get_user_mobile(self, corp_id: str, wecom_user_id: str) -> str:
        self.calls += 1
        return self._mobile


class _FakeCorpStore:
    def __init__(self, corp_id: str, tenant_id: int, mode: str) -> None:
        from src.channels.wecom_corp_store import WecomCorpRecord

        self._record = WecomCorpRecord(
            corp_id=corp_id, tenant_id=tenant_id, user_bind_mode=mode
        )

    def get(self, corp_id: str) -> Any:
        return self._record if corp_id == self._record.corp_id else None


class _MemSession:
    def __init__(self) -> None:
        self.rows: list[WecomIdentityBinding] = []

    def add(self, row: WecomIdentityBinding) -> None:
        self.rows.append(row)

    async def flush(self) -> None:
        return None


class _TestService(WecomUserBindingService):
    def __init__(self, session: _MemSession, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._session = session

    async def _get_binding(self, db, corp_id, wecom_user_id):  # noqa: ANN001
        for r in self._session.rows:
            if r.corp_id == corp_id and r.wecom_user_id == wecom_user_id:
                return r
        return None

    async def _get_binding_by_mis(self, db, corp_id, mis_user_id):  # noqa: ANN001
        for r in self._session.rows:
            if r.corp_id == corp_id and r.mis_user_id == mis_user_id:
                return r
        return None

    async def _create_binding(self, db, **kw):  # noqa: ANN003
        # 服务层传入 source=/phone=；映射到 ORM 列 bind_source/phone_hash/phone_masked。
        source = kw.pop("source")
        phone = kw.pop("phone", "")
        row = WecomIdentityBinding(
            **kw,
            bind_source=source,
            status=BIND_STATUS_ACTIVE,
            phone_hash=phone_hash(phone) if phone else None,
            phone_masked=mask_phone(phone) if phone else None,
            last_verified_at=utcnow(),
        )
        self._session.add(row)
        return row


def _make(lookup_result, *, mobile="", mode="auto_phone", corp="ww-1", tenant=1):
    session = _MemSession()
    lookup = _FakePhoneLookup(lookup_result)
    contacts = _FakeContacts(mobile)
    svc = _TestService(
        session,
        phone_lookup=lookup,
        contacts=contacts,
        corp_store=_FakeCorpStore(corp, tenant, mode),
    )
    return svc, session, lookup, contacts


@pytest.mark.asyncio
async def test_first_message_auto_binds_by_phone() -> None:
    svc, session, lookup, _ = _make(
        PhoneLookupResult(matched=True, user_id=1001, username="zhangsan")
    )
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan",
            user_mobile="13800000000",
        ),
    )
    assert resolved == 1001
    assert lookup.calls == [(1, "13800000000")]
    assert len(session.rows) == 1
    row = session.rows[0]
    assert row.bind_source == BIND_SOURCE_AUTO_PHONE
    assert row.phone_hash == phone_hash("13800000000")
    assert row.phone_masked == "138****0000"
    assert "13800000000" not in str(row.phone_hash) + str(row.phone_masked)


@pytest.mark.asyncio
async def test_second_message_hits_local_binding_without_phone_lookup() -> None:
    svc, session, lookup, _ = _make(
        PhoneLookupResult(matched=True, user_id=1001, username="zhangsan")
    )
    await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan",
            user_mobile="13800000000",
        ),
    )
    lookup.calls.clear()
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan"),
    )
    assert resolved == 1001
    assert lookup.calls == []


@pytest.mark.asyncio
async def test_not_found_fail_closed_and_no_binding() -> None:
    svc, session, _, _ = _make(PhoneLookupResult(matched=False, reason="not_found"))
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="ghost",
            user_mobile="13800000001",
        ),
    )
    assert resolved is None
    assert session.rows == []


@pytest.mark.asyncio
async def test_ambiguous_fail_closed() -> None:
    svc, session, _, _ = _make(PhoneLookupResult(matched=False, reason="ambiguous"))
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="dup",
            user_mobile="13800000002",
        ),
    )
    assert resolved is None
    assert session.rows == []


@pytest.mark.asyncio
async def test_contacts_fetch_mobile_when_inbound_missing() -> None:
    svc, _, lookup, contacts = _make(
        PhoneLookupResult(matched=True, user_id=2002, username="lisi"),
        mobile="13900000000",
    )
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(corp_id="ww-1", tenant_id=1, wecom_user_id="lisi"),
    )
    assert resolved == 2002
    assert contacts.calls == 1
    assert lookup.calls == [(1, "13900000000")]


@pytest.mark.asyncio
async def test_manual_mode_does_not_auto_bind() -> None:
    svc, session, lookup, _ = _make(
        PhoneLookupResult(matched=True, user_id=1001), mode="manual_only"
    )
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan",
            user_mobile="13800000000",
        ),
    )
    assert resolved is None
    assert lookup.calls == []
    assert session.rows == []


@pytest.mark.asyncio
async def test_disabled_binding_not_auto_reborn() -> None:
    svc, session, lookup, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    session.add(
        WecomIdentityBinding(
            corp_id="ww-1", wecom_user_id="zhangsan", tenant_id=1,
            mis_user_id=1001, bind_source="manual",
            status=BIND_STATUS_DISABLED, last_verified_at=utcnow(),
        )
    )
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan",
            user_mobile="13800000000",
        ),
    )
    assert resolved is None
    assert lookup.calls == []


@pytest.mark.asyncio
async def test_manual_not_overwritten_by_auto() -> None:
    svc, session, lookup, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    session.add(
        WecomIdentityBinding(
            corp_id="ww-1", wecom_user_id="zhangsan", tenant_id=1,
            mis_user_id=9009, bind_source="manual",
            status=BIND_STATUS_ACTIVE, last_verified_at=utcnow(),
        )
    )
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan",
            user_mobile="13800000000",
        ),
    )
    assert resolved == 9009
    assert lookup.calls == []


@pytest.mark.asyncio
async def test_mis_user_conflict_rejected() -> None:
    svc, session, _, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    session.add(
        WecomIdentityBinding(
            corp_id="ww-1", wecom_user_id="other", tenant_id=1,
            mis_user_id=1001, bind_source="sync",
            status=BIND_STATUS_ACTIVE, last_verified_at=utcnow(),
        )
    )
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan",
            user_mobile="13800000000",
        ),
    )
    assert resolved is None


@pytest.mark.asyncio
async def test_missing_corp_or_user_returns_none() -> None:
    svc, _, _, _ = _make(PhoneLookupResult(matched=True, user_id=1))
    assert await svc.resolve(
        None, WecomIdentityInput(corp_id="", tenant_id=1, wecom_user_id="x")
    ) is None
    assert await svc.resolve(
        None, WecomIdentityInput(corp_id="ww-1", tenant_id=1, wecom_user_id="")
    ) is None


def test_mask_phone() -> None:
    assert mask_phone("13800000000") == "138****0000"
    assert mask_phone("123") == ""

# ---------------------------------------------------------------------------
# P4 运营台：人工绑定 / 解绑 / 校验（wecom-user-binding-design.md §11）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_bind_creates_manual_source() -> None:
    svc, session, lookup, _ = _make(PhoneLookupResult(matched=True, user_id=1))
    row = await svc.manual_bind(
        session,
        corp_id="ww-1",
        wecom_user_id="zhangsan",
        tenant_id=1,
        mis_user_id=1001,
        phone="13800000000",
    )
    assert row.bind_source == BIND_SOURCE_MANUAL
    assert row.status == BIND_STATUS_ACTIVE
    assert row.mis_user_id == 1001
    assert row.phone_masked == "138****0000"
    assert len(session.rows) == 1


@pytest.mark.asyncio
async def test_manual_bind_overrides_auto_phone() -> None:
    svc, session, lookup, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    session.add(
        WecomIdentityBinding(
            corp_id="ww-1", wecom_user_id="zhangsan", tenant_id=1,
            mis_user_id=1001, bind_source=BIND_SOURCE_AUTO_PHONE,
            status=BIND_STATUS_ACTIVE, last_verified_at=utcnow(),
        )
    )
    row = await svc.manual_bind(
        session, corp_id="ww-1", wecom_user_id="zhangsan",
        tenant_id=1, mis_user_id=2002,
    )
    assert row.bind_source == BIND_SOURCE_MANUAL
    assert row.mis_user_id == 2002
    assert len(session.rows) == 1


@pytest.mark.asyncio
async def test_unbind_sets_disabled_and_blocks_auto_reborn() -> None:
    svc, session, lookup, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    await svc.manual_bind(
        session, corp_id="ww-1", wecom_user_id="zhangsan",
        tenant_id=1, mis_user_id=1001,
    )
    assert await svc.unbind(session, corp_id="ww-1", wecom_user_id="zhangsan") is True
    assert session.rows[0].status == BIND_STATUS_DISABLED
    # 解绑后不会自动重生
    lookup.calls.clear()
    resolved = await svc.resolve(
        None,
        WecomIdentityInput(
            corp_id="ww-1", tenant_id=1, wecom_user_id="zhangsan",
            user_mobile="13800000000",
        ),
    )
    assert resolved is None
    assert lookup.calls == []


@pytest.mark.asyncio
async def test_unbind_missing_returns_false() -> None:
    svc, session, _, _ = _make(PhoneLookupResult(matched=False))
    assert await svc.unbind(session, corp_id="ww-1", wecom_user_id="ghost") is False


@pytest.mark.asyncio
async def test_verify_refreshes_last_verified_at() -> None:
    svc, session, _, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    row = await svc.manual_bind(
        session, corp_id="ww-1", wecom_user_id="zhangsan",
        tenant_id=1, mis_user_id=1001,
    )
    before = row.last_verified_at
    row.last_verified_at = None
    verified = await svc.verify(session, corp_id="ww-1", wecom_user_id="zhangsan")
    assert verified is row
    assert verified.last_verified_at is not None
    assert before is not None


@pytest.mark.asyncio
async def test_verify_missing_returns_none() -> None:
    svc, session, _, _ = _make(PhoneLookupResult(matched=False))
    assert await svc.verify(session, corp_id="ww-1", wecom_user_id="ghost") is None

# ---------------------------------------------------------------------------
# P5 同步回填：只对未绑定用户、手机号 exact-one 才落 sync 绑定
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backfill_binds_only_exact_one_unbound() -> None:
    svc, session, lookup, _ = _make(
        PhoneLookupResult(matched=True, user_id=1001, username="zhangsan")
    )
    stats = await svc.backfill_from_entries(
        session,
        corp_id="ww-1",
        tenant_id=1,
        entries=[("zhangsan", "13800000000")],
    )
    assert stats["bound"] == 1
    assert session.rows[0].bind_source == "sync"
    assert session.rows[0].mis_user_id == 1001


@pytest.mark.asyncio
async def test_backfill_skips_existing_binding() -> None:
    svc, session, lookup, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    session.add(
        WecomIdentityBinding(
            corp_id="ww-1", wecom_user_id="zhangsan", tenant_id=1,
            mis_user_id=9009, bind_source=BIND_SOURCE_MANUAL,
            status=BIND_STATUS_ACTIVE, last_verified_at=utcnow(),
        )
    )
    lookup.calls.clear()
    stats = await svc.backfill_from_entries(
        session, corp_id="ww-1", tenant_id=1,
        entries=[("zhangsan", "13800000000")],
    )
    assert stats["skipped"] == 1
    assert stats["bound"] == 0
    assert lookup.calls == []  # 已绑定时不查手机号
    assert session.rows[0].mis_user_id == 9009


@pytest.mark.asyncio
async def test_backfill_unmatched_and_conflict() -> None:
    svc, session, lookup, _ = _make(PhoneLookupResult(matched=False, reason="not_found"))
    stats = await svc.backfill_from_entries(
        session, corp_id="ww-1", tenant_id=1,
        entries=[("ghost", "13800000000"), ("nophone", "")],
    )
    assert stats["unmatched"] == 2
    assert stats["bound"] == 0

    # mis_user 已在同 corp 绑了别人 → 冲突，不绑定
    svc2, session2, _, _ = _make(PhoneLookupResult(matched=True, user_id=1001))
    session2.add(
        WecomIdentityBinding(
            corp_id="ww-1", wecom_user_id="other", tenant_id=1,
            mis_user_id=1001, bind_source="sync",
            status=BIND_STATUS_ACTIVE, last_verified_at=utcnow(),
        )
    )
    stats2 = await svc2.backfill_from_entries(
        session2, corp_id="ww-1", tenant_id=1,
        entries=[("zhangsan", "13800000000")],
    )
    assert stats2["conflict"] == 1
    assert stats2["bound"] == 0