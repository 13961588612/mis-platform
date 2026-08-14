"""
VectorIndexer — 构建和维护 Skills 的 Qdrant 向量索引。

使用本地 Embedding 服务（bge-small-zh-v1.5）生成向量，
并 upsert 到 ``skills_index`` Qdrant 集合中。

Embedding 不可用时快速跳过（探测一次），避免每个 Skill 卡 30s 拖垮启动。
"""

from __future__ import annotations

import uuid
from typing import Any, TYPE_CHECKING

import httpx
import structlog
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qdrant_models

from src.config import get_settings

if TYPE_CHECKING:
    from qdrant_client.http.models import PointStruct

    from src.skills.models import Skill

logger = structlog.get_logger(__name__)

# Qdrant point id 仅接受 unsigned int / UUID；skill_id 如 member.profile 不可直接作 id。
# 用固定命名空间做 uuid5，保证同 skill_id 的 upsert/delete 幂等。
def skill_point_id(skill_id: str) -> str:
    """将 skill_id 映射为 Qdrant 合法的确定性 UUID 字符串。"""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"mis:skill:{skill_id}"))


class VectorIndexer:
    """管理 Skills 的 Qdrant 向量索引。"""

    def __init__(
        self,
        qdrant_client: AsyncQdrantClient | None = None,
        embedding_url: str | None = None,
    ) -> None:
        """初始化 Qdrant 向量索引器。

        Args:
            qdrant_client: 可选的 Qdrant 异步客户端。
            embedding_url: 可选的 Embedding 服务根 URL。
        """
        self._settings = get_settings()
        self._qdrant: AsyncQdrantClient = qdrant_client or AsyncQdrantClient(
            url=self._settings.qdrant_url,
            api_key=self._settings.QDRANT_API_KEY or None,
        )
        self._embedding_url = embedding_url or self._settings.EMBEDDING_SERVICE_URL
        self._collection_name = self._settings.QDRANT_COLLECTION_SKILLS
        self._vector_size = self._settings.EMBEDDING_DIMENSION
        self._collection_ready = False
        # None=未探测；True/False=探测结果（失败后本进程内不再重试，避免启动串行超时）
        self._embedding_ok: bool | None = None

    def _timeout(self) -> httpx.Timeout:
        sec = float(self._settings.EMBEDDING_TIMEOUT_SECONDS)
        return httpx.Timeout(sec, connect=min(5.0, sec))

    async def ensure_collection(self) -> None:
        """如果 Qdrant 集合不存在则创建。"""
        if self._collection_ready:
            return
        try:
            collections: Any = await self._qdrant.get_collections()
            names: list[Any] = [c.name for c in collections.collections]
            if self._collection_name not in names:
                await self._qdrant.create_collection(
                    collection_name=self._collection_name,
                    vectors_config=qdrant_models.VectorParams(
                        size=self._vector_size,
                        distance=qdrant_models.Distance.COSINE,
                    ),
                    hnsw_config=qdrant_models.HnswConfigDiff(
                        m=16,
                        ef_construct=100,
                    ),
                    optimizers_config=qdrant_models.OptimizersConfigDiff(
                        indexing_threshold=0,
                    ),
                )
                logger.info(
                    "Qdrant collection created",
                    collection=self._collection_name,
                    vector_size=self._vector_size,
                )
            self._collection_ready = True
        except Exception:
            logger.exception(
                "Failed to ensure Qdrant collection",
                collection=self._collection_name,
            )
            raise

    async def _probe_embedding(self) -> bool:
        """探测 Embedding 服务是否可用（只探测一次）。"""
        if self._embedding_ok is not None:
            return self._embedding_ok
        if not self._settings.SKILL_VECTOR_INDEX_ENABLED:
            self._embedding_ok = False
            logger.warning(
                "Skill vector indexing disabled (SKILL_VECTOR_INDEX_ENABLED=false); "
                "skills still register for tool calling"
            )
            return False

        probe_timeout = httpx.Timeout(3.0, connect=2.0)
        url = f"{self._embedding_url.rstrip('/')}/health"
        try:
            async with httpx.AsyncClient(timeout=probe_timeout) as client:
                resp = await client.get(url)
                if resp.status_code < 500:
                    self._embedding_ok = True
                    return True
        except Exception:
            pass

        # /health 没有时，用极短文本试 /embed
        try:
            async with httpx.AsyncClient(timeout=probe_timeout) as client:
                resp = await client.post(
                    f"{self._embedding_url.rstrip('/')}/embed",
                    json={"text": "ping"},
                )
                resp.raise_for_status()
                self._embedding_ok = True
                return True
        except Exception as exc:
            self._embedding_ok = False
            logger.warning(
                "Embedding service unavailable; skip skill vector indexing "
                "(CRM tools still work). Fix EMBEDDING_SERVICE_URL or start embedding on :8001.",
                url=self._embedding_url,
                error=str(exc),
            )
            return False

    async def generate_embedding(self, text: str) -> list[float]:
        """调用本地 Embedding 服务为 *text* 生成向量。"""
        if not await self._probe_embedding():
            raise RuntimeError(f"Embedding unavailable: {self._embedding_url}")
        url: str = f"{self._embedding_url.rstrip('/')}/embed"
        async with httpx.AsyncClient(timeout=self._timeout()) as client:
            resp: Any = await client.post(url, json={"text": text})
            resp.raise_for_status()
            data: Any = resp.json()
            return data.get("embedding", data.get("vector", []))

    async def index_skill(self, skill: Skill) -> None:
        """为 *skill* 生成 embedding 并 upsert 到 Qdrant。"""
        if not await self._probe_embedding():
            return

        await self.ensure_collection()
        text: str = skill.index_text()
        try:
            vector: list[float] = await self.generate_embedding(text)
        except Exception as exc:
            # 运行中 embedding 又挂了：标记不可用，避免后续每个 skill 再卡超时
            self._embedding_ok = False
            logger.warning(
                "Failed to generate embedding for skill; further indexing skipped",
                skill_id=skill.skill_id,
                error=str(exc),
            )
            return

        skill.embedding = vector

        point: PointStruct = qdrant_models.PointStruct(
            id=skill_point_id(skill.skill_id),
            vector=vector,
            payload={
                "skill_id": skill.skill_id,
                "name": skill.name,
                "category": skill.category,
                "status": (
                    skill.status.value
                    if hasattr(skill.status, "value")
                    else str(skill.status)
                ),
                "version": skill.version,
                "tags": skill.tags,
                "source": (
                    skill.source.value
                    if hasattr(skill.source, "value")
                    else str(skill.source)
                ),
            },
        )
        await self._qdrant.upsert(
            collection_name=self._collection_name,
            points=[point],
        )
        logger.debug("Skill indexed", skill_id=skill.skill_id, category=skill.category)

    async def reindex_all(self, skills: list[Skill]) -> int:
        """为所有 *skills* 重新生成 embedding 并重建索引。

        返回成功建立索引的 Skill 数量。
        """
        # 强制重新探测
        self._embedding_ok = None
        if not await self._probe_embedding():
            return 0
        await self.ensure_collection()
        count: int = 0
        for skill in skills:
            if not self._embedding_ok:
                break
            try:
                await self.index_skill(skill)
                if skill.embedding:
                    count += 1
            except Exception:
                logger.exception(
                    "Failed to reindex skill", skill_id=skill.skill_id
                )
        logger.info("Reindex complete", indexed=count, total=len(skills))
        return count

    async def update_payload(self, skill_id: str, payload: dict) -> None:
        """仅更新 payload 元数据，不重新生成向量。"""
        await self.ensure_collection()
        await self._qdrant.set_payload(
            collection_name=self._collection_name,
            payload=payload,
            points=[skill_point_id(skill_id)],
        )

    async def delete_index(self, skill_id: str) -> None:
        """从 Qdrant 索引中移除某个 Skill 的向量。"""
        await self.ensure_collection()
        try:
            await self._qdrant.delete(
                collection_name=self._collection_name,
                points_selector=qdrant_models.PointIdsList(
                    points=[skill_point_id(skill_id)],
                ),
            )
            logger.info("Skill index deleted", skill_id=skill_id)
        except Exception:
            logger.exception("Failed to delete skill index", skill_id=skill_id)

    async def search(
        self,
        query_vector: list[float],
        top_n: int = 50,
        category_filter: list[str] | None = None,
    ) -> list[dict]:
        """在 Qdrant 索引中搜索 *query_vector* 的最近邻。

        返回包含 ``skill_id``、``score`` 与 ``payload`` 的字典列表。
        """
        await self.ensure_collection()

        must_conditions: list[qdrant_models.FieldCondition] = [
            qdrant_models.FieldCondition(
                key="status",
                match=qdrant_models.MatchValue(value="active"),
            ),
        ]
        if category_filter:
            must_conditions.append(
                qdrant_models.FieldCondition(
                    key="category",
                    match=qdrant_models.MatchAny(any=category_filter),
                )
            )

        results: list[dict] = await self._qdrant.search(
            collection_name=self._collection_name,
            query_vector=query_vector,
            limit=top_n,
            query_filter=qdrant_models.Filter(must=must_conditions),
            with_payload=True,
        )

        return [
            {
                "skill_id": hit.payload.get("skill_id", hit.id),
                "score": hit.score,
                "payload": hit.payload,
            }
            for hit in results
        ]

    async def close(self) -> None:
        """关闭 Qdrant 客户端连接。"""
        await self._qdrant.close()
