"""助手回答点赞 / 吐槽：路由校验 + 消息定位。"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.agent.session import Session
from src.api.deps import get_current_user, get_session_manager_dep
from src.api.routes.session import router
from src.utils.exceptions import SessionNotFoundError


@pytest.fixture
def feedback_client() -> tuple[TestClient, MagicMock]:
    """最小 App：覆盖鉴权与 SessionManager。"""
    manager = MagicMock()
    manager.get_session = AsyncMock()
    manager.set_message_feedback = AsyncMock()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_session_manager_dep] = lambda: manager
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app), manager


def test_find_assistant_message_prefers_id_then_content() -> None:
    session = Session(session_id="web-1", agent_id="a1", user_id="u1", channel="web")
    session.add_message("user", "问积分")
    first = session.add_message("assistant", "会员积分为 100")
    second = session.add_message("assistant", "本月新增 20")

    assert session.find_assistant_message(message_id=first.id) is first
    assert session.find_assistant_message(content="本月新增 20") is second
    assert session.find_assistant_message() is second
    empty = Session(session_id="web-2", agent_id="a1", user_id="u1", channel="web")
    assert empty.find_assistant_message() is None


def test_feedback_up_ok(feedback_client: tuple[TestClient, MagicMock]) -> None:
    client, manager = feedback_client
    manager.get_session.return_value = SimpleNamespace(user_id="u1")
    manager.set_message_feedback.return_value = {
        "message_id": "m1",
        "rating": "up",
        "comment": None,
        "updated_at": "2026-08-13T00:00:00+00:00",
    }

    resp = client.post("/api/v1/sessions/web-1/feedback", json={"rating": "up", "content": "答"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["rating"] == "up"
    manager.set_message_feedback.assert_awaited_once()
    kwargs: dict[str, Any] = manager.set_message_feedback.await_args.kwargs
    assert kwargs["rating"] == "up"


def test_feedback_down_requires_comment(
    feedback_client: tuple[TestClient, MagicMock],
) -> None:
    client, _manager = feedback_client
    resp = client.post("/api/v1/sessions/web-1/feedback", json={"rating": "down"})
    assert resp.status_code == 400
    assert resp.json()["code"] == 4001


def test_feedback_matches_profile_user_id(
    feedback_client: tuple[TestClient, MagicMock],
) -> None:
    """H5 用 JWT userId 建会话，后端 UserContext.user_id 是 employeeId。"""
    client, manager = feedback_client
    app = client.app
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "EMP001",
        "profile": {"user_id": "42"},
    }
    manager.get_session.return_value = SimpleNamespace(user_id="42", mis_user_id=42)
    manager.set_message_feedback.return_value = {
        "message_id": "m1",
        "rating": "up",
        "comment": None,
        "updated_at": "2026-08-13T00:00:00+00:00",
    }

    resp = client.post("/api/v1/sessions/web-1/feedback", json={"rating": "up"})

    assert resp.status_code == 200
    manager.set_message_feedback.assert_awaited_once()


def test_feedback_foreign_session_404(
    feedback_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = feedback_client
    manager.get_session.return_value = SimpleNamespace(user_id="other", mis_user_id=None)

    resp = client.post("/api/v1/sessions/web-1/feedback", json={"rating": "up"})

    assert resp.status_code == 404
    manager.set_message_feedback.assert_not_awaited()


def test_feedback_missing_session_404(
    feedback_client: tuple[TestClient, MagicMock],
) -> None:
    client, manager = feedback_client
    manager.get_session.side_effect = SessionNotFoundError("web-missing")

    resp = client.post("/api/v1/sessions/web-missing/feedback", json={"rating": "up"})

    assert resp.status_code == 404
    assert resp.json()["code"] == 2005
