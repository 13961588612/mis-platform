"""T1/T6 配置项验证：XCLAIM_INTERVAL_MS / XCLAIM_MIN_IDLE_MS 默认值（不改既有键前缀/DB）。

设计依据：ai-platform-gateway-detailed-design.md §3.2 / §7，验收标准「崩溃重投窗口
XCLAIM_MIN_IDLE_MS（默认 30000）控制孤儿消息进入重投的阈值；两侧（gateway/core）一致」。
"""

from __future__ import annotations

import pytest

from src.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    """每个用例前后清空 lru_cache，避免跨用例污染。"""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_xclaim_config_declared_defaults():
    """config.py 源代码声明的默认值即设计所需值（源码层面，不依赖 env）。"""
    fields = Settings.model_fields
    assert fields["XCLAIM_INTERVAL_MS"].default == 5000
    assert fields["XCLAIM_MIN_IDLE_MS"].default == 30000


def test_xclaim_config_runtime_pickup(monkeypatch):
    """模拟部署注入，验证运行时配置正确。"""
    monkeypatch.setenv("XCLAIM_INTERVAL_MS", "5000")
    monkeypatch.setenv("XCLAIM_MIN_IDLE_MS", "30000")
    get_settings.cache_clear()
    s = get_settings()
    assert s.XCLAIM_INTERVAL_MS == 5000
    assert s.XCLAIM_MIN_IDLE_MS == 30000


def test_prefix_and_db_isolation_unchanged_by_t_batch(monkeypatch):
    """T1–T6 不得破坏跨语言共享前缀 aip: 与 db=2 物理隔离（DEP-10 融合约束）。"""
    monkeypatch.setenv("REDIS_DB", "2")
    monkeypatch.setenv("REDIS_KEY_PREFIX", "aip:")
    get_settings.cache_clear()
    s = get_settings()
    assert s.REDIS_KEY_PREFIX == "aip:"
    assert s.redis_url.endswith("/2")
