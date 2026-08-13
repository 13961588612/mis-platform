"""本地对话命中 mis-rag 时应走 KB 检索管线，而不是裸 OpenHarness 对话。"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.agent.mis_rag.qa_pipeline import format_kb_answer_for_chat
from src.api.deps import get_agent_manager_dep, get_optional_current_user, get_session_manager_dep
from src.api.routes.session import router
from src.models.retrieve import QaAnswer, QaCitation


def test_format_kb_answer_for_chat_appends_sources() -> None:
    """引用列表附在正文后，运营台能直接读。"""
    answer = QaAnswer(
        answer="根据手册，入职当天领取工牌。",
        citations=[
            QaCitation(source="员工手册", score=0.91, document_id=12),
            QaCitation(source="", score=None, document_id=13),
        ],
    )
    text = format_kb_answer_for_chat(answer)
    assert "入职当天领取工牌" in text
    assert "1. 员工手册（相关度 0.91）" in text
    assert "2. 文档 13" in text


def test_format_kb_answer_for_chat_without_citations() -> None:
    """无引用时只回正文。"""
    assert format_kb_answer_for_chat(QaAnswer(answer="未命中")) == "未命中"


@pytest.fixture
def kb_chat_client() -> tuple[TestClient, MagicMock, MagicMock]:
    """挂载 session 路由，注入会话 / Agent 替身。"""
    session = SimpleNamespace(session_id="web-rag-1", agent_id="mis-rag")
    session_manager = MagicMock()
    session_manager.get_session = AsyncMock(return_value=session)
    session_manager.add_message = AsyncMock(
        side_effect=lambda **kwargs: SimpleNamespace(id="m-user", **kwargs)
    )

    instance = MagicMock()

    async def _empty_events(**kwargs: Any):
        if False:
            yield None

    instance.process_message = _empty_events
    agent_manager = MagicMock()
    agent_manager.ensure_agent_ready = AsyncMock(return_value=instance)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_session_manager_dep] = lambda: session_manager
    app.dependency_overrides[get_agent_manager_dep] = lambda: agent_manager
    app.dependency_overrides[get_optional_current_user] = lambda: {"user_id": "1001"}
    return TestClient(app), session_manager, instance


def test_send_message_mis_rag_uses_kb_pipeline(
    kb_chat_client: tuple[TestClient, MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """agent_id=mis-rag 时必须走 KbQaPipeline，而不是直接 process_message 用户原文。"""
    client, session_manager, instance = kb_chat_client

    class _FakePipeline:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.closed = False

        async def run(self, req: Any, ctx: Any, generate: Any, *, structured: bool = True) -> QaAnswer:
            assert structured is False
            assert req.question == "年假怎么休"
            await generate("## 检索到的知识库片段\n...")
            return QaAnswer(
                answer="年假需提前申请。",
                citations=[QaCitation(source="休假制度", score=0.88)],
            )

        async def aclose(self) -> None:
            self.closed = True

    monkeypatch.setattr("src.agent.mis_rag.KbQaPipeline", _FakePipeline)
    monkeypatch.setattr(
        "src.agent.mis_rag.is_kb_qa_request",
        lambda agent_id, metadata: agent_id == "mis-rag",
    )
    monkeypatch.setattr(
        "src.config.get_settings",
        lambda: SimpleNamespace(MIS_KB_RETRIEVE_TOP_K=5, MIS_KB_QA_ENABLED=True),
    )

    resp = client.post("/api/v1/sessions/web-rag-1/messages", json={"content": "年假怎么休"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert "年假需提前申请" in body["data"]["response"]
    assert "休假制度" in body["data"]["response"]


def test_send_message_other_agent_skips_kb_pipeline(
    kb_chat_client: tuple[TestClient, MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非 mis-rag 仍走通用对话，不创建 KB 管线。"""
    client, session_manager, instance = kb_chat_client
    session_manager.get_session = AsyncMock(
        return_value=SimpleNamespace(session_id="web-1", agent_id="crm-assistant")
    )

    async def _events(**kwargs: Any):
        from src.runtime.events import AgentEvent, AgentEventType

        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content="CRM 回复")

    instance.process_message = _events
    created: list[str] = []

    class _BoomPipeline:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            created.append("created")

    monkeypatch.setattr("src.agent.mis_rag.KbQaPipeline", _BoomPipeline)
    monkeypatch.setattr("src.agent.mis_rag.is_kb_qa_request", lambda agent_id, metadata: False)

    resp = client.post("/api/v1/sessions/web-1/messages", json={"content": "查会员"})

    assert resp.status_code == 200
    assert resp.json()["data"]["response"] == "CRM 回复"
    assert created == []
