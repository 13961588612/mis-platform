"""kb_retrieve 原生工具契约测试（T5）。

覆盖：
1. 全链路：调用 ``KbClient.retrieve``（mock mis-kb），验证
   resolve-visible → retrieve 全链路；``library_ids`` 缺省走可见库。
2. A==B query 契约：同一用户输入，断言路径 A（BFF→mis-rag）与路径 B
   （Copilot→mis-rag 子 Agent）最终发给 ``KbClient.retrieve`` 的 ``question``
   逐字节一致（拦截「PAD退货设置」被改写成「PAD退货要做哪些设置」这类）。
3. A/B 命中一致性：同一知识库问题，两路返回相同/等价片段。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from openharness.tools.base import ToolExecutionContext

from src.adapters.kb_client import KbClientError
from src.agent.mis_rag.qa_pipeline import retrieve_kb_chunks
from src.models.retrieve import ChunkHit, RetrieveHits, VisibleLibraries
from src.skills.tools import kb_retrieve as kb_retrieve_mod
from src.skills.tools.kb_retrieve import KbRetrieveInput, KbRetrieveTool


# --------------------------------------------------------------------------- #
# 假 KbClient：记录 retrieve 调用，避免真实网络
# --------------------------------------------------------------------------- #


@dataclass
class _RetrieveCall:
    question: str
    library_ids: list[int] | None
    top_k: int | None
    threshold: float | None
    ctx_user_id: int | None


_fake_instances: list["_FakeKbClient"] = []


class _FakeKbClient:
    """记录 resolve/retrieve 调用的假 KbClient。"""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.retrieve_calls: list[_RetrieveCall] = []
        self.resolve_calls: int = 0
        self._visible = VisibleLibraries(library_ids=[10, 20])
        self._hits = RetrieveHits(
            hits=[
                ChunkHit(
                    library_id=10,
                    document_id=1,
                    chunk_text="PAD退货可在【设置-交易】页开启自动退款。",
                    score=0.91,
                    doc_title="PAD操作手册",
                ),
                ChunkHit(
                    library_id=20,
                    document_id=2,
                    chunk_text="退货设置需主管审批，阈值 5000 元。",
                    score=0.82,
                    doc_title="退货制度",
                ),
            ]
        )
        _fake_instances.append(self)

    async def resolve_visible_libraries(self, ctx: Any) -> VisibleLibraries:
        self.resolve_calls += 1
        return self._visible

    async def retrieve(
        self,
        ctx: Any,
        *,
        question: str,
        library_ids: list[int] | None = None,
        top_k: int | None = None,
        threshold: float | None = None,
    ) -> RetrieveHits:
        self.retrieve_calls.append(
            _RetrieveCall(
                question=question,
                library_ids=library_ids,
                top_k=top_k,
                threshold=threshold,
                ctx_user_id=ctx.user_id if ctx else None,
            )
        )
        return self._hits

    async def aclose(self) -> None:
        pass


def _make_context(*, mis_user_id: str = "1001", session_id: str = "s-1") -> ToolExecutionContext:
    """构造带身份的 ToolExecutionContext（路径 A/B 同源 misUserId）。"""
    return ToolExecutionContext(
        cwd=Path("/tmp"),
        metadata={
            "identity": {"misUserId": mis_user_id, "userId": "u1", "channel": "mis_bff"},
            "session_id": session_id,
        },
    )


async def _simulate_path(
    tool: KbRetrieveTool,
    question: str,
    *,
    library_ids: list[str] | None = None,
    mis_user_id: str = "1001",
    session_id: str = "s-1",
) -> tuple[Any, _FakeKbClient]:
    """模拟某条路径（A 或 B）调用工具，返回执行结果与假 KbClient 实例。"""
    ctx = _make_context(mis_user_id=mis_user_id, session_id=session_id)
    result = await tool.execute(
        KbRetrieveInput(question=question, library_ids=library_ids), ctx
    )
    return result, _fake_instances[-1]


# --------------------------------------------------------------------------- #
# 1. 全链路：resolve-visible → retrieve；library_ids 缺省走可见库
# --------------------------------------------------------------------------- #


async def test_kb_retrieve_calls_kb_client_full_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    """kb_retrieve 缺省 library_ids 时先解析可见库，再 retrieve，返回命中片段。"""
    monkeypatch.setattr(kb_retrieve_mod, "KbClient", _FakeKbClient)
    tool = KbRetrieveTool()

    result, fake = await _simulate_path(tool, "PAD退货设置")

    assert result.is_error is False
    # 先解析可见库
    assert fake.resolve_calls == 1
    # 再检索，且检索范围取解析出的可见库
    assert len(fake.retrieve_calls) == 1
    call = fake.retrieve_calls[0]
    assert call.question == "PAD退货设置"  # F2：原样透传
    assert call.library_ids == [10, 20]
    assert call.top_k == 5
    # 返回片段可被解析
    import json

    payload = json.loads(result.output)
    assert payload["count"] == 2
    assert payload["hits"][0]["index"] == 1
    assert payload["hits"][0]["source"] == "PAD操作手册"
    assert "PAD退货可在" in payload["hits"][0]["chunk_text"]


async def test_kb_retrieve_skips_resolve_when_library_ids_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """显式 library_ids 时不再解析可见库，直接以给定范围检索。"""
    monkeypatch.setattr(kb_retrieve_mod, "KbClient", _FakeKbClient)
    tool = KbRetrieveTool()

    result, fake = await _simulate_path(tool, "退货流程", library_ids=["10"])

    assert result.is_error is False
    assert fake.resolve_calls == 0  # 已指定范围，跳过去重解析
    assert fake.retrieve_calls[0].library_ids == [10]
    assert fake.retrieve_calls[0].question == "退货流程"


async def test_kb_retrieve_degrades_on_client_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """mis-kb 检索失败时降级为空命中报文，而非向上抛错。"""

    class _BoomKb:
        def __init__(self, *a: Any, **k: Any) -> None:
            _fake_instances.append(self)

        async def resolve_visible_libraries(self, ctx: Any) -> VisibleLibraries:
            return VisibleLibraries(library_ids=[10])

        async def retrieve(self, ctx: Any, **kwargs: Any) -> RetrieveHits:
            raise KbClientError("mis-kb 超时")

        async def aclose(self) -> None:
            pass

    monkeypatch.setattr(kb_retrieve_mod, "KbClient", _BoomKb)
    tool = KbRetrieveTool()

    result, _ = await _simulate_path(tool, "任何问题")
    assert result.is_error is True
    assert "检索失败" in result.output


# --------------------------------------------------------------------------- #
# 2. A==B query 契约：同一用户输入，question 逐字节一致（F2 护栏）
# --------------------------------------------------------------------------- #


async def test_a_b_query_byte_identical(monkeypatch: pytest.MonkeyPatch) -> None:
    """路径 A 与路径 B 对同一条原始问题，发给 KbClient.retrieve 的 question 逐字节一致。"""
    monkeypatch.setattr(kb_retrieve_mod, "KbClient", _FakeKbClient)
    tool = KbRetrieveTool()
    raw_question = "PAD退货设置"

    # 路径 A：BFF 透传原话（misUserId 来自 BFF 会话）
    res_a, fake_a = await _simulate_path(tool, raw_question, mis_user_id="1001", session_id="bff-sess")
    # 路径 B：mis-copilot 子会话 TaskBrief.inputs.user_question（misUserId 同样来自用户）
    res_b, fake_b = await _simulate_path(tool, raw_question, mis_user_id="1001", session_id="copilot-sess")

    assert res_a.is_error is False and res_b.is_error is False
    q_a = fake_a.retrieve_calls[0].question
    q_b = fake_b.retrieve_calls[0].question
    # 逐字节一致
    assert q_a == q_b
    assert q_a == raw_question
    # 护栏：不得被改写为语义归一化句
    assert q_a != "PAD退货要做哪些设置"
    assert q_b != "PAD退货要做哪些设置"


async def test_kb_retrieve_does_not_rewrite_question(monkeypatch: pytest.MonkeyPatch) -> None:
    """工具内部绝不对 question 做改写/归一化（即使问题像需要概括）。"""
    monkeypatch.setattr(kb_retrieve_mod, "KbClient", _FakeKbClient)
    tool = KbRetrieveTool()

    result, fake = await _simulate_path(tool, "PAD退货设置")
    assert fake.retrieve_calls[0].question == "PAD退货设置"

    result2, fake2 = await _simulate_path(tool, "  年假怎么休  ")
    # 仅做必要 strip 的边界由 KbClient 侧负责；工具层不增删语义
    assert fake2.retrieve_calls[0].question == "  年假怎么休  "


# --------------------------------------------------------------------------- #
# 3. A/B 命中一致性：同一知识库问题，两路返回相同/等价片段
# --------------------------------------------------------------------------- #


async def test_a_b_hit_consistency(monkeypatch: pytest.MonkeyPatch) -> None:
    """同一问题，路径 A 与路径 B 经 kb_retrieve 返回等价片段（same query ⇒ same hits）。"""
    monkeypatch.setattr(kb_retrieve_mod, "KbClient", _FakeKbClient)
    tool = KbRetrieveTool()
    question = "PAD退货设置"

    res_a, _ = await _simulate_path(tool, question, mis_user_id="1001", session_id="a")
    res_b, _ = await _simulate_path(tool, question, mis_user_id="1001", session_id="b")

    import json

    hits_a = json.loads(res_a.output)["hits"]
    hits_b = json.loads(res_b.output)["hits"]
    # 等价于：相同 query 命中相同（按顺序）片段
    assert [h["document_id"] for h in hits_a] == [h["document_id"] for h in hits_b]
    assert [h["chunk_text"] for h in hits_a] == [h["chunk_text"] for h in hits_b]
    assert hits_a[0]["source"] == "PAD操作手册"


# --------------------------------------------------------------------------- #
# 单元层：retrieve_kb_chunks 复用逻辑（DRY）
# --------------------------------------------------------------------------- #


async def test_retrieve_kb_chunks_resolves_visible_when_empty() -> None:
    """retrieve_kb_chunks 在 library_ids 为空时先解析可见库再检索（供 kb_retrieve 复用）。"""
    fake = _FakeKbClient()
    from src.adapters.kb_client import KbCallContext

    ctx = KbCallContext(user_id=1001)
    hits = await retrieve_kb_chunks(
        fake, ctx, question="PAD退货设置", library_ids=None, top_k=5, threshold=None
    )
    assert fake.resolve_calls == 1
    assert len(fake.retrieve_calls) == 1
    assert fake.retrieve_calls[0].library_ids == [10, 20]
    assert len(hits.hits) == 2
