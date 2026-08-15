"""search 工具 — 联网搜索（1.4 可插拔后端，经 search_providers 抽象）。

设计（§4 / Q4 / T02）：``SearchTool`` 只关心统一入参 / 出参，检索后端由
``get_search_provider()`` 按 ``SEARCH_PROVIDER`` 配置切换（mock / generic_api / …）。
所有异常由本工具统一转 ``ToolResult(is_error=True)``，不向上抛，避免中断
``mis-admin-helper`` 的对话循环。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.skills.tools.search_providers import get_search_provider
from src.utils.logging import get_logger

logger = get_logger("skills.search_tool")


class SearchInput(BaseModel):
    """search 工具入参。"""

    query: str = Field(..., description="检索关键词 / 自然语言问句")
    top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        description="返回的命中条数上限（1–20），默认 5",
    )
    source: str | None = Field(
        default=None,
        description="可选来源过滤（provider 自行决定是否支持，如指定站点域名）",
    )


def _format_hits(hits: list[Any]) -> str:
    """把搜索命中渲染为易读文本。

    Args:
        hits: 检索命中列表（``SearchHit`` 实例）。

    Returns:
        多行文本；无命中时返回友好提示。
    """
    if not hits:
        return "未检索到相关结果。"
    rows: list[str] = []
    for i, hit in enumerate(hits, start=1):
        title = str(getattr(hit, "title", "") or f"结果 {i}")
        url = str(getattr(hit, "url", "") or "")
        snippet = str(getattr(hit, "snippet", "") or "")
        source = str(getattr(hit, "source", "") or "")
        rows.append(f"{i}. {title}" + (f" [{source}]" if source else ""))
        if url:
            rows.append(f"   {url}")
        if snippet:
            rows.append(f"   {snippet}")
    return "\n".join(rows)


class SearchTool(BaseTool):
    """联网搜索工具（经可插拔 provider 抽象）。"""

    name = "search"
    description = (
        "联网搜索公开资料，辅助技能创建 / 补全外部知识（如通用 API 用法、官方文档片段）。"
        "入参 query 为检索词；top_k 控制返回条数；source 可指定来源站点。"
        "返回命中标题、链接与摘要文本。"
    )
    input_model = SearchInput

    async def execute(
        self, arguments: SearchInput, context: ToolExecutionContext
    ) -> ToolResult:
        """调用 provider 执行检索并格式化结果。

        Args:
            arguments: 经 Pydantic 校验的工具入参。
            context: OpenHarness 执行上下文。

        Returns:
            成功时为命中文本；失败时为 ``is_error=True`` 的结果。
        """
        query = (arguments.query or "").strip()
        if not query:
            return ToolResult(output="query 不能为空", is_error=True)
        try:
            provider = get_search_provider()
            hits = await provider.search(
                query,
                top_k=arguments.top_k,
                source=arguments.source,
            )
            return ToolResult(output=_format_hits(hits))
        except Exception as exc:  # noqa: BLE001 - 安全降级为错误结果，避免中断对话
            logger.warning(
                "search failed",
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )
            return ToolResult(output=f"联网搜索失败：{exc}", is_error=True)
