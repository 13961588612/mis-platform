"""kb_retrieve — mis-rag 内部原生知识库检索工具（T4/TOOL）。

背景
====
mis-rag 自身原本没有检索工具；检索只发生在**路径 A**（智能问答页：BFF
``mis_capability`` 的 ``KbQaPipeline`` 先预检索、再把命中片段注入 mis-rag 的 prompt）。
**路径 B**（Copilot：H5 → mis-copilot → mis-rag 子 Agent）绕过了预注入，导致
「问知识库问题检索为空、但智能问答页能命中」的不一致。

本工具把检索能力直接交给 mis-rag：mis-rag 在需要依据知识库作答时调用
``kb_retrieve(question=<用户原始问题>)``，内部复用
:func:`src.agent.mis_rag.qa_pipeline.retrieve_kb_chunks`（同一套
resolve-visible → retrieve 逻辑，打到 mis-kb RAGFlow 同一索引），再把命中片段
注入自身提示词合成答案。两路（A：BFF→mis-rag；B：Copilot→mis-rag 子 Agent）因此
收敛为**同一个执行体**，根因消除，且不再重复预检索。

关键纪律（F2 护栏）
====================
``question`` 必须是**用户原始问题原文**。工具内部**不做任何改写 / 语义归一化**
（不使用 goal 等归一字段），确保路径 A 与路径 B 最终发给 ``KbClient.retrieve``
的 query 逐字节一致（拦截「PAD退货设置」被改写成「PAD退货要做哪些设置」这类问题）。
"""

from __future__ import annotations
from typing import Any

import json

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.adapters.kb_client import KbCallContext, KbClient, KbClientError
from src.agent.mis_rag.qa_pipeline import retrieve_kb_chunks
from src.utils.logging import get_logger

logger = get_logger("skills.kb_retrieve")


def _to_int_list(value: Any) -> list[int]:
    """把 list / 逗号分隔串规约为 int 列表；非法项静默丢弃。"""
    if value is None:
        return []
    items: list[Any]
    if isinstance(value, (list, tuple)):
        items = list(value)
    elif isinstance(value, str):
        items = [p for p in value.split(",") if p.strip()]
    else:
        items = [value]
    parsed: list[int] = []
    for item in items:
        if item is None or isinstance(item, bool):
            continue
        try:
            parsed.append(int(str(item).strip()))
        except (TypeError, ValueError):
            continue
    return parsed


def _build_kb_context(metadata: dict[str, Any] | None) -> KbCallContext:
    """由工具执行上下文的 ``metadata`` 构造 :class:`KbCallContext`。

    身份优先取自 ``metadata["identity"]["misUserId"]``（T03 S9 第五键，即 MIS
    userId / JWT sub）。路径 A（mis_capability 会话）与路径 B（Copilot 子会话）
    同源，保证两路可见库判定一致。

    ``authorization`` / ``tenant_id`` / ``app_id`` 等透传头在原生工具上下文通常
    不可得，留空由 :class:`KbClient` 回落服务账号令牌；``trace_id`` 借用
    ``session_id`` 便于日志串联。
    """

    def _int(v: Any) -> int | None:
        if v is None or isinstance(v, bool):
            return None
        try:
            return int(str(v).strip())
        except (TypeError, ValueError):
            return None

    meta = metadata or {}
    nested = meta.get("identity") if isinstance(meta.get("identity"), dict) else {}
    mis_user_id = nested.get("misUserId") if isinstance(nested, dict) else None
    if mis_user_id is None:
        mis_user_id = meta.get("misUserId") or meta.get("mis_user_id")

    return KbCallContext(
        user_id=_int(mis_user_id),
        tenant_id=_int(
            meta.get("tenantId") or (nested.get("tenantId") if isinstance(nested, dict) else None)
        ),
        app_id=_int(
            meta.get("appId") or (nested.get("appId") if isinstance(nested, dict) else None)
        ),
        authorization=str(meta.get("authorization") or nested.get("authorization") or ""),
        trace_id=str(meta.get("session_id") or meta.get("traceId") or ""),
    )


class KbRetrieveInput(BaseModel):
    """kb_retrieve 工具入参。"""

    question: str = Field(
        ...,
        description=(
            "用户原始问题原文（**必须原样传入，禁止改写 / 归一化语义**）。"
            "mis-rag 在需要依据知识库作答时，直接把用户原话传给本工具。"
        ),
    )
    library_ids: list[str] | None = Field(
        default=None,
        description=(
            "限定的知识库 ID 列表（字符串数字，可空）。缺省时由 mis-kb 按用户可见库解析，"
            "只检索当前用户有权访问的范围。"
        ),
    )
    top_k: int = Field(default=5, description="召回片段条数（默认 5）。")
    threshold: float | None = Field(
        default=None, description="相关性阈值（0~1，留空由引擎默认策略裁定）。"
    )


class KbRetrieveTool(BaseTool):
    """mis-rag 内部知识库检索工具（T4/TOOL）。

    由 runtime 通过 ``tool_registry_builder.create_agent_source_registry`` 注册，
    并在 mis-rag ``runtime.yaml`` 的 ``allowed_tools`` 中显式放行后，对 mis-rag
    的 LLM 可见、可被调用。
    """

    name = "kb_retrieve"
    description = (
        "检索 MIS 知识库，返回与用户问题相关的命中片段（含来源、相关性打分与片段正文），"
        "供你严格基于片段作答并按编号回引。\n"
        "**调用纪律（重要）**：\n"
        "1. 仅在需要依据知识库回答时才调用本工具；\n"
        "2. `question` 必须传入**用户原始问题原文**，不得改写、不得泛化、不得用你的归纳句替代"
        "（例如用户问「PAD退货设置」，就必须传「PAD退货设置」，不能传「PAD退货要做哪些设置」）；\n"
        "3. 无命中时如实说明，不要编造；\n"
        "4. 返回片段已按 [1]、[2]… 编号，作答时按编号回引。"
    )
    input_model = KbRetrieveInput

    async def execute(self, arguments: KbRetrieveInput, context: ToolExecutionContext) -> ToolResult:
        """检索知识库并返回编号片段；失败时降级为空命中而非向上抛错。

        Args:
            arguments: 经 Pydantic 校验的工具入参。
            context: OpenHarness 执行上下文，身份取自 ``context.metadata``。

        Returns:
            成功时为命中片段的 JSON 字符串（含 ``question`` / ``count`` / ``hits``）；
            失败时 ``is_error=True`` 的说明文本。
        """
        # F2 护栏：question 原样透传，绝不做语义归一化改写。
        question: str = arguments.question
        if not question or not question.strip():
            return ToolResult(output="未提供有效问题，无法检索。", is_error=True)

        library_ids: list[int] = _to_int_list(arguments.library_ids)
        top_k: int = arguments.top_k if arguments.top_k and arguments.top_k > 0 else 5
        ctx: KbCallContext = _build_kb_context(context.metadata)

        kb = KbClient()
        try:
            hits = await retrieve_kb_chunks(
                kb,
                ctx,
                question=question,
                library_ids=library_ids,
                top_k=top_k,
                threshold=arguments.threshold,
            )
        except KbClientError as exc:
            logger.warning("kb_retrieve failed", error=str(exc), trace_id=ctx.trace_id)
            return ToolResult(output=f"知识库检索失败：{exc}", is_error=True)
        finally:
            await kb.aclose()

        payload: dict[str, Any] = {
            "question": question,
            "count": len(hits.hits),
            "hits": [
                {
                    "index": idx,
                    "source": hit.source_label(),
                    "score": hit.score,
                    "chunk_text": hit.chunk_text,
                    "library_id": hit.library_id,
                    "document_id": hit.document_id,
                    "image_id": hit.image_id,
                }
                for idx, hit in enumerate(hits.hits, start=1)
            ],
        }
        logger.info(
            "kb_retrieve done",
            user_id=ctx.user_id,
            hit_count=len(hits.hits),
            top_k=top_k,
            trace_id=ctx.trace_id,
        )
        return ToolResult(output=json.dumps(payload, ensure_ascii=False))
