"""连接看门狗测试（连接池失效自动恢复）。

锁定不变量：
1. 非基础设施错误（如 SQL 列错误）**不计数**、不触发重启；
2. 基础设施错误连续达阈值才触发重启（默认 2）；
3. 一次成功把计数清零；
4. 冷却窗口内的重复触发被抑制；
5. 阈值 <= 0 时整体停用；
6. 重启回调抛异常不冒泡（看门狗绝不拖垮主链路）。
"""

from __future__ import annotations

from typing import Any

import pytest

from src.agent.mis_iqd.mcp_watchdog import McpConnectionWatchdog

GONE_AWAY = "Error executing tool dry_run: [GENERIC_USER_ERROR] (2006, 'Server has gone away') phase=SQL_DRY_RUN"


class _Recorder:
    """记录重启调用。"""

    def __init__(self, *, raise_on_call: bool = False) -> None:
        self.calls: list[int | str] = []
        self._raise = raise_on_call

    async def __call__(self, connection_id: int | str) -> Any:
        self.calls.append(connection_id)
        if self._raise:
            raise RuntimeError("restart boom")
        return {"mcp_status": "running"}


@pytest.mark.asyncio
async def test_threshold_triggers_restart() -> None:
    rec = _Recorder()
    wd = McpConnectionWatchdog(threshold=2, cooldown_seconds=0, restart=rec)

    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is False  # 第 1 次
    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is True   # 第 2 次 -> 重启
    assert rec.calls == [1]
    # 重启后计数清零：再来一次不应立即触发
    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is False


@pytest.mark.asyncio
async def test_non_infra_error_does_not_count() -> None:
    rec = _Recorder()
    wd = McpConnectionWatchdog(threshold=1, cooldown_seconds=0, restart=rec)

    assert await wd.record_failure(1, RuntimeError("unknown column 'x'")) is False
    assert await wd.record_failure(1, RuntimeError("date_trunc not supported")) is False
    assert rec.calls == []


@pytest.mark.asyncio
async def test_success_resets_counter() -> None:
    rec = _Recorder()
    wd = McpConnectionWatchdog(threshold=3, cooldown_seconds=0, restart=rec)

    await wd.record_failure(1, RuntimeError(GONE_AWAY))
    await wd.record_failure(1, RuntimeError(GONE_AWAY))
    wd.record_success(1)  # 清零
    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is False
    assert rec.calls == []


@pytest.mark.asyncio
async def test_cooldown_suppresses_repeated_restarts() -> None:
    rec = _Recorder()
    wd = McpConnectionWatchdog(threshold=1, cooldown_seconds=10_000, restart=rec)

    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is True   # 第 1 次重启
    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is False  # 冷却窗口内 -> 抑制
    assert rec.calls == [1]


@pytest.mark.asyncio
async def test_per_connection_isolation() -> None:
    rec = _Recorder()
    wd = McpConnectionWatchdog(threshold=2, cooldown_seconds=0, restart=rec)

    await wd.record_failure(1, RuntimeError(GONE_AWAY))
    await wd.record_failure(2, RuntimeError(GONE_AWAY))
    assert rec.calls == []  # 各自只到 1 次
    assert await wd.record_failure(2, RuntimeError(GONE_AWAY)) is True
    assert rec.calls == [2]  # 只有连接 2 达标


@pytest.mark.asyncio
async def test_disabled_when_threshold_non_positive() -> None:
    rec = _Recorder()
    wd = McpConnectionWatchdog(threshold=0, cooldown_seconds=0, restart=rec)
    assert wd.enabled is False
    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is False
    assert rec.calls == []


@pytest.mark.asyncio
async def test_restart_exception_does_not_propagate() -> None:
    rec = _Recorder(raise_on_call=True)
    wd = McpConnectionWatchdog(threshold=1, cooldown_seconds=0, restart=rec)
    # 不应抛出
    assert await wd.record_failure(1, RuntimeError(GONE_AWAY)) is False
    assert rec.calls == [1]
