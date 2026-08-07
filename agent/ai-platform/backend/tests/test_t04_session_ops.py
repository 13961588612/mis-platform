"""T04 任务8：会话运营端点（#27–#31）。

通过 FastAPI TestClient 直接驱动 ``session_router``（不启动完整 lifespan），
并辅以 ``SessionManager`` 单测覆盖 #28/#29 的「PG 优先、Redis 兜底」两条分支。
全程 mock ``SessionManager`` / ``SessionPgStore`` / Redis，**禁止连库**。

覆盖端点（实际挂载前缀 ``/api/v1``）：

* ``GET    /api/v1/sessions``              — #27 列表：分页 + agent/channel/keyword 过滤
* ``GET    /api/v1/sessions/{id}``         — #28 详情：PG 命中 + Redis 兜底
* ``GET    /api/v1/sessions/{id}/messages``— #29 消息：扁平数组，PG + 兜底
* ``DELETE /api/v1/sessions/{id}``         — #30 软删除 + Redis 清理，幂等
* ``POST   /api/v1/sessions/batch-delete`` — #31 批量删除，幂等

wire 契约（断言铁律，防回归核心）：

* ``Session``:      session_id / agent_id / agent_name? / channel / user_id? /
                    user_name? / title? / status / runtime_type? / message_count /
                    created_at / updated_at
* ``SessionMessage``: id / session_id / role / content / timestamp / metadata
                    （**timestamp** 不是 created_at；**metadata** 不是 meta）
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.agent.session_store import MessagePage, SessionPage
from src.api.deps import get_current_user, get_session_manager_dep
from src.api.routes.session import router
from src.utils.exceptions import SessionNotFoundError

#: 前端 ``Session`` 契约字段集（路由层返回的每一项都必须覆盖这些键）。
SESSION_WIRE_KEYS: frozenset[str] = frozenset(
    {
        "session_id",
        "agent_id",
        "agent_name",
        "channel",
        "user_id",
        "user_name",
        "title",
        "status",
        "runtime_type",
        "message_count",
        "created_at",
        "updated_at",
    }
)

#: 前端 ``SessionMessage`` 契约字段集（注意是 timestamp / metadata）。
MESSAGE_WIRE_KEYS: frozenset[str] = frozenset(
    {"id", "session_id", "role", "content", "timestamp", "metadata"}
)


def _session_wire(
    session_id: str = "web-1",
    agent_id: str = "a1",
    channel: str = "web",
    user_id: str | None = "u1",
) -> dict[str, Any]:
    """构造一条符合 ``Session`` 契约的 wire 记录。"""
    return {
        "session_id": session_id,
        "agent_id": agent_id,
        "agent_name": "Agent A",
        "channel": channel,
        "user_id": user_id,
        "user_name": "User 1",
        "title": "首条消息",
        "status": "active",
        "runtime_type": "openharness",
        "message_count": 3,
        "created_at": "2025-07-01T00:00:00+00:00",
        "updated_at": "2025-07-01T00:05:00+00:00",
    }


def _message_wire(
    msg_id: str = "m1",
    session_id: str = "web-1",
    role: str = "user",
    content: str = "hello",
) -> dict[str, Any]:
    """构造一条符合 ``SessionMessage`` 契约的 wire 记录。"""
    return {
        "id": msg_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "timestamp": "2025-07-01T00:00:01+00:00",
        "metadata": {"k": "v"},
    }


@pytest.fixture
def session_client(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, MagicMock]:
    """挂载 session_router 的最小 App + 替身 SessionManager。

    Returns:
        ``(client, manager)``，manager 为 MagicMock，异步方法按需设置。
    """
    manager = MagicMock()
    manager.list_sessions = AsyncMock()
    manager.get_session_record = AsyncMock()
    manager.list_session_messages = AsyncMock()
    manager.delete_sessions = AsyncMock()

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_session_manager_dep] = lambda: manager
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app), manager


def _make_manager(monkeypatch: pytest.MonkeyPatch, pg_store: Any, redis: Any):
    """构造一个注入替身 PG Store / Redis 的 ``SessionManager``（不连任何真实服务）。"""
    monkeypatch.setattr(
        "src.agent.session.get_settings",
        lambda: SimpleNamespace(
            redis_url="redis://localhost:6379/0",
            REDIS_MAX_CONNECTIONS=5,
            REDIS_KEY_PREFIX="test:",
        ),
    )
    from src.agent.session import SessionManager

    manager = SessionManager(pg_store=pg_store)
    manager._redis = redis
    return manager


# ===========================================================================
# #27 GET /api/v1/sessions —— 列表（分页 + 过滤 + wire 形状）
# ===========================================================================


def test_list_sessions_wire_shape_and_pagination(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.list_sessions.return_value = SessionPage(
        items=[_session_wire("web-1"), _session_wire("web-2")],
        total=2,
        page=1,
        page_size=20,
    )

    resp = client.get("/api/v1/sessions?page=1&page_size=20")

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    data = body["data"]
    # AgentPage<Session> 契约：items + total + page + page_size
    assert set(data.keys()) == {"items", "total", "page", "page_size"}
    assert data["total"] == 2
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert isinstance(data["items"], list) and len(data["items"]) == 2
    for item in data["items"]:
        assert set(item.keys()) == SESSION_WIRE_KEYS

    # 分页参数透传到 SessionListQuery
    manager.list_sessions.assert_awaited_once()
    query = manager.list_sessions.await_args.args[0]
    assert query.page == 1
    assert query.page_size == 20


def test_list_sessions_filters_flow_into_query(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.list_sessions.return_value = SessionPage(items=[], total=0, page=2, page_size=50)

    resp = client.get(
        "/api/v1/sessions?page=2&page_size=50&agent_id=a1&channel=wecom&keyword=报销&user_id=u9"
    )

    assert resp.status_code == 200
    query = manager.list_sessions.await_args.args[0]
    assert query.page == 2
    assert query.page_size == 50
    assert query.agent_id == "a1"
    assert query.channel == "wecom"
    assert query.keyword == "报销"
    assert query.user_id == "u9"


def test_list_sessions_rejects_unsupported_channel(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client

    resp = client.get("/api/v1/sessions?channel=bogus")

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.list_sessions.assert_not_awaited()


def test_list_sessions_treats_channel_all_as_no_filter(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.list_sessions.return_value = SessionPage(items=[], total=0, page=1, page_size=20)

    resp = client.get("/api/v1/sessions?channel=all")

    assert resp.status_code == 200
    query = manager.list_sessions.await_args.args[0]
    assert query.channel is None


def test_list_sessions_rejects_bad_time_range(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client

    resp = client.get("/api/v1/sessions?from=not-a-date")

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.list_sessions.assert_not_awaited()


def test_list_sessions_store_error_returns_500(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.list_sessions.side_effect = RuntimeError("pg down")

    resp = client.get("/api/v1/sessions")

    assert resp.status_code == 500
    assert resp.json()["code"] == 9001


# ===========================================================================
# #28 GET /api/v1/sessions/{id} —— 详情（PG 命中 + Redis 兜底，见 manager 级用例）
# ===========================================================================


def test_get_session_detail_returns_wire_record(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.get_session_record.return_value = _session_wire("web-1")

    resp = client.get("/api/v1/sessions/web-1")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert set(data.keys()) == SESSION_WIRE_KEYS
    assert data["session_id"] == "web-1"
    manager.get_session_record.assert_awaited_once_with("web-1")


def test_get_session_detail_missing_404(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.get_session_record.return_value = None

    resp = client.get("/api/v1/sessions/web-404")

    assert resp.status_code == 404
    assert resp.json()["code"] == 9000
    assert "web-404" in resp.json()["message"]


def test_get_session_detail_store_error_500(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.get_session_record.side_effect = RuntimeError("pg down")

    resp = client.get("/api/v1/sessions/web-1")

    assert resp.status_code == 500
    assert resp.json()["code"] == 9001


async def test_manager_get_session_record_pg_hit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PG 命中：直接返回 PG wire 记录，Redis 不应被访问。"""
    pg = MagicMock()
    pg.get_session = AsyncMock(return_value=_session_wire("web-1"))
    redis = AsyncMock()
    manager = _make_manager(monkeypatch, pg, redis)

    record = await manager.get_session_record("web-1")

    assert record is not None
    assert set(record.keys()) == SESSION_WIRE_KEYS
    pg.get_session.assert_awaited_once_with("web-1")
    redis.get.assert_not_awaited()


async def test_manager_get_session_record_redis_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PG 未命中：回落到 Redis 现场拼装同形 wire 记录。"""
    from src.agent.session import Session

    pg = MagicMock()
    pg.get_session = AsyncMock(return_value=None)
    session = Session(session_id="web-new", agent_id="a1", user_id="u1", channel="web")
    session.add_message("user", "刚建的会话")
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=json.dumps(session.to_dict()))
    manager = _make_manager(monkeypatch, pg, redis)

    record = await manager.get_session_record("web-new")

    assert record is not None
    assert set(record.keys()) == SESSION_WIRE_KEYS
    assert record["session_id"] == "web-new"
    assert record["channel"] == "web"
    assert record["message_count"] == 1
    assert record["title"] == "刚建的会话"


async def test_manager_get_session_record_both_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PG 与 Redis 都没有 → 返回 None（路由层据此 404）。"""
    pg = MagicMock()
    pg.get_session = AsyncMock(return_value=None)
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    manager = _make_manager(monkeypatch, pg, redis)

    record = await manager.get_session_record("web-nope")

    assert record is None


# ===========================================================================
# #29 GET /api/v1/sessions/{id}/messages —— 扁平数组（PG + 兜底）
# ===========================================================================


def test_get_messages_flat_array_contract(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.list_session_messages.return_value = MessagePage(
        items=[_message_wire("m1"), _message_wire("m2", role="assistant", content="hi")],
        total=2,
        page=1,
        page_size=200,
    )

    resp = client.get("/api/v1/sessions/web-1/messages")

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    data = body["data"]
    # ⚠ 扁平数组（不是 {items,...}）—— 前端 listSessionMessages 签名是 SessionMessage[]
    assert isinstance(data, list) and len(data) == 2
    for item in data:
        assert set(item.keys()) == MESSAGE_WIRE_KEYS
    assert data[0]["id"] == "m1"
    assert data[0]["timestamp"] == "2025-07-01T00:00:01+00:00"
    assert data[0]["metadata"] == {"k": "v"}
    manager.list_session_messages.assert_awaited_once()


def test_get_messages_defaults_page_size_to_max(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.list_session_messages.return_value = MessagePage(items=[], total=0)

    resp = client.get("/api/v1/sessions/web-1/messages")

    assert resp.status_code == 200
    _, kwargs = manager.list_session_messages.await_args
    assert kwargs["page"] == 1
    assert kwargs["page_size"] == 200  # MAX_PAGE_SIZE


def test_get_messages_session_missing_404(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.list_session_messages.side_effect = SessionNotFoundError("web-404")

    resp = client.get("/api/v1/sessions/web-404/messages")

    assert resp.status_code == 404
    assert resp.json()["code"] == 2005  # SessionNotFoundError 码（路由透传 exc.code）


async def test_manager_list_messages_pg_hit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PG 有消息：直接返回 PG 分页结果，Redis 不被访问。"""
    pg = MagicMock()
    pg.list_messages = AsyncMock(
        return_value=MessagePage(items=[_message_wire("m1")], total=1, page=1, page_size=10)
    )
    redis = AsyncMock()
    manager = _make_manager(monkeypatch, pg, redis)

    result = await manager.list_session_messages("web-1", page=1, page_size=10)

    assert result.total == 1
    assert set(result.items[0].keys()) == MESSAGE_WIRE_KEYS
    redis.get.assert_not_awaited()


async def test_manager_list_messages_redis_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PG 空 → 回落 Redis 现场分页（保证刚建的会话消息可读）。"""
    from src.agent.session import Session

    pg = MagicMock()
    pg.list_messages = AsyncMock(
        return_value=MessagePage(items=[], total=0, page=1, page_size=10)
    )
    session = Session(session_id="web-new", agent_id="a1", user_id="u1", channel="web")
    session.add_message("user", "hello")
    session.add_message("assistant", "hi")
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=json.dumps(session.to_dict()))
    manager = _make_manager(monkeypatch, pg, redis)

    result = await manager.list_session_messages("web-new", page=1, page_size=10)

    assert result.total == 2
    assert len(result.items) == 2
    for item in result.items:
        assert set(item.keys()) == MESSAGE_WIRE_KEYS
    assert result.items[0]["role"] == "user"
    assert result.items[1]["role"] == "assistant"


async def test_manager_list_messages_both_empty_returns_empty_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pg = MagicMock()
    pg.list_messages = AsyncMock(return_value=MessagePage(items=[], total=0))
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    manager = _make_manager(monkeypatch, pg, redis)

    result = await manager.list_session_messages("web-nope", page=1, page_size=10)

    assert result.total == 0
    assert result.items == []


# ===========================================================================
# #30 DELETE /api/v1/sessions/{id} —— 软删除 + Redis 清理，幂等
# ===========================================================================


def test_delete_session_soft_delete_ok(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.delete_sessions.return_value = 1

    resp = client.delete("/api/v1/sessions/web-1")

    assert resp.status_code == 200
    assert resp.json()["data"] == {"deleted": 1}
    manager.delete_sessions.assert_awaited_once_with(["web-1"])


def test_delete_session_idempotent_missing(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    """删除不存在的会话返回成功（deleted=0）：目标状态「不在了」已达成。"""
    client, manager = session_client
    manager.delete_sessions.return_value = 0

    resp = client.delete("/api/v1/sessions/web-nope")

    assert resp.status_code == 200
    assert resp.json()["data"] == {"deleted": 0}


async def test_manager_delete_sessions_cleans_redis_and_soft_deletes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pg = MagicMock()
    pg.soft_delete = AsyncMock(return_value=2)
    redis = AsyncMock()
    redis.delete = AsyncMock(return_value=1)
    manager = _make_manager(monkeypatch, pg, redis)

    deleted = await manager.delete_sessions(["web-1", "web-2"])

    assert deleted == 2
    # 每个会话：session key + agent_binding key 各删一次
    assert redis.delete.await_count == 4
    pg.soft_delete.assert_awaited_once_with(["web-1", "web-2"])


# ===========================================================================
# #31 POST /api/v1/sessions/batch-delete —— 批量删除，幂等
# ===========================================================================


def test_batch_delete_dedupes_and_reports_counts(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.delete_sessions.return_value = 2

    resp = client.post(
        "/api/v1/sessions/batch-delete",
        json={"ids": ["web-1", "web-2", "web-1", "", "  "]},
    )

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data == {"deleted": 2, "requested": 2}
    manager.delete_sessions.assert_awaited_once_with(["web-1", "web-2"])


def test_batch_delete_empty_ids_400(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client

    resp = client.post("/api/v1/sessions/batch-delete", json={"ids": []})

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.delete_sessions.assert_not_awaited()


def test_batch_delete_too_many_400(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    many_ids = [f"web-{i}" for i in range(201)]

    resp = client.post("/api/v1/sessions/batch-delete", json={"ids": many_ids})

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.delete_sessions.assert_not_awaited()


def test_batch_delete_store_error_500(
    session_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = session_client
    manager.delete_sessions.side_effect = RuntimeError("pg down")

    resp = client.post("/api/v1/sessions/batch-delete", json={"ids": ["web-1"]})

    assert resp.status_code == 500
    assert resp.json()["code"] == 9001
