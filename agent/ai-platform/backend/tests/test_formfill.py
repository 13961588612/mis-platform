"""FormFill（AI Skill 表单填充引擎 × Agent 平台）集成测试。

覆盖：
- reverse_trust：反向信任头构造（X-Platform-Token / X-Mis-Upstream-Jwt 等）
- field_mapping：单据可写字段白名单
- formfill_pending：挂起任务存储（含单例共享）
- a2ui_pending：A2UI 挂起缓冲 push/drain
- formfill_client：Result 信封 unwrap 与错误分支
- formfill_execute：工具 execute（hitl_required / success 自动写回 / error）
- formfill_apply：字段写回（可写白名单拒绝 / 成功）
- resume_formfill：entity_select 入站续跑（confirm / cancel / 未找到）
"""

from __future__ import annotations
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from src.skills.formfill_client import FormFillClient, FormFillClientError
from src.skills.reverse_trust import (
    SESSION_MIS_JWT_KEY,
    SESSION_TENANT_ID_KEY,
    build_reverse_trust_headers,
)
from src.skills.field_mapping import is_writable_field
from src.hitl.formfill_pending import (
    FormFillPendingStore,
    FormFillStatus,
    get_formfill_pending_store,
)
from src.runtime.a2ui_pending import drain_a2ui_renders, push_a2ui_render


# ============================================================================
# 测试替身（fakes）
# ============================================================================


class _FakeSession:
    """轻量会话替身，复刻 Session 的 state / pending_formfill / 身份字段。"""

    def __init__(
        self,
        state: dict | None = None,
        user_id: str = "u1",
        channel: str = "h5",
        agent_id: str = "agent-1",
    ) -> None:
        self.state = state if state is not None else {}
        self.user_id = user_id
        self.channel = channel
        self.agent_id = agent_id

    def set_pending_formfill(self, resume_token: str, ttl_seconds: int = 1800) -> None:
        self.state["pending_formfill"] = resume_token

    def get_pending_formfill(self) -> str | None:
        return self.state.get("pending_formfill")

    def clear_pending_formfill(self) -> None:
        self.state.pop("pending_formfill", None)


class _FakeSessionManager:
    """会话管理器替身；get_session 抛异常 → 工具侧 fallback 为 None。"""

    async def get_session(self, session_id: str) -> _FakeSession:
        raise RuntimeError("session not found in test fake")

    async def save_session(self, session: _FakeSession) -> None:
        return None


class _FakeFormFillClient:
    """FormFillClient 替身；execute_skill / apply_skill 返回预设响应。"""

    def __init__(self, response: dict) -> None:
        self._response = response
        self.execute_calls: list[dict] = []
        self.apply_calls: list[dict] = []

    async def execute_skill(
        self,
        *,
        skill_id: str,
        session_id: str,
        user_input: str = "",
        context: dict | None = None,
        conversation_id: str | None = None,
        session: object | None = None,
        identity: dict | None = None,
    ) -> dict:
        self.execute_calls.append(
            {
                "skill_id": skill_id,
                "session_id": session_id,
                "user_input": user_input,
                "context": context,
            }
        )
        return self._response

    async def apply_skill(
        self,
        *,
        skill_id: str,
        doc_type: str,
        doc_id: str,
        values: dict,
        session: object | None = None,
        identity: dict | None = None,
    ) -> dict:
        self.apply_calls.append(
            {"skill_id": skill_id, "doc_type": doc_type, "doc_id": doc_id, "values": values}
        )
        return self._response

    async def aclose(self) -> None:
        return None


class _FakeInbound:
    """entity_select 入站消息替身（对齐 InboundStreamMessage 属性访问）。"""

    def __init__(
        self,
        resume_token: str,
        selection_action: str = "confirm",
        selected_candidate: dict | None = None,
        metadata: dict | None = None,
    ) -> None:
        self.resume_token = resume_token
        self.selection_action = selection_action
        self.selected_candidate = selected_candidate or {}
        self.metadata = metadata or {}


# ============================================================================
# reverse_trust
# ============================================================================


@pytest.mark.asyncio
async def test_reverse_trust_headers_from_session_state():
    session = _FakeSession(
        state={
            SESSION_MIS_JWT_KEY: "eyJ.rEaL.upstream.jwt",
            SESSION_TENANT_ID_KEY: "tenant-42",
        },
        user_id="user-7",
        channel="wecom-bot",
    )
    headers = await build_reverse_trust_headers(session=session, identity={})
    # 上游 genuine MIS JWT 必须原样透传（严禁伪造）
    assert headers["X-Mis-Upstream-Jwt"] == "eyJ.rEaL.upstream.jwt"
    assert headers["X-Tenant-Id"] == "tenant-42"
    assert headers["X-Channel"] == "wecom-bot"
    assert headers["X-User-Id"] == "user-7"


@pytest.mark.asyncio
async def test_reverse_trust_no_jwt_falls_back_to_user_headers():
    # 非 MIS 门户渠道：无上游 JWT，依赖 X-User-Id / X-Tenant-Id 透传
    headers = await build_reverse_trust_headers(
        identity={"userId": "u-h5", "tenantId": "t-h5"},
        channel="h5",
    )
    assert "X-Mis-Upstream-Jwt" not in headers
    assert headers["X-User-Id"] == "u-h5"
    assert headers["X-Tenant-Id"] == "t-h5"
    assert headers["X-Channel"] == "h5"


# ============================================================================
# field_mapping
# ============================================================================


def test_field_mapping_writable_whitelist():
    assert is_writable_field("purchase-order", "supplier") is True
    assert is_writable_field("purchase-order", "reference") is True
    assert is_writable_field("purchase-order", "amount") is True
    # 非白名单字段被拒绝（防越权写回）
    assert is_writable_field("purchase-order", "evil_field") is False
    # 未知单据类型回退默认 purchase-order
    assert is_writable_field(None, "supplier") is True


# ============================================================================
# formfill_pending
# ============================================================================


@pytest.mark.asyncio
async def test_formfill_pending_store_crud_and_expiry():
    store = FormFillPendingStore()
    record = await store.create(
        resume_token="rt-crud",
        session_id="s1",
        agent_id="a1",
        skill_id="user-fill",
        user_id="u1",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-1",
        candidates=[{"id": "c1", "displayName": "供应商A"}],
        prompt="选择供应商",
    )
    assert record.status == FormFillStatus.PENDING

    fetched = await store.get("rt-crud")
    assert fetched is not None and fetched.field == "supplier"

    # 过期检测：构造一个已超时的记录
    old = FormFillPendingRecord_for_test()
    async with store._lock:
        store._records["rt-old"] = old
    got_old = await store.get("rt-old")
    assert got_old is not None and got_old.status == FormFillStatus.EXPIRED

    await store.update_status("rt-crud", FormFillStatus.APPLIED)
    updated = await store.get("rt-crud")
    assert updated.status == FormFillStatus.APPLIED


def FormFillPendingRecord_for_test():
    """构造一个已超时的挂起记录（供过期检测测试）。"""
    from src.hitl.formfill_pending import FormFillPendingRecord

    past = datetime.now(timezone.utc) - timedelta(seconds=3600)
    return FormFillPendingRecord(
        resume_token="rt-old",
        session_id="s1",
        skill_id="user-fill",
        field="supplier",
        created_at=past,
        timeout_seconds=1800,
    )


@pytest.mark.asyncio
async def test_formfill_pending_store_singleton():
    s1 = get_formfill_pending_store()
    s2 = get_formfill_pending_store()
    assert s1 is s2
    # execute 与 resume 共享同一实例 → resume 能取到 execute 登记的记录
    await s1.create(
        resume_token="rt-singleton",
        session_id="s-x",
        agent_id="a-x",
        skill_id="user-fill",
        user_id="u-x",
        field="reference",
        doc_type="purchase-order",
        doc_id="PO-X",
        candidates=[],
    )
    found = await s2.get("rt-singleton")
    assert found is not None and found.field == "reference"


# ============================================================================
# a2ui_pending
# ============================================================================


@pytest.mark.asyncio
async def test_a2ui_pending_push_drain():
    session_id = "a2ui-sess"
    await push_a2ui_render(session_id, "entity-select", {"resumeToken": "rt-1"})
    items = await drain_a2ui_renders(session_id)
    assert len(items) == 1
    assert items[0]["component"] == "entity-select"
    assert items[0]["props"]["resumeToken"] == "rt-1"
    # drain 后缓冲清空
    assert await drain_a2ui_renders(session_id) == []


# ============================================================================
# formfill_client（Result 信封 unwrap / 错误分支）
# ============================================================================


class _FakeResp:
    def __init__(self, status_code: int = 200, json_data: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.text = text

    def json(self):
        return self._json


@pytest.mark.asyncio
async def test_formfill_client_execute_unwraps_data():
    client = FormFillClient()
    client._client = AsyncMock()
    client._client.post = AsyncMock(
        return_value=_FakeResp(200, {"code": 0, "data": {"status": "success", "fields": {"a": 1}}})
    )
    result = await client.execute_skill(skill_id="user-fill", session_id="s1", user_input="x")
    assert result["status"] == "success"
    assert result["fields"] == {"a": 1}
    await client.aclose()


@pytest.mark.asyncio
async def test_formfill_client_execute_sends_top_level_pagecontext():
    """契约测试：/execute 请求体必须把业务上下文放在顶层 pageContext，
    且不得出现 context/sessionId/conversationId 包装（I1 回归防护）。"""
    client = FormFillClient()
    client._client = AsyncMock()
    client._client.post = AsyncMock(
        return_value=_FakeResp(200, {"code": 0, "data": {"status": "success", "fields": {}}})
    )
    biz_ctx = {
        "docType": "purchase-order",
        "docId": "PO-1",
        "pageContext": {"orgId": 3, "supplier": "c1"},
    }
    await client.execute_skill(
        skill_id="user-fill",
        session_id="s1",
        user_input="把张三调到财务部",
        context=biz_ctx,
        conversation_id="conv-9",
    )
    # 捕获真实发出的请求体（_post 以 json= 关键字传参）
    assert client._client.post.call_count == 1
    payload = client._client.post.call_args.kwargs["json"]
    assert isinstance(payload, dict)

    # 顶层 pageContext 必须存在，且为传入的业务上下文整体（对齐 Java SkillExecuteRequest.pageContext）
    assert "pageContext" in payload
    assert payload["pageContext"] == biz_ctx

    # 不得出现会被 Jackson 忽略的包装键 / 冗余键，否则 BFF 收不到上下文（I1 回归防护）
    assert "context" not in payload
    assert "sessionId" not in payload
    assert "conversationId" not in payload

    # pageContext 内含 docType/docId 及内层表单上下文
    assert payload["pageContext"]["docType"] == "purchase-order"
    assert payload["pageContext"]["docId"] == "PO-1"
    assert payload["pageContext"]["pageContext"] == {"orgId": 3, "supplier": "c1"}
    await client.aclose()


@pytest.mark.asyncio
async def test_formfill_client_apply_unwraps_data():
    client = FormFillClient()
    client._client = AsyncMock()
    client._client.post = AsyncMock(
        return_value=_FakeResp(200, {"code": 0, "data": {"status": "success", "docId": "PO-9"}})
    )
    result = await client.apply_skill(
        skill_id="user-fill", doc_type="purchase-order", doc_id="PO-9", values={"supplier": "c1"}
    )
    assert result["status"] == "success"
    assert result["docId"] == "PO-9"
    await client.aclose()


@pytest.mark.asyncio
async def test_formfill_client_business_error_raises():
    client = FormFillClient()
    client._client = AsyncMock()
    client._client.post = AsyncMock(return_value=_FakeResp(200, {"code": 4001, "message": "bad"}))
    with pytest.raises(FormFillClientError):
        await client.execute_skill(skill_id="user-fill", session_id="s1")
    await client.aclose()


@pytest.mark.asyncio
async def test_formfill_client_server_error_raises():
    client = FormFillClient()
    client._client = AsyncMock()
    client._client.post = AsyncMock(return_value=_FakeResp(500, {}))
    with pytest.raises(FormFillClientError):
        await client.execute_skill(skill_id="user-fill", session_id="s1")
    await client.aclose()


@pytest.mark.asyncio
async def test_formfill_client_non_json_raises():
    client = FormFillClient()
    client._client = AsyncMock()
    bad = _FakeResp(200, {})
    bad.json = lambda: (_ for _ in ()).throw(ValueError("not json"))  # type: ignore[assignment]
    client._client.post = AsyncMock(return_value=bad)
    with pytest.raises(FormFillClientError):
        await client.execute_skill(skill_id="user-fill", session_id="s1")
    await client.aclose()


# ============================================================================
# formfill_execute 工具
# ============================================================================


import src.skills.tools.formfill_execute as ff_mod  # noqa: E402


@pytest.mark.asyncio
async def test_formfill_execute_resolve_skill_id():
    assert ff_mod.resolve_skill_id("user-fill") == "user-fill"
    assert ff_mod.resolve_skill_id("fill") == "user-fill"
    assert ff_mod.resolve_skill_id("unknown-x") == "unknown-x"
    assert ff_mod.resolve_skill_id(None) == "user-fill"  # 默认白名单首项


@pytest.mark.asyncio
async def test_formfill_execute_hitl_required(monkeypatch):
    hitl_response = {
        "status": "hitl_required",
        "resumeToken": "rt-hitl",
        "hitl": {
            "field": "supplier",
            "originalValue": "",
            "prompt": "请选择供应商",
            "candidates": [
                {"id": "c1", "displayName": "供应商A"},
                {"id": "c2", "displayName": "供应商B"},
            ],
        },
    }
    fake = _FakeFormFillClient(hitl_response)
    monkeypatch.setattr(ff_mod, "FormFillClient", lambda *a, **k: fake)
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())

    tool = ff_mod.FormFillExecuteTool()
    ctx = object_with_metadata({"session_id": "sess-hitl"})
    result = await tool.execute(
        ff_mod.FormFillExecuteInput(skill_id="user-fill", user_input="填充供应商"),
        ctx,
    )

    assert result.is_error is False
    assert "需要人工确认" in result.output
    # 挂起任务已登记（单例共享）
    store = get_formfill_pending_store()
    record = await store.get("rt-hitl")
    assert record is not None and record.field == "supplier"
    assert record.status == FormFillStatus.PENDING
    # A2UI 渲染已推送
    items = await drain_a2ui_renders("sess-hitl")
    assert len(items) == 1
    assert items[0]["component"] == "entity-select"


@pytest.mark.asyncio
async def test_formfill_execute_success(monkeypatch):
    success_response = {"status": "success", "fields": {"supplier": "c1", "reference": "PO-1"}}
    fake = _FakeFormFillClient(success_response)
    monkeypatch.setattr(ff_mod, "FormFillClient", lambda *a, **k: fake)
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())

    tool = ff_mod.FormFillExecuteTool()
    ctx = object_with_metadata({"session_id": "sess-ok"})
    result = await tool.execute(
        ff_mod.FormFillExecuteInput(skill_id="user-fill", user_input="填充"),
        ctx,
    )
    assert result.is_error is False
    assert "表单填充完成" in result.output
    assert "supplier" in result.output


@pytest.mark.asyncio
async def test_formfill_execute_success_autowrites_back(monkeypatch):
    # SUCCESS 路径应自动写回：execute 返回多字段 success，apply 返回成功
    execute_resp = {"status": "success", "fields": {"supplier": "c1", "reference": "PO-1"}}
    apply_resp = {"status": "success", "docId": "PO-1"}
    exec_fake = _FakeFormFillClient(execute_resp)
    apply_fake = _FakeFormFillClient(apply_resp)
    monkeypatch.setattr(ff_mod, "FormFillClient", lambda *a, **k: exec_fake)
    monkeypatch.setattr(fa_mod, "FormFillClient", lambda *a, **k: apply_fake)
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())

    tool = ff_mod.FormFillExecuteTool()
    ctx = object_with_metadata({"session_id": "sess-autowrite"})
    result = await tool.execute(
        ff_mod.FormFillExecuteInput(
            skill_id="user-fill",
            user_input="填充",
            doc_type="purchase-order",
            doc_id="PO-1",
            page_context={"docType": "purchase-order", "docId": "PO-1"},
        ),
        ctx,
    )
    assert result.is_error is False
    assert "已写回单据 PO-1" in result.output
    # 自动写回发生且为批量（整个 fields map 作为 values）
    assert len(apply_fake.apply_calls) == 1
    assert apply_fake.apply_calls[0]["doc_type"] == "purchase-order"
    assert apply_fake.apply_calls[0]["doc_id"] == "PO-1"
    assert apply_fake.apply_calls[0]["values"] == {"supplier": "c1", "reference": "PO-1"}
    # metadata 回带 docType/docId + applied 标记
    meta = result.metadata["formfill"]
    assert meta["applied"] is True
    assert meta["docType"] == "purchase-order"
    assert meta["docId"] == "PO-1"


@pytest.mark.asyncio
async def test_formfill_execute_client_error(monkeypatch):
    err_client = _FakeFormFillClient({})
    # execute_skill 抛 FormFillClientError
    async def _boom(*args, **kwargs):
        raise FormFillClientError("BFF unreachable")

    err_client.execute_skill = _boom  # type: ignore[assignment]
    monkeypatch.setattr(ff_mod, "FormFillClient", lambda *a, **k: err_client)
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())

    tool = ff_mod.FormFillExecuteTool()
    ctx = object_with_metadata({"session_id": "sess-err"})
    result = await tool.execute(
        ff_mod.FormFillExecuteInput(skill_id="user-fill", user_input="x"),
        ctx,
    )
    assert result.is_error is True
    assert "调用 FormFill 引擎失败" in result.output


# ============================================================================
# formfill_apply 工具
# ============================================================================


import src.skills.tools.formfill_apply as fa_mod  # noqa: E402
from src.skills.tools.formfill_apply import submit_formfill_apply  # noqa: E402


@pytest.mark.asyncio
async def test_formfill_apply_non_writable_field_rejected():
    with pytest.raises(FormFillClientError):
        await submit_formfill_apply(
            session=None,
            skill_id="user-fill",
            doc_type="purchase-order",
            doc_id="PO-1",
            field="evil_field",
            value="x",
        )


@pytest.mark.asyncio
async def test_formfill_apply_writable_success(monkeypatch):
    apply_response = {"status": "success", "docId": "PO-1"}
    fake = _FakeFormFillClient(apply_response)
    monkeypatch.setattr(fa_mod, "FormFillClient", lambda *a, **k: fake)

    resp = await submit_formfill_apply(
        session=None,
        skill_id="user-fill",
        doc_type="purchase-order",
        doc_id="PO-1",
        field="supplier",
        value="c1",
    )
    assert resp["status"] == "success"
    assert fake.apply_calls[0]["values"] == {"supplier": "c1"}


@pytest.mark.asyncio
async def test_submit_formfill_apply_bulk_values(monkeypatch):
    apply_resp = {"status": "success", "docId": "PO-2"}
    fake = _FakeFormFillClient(apply_resp)
    monkeypatch.setattr(fa_mod, "FormFillClient", lambda *a, **k: fake)
    resp = await submit_formfill_apply(
        session=None,
        skill_id="user-fill",
        doc_type="purchase-order",
        doc_id="PO-2",
        values={"supplier": "c1", "reference": "PO-9", "amount": 100},
    )
    assert resp["status"] == "success"
    assert fake.apply_calls[0]["values"] == {
        "supplier": "c1",
        "reference": "PO-9",
        "amount": 100,
    }


@pytest.mark.asyncio
async def test_submit_formfill_apply_bulk_rejects_non_writable():
    # 批量模式下任一字段不在白名单即整体拒绝（避免越权写回）
    with pytest.raises(FormFillClientError):
        await submit_formfill_apply(
            session=None,
            skill_id="user-fill",
            doc_type="purchase-order",
            doc_id="PO-2",
            values={"supplier": "c1", "evil_field": "x"},
        )


# ============================================================================
# resume_formfill（entity_select 续跑）
# ============================================================================


@pytest.mark.asyncio
async def test_resume_formfill_confirm(monkeypatch):
    store = get_formfill_pending_store()
    await store.create(
        resume_token="rt-confirm",
        session_id="s1",
        agent_id="a1",
        skill_id="user-fill",
        user_id="u1",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-1",
        candidates=[{"id": "c1"}],
        prompt="p",
    )

    async def _fake_apply(*, session, skill_id, doc_type, doc_id, field, value, identity=None):
        return {"status": "success", "docId": "PO-1"}

    monkeypatch.setattr(fa_mod, "submit_formfill_apply", _fake_apply)
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())

    session = _FakeSession()
    inbound = _FakeInbound(
        resume_token="rt-confirm",
        selection_action="confirm",
        selected_candidate={"id": "c1", "displayName": "供应商A"},
    )
    outcome = await ff_mod.resume_formfill(
        instance=None, session=session, inbound=inbound, producer=None
    )
    assert outcome.kind == "continue"
    assert "supplier" in outcome.content and "c1" in outcome.content
    # 任务已标记 APPLIED
    record = await store.get("rt-confirm")
    assert record.status == FormFillStatus.APPLIED


@pytest.mark.asyncio
async def test_resume_formfill_cancel(monkeypatch):
    store = get_formfill_pending_store()
    await store.create(
        resume_token="rt-cancel",
        session_id="s1",
        agent_id="a1",
        skill_id="user-fill",
        user_id="u1",
        field="supplier",
        doc_type="purchase-order",
        doc_id="PO-1",
        candidates=[],
    )
    # 避免真实写回：apply 不会被调用（cancel 分支）
    monkeypatch.setattr(
        fa_mod,
        "submit_formfill_apply",
        AsyncMock(side_effect=AssertionError("apply should not be called on cancel")),
    )
    monkeypatch.setattr(ff_mod, "get_session_manager", lambda: _FakeSessionManager())

    session = _FakeSession()
    inbound = _FakeInbound(resume_token="rt-cancel", selection_action="cancel", selected_candidate={})
    outcome = await ff_mod.resume_formfill(
        instance=None, session=session, inbound=inbound, producer=None
    )
    assert outcome.kind == "message"
    assert "已取消" in outcome.content
    record = await store.get("rt-cancel")
    assert record.status == FormFillStatus.CANCELLED


@pytest.mark.asyncio
async def test_resume_formfill_not_found():
    session = _FakeSession()
    inbound = _FakeInbound(
        resume_token="rt-does-not-exist", selection_action="confirm", selected_candidate={"id": "x"}
    )
    outcome = await ff_mod.resume_formfill(
        instance=None, session=session, inbound=inbound, producer=None
    )
    assert outcome.kind == "message"
    assert "未找到" in outcome.content


# ============================================================================
# ToolExecutionContext 替身工厂
# ============================================================================


def object_with_metadata(metadata: dict) -> object:
    """构造一个带 cwd / metadata 的 ToolExecutionContext 替身。"""
    from openharness.tools.base import ToolExecutionContext

    return ToolExecutionContext(cwd=Path("/tmp"), metadata=metadata)
