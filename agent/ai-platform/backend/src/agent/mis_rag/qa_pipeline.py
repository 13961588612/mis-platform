"""KbQaPipeline — mis-rag 的 KB 问答编排管线（T10）。

按设计文档 §13 第 1/2 项裁定，编排权由 BFF 下沉到 mis-rag。本模块串起完整链路::

    visible-libraries → retrieve → 拼 Prompt → 生成 → 结构化 citations → 落库回调

责任边界：
- **检索与可见性**：全部交由 mis-kb 裁定（ACL 在 Java 侧），本管线只消费结果。
- **生成**：由调用方注入 ``generate`` 回调（复用既有 Agent 运行时 / LLM 网关），
  管线本身不直连 LLM，避免与 ``runtime`` 层耦合。
- **落库**：``session`` / ``message`` / ``citation`` 经 :class:`KbClient` 回调
  mis-kb 内部 API；``feedback`` 不在此链路（前端 → BFF → mis-kb）。

降级策略（关键）：**落库失败不得吞掉答案**。任一持久化步骤异常都会被捕获并记录，
管线仍返回已生成的 ``answer`` 与引用，仅 ``sessionId`` / ``messageId`` 为空。
同理，无 RAGFlow 实例（mis-kb NoopAdapter 返回空 hits）时链路照常跑通。
"""

from __future__ import annotations
from time import perf_counter
from typing import Any, AsyncIterator, Awaitable, Callable

import json
import re
from dataclasses import dataclass, field

from src.adapters.kb_client import KbCallContext, KbClient, KbClientError
from src.config import get_settings
from src.coordinator.flags import substage_instrumentation_enabled
from src.coordinator.trace import QA_SUB_STAGES_CV
from src.models.retrieve import ChunkHit, CitationItem, QaAnswer, QaCitation, RetrieveHits
from src.utils.logging import get_logger

logger = get_logger("agent.mis_rag.qa_pipeline")

# mis-rag 的 Agent ID（与 configs/agents/mis-rag 目录名、BFF agentIdFor("rag") 一致）
MIS_RAG_AGENT_ID = "mis-rag"

# BFF buildRagContent 生成的文本字段前缀（结构化 metadata 缺失时的兜底解析锚点）
_QUESTION_PREFIX = "问题："
_KB_PREFIX = "知识库："
_TOPK_PREFIX = "召回条数："

# 剥离 LLM 输出的 markdown 代码围栏
_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL | re.IGNORECASE)

# 流式模式下从答案正文抓取行内引用角标 [1] / [12]（F-01）
_INLINE_CITE_PATTERN = re.compile(r"\[(\d{1,2})\]")

# SSE 事件名（与设计 §7「SSE 事件格式」及前端 ai-sse-client.ts 对齐）
EVENT_DELTA = "delta"
EVENT_DONE = "done"
EVENT_ERROR = "error"


def is_kb_qa_request(agent_id: str, metadata: dict[str, Any] | None) -> bool:
    """判定一次 Agent 对话是否应走 KB 问答管线。

    命中条件（任一即可，且 KB 问答总开关须开启）：
    - ``agent_id == "mis-rag"``
    - ``metadata.capability == "rag"``

    Args:
        agent_id: 目标 Agent ID。
        metadata: BFF 透传的元数据（``source`` / ``capability`` / ``page_context`` 等）。

    Returns:
        ``True`` 表示走 KB 管线；``False`` 走原有通用 Agent 流程。
    """
    if not get_settings().MIS_KB_QA_ENABLED:
        return False
    if agent_id == MIS_RAG_AGENT_ID:
        return True
    meta = metadata or {}
    return str(meta.get("capability", "")).strip().lower() == "rag"


def _session_title(question: str, max_len: int = 30) -> str | None:
    """首问生成会话标题：strip 后超 max_len 取前 max_len + 省略号；空串返回 None。

    Args:
        question: 用户首问原文。
        max_len: 截断长度（设计口径 30 字符）。

    Returns:
        会话标题；空串/纯空白/``None`` 返回 ``None``（由 mis-kb 落库为 NULL，
        前端兜底展示「会话 #id」）。
    """
    text = (question or "").strip()
    if not text:
        return None
    if len(text) > max_len:
        return text[:max_len] + "…"
    return text


def build_kb_call_context(
    current_user: dict[str, Any] | None,
    *,
    authorization: str = "",
    trace_id: str = "",
    tenant_id: str = "",
    app_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> KbCallContext:
    """由请求上下文构造 :class:`KbCallContext`。

    ``user_id`` 优先取平台 ``UserContext.user_id``（MIS 身份即 JWT ``sub``）；
    ``tenant_id`` / ``app_id`` 优先取请求头，缺失时回落 metadata。

    Args:
        current_user: ``get_current_user`` 返回的身份字典。
        authorization: 原始 ``Authorization`` 头（``Bearer <token>``）。
        trace_id: 链路追踪 ID。
        tenant_id: ``X-Tenant-Id`` 头原文。
        app_id: ``X-App-Id`` 头原文。
        metadata: BFF 透传元数据，可携带 ``tenant_id`` / ``app_id``。

    Returns:
        可直接传给 :class:`KbClient` 的调用上下文。
    """
    meta = metadata or {}
    user = current_user or {}
    ctx = KbCallContext(
        user_id=_to_int(user.get("user_id")),
        tenant_id=_to_int(tenant_id) if tenant_id else _to_int(meta.get("tenant_id")),
        app_id=_to_int(app_id) if app_id else _to_int(meta.get("app_id")),
        authorization=authorization or "",
        trace_id=trace_id or "",
    )
    employee_id = meta.get("employee_id")
    if employee_id is not None:
        ctx.extra_headers["X-Employee-Id"] = str(employee_id)
    username = user.get("username")
    if username:
        ctx.extra_headers["X-Username"] = str(username)
    return ctx


def enrich_hits_with_document_images(
    selected_hits: list[ChunkHit],
    all_hits: list[ChunkHit],
) -> list[ChunkHit]:
    """把同文档检索命中上的配图回填到已选引用（解决「有图但配图丢」）。

    RAGFlow 常把 ``image_id`` 挂在示意图/OCR 兄弟分片上，而模型行内角标往往只引用
    问答正文分片（``image_id`` 为空）。若不回填，``kb-sources`` 无 ``imageId``，
    前端无法拉图——表现为反复「服务端有图、对话不出图」。

    策略（不写死业务文档）：
    1. 对已选命中：若缺 ``image_id``，从同 ``(library_id, document_id)`` 兄弟命中借用；
    2. 其余同文档且未出现过的 ``image_id`` 追加为配图来源行。
    """
    if not selected_hits or not all_hits:
        return list(selected_hits)

    result: list[ChunkHit] = list(selected_hits)
    seen_images: set[str] = {h.image_id for h in result if h.image_id}
    selected_docs: set[tuple[int, int]] = {
        (h.library_id, h.document_id)
        for h in selected_hits
        if h.library_id is not None and h.document_id is not None
    }

    for i, hit in enumerate(result):
        if hit.image_id or hit.library_id is None or hit.document_id is None:
            continue
        key = (hit.library_id, hit.document_id)
        for sibling in all_hits:
            if (sibling.library_id, sibling.document_id) != key:
                continue
            if sibling.image_id and sibling.image_id not in seen_images:
                result[i] = hit.model_copy(update={"image_id": sibling.image_id})
                seen_images.add(sibling.image_id)
                break

    for sibling in all_hits:
        if not sibling.image_id or sibling.image_id in seen_images:
            continue
        if sibling.library_id is None or sibling.document_id is None:
            continue
        if (sibling.library_id, sibling.document_id) not in selected_docs:
            continue
        result.append(sibling)
        seen_images.add(sibling.image_id)

    return result


def format_kb_answer_for_chat(answer: QaAnswer) -> str:
    """把管线产出整理成运营台本地对话可读的 Markdown。

    BFF ``/ai/rag`` 仍返回 JSON 信封；本地对话要把 ``answer`` 当正文，
    引用列表附在文末，避免运营看到 ``{"answer":...}`` 原文。

    文末使用 ``kb-sources`` JSON 围栏（含 ``chunk`` / ``page`` / ``offset``），
    与前端 ``splitKbSources`` 约定一致；旧版纯「来源：」编号列表不含片段正文，
    展开会落到「（无片段原文）」。

    Args:
        answer: KB 问答管线最终产出。

    Returns:
        可直接写入助手消息的 Markdown 文本。
    """
    text = (answer.answer or "").strip()
    if not answer.citations:
        return text

    sources: list[dict[str, Any]] = []
    for idx, citation in enumerate(answer.citations, start=1):
        label = (citation.source or "").strip() or f"文档 {citation.document_id or idx}"
        chunk = (citation.chunk or citation.chunk_text or "").strip()
        row: dict[str, Any] = {"source": label, "index": idx}
        if isinstance(citation.score, (int, float)):
            row["score"] = float(citation.score)
        if chunk:
            row["chunk"] = chunk
        if citation.page is not None:
            row["page"] = citation.page
        if citation.offset is not None:
            row["offset"] = citation.offset
        if citation.library_id is not None:
            row["libraryId"] = citation.library_id
        if citation.document_id is not None:
            row["documentId"] = citation.document_id
        if citation.image_id:
            row["imageId"] = citation.image_id
        sources.append(row)

    payload = json.dumps(sources, ensure_ascii=False)
    return f"{text}\n\n```kb-sources\n{payload}\n```"


def _kb_source_row(
    *,
    idx: int,
    label: str,
    chunk: str = "",
    score: float | None = None,
    page: int | None = None,
    offset: int | None = None,
    library_id: int | None = None,
    document_id: int | None = None,
    image_id: str | None = None,
) -> dict[str, Any]:
    """构造 kb-sources 围栏中的单条来源记录。"""
    row: dict[str, Any] = {"source": label, "index": idx}
    if isinstance(score, (int, float)):
        row["score"] = float(score)
    if chunk:
        row["chunk"] = chunk
    if page is not None:
        row["page"] = page
    if offset is not None:
        row["offset"] = offset
    if library_id is not None:
        row["libraryId"] = library_id
    if document_id is not None:
        row["documentId"] = document_id
    if image_id:
        row["imageId"] = image_id
    return row


def _append_kb_sources_fence(text: str, sources: list[dict[str, Any]]) -> str:
    """在正文后附加 ``kb-sources`` JSON 围栏。"""
    if not sources:
        return (text or "").strip()
    payload = json.dumps(sources, ensure_ascii=False)
    base = (text or "").strip()
    return f"{base}\n\n```kb-sources\n{payload}\n```"


def parse_kb_retrieve_tool_output(output: str) -> list[ChunkHit]:
    """把 ``kb_retrieve`` 工具 JSON 输出解析为按编号对齐的命中列表。"""
    try:
        payload = json.loads((output or "").strip())
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, dict):
        return []
    hits_raw = payload.get("hits")
    if not isinstance(hits_raw, list):
        return []
    hits: list[ChunkHit] = []
    for item in hits_raw:
        if not isinstance(item, dict):
            continue
        hits.append(
            ChunkHit(
                library_id=_to_int(item.get("library_id")),
                document_id=_to_int(item.get("document_id")),
                chunk_text=str(item.get("chunk_text") or ""),
                score=item.get("score")
                if isinstance(item.get("score"), (int, float))
                else None,
                doc_title=str(item.get("source") or ""),
                image_id=str(item.get("image_id") or "").strip() or None,
            )
        )
    return hits


def _parse_mis_rag_worker_json(text: str) -> tuple[str, list[int] | None]:
    """解析 mis-rag Worker 的结构化 JSON 输出。"""
    stripped = (text or "").strip()
    if not stripped:
        return "", None
    candidate = stripped
    fence = _FENCE_PATTERN.search(stripped)
    if fence:
        candidate = fence.group(1).strip()
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError:
        return stripped, None
    if not isinstance(payload, dict):
        return stripped, None

    answer = payload.get("answer")
    answer_text = answer.strip() if isinstance(answer, str) and answer.strip() else stripped

    raw_citations = payload.get("citations")
    if not isinstance(raw_citations, list):
        return answer_text, None

    indices: list[int] = []
    for item in raw_citations:
        idx = _to_int(item.get("index") if isinstance(item, dict) else item)
        if idx is not None and idx >= 1 and idx not in indices:
            indices.append(idx)
    return answer_text, indices or None


def format_mis_rag_delegate_answer(worker_text: str, *, retrieve_hits: list[ChunkHit]) -> str:
    """把 Copilot 委派 mis-rag 的结果整理成带 ``kb-sources`` 围栏的 Markdown。

    mis-rag Worker 通常输出 ``{"answer":"...","citations":[{"index":1}]}``；
    引用明细（片段正文 / imageId 等）来自同轮 ``kb_retrieve`` 工具命中。
    """
    if not retrieve_hits:
        return (worker_text or "").strip()

    answer_text, selected = _parse_mis_rag_worker_json(worker_text)
    hit_indices = selected if selected else list(range(1, len(retrieve_hits) + 1))

    selected_hits: list[ChunkHit] = []
    for idx in hit_indices:
        if idx < 1 or idx > len(retrieve_hits):
            continue
        selected_hits.append(retrieve_hits[idx - 1])

    enriched = enrich_hits_with_document_images(selected_hits, retrieve_hits)

    sources: list[dict[str, Any]] = []
    for display_idx, hit in enumerate(enriched, start=1):
        # 保留模型引用编号：前缀 selected 段用原始 index；追加配图行顺延
        if display_idx <= len(selected_hits):
            raw_idx = hit_indices[display_idx - 1]
        else:
            raw_idx = display_idx
        label = hit.source_label()
        sources.append(
            _kb_source_row(
                idx=raw_idx,
                label=label,
                chunk=(hit.chunk_text or "").strip(),
                score=hit.score,
                page=hit.page,
                offset=hit.offset,
                library_id=hit.library_id,
                document_id=hit.document_id,
                image_id=hit.image_id,
            )
        )
    return _append_kb_sources_fence(answer_text, sources)


def extract_kb_sources_fence(text: str) -> str:
    """从完整 Markdown 中提取 ``kb-sources`` 围栏（含围栏本身）。"""
    match = re.search(r"```kb-sources\s*\n[\s\S]*?\n```", text or "", re.IGNORECASE)
    return match.group(0) if match else ""


PENDING_KB_SOURCES_FENCE_KEY = "pending_kb_sources_fence"


@dataclass
class KbQaRequest:
    """一次 KB 问答的输入参数（已从 content/metadata 归一）。"""

    question: str = ""
    library_ids: list[int] = field(default_factory=list)
    top_k: int = 5
    threshold: float | None = None
    kb: str = ""
    page_context: dict[str, Any] = field(default_factory=dict)
    session_id: int | None = None

    @classmethod
    def from_message(
        cls,
        content: str,
        metadata: dict[str, Any] | None = None,
        *,
        default_top_k: int = 5,
    ) -> KbQaRequest:
        """从 Agent 消息体解析问答参数。

        优先读取 BFF 注入的结构化 metadata（``question`` / ``library_ids`` /
        ``top_k`` / ``kb``）；缺失时回退解析 ``buildRagContent`` 生成的文本
        （``问题：`` / ``知识库：`` / ``召回条数：`` 行），保证与旧版 BFF 兼容。

        Args:
            content: Agent 消息正文。
            metadata: BFF 透传元数据。
            default_top_k: metadata/文本均未指定时的默认召回条数。

        Returns:
            归一后的 :class:`KbQaRequest`；``question`` 兜底为 content 全文。
        """
        meta = metadata or {}
        text = content or ""

        question = _clean(meta.get("question")) or _extract_line(text, _QUESTION_PREFIX)
        if not question:
            # 末位兜底：整段 content 作为问题，确保管线永不因解析失败而空转
            question = text.strip()

        library_ids = _to_int_list(meta.get("library_ids") or meta.get("libraryIds"))

        top_k = _to_int(meta.get("top_k") or meta.get("topK"))
        if top_k is None:
            top_k = _to_int(_extract_line(text, _TOPK_PREFIX))
        if top_k is None or top_k <= 0:
            top_k = default_top_k

        threshold = _to_float(meta.get("threshold"))
        kb = _clean(meta.get("kb")) or _extract_line(text, _KB_PREFIX)

        raw_page_ctx = meta.get("page_context")
        page_context = raw_page_ctx if isinstance(raw_page_ctx, dict) else {}

        return cls(
            question=question,
            library_ids=library_ids,
            top_k=top_k,
            threshold=threshold,
            kb=kb,
            page_context=page_context,
            session_id=_to_int(meta.get("session_id") or meta.get("sessionId")),
        )


@dataclass
class QaDelta:
    """流式问答的一帧输出（F-01）。

    由 :meth:`KbQaPipeline.run_stream` 产出，调用方（``mis_capability``）按
    ``event`` 名转成 SSE 帧。三种事件的 payload 约定（设计 §7）：

    - ``delta`` → ``{"text": "..."}``：答案文本增量，可能出现多次。
    - ``done``  → ``{"sessionId","messageId","citations","finishReason"}``：终帧，仅一次。
    - ``error`` → ``{"code","message"}``：致命错误（检索失败），流就此结束。
    """

    event: str = EVENT_DELTA
    text: str = ""
    session_id: int | None = None
    message_id: int | None = None
    citations: list[QaCitation] = field(default_factory=list)
    finish_reason: str = ""
    code: int | None = None
    message: str = ""

    @classmethod
    def delta(cls, text: str) -> QaDelta:
        """构造一帧文本增量。"""
        return cls(event=EVENT_DELTA, text=text)

    @classmethod
    def done(
        cls,
        *,
        session_id: int | None,
        message_id: int | None,
        citations: list[QaCitation],
        finish_reason: str = "stop",
    ) -> QaDelta:
        """构造终帧（携带落库 ID 与结构化引用）。"""
        return cls(
            event=EVENT_DONE,
            session_id=session_id,
            message_id=message_id,
            citations=list(citations),
            finish_reason=finish_reason,
        )

    @classmethod
    def error(cls, message: str, *, code: int = 9000) -> QaDelta:
        """构造错误帧。"""
        return cls(event=EVENT_ERROR, code=code, message=message)

    def to_payload(self) -> dict[str, Any]:
        """转为 SSE ``data`` 的 JSON 字典（camelCase，前端直接消费）。

        ``delta`` 帧同时给出 ``text`` 与 ``delta`` 两个同值键：前者是设计 §7 的
        新契约，后者兼容既有 ``ai-sse-client.ts`` 的 ``frame.delta`` 解析路径，
        避免前端改造未同步时增量丢失。
        """
        if self.event == EVENT_DELTA:
            return {"text": self.text, "delta": self.text}
        if self.event == EVENT_DONE:
            return {
                "sessionId": self.session_id,
                "messageId": self.message_id,
                "citations": [c.to_api() for c in self.citations],
                "finishReason": self.finish_reason or "stop",
            }
        return {"code": self.code, "message": self.message}


async def retrieve_kb_chunks(
    kb: "KbClient",
    ctx: "KbCallContext",
    *,
    question: str,
    library_ids: list[int] | None = None,
    top_k: int = 5,
    threshold: float | None = None,
    acc: dict[str, int] | None = None,
) -> "RetrieveHits":
    """检索知识库片段：可见库为空时先解析用户可见库再检索（DRY 检索库）。

    T4/TOOL：``kb_retrieve`` 原生工具直接复用本函数，避免重复 resolve-visible →
    retrieve 逻辑。与 :meth:`KbQaPipeline._retrieve` 行为一致，最终打到 mis-kb
    RAGFlow 的 ``POST /internal/v1/kb/rag/retrieve``。

    Args:
        kb: ``KbClient`` 实例（由调用方持有与关闭）。
        ctx: 身份与追踪上下文；``user_id`` 用于判定可见库范围。
        question: 用户问题原文（**禁止改写**，由调用方保证）。
        library_ids: 限定的库 ID；``None``/空表示全部可见库。
        top_k: 召回条数。
        threshold: 相关性阈值（0~1）。
        acc: 子阶段细分计时的共享字典（由 ``QA_SUB_STAGES_CV`` 传入）；``None``
            表示本调用不参与细分埋点（如 ``kb_retrieve`` 工具直调）。

    Returns:
        :class:`RetrieveHits`；无可见库或 NoopAdapter 时为空集合。
    """
    resolved: list[int] = list(library_ids or [])
    if not resolved:
        t = perf_counter()
        visible = await kb.resolve_visible_libraries(ctx)
        if acc is not None:
            # ① 可见库解析：1 次 mis-kb HTTP 往返（仅当未显式指定库时触发）
            acc["resolve_visible_libraries_ms"] = max(
                0, int((perf_counter() - t) * 1000)
            )
        if visible.is_empty():
            logger.info(
                "KB retrieve: no visible library for user",
                user_id=ctx.user_id,
                trace_id=ctx.trace_id,
            )
            return RetrieveHits()
        resolved = visible.library_ids

    t = perf_counter()
    hits = await kb.retrieve(
        ctx, question=question, library_ids=resolved, top_k=top_k, threshold=threshold
    )
    if acc is not None:
        # ② 向量检索：RAGFlow 召回 chunk（1 次 mis-kb HTTP 往返）
        acc["RAGFlow_retrieve_ms"] = max(0, int((perf_counter() - t) * 1000))
    return hits


class KbQaPipeline:
    """KB 问答编排管线。

    典型用法::

        pipeline = KbQaPipeline()
        try:
            answer = await pipeline.run(req, ctx, generate=my_generate)
        finally:
            await pipeline.aclose()
    """

    def __init__(
        self,
        kb_client: KbClient | None = None,
        *,
        snippet_limit: int | None = None,
        max_context_chars: int | None = None,
    ) -> None:
        """初始化管线。

        Args:
            kb_client: 注入的 KB 客户端（便于测试）；缺省自建一个。
            snippet_limit: 单条引用 ``chunk`` 摘要的最大字符数。
            max_context_chars: 注入提示词的检索上下文总字符上限，防止爆 token。
        """
        settings = get_settings()
        self._kb: KbClient = kb_client or KbClient()
        self._owns_client: bool = kb_client is None
        self._snippet_limit: int = (
            snippet_limit if snippet_limit is not None else settings.MIS_KB_SNIPPET_LIMIT
        )
        self._max_context_chars: int = (
            max_context_chars
            if max_context_chars is not None
            else settings.MIS_KB_MAX_CONTEXT_CHARS
        )
        # 本轮细分数组（4 段 + overhead）；``None`` 表示未开启采集或本调用不需采集。
        self._sub_stages: dict[str, int] | None = None

    # ---- 子阶段细分埋点（P0-2）----
    # 4 段口径（PRD §4.2）：resolve_visible_libraries / RAGFlow_retrieve /
    # worker_generate / persist；overhead 为差值吸收项（_build_prompt CPU 拼接等）。

    def _begin_sub_stages(self) -> dict[str, int] | None:
        """开启本轮子阶段采集，返回共享字典（或 ``None`` 表示降级不采集）。

        优先复用 ``QA_SUB_STAGES_CV`` 中父任务（``InvokeAgentTool._spawn_worker``）
        已 set 的共享 dict，使 worker 内部 qa_pipeline 的变异对父任务可见；否则建
        本地 dict 挂在本实例上（供 BFF 路由 ``mis_capability`` 回读）。

        采集开关 ``SUBSTAGE_INSTRUMENTATION_ENABLED``（默认开）关闭时整体跳过。
        """
        if not substage_instrumentation_enabled(get_settings()):
            self._sub_stages = None
            return None
        acc = QA_SUB_STAGES_CV.get()
        if acc is None:
            acc = {}
        self._sub_stages = acc
        return acc

    def _finalize_sub_stages(self, acc: dict[str, int], t_total: float) -> None:
        """收口：用整段耗时 - 已知三段求 ``overhead_ms``（差值吸收项）。"""
        try:
            total_ms = max(0, int((perf_counter() - t_total) * 1000))
            known = (
                "resolve_visible_libraries_ms",
                "RAGFlow_retrieve_ms",
                "worker_generate_ms",
                "persist_ms",
            )
            parts = sum(int(acc.get(k, 0) or 0) for k in known)
            overhead = total_ms - parts
            acc["overhead_ms"] = max(0, overhead)
        except Exception:  # noqa: BLE001 - 降级红线：任何异常静默
            pass

    @property
    def sub_stages(self) -> dict[str, int] | None:
        """本轮子阶段细分（4 段 + overhead）；未采集为 ``None``。"""
        return self._sub_stages

    async def aclose(self) -> None:
        """关闭自建的 KB 客户端（外部注入的客户端由调用方负责）。"""
        if self._owns_client:
            await self._kb.aclose()

    async def run(
        self,
        req: KbQaRequest,
        ctx: KbCallContext,
        generate: Callable[[str], Awaitable[str]],
        *,
        structured: bool = True,
    ) -> QaAnswer:
        """执行完整 KB 问答链路。

        Args:
            req: 归一后的问答请求。
            ctx: 身份与追踪上下文。
            generate: 生成回调，入参为增强后的提示词，返回 LLM 原始文本。
            structured: ``True``（BFF ``/ai/rag``）要求模型输出 JSON 信封；
                ``False``（运营台本地对话）直出自然语言，避免把 JSON 原文展示给运营。

        Returns:
            :class:`QaAnswer`；检索为空或落库失败时仍返回可用答案（降级不报错）。

        Raises:
            KbClientError: 仅当**检索阶段**彻底失败且无法降级时向上抛出。
        """
        acc = self._begin_sub_stages()
        t_total = perf_counter()
        try:
            hits = await self._retrieve(req, ctx, acc=acc)
            prompt = self._build_prompt(req, hits, structured=structured)

            # ③ worker_generate：拼 prompt 后调 LLM 生成答案（包裹注入的 generate 回调）
            if acc is not None:
                gen_start = perf_counter()
                raw = await generate(prompt)
                acc["worker_generate_ms"] = max(0, int((perf_counter() - gen_start) * 1000))
            else:
                raw = await generate(prompt)

            if structured:
                answer_text, selected = self._parse_generation(raw)
            else:
                answer_text = (raw or "").strip()
                selected = self._parse_inline_citations(answer_text)

            used_hits = enrich_hits_with_document_images(
                self._select_hits(hits.hits, selected),
                hits.hits,
            )

            # ④ persist：回调 mis-kb 落库（create_session + append_message×2 + save_citations）
            if acc is not None:
                persist_start = perf_counter()
                session_id, message_id = await self._persist(req, ctx, answer_text, used_hits)
                acc["persist_ms"] = max(0, int((perf_counter() - persist_start) * 1000))
            else:
                session_id, message_id = await self._persist(req, ctx, answer_text, used_hits)

            citations = [
                QaCitation.from_hit(hit, message_id=message_id, snippet_limit=self._snippet_limit)
                for hit in used_hits
            ]
            return QaAnswer(
                answer=answer_text,
                citations=citations,
                session_id=session_id,
                message_id=message_id,
            )
        finally:
            if acc is not None:
                self._finalize_sub_stages(acc, t_total)

    async def run_stream(
        self,
        req: KbQaRequest,
        ctx: KbCallContext,
        generate_stream: Callable[[str], AsyncIterator[str]],
        *,
        finish_reason: str = "stop",
    ) -> AsyncIterator[QaDelta]:
        """执行流式 KB 问答链路（F-01），逐帧产出 :class:`QaDelta`。

        与 :meth:`run` 的三点差异：

        1. **提示词非结构化**：流式下模型直出自然语言（``structured=False``），
           否则用户会看到 ``{"answer":...`` 的 JSON 原文逐字刷屏。引用改由
           答案正文里的行内角标 ``[n]`` 反解（见 :meth:`_parse_inline_citations`）。
        2. **落库时机**：按设计 §7-Q1 决策——**流结束后一次性落库**，
           复用 P0 的 :meth:`_persist`，不做边流边落。
        3. **降级**：检索阶段异常产出一帧 ``error`` 后结束；落库失败沿用
           ``_persist`` 的静默降级（``sessionId``/``messageId`` 为空但答案已送达）。

        Args:
            req: 归一后的问答请求。
            ctx: 身份与追踪上下文。
            generate_stream: 生成回调，入参为增强提示词，异步产出文本增量。
            finish_reason: 终帧的结束原因，默认 ``stop``。

        Yields:
            :class:`QaDelta`：0..n 帧 ``delta``，随后恰好一帧 ``done`` 或 ``error``。
        """
        acc = self._begin_sub_stages()
        t_total = perf_counter()
        try:
            try:
                hits = await self._retrieve(req, ctx, acc=acc)
            except KbClientError as exc:
                logger.warning(
                    "KB QA stream retrieve failed",
                    error=str(exc),
                    trace_id=ctx.trace_id,
                )
                yield QaDelta.error(str(exc))
                return

            prompt = self._build_prompt(req, hits, structured=False)

            parts: list[str] = []
            # ③ worker_generate：流式整段前后计时（含首字延迟，PRD §4 Q4 裁定）
            if acc is not None:
                gen_start = perf_counter()
                async for piece in generate_stream(prompt):
                    if not piece:
                        continue
                    parts.append(piece)
                    yield QaDelta.delta(piece)
                acc["worker_generate_ms"] = max(0, int((perf_counter() - gen_start) * 1000))
            else:
                async for piece in generate_stream(prompt):
                    if not piece:
                        continue
                    parts.append(piece)
                    yield QaDelta.delta(piece)

            answer_text = "".join(parts).strip()
            selected = self._parse_inline_citations(answer_text)
            used_hits = enrich_hits_with_document_images(
                self._select_hits(hits.hits, selected),
                hits.hits,
            )

            # ④ persist：流结束后一次性落库
            if acc is not None:
                persist_start = perf_counter()
                session_id, message_id = await self._persist(req, ctx, answer_text, used_hits)
                acc["persist_ms"] = max(0, int((perf_counter() - persist_start) * 1000))
            else:
                session_id, message_id = await self._persist(req, ctx, answer_text, used_hits)

            citations = [
                QaCitation.from_hit(hit, message_id=message_id, snippet_limit=self._snippet_limit)
                for hit in used_hits
            ]
            logger.info(
                "KB QA stream completed",
                kb_session_id=session_id,
                citation_count=len(citations),
                answer_chars=len(answer_text),
                trace_id=ctx.trace_id,
            )
            yield QaDelta.done(
                session_id=session_id,
                message_id=message_id,
                citations=citations,
                finish_reason=finish_reason,
            )
        finally:
            if acc is not None:
                self._finalize_sub_stages(acc, t_total)

    # ============================================================ 阶段 1：检索

    async def _retrieve(
        self, req: KbQaRequest, ctx: KbCallContext, acc: dict[str, int] | None = None
    ) -> RetrieveHits:
        """解析可见库并检索；可见库为空时直接返回空命中，不再打检索请求。

        复用模块级 :func:`retrieve_kb_chunks`（T4/TOOL 同样复用，DRY）。
        ``acc`` 非 ``None`` 时由 ``retrieve_kb_chunks`` 顺带回填前两子阶段。
        """
        return await retrieve_kb_chunks(
            self._kb,
            ctx,
            question=req.question,
            library_ids=req.library_ids,
            top_k=req.top_k,
            threshold=req.threshold,
            acc=acc,
        )

    # ============================================================ 阶段 2：提示词

    def _build_prompt(
        self,
        req: KbQaRequest,
        hits: RetrieveHits,
        *,
        structured: bool = True,
    ) -> str:
        """把检索片段编号注入提示词，要求模型按编号回引。

        编号从 1 开始，与 ``citations[].index`` 一一对应；总长度受
        ``max_context_chars`` 限制，超限后停止追加并标注截断。

        Args:
            req: 归一后的问答请求。
            hits: 检索命中集合。
            structured: ``True``（非流式）要求模型输出 JSON 信封；
                ``False``（流式 F-01）要求直出自然语言并用行内 ``[n]`` 标注引用，
                保证 SSE 增量可直接渲染给用户。
        """
        lines: list[str] = ["## 检索到的知识库片段"]
        if hits.is_empty():
            lines.append("（无检索结果：当前用户可见知识库中未命中任何相关片段）")
        else:
            used = 0
            appended = 0
            for idx, hit in enumerate(hits.hits, start=1):
                text = (hit.chunk_text or "").strip()
                if not text:
                    continue
                score_part = f"，score={hit.score:.4f}" if hit.score is not None else ""
                block = f"[{idx}] 来源：{hit.source_label()}{score_part}\n{text}"
                if used + len(block) > self._max_context_chars and appended > 0:
                    lines.append(f"（其余 {len(hits.hits) - idx + 1} 条片段因长度限制已省略）")
                    break
                lines.append(block)
                used += len(block)
                appended += 1
            if appended == 0:
                lines.append("（无检索结果：命中片段正文为空）")

        lines.append("")
        lines.append("## 用户问题")
        lines.append(req.question or "（空问题）")

        if req.page_context:
            lines.append("")
            lines.append("## 页面上下文")
            lines.append(json.dumps(req.page_context, ensure_ascii=False))

        lines.append("")
        if structured:
            lines.append(
                "## 输出要求\n"
                "只输出一个 JSON 对象（不要 Markdown 围栏）：\n"
                '{"answer":"回答文本","citations":[{"index":1}]}\n'
                "- `answer` 必须**严格基于上述片段**；片段不足以回答时如实说明，不得编造。\n"
                "- `citations[].index` 为你实际引用的片段编号；未引用任何片段时为空数组 []。"
            )
        else:
            lines.append(
                "## 输出要求\n"
                "直接输出面向用户的自然语言回答，**不要**输出 JSON、不要加代码围栏。\n"
                "- 回答必须**严格基于上述片段**；片段不足以回答时如实说明，不得编造。\n"
                "- 每处引用请在句末标注片段编号角标，形如 `[1]`、`[2]`；未引用任何片段时不标注。"
            )
        return "\n".join(lines)

    # ============================================================ 阶段 3：解析

    def _parse_generation(self, raw: str) -> tuple[str, list[int] | None]:
        """解析 LLM 输出，提取答案文本与引用编号。

        Args:
            raw: LLM 原始输出（可能裹 ```json 围栏或夹带噪声）。

        Returns:
            ``(answer_text, selected_indices)``；``selected_indices`` 为 ``None``
            表示模型未给出可用编号，由调用方决定是否回退为「全部命中」。
        """
        text = (raw or "").strip()
        if not text:
            return "", None

        payload = self._load_json(text)
        if payload is None:
            # 非 JSON 输出：整段作为答案，引用回退
            return text, None

        answer = payload.get("answer")
        answer_text = answer.strip() if isinstance(answer, str) else text

        raw_citations = payload.get("citations")
        if not isinstance(raw_citations, list):
            return answer_text, None

        indices: list[int] = []
        for item in raw_citations:
            idx: int | None = None
            if isinstance(item, dict):
                idx = _to_int(item.get("index"))
            else:
                idx = _to_int(item)
            if idx is not None and idx >= 1 and idx not in indices:
                indices.append(idx)
        return answer_text, indices

    @staticmethod
    def _parse_inline_citations(text: str) -> list[int] | None:
        """从流式答案正文中反解行内引用角标 ``[n]``（F-01）。

        流式模式下模型直出自然语言，没有 JSON ``citations`` 字段可读，
        改以角标为引用信号。

        Args:
            text: 拼接完成的答案全文。

        Returns:
            去重且保持出现顺序的编号列表；未发现任何角标时返回 ``None``，
            由 :meth:`_select_hits` 回退为「全部命中」，保证有检索结果就有溯源。
        """
        if not text:
            return None
        indices: list[int] = []
        for match in _INLINE_CITE_PATTERN.finditer(text):
            idx = _to_int(match.group(1))
            if idx is not None and idx >= 1 and idx not in indices:
                indices.append(idx)
        return indices or None

    @staticmethod
    def _load_json(text: str) -> dict[str, Any] | None:
        """剥离代码围栏 / 噪声后解析 JSON 对象；失败返回 ``None``。"""
        candidate = text
        match = _FENCE_PATTERN.search(candidate)
        if match:
            candidate = match.group(1).strip()
        if not candidate.startswith("{"):
            start = candidate.find("{")
            end = candidate.rfind("}")
            if start < 0 or end <= start:
                return None
            candidate = candidate[start : end + 1]
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            return None
        return parsed if isinstance(parsed, dict) else None

    def _select_hits(
        self,
        hits: list[ChunkHit],
        selected: list[int] | None,
    ) -> list[ChunkHit]:
        """按模型给出的编号挑选引用片段。

        编号越界会被忽略；模型未给编号（``None``）时回退为全部命中，
        保证「有检索结果就有可溯源引用」。模型显式返回空数组则尊重其判断。
        """
        if not hits:
            return []
        if selected is None:
            return list(hits)
        picked: list[ChunkHit] = []
        for idx in selected:
            if 1 <= idx <= len(hits):
                picked.append(hits[idx - 1])
        return picked

    # ============================================================ 阶段 4：落库

    async def _persist(
        self,
        req: KbQaRequest,
        ctx: KbCallContext,
        answer_text: str,
        used_hits: list[ChunkHit],
    ) -> tuple[int | None, int | None]:
        """回调 mis-kb 落库 session / message / citation。

        全流程异常安全：任一步失败仅记录告警并返回已取得的 ID，绝不影响答案返回。

        **不回显未经校验的外部 ID**：续聊场景下 ``req.session_id`` 来自用户可控输入，
        其归属由 mis-kb 在 ``append_message`` 时裁定（越权返回 ``KB_SESSION_NOT_FOUND``）。
        若写入被拒，本方法必须把 ``session_id`` 置回 ``None``——否则会把攻击者传入的
        他人 sessionId 原样回传，导致前端 ``activeSessionId`` 被设成无效 ID，
        后续 getSessionDetail / submitFeedback 连环失败，且用户对「本轮未落库」无感。
        （这本身不构成越权：mis-kb 侧写入与后续读取都已拒绝。）

        Returns:
            ``(session_id, message_id)``；未能落库时对应位为 ``None``。
        """
        session_id: int | None = req.session_id
        message_id: int | None = None
        # 新建会话的 id 由 mis-kb 返回，天然可信；续聊时沿用外部传入的 id，
        # 直到某次 append_message 成功返回，才算通过了 mis-kb 的归属校验。
        session_verified: bool = req.session_id is None
        try:
            if session_id is None:
                session_id = await self._kb.create_session(
                    ctx, title=_session_title(req.question)
                )
                session_verified = True
            if session_id is None:
                return None, None

            await self._kb.append_message(
                ctx, session_id=session_id, role="user", content=req.question
            )
            # mis-kb 已接受这次写入 ⇒ 会话存在且归属当前用户
            session_verified = True
            message_id = await self._kb.append_message(
                ctx, session_id=session_id, role="assistant", content=answer_text
            )
            if message_id is not None and used_hits:
                await self._kb.save_citations(
                    ctx,
                    message_id=message_id,
                    citations=[CitationItem.from_hit(h) for h in used_hits],
                )
        except KbClientError as exc:
            logger.warning(
                "KB QA persist failed (answer still returned)",
                error=str(exc),
                session_id=session_id,
                session_verified=session_verified,
                trace_id=ctx.trace_id,
            )
            if not session_verified:
                # 归属校验未通过（典型：越权续聊被 KB_SESSION_NOT_FOUND 拒绝）——
                # 丢弃未经校验的外部 ID，让前端按「本轮未落库」处理
                session_id = None
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "KB QA persist unexpected error (answer still returned)",
                error=str(exc),
                session_id=session_id,
                session_verified=session_verified,
                trace_id=ctx.trace_id,
            )
            if not session_verified:
                # 同上：未确认归属的外部 ID 一律不回显
                session_id = None
        return session_id, message_id


# ==================================================================== 私有工具


def _clean(value: Any) -> str:
    """把任意值规约为去空白的字符串；``None`` 归一为空串。"""
    if value is None:
        return ""
    return str(value).strip()


def _extract_line(text: str, prefix: str) -> str:
    """从多行文本中抓取以 ``prefix`` 开头那一行的值（兜底解析）。"""
    if not text:
        return ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            return stripped[len(prefix) :].strip()
    return ""


def _to_int(value: Any) -> int | None:
    """尽力转 int；失败返回 ``None``。"""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    """尽力转 float；失败返回 ``None``。"""
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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
    parsed = [_to_int(item) for item in items]
    return [i for i in parsed if i is not None]
