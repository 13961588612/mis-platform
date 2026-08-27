"""mis-rag Agent 的 KB 问答编排包（T10 / F-01）。

按 §13 第 1 项裁定，编排权由 BFF 下沉到 mis-rag：本包封装
``visible-libraries → retrieve → 拼 Prompt → 生成 → 结构化 citations → 落库``
全流程，对外暴露 :class:`~src.agent.mis_rag.qa_pipeline.KbQaPipeline`
及其流式产物 :class:`~src.agent.mis_rag.qa_pipeline.QaDelta`（F-01）。
"""

from src.agent.mis_rag.qa_pipeline import (
    EVENT_DELTA,
    EVENT_DONE,
    EVENT_ERROR,
    KbQaPipeline,
    KbQaRequest,
    PENDING_KB_SOURCES_FENCE_KEY,
    QaDelta,
    build_kb_call_context,
    extract_kb_sources_fence,
    format_kb_answer_for_chat,
    format_mis_rag_delegate_answer,
    is_kb_qa_request,
    parse_kb_retrieve_tool_output,
)

__all__ = [
    "EVENT_DELTA",
    "EVENT_DONE",
    "EVENT_ERROR",
    "KbQaPipeline",
    "KbQaRequest",
    "PENDING_KB_SOURCES_FENCE_KEY",
    "QaDelta",
    "build_kb_call_context",
    "extract_kb_sources_fence",
    "format_kb_answer_for_chat",
    "format_mis_rag_delegate_answer",
    "is_kb_qa_request",
    "parse_kb_retrieve_tool_output",
]
