"""POST /api/v1/skills/builder/chat 路由测试（C 功能「AI 对话创建」）。

覆盖范围（对应设计 decision D + 共享知识 6「路由顺序」+ 决策 B「不落库」）：
- 200 + 信封 {code,data,message}，data 形状 {reply,status,converged}；
- **路由顺序**：/builder/chat 必须在 GET /{skill_id} 之前声明，不被路径参数吞掉；
- LLM 抛异常时归一为信封 code=50000（不裸崩 500）；
- 请求体默认值容错（messages 缺省、converged 缺省）；
- ephemeral：整条链路不碰 agent_session / DB。
"""

from __future__ import annotations

import textwrap
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import skill as skill_route
from src.api.routes.skill import router, set_registry
from src.llm.models import LLMRequest, LLMResponse

RAW_SKILL_MD = textwrap.dedent(
    """
    ---
    name: 会员积分查询
    description: 当用户想查询会员积分余额、等级或明细时调用。
    ---

    ## 目标
    按会员 ID 查积分。
    """
).strip()

FENCED_SKILL_MD = f"```SKILL.md\n{RAW_SKILL_MD}\n```"


class FakeGateway:
    """假 LLM 网关：按需回文本或抛错。"""

    def __init__(self, content: str = FENCED_SKILL_MD, error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.calls: list[LLMRequest] = []

    async def chat(self, request: LLMRequest) -> LLMResponse:
        self.calls.append(request)
        if self.error is not None:
            raise self.error
        return LLMResponse(content=self.content)


@pytest.fixture
def client() -> TestClient:
    """按 src/main.py 的真实装配挂载：skill_router → prefix=/api/v1/skills。"""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/skills")
    registry = MagicMock()
    registry.register = AsyncMock()
    registry.get = MagicMock(return_value=None)
    set_registry(registry)
    return TestClient(app)


@pytest.fixture
def fake_gateway(monkeypatch: pytest.MonkeyPatch) -> FakeGateway:
    """把路由里的 get_llm_gateway() 换成假网关（不出网）。"""
    gateway = FakeGateway()
    monkeypatch.setattr(skill_route, "get_llm_gateway", lambda: gateway)
    return gateway


@pytest.fixture
def no_persistence(monkeypatch: pytest.MonkeyPatch) -> None:
    """会话/DB 入口一碰就炸，用于证明 ephemeral 约束（决策 B）。"""
    import src.agent.session_store as session_store
    import src.db.session as db_session

    def _boom(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("ephemeral 约束被破坏：builder chat 不得触碰 agent_session / DB")

    monkeypatch.setattr(db_session, "db_session_context", _boom, raising=False)
    monkeypatch.setattr(session_store, "get_session_pg_store", _boom, raising=False)


# ---------------------------------------------------------------------------
# 正常路径
# ---------------------------------------------------------------------------


def test_builder_chat_returns_200_with_envelope_and_fields(
    client: TestClient, fake_gateway: FakeGateway
) -> None:
    """200 + 统一信封；data 含 reply / status / converged 三字段。"""
    resp = client.post(
        "/api/v1/skills/builder/chat",
        json={
            "messages": [{"role": "user", "content": "我要一个查会员积分的技能"}],
            "user_input": "对接 CRM",
            "converged": False,
        },
    )

    assert resp.status_code == 200, resp.text
    envelope = resp.json()
    assert envelope["code"] == 0
    assert envelope["message"] == "OK"
    assert "traceId" in envelope

    data = envelope["data"]
    assert set(data.keys()) == {"reply", "status", "converged"}
    assert "```SKILL.md" in data["reply"]
    assert data["status"] in ("generating", "generated")
    assert isinstance(data["converged"], bool)


def test_builder_chat_marks_generated_for_complete_skill_md(
    client: TestClient, fake_gateway: FakeGateway
) -> None:
    """AI 产出完整 SKILL.md（提示词强制的围栏形态）→ status=generated、converged=true。

    这是 P1-4「已可回填」提示的触发条件，属主路径。
    """
    resp = client.post(
        "/api/v1/skills/builder/chat",
        json={"messages": [], "user_input": "定稿"},
    )

    data = resp.json()["data"]
    assert data["converged"] is True, "围栏包裹的完整 SKILL.md 应判定收敛"
    assert data["status"] == "generated"


def test_builder_chat_accepts_minimal_body_defaults(
    client: TestClient, fake_gateway: FakeGateway
) -> None:
    """messages / converged 缺省可用（pydantic 默认值），仅传 user_input 也能跑通。"""
    resp = client.post("/api/v1/skills/builder/chat", json={"user_input": "建个技能"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["code"] == 0
    # 首条恒为 system 提示词，末条为 user_input
    msgs = fake_gateway.calls[0].messages
    assert msgs[0].role.value == "system"
    assert msgs[-1].content == "建个技能"


def test_builder_chat_accepts_empty_body(client: TestClient, fake_gateway: FakeGateway) -> None:
    """全字段缺省（空 body）不应 422：三个字段都有默认值。"""
    resp = client.post("/api/v1/skills/builder/chat", json={})

    assert resp.status_code == 200, resp.text
    assert resp.json()["code"] == 0


def test_builder_chat_does_not_touch_session_or_db(
    client: TestClient, fake_gateway: FakeGateway, no_persistence: None
) -> None:
    """**ephemeral 硬约束**：整条路由链路不碰 agent_session / agent_session_message / PG。"""
    resp = client.post(
        "/api/v1/skills/builder/chat",
        json={"messages": [{"role": "user", "content": "轮次1"}], "user_input": "轮次2"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["code"] == 0
    assert len(fake_gateway.calls) == 1


def test_builder_chat_is_stateless_across_calls(
    client: TestClient, fake_gateway: FakeGateway
) -> None:
    """无状态：两次调用互不影响，上下文完全由请求体决定。"""
    client.post("/api/v1/skills/builder/chat", json={"user_input": "第一次"})
    client.post("/api/v1/skills/builder/chat", json={"user_input": "第二次"})

    first, second = fake_gateway.calls
    # 第二次不应带上第一次的用户输入（后端不维护历史）
    assert "第一次" in [m.content for m in first.messages]
    assert "第一次" not in [m.content for m in second.messages]


# ---------------------------------------------------------------------------
# 路由顺序（共享知识 6：必须在 GET /{skill_id} 之前声明）
# ---------------------------------------------------------------------------


def test_builder_chat_route_declared_before_skill_id_path_param() -> None:
    """POST /builder/chat 的声明位置必须早于 GET /{skill_id}，否则被路径参数吞掉。"""
    paths = [getattr(r, "path", "") for r in router.routes]
    assert "/builder/chat" in paths, "builder/chat 路由未注册"
    assert "/{skill_id}" in paths
    assert paths.index("/builder/chat") < paths.index(
        "/{skill_id}"
    ), "builder/chat 必须声明在 /{skill_id} 之前（FastAPI 按声明顺序匹配）"


def test_builder_chat_not_shadowed_by_get_skill(
    client: TestClient, fake_gateway: FakeGateway
) -> None:
    """行为验证：POST /builder/chat 走 builder 逻辑，不会被 /{skill_id} 截获成 404。"""
    resp = client.post("/api/v1/skills/builder/chat", json={"user_input": "x"})

    assert resp.status_code == 200, resp.text
    # 若被 /{skill_id} 吞掉，registry.get 返回 None 会抛 404
    assert resp.json()["code"] == 0
    assert "reply" in resp.json()["data"]


# ---------------------------------------------------------------------------
# 异常兜底
# ---------------------------------------------------------------------------


def test_builder_chat_llm_failure_returns_envelope_not_500(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """LLM/下游异常归一为信封 code=50000，HTTP 仍为 200（前端 unwrap 抛错展示）。"""
    gateway = FakeGateway(error=RuntimeError("upstream 503"))
    monkeypatch.setattr(skill_route, "get_llm_gateway", lambda: gateway)

    resp = client.post("/api/v1/skills/builder/chat", json={"user_input": "x"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["code"] == 50000
    assert body["data"] is None
    assert "AI 生成失败" in body["message"]
