"""会话反馈运营端点（CF-01 / CF-03 / CF-05）路由契约独立验证。

与 ``test_session_feedback.py``（用户侧点赞/吐槽路由）互补，本文件只验证
**运营侧四个新端点**的路由层契约，全部用 mock 的 ``SessionManager``，
不连数据库：

- ``GET  /sessions/feedback``            → CF-01 列表（默认吐槽优先排序）
- ``GET  /sessions/feedback/stats``      → CF-05 统计
- ``POST /sessions/feedback/{id}/process``   → CF-03 单条标记
- ``POST /sessions/feedback/batch-process`` → CF-03 批量标记

重点验证：
1. 路由顺序 —— ``/feedback`` 字面量必须排在 ``/{session_id}`` 之前，
   否则 FastAPI 会把 ``feedback`` 当成路径参数吃掉（关键回归点，设计 §3.4 红线）；
2. 入参校验 —— rating/status/channel 非法值返回 400；
3. 错误码映射 —— 反馈不存在 → 404(2006)，状态机非法 → 400(4000)；
4. 参数透传 —— 查询条件原样封装成 ``FeedbackQuery`` 交给 manager。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.agent.session import SessionManager
from src.agent.session_store import FeedbackPage, FeedbackQuery
from src.api.deps import get_current_user, get_session_manager_dep
from src.api.routes.session import router
from src.utils.exceptions import FeedbackNotFoundError, FeedbackStatusIllegalError


@pytest.fixture
def ops_client() -> tuple[TestClient, MagicMock]:
    """最小 App：覆盖鉴权与 SessionManager。"""
    manager = MagicMock()
    manager.list_feedback = AsyncMock()
    manager.feedback_stats = AsyncMock()
    manager.process_feedback = AsyncMock()
    manager.batch_process_feedback = AsyncMock()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_session_manager_dep] = lambda: manager
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app), manager


def test_list_feedback_route_not_shadowed_by_session_id(ops_client) -> None:
    """``GET /sessions/feedback`` 必须命中 list_feedback，而非被 /{session_id} 吞掉。"""
    client, manager = ops_client
    manager.list_feedback.return_value = FeedbackPage(
        items=[], total=0, page=1, page_size=20
    )

    resp = client.get(
        "/api/v1/sessions/feedback",
        params={"rating": "down", "status": "pending", "comment_only": "true"},
    )

    assert resp.status_code == 200
    assert resp.json()["code"] == 0
    # 关键：list_feedback 被调用（而非 get_session_record 等），证明没被 /{session_id} 抢路由
    manager.list_feedback.assert_awaited_once()
    query = manager.list_feedback.await_args.args[0]
    assert isinstance(query, FeedbackQuery)
    assert query.rating == "down"
    assert query.status == "pending"
    assert query.comment_only is True


def test_feedback_stats_route_hits_feedback_stats(ops_client) -> None:
    """``GET /sessions/feedback/stats`` 必须命中 feedback_stats。"""
    client, manager = ops_client
    manager.feedback_stats.return_value = {
        "total": 0, "up": 0, "down": 0, "up_rate": 0.0, "down_rate": 0.0,
        "pending": 0, "by_agent": {}, "by_day": {},
    }

    resp = client.get("/api/v1/sessions/feedback/stats")

    assert resp.status_code == 200
    assert resp.json()["code"] == 0
    manager.feedback_stats.assert_awaited_once()


def test_process_feedback_success(ops_client) -> None:
    client, manager = ops_client
    manager.process_feedback.return_value = {
        "id": 42, "status": "handled", "handler_id": "u1",
    }

    resp = client.post(
        "/api/v1/sessions/feedback/42/process",
        json={"status": "handled", "note": "ok"},
    )

    assert resp.status_code == 200
    assert resp.json()["code"] == 0
    manager.process_feedback.assert_awaited_once()
    kwargs = manager.process_feedback.await_args.kwargs
    assert kwargs["feedback_id"] == 42
    assert kwargs["status"] == "handled"
    assert kwargs["note"] == "ok"


def test_process_feedback_not_found_returns_404(ops_client) -> None:
    client, manager = ops_client
    manager.process_feedback.side_effect = FeedbackNotFoundError(42)

    resp = client.post(
        "/api/v1/sessions/feedback/42/process",
        json={"status": "handled"},
    )

    assert resp.status_code == 404
    assert resp.json()["code"] == 2006


def test_process_feedback_illegal_transition_returns_400(ops_client) -> None:
    client, manager = ops_client
    manager.process_feedback.side_effect = FeedbackStatusIllegalError("handled", "ignored")

    resp = client.post(
        "/api/v1/sessions/feedback/42/process",
        json={"status": "ignored"},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000


def test_batch_process_feedback_success(ops_client) -> None:
    client, manager = ops_client
    manager.batch_process_feedback.return_value = 2

    resp = client.post(
        "/api/v1/sessions/feedback/batch-process",
        json={"ids": [1, 2], "status": "handled"},
    )

    assert resp.status_code == 200
    assert resp.json()["data"]["processed"] == 2
    manager.batch_process_feedback.assert_awaited_once()
    kwargs = manager.batch_process_feedback.await_args.kwargs
    assert kwargs["feedback_ids"] == [1, 2]
    assert kwargs["status"] == "handled"


def test_batch_process_feedback_empty_ids_400(ops_client) -> None:
    client, manager = ops_client

    resp = client.post(
        "/api/v1/sessions/feedback/batch-process",
        json={"ids": [], "status": "handled"},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.batch_process_feedback.assert_not_awaited()


def test_list_feedback_unsupported_rating_400(ops_client) -> None:
    client, manager = ops_client

    resp = client.get("/api/v1/sessions/feedback", params={"rating": "sideways"})

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.list_feedback.assert_not_awaited()


def test_list_feedback_unsupported_status_400(ops_client) -> None:
    client, manager = ops_client

    resp = client.get("/api/v1/sessions/feedback", params={"status": "bogus"})

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.list_feedback.assert_not_awaited()


def test_list_feedback_unsupported_channel_400(ops_client) -> None:
    client, manager = ops_client

    resp = client.get("/api/v1/sessions/feedback", params={"channel": "bogus"})

    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    manager.list_feedback.assert_not_awaited()
