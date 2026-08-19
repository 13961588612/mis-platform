"""KB 检索 / 问答落库的统一 Pydantic 模型（mis-kb 契约镜像）。

本模块是 ``mis-kb``（Java）内部端点契约在 Python 侧的镜像，供
:mod:`src.adapters.kb_client` 与 :mod:`src.agent.mis_rag.qa_pipeline` 复用。

契约对齐（源自 ``com.mis.kb.api.dto``）：
- ``ChunkHitVO``            → :class:`ChunkHit`
- ``RetrieveHitsVO``        → :class:`RetrieveHits`
- ``ResolveVisibleResponse``→ :class:`VisibleLibraries`
- ``QaCitationItem``        → :class:`CitationItem`

命名约定：Python 侧统一 snake_case；与 Java 交互时经 ``from_api`` /
``to_api`` 在边界做 camelCase 转换，避免 alias 泄漏到业务代码。

安全约束：所有模型只承载 **MIS 业务 ID**（``library_id`` / ``document_id``），
绝不携带引擎原生 ID（``engine_library_ref`` / ``engine_document_ref``），
后者仅在 mis-kb 服务端内部使用。
"""

from __future__ import annotations
from typing import Any

from pydantic import BaseModel, Field


def _as_int(value: Any) -> int | None:
    """尽力将任意输入转为 int；失败返回 ``None``（不抛异常）。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    """尽力将任意输入转为 float；失败返回 ``None``（不抛异常）。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_str(value: Any) -> str:
    """将任意输入规约为字符串；``None`` 归一为空串。"""
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


class ChunkHit(BaseModel):
    """单条检索命中片段（对齐 Java ``ChunkHitVO``）。"""

    library_id: int | None = Field(default=None, description="MIS 知识库 ID")
    document_id: int | None = Field(default=None, description="MIS 文档 ID")
    chunk_text: str = Field(default="", description="命中片段正文")
    score: float | None = Field(default=None, description="相关性打分（0~1）")
    doc_title: str = Field(default="", description="文档标题，用于展示来源名")
    offset: int | None = Field(default=None, description="片段在原文中的字符偏移（F-04，可空）")
    page: int | None = Field(default=None, description="片段所在页码，1 起（F-04，可空）")
    image_id: str | None = Field(default=None, description="分片关联图片 id（引擎 image_id，可空）")

    @classmethod
    def from_api(cls, raw: dict[str, Any] | None) -> ChunkHit:
        """从 mis-kb 返回的 camelCase 字典构造。

        F-04：``offset`` / ``page`` 为溯源定位信息，RAGFlow 未返回时为 ``None``，
        不影响其余字段解析。

        Args:
            raw: ``ChunkHitVO`` 的 JSON 字典；``None`` 返回空实例。

        Returns:
            解析后的 :class:`ChunkHit`；字段缺失时使用默认值。
        """
        if not isinstance(raw, dict):
            return cls()
        return cls(
            library_id=_as_int(raw.get("libraryId")),
            document_id=_as_int(raw.get("documentId")),
            chunk_text=_as_str(raw.get("chunkText")),
            score=_as_float(raw.get("score")),
            doc_title=_as_str(raw.get("docTitle")),
            offset=_as_int(raw.get("offset")),
            page=_as_int(raw.get("page")),
            image_id=_as_str(raw.get("imageId")) or None,
        )

    def source_label(self) -> str:
        """返回用于提示词/引用展示的来源名。

        优先使用文档标题；缺失时退化为 ``doc#<documentId>``，再退化为 ``未知来源``。
        """
        if self.doc_title:
            return self.doc_title
        if self.document_id is not None:
            return f"doc#{self.document_id}"
        return "未知来源"


class RetrieveHits(BaseModel):
    """检索结果集合（对齐 Java ``RetrieveHitsVO``）。"""

    hits: list[ChunkHit] = Field(default_factory=list, description="命中片段列表")

    @classmethod
    def from_api(cls, raw: dict[str, Any] | None) -> RetrieveHits:
        """从 mis-kb 返回的 ``{"hits":[...]}`` 字典构造；无命中返回空集合。"""
        if not isinstance(raw, dict):
            return cls()
        items = raw.get("hits")
        if not isinstance(items, list):
            return cls()
        return cls(hits=[ChunkHit.from_api(item) for item in items])

    def is_empty(self) -> bool:
        """是否无任何命中（NoopAdapter / 无可见库时为 True）。"""
        return len(self.hits) == 0


class VisibleLibraries(BaseModel):
    """用户可见知识库 ID 列表（对齐 Java ``ResolveVisibleResponse``）。"""

    library_ids: list[int] = Field(default_factory=list, description="可见知识库 ID")

    @classmethod
    def from_api(cls, raw: dict[str, Any] | None) -> VisibleLibraries:
        """从 mis-kb 返回的 ``{"libraryIds":[...]}`` 字典构造。"""
        if not isinstance(raw, dict):
            return cls()
        items = raw.get("libraryIds")
        if not isinstance(items, list):
            return cls()
        parsed = [_as_int(item) for item in items]
        return cls(library_ids=[i for i in parsed if i is not None])

    def is_empty(self) -> bool:
        """用户是否无任何可见知识库。"""
        return len(self.library_ids) == 0


class CitationItem(BaseModel):
    """待落库的引用项（对齐 Java ``QaCitationItem``）。"""

    library_id: int | None = Field(default=None, description="MIS 知识库 ID")
    document_id: int | None = Field(default=None, description="MIS 文档 ID")
    chunk_text: str = Field(default="", description="引用片段正文")
    score: float | None = Field(default=None, description="相关性打分（0~1）")
    offset: int | None = Field(default=None, description="片段字符偏移（F-04，可空）")
    page: int | None = Field(default=None, description="片段页码（F-04，可空）")
    source: str = Field(default="", description="来源名（文档标题，F-04）")
    image_id: str | None = Field(default=None, description="分片关联图片 id（引擎 image_id，可空）")

    @classmethod
    def from_hit(cls, hit: ChunkHit) -> CitationItem:
        """由检索命中片段直接构造引用项（含 F-04 定位字段）。"""
        return cls(
            library_id=hit.library_id,
            document_id=hit.document_id,
            chunk_text=hit.chunk_text,
            score=hit.score,
            offset=hit.offset,
            page=hit.page,
            source=hit.source_label(),
            image_id=hit.image_id,
        )

    def to_api(self) -> dict[str, Any]:
        """转为 mis-kb ``QaCitationItem`` 期望的 camelCase 请求体。

        ``offset`` / ``page`` / ``source`` 对齐 Java ``QaCitationItem``（F-04）；
        为 ``None`` 时 mis-kb 侧按可空列落库，不阻断写入。
        """
        return {
            "libraryId": self.library_id,
            "documentId": self.document_id,
            "chunkText": self.chunk_text,
            "score": self.score,
            "offset": self.offset,
            "page": self.page,
            "source": self.source or None,
        }

    def is_persistable(self) -> bool:
        """是否满足 mis-kb 落库校验（``libraryId``/``documentId`` 均非空）。"""
        return self.library_id is not None and self.document_id is not None


class QaCitation(BaseModel):
    """返回给前端的引用（兼容旧 ``source/chunk/score`` + 新 KB 业务字段）。

    与 ``mis-admin-bff`` 的 ``AiRagCitation`` 及前端 ``KbQaCitation`` 对齐：
    - 旧字段 ``source`` / ``chunk`` / ``score``：保持 ai-copilot 通道向后兼容
    - 新字段 ``id`` / ``libraryId`` / ``documentId`` / ``chunkText`` / ``messageId``：KB 溯源
    """

    id: int | None = Field(default=None, description="落库后的引用主键")
    library_id: int | None = Field(default=None, description="MIS 知识库 ID")
    document_id: int | None = Field(default=None, description="MIS 文档 ID")
    chunk_text: str = Field(default="", description="引用片段正文")
    score: float | None = Field(default=None, description="相关性打分（0~1）")
    source: str = Field(default="", description="来源名（文档标题）")
    chunk: str = Field(default="", description="片段摘要（截断后的正文）")
    message_id: int | None = Field(default=None, description="所属助手消息 ID")
    offset: int | None = Field(default=None, description="片段字符偏移（F-04，可空）")
    page: int | None = Field(default=None, description="片段页码（F-04，可空）")
    image_id: str | None = Field(default=None, description="分片关联图片 id（引擎 image_id，可空）")

    @classmethod
    def from_hit(
        cls,
        hit: ChunkHit,
        *,
        message_id: int | None = None,
        snippet_limit: int = 200,
    ) -> QaCitation:
        """由检索命中片段构造前端引用。

        Args:
            hit: 检索命中片段。
            message_id: 已落库的助手消息 ID（未落库时为 ``None``）。
            snippet_limit: ``chunk`` 摘要最大字符数，超出以省略号截断。

        Returns:
            可直接序列化返回给 BFF 的 :class:`QaCitation`。
        """
        text = hit.chunk_text or ""
        snippet = text if len(text) <= snippet_limit else f"{text[:snippet_limit]}…"
        return cls(
            library_id=hit.library_id,
            document_id=hit.document_id,
            chunk_text=text,
            score=hit.score,
            source=hit.source_label(),
            chunk=snippet,
            message_id=message_id,
            offset=hit.offset,
            page=hit.page,
            image_id=hit.image_id,
        )

    def to_api(self) -> dict[str, Any]:
        """转为 BFF ``AiRagCitation`` 期望的 camelCase JSON（含 F-04 定位字段）。"""
        return {
            "id": self.id,
            "libraryId": self.library_id,
            "documentId": self.document_id,
            "chunkText": self.chunk_text,
            "score": self.score,
            "source": self.source,
            "chunk": self.chunk,
            "messageId": self.message_id,
            "offset": self.offset,
            "page": self.page,
            "imageId": self.image_id,
        }


class QaAnswer(BaseModel):
    """KB 问答管线的最终产出（序列化后作为 Agent ``response`` 文本回传 BFF）。"""

    answer: str = Field(default="", description="回答正文")
    citations: list[QaCitation] = Field(default_factory=list, description="结构化引用")
    session_id: int | None = Field(default=None, description="mis-kb 问答会话 ID")
    message_id: int | None = Field(default=None, description="mis-kb 助手消息 ID")

    def to_api(self) -> dict[str, Any]:
        """转为 BFF ``parseRag`` 可解析的 camelCase JSON 字典。

        ``sessionId`` 使用 mis-kb 的业务会话 ID（数值），前端据此拉取会话详情、
        提交反馈；平台自身的会话 UUID 由外层 ``data.session_id`` 另行返回。
        """
        return {
            "answer": self.answer,
            "citations": [c.to_api() for c in self.citations],
            "sessionId": self.session_id,
            "messageId": self.message_id,
        }
