"""In-memory async Redis double that emulates the lease Lua scripts.

fakeredis 2.x does not implement `EVAL` for custom Lua, but the production lease
code (``CoreOwnership`` / ``RedisSessionLock``) relies on hand-written Lua
(``SET NX PX`` + fencing + 看门狗续期). 本 double 用进程内字典复刻这三段脚本的语义，
仅在单测中使用，绝不进入生产路径。脚本按「对象身份」匹配（与 production 引用的是
同一模块常量），避免文本匹配脆弱性。

@internal test-helper
"""

from __future__ import annotations

from typing import Any

from src.cluster import core_ownership as co
from src.cluster import session_lock as sl


class LuaFakeRedis:
    """极简 async Redis：支持 lease 代码用到的 GET/SET/EVAL/SADD/SMEMBERS。"""

    def __init__(self) -> None:
        # key -> (value, expire_at_ms) — 单测中不模拟 TTL 过期
        self._store: dict[str, tuple[str, int]] = {}
        self._sets: dict[str, set[str]] = {}

    async def eval(self, script: str, numkeys: int, *args: Any) -> Any:
        """分发到对应脚本的复刻实现（按常量身份匹配）。"""
        key = args[0]
        argv = list(args[1:])
        if script is co._CLAIM_SCRIPT:
            return self._claim(key, argv)
        if script is co._RENEW_SCRIPT:
            return self._renew(key, argv)
        if script is co._RELEASE_SCRIPT:
            return self._release(key, argv)
        if script is sl._RENEW_SCRIPT:
            return self._renew(key, argv)
        if script is sl._RELEASE_SCRIPT:
            return self._release(key, argv)
        raise AssertionError("unexpected lua script in test double")

    def _claim(self, key: str, argv: list[Any]) -> int:
        cur = self._store.get(key)
        cur_val = cur[0] if cur else None
        if cur_val == argv[0]:
            self._store[key] = (argv[0], 0)
            return 1
        if cur_val is not None and cur_val != argv[0]:
            return 0
        self._store[key] = (argv[0], 0)
        return 1

    def _renew(self, key: str, argv: list[Any]) -> int:
        cur = self._store.get(key)
        cur_val = cur[0] if cur else None
        if cur_val == argv[0]:
            self._store[key] = (argv[0], 0)
            return 1
        return 0

    def _release(self, key: str, argv: list[Any]) -> int:
        cur = self._store.get(key)
        cur_val = cur[0] if cur else None
        if cur_val == argv[0]:
            self._store.pop(key, None)
            return 1
        return 0

    async def get(self, key: str) -> Any:
        cur = self._store.get(key)
        return cur[0] if cur else None

    async def set(
        self,
        key: str,
        value: Any,
        ex: int | None = None,
        px: int | None = None,
        nx: bool = False,
        xx: bool = False,
    ) -> Any:
        if nx and key in self._store:
            return None
        if xx and key not in self._store:
            return None
        self._store[key] = (value, 0)
        return True

    async def delete(self, key: str) -> int:
        return 1 if self._store.pop(key, None) is not None else 0

    async def sadd(self, key: str, member: str) -> int:
        self._sets.setdefault(key, set()).add(member)
        return 1

    async def smembers(self, key: str) -> list[str]:
        return list(self._sets.get(key, set()))
