"""T3 per-owner 出站路由单元测试（决策 2 / 修 K3/N7）。

验证 `StreamProducer.publish_agent_event` / `_resolve_outbound_stream` 的 owner 解析链：
  sessionId → GET aip:session:{sid}:bot → botId → GET aip:bot:{botId}:owner
  → gatewayId → XADD aip:stream:gw:{gatewayId}:events
owner 未知（无 bot 绑定 / 有 bot 无 owner）→ XADD aip:stream:gw:pending:events + 告警。

使用 fakeredis（真实 GET/XADD 语义）验证精准送达路径与 pending 兜底路径均被触发。
注意：redis.asyncio 的 xlen/xrange 均为协程，必须在 async 作用域内 await。
"""

from __future__ import annotations

import asyncio

import fakeredis
import pytest

from src.queue import redis_stream as rs
from src.runtime.events import AgentEvent


@pytest.fixture()
def redis():
    """每用例独立的 fakeredis 服务，避免跨用例键污染。"""
    server = fakeredis.FakeServer()
    r = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    yield r


def test_explicit_target_gw_xadds_to_that_gateway_stream(redis):
    """显式 target_gw 时直接落到对应 per-owner 流，跳过 owner 解析。"""

    async def run():
        producer = rs.StreamProducer(redis)
        await producer.publish_agent_event(
            session_id="s1",
            user_id="u1",
            channel="wecom_bot",
            agent_id="a1",
            trace_id="t1",
            event=AgentEvent.text_delta("hello"),
            target_gw="gwZ",
        )
        key = rs.StreamProducer.get_outbound_stream_key("gwZ")
        assert await redis.xlen(key) == 1
        assert await redis.xlen(rs.PENDING_OUTBOUND_STREAM) == 0
        fields = dict((await redis.xrange(key))[0][1])
        assert fields["sessionId"] == "s1"
        assert fields["channel"] == "wecom-bot"  # 渠道名经 to_gateway_channel 映射
        assert fields["eventType"] == "text.delta"

    asyncio.run(run())


def test_owner_resolved_via_session_bot_chain(redis):
    """未指定 target_gw：经 session→bot→owner 解析后精准落到 owner 的流。"""

    async def run():
        await redis.set(rs._session_bot_key("s2"), "botB")
        await redis.set(rs._bot_owner_key("botB"), "gwB")
        producer = rs.StreamProducer(redis)
        await producer.publish_agent_event(
            session_id="s2",
            user_id="u2",
            channel="h5",
            agent_id="a2",
            trace_id="t2",
            event=AgentEvent.text_delta("yo"),
        )
        assert await redis.xlen(rs.StreamProducer.get_outbound_stream_key("gwB")) == 1
        assert await redis.xlen(rs.PENDING_OUTBOUND_STREAM) == 0

    asyncio.run(run())


def test_no_session_bot_binding_falls_to_pending(redis, monkeypatch):
    """owner 解析失败（无 session→bot 绑定）落到 pending 流并告警。"""

    warnings: list = []
    monkeypatch.setattr(rs.logger, "warning", lambda *a, **k: warnings.append((a, k)))

    async def run():
        producer = rs.StreamProducer(redis)
        await producer.publish_agent_event(
            session_id="s9",
            user_id="u9",
            channel="h5",
            agent_id="a9",
            trace_id="t9",
            event=AgentEvent.text_delta("x"),
        )
        assert await redis.xlen(rs.PENDING_OUTBOUND_STREAM) == 1
        assert await redis.xlen(rs.StreamProducer.get_outbound_stream_key("gwX")) == 0

    asyncio.run(run())
    assert any(
        "pending" in str(w).lower() or "unknown" in str(w).lower() for w in warnings
    ), f"expected pending fallback warning, got: {warnings}"


def test_bot_bound_but_owner_unknown_falls_to_pending(redis, monkeypatch):
    """有 bot 绑定但 owner 未知 → 同样落 pending 流并告警。"""

    warnings: list = []
    monkeypatch.setattr(rs.logger, "warning", lambda *a, **k: warnings.append((a, k)))

    async def run():
        await redis.set(rs._session_bot_key("s3"), "botC")  # 故意不写 owner
        producer = rs.StreamProducer(redis)
        await producer.publish_agent_event(
            session_id="s3",
            user_id="u3",
            channel="h5",
            agent_id="a3",
            trace_id="t3",
            event=AgentEvent.text_delta("z"),
        )
        assert await redis.xlen(rs.PENDING_OUTBOUND_STREAM) == 1

    asyncio.run(run())
    assert any(
        "owner" in str(w).lower() or "pending" in str(w).lower() for w in warnings
    ), f"expected owner-unknown warning, got: {warnings}"


def test_channel_web_maps_to_h5_in_event(redis):
    """渠道名一致性：backend `web` 经 to_gateway_channel 映射到 gateway `h5`。"""

    async def run():
        producer = rs.StreamProducer(redis)
        await producer.publish_agent_event(
            session_id="s4",
            user_id="u4",
            channel="web",
            agent_id="a4",
            trace_id="t4",
            event=AgentEvent.text_delta("w"),
            target_gw="gwW",
        )
        key = rs.StreamProducer.get_outbound_stream_key("gwW")
        fields = dict((await redis.xrange(key))[0][1])
        assert fields["channel"] == "h5"

    asyncio.run(run())


def test_h5_sticky_session_gateway_wins_over_bot_owner(redis):
    """T7 H5/wecom-h5 粘滞：channel=h5 时优先按 session→gateway WS 落点（修 N5）。

    即便 session→bot→owner 解析链指向另一 gateway，H5 渠道仍落到持有该会话 WS 的
    gateway 的 per-owner 流（与 TS `aip:session:{sid}:gateway` 对齐）。
    """

    async def run():
        # 同时写入两条解析链：粘滞 gateway 与 bot→owner gateway
        await redis.set(rs._session_gateway_key("s5"), "gwSticky")
        await redis.set(rs._session_bot_key("s5"), "botB")
        await redis.set(rs._bot_owner_key("botB"), "gwBotOwner")
        producer = rs.StreamProducer(redis)
        await producer.publish_agent_event(
            session_id="s5",
            user_id="u5",
            channel="h5",
            agent_id="a5",
            trace_id="t5",
            event=AgentEvent.text_delta("sticky"),
        )
        # 必须落到粘滞 gateway 的流，而非 bot owner 的流
        assert await redis.xlen(rs.StreamProducer.get_outbound_stream_key("gwSticky")) == 1
        assert (
            await redis.xlen(rs.StreamProducer.get_outbound_stream_key("gwBotOwner")) == 0
        )
        assert await redis.xlen(rs.PENDING_OUTBOUND_STREAM) == 0

    asyncio.run(run())


def test_wecom_h5_channel_uses_session_gateway(redis):
    """T7 wecom-h5 渠道同样走 session→gateway 粘滞解析。"""

    async def run():
        await redis.set(rs._session_gateway_key("s6"), "gwWc")
        producer = rs.StreamProducer(redis)
        await producer.publish_agent_event(
            session_id="s6",
            user_id="u6",
            channel="wecom_h5",
            agent_id="a6",
            trace_id="t6",
            event=AgentEvent.text_delta("wc"),
        )
        assert await redis.xlen(rs.StreamProducer.get_outbound_stream_key("gwWc")) == 1

    asyncio.run(run())
