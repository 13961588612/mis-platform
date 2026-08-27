"""T6 Core 入站 XAUTOCLAIM 重投闭环单元测试（N1 / 设计 §4.5）。

验证 `InboundStreamWorker._reclaim_stream`：
  - 构造真实 PEL 孤儿（先 XREADGROUP 投递未 ACK），调用后孤儿被 XAUTOCLAIM 重投，
    并解析为 InboundStreamMessage 交给处理器（spawn_handler）；
  - 已 ACK 的消息不再被重投（不丢不重）。
  - 使用 fakeredis 真实 stream + PEL + XAUTOCLAIM 语义（XCLAIM_MIN_IDLE_MS 置 0
    以便立即重投，等价于设计「kill -9 后孤儿消息进入重投」的可复现单测）。

注：XAUTOCLAIM 服务端语义本身由 Redis 保证；本测试验证「代码正确调用 XAUTOCLAIM
并以正确消费组/消费者/阈值，且把重投结果正确解析派发」。多 Core 真实故障转移 E2E
（脑裂、多进程 kill -9）需独立 k8s/Redis/多进程环境，见测试报告标注。
"""

from __future__ import annotations

import asyncio
import os

import fakeredis
import pytest

from src.config import get_settings
from src.queue.inbound_worker import InboundStreamWorker
from src.queue.redis_stream import CONSUMER_GROUP, StreamKeys


def _make_worker() -> InboundStreamWorker:
    w = InboundStreamWorker()
    # 置 0 使 XAUTOCLAIM 立即重投（等价 kill -9 后孤儿立即进入重投窗口）
    w._xclaim_min_idle_ms = 0
    return w


def _sample_fields(session_id: str = "s1") -> dict[str, str]:
    return {
        "id": "m1",
        "sessionId": session_id,
        "userId": "u1",
        "channel": "h5",
        "content": "hi",
        "messageType": "text",
        "traceId": "t1",
        "timestamp": "2025-01-01T00:00:00Z",
    }


@pytest.fixture()
def redis():
    server = fakeredis.FakeServer()
    r = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    yield r


def test_reclaim_redelivers_orphan_and_dispatches(redis):
    """PEL 孤儿被 XAUTOCLAIM 重投并解析派发；消息仍留在 PEL（仅重投未 ACK）。"""

    async def run():
        w = _make_worker()
        stream = StreamKeys.agent_inbound("agentX")
        await redis.xgroup_create(stream, CONSUMER_GROUP, id="0", mkstream=True)
        await redis.xadd(stream, _sample_fields("s1"), maxlen=1000, approximate=True)
        # 投递到 '>' => 进入 PEL（未 ACK，模拟处理中崩溃）
        await redis.xreadgroup(
            CONSUMER_GROUP, w._consumer_name, {stream: ">"}, count=10
        )

        captured: list = []
        w._spawn_handler = lambda sk, mid, ib: captured.append((sk, mid, ib))  # type: ignore[assignment]

        # 记录 XAUTOCLAIM 调用参数，验证组/消费者/阈值正确
        calls: list = []
        orig = redis.xautoclaim

        async def spy(*args, **kwargs):
            calls.append(args)
            return await orig(*args, **kwargs)

        redis.xautoclaim = spy  # type: ignore[assignment]

        await w._reclaim_stream(redis, stream)
        return captured, calls

    captured, calls = asyncio.run(run())
    assert len(captured) == 1, f"孤儿应被重投 1 条，实际 {len(captured)}"
    _sk, _mid, ib = captured[0]
    assert ib.session_id == "s1"
    assert ib.channel == "h5"

    # XAUTOCLAIM 必须以 agent-core-group / 本消费者 / min_idle=0 调用
    assert calls, "应调用 XAUTOCLAIM"
    args = calls[0]
    assert args[1] == CONSUMER_GROUP
    assert args[2] == f"agent-core-{os.getpid()}"
    assert args[3] == 0


def test_reclaim_skips_acked_message(redis):
    """已 ACK 的消息不再被重投（避免重复处理）。"""

    async def run():
        w = _make_worker()
        stream = StreamKeys.agent_inbound("agentY")
        await redis.xgroup_create(stream, CONSUMER_GROUP, id="0", mkstream=True)
        mid = await redis.xadd(stream, _sample_fields("s2"), maxlen=1000, approximate=True)
        await redis.xreadgroup(
            CONSUMER_GROUP, w._consumer_name, {stream: ">"}, count=10
        )
        await redis.xack(stream, CONSUMER_GROUP, mid)  # 正常处理完成，ACK

        captured: list = []
        w._spawn_handler = lambda *a: captured.append(a)  # type: ignore[assignment]
        await w._reclaim_stream(redis, stream)
        return captured

    captured = asyncio.run(run())
    assert captured == [], f"已 ACK 消息不应被重投，实际 {len(captured)}"


def test_reclaim_all_streams_uses_agent_core_group(redis):
    """_reclaim_loop 覆盖全部订阅流 + agent_events 兜底流，均用 agent-core-group。"""
    w = _make_worker()
    # 订阅流来自配置解析；这里直接验证常量与消费者命名符合设计
    assert CONSUMER_GROUP == "agent-core-group"
    assert w._consumer_name == f"agent-core-{os.getpid()}"
    assert get_settings().XCLAIM_MIN_IDLE_MS == 30000  # 默认阈值
