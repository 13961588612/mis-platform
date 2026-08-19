"""T8 Agent 运行时租约选主单元测试（同构 BotOwnership / 决策 1）。

验证 ``CoreOwnership`` 的分布式租约语义（手写 Lua：SET NX PX + 同主续租 + 他主拒绝
+ fencing 释放）：一 agent 一 owner，多 Core 争抢仅一个成功；续租失败（易主）可触发
on_lost 回调；释放仅 owner 可删（fencing）。

Lua 由 ``tests._lua_fakeredis.LuaFakeRedis`` 进程内复刻（fakeredis 不支持 EVAL）。
多 Core 真实故障转移 E2E 见测试报告标注。
"""

from __future__ import annotations

import asyncio

import pytest

from src.cluster import core_ownership as co
from tests._lua_fakeredis import LuaFakeRedis


async def test_claim_is_exclusive_between_cores():
    """同 agent 仅一个 core 能成为 owner；他 core 抢注被拒。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1", lease_ttl_s=30, heartbeat_s=10)
    c2 = co.CoreOwnership(r, "core-2", lease_ttl_s=30, heartbeat_s=10)

    assert await c1.claim("agentA") is True
    # 他 core 已持有 -> 拒绝
    assert await c2.claim("agentA") is False
    assert await c1.current_owner("agentA") == "core-1"
    # 同主续租成功，他主续租失败
    assert await c1.renew("agentA") is True
    assert await c2.renew("agentA") is False


async def test_release_frees_lease_for_other_core():
    """owner 释放后，他 core 可接管。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1")
    c2 = co.CoreOwnership(r, "core-2")

    await c1.claim("agentX")
    await c1.release("agentX")
    assert await c1.current_owner("agentX") is None
    assert await c2.claim("agentX") is True
    assert await c2.current_owner("agentX") == "core-2"


async def test_release_is_fenced_to_owner():
    """非 owner 的 release 不得误删他者租约（fencing）。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1")
    c2 = co.CoreOwnership(r, "core-2")

    await c1.claim("agentY")
    # c2 误调用 release（非 owner）应无效果
    await c2.release("agentY")
    assert await c1.current_owner("agentY") == "core-1"


async def test_same_core_reclaim_refreshes_ttl():
    """同 core 重启（同 ID）重认领应成功（覆盖重启场景）。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1")
    c1b = co.CoreOwnership(r, "core-1")  # 同 ID 的「新实例」

    assert await c1.claim("agentZ") is True
    assert await c1b.claim("agentZ") is True
    assert await c1b.current_owner("agentZ") == "core-1"


async def test_get_core_id_priority():
    """get_core_id 优先级：CORE_ID 环境变量 > hostname > 随机（告警）。"""
    import os

    os.environ["CORE_ID"] = "core-explicit"
    try:
        assert co.get_core_id() == "core-explicit"
    finally:
        del os.environ["CORE_ID"]


async def test_heartbeat_triggers_on_lost_on_renew_failure():
    """心跳续租失败（已易主）触发 on_lost 回调（上层据此停本地运行时）。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1", lease_ttl_s=30, heartbeat_s=1)
    c1._heartbeat_s = 0.02  # 绕过 max(1, ...) 让单测快速触发
    lost: list[str] = []
    c1.start_heartbeat(on_lost=lambda aid: lost.append(aid))
    await c1.claim("agentL")

    # 模拟易主：外部直接覆盖 owner 为 core-2
    await r.set(co.agent_owner_key("agentL"), "core-2")

    await asyncio.sleep(0.15)
    c1.stop_heartbeat()
    assert "agentL" in lost


async def test_heartbeat_writes_liveness_members():
    """心跳写存活集合 aip:cores:members + aip:core:{id}:alive。"""
    r = LuaFakeRedis()
    c1 = co.CoreOwnership(r, "core-1", lease_ttl_s=30, heartbeat_s=1)
    c1._heartbeat_s = 0.02
    c1.start_heartbeat()
    await asyncio.sleep(0.06)
    c1.stop_heartbeat()
    members = await c1.list_members()
    assert "core-1" in members
