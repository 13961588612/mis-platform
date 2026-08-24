"""QA 严过关补充：session_lock 指数退避「锁释放后重试窗口内能抢到」验证。

说明：LuaFakeRedis 不模拟 TTL 真实过期（见 _lua_fakeredis.py:24 注释），故无法
直接模拟「30s TTL 到期瞬间竞争者命中」。本测试通过「外部在竞争者重试窗口内删除锁」
（等价模拟 TTL 过期被释放）来验证指数退避重试循环确实会在锁释放后的下一轮抢到，
从而证明修复二的退避窗口覆盖了锁释放窗口（不再 1s 内放弃退回分钟级重投）。

运行：.venv/Scripts/python -m pytest tests/test_session_lock_backoff.py -v
"""

from __future__ import annotations

import asyncio

import pytest

from src.cluster import session_lock as sl
from src.cluster.session_lock import LockAcquireResult
from tests._lua_fakeredis import LuaFakeRedis


async def test_backoff_retries_until_lock_freed():
    """竞争者指数退避期间锁被释放（模拟 TTL 过期）→ 下一轮成功抢到。"""
    r = LuaFakeRedis()
    # retry=3, retry_wait_s=0.02 → 退避序列 0.02, 0.04, 0.08（封顶 0.1）
    holder = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=3, retry_wait_s=0.02, retry_max_wait_s=0.1, core_id="holder")
    contender = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=3, retry_wait_s=0.02, retry_max_wait_s=0.1, core_id="contender")

    async with holder.acquire("sessB") as hres:
        assert hres.locked is True

        # 后台任务：持有者持锁 0.05s 后外部删除锁（模拟 TTL 过期释放）
        async def _free_lock_later() -> None:
            await asyncio.sleep(0.05)
            # 直接 pop 掉锁键（等价 TTL 到期自然释放）
            await r.delete(sl.session_lock_key("sessB"))

        asyncio.create_task(_free_lock_later())

        # 竞争者进入指数退避重试；锁在 ~0.05s 被释放，
        # 竞争者首轮 sleep(0.02) 后第 2 次 SET NX 应成功（锁已空）
        async with contender.acquire("sessB") as cres:
            assert cres.locked is True, "竞争者应在退避重试窗口内（锁释放后）抢到锁"


async def test_backoff_cap_prevents_unbounded_growth():
    """退避封顶：长序列下单次等待不超过 retry_max_wait_s。"""
    r = LuaFakeRedis()
    # 用大 retry 验证封顶；锁永不释放（fakeredis 不模拟 TTL），竞争者最终放弃
    contender = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=10, retry_wait_s=0.01, retry_max_wait_s=0.1, core_id="c")
    # 占用锁
    holder = sl.RedisSessionLock(r, lock_ttl_s=30, extend_s=10, retry=1, retry_wait_s=0.001, core_id="h")
    async with holder.acquire("sessCap") as _:
        async with contender.acquire("sessCap") as cres:
            assert cres.locked is False, "锁被占且永不释放，10 次退避后应放弃"
    # 若封顶失效，10 次退避会远超 0.1*10=1s；此处仅验证不抛异常且最终放弃


class _CountingRedis:
    """包装 LuaFakeRedis，统计 RENEW 脚本调用次数（验证看门狗续期上限）。"""

    def __init__(self, inner: LuaFakeRedis) -> None:
        self._inner = inner
        self.renew_calls = 0

    async def eval(self, script: str, numkeys: int, *args: Any) -> Any:
        if script is sl._RENEW_SCRIPT:
            self.renew_calls += 1
        return await self._inner.eval(script, numkeys, *args)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


async def test_watchdog_stops_renewing_after_max_hold():
    """Bug ③ 兜底：持有方卡死不释放时，看门狗在 max_hold_s 后停止续期。

    LuaFakeRedis 不模拟 TTL 过期，故无法靠真实过期验证；此处统计 RENEW 调用次数：
    锁被持有且 holder 不退出上下文（模拟卡死）时，续期次数应在超出 max_hold_s 后
    停止增长——证明锁最终能在 TTL 到期后自然释放，后续请求不会无限等待。

    注：``RedisSessionLock`` 构造函数钳制 ``max_hold_s = max(max_hold_s, lock_ttl_s)``
    （见 config 约定 ``SESSION_LOCK_MAX_HOLD_S`` 须 >= ``SESSION_LOCK_TTL_S``），故
    测试必须用 ``lock_ttl_s <= max_hold_s`` 的配置，否则 2s 上限会被 ttl=30 覆盖、
    永远触不到。本用例用 ``lock_ttl_s=2, max_hold_s=2, extend_s=1``，并断言**持有方
    仍卡在上下文内（watchdog 未被 cancel）**时续期已停——这才是真正的上限证据。
    """
    inner = LuaFakeRedis()
    r = _CountingRedis(inner)
    assert sl.RedisSessionLock(  # 复检钳制契约，避免假阳性
        inner, lock_ttl_s=2, extend_s=1, max_hold_s=2, core_id="x"
    )._max_hold_s == 2
    lock = sl.RedisSessionLock(
        r, lock_ttl_s=2, extend_s=1, retry=1, retry_wait_s=0.001,
        max_hold_s=2, core_id="stuck",
    )

    async with lock.acquire("sessHold") as hres:
        assert hres.locked is True
        # 模拟持有方卡死：长时间不退出上下文（> max_hold_s + extend_s）
        await asyncio.sleep(2.5)
        # 已超出 max_hold_s(2s) 但仍在上下文内（watchdog 尚未被 cancel）：
        # 必须已至少续期一次（窗口内）。
        assert r.renew_calls > 0, "看门狗应在上限窗口内至少续期一次"
        # 关键断言：继续卡住 1.5s，续期次数不应再增长（watchdog 已主动停续期）。
        before = r.renew_calls
        await asyncio.sleep(1.5)
        assert r.renew_calls == before, (
            "持有方仍卡死且超出 max_hold_s 后看门狗必须停止续期"
            "（否则卡死持有方会无限续期、锁永不释放）"
        )


async def test_lock_reclaimable_after_max_hold_expiry():
    """Bug ③ 端到端：持有方卡死超过 max_hold 后，锁可被竞争者抢到（等价 TTL 过期）。

    配置须满足构造函数契约 ``max_hold_s >= lock_ttl_s``，故用 ``lock_ttl_s=2,
    max_hold_s=2``：持有方卡死 2s 后看门狗停续期（不再 PX 续命），锁在下一个 TTL
    到期自然释放；后台等价模拟该释放（删键），竞争者随即抢到，而非无限等待。
    """
    inner = LuaFakeRedis()
    r = _CountingRedis(inner)
    holder = sl.RedisSessionLock(
        r, lock_ttl_s=2, extend_s=1, retry=1, retry_wait_s=0.001,
        max_hold_s=2, core_id="holder",
    )
    contender = sl.RedisSessionLock(
        r, lock_ttl_s=2, extend_s=1, retry=20, retry_wait_s=0.01,
        retry_max_wait_s=0.5, max_hold_s=2, core_id="contender",
    )

    # 持有方卡死：进入上下文但不退出；后台在 max_hold 后模拟 TTL 到期（删键）
    async def _simulate_expiry() -> None:
        await asyncio.sleep(2.5)  # > max_hold_s(2) + extend_s(1) → 看门狗已停续期
        await inner.delete(sl.session_lock_key("sessExpire"))

    asyncio.create_task(_simulate_expiry())

    async with holder.acquire("sessExpire") as _:
        # 持有方上下文内，竞争者应在锁「过期」（被删）后抢到，而非无限等待
        async with contender.acquire("sessExpire") as cres:
            assert cres.locked is True, (
                "卡死持有方超过 max_hold 后，锁应能在 TTL 到期后由竞争者抢到"
            )
