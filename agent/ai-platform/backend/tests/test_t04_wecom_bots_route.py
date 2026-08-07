"""T04 任务9：企微多 Bot 路由（#48–#54 + Gateway runtime 端点）。

通过 FastAPI TestClient 直接驱动 ``channels_router``（不启动完整 lifespan），
mock ``WecomBotStore``，**禁止读写真实配置文件 / 连接真实服务**。

覆盖端点（实际挂载前缀 ``/api/v1``，对应 BFF ``/agent-ops/channels/wecom/**``）：

* ``GET    /channels/wecom/bots``                 — #48 列表（扁平数组，secret 脱敏）
* ``POST   /channels/wecom/bots``                 — #49 创建（health=unknown）
* ``PUT    /channels/wecom/bots/{bot_id}``        — #50 更新
* ``DELETE /channels/wecom/bots/{bot_id}``        — #51 删除（幂等）
* ``POST   /channels/wecom/bots/{bot_id}/enable`` — #52 启用
* ``POST   /channels/wecom/bots/{bot_id}/disable``— #53 停用
* ``GET    /channels/wecom/bots/health``          — #54 健康状态（降级不 500）
* ``GET    /channels/wecom/bots/runtime``         — Gateway 运行时清单（内部令牌闸门）

wire 契约（断言铁律）：``WecomBot`` 一律 snake_case——
``bot_id / name / enabled / ws_url / secret_masked / bound_agent_id? / health``，
运营端点响应**绝不出现明文 ``secret`` 键**。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.api.routes.channels as channels_mod
from src.api.deps import get_current_user
from src.api.routes.channels import get_wecom_bot_store_dep, router
from src.channels.models import WecomBotRecord
from src.channels.wecom_bot_store import WecomBotConflictError, WecomBotNotFoundError

#: 前端 ``WecomBot`` 契约必含字段（bound_agent_id 未绑定时不下发，另行断言）。
WECOM_WIRE_REQUIRED_KEYS: frozenset[str] = frozenset(
    {"bot_id", "name", "enabled", "ws_url", "secret_masked", "health"}
)

INTERNAL_TOKEN: str = "tok-abc-123"


def _record(
    bot_id: str = "wb-1",
    name: str = "运维助手",
    enabled: bool = True,
    secret: str = "plain-secret-1",
    bound_agent_id: str = "a1",
    ws_url: str = "wss://qyapi.weixin.qq.com/ws/1",
) -> WecomBotRecord:
    """构造一条落盘态记录（含明文 secret，仅供 store mock 内部使用）。"""
    return WecomBotRecord(
        bot_id=bot_id,
        name=name,
        enabled=enabled,
        ws_url=ws_url,
        secret=secret,
        bound_agent_id=bound_agent_id,
    )


@pytest.fixture
def wecom_client(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, MagicMock]:
    """挂载 channels_router 的最小 App + 替身 WecomBotStore。

    Returns:
        ``(client, store)``，store 为 MagicMock，异步方法按需设置。
    """
    store = MagicMock()
    store.list_wire = AsyncMock()
    store.create = AsyncMock()
    store.update = AsyncMock()
    store.delete = AsyncMock()
    store.set_enabled = AsyncMock()
    store.fetch_health_map = AsyncMock()
    # 真实 Store 的 list_records 是**同步**方法（路由直接调用，不 await）
    store.list_records = MagicMock(return_value=[])
    store.get_wire = AsyncMock()

    # 默认给 runtime 端点一个已配置的内部令牌（个别用例单独覆写为未配置）
    monkeypatch.setattr(
        channels_mod,
        "get_settings",
        lambda: SimpleNamespace(GATEWAY_INTERNAL_TOKEN=INTERNAL_TOKEN),
    )

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_wecom_bot_store_dep] = lambda: store
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app), store


def _assert_no_plaintext_secret(item: dict[str, Any]) -> None:
    """运营端点的 wire 项绝不允许出现明文 ``secret`` 键。"""
    assert "secret" not in item
    assert "secret_masked" in item


# ===========================================================================
# #48 GET /channels/wecom/bots —— 列表（扁平数组 + secret 脱敏）
# ===========================================================================


def test_list_wecom_bots_flat_array_and_masked(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.list_wire.return_value = [
        _record("wb-1", secret="s1").to_wire(health="connected"),
        _record("wb-2", secret="s2", bound_agent_id="").to_wire(health="disconnected"),
    ]

    resp = client.get("/api/v1/channels/wecom/bots")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert isinstance(data, list) and len(data) == 2
    for item in data:
        assert WECOM_WIRE_REQUIRED_KEYS.issubset(set(item.keys()))
        _assert_no_plaintext_secret(item)
        assert item["secret_masked"] == "********"
    # 未绑定的 Bot 不下发 bound_agent_id 键
    assert "bound_agent_id" in data[0]
    assert "bound_agent_id" not in data[1]
    store.list_wire.assert_awaited_once_with(enabled_only=False)


def test_list_wecom_bots_enabled_filter(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    all_bots = [
        _record("wb-1", enabled=True).to_wire(health="connected"),
        _record("wb-2", enabled=False).to_wire(health="disconnected"),
    ]

    # Store 侧按 enabled_only 过滤（路由把 ?enabled=true 转成 enabled_only=True 透传）
    def _list_wire(enabled_only: bool = False) -> list[dict[str, Any]]:
        return [b for b in all_bots if b["enabled"]] if enabled_only else all_bots

    store.list_wire.side_effect = _list_wire

    resp = client.get("/api/v1/channels/wecom/bots?enabled=true")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert [b["bot_id"] for b in data] == ["wb-1"]
    store.list_wire.assert_awaited_once_with(enabled_only=True)


def test_list_wecom_bots_disabled_filter(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.list_wire.return_value = [
        _record("wb-1", enabled=True).to_wire(health="connected"),
        _record("wb-2", enabled=False).to_wire(health="disconnected"),
    ]

    resp = client.get("/api/v1/channels/wecom/bots?enabled=false")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert [b["bot_id"] for b in data] == ["wb-2"]


def test_list_wecom_bots_store_error_maps(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.list_wire.side_effect = RuntimeError("boom")

    resp = client.get("/api/v1/channels/wecom/bots")

    assert resp.status_code == 500
    assert resp.json()["code"] == 9000


# ===========================================================================
# #49 POST /channels/wecom/bots —— 创建（health 恒为 unknown）
# ===========================================================================


def test_create_wecom_bot_returns_wire_unknown_health(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.create.return_value = _record("wb-new", secret="s3")

    resp = client.post(
        "/api/v1/channels/wecom/bots",
        json={"name": "新 Bot", "ws_url": "wss://qyapi.weixin.qq.com/ws/2", "secret": "s3"},
    )

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["bot_id"] == "wb-new"
    assert data["health"] == "unknown"
    assert data["enabled"] is True
    _assert_no_plaintext_secret(data)
    store.create.assert_awaited_once()


def test_create_wecom_bot_conflict_409(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.create.side_effect = WecomBotConflictError("name dup")

    resp = client.post(
        "/api/v1/channels/wecom/bots",
        json={"name": "重复", "ws_url": "wss://qyapi.weixin.qq.com/ws/2"},
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == 5002


# ===========================================================================
# #50 PUT /channels/wecom/bots/{bot_id} —— 更新
# ===========================================================================


def test_update_wecom_bot_returns_wire_with_health(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.update.return_value = _record("wb-1", name="新名字", secret="s1")
    store.fetch_health_map.return_value = {"wb-1": "connected", "wb-2": "disconnected"}

    resp = client.put(
        "/api/v1/channels/wecom/bots/wb-1",
        json={"name": "新名字"},
    )

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["bot_id"] == "wb-1"
    assert data["name"] == "新名字"
    assert data["health"] == "connected"
    _assert_no_plaintext_secret(data)
    store.update.assert_awaited_once()
    store.fetch_health_map.assert_awaited_once()


def test_update_wecom_bot_not_found_404(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.update.side_effect = WecomBotNotFoundError("wb-404")

    resp = client.put("/api/v1/channels/wecom/bots/wb-404", json={"name": "x"})

    assert resp.status_code == 404
    assert resp.json()["code"] == 5001


# ===========================================================================
# #51 DELETE /channels/wecom/bots/{bot_id} —— 删除（幂等）
# ===========================================================================


def test_delete_wecom_bot_ok(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.delete.return_value = True

    resp = client.delete("/api/v1/channels/wecom/bots/wb-1")

    assert resp.status_code == 200
    assert resp.json()["data"] == {"bot_id": "wb-1", "deleted": True}


def test_delete_wecom_bot_idempotent_missing(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    """删除不存在的 Bot 返回成功（deleted=False，幂等）。"""
    client, store = wecom_client
    store.delete.return_value = False

    resp = client.delete("/api/v1/channels/wecom/bots/wb-nope")

    assert resp.status_code == 200
    assert resp.json()["data"] == {"bot_id": "wb-nope", "deleted": False}
    assert "idempotent" in resp.json()["message"]


# ===========================================================================
# #52 / #53 POST .../{bot_id}/enable | /disable —— 启停
# ===========================================================================


def test_enable_wecom_bot_fetches_health(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.set_enabled.return_value = _record("wb-1", enabled=True)
    store.fetch_health_map.return_value = {"wb-1": "connected"}

    resp = client.post("/api/v1/channels/wecom/bots/wb-1/enable")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["enabled"] is True
    assert data["health"] == "connected"
    _assert_no_plaintext_secret(data)
    store.set_enabled.assert_awaited_once_with("wb-1", True)


def test_disable_wecom_bot_health_disconnected_no_gateway_call(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.set_enabled.return_value = _record("wb-1", enabled=False)

    resp = client.post("/api/v1/channels/wecom/bots/wb-1/disable")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["enabled"] is False
    assert data["health"] == "disconnected"
    _assert_no_plaintext_secret(data)
    store.set_enabled.assert_awaited_once_with("wb-1", False)
    # 停用后不需要询问 Gateway
    store.fetch_health_map.assert_not_awaited()


def test_set_enabled_not_found_404(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.set_enabled.side_effect = WecomBotNotFoundError("wb-404")

    resp = client.post("/api/v1/channels/wecom/bots/wb-404/enable")

    assert resp.status_code == 404
    assert resp.json()["code"] == 5001


# ===========================================================================
# #54 GET /channels/wecom/bots/health —— 健康状态（降级不 500）
# ===========================================================================


def test_wecom_bots_health_ok(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.fetch_health_map.return_value = {
        "wb-1": "connected",
        "wb-2": "disconnected",
        "wb-3": "unknown",
    }

    resp = client.get("/api/v1/channels/wecom/bots/health")

    assert resp.status_code == 200
    assert resp.json()["data"] == {
        "wb-1": "connected",
        "wb-2": "disconnected",
        "wb-3": "unknown",
    }


def test_wecom_bots_health_degraded_on_error(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    """Gateway 不可达 / store 异常时降级为空 map，绝不 500。"""
    client, store = wecom_client
    store.fetch_health_map.side_effect = RuntimeError("gateway down")

    resp = client.get("/api/v1/channels/wecom/bots/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["data"] == {}
    assert body["message"] == "health unavailable"


# ===========================================================================
# GET /channels/wecom/bots/{bot_id} —— 单条查询（附加端点）
# ===========================================================================


def test_get_wecom_bot_single_masked(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.get_wire.return_value = _record("wb-1", secret="s1").to_wire(health="connected")

    resp = client.get("/api/v1/channels/wecom/bots/wb-1")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["bot_id"] == "wb-1"
    _assert_no_plaintext_secret(data)


def test_get_wecom_bot_single_not_found_404(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.get_wire.side_effect = WecomBotNotFoundError("wb-404")

    resp = client.get("/api/v1/channels/wecom/bots/wb-404")

    assert resp.status_code == 404
    assert resp.json()["code"] == 5001


# ===========================================================================
# GET /channels/wecom/bots/runtime —— Gateway 专用（fail-closed 闸门）
# ===========================================================================


def test_runtime_endpoint_fail_closed_when_token_unconfigured(
    wecom_client: tuple[TestClient, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    """未配置 GATEWAY_INTERNAL_TOKEN ⇒ 503，绝不返回任何 Bot 数据。"""
    client, store = wecom_client
    monkeypatch.setattr(
        channels_mod, "get_settings", lambda: SimpleNamespace(GATEWAY_INTERNAL_TOKEN="")
    )

    resp = client.get("/api/v1/channels/wecom/bots/runtime")

    assert resp.status_code == 503
    assert resp.json()["code"] == 5003
    store.list_records.assert_not_called()


def test_runtime_endpoint_rejects_missing_token(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client

    resp = client.get("/api/v1/channels/wecom/bots/runtime")

    assert resp.status_code == 403
    assert resp.json()["code"] == 1003
    store.list_records.assert_not_called()


def test_runtime_endpoint_rejects_bad_token(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client

    resp = client.get(
        "/api/v1/channels/wecom/bots/runtime",
        headers={"X-Internal-Token": "wrong-token"},
    )

    assert resp.status_code == 403
    assert resp.json()["code"] == 1003
    store.list_records.assert_not_called()


def test_runtime_endpoint_valid_token_returns_records(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    """合法令牌：返回含明文 secret 的运行时清单（Gateway 启动拉取契约）。"""
    client, store = wecom_client
    store.list_records.return_value = [
        _record("wb-1", secret="s1", bound_agent_id="a1"),
        _record("wb-2", secret="s2", enabled=False, bound_agent_id=""),
    ]

    resp = client.get(
        "/api/v1/channels/wecom/bots/runtime?enabled=true",
        headers={"X-Internal-Token": INTERNAL_TOKEN},
    )

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert isinstance(data, list) and len(data) == 2
    item = data[0]
    # 运行时契约：bot_id / name / enabled / ws_url / secret / bound_agent_id
    assert item["bot_id"] == "wb-1"
    assert item["secret"] == "s1"  # Gateway 启动需要明文
    assert item["bound_agent_id"] == "a1"
    store.list_records.assert_called_once_with(enabled_only=True)


def test_runtime_endpoint_enabled_false_passes_through(
    wecom_client: tuple[TestClient, MagicMock],
) -> None:
    client, store = wecom_client
    store.list_records.return_value = [_record("wb-1", secret="s1")]

    resp = client.get(
        "/api/v1/channels/wecom/bots/runtime?enabled=false",
        headers={"X-Internal-Token": INTERNAL_TOKEN},
    )

    assert resp.status_code == 200
    store.list_records.assert_called_once_with(enabled_only=False)
