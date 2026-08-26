"""QuotaManager 限额解析：system.yaml cost_control + Settings 覆盖。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.llm.quota_manager import (
    QuotaLimits,
    QuotaManager,
    load_cost_control_from_system_yaml,
    resolve_quota_limits,
)


def test_load_cost_control_from_repo_system_yaml() -> None:
    """能从仓库 configs/system/system.yaml 读到 cost_control。"""
    settings = MagicMock()
    settings.CONFIG_BASE_PATH = "/nonexistent/configs"
    cost = load_cost_control_from_system_yaml(settings)
    assert isinstance(cost, dict)
    assert "default_quota" in cost
    assert int(cost["default_quota"]["per_user"]) > 0
    assert int(cost["default_quota"]["per_department"]) > 0
    assert 0 < float(cost["alert_threshold"]) <= 1
    assert isinstance(cost["hard_limit"], bool)


def test_resolve_prefers_env_over_yaml() -> None:
    """Settings 非空字段优先于 yaml。"""
    settings = MagicMock()
    settings.CONFIG_BASE_PATH = "/nonexistent/configs"
    settings.LLM_QUOTA_PER_USER = 5_000_000
    settings.LLM_QUOTA_PER_DEPARTMENT = None
    settings.LLM_QUOTA_ALERT_THRESHOLD = None
    settings.LLM_QUOTA_HARD_LIMIT = False

    yaml_cost = load_cost_control_from_system_yaml(settings)
    yaml_dept = int(yaml_cost["default_quota"]["per_department"])

    limits = resolve_quota_limits(settings)
    assert limits.per_user == 5_000_000
    assert limits.per_department == yaml_dept
    assert limits.hard_limit is False
    assert "per_user=env" in limits.source
    assert "per_department=yaml" in limits.source


def test_quota_manager_uses_injected_limits() -> None:
    limits = QuotaLimits(
        per_user=42,
        per_department=99,
        alert_threshold=0.5,
        hard_limit=True,
        source="test",
    )
    qm = QuotaManager(limits=limits)
    assert qm._default_user_limit == 42
    assert qm._default_dept_limit == 99
    assert qm._alert_threshold == 0.5


@pytest.mark.asyncio
async def test_soft_limit_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    """hard_limit=false 时超限仅告警，仍返回 True。"""
    limits = QuotaLimits(
        per_user=100,
        per_department=1000,
        alert_threshold=0.8,
        hard_limit=False,
        source="test",
    )
    qm = QuotaManager(limits=limits)

    class _FakeRedis:
        async def get(self, key: str) -> str:
            return "200"

    async def _redis() -> _FakeRedis:
        return _FakeRedis()

    monkeypatch.setattr(qm, "_get_redis", _redis)
    assert await qm.check_quota("1", "", estimated_tokens=10) is True


@pytest.mark.asyncio
async def test_quota_check_reconnects_on_dead_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Redis transport 死后，QuotaManager 应重建连接并重试成功。"""
    limits = QuotaLimits(
        per_user=10_000,
        per_department=100_000,
        alert_threshold=0.8,
        hard_limit=True,
        source="test",
    )
    qm = QuotaManager(limits=limits)

    class _Dead:
        async def get(self, key: str) -> str:
            raise TypeError("'NoneType' object is not callable")

    class _Alive:
        def __init__(self) -> None:
            self.calls = 0

        async def get(self, key: str) -> str:
            self.calls += 1
            return "0"

    clients: list[object] = [_Dead(), _Alive()]
    idx = {"i": 0}

    async def _get() -> object:
        client = clients[min(idx["i"], len(clients) - 1)]
        idx["i"] += 1
        return client

    async def _reset() -> None:
        return None

    monkeypatch.setattr(qm, "_get_redis", _get)
    monkeypatch.setattr(qm, "_reset_redis", _reset)
    assert await qm.check_quota("u1", "", estimated_tokens=10) is True
    assert isinstance(clients[1], _Alive)
    assert clients[1].calls == 1
