"""建模台 T08「主连接语义对齐」Python 侧契约守卫（设计 §14.5.1 B/C/D）。

核心验收 = **Java 与 Python 选主的一致性**（本任务真正验收点）。Java 权威口径为
``IqdAdminService.findPrimaryConnection()``：``name='default'`` 优先 → 最小 id
``enabled`` → 首行。Java 侧经 ``get-connections`` 以 ``is_primary`` 计算字段暴露该结果
（见 ``IqdInternalPrimaryConnectionTest``）；Python 侧本补丁**改为一律消费 ``is_primary``**
（单一真值源），**不再本地复现规则** ⇒ 两侧落点恒等。

覆盖：
- ``select_primary_connection_id`` 纯函数：多条 enabled + ``default`` 非最小 id →
  选 ``default``（**漂移核心反例**）；无 ``default`` → 最小 id enabled；空 → ``None``；
  旧响应（无 ``is_primary``）→ 首条（向后兼容）。
- ``IqdConfigClient.resolve_primary_connection_id``：消费 ``is_primary``；异常降级 ``None``。
- ``SyncCoordinator`` / ``IqdAskService`` 两处**委托**同一真值源（消除 3 份拷贝）。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.iqd_config_client import IqdConfigClient, select_primary_connection_id
from src.agent.mis_iqd.service import IqdAskService
from src.agent.mis_iqd.sync_coordinator import SyncCoordinator


# ============================================================ 共用夹具（与 Java 侧同构）

# 两条 enabled；name='default' 的 id=5 **更大**（最小 id 是 1=非 default）
# ⇒ 与 Java IqdInternalPrimaryConnectionTest 的「核心反例」用同一数据形状。
CONNECTIONS_TWO_ENABLED_DEFAULT_LARGER = [
    {"id": 1, "name": "sales", "enabled": True, "is_primary": False},
    {"id": 5, "name": "default", "enabled": True, "is_primary": True},
]
EXPECTED_PRIMARY_ID = 5  # == Java findPrimaryConnection() 的 id（default，非最小 id）

# 无 default：is_primary 落在最小 id enabled（id=2）
CONNECTIONS_NO_DEFAULT = [
    {"id": 2, "name": "a", "enabled": True, "is_primary": True},
    {"id": 7, "name": "b", "enabled": True, "is_primary": False},
]

# 旧版 mis-iqd 响应：无 is_primary 字段（向后兼容路径）
CONNECTIONS_LEGACY_NO_IS_PRIMARY = [
    {"id": 3, "name": "legacy-a"},
    {"id": 8, "name": "legacy-b"},
]


# ============================================================ 纯函数：select_primary_connection_id


def test_select_default_beats_smaller_id() -> None:
    """核心反例：default 的 id 更大时仍选 default，绝不选最小 id（消除历史漂移）。"""
    assert select_primary_connection_id(CONNECTIONS_TWO_ENABLED_DEFAULT_LARGER) == EXPECTED_PRIMARY_ID


def test_select_no_default_falls_back_to_first_min_id_enabled() -> None:
    """无 default ⇒ 落到最小 id enabled（is_primary 标记行）。"""
    assert select_primary_connection_id(CONNECTIONS_NO_DEFAULT) == 2


def test_select_legacy_payload_without_is_primary_uses_first_row() -> None:
    """旧响应无 is_primary ⇒ 退回首条（= 最小 id enabled，历史行为不变）。"""
    assert select_primary_connection_id(CONNECTIONS_LEGACY_NO_IS_PRIMARY) == 3


def test_select_empty_or_none_returns_none() -> None:
    """空清单 / None ⇒ 无主连接。"""
    assert select_primary_connection_id([]) is None
    assert select_primary_connection_id(None) is None


def test_select_coerces_str_id_and_rejects_bool() -> None:
    """字符串 id 规整为 int；bool 是 int 子类需排除（不得 True→1）。"""
    assert select_primary_connection_id([{"id": "42", "is_primary": True}]) == 42
    assert select_primary_connection_id([{"id": True, "is_primary": True}]) is None


# ============================================================ IqdConfigClient.resolve_primary_connection_id


@pytest.mark.asyncio
async def test_client_resolve_consumes_is_primary() -> None:
    """客户端解析消费 is_primary 单一真值源 ⇒ 与 Java 选出同一 id。"""
    client = IqdConfigClient()
    try:
        with patch.object(
            IqdConfigClient,
            "get_connections",
            new=AsyncMock(return_value=CONNECTIONS_TWO_ENABLED_DEFAULT_LARGER),
        ):
            cid = await client.resolve_primary_connection_id()
    finally:
        await client.aclose()
    assert cid == EXPECTED_PRIMARY_ID, "多条 enabled 下 Python 必须与 Java 同选 default"


@pytest.mark.asyncio
async def test_client_resolve_get_connections_actually_defined() -> None:
    """回归守卫：``get_connections`` 必须真实存在（历史悬空调用已修补）。

    ``resolve_primary_connection_id`` 依赖 ``get_connections``；若该方法缺失，
    ``AttributeError`` 会被降级 ``except`` 吞掉 ⇒ 主连接解析恒 None（静默坑）。
    """
    client = IqdConfigClient()
    try:
        method = getattr(client, "get_connections", None)
        assert callable(method), "IqdConfigClient.get_connections 必须已定义"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_client_resolve_degrades_to_none_on_error() -> None:
    """拉取异常 → warning + 返回 None（失败降级语义不变）。"""
    client = IqdConfigClient()
    try:
        with patch.object(
            IqdConfigClient,
            "get_connections",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            cid = await client.resolve_primary_connection_id()
    finally:
        await client.aclose()
    assert cid is None


# ============================================================ SyncCoordinator 委托


def _mock_client(return_value: int | None) -> MagicMock:
    """构造一个 mock IqdConfigClient（含异步 resolve / aclose）。

    显式 patch 类本身（而非依赖真实类），既锁定「委托」契约，也隔离其他测试对
    ``src.adapters.iqd_config_client.IqdConfigClient`` 的全局 patch 泄漏。
    """
    client = MagicMock()
    client.resolve_primary_connection_id = AsyncMock(return_value=return_value)
    client.aclose = AsyncMock()
    return client


@pytest.mark.asyncio
async def test_sync_coordinator_resolve_delegates_to_client() -> None:
    """SyncCoordinator 选主**委托**客户端 ⇒ 与 Java 一致（不再本地取 connections[0]）。"""
    coordinator = SyncCoordinator(coalesce_window_sec=0.0)
    mock_client = _mock_client(EXPECTED_PRIMARY_ID)
    with patch("src.adapters.iqd_config_client.IqdConfigClient", return_value=mock_client):
        cid = await coordinator._resolve_primary_connection_id()
    assert cid == EXPECTED_PRIMARY_ID
    mock_client.resolve_primary_connection_id.assert_awaited_once()
    mock_client.aclose.assert_awaited_once()


@pytest.mark.asyncio
async def test_sync_coordinator_resolve_degrades_to_none_on_error() -> None:
    """SyncCoordinator 选主失败降级 None（保持原语义，不抛）。"""
    coordinator = SyncCoordinator(coalesce_window_sec=0.0)
    mock_client = _mock_client(None)  # 客户端内部已降级 None
    with patch("src.adapters.iqd_config_client.IqdConfigClient", return_value=mock_client):
        cid = await coordinator._resolve_primary_connection_id()
    assert cid is None
    mock_client.resolve_primary_connection_id.assert_awaited_once()


# ============================================================ IqdAskService 委托


@pytest.mark.asyncio
async def test_service_resolve_delegates_to_client() -> None:
    """service 选主委托传入 client ⇒ 单一真值源。"""
    service = IqdAskService()
    client = AsyncMock()
    client.resolve_primary_connection_id = AsyncMock(return_value=EXPECTED_PRIMARY_ID)

    cid = await service._resolve_primary_connection_id(client)

    assert cid == EXPECTED_PRIMARY_ID
    client.resolve_primary_connection_id.assert_awaited_once()


@pytest.mark.asyncio
async def test_service_resolve_returns_none_when_client_none() -> None:
    """client 无主连接（返回 None）⇒ service 透传 None。"""
    service = IqdAskService()
    client = AsyncMock()
    client.resolve_primary_connection_id = AsyncMock(return_value=None)

    assert await service._resolve_primary_connection_id(client) is None
