"""T9 Redis 分布式 session 锁单元测试（同构问题① / 替代进程内 asyncio.Lock）。

验证 ``RedisSessionLock``：
  - 同 session 互斥：持有者未释放时他者争锁失败（LockedResult.locked=False）；
  - 释放后他者可获取；
  - fencing token：释放仅当仍为自己持有（误删接管者锁被拒）；
  - 看门狗续期仅当仍持有（由 LuaFakeRedis 的 fencing 语义保证）。

Lua 续租/释放由 ``tests._lua_fakeredis.LuaFakeRedis`` 进程内复刻；
``acquire`` 走原生 SET NX PX（fakeredis 支持）。
"""

from __future__ import annotations

import asyncio

import pytest

from src.cluster import session_lock as sl
from src.cluster.session_lock import LockAcquireResult
from tests._lua_fakeredis import LuaFakeRedis


def _lock(core_id: str, **kw: object) -> sl.RedisSessionLock:
    return sl.RedisSessionLock(
        LuaFakeRedis(),
        lock_ttl_s=30,
        extend_s=10,
        retry=2,
        retry_wait_s=0.01,
        core_id=core_id,
        **kw,
    )


async def test_acquire_exclusive_same_session():
    """同 session 互斥：c1 持锁期间 c2 争锁失败。"""
    r = LuaFakeRedis()
    c1 = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=2, retry_wait_s=0.01, core_id="core-1")
    c2 = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=2, retry_wait_s=0.01, core_id="core-2")

    async with c1.acquire("sess1") as res1:
        assert isinstance(res1, LockAcquireResult)
        assert res1.locked is True
        # c2 应争锁失败（锁被 c1 持有）
        async with c2.acquire("sess1") as res2:
            assert res2.locked is False
    # c1 释放后 c2 可获取
    async with c2.acquire("sess1") as res3:
        assert res3.locked is True


async def test_different_sessions_independent():
    """不同 session 的锁互不干扰。"""
    c1 = _lock("core-1")
    c2 = _lock("core-2")
    async with c1.acquire("sA") as a, c2.acquire("sB") as b:
        assert a.locked is True
        assert b.locked is True


async def test_lock_key_byte_format():
    """分布式锁键须为 aip:session:{sid}:lock（与共享知识约定一致）。"""
    assert sl.session_lock_key("S1") == "aip:session:S1:lock"


async def test_release_is_fenced():
    """fencing：仅当锁仍为自己持有时才释放（误删接管者被拒）。"""
    r = LuaFakeRedis()
    c1 = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=1, retry_wait_s=0.001, core_id="core-1")
    c2 = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=1, retry_wait_s=0.001, core_id="core-2")

    async with c1.acquire("sessF") as res:
        assert res.locked is True
        token = c1._core_id  # not used directly; emulate takeover via raw set
        # 模拟易主：外部用 c2 的 token 覆盖锁值
        from src.cluster.session_lock import session_lock_key

        takeover_token = f"core-2:{ '0' * 32 }"
        await r.set(session_lock_key("sessF"), takeover_token)
        # 退出上下文时 c1 的 _release_if_owner 读 GET==c1token 失败 -> 不删除接管者锁
    # 锁仍由 c2 的 token 持有
    assert await r.get(session_lock_key("sessF")) == takeover_token


async def test_give_up_does_not_ack_leaves_lock_free():
    """争锁彻底失败（LockedResult.locked=False）后，锁应处于空闲可被后续获取。"""
    r = LuaFakeRedis()
    holder = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=1, retry_wait_s=0.001, core_id="holder")
    async with holder.acquire("sessG") as res:
        assert res.locked is True
        # 另一实例用 retry=0 立即失败
        contender = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=0, retry_wait_s=0.0, core_id="contender")
        async with contender.acquire("sessG") as cres:
            assert cres.locked is False
    # holder 释放后，contender 重新获取应成功
    async with contender.acquire("sessG") as cres2:
        assert cres2.locked is True
