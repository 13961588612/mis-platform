"""联网搜索 Provider 抽象（1.4 search tool 的可插拔后端）。

设计（§4 / Q4）：``SearchTool`` 只关心统一入参/出参，具体检索后端由
``SearchProvider`` 协议抽象，经配置 ``SEARCH_PROVIDER`` 切换：

- ``mock``（默认）：返回稳定占位命中，**零外部依赖**，保证联调不依赖真实搜索服务；
- ``generic_api``：经 ``OUTBOUND_PROXY`` 调可配置 endpoint（与现有 LLM/KB 出站一致），
  缺失 URL / 超时时**安全降级**（返回空命中，不抛异常中断助手对话）；
- ``internal_mcp`` / ``specified_urls``：P2 待实现，本期统一回落 ``mock``（不阻断）。

所有 provider 的 ``search`` 都必须返回 ``list[SearchHit]`` 且**不向调用方抛异常**
（异常由 ``SearchTool`` 统一转 ``ToolResult(is_error=True)``）。
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("skills.search_providers")


class SearchHit(BaseModel):
    """单条搜索命中（统一结构，供 SearchTool 格式化）。"""

    title: str = Field(default="", description="命中标题")
    url: str = Field(default="", description="命中链接")
    snippet: str = Field(default="", description="命中摘要/片段")
    source: str = Field(default="", description="来源标识（provider / 站点）")


@runtime_checkable
class SearchProvider(Protocol):
    """联网搜索 Provider 协议（可插拔后端契约）。"""

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        source: str | None = None,
    ) -> list[SearchHit]:
        """执行检索并返回命中列表。

        Args:
            query: 检索关键词。
            top_k: 返回条数上限。
            source: 可选来源过滤（provider 自行决定是否支持）。

        Returns:
            命中列表（可能为空）；实现方**不得**向调用方抛异常。
        """
        ...


class MockSearchProvider:
    """默认 Provider：返回稳定占位命中，零外部依赖（联调用）。"""

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        source: str | None = None,
    ) -> list[SearchHit]:
        """返回可预测的占位命中，便于前端/对话联调，不触网。"""
        limit = max(0, min(int(top_k), 10))
        hits: list[SearchHit] = []
        for i in range(1, limit + 1):
            hits.append(
                SearchHit(
                    title=f"[示例] {query} · 相关资料 {i}",
                    url=f"https://example.com/search?q={i}",
                    snippet=f"关于「{query}」的示例检索结果 {i}（mock provider，未真实联网）。",
                    source="mock",
                )
            )
        return hits


class GenericApiSearchProvider:
    """通用搜索 API Provider：经 ``OUTBOUND_PROXY`` 调 ``SEARCH_GENERIC_API_URL``。

    缺失 URL / 请求异常 / 解析失败均**安全降级**为返回空列表（不抛异常，
    不中断助手对话循环）。
    """

    def __init__(
        self,
        *,
        url: str = "",
        api_key: str = "",
        timeout_seconds: float = 10.0,
        proxy_url: str | None = None,
    ) -> None:
        self._url = (url or "").strip()
        self._api_key = api_key or ""
        self._timeout = max(1.0, float(timeout_seconds or 10.0))
        self._proxy_url = proxy_url or None

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        source: str | None = None,
    ) -> list[SearchHit]:
        """调用通用搜索端点并尽力解析为 ``SearchHit``。

        任何异常（缺 URL / 网络错误 / 解析失败）都降级为 ``[]``。
        """
        if not self._url:
            logger.warning("generic_api search skipped: SEARCH_GENERIC_API_URL 未配置")
            return []

        import json

        import httpx

        headers: dict[str, str] = {"Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        params: dict[str, Any] = {"q": query, "top_k": int(top_k)}
        if source:
            params["source"] = source

        try:
            async with httpx.AsyncClient(timeout=self._timeout, proxy=self._proxy_url) as client:
                resp = await client.get(self._url, params=params, headers=headers)
                resp.raise_for_status()
                payload: Any = resp.json()
        except Exception as exc:  # noqa: BLE001 - 安全降级为无结果，避免中断对话
            logger.warning(
                "generic_api search failed; degrading to empty",
                url=self._url,
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )
            return []

        return self._parse_hits(payload, limit=int(top_k))

    @staticmethod
    def _parse_hits(payload: Any, *, limit: int) -> list[SearchHit]:
        """尽力从多种 JSON 形状里抽取命中列表。"""
        raw_items: Any = payload
        if isinstance(payload, dict):
            for key in ("results", "hits", "items", "data", "list"):
                if isinstance(payload.get(key), list):
                    raw_items = payload[key]
                    break
        if not isinstance(raw_items, list):
            return []

        hits: list[SearchHit] = []
        for item in raw_items[: max(0, limit)]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or item.get("name") or item.get("text") or "")
            url = str(item.get("url") or item.get("link") or item.get("href") or "")
            snippet = str(
                item.get("snippet")
                or item.get("description")
                or item.get("summary")
                or item.get("content")
                or ""
            )
            src = str(item.get("source") or item.get("site") or "generic_api")
            hits.append(SearchHit(title=title, url=url, snippet=snippet, source=src))
        return hits


def get_search_provider() -> SearchProvider:
    """按 ``SEARCH_PROVIDER`` 工厂返回 Provider 实例（singleton-free，每次构造）。

    Returns:
        ``MockSearchProvider``（默认 / 未识别 / P2 未实现类型）或
        ``GenericApiSearchProvider``。
    """
    settings = get_settings()
    provider: str = (getattr(settings, "SEARCH_PROVIDER", "mock") or "mock").strip().lower()

    if provider == "generic_api":
        proxy: str | None = None
        if bool(getattr(settings, "OUTBOUND_PROXY_ENABLED", False)):
            proxy = str(getattr(settings, "outbound_proxy_url", "") or "") or None
        return GenericApiSearchProvider(
            url=str(getattr(settings, "SEARCH_GENERIC_API_URL", "") or ""),
            api_key=str(getattr(settings, "SEARCH_GENERIC_API_KEY", "") or ""),
            timeout_seconds=float(getattr(settings, "SEARCH_TIMEOUT_SECONDS", 10.0) or 10.0),
            proxy_url=proxy,
        )

    # mock / internal_mcp / specified_urls（P2 未实现）→ 统一回落 mock，保证不阻断。
    if provider not in ("mock",):
        logger.info("search provider 未实现，回落 mock", requested=provider)
    return MockSearchProvider()
