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
    QaDelta,
    build_kb_call_context,
    format_kb_answer_for_chat,
    is_kb_qa_request,
)

__all__ = [
    "EVENT_DELTA",
    "EVENT_DONE",
    "EVENT_ERROR",
    "KbQaPipeline",
    "KbQaRequest",
    "QaDelta",
    "build_kb_call_context",
    "format_kb_answer_for_chat",
    "is_kb_qa_request",
]
