#!/usr/bin/env python3
"""T11 故障注入 harness（逻辑层 + 真实 kill-9 多进程验证）。

env-gate
--------
仅当 ``E2E_REAL_REDIS == "1"`` 时执行 **真实 Redis** 故障注入；否则打印 SKIP 并退出 0。
本地默认不跑，避免依赖外部 Redis / 多进程。E2E 的 fakeredis 模拟版契约测试在
``test_e2e_cluster_contracts.py``（``pytest tests/e2e -q``）。

本文件刻意以 ``run_`` 前缀命名，避开 pytest 的 ``test_*`` 收集规则，不会在
``pytest tests/e2e`` 中被收集执行。

真实 kill-9 多进程验证流程（手动 / CI）
-------------------------------------
1. 起集群：``docker compose -f deploy/docker-compose.e2e.yml up -d``
   （redis + gw-a / gw-b + core-1 / core-2，注入 GATEWAY_ID / CORE_ID）。
2. 等所有实例 ``/health`` 就绪。
3. 跑本脚本（真实环境）：
   ``E2E_REAL_REDIS=1 REDIS_URL=redis://redis:6379/2 python backend/tests/e2e/run_fault_injection.py``
4. 注入 Core 崩溃：``docker kill -s KILL <core-1>``
   → 观察 core-2 在 ``AGENT_RESYNC_S(15s) < AGENT_LEASE_TTL_S(30s)`` 内接管 agent 租约
     并重订阅 ``aip:stream:agent:{agentId}``（T9 收口缺口闭环）。
5. 注入 Gateway 崩溃：``docker kill -s KILL <gw-a>``
   → 观察 gw-b 接管 bot 租约、出站事件改投 gw-b，且孤儿消息经 pending 兜底不丢。
6. 断言：故障窗口内消息「不丢不重恰好一次」——与 test_e2e_cluster_contracts.py 的
   6 场景逻辑层契约一致（前者 fakeredis 模拟，本脚本对接真实 Redis）。

逻辑层（REAL_REDIS=1 时）
--------------------------
复用与单测相同的真实模块（CoreOwnership / RedisSessionLock / StreamProducer /
InboundStreamWorker），在逻辑层注入「节点宕机」（释放租约 / 删除 owner 键）并断言
优雅降级，作为 kill-9 多进程验证前的快速冒烟。
"""

from __future__ import annotations

import asyncio
import os
import sys


def _real_redis_fault_injection() -> int:
    """对接真实 Redis，复用真实模块在逻辑层注入故障并断言（kill-9 前的冒烟）。"""
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/2")
    import redis.asyncio as aioredis

    from src.cluster import core_ownership as co
    from src.cluster.session_lock import RedisSessionLock
    from src.queue.redis_stream import PENDING_OUTBOUND_STREAM, StreamProducer

    async def _main() -> None:
        r = aioredis.from_url(redis_url, decode_responses=True)
        try:
            # ---- 注入：core-1 崩溃（释放 agent 租约）----
            c1 = co.CoreOwnership(r, "core-1")
            c2 = co.CoreOwnership(r, "core-2")
            assert await c1.claim("agentA"), "core-1 应成功认领 agentA"
            await c1.release("agentA")  # 模拟崩溃释放（生产为 TTL 过期）
            assert await c2.claim("agentA"), "core-2 应在 core-1 崩溃后接管 agentA"
            print("OK  logic-layer: agentA failover core-1 -> core-2")

            # ---- 注入：gw-a 崩溃（删除 bot owner 键）----
            producer = StreamProducer(r)
            await r.set("aip:bot:B1:owner", "gw-a")
            await r.set("aip:session:sB:bot", "B1")
            await r.delete("aip:bot:B1:owner")  # 模拟 gw-a 崩溃丢租约
            await producer.publish_agent_event(
                session_id="sB", user_id="u1", channel="wecom-bot",
                agent_id="a1", trace_id="t1",
                event=__import__("src.runtime.events", fromlist=["AgentEvent"]).AgentEvent.text_delta("hi"),
            )
            pending = await r.xlen(PENDING_OUTBOUND_STREAM)
            assert pending >= 1, "gw 崩溃后事件应降级 pending 不丢"
            print(f"OK  logic-layer: gw-a down -> event degraded to pending (xlen={pending})")

            # RedisSessionLock 真实可获取/释放（无死锁）。
            lock = RedisSessionLock(r, lock_ttl_s=30, extend_s=999, retry=3, retry_wait_s=0.01, core_id="core-1")
            async with lock.acquire("sessS") as res:
                assert res.locked, "真实 Redis 分布式 session 锁应能获取"
            print("OK  logic-layer: RedisSessionLock acquire/release on real Redis")
        finally:
            await r.aclose()

    asyncio.run(_main())
    return 0


def main() -> int:
    if os.environ.get("E2E_REAL_REDIS") != "1":
        print(
            "SKIP: run_fault_injection requires E2E_REAL_REDIS=1 with a reachable REDIS_URL."
        )
        print(
            "      Local fakeredis contract tests live in test_e2e_cluster_contracts.py"
        )
        print("      (run: pytest tests/e2e -q). See README.md for real kill-9 procedure.")
        return 0
    print("E2E_REAL_REDIS=1 -> running real-Redis logic-layer fault injection ...")
    return _real_redis_fault_injection()


if __name__ == "__main__":
    sys.exit(main())
