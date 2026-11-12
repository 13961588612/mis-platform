"""Shared async Redis client accessor for the HITL stores (Phase 1: Redis backend).

Reuses the project's existing ``redis.asyncio`` idiom (lazy
``aioredis.from_url(settings.redis_url)``) but centralizes a single shared
client per process so the ``ApprovalStore`` and ``FormFillPendingStore`` reuse
one connection pool — satisfying the "不要新开裸连接 / 复用同一客户端实例"
constraint while still honoring the ``aip:`` key prefix convention.

Tests inject a fake client (``fakeredis.aioredis.FakeRedis``) via
``set_hitl_redis`` so the stores can run without a real Redis server and so
two store instances can share one in-memory backend to simulate cross-replica
failover.
"""

from __future__ import annotations

import redis.asyncio as aioredis

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("hitl.redis")

_client: "aioredis.Redis | None" = None


def set_hitl_redis(client: "aioredis.Redis") -> None:
    """Inject a Redis client (tests use ``fakeredis``). Overrides the lazy default."""
    global _client
    _client = client


def reset_hitl_redis() -> None:
    """Clear any injected / lazily-created client (used for test isolation)."""
    global _client
    _client = None


async def get_hitl_redis() -> "aioredis.Redis":
    """Return the shared async Redis client, creating it lazily if necessary."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _client
