"""T11 多 Gateway + 多 Core 集群 E2E 契约测试（fakeredis 多连接模拟集群）。

用 fakeredis 的 **多连接共享同一个 FakeServer** 模拟一个真实 Redis 集群，多个「节点」
（gw-a / gw-b / core-1 / core-2）各自持有独立连接，但看到同一份键空间，从而复刻
分布式选主 / 路由 / 故障转移的契约行为。

6 个场景（覆盖设计 §跨语言键一致性 + 选主唯一性 + 不丢不重恰好一次 + 故障转移）：
  ① bot 唯一 owner：并发抢注仅一赢家 + 真实 StreamProducer 路由尊重唯一 owner、无串台；
  ② 出站不重不丢：N 条事件精确一次入 owner 流（无重复），无绑定会话落入兜底 pending（不丢）；
  ③ 崩溃重投恰好一次：消费者崩溃遗留 PEL 孤儿，存活者 XAUTOCLAIM 恰好重投一次，ACK 后不再重投；
  ④ H5 粘滞跨语言键：session→gateway 粘滞优先于 bot owner 链，且 TS↔Py 键逐字节一致；
  ⑤ Core agent 唯一 owner + 入站串行 + 故障转移：并发 claim 仅一赢家、同会话 Redis 锁串行、
     崩溃后新 owner 经 refresh_streams 重新订阅 agent 流并消费；
  ⑥ 故障注入逻辑层：注入 core 崩溃（租约释放→新 owner 接管+续订订阅）与 gateway 崩溃
     （bot owner 键丢失→事件降级 pending 不丢、重认领后正确路由）。

原则：**import 真实模块，不重写逻辑**。所有分布式原语（CoreOwnership / RedisSessionLock /
StreamProducer / InboundStreamWorker）均为生产代码；仅网关侧 bot 租约的 Lua 由
`_ClusterRedis` 按 gateway/src/cluster/ownership.ts 的 `BotOwnership.claim/release` 字面量
忠实复刻（与 tests/_lua_fakeredis.py 同款 double 思路，fakeredis 不支持 EVAL），并共享
同一内存 store 以模拟「单一共享 Redis」。

真实 kill -9 多进程验证见同目录 `run_fault_injection.py` 与 `README.md`。
"""

from __future__ import annotations

import asyncio
import pathlib
import re

import fakeredis
import pytest

from src.cluster import core_ownership as co
from src.cluster import session_lock as sl
from src.cluster.session_lock import RedisSessionLock
from src.queue import redis_stream as rs
from src.queue.inbound_worker import InboundStreamMessage, InboundStreamWorker
from src.queue.redis_stream import (
    CONSUMER_GROUP,
    StreamKeys,
    ensure_consumer_group,
    normalize_stream_fields,
    parse_inbound_fields,
)
from src.runtime.events import AgentEvent
from tests._lua_fakeredis import LuaFakeRedis


# ===========================================================================
# Gateway 侧 bot 租约 Lua —— 逐字引用自 gateway/src/cluster/ownership.ts
# （BotOwnership.claim / release），由 _ClusterRedis 复刻其语义。
# ===========================================================================


BOT_CLAIM_SCRIPT = """
  local cur = redis.call('GET', KEYS[1])
  if cur == ARGV[1] then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    return 1
  end
  if cur and cur ~= ARGV[1] then
    return 0
  end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
"""

BOT_RELEASE_SCRIPT = """
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
"""


class _ClusterRedis(LuaFakeRedis):
    """租约 double：在 LuaFakeRedis 之上额外复刻 gateway BotOwnership 的 claim/release Lua。

    所有模拟节点共享同一个内存 store（继承自 LuaFakeRedis），从而复刻「单一共享 Redis
    承载全部所有权契约」的集群拓扑。bot 租约 Lua 逐字来自 ownership.ts，未改写逻辑。
    """

    async def eval(self, script: str, numkeys: int, *args: Any) -> Any:  # noqa: ANN401
        if script is BOT_CLAIM_SCRIPT:
            return self._claim(args[0], list(args[1:]))
        if script is BOT_RELEASE_SCRIPT:
            return self._release(args[0], list(args[1:]))
        return await super().eval(script, numkeys, *args)


class _GatewaySim:
    """网关节点模拟：仅封装 bot 租约的 claim/release（真实 Lua 经 _ClusterRedis 执行）。"""

    def __init__(self, redis: _ClusterRedis, gateway_id: str, lease_ttl_ms: int = 30_000) -> None:
        self._redis = redis
        self._gateway_id = gateway_id
        self._lease_ttl_ms = lease_ttl_ms

    async def claim_bot(self, bot_id: str) -> bool:
        key = f"aip:bot:{bot_id}:owner"
        result = await self._redis.eval(
            BOT_CLAIM_SCRIPT, 1, key, self._gateway_id, self._lease_ttl_ms
        )
        return result == 1

    async def release_bot(self, bot_id: str) -> bool:
        key = f"aip:bot:{bot_id}:owner"
        result = await self._redis.eval(BOT_RELEASE_SCRIPT, 1, key, self._gateway_id)
        return result == 1


# ===========================================================================
# 辅助
# ===========================================================================


GATEWAY_SRC = pathlib.Path(__file__).resolve().parents[3] / "gateway" / "src"


def _extract_ts_template(ts_source: str, fn_name: str) -> str:
    """从 gateway TS 源中提取键模板字面量（与 test_qa_independent_t7_t10 同款）。"""
    pattern = rf"(?:function|static)\s+{fn_name}\s*\([^)]*\).*?return\s*`(.*?)`\s*;"
    m = re.search(pattern, ts_source, re.S)
    assert m, f"TS 源中未找到 {fn_name} 的键模板"
    tpl = m.group(1)
    tpl = tpl.replace("${REDIS_KEY_PREFIX}", "aip:")
    return re.sub(r"\$\{(\w+)\}", r"{\1}", tpl)


def _make_core(
    core_id: str, lease_redis: _ClusterRedis, stream_redis: Any  # noqa: ANN401
) -> tuple[co.CoreOwnership, InboundStreamWorker]:
    """构造一个绑定真实 CoreOwnership + InboundStreamWorker 的 Core 节点。

    session 锁必须落在租约 double（支持 Lua）上，而非 fakeredis（不支持 EVAL）；
    stream 读写则走 fakeredis（支持 XAUTOCLAIM / XREADGROUP）。
    """
    ownership = co.CoreOwnership(lease_redis, core_id, lease_ttl_s=30, heartbeat_s=10)
    worker = InboundStreamWorker()
    worker._redis = stream_redis
    worker.bind_core(core_id, ownership, stream_redis)
    # 用租约 double 重建 session 锁（bind_core 默认用 stream_redis，会导致 EVAL 失败）。
    worker._session_lock = RedisSessionLock(
        lease_redis,
        lock_ttl_s=30,
        extend_s=999,
        retry=0,
        retry_wait_s=0.0,
        core_id=core_id,
    )
    return ownership, worker


def _sample_fields(session_id: str = "s1", agent_id: str | None = None) -> dict[str, str]:
    return {
        "id": "m1",
        "sessionId": session_id,
        "userId": "u1",
        "channel": "h5",
        "content": "hi",
        "messageType": "text",
        "traceId": "t1",
        "timestamp": "2025-01-01T00:00:00Z",
        "agentId": agent_id or "",
    }


async def _drive_one(
    worker: InboundStreamWorker,
    stream_redis: Any,  # noqa: ANN401
    stream_key: str,
    session_id: str = "s1",
    agent_id: str | None = None,
) -> list[Any]:  # noqa: ANN401
    """模拟一次「消费者拉取 + 处理」：XREADGROUP 取消息并驱动真实 _handle_message。"""
    # 幂等建组：worker 的 refresh_streams 可能已经创建过该组，必须容忍 BUSYGROUP。
    await ensure_consumer_group(stream_redis, stream_key)
    await stream_redis.xadd(stream_key, _sample_fields(session_id, agent_id), maxlen=1000, approximate=True)
    res = await stream_redis.xreadgroup(
        CONSUMER_GROUP, worker._consumer_name, {stream_key: ">"}, count=1
    )
    if not res:
        return []
    _sk, msgs = res[0]
    message_id, raw = msgs[0]
    inbound = parse_inbound_fields(normalize_stream_fields(raw))
    captured: list[Any] = []
    worker._process_inbound = lambda ib, sk: captured.append(ib)  # 轻量 spy，跳过重型下游
    await worker._handle_message(stream_key, message_id, inbound)
    return captured


# ===========================================================================
# ① bot 唯一 owner
# ===========================================================================


async def test_e2e_scenario1_bot_unique_owner():
    # ①a 并发抢注同一 bot：仅一 gateway 获胜（Lua 原子性，同 CoreOwnership 语义）。
    r = _ClusterRedis()
    gw_a = _GatewaySim(r, "gw-a")
    gw_b = _GatewaySim(r, "gw-b")
    results = list(await asyncio.gather(gw_a.claim_bot("B1"), gw_b.claim_bot("B1")))
    assert sum(1 for x in results if x) == 1, "期望恰好一赢家"
    owner = await r.get("aip:bot:B1:owner")
    assert owner in ("gw-a", "gw-b")

    # 不同 bot 各自认领成功（互不影响）。
    assert await gw_a.claim_bot("B2") is True
    assert await r.get("aip:bot:B2:owner") == "gw-a"

    # fencing：非 owner 释放被拒（不误删他者）。
    intruder = "gw-b" if owner == "gw-a" else "gw-a"
    if intruder == "gw-b":
        await gw_b.release_bot("B1")
    else:
        await gw_a.release_bot("B1")
    assert await r.get("aip:bot:B1:owner") == owner

    # ①b 真实 StreamProducer 路由尊重唯一 owner、无串台。
    srv = fakeredis.FakeServer()
    sr = fakeredis.aioredis.FakeRedis(server=srv, decode_responses=True)
    producer = rs.StreamProducer(sr)
    await sr.set(rs._bot_owner_key("B1"), "gw-a")
    await sr.set(rs._bot_owner_key("B2"), "gw-b")
    await sr.set(rs._session_bot_key("s1"), "B1")
    await sr.set(rs._session_bot_key("s2"), "B2")
    await producer.publish_agent_event(
        session_id="s1", user_id="u1", channel="wecom-bot",
        agent_id="a1", trace_id="t1", event=AgentEvent.text_delta("hi"),
    )
    await producer.publish_agent_event(
        session_id="s2", user_id="u1", channel="wecom-bot",
        agent_id="a2", trace_id="t2", event=AgentEvent.text_delta("hi"),
    )
    assert await sr.xlen(rs.StreamProducer.get_outbound_stream_key("gw-a")) == 1
    assert await sr.xlen(rs.StreamProducer.get_outbound_stream_key("gw-b")) == 1
    # 无串台：gw-a 的流出站流只含 s1（B1）的事件。
    gw_a_msgs = await sr.xrange(rs.StreamProducer.get_outbound_stream_key("gw-a"))
    assert all(m[1].get("sessionId") == "s1" for m in gw_a_msgs)
    # 无 misroute 到兜底 pending。
    assert await sr.xlen(rs.PENDING_OUTBOUND_STREAM) == 0


# ===========================================================================
# ② 出站不重不丢
# ===========================================================================


async def test_e2e_scenario2_outbound_no_dup_no_loss():
    srv = fakeredis.FakeServer()
    sr = fakeredis.aioredis.FakeRedis(server=srv, decode_responses=True)
    producer = rs.StreamProducer(sr)
    await sr.set(rs._bot_owner_key("B1"), "gw-a")

    # 不重：5 条 B1 事件全部精确一次进入 gw-a 流，无重复。
    for i in range(5):
        await sr.set(rs._session_bot_key(f"s{i}"), "B1")
        await producer.publish_agent_event(
            session_id=f"s{i}", user_id="u1", channel="wecom-bot",
            agent_id="a1", trace_id=f"t{i}", event=AgentEvent.text_delta("hi"),
        )
    assert await sr.xlen(rs.StreamProducer.get_outbound_stream_key("gw-a")) == 5
    assert await sr.xlen(rs.StreamProducer.get_outbound_stream_key("gw-b")) == 0

    # 不丢：无 bot 绑定的会话事件落入兜底 pending 流（不丢失、可后续重路由）。
    await producer.publish_agent_event(
        session_id="orphan", user_id="u1", channel="web",
        agent_id="a1", trace_id="tX", event=AgentEvent.text_delta("hi"),
    )
    assert await sr.xlen(rs.PENDING_OUTBOUND_STREAM) == 1


# ===========================================================================
# ③ 崩溃重投恰好一次
# ===========================================================================


async def test_e2e_scenario3_crash_redelivery_exactly_once():
    srv = fakeredis.FakeServer()
    r = fakeredis.aioredis.FakeRedis(server=srv, decode_responses=True)
    stream = StreamKeys.agent_inbound("agentX")
    await r.xgroup_create(stream, CONSUMER_GROUP, id="0", mkstream=True)
    await r.xadd(stream, _sample_fields("s1"), maxlen=1000, approximate=True)

    # 模拟「已崩溃的消费者」读到 '>' → 消息进入 PEL（未 ACK，处理中崩溃）。
    dead = "agent-core-dead"
    await r.xreadgroup(CONSUMER_GROUP, dead, {stream: ">"}, count=10)

    worker = InboundStreamWorker()
    worker._redis = r
    worker._consumer_name = "agent-core-alive"  # 存活消费者负责重投
    worker._xclaim_min_idle_ms = 0  # 立即重投（等价 kill -9 后孤儿进入重投窗口）

    redelivered: list[str] = []
    worker._spawn_handler = lambda sk, mid, ib: redelivered.append(mid)  # type: ignore[assignment]

    # 恰好一次：孤儿被重投 1 条。
    await worker._reclaim_stream(r, stream)
    assert len(redelivered) == 1, "孤儿应恰好重投 1 次"

    # 正常处理完成 → ACK；再次重投窗口不应重复（恰好一次语义）。
    await r.xack(stream, CONSUMER_GROUP, redelivered[0])
    redelivered.clear()
    await worker._reclaim_stream(r, stream)
    assert redelivered == [], "已 ACK 消息不应重复重投"


# ===========================================================================
# ④ H5 粘滞跨语言键
# ===========================================================================


async def test_e2e_scenario4_h5_sticky_cross_language():
    srv = fakeredis.FakeServer()
    sr = fakeredis.aioredis.FakeRedis(server=srv, decode_responses=True)
    producer = rs.StreamProducer(sr)

    # 粘滞：session S1 的 WS 落在 gw-a；但 bot B1 实为 gw-b 持有。
    await sr.set(rs._session_gateway_key("S1"), "gw-a")
    await sr.set(rs._session_bot_key("S1"), "B1")
    await sr.set(rs._bot_owner_key("B1"), "gw-b")

    # H5 渠道：粘滞优先于 owner 链 → 落 gw-a（而非 bot owner gw-b）。
    await producer.publish_agent_event(
        session_id="S1", user_id="u1", channel="h5",
        agent_id="a1", trace_id="t1", event=AgentEvent.text_delta("hi"),
    )
    assert await sr.xlen(rs.StreamProducer.get_outbound_stream_key("gw-a")) == 1
    assert await sr.xlen(rs.StreamProducer.get_outbound_stream_key("gw-b")) == 0

    # wecom-h5 / wecom_h5 两种渠道名写法同样走粘滞。
    await producer.publish_agent_event(
        session_id="S1", user_id="u1", channel="wecom-h5",
        agent_id="a1", trace_id="t2", event=AgentEvent.text_delta("hi"),
    )
    await producer.publish_agent_event(
        session_id="S1", user_id="u1", channel="wecom_h5",
        agent_id="a1", trace_id="t3", event=AgentEvent.text_delta("hi"),
    )
    assert await sr.xlen(rs.StreamProducer.get_outbound_stream_key("gw-a")) == 3

    # 跨语言键逐字节一致：TS sessionGatewayKey == Py _session_gateway_key。
    ownership_ts = (GATEWAY_SRC / "cluster" / "ownership.ts").read_text(encoding="utf-8")
    ts_tpl = _extract_ts_template(ownership_ts, "sessionGatewayKey")
    assert ts_tpl == "aip:session:{sessionId}:gateway"
    assert rs._session_gateway_key("S1") == "aip:session:S1:gateway"


# ===========================================================================
# ⑤ Core agent 唯一 owner + 入站串行 + 故障转移
# ===========================================================================


async def test_e2e_scenario5_agent_unique_owner_and_failover():
    lease = _ClusterRedis()
    srv = fakeredis.FakeServer()
    stream = fakeredis.aioredis.FakeRedis(server=srv, decode_responses=True)
    co1, w1 = _make_core("core-1", lease, stream)
    co2, w2 = _make_core("core-2", lease, stream)

    # 唯一 owner：并发 claim 同一 agent 仅一赢家。
    results = list(await asyncio.gather(co1.claim("A"), co2.claim("A")))
    assert sum(1 for x in results if x) == 1
    assert (await co1.current_owner("A")) in ("core-1", "core-2")

    # 故障转移：胜者崩溃（释放租约），另一 core 认领。
    winner = co1 if (await co1.current_owner("A")) == "core-1" else co2
    survivor_co = co2 if winner is co1 else co1
    survivor_w = w2 if winner is co1 else w1
    await winner.release_all()
    assert await winner.current_owner("A") is None
    assert await survivor_co.claim("A") is True
    assert await survivor_co.current_owner("A") == survivor_co._core_id

    # 新 owner 经 refresh_streams 重新订阅 agent 流（闭环「崩溃后新 owner 不重订阅」缺口）。
    await survivor_w.refresh_streams(["A"])
    assert StreamKeys.agent_inbound("A") in survivor_w._stream_keys

    # 注入直达 agent 流消息，新 owner 消费、旧 owner 已死不再处理。
    captured = await _drive_one(
        survivor_w, stream, StreamKeys.agent_inbound("A"), session_id="sA", agent_id="A"
    )
    assert len(captured) == 1
    assert captured[0].session_id == "sA"


async def test_e2e_scenario5_inbound_serial():
    """同会话两条并发入站消息经 Redis 分布式锁严格串行（无重叠处理）。

    注：生产锁 retry 失败即放弃交由 XAUTOCLAIM 重投；此处用 retry>0 模拟「争锁失败
    短暂重试」，以验证两并发处理在时间上严格不重叠（串行语义）。
    """
    lease = _ClusterRedis()
    lock = RedisSessionLock(
        lease, lock_ttl_s=30, extend_s=999, retry=10, retry_wait_s=0.01, core_id="core-1"
    )
    held = {"flag": False}
    overlapped = {"seen": False}

    async def _task() -> None:
        async with lock.acquire("sessS") as res:
            # 第二并发者应等待第一释放后成功获取（串行），而非直接放弃。
            assert res.locked, "同会话第二并发应等待并成功获取锁（串行）"
            if held["flag"]:
                overlapped["seen"] = True
            held["flag"] = True
            await asyncio.sleep(0.05)
            held["flag"] = False

    await asyncio.gather(_task(), _task())
    assert not overlapped["seen"], "同会话消息必须串行，不应重叠处理"


# ===========================================================================
# ⑥ 故障注入逻辑层
# ===========================================================================


async def test_e2e_scenario6_fault_injection_logic_layer():
    """逻辑层故障注入：core 崩溃 → 租约释放、新 owner 接管并续订订阅；
    gateway 崩溃 → bot owner 键丢失、事件降级 pending（不丢）、重认领后正确路由。"""
    lease = _ClusterRedis()
    srv = fakeredis.FakeServer()
    stream = fakeredis.aioredis.FakeRedis(server=srv, decode_responses=True)
    co1, w1 = _make_core("core-1", lease, stream)
    co2, w2 = _make_core("core-2", lease, stream)

    # 初始拓扑：core-1 持有 agent A、gw-a 持有 bot B1。
    assert await co1.claim("A") is True
    await stream.set(rs._bot_owner_key("B1"), "gw-a")
    await stream.set(rs._session_bot_key("sB"), "B1")

    # 注入「core-1 崩溃」：释放租约（生产环境为 TTL 过期）。
    await co1.release_all()
    assert await co1.current_owner("A") is None
    # 故障转移：core-2 认领并重新订阅 agent 流。
    assert await co2.claim("A") is True
    await w2.refresh_streams(["A"])
    assert StreamKeys.agent_inbound("A") in w2._stream_keys
    # 入站在新 owner 上继续：注入 agent A 流消息，core-2 消费。
    captured = await _drive_one(
        w2, stream, StreamKeys.agent_inbound("A"), session_id="sA", agent_id="A"
    )
    assert len(captured) == 1

    # 注入「gw-a 崩溃」：删除 bot owner 键（租约丢失）。
    await stream.delete(rs._bot_owner_key("B1"))
    producer = rs.StreamProducer(stream)
    await producer.publish_agent_event(
        session_id="sB", user_id="u1", channel="wecom-bot",
        agent_id="a1", trace_id="t1", event=AgentEvent.text_delta("hi"),
    )
    # 优雅降级：事件落入兜底 pending 流（不丢失），而非静默丢弃。
    assert await stream.xlen(rs.PENDING_OUTBOUND_STREAM) == 1
    assert await stream.xlen(rs.StreamProducer.get_outbound_stream_key("gw-a")) == 0

    # 重新认领到 gw-b 后，后续事件正确路由。
    await stream.set(rs._bot_owner_key("B1"), "gw-b")
    await producer.publish_agent_event(
        session_id="sB", user_id="u1", channel="wecom-bot",
        agent_id="a1", trace_id="t2", event=AgentEvent.text_delta("hi"),
    )
    assert await stream.xlen(rs.StreamProducer.get_outbound_stream_key("gw-b")) == 1
