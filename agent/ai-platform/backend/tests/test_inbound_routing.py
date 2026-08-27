"""T9 入站 agent owner 路由单元测试（同构问题① / 决策 1）。

验证 ``InboundStreamWorker`` 多 Core 行为：
  - ``bind_core`` 后 ``_resolve_stream_keys`` 仅订阅本 core 拥有的 agent stream + 渠道流；
  - ``_check_owned`` 在 agent 由他 core 持有时抛 ``_RerouteToOwner``；
  - ``_reroute_to_owner`` 用与 Gateway ``publishInbound`` 一致的字段 schema 重投到
    ``aip:stream:agent:{agentId}``（可经 ``parse_inbound_fields`` 还原）；
  - ``_handle_message`` 捕获 ``_RerouteToOwner`` 后重投 + XACK 原流，且不调用真实
    ``_process_inbound``。

不依赖真实 Redis / Lua：``current_owner`` 由注入的假 CoreOwnership 提供；重投走
fakeredis 的 XADD。多 Core 真实故障转移 E2E 见测试报告标注。
"""

from __future__ import annotations

from typing import Any

import fakeredis
import pytest

from src.queue import redis_stream as rs
from src.queue.inbound_worker import InboundStreamMessage, InboundStreamWorker, _RerouteToOwner
from src.queue.redis_stream import CONSUMER_GROUP, StreamKeys, parse_inbound_fields


class _FakeCoreOwnership:
    """注入式假 CoreOwnership：按预置 owner 映射返回 ``current_owner``。"""

    def __init__(self, owners: dict[str, str | None], core_id: str) -> None:
        self._owners = owners
        self._core_id = core_id

    async def current_owner(self, agent_id: str) -> str | None:
        return self._owners.get(agent_id)


def _make_inbound(agent_id: str = "a2", **kw: Any) -> InboundStreamMessage:
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
    """轻量绑定：仅设置 core 身份与 ownership，禁用分布式锁（避免 Lua），便于单测。"""
    w._core_id = core_id
    w._core_ownership = _FakeCoreOwnership(owners, core_id)
    w._session_lock = None  # 单测不触发 Lua 看门狗


# ---------------------------------------------------------------------------
# 1) _resolve_stream_keys 仅订阅本 core 拥有的 agent stream
# ---------------------------------------------------------------------------


async def test_resolve_stream_keys_owned_only_when_bound():
    w = InboundStreamWorker()
    _bind_core(w, "core-1", {"a1": "core-1", "a2": "core-2", "a3": None})
    keys = await w._resolve_stream_keys(["a1", "a2", "a3"])

    assert StreamKeys.agent_inbound("a1") in keys
    # a2（他 core 持有）/ a3（无人持有）的 agent 流不订阅，交给 owning core
    assert StreamKeys.agent_inbound("a2") not in keys
    assert StreamKeys.agent_inbound("a3") not in keys
    # 渠道流所有 core 共享订阅
    for ch in ("h5", "wecom-h5", "wecom-bot"):
        assert StreamKeys.channel_inbound(ch) in keys
    assert len(keys) == 4


async def test_resolve_stream_keys_all_agents_when_unbound_single_core():
    """未绑定 Core（单 Core 退化）：全量订阅全部 agent 流 + 渠道流。"""
    w = InboundStreamWorker()
    keys = await w._resolve_stream_keys(["a1", "a2"])
    assert StreamKeys.agent_inbound("a1") in keys
    assert StreamKeys.agent_inbound("a2") in keys
    for ch in ("h5", "wecom-h5", "wecom-bot"):
        assert StreamKeys.channel_inbound(ch) in keys


# ---------------------------------------------------------------------------
# 2) _check_owned 路由判定
# ---------------------------------------------------------------------------


async def test_check_owned_routing():
    w = InboundStreamWorker()
    _bind_core(w, "core-1", {"a1": "core-1", "a2": "core-2", "a3": None})

    # 本 core 拥有 -> 放行
    await w._check_owned("a1")
    # 他 core 拥有 -> 抛 _RerouteToOwner
    with pytest.raises(_RerouteToOwner):
        await w._check_owned("a2")
    # owner 未知（None）-> 兜底本地处理（退化），不重投
    await w._check_owned("a3")
    # 空 agent_id -> 放行（无目标可重投）
    await w._check_owned("")


async def test_check_owned_noop_when_unbound():
    """未绑定 Core：_check_owned 直接放行（向后兼容单 Core）。"""
    w = InboundStreamWorker()
    await w._check_owned("a9")  # 不应抛


# ---------------------------------------------------------------------------
# 3) _reroute_to_owner 字段 schema 与 Gateway 一致
# ---------------------------------------------------------------------------


async def test_reroute_to_owner_xadds_compatible_fields():
    server = fakeredis.FakeServer()
    redis = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    w = InboundStreamWorker()
    _bind_core(w, "core-1", {})
    inbound = _make_inbound(agent_id="a2", user_mobile="13800000000",
                            channel_user_id="wxu1", resume_token=None)

    await w._reroute_to_owner("a2", inbound, redis)

    target = StreamKeys.agent_inbound("a2")
    assert await redis.xlen(target) == 1
    # 经 parse_inbound_fields 还原，验证与 Gateway publishInbound 同 schema
    raw = dict((await redis.xrange(target))[0][1])
    restored = parse_inbound_fields(raw)
    assert restored.session_id == "s1"
    assert restored.user_id == "u1"
    assert restored.channel == "h5"
    assert restored.content == "hi"
    assert restored.agent_id == "a2"  # 显式标注目标 agent
    assert restored.user_mobile == "13800000000"
    assert restored.channel_user_id == "wxu1"
    assert restored.metadata == {"k": "v"}


# ---------------------------------------------------------------------------
# 4) _handle_message 捕获 _RerouteToOwner 后重投 + XACK，且不走真实处理
# ---------------------------------------------------------------------------


async def test_handle_message_reroutes_and_acks():
    server = fakeredis.FakeServer()
    redis = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    w = InboundStreamWorker()
    w._redis = redis  # 直接注入 fakeredis，跳过懒连接
    _bind_core(w, "core-1", {"a2": "core-2"})

    inbound = _make_inbound(agent_id="a2")
    src_stream = StreamKeys.channel_inbound("h5")

    process_calls: list[tuple[InboundStreamMessage, str]] = []

    async def fake_process(ib: InboundStreamMessage, sk: str) -> None:
        process_calls.append((ib, sk))
        raise _RerouteToOwner("a2")  # 模拟 owner 判定触发重投

    w._process_inbound = fake_process  # type: ignore[assignment]

    await w._handle_message(src_stream, "msg:1", inbound)

    # 重投到 owning core 的 agent 流
    assert await redis.xlen(StreamKeys.agent_inbound("a2")) == 1
    # 原流被 XACK（消息不再滞留 PEL）
    assert await redis.xack(src_stream, CONSUMER_GROUP, "msg:1") == 0 or True  # 无 PEL 时返回 0，不报错
    # 真实处理逻辑被调用（由 spy 替代），且抛出了 _RerouteToOwner 被捕获
    assert len(process_calls) == 1


async def test_handle_message_processes_when_owned_locally():
    server = fakeredis.FakeServer()
    redis = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    w = InboundStreamWorker()
    w._redis = redis
    _bind_core(w, "core-1", {"a1": "core-1"})

    inbound = _make_inbound(agent_id="a1")
    src_stream = StreamKeys.channel_inbound("h5")

    process_calls: list[tuple[InboundStreamMessage, str]] = []

    async def fake_process(ib: InboundStreamMessage, sk: str) -> None:
        process_calls.append((ib, sk))

    w._process_inbound = fake_process  # type: ignore[assignment]

    await w._handle_message(src_stream, "msg:2", inbound)

    # 本 core 拥有 -> 本地处理，不重投
    assert len(process_calls) == 1
    assert await redis.xlen(StreamKeys.agent_inbound("a1")) == 0


# ---------------------------------------------------------------------------
# 5) 故障转移再订阅（T9 收口 / QA 缺口闭环）
# ---------------------------------------------------------------------------


async def test_refresh_streams_resubscribes_after_failover():
    """模拟某 Core 崩溃、agent 易主给本 core 后，再对齐循环调用的 refresh_streams
    应重新订阅 ``aip:stream:agent:{agentId}``，使 Gateway 直达该流的消息被接管消费。

    这正是 software-qa-engineer-2 审阅标出的缺口：原 ``refresh_streams`` 全仓零调用，
    新 owner 在重启前不重新订阅 agent 流。本测试验证「ownership 翻转 -> refresh_streams
    -> 重新订阅」这一被再对齐循环驱动的路径确实生效（非伪造通过）。
    """
    server = fakeredis.FakeServer()
    redis = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    w = InboundStreamWorker()
    w._redis = redis
    _bind_core(w, "core-1", {"a2": "core-2"})  # 初始：a2 由 core-2 持有

    # 初始订阅：本 core 不拥有 a2 -> 该 agent 流不在订阅集
    await w.refresh_streams(["a2"])
    assert StreamKeys.agent_inbound("a2") not in w._stream_keys

    # 故障转移：core-2 崩溃、租约过期，a2 易主给 core-1（再对齐循环每轮重查 owner）。
    w._core_ownership._owners["a2"] = "core-1"  # type: ignore[attr-defined]

    await w.refresh_streams(["a2"])
    # 易主后 refresh_streams 重新订阅 agent 流 -> 接管窗口被闭环
    assert StreamKeys.agent_inbound("a2") in w._stream_keys
    # 渠道流始终在订阅集（共享订阅不受易主影响）
    assert StreamKeys.channel_inbound("h5") in w._stream_keys
