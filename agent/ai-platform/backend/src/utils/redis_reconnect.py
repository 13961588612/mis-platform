"""Redis asyncio 死连接判定与重建辅助。

长期运行的 Core 进程里，``redis.asyncio`` 客户端可能在 TCP 被对端关闭后
仍被单例缓存；下一次 ``GET`` 会在 ``StreamWriter.writelines`` 里触发
``TypeError: 'NoneType' object is not callable``（``_write_ready`` 已被置空）。

本模块只提供判定与「关掉旧客户端」逻辑，由各持有方在捕获后重建连接。
"""

from __future__ import annotations

from typing import Any


def is_broken_redis_connection(exc: BaseException) -> bool:
    """是否为可重试的 Redis 传输层故障（应丢弃客户端并重连）。

    Args:
        exc: 捕获到的异常。

    Returns:
        需要重建连接时 ``True``。
    """
    if isinstance(exc, (ConnectionError, OSError, TimeoutError)):
        return True
    try:
        from redis.exceptions import ConnectionError as RedisConnectionError
        from redis.exceptions import TimeoutError as RedisTimeoutError

        if isinstance(exc, (RedisConnectionError, RedisTimeoutError)):
            return True
    except ImportError:  # pragma: no cover
        pass
    # asyncio selector transport 已半关闭：``_write_ready`` 为 None
    if isinstance(exc, TypeError) and "not callable" in str(exc):
        return True
    return False


async def aclose_redis_quietly(client: Any) -> None:
    """尽量关闭 Redis 客户端，忽略关闭过程中的异常。"""
    if client is None:
        return
    try:
        await client.aclose()
    except Exception:  # noqa: BLE001 - 清理路径不得抛出
        pass
