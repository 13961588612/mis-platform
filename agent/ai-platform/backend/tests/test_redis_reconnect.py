"""Redis 死连接判定单测。"""

from __future__ import annotations

from src.utils.redis_reconnect import is_broken_redis_connection


def test_type_error_write_ready_is_broken() -> None:
    assert is_broken_redis_connection(TypeError("'NoneType' object is not callable"))


def test_connection_error_is_broken() -> None:
    assert is_broken_redis_connection(ConnectionError("Connection closed"))


def test_unrelated_type_error_not_broken() -> None:
    assert not is_broken_redis_connection(TypeError("expected str, got int"))


def test_value_error_not_broken() -> None:
    assert not is_broken_redis_connection(ValueError("bad"))
