"""HITL 双 store 的 Redis 后端测试（Phase 1：多副本故障接管开关）。

核心验证：副本 A 写入 → 副本 B（独立 store 实例、共享同一 Redis）可读，
即跨副本可恢复挂起态。覆盖：
- ApprovalStore：跨副本可见 / 更新跨副本可见 / TTL 过期 / delete
- FormFillPendingStore：跨副本可见 / TTL 过期 / delete
- resume_formfill：接管副本经共享 Redis 取回挂起任务并续跑（端到端）

使用 ``fakeredis`` 模拟共享 Redis（无真实 Redis 依赖），并以两个独立 store
实例共享同一 fakeredis 后端来精确模拟「副本 A / 副本 B」。
"""

from __future__ import annotations

import asyncio

import pytest
from fakeredis.aioredis import FakeRedis as FakeRedisAsync

from src.hitl.store import ApprovalStore, ApprovalRecord, ApprovalStatus
from src.hitl.formfill_pending import (
    FormFillPendingStore,
    FormFillPendingRecord,
    FormFillStatus,
    get_formfill_pending_store,
    reset_formfill_pending_store,
)
from src.hitl._redis import set_hitl_redis, reset_hitl_redis

import src.skills.tools.formfill_execute as ff_mod
import src.skills.tools.formfill_apply as fa_mod


@pytest.fixture
def redis_pair():
    """两个独立 store 实例共享同一 fake Redis —— 模拟副本 A / 副本 B。"""
    r = FakeRedisAsync(decode_responses=True)
    set_hitl_redis(r)
    reset_formfill_pending_store()
    yield ApprovalStore(redis=r), FormFillPendingStore(redis=r), r
    reset_hitl_redis()
    reset_formfill_pending_store()


# ============================================================================
# ApprovalStore
# ============================================================================


async def test_approval_cross_replica_visible(redis_pair):
    """副本 A 写入、副本 B（独立实例）可读；状态更新跨副本可见。"""
    a_store, _, r = redis_pair
    b_store = ApprovalStore(redis=r)  # 副本 B：独立实例 + 共享 Redis

    rec = await a_store.create(
        session_id="s1", agent_id="a1", skill_id="sk", user_id="u1",
        detail={"title": "审批采购单"},
    )
    got = await b_store.get(rec.approval_id)
    assert got is not None
    assert got.approval_id == rec.approval_id
    assert got.detail == {"title": "审批采购单"}

    # 副本 B 更新状态，副本 A 可读到
    await b_store.update_status(rec.approval_id, ApprovalStatus.APPROVED, comment="ok")
    got2 = await a_store.get(rec.approval_id)
    assert got2.status == ApprovalStatus.APPROVED
    assert got2.comment == "ok"


async def test_approval_ttl_expiry(redis_pair):
    """TTL 过期后读不到（跨副本同理，因共享 Redis）。"""
    a_store, _, r = redis_pair
    rec = await a_store.create(
        session_id="s", agent_id="a", skill_id="sk", user_id="u",
        detail={}, timeout_seconds=1,
    )
    assert await a_store.get(rec.approval_id) is not None
    await asyncio.sleep(1.2)
    assert await a_store.get(rec.approval_id) is None


async def test_approval_delete(redis_pair):
    """删除后跨副本均读不到；重复删除返回 False。"""
    a_store, _, r = redis_pair
    rec = await a_store.create(
        session_id="s", agent_id="a", skill_id="sk", user_id="u", detail={}
    )
    assert await a_store.delete(rec.approval_id) is True
    assert await a_store.get(rec.approval_id) is None
    assert await a_store.delete(rec.approval_id) is False


# ============================================================================
# FormFillPendingStore
# ============================================================================


async def test_formfill_cross_replica_visible(redis_pair):
    """副本 A 登记挂起、副本 B 可取回；状态更新跨副本可见。"""
    _, ff_a, r = redis_pair
    ff_b = FormFillPendingStore(redis=r)  # 副本 B

    await ff_a.create(
        resume_token="rt-1",
        session_id="s1", agent_id="a1", skill_id="user-fill", user_id="u1",
        field="supplier", doc_type="purchase-order", doc_id="PO-1",
        candidates=[{"id": "c1", "displayName": "供应商A"}],
    )
    got = await ff_b.get("rt-1")
    assert got is not None and got.field == "supplier"

    await ff_b.update_status("rt-1", FormFillStatus.APPLIED)
    got2 = await ff_a.get("rt-1")
    assert got2.status == FormFillStatus.APPLIED


async def test_formfill_ttl_expiry(redis_pair):
    """TTL 过期后读不到。"""
    _, ff_a, r = redis_pair
    await ff_a.create(
        resume_token="rt-exp",
        session_id="s", agent_id="a", skill_id="sk", user_id="u",
        field="f", doc_type="d", doc_id="dd", candidates=[], timeout_seconds=1,
    )
    assert await ff_a.get("rt-exp") is not None
    await asyncio.sleep(1.2)
    assert await ff_a.get("rt-exp") is None


async def test_formfill_delete(redis_pair):
    """删除后读不到。"""
    _, ff_a, r = redis_pair
    await ff_a.create(
        resume_token="rt-del",
        session_id="s", agent_id="a", skill_id="sk", user_id="u",
        field="f", doc_type="d", doc_id="dd", candidates=[],
    )
    assert await ff_a.delete("rt-del") is True
    assert await ff_a.get("rt-del") is None


# ============================================================================
# resume_formfill 跨副本接管续跑（端到端）
# ============================================================================


async def test_resume_formfill_takeover(redis_pair, monkeypatch):
    """副本 A 的 execute 登记挂起；接管副本 B 经共享 Redis 取回并续跑。"""
    _, ff_a, r = redis_pair

    # 副本 A 的 execute 阶段登记挂起任务（写入共享 Redis）
    await ff_a.create(
        resume_token="rt-take",
        session_id="s1", agent_id="a1", skill_id="user-fill", user_id="u1",
        field="supplier", doc_type="purchase-order", doc_id="PO-1",
        candidates=[{"id": "c1", "displayName": "供应商A"}], prompt="p",
    )

    # 接管副本 B 处理 entity_select 入站：resume_formfill 内部经
    # get_formfill_pending_store() 走共享 Redis 取回记录（单例惰性复用注入的 fake）。
    async def _fake_apply(*, session, skill_id, doc_type, doc_id, field, value, identity=None):
        return {"status": "success", "docId": "PO-1"}

    class _FakeSession:
        def __init__(self) -> None:
            self.state: dict = {}

        def clear_pending_formfill(self) -> None:
            self.state.pop("pending_formfill", None)

    class _FakeSessionManager:
        async def get_session(self, session_id):
            raise RuntimeError("no session in test")

        async def save_session(self, session):
            return None

    class _FakeInbound:
        def __init__(self, token, action="confirm", cand=None, meta=None):
            self.resume_token = token
            self.selection_action = action
            self.selected_candidate = cand or {}
            self.metadata = meta or {}

    monkeypatch.setattr(fa_mod, "submit_formfill_apply", _fake_apply)
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())

    inbound = _FakeInbound("rt-take", "confirm", {"id": "c1", "displayName": "供应商A"})
    outcome = await ff_mod.resume_formfill(
        instance=None, session=_FakeSession(), inbound=inbound, producer=None
    )

    assert outcome.kind == "continue"
    assert "supplier" in outcome.content and "c1" in outcome.content

    # 接管副本将任务标记为 APPLIED，且写回了共享 Redis（副本 A 可见）
    record = await ff_a.get("rt-take")
    assert record.status == FormFillStatus.APPLIED
