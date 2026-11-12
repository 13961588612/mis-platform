"""QA 独立验证：HITL 双 store 迁 Redis 的边界与故障接管强化测试（Phase 1）。

与 ``test_hitl_redis_store.py``（工程师自测，覆盖基础跨副本可见性）互补，本文件
聚焦**边界条件与并发语义**，由 QA 独立设计：

1. 并发/竞态：双副本并发 ``update_status`` 的安全性不变式；已解决记录的幂等保护。
2. 逻辑过期 vs 键 TTL：二者一致性；键被人为延长 TTL 时 ``cleanup_expired``
   标记终态后跨副本可见（PENDING → TIMEOUT/EXPIRED，而非仍读到 PENDING）。
3. 序列化往返：``datetime``(tz-aware/微秒) / ``str``-Enum / 嵌套 dict / Unicode。
4. 键空间隔离：approval 与 formfill 命名空间互不串扰，无关 ``aip:`` 键不被误扫。
5. 故障接管：副本 A 崩溃后，副本 B 经**生产访问器**（``get_formfill_pending_store()``
   单例，非注入实例）取回挂起态并续跑；已解决记录不被重复消费。

统一以 ``fakeredis`` 模拟共享 Redis（无真实 Redis 依赖），多个 store 实例共享
同一后端来精确模拟「副本 A / 副本 B」。
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from fakeredis.aioredis import FakeRedis as FakeRedisAsync

from src.hitl._redis import set_hitl_redis, reset_hitl_redis
from src.hitl.store import ApprovalStore, ApprovalRecord, ApprovalStatus
from src.hitl.formfill_pending import (
    FormFillPendingStore,
    FormFillPendingRecord,
    FormFillStatus,
    get_formfill_pending_store,
    reset_formfill_pending_store,
)

import src.skills.tools.formfill_execute as ff_mod
import src.skills.tools.formfill_apply as fa_mod


# ============================================================================
# 测试基础设施
# ============================================================================


@pytest.fixture
def shared_redis():
    """共享 fake Redis：模拟多副本共用的同一 Redis 实例。"""
    r = FakeRedisAsync(decode_responses=True)
    set_hitl_redis(r)
    reset_formfill_pending_store()
    yield r
    reset_hitl_redis()
    reset_formfill_pending_store()


class SlowGetRedis:
    """包装 Redis 客户端，在 ``GET`` 返回后让出事件循环。

    用于**确定性地**放大 ``update_status`` 内 ``GET → 改 → SET`` 之间的窗口，
    使跨副本 read-modify-write 竞态可复现（否则依赖偶发调度，测试会 flaky）。
    """

    def __init__(self, inner, delay: float = 0.05) -> None:
        self._inner = inner
        self._delay = delay

    async def get(self, key):
        value = await self._inner.get(key)
        await asyncio.sleep(self._delay)
        return value

    def __getattr__(self, name):
        return getattr(self._inner, name)


async def _make_approval(store: ApprovalStore, **overrides) -> ApprovalRecord:
    """创建一条审批记录（带测试友好的默认值）。"""
    payload = {
        "session_id": "s1",
        "agent_id": "a1",
        "skill_id": "payment.execute",
        "user_id": "u1",
        "detail": {"title": "付款审批"},
        "timeout_seconds": 300,
    }
    payload.update(overrides)
    return await store.create(**payload)


async def _seed_stale_pending(
    redis, store: ApprovalStore, *, age_seconds: int = 600, timeout_seconds: int = 300
) -> ApprovalRecord:
    """直接写入一条「逻辑已过期但键仍存活」的 PENDING 审批。

    模拟真实场景中键 TTL 被刷新 / 应用与 Redis 时钟漂移的情形 —— 这是
    ``cleanup_expired`` 唯一可达的路径（正常情况下键 TTL 到点即消失）。
    """
    record = ApprovalRecord(
        approval_id="approval-stale-0001",
        session_id="s-stale",
        agent_id="a1",
        skill_id="payment.execute",
        user_id="u1",
        status=ApprovalStatus.PENDING,
        detail={"title": "陈旧审批"},
        created_at=datetime.now(timezone.utc) - timedelta(seconds=age_seconds),
        timeout_seconds=timeout_seconds,
    )
    # 键 TTL 远大于逻辑超时 → 键存活但 is_expired() 已为 True
    await redis.set(store._key(record.approval_id), record.model_dump_json(), ex=3600)
    return record


# ============================================================================
# 1. 并发 / 竞态语义
# ============================================================================


async def test_dual_replica_concurrent_update_status_safety(shared_redis):
    """双副本并发 update_status：不崩溃、不损坏记录、终态唯一且可解析。

    跨副本无分布式锁（各副本仅有进程内 asyncio.Lock），因此本测试断言的是
    **安全性不变式**而非"先到先得"：无论调度顺序如何，记录必须仍可解析、
    落到 APPROVED/REJECTED 之一，且 status 与 comment 保持自洽（不出现
    A 的状态配 B 的评论这类撕裂写入）。
    """
    seed = ApprovalStore(redis=shared_redis)
    record = await _make_approval(seed)

    # 副本 A / B：各自独立实例（独立 asyncio.Lock），共享同一 Redis
    replica_a = ApprovalStore(redis=SlowGetRedis(shared_redis))
    replica_b = ApprovalStore(redis=SlowGetRedis(shared_redis))

    result_a, result_b = await asyncio.gather(
        replica_a.update_status(record.approval_id, ApprovalStatus.APPROVED, "A批准"),
        replica_b.update_status(record.approval_id, ApprovalStatus.REJECTED, "B拒绝"),
    )

    assert result_a is not None and result_b is not None

    final = await seed.get(record.approval_id)
    assert final is not None, "并发更新后记录不应消失"
    assert final.status in (ApprovalStatus.APPROVED, ApprovalStatus.REJECTED)
    assert final.status != ApprovalStatus.PENDING, "必须落到终态"
    # 撕裂写入检查：status 与 comment 必须来自同一个副本的同一次写入
    expected_comment = {
        ApprovalStatus.APPROVED: "A批准",
        ApprovalStatus.REJECTED: "B拒绝",
    }[final.status]
    assert final.comment == expected_comment, "status 与 comment 必须自洽（无撕裂写入）"
    assert final.resolved_at is not None


async def test_update_status_on_resolved_record_is_idempotent(shared_redis):
    """已解决的记录不被二次更新覆盖（无竞态的串行路径）。

    这是 ``update_status`` 中 ``status != PENDING`` 守卫的正向验证：副本 B 在
    副本 A 已批准之后尝试拒绝，应拿回既有的 APPROVED 记录且不改写存储。
    """
    replica_a = ApprovalStore(redis=shared_redis)
    replica_b = ApprovalStore(redis=shared_redis)
    record = await _make_approval(replica_a)

    first = await replica_a.update_status(
        record.approval_id, ApprovalStatus.APPROVED, "先批准"
    )
    assert first.status == ApprovalStatus.APPROVED

    second = await replica_b.update_status(
        record.approval_id, ApprovalStatus.REJECTED, "后拒绝"
    )
    assert second.status == ApprovalStatus.APPROVED, "已解决记录应原样返回"
    assert second.comment == "先批准"

    persisted = await replica_b.get(record.approval_id)
    assert persisted.status == ApprovalStatus.APPROVED
    assert persisted.comment == "先批准", "存储不应被二次更新覆盖"


async def test_update_status_missing_record_returns_none(shared_redis):
    """记录不存在（或已 TTL 过期）时 update_status 返回 None 而非抛错。"""
    store = ApprovalStore(redis=shared_redis)
    assert await store.update_status("approval-nope", ApprovalStatus.APPROVED) is None

    ff_store = FormFillPendingStore(redis=shared_redis)
    assert await ff_store.update_status("rt-nope", FormFillStatus.APPLIED) is None


# ============================================================================
# 2. 逻辑过期 vs 键 TTL
# ============================================================================


async def test_natural_expiry_key_and_logical_timeout_are_consistent(shared_redis):
    """键 TTL 与 is_expired() 窗口一致：自然过期后记录整体消失。

    这是本次改造的核心设计前提（TTL = timeout_seconds）。因此不存在
    「键还活着但 is_expired() 已 True 却仍返回 PENDING」的常规窗口；
    同时也意味着 cleanup_expired 对自然过期的记录无事可做（空转）。
    """
    store = ApprovalStore(redis=shared_redis)
    record = await _make_approval(store, timeout_seconds=1)

    assert await store.get(record.approval_id) is not None
    await asyncio.sleep(1.2)

    assert await store.get(record.approval_id) is None, "键 TTL 到点应消失"
    assert await store.cleanup_expired() == 0, "自然过期后 cleanup 无可标记对象"


async def test_cleanup_expired_marks_timeout_visible_cross_replica(shared_redis):
    """键被延长 TTL 时：A 执行 cleanup_expired 标 TIMEOUT，B 必须读到 TIMEOUT 而非 PENDING。

    对应故障接管的关键要求 —— 超时判定必须跨副本一致，避免副本 B 仍把
    已超时的审批当作 PENDING 继续等待用户响应。
    """
    replica_a = ApprovalStore(redis=shared_redis)
    replica_b = ApprovalStore(redis=shared_redis)
    stale = await _seed_stale_pending(shared_redis, replica_a)

    # 前置确认：键存活，但逻辑上已过期
    before = await replica_b.get(stale.approval_id)
    assert before is not None and before.status == ApprovalStatus.PENDING
    assert before.is_expired() is True

    assert await replica_a.cleanup_expired() == 1

    after = await replica_b.get(stale.approval_id)
    assert after is not None, "标记超时后记录应仍可读（供接管副本判定）"
    assert after.status == ApprovalStatus.TIMEOUT, "副本 B 必须读到 TIMEOUT"
    assert after.resolved_at is not None
    assert after.is_expired() is False, "终态记录 is_expired() 应为 False"


async def test_formfill_cleanup_expired_marks_expired_cross_replica(shared_redis):
    """FormFill 同理：延长 TTL 的挂起任务被 cleanup 标 EXPIRED 后跨副本可见。"""
    replica_a = FormFillPendingStore(redis=shared_redis)
    replica_b = FormFillPendingStore(redis=shared_redis)

    record = FormFillPendingRecord(
        resume_token="rt-stale",
        session_id="s-stale",
        agent_id="a1",
        skill_id="user-fill",
        user_id="u1",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-9",
        candidates=[{"id": "c1"}],
        status=FormFillStatus.PENDING,
        created_at=datetime.now(timezone.utc) - timedelta(seconds=3600),
        timeout_seconds=1800,
    )
    await shared_redis.set(
        replica_a._key("rt-stale"), record.model_dump_json(), ex=7200
    )

    assert await replica_a.cleanup_expired() == 1
    after = await replica_b.get("rt-stale")
    assert after is not None and after.status == FormFillStatus.EXPIRED


async def test_formfill_get_marks_logically_expired_record(shared_redis):
    """FormFill.get() 对「键存活但逻辑过期」的 PENDING 记录就地标记 EXPIRED。

    该分支继承自原内存实现（读时惰性过期），保证 resume_formfill 不会对
    已超时的挂起任务继续 apply。
    """
    store = FormFillPendingStore(redis=shared_redis)
    record = FormFillPendingRecord(
        resume_token="rt-lazy",
        session_id="s",
        agent_id="a",
        skill_id="user-fill",
        user_id="u",
        field="f",
        doc_type="d",
        doc_id="dd",
        candidates=[],
        status=FormFillStatus.PENDING,
        created_at=datetime.now(timezone.utc) - timedelta(seconds=3600),
        timeout_seconds=1800,
    )
    await shared_redis.set(store._key("rt-lazy"), record.model_dump_json(), ex=7200)

    got = await store.get("rt-lazy")
    assert got.status == FormFillStatus.EXPIRED, "读时应惰性标记为 EXPIRED"

    # 惰性标记必须落盘（另一副本也应看到 EXPIRED）
    other = FormFillPendingStore(redis=shared_redis)
    assert (await other.get("rt-lazy")).status == FormFillStatus.EXPIRED


async def test_create_with_nonpositive_timeout_does_not_persist_forever(shared_redis):
    """timeout_seconds <= 0 不得产生「永不过期」的僵尸键。

    断言与实现策略无关：无论是拒绝（抛错）还是钳制为正数 TTL，都不允许
    写出一个没有 TTL 的键 —— 否则挂起态将永久泄漏在 Redis 中。
    """
    store = ApprovalStore(redis=shared_redis)
    try:
        record = await _make_approval(store, timeout_seconds=0)
    except Exception:
        # 当前实现：Redis 拒绝 ex=0 → ResponseError，未写入任何键
        keys = [k async for k in shared_redis.scan_iter(match="aip:hitl:approval:*")]
        assert keys == [], "创建失败时不应残留半成品键"
    else:
        ttl = await shared_redis.ttl(store._key(record.approval_id))
        assert ttl != -1, "不允许写出无 TTL 的永久键"


# ============================================================================
# 3. 序列化往返保真度
# ============================================================================


async def test_approval_serialization_roundtrip_fidelity(shared_redis):
    """datetime(tz-aware/微秒) / str-Enum / 嵌套 dict / Unicode 往返完全保真。"""
    store = ApprovalStore(redis=shared_redis)
    detail = {
        "title": "付款审批 ¥10,000",
        "nested": {"items": [1, 2, None], "flag": True, "ratio": 0.5},
        "note": "换行\n与引号\"'",
    }
    record = await _make_approval(store, detail=detail)

    got = await ApprovalStore(redis=shared_redis).get(record.approval_id)

    assert got.detail == detail, "嵌套 dict / Unicode / 转义字符必须完全保真"
    assert got.created_at == record.created_at
    assert got.created_at.tzinfo is not None, "必须保留时区信息"
    assert got.created_at.microsecond == record.created_at.microsecond
    assert got.resolved_at is None
    assert got.comment is None
    assert isinstance(got.status, ApprovalStatus)


async def test_approval_raw_json_uses_plain_enum_value(shared_redis):
    """存储的原始 JSON 中 Enum 序列化为纯字符串值（跨语言/跨版本可读）。

    防回归：若序列化成 ``"ApprovalStatus.PENDING"``，则其他服务或未来版本
    反序列化会失败。
    """
    store = ApprovalStore(redis=shared_redis)
    record = await _make_approval(store)

    raw = await shared_redis.get(store._key(record.approval_id))
    parsed = json.loads(raw)

    assert parsed["status"] == "pending"
    assert isinstance(parsed["created_at"], str)
    assert parsed["resolved_at"] is None


async def test_formfill_candidates_roundtrip(shared_redis):
    """FormFill 候选实体列表（list[dict]）往返保真。"""
    store = FormFillPendingStore(redis=shared_redis)
    candidates = [
        {"id": "c1", "displayName": "供应商A", "score": 0.93, "meta": {"code": "S-1"}},
        {"id": "c2", "displayName": "供应商B", "score": None},
    ]
    await store.create(
        resume_token="rt-ser",
        session_id="s",
        agent_id="a",
        skill_id="user-fill",
        user_id="u",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-1",
        candidates=candidates,
        original_value="供應商",
        prompt="请选择供应商",
    )

    got = await FormFillPendingStore(redis=shared_redis).get("rt-ser")
    assert got.candidates == candidates
    assert got.original_value == "供應商"


# ============================================================================
# 4. 键空间隔离与扫描正确性
# ============================================================================


async def test_scan_namespaces_are_isolated(shared_redis):
    """approval / formfill 命名空间互不串扰，无关 aip: 键不被误扫。"""
    approval_store = ApprovalStore(redis=shared_redis)
    ff_store = FormFillPendingStore(redis=shared_redis)

    await _make_approval(approval_store, user_id="u1")
    await ff_store.create(
        resume_token="rt-iso",
        session_id="s",
        agent_id="a",
        skill_id="user-fill",
        user_id="u1",
        field="f",
        doc_type="d",
        doc_id="dd",
        candidates=[],
    )
    # 其他模块的 aip: 键（如会话锁）不得被 HITL 扫描吞掉
    await shared_redis.set("aip:session:lock:s1", "someone", ex=60)
    await shared_redis.set("aip:hitl:other:x", "unrelated", ex=60)

    approvals = await approval_store.list_all()
    assert len(approvals) == 1

    stats = await approval_store.get_stats()
    assert stats["total"] == 1 and stats["pending"] == 1

    assert await ff_store.get_by_session("s") is not None


async def test_list_and_stats_visible_cross_replica(shared_redis):
    """副本 A 写入的多条记录，副本 B 的 list_*/get_stats 全部可见且筛选正确。"""
    replica_a = ApprovalStore(redis=shared_redis)
    replica_b = ApprovalStore(redis=shared_redis)

    r1 = await _make_approval(replica_a, user_id="u1", session_id="s1")
    await _make_approval(replica_a, user_id="u1", session_id="s2")
    await _make_approval(replica_a, user_id="u2", session_id="s1")
    await replica_a.update_status(r1.approval_id, ApprovalStatus.APPROVED, "ok")

    assert len(await replica_b.list_by_user("u1")) == 2
    assert len(await replica_b.list_by_user("u1", ApprovalStatus.PENDING)) == 1
    assert len(await replica_b.list_by_session("s1")) == 2
    assert len(await replica_b.list_pending()) == 2

    stats = await replica_b.get_stats()
    assert stats == {
        "total": 3,
        "pending": 2,
        "approved": 1,
        "rejected": 0,
        "timeout": 0,
    }


async def test_list_all_respects_limit_and_sort_order(shared_redis):
    """list_all 按 created_at 倒序并遵守 limit。"""
    store = ApprovalStore(redis=shared_redis)
    for i in range(5):
        await _make_approval(store, session_id=f"s{i}")

    top = await store.list_all(limit=3)
    assert len(top) == 3
    assert [r.created_at for r in top] == sorted(
        (r.created_at for r in top), reverse=True
    )


async def test_scan_tolerates_corrupted_payload(shared_redis):
    """坏数据不击垮统计类接口（scan 路径的容错）。"""
    store = ApprovalStore(redis=shared_redis)
    await _make_approval(store)
    await shared_redis.set("aip:hitl:approval:broken", "{not-json", ex=60)

    stats = await store.get_stats()
    assert stats["total"] == 1, "坏记录应被跳过而非抛错"
    assert len(await store.list_all()) == 1


# ============================================================================
# 5. 故障接管（副本 A 崩溃 → 副本 B 经生产访问器接管）
# ============================================================================


class _FakeSession:
    """最小会话替身。"""

    def __init__(self) -> None:
        self.state: dict = {}
        self.agent_id = "a1"
        self.user_id = "u1"

    def clear_pending_formfill(self) -> None:
        self.state.pop("pending_formfill", None)


class _FakeSessionManager:
    async def get_session(self, session_id):
        raise RuntimeError("no session in test")

    async def save_session(self, session):
        return None


class _FakeInbound:
    def __init__(self, token, action="confirm", cand=None, meta=None) -> None:
        self.resume_token = token
        self.selection_action = action
        self.selected_candidate = cand or {}
        self.metadata = meta or {}


@pytest.fixture
def patched_resume(monkeypatch):
    """打桩 apply / session_manager，并记录 apply 调用次数。"""
    calls: list[dict] = []

    async def _fake_apply(*, session, skill_id, doc_type, doc_id, field, value, identity=None):
        calls.append({"field": field, "value": value, "doc_id": doc_id})
        return {"status": "success", "docId": doc_id or "PO-1"}

    monkeypatch.setattr(fa_mod, "submit_formfill_apply", _fake_apply)
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())
    return calls


async def test_takeover_via_production_singleton_after_replica_a_crash(
    shared_redis, patched_resume
):
    """副本 A 登记挂起后崩溃；副本 B 经**生产单例访问器**接管并 APPLIED。

    与工程师用例的区别：副本 B 不使用任何注入的 store 实例，而是走
    ``get_formfill_pending_store()``（生产代码路径，惰性解析共享 Redis），
    从而真正验证「新副本冷启动后能接管」而非「测试注入让它看起来能接管」。
    """
    # --- 副本 A：登记挂起任务后"崩溃"（实例被丢弃，进程内状态全部丢失）---
    replica_a_store = FormFillPendingStore(redis=shared_redis)
    await replica_a_store.create(
        resume_token="rt-crash",
        session_id="s1",
        agent_id="a1",
        skill_id="user-fill",
        user_id="u1",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-1",
        candidates=[{"id": "c1", "displayName": "供应商A", "value": "SUP-001"}],
        prompt="请选择供应商",
    )
    del replica_a_store
    reset_formfill_pending_store()  # 模拟副本 B 冷启动：无任何进程内残留

    # --- 副本 B：仅凭共享 Redis + 生产访问器接管 ---
    outcome = await ff_mod.resume_formfill(
        instance=None,
        session=_FakeSession(),
        inbound=_FakeInbound(
            "rt-crash", "confirm", {"id": "c1", "value": "SUP-001"}
        ),
        producer=None,
    )

    assert outcome.kind == "continue"
    assert "supplier" in outcome.content and "SUP-001" in outcome.content
    assert patched_resume == [
        {"field": "supplier", "value": "SUP-001", "doc_id": "PO-1"}
    ]

    # 终态写回共享 Redis，任何后续副本均可见
    final = await FormFillPendingStore(redis=shared_redis).get("rt-crash")
    assert final.status == FormFillStatus.APPLIED


async def test_takeover_does_not_reconsume_resolved_record(
    shared_redis, patched_resume
):
    """已解决（APPLIED）的挂起任务不被重复消费 —— 防止重复写回单据。

    对应「get() 返回非 PENDING 记录时消费方是否正确处理」的验证：
    resume_formfill 必须短路返回提示，且**不得**再次调用 apply。
    """
    store = FormFillPendingStore(redis=shared_redis)
    await store.create(
        resume_token="rt-done",
        session_id="s1",
        agent_id="a1",
        skill_id="user-fill",
        user_id="u1",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-1",
        candidates=[{"id": "c1", "value": "SUP-001"}],
    )
    await store.update_status("rt-done", FormFillStatus.APPLIED)
    reset_formfill_pending_store()

    outcome = await ff_mod.resume_formfill(
        instance=None,
        session=_FakeSession(),
        inbound=_FakeInbound("rt-done", "confirm", {"id": "c1", "value": "SUP-001"}),
        producer=None,
    )

    assert outcome.kind == "message"
    assert "已处理" in outcome.content
    assert patched_resume == [], "已解决记录不得重复触发 apply 写回"


async def test_takeover_of_vanished_record_is_graceful(shared_redis, patched_resume):
    """挂起记录已随 TTL 消失时，接管副本给出友好提示而非报错。"""
    reset_formfill_pending_store()

    outcome = await ff_mod.resume_formfill(
        instance=None,
        session=_FakeSession(),
        inbound=_FakeInbound("rt-gone", "confirm", {"id": "c1", "value": "v"}),
        producer=None,
    )

    assert outcome.kind == "message"
    assert "未找到" in outcome.content
    assert patched_resume == []


async def test_takeover_cancel_marks_cancelled_cross_replica(
    shared_redis, patched_resume
):
    """接管副本处理 cancel：标记 CANCELLED 且跨副本可见，不触发 apply。"""
    store = FormFillPendingStore(redis=shared_redis)
    await store.create(
        resume_token="rt-cancel",
        session_id="s1",
        agent_id="a1",
        skill_id="user-fill",
        user_id="u1",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-1",
        candidates=[{"id": "c1"}],
    )
    reset_formfill_pending_store()

    outcome = await ff_mod.resume_formfill(
        instance=None,
        session=_FakeSession(),
        inbound=_FakeInbound("rt-cancel", "cancel"),
        producer=None,
    )

    assert outcome.kind == "message"
    assert patched_resume == []
    final = await FormFillPendingStore(redis=shared_redis).get("rt-cancel")
    assert final.status == FormFillStatus.CANCELLED
