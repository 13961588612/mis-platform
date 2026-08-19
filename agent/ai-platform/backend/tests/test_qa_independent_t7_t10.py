"""独立 QA 验证（T7–T10，第二批 C+D）— 补充工程师自测未覆盖的边界与回路。

本文件为 QA 独立撰写，不依赖工程师的 test_core_ownership / test_session_lock /
test_inbound_routing，重点补齐：
  - T8：并发 claim 仅一赢家（asyncio.gather 交织）、prev_owner 写入/读取、
        release_all、心跳写成员；
  - T9 锁：看门狗确实续期（spy eval）、崩溃 TTL 释放无死锁、新 owner 可释放旧 owner 不可；
  - T9 路由：重投消息被 owning core 消费后 agent_id 还原、_check_owned 不再重投（无死循环）；
  - T7：wecom-h5 与 wecom_h5 两种渠道名都走 session→gateway 粘滞、TS↔Py 键逐字节一致；
  - 跨语言 mandated 5 键逐字节等于设计字面量；
  - T10：SessionManager 纯 Redis 权威、无进程内 session 缓存 dict。

Lua 租约由 tests._lua_fakeredis.LuaFakeRedis 进程内复刻（fakeredis 2.x 不支持 EVAL，
已实测确认）；多 Core 真实 Redis 故障转移 E2E 见报告标注（本地无 Redis）。
"""

from __future__ import annotations

import asyncio
import inspect
import pathlib
import re

import fakeredis
import pytest

from src.agent import session as sm
from src.cluster import core_ownership as co
from src.cluster import session_lock as sl
from src.cluster.session_lock import LockAcquireResult, session_lock_key
from src.queue import redis_stream as rs
from src.queue.inbound_worker import InboundStreamMessage, InboundStreamWorker, _RerouteToOwner
from src.queue.redis_stream import CONSUMER_GROUP, StreamKeys, parse_inbound_fields
from tests._lua_fakeredis import LuaFakeRedis


# ===========================================================================
# 辅助
# ===========================================================================


class _FakeCoreOwnership:
    def __init__(self, owners: dict[str, str | None], core_id: str) -> None:
        self._owners = owners
        self._core_id = core_id

    async def current_owner(self, agent_id: str) -> str | None:
        return self._owners.get(agent_id)


def _make_inbound(agent_id: str = "a2", **kw) -> InboundStreamMessage:
    return InboundStreamMessage(
        id="m1",
        session_id="s1",
        user_id="u1",
        channel="h5",
        content="hi",
        message_type="text",
        trace_id="t1",
        timestamp="2025-01-01T00:00:00Z",
        agent_id=agent_id,
        metadata={"k": "v"},
        **kw,
    )


def _bind_core(w: InboundStreamWorker, core_id: str, owners: dict[str, str | None]) -> None:
    w._core_id = core_id
    w._core_ownership = _FakeCoreOwnership(owners, core_id)
    w._session_lock = None


class _CountingRedis(LuaFakeRedis):
    """包装 LuaFakeRedis：统计看门狗续租（RENEW）调用次数。"""

    def __init__(self) -> None:
        super().__init__()
        self.renew_calls = 0
        self.release_calls = 0

    async def eval(self, script, numkeys, *args):
        if script is sl._RENEW_SCRIPT:
            self.renew_calls += 1
        elif script is sl._RELEASE_SCRIPT:
            self.release_calls += 1
        return await super().eval(script, numkeys, *args)


GATEWAY_SRC = pathlib.Path(__file__).resolve().parents[2] / "gateway" / "src"


def _extract_ts_template(ts_source: str, fn_name: str) -> str:
    pattern = rf"(?:function|static)\s+{fn_name}\s*\([^)]*\).*?return\s*`(.*?)`\s*;"
    m = re.search(pattern, ts_source, re.S)
    assert m, f"TS 源中未找到 {fn_name} 的键模板"
    tpl = m.group(1)
    tpl = tpl.replace("${REDIS_KEY_PREFIX}", "aip:")
    return re.sub(r"\$\{(\w+)\}", r"{\1}", tpl)


# ===========================================================================
# T8 — Agent 运行时租约（独立边界）
# ===========================================================================


async def test_concurrent_claim_only_one_winner():
    """并发 claim 同一 agent：asyncio.gather 交织下仍仅一 core 获胜（Lua 原子性）。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1", lease_ttl_s=30, heartbeat_s=10)
    c2 = co.CoreOwnership(r, "core-2", lease_ttl_s=30, heartbeat_s=10)

    results = list(await asyncio.gather(c1.claim("agentA"), c2.claim("agentA")))
    assert sum(1 for x in results if x) == 1, f"期望恰好一赢家, got {results}"
    winner = await c1.current_owner("agentA")
    assert winner in ("core-1", "core-2")
    # 胜者仍在 _owned；败者不在
    if winner == "core-1":
        assert "agentA" in c1._owned and "agentA" not in c2._owned
    else:
        assert "agentA" in c2._owned and "agentA" not in c1._owned


async def test_prev_owner_written_and_read():
    """接管时 set_prev_owner 写入，prev_owner 可读出上一任（drain 定位）。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1")
    c2 = co.CoreOwnership(r, "core-2")

    await c1.claim("agentP")
    await c1.set_prev_owner("agentP", "core-1")
    await c1.release("agentP")
    await c2.claim("agentP")

    assert await c1.prev_owner("agentP") == "core-1"
    assert await c2.prev_owner("agentP") == "core-1"
    assert await c2.current_owner("agentP") == "core-2"


async def test_release_all_clears_every_lease():
    """release_all 释放本核心持有的全部租约（优雅关闭）。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1")
    for aid in ("x1", "x2", "x3"):
        await c1.claim(aid)
    assert len(c1._owned) == 3
    await c1.release_all()
    for aid in ("x1", "x2", "x3"):
        assert await c1.current_owner(aid) is None
    assert len(c1._owned) == 0


async def test_heartbeat_writes_members_and_fires_on_lost():
    """心跳：写 aip:cores:members 且 renew 失败触发 on_lost（T8 编排核心）。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1", lease_ttl_s=30, heartbeat_s=1)
    c1._heartbeat_s = 0.02
    lost: list[str] = []
    c1.start_heartbeat(on_lost=lambda aid: lost.append(aid))
    await c1.claim("agentH")

    # 模拟易主
    await r.set(co.agent_owner_key("agentH"), "core-2")
    await asyncio.sleep(0.12)
    c1.stop_heartbeat()

    assert "core-1" in await c1.list_members()
    assert "agentH" in lost


# ===========================================================================
# T9 — Redis 分布式 session 锁（独立边界）
# ===========================================================================


async def test_watchdog_actually_renews_while_held():
    """看门狗在持锁期间确实调用续租（eval RENEW），释放后停止。"""
    r = _CountingRedis()
    # 注意：RedisSessionLock 构造函数把 extend_s 钳到 max(1, …)，故看门狗周期 >=1s。
    lock = sl.RedisSessionLock(
        r, lock_ttl_s=30, extend_s=1, retry=0, retry_wait_s=0.0, core_id="c1"
    )
    async with lock.acquire("sessW") as res:
        assert res.locked is True
        renew_before = r.renew_calls
        # 持锁 1.2s（> extend 周期 1s），看门狗应至少续租 1 次
        await asyncio.sleep(1.2)
        assert r.renew_calls > renew_before, "持锁期间看门狗未续租"
    # 退出后看门狗被取消，不应再增长
    after = r.renew_calls
    await asyncio.sleep(0.4)
    assert r.renew_calls == after, "释放后看门狗仍续租（泄漏）"


async def test_crash_ttl_release_no_deadlock():
    """模拟崩溃：锁键 TTL 过期（删除键）后，contender 可立即获取，无死锁。"""
    r = LuaFakeRedis()
    holder = sl.RedisSessionLock(
        r, lock_ttl_s=30, extend_s=999, retry=0, retry_wait_s=0.0, core_id="h1"
    )
    async with holder.acquire("sessC") as res:
        assert res.locked is True
        # 模拟持有者崩溃：锁随 TTL 自然释放（删除键）
        await r.delete(session_lock_key("sessC"))

    contender = sl.RedisSessionLock(
        r, lock_ttl_s=30, extend_s=999, retry=0, retry_wait_s=0.0, core_id="h2"
    )
    async with contender.acquire("sessC") as res2:
        assert res2.locked is True, "崩溃释放后 contender 应可获取锁"


async def test_new_owner_can_release_own_lock():
    """fencing：新 owner 可释放自身锁；旧 owner 已被拒（与工程师 test_release_is_fenced 互补）。"""
    r = LuaFakeRedis()
    c1 = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=999, retry=0, retry_wait_s=0.0, core_id="c1")
    async with c1.acquire("sessN") as res:
        assert res.locked is True
    # c1 退出后已释放（owner 才能删），键应清空
    assert await r.get(session_lock_key("sessN")) is None

    c2 = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=999, retry=0, retry_wait_s=0.0, core_id="c2")
    async with c2.acquire("sessN") as res2:
        assert res2.locked is True
    # c2 作为 owner 释放自身锁成功
    assert await r.get(session_lock_key("sessN")) is None


# ===========================================================================
# T9 — agent owner 路由回路（重投 → owning core 消费）
# ===========================================================================


async def test_rerouted_message_consumed_by_owning_core_no_loop():
    """重投到 aip:stream:agent:{agentId} 的消息，被 owning core 消费后：
    agent_id 由 stream key 还原、_check_owned 通过（不会再次重投，无死循环）。"""
    server = fakeredis.FakeServer()
    redis = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    owning = InboundStreamWorker()
    owning._redis = redis
    _bind_core(owning, "core-2", {"a2": "core-2"})  # owning core

    inbound = _make_inbound(agent_id="a2", user_mobile="13800000000", channel_user_id="wxu1")
    # 由 core-1 触发重投
    rerouter = InboundStreamWorker()
    rerouter._redis = redis
    _bind_core(rerouter, "core-1", {"a2": "core-2"})
    await rerouter._reroute_to_owner("a2", inbound, redis)

    # owning core 取出重投消息并还原
    raw = dict((await redis.xrange(StreamKeys.agent_inbound("a2")))[0][1])
    restored = parse_inbound_fields(raw)
    assert restored.agent_id == "a2"
    # owning core 处理该消息：owner 判定应通过（不抛 _RerouteToOwner）
    await owning._check_owned(restored.agent_id)


async def test_explicit_agentid_reroute_target_is_agent_stream():
    """显式 agentId 且属他 core：_check_owned 抛重投，且目标为 aip:stream:agent:{agentId}。"""
    server = fakeredis.FakeServer()
    redis = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    w = InboundStreamWorker()
    w._redis = redis
    _bind_core(w, "core-1", {"aX": "core-9"})

    inbound = _make_inbound(agent_id="aX")
    with pytest.raises(_RerouteToOwner):
        await w._check_owned("aX")

    await w._reroute_to_owner("aX", inbound, redis)
    assert await redis.xlen(StreamKeys.agent_inbound("aX")) == 1
    assert await redis.xlen(StreamKeys.channel_inbound("h5")) == 0


# ===========================================================================
# T7 — H5 粘滞（Py 侧出站分支；TS 侧由 tsc + 代码审阅覆盖）
# ===========================================================================


def test_wecom_h5_and_wecom_h5_channels_use_session_gateway():
    """T7：backend 渠道名 wecom-h5 与 wecom_h5 都走 session→gateway 粘滞解析。"""

    async def run(channel: str):
        server = fakeredis.FakeServer()
        r = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
        await r.set(rs._session_gateway_key("sH"), "gwSticky")
        producer = rs.StreamProducer(r)
        await producer.publish_agent_event(
            session_id="sH",
            user_id="uH",
            channel=channel,
            agent_id="aH",
            trace_id="tH",
            event=__import__("src.runtime.events", fromlist=["AgentEvent"]).AgentEvent.text_delta("x"),
        )
        return await r.xlen(rs.StreamProducer.get_outbound_stream_key("gwSticky"))

    assert asyncio.run(run("wecom-h5")) == 1
    assert asyncio.run(run("wecom_h5")) == 1


def test_ts_session_gateway_key_byte_consistent_with_py():
    """T7 跨语言：TS sessionGatewayKey 与 Py _session_gateway_key 逐字节一致。"""
    ownership = (GATEWAY_SRC / "cluster" / "ownership.ts").read_text(encoding="utf-8")
    ts_tpl = _extract_ts_template(ownership, "sessionGatewayKey")
    assert ts_tpl == "aip:session:{sessionId}:gateway"
    assert rs._session_gateway_key("{sessionId}") == "aip:session:{sessionId}:gateway"


# ===========================================================================
# 跨语言 mandated 5 键逐字节一致
# ===========================================================================


def test_mandated_cross_language_keys_byte_equal():
    """设计硬约束：任务指定的 5 个键逐字节等于设计字面量。"""
    assert co.agent_owner_key("A1") == "aip:agent:A1:owner"
    assert co.agent_registry_key() == "aip:agent:registry"
    assert session_lock_key("S1") == "aip:session:S1:lock"
    assert rs._session_gateway_key("S1") == "aip:session:S1:gateway"
    assert co.cores_members_key() == "aip:cores:members"


# ===========================================================================
# T10 — SessionManager 纯 Redis 权威（无进程内缓存）
# ===========================================================================


def test_session_manager_has_no_inmemory_cache():
    """T10 收口：SessionManager 无进程内 session 缓存 dict；get_session 走 Redis。"""
    src = inspect.getsource(sm.SessionManager)
    # 不应存在 self._sessions / self._cache / self._store 之类的内存会话缓存
    assert not re.search(
        r"self\._(sessions|cache|session_cache|store|local)\s*=\s*(dict|OrderedDict|\{\})",
        src,
    ), "发现疑似进程内 session 缓存字典"
    # get_session 必须经由 Redis 读取（非内存）
    get_src = inspect.getsource(sm.SessionManager.get_session)
    assert "await self._get_redis()" in get_src
    assert "redis.get(self._session_key" in get_src
    # save_session 必须写 Redis（setex + session key）
    save_src = inspect.getsource(sm.SessionManager.save_session)
    assert "setex" in save_src and "self._session_key" in save_src


async def test_session_manager_redis_roundtrip():
    """get_session/save_session 经 Redis 往返（fakeredis 模拟，无内存缓存）。"""
    server = fakeredis.FakeServer()
    r = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    mgr = sm.SessionManager.__new__(sm.SessionManager)
    from src.config import get_settings

    mgr._settings = get_settings()  # 提供 REDIS_KEY_PREFIX（避免调 __init__ 建 PG）
    mgr._redis = r
    mgr._session_ttl = 86400
    mgr._pg_store = None  # 跳过双写（dual_write 已 try/except 降级）

    sess = sm.Session(session_id="qa-s1", agent_id="aZ", user_id="uZ", channel="h5")
    await mgr.save_session(sess)
    restored = await mgr.get_session("qa-s1")
    assert restored.agent_id == "aZ"
    assert restored.user_id == "uZ"
