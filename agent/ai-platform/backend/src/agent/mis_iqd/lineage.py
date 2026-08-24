"""LineageExtractor + CitationBuilder — SQL 血缘与引用构建（v1.9 / B2）。

- :class:`LineageExtractor`：用 sqlglot 解析最终 SQL，抽取涉及的表/字段 item_key
  （后置范围断言输入，architecture §5.1 步骤 24）。
- :class:`CitationBuilder`：聚合原生引用来源（WrenAI get_context/recall 产物 +
  平台 catalog/knowledge 缓存，v1.9 经 ``IqdConfigClient``），产出
  ``IqdAskResponse.citations``。

B2 基础版：
- 血缘只做**表级** item_key 抽取（``{datasource}.{schema}.{table}``），
  字段级留待 B3。
- 引用来源在 mock/无配置时返回空列表，不阻断主链路。
"""

from __future__ import annotations

from typing import Any

import re

from src.models.iqd_schema import Citation
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.lineage")

#: sqlglot 缺省方言
DEFAULT_DIALECT = "postgres"

#: 从 SQL 提取表引用的正则兜底（sqlglot 解析失败时使用）
_TABLE_RE = re.compile(
    r"(?:from|join)\s+([A-Za-z0-9_\"`.]+(?:\.[A-Za-z0-9_\"`.]+){1,3})",
    re.IGNORECASE,
)


def _normalize_table(name: str) -> str:
    """规约表名为 item_key：去引号、去 schema 之外的默认目录。

    ``pg_main.public.orders`` → ``pg_main.public.orders``；
    ``"orders"`` → ``orders``。
    """
    cleaned = name.strip().strip('"').strip("`")
    parts = [p.strip().strip('"').strip("`") for p in cleaned.split(".") if p.strip()]
    if not parts:
        return cleaned
    # 只保留 2–3 段（datasource.schema.table / schema.table / table）
    if len(parts) > 3:
        parts = parts[-3:]
    return ".".join(parts)


class LineageExtractor:
    """从最终 SQL 提取表/字段血缘（B2 表级）。"""

    def extract_tables(self, sql: str, dialect: str = DEFAULT_DIALECT) -> list[str]:
        """提取 SQL 涉及的表 item_key 列表（去重保序）。

        Args:
            sql: 注入行级范围后的最终 SQL。
            dialect: SQL 方言（缺省 postgres）。

        Returns:
            表 item_key 列表；解析失败时用正则兜底；无表时返回空列表。
        """
        if not sql or not sql.strip():
            return []
        try:
            return self._extract_with_sqlglot(sql, dialect)
        except Exception as exc:  # noqa: BLE001 - sqlglot 失败不得阻断主链路
            logger.debug("sqlglot lineage failed; fallback regex", error=str(exc))
            return self._extract_with_regex(sql)

    # ================================================================ 内部

    def _extract_with_sqlglot(self, sql: str, dialect: str) -> list[str]:
        """sqlglot 解析（B2 表级：遍历 FROM/JOIN 节点）。"""
        import sqlglot

        expression = sqlglot.parse_one(sql, read=dialect or DEFAULT_DIALECT)
        tables: list[str] = []
        seen: set[str] = set()
        for node in expression.find_all(sqlglot.exp.Table):
            name = _normalize_table(node.sql(dialect=dialect))
            if not name:
                continue
            if name not in seen:
                seen.add(name)
                tables.append(name)
        return tables

    def _extract_with_regex(self, sql: str) -> list[str]:
        """正则兜底提取表名。"""
        tables: list[str] = []
        seen: set[str] = set()
        for match in _TABLE_RE.finditer(sql or ""):
            name = _normalize_table(match.group(1))
            if not name or name in seen:
                continue
            seen.add(name)
            tables.append(name)
        return tables


class CitationBuilder:
    """聚合引用来源（B2 基础版：原生来源 + 配置缓存）。"""

    def __init__(self, config_client: Any | None = None) -> None:
        """初始化引用构建器。

        Args:
            config_client: ``IqdConfigClient`` 实例（缺省懒加载）。
        """
        self._config_client: Any = config_client

    def from_native(
        self,
        native: dict[str, Any] | None,
        *,
        allowed_item_keys: list[str] | None = None,
    ) -> list[Citation]:
        """从 WrenAI 原生引用来源构建引用列表。

        Args:
            native: ``get_context`` / ``recall_queries`` 产物（含 models/knowledge）。
            allowed_item_keys: 允许表集合（过滤越权引用）。

        Returns:
            引用列表；原生来源不可得时返回空列表。
        """
        if not isinstance(native, dict):
            return []
        citations: list[Citation] = []
        allowed = set(allowed_item_keys or [])

        for model in self._as_list(native.get("models")):
            if isinstance(model, dict):
                item_key = str(model.get("item_key") or model.get("name") or "")
                if allowed and item_key and item_key not in allowed:
                    continue
                citations.append(
                    Citation(
                        kind="model",
                        item_key=item_key,
                        display_name=str(model.get("display_name") or model.get("name") or item_key),
                        description=model.get("description"),
                    )
                )

        for knowledge in self._as_list(native.get("knowledge")):
            if isinstance(knowledge, dict):
                item_key = str(knowledge.get("item_key") or "")
                citations.append(
                    Citation(
                        kind="knowledge",
                        item_key=item_key,
                        display_name=str(knowledge.get("title") or item_key or "口径"),
                        snippet=knowledge.get("content") or knowledge.get("snippet"),
                        source_ref=knowledge.get("source_ref"),
                    )
                )

        return citations

    def from_tables(self, tables: list[str]) -> list[Citation]:
        """从血缘表列表构建 table 级引用（B2 兜底）。"""
        return [
            Citation(kind="table", item_key=table, display_name=table.split(".")[-1])
            for table in tables
        ]

    def merge(
        self,
        native_citations: list[Citation],
        table_citations: list[Citation],
    ) -> list[Citation]:
        """合并原生与表级引用（原生优先，去重 by item_key+kind）。"""
        merged: list[Citation] = []
        seen: set[tuple[str, str]] = set()
        for citation in [*native_citations, *table_citations]:
            key = (citation.kind, citation.item_key)
            if key in seen:
                continue
            seen.add(key)
            merged.append(citation)
        return merged

    def merge_native_citations(
        self,
        native: dict[str, Any] | None,
        *,
        knowledge: list[dict[str, Any]] | None = None,
        allowed_item_keys: list[str] | None = None,
    ) -> list[Citation]:
        """W4 引用归一化钩子（Q5 原生/降级统一）。

        <p>原生引用来源（WrenAI get_context/recall 产物）+ 平台知识缓存
        （IqdConfigClient.get_knowledge）统一合并：原生优先，知识片段补位，
        越权表引用过滤。前端引用可展开（表/字段/知识片段），不依赖 WrenAI
        原生 citation 是否可用。

        Args:
            native: WrenAI 原生引用来源（models/knowledge）。
            knowledge: 平台知识/术语缓存（snake_case wire）。
            allowed_item_keys: 允许表集合（过滤越权引用）。

        Returns:
            归一化引用列表；原生与知识均不可得时返回空列表。
        """
        citations: list[Citation] = []
        seen: set[tuple[str, str]] = set()
        allowed = set(allowed_item_keys or [])

        # 1) 原生模型引用（表/字段）
        for citation in self.from_native(native, allowed_item_keys=allowed_item_keys):
            key = (citation.kind, citation.item_key)
            if key not in seen:
                seen.add(key)
                citations.append(citation)

        # 2) 原生知识片段（优先于平台缓存补位）
        for citation in self._from_native_knowledge(native):
            key = (citation.kind, citation.item_key)
            if key not in seen:
                seen.add(key)
                citations.append(citation)

        # 3) 平台知识缓存补位（kind=knowledge；不越权）
        for item in knowledge or []:
            if not isinstance(item, dict):
                continue
            item_key = str(item.get("item_key") or item.get("title") or "")
            if allowed and item_key and item_key not in allowed and item.get("kind") != "knowledge":
                continue
            citation = Citation(
                kind="knowledge",
                item_key=item_key,
                display_name=str(item.get("title") or item_key or "口径"),
                snippet=item.get("content"),
                source_ref=item.get("source") or item.get("kb_term_id"),
            )
            key = (citation.kind, citation.item_key)
            if key not in seen:
                seen.add(key)
                citations.append(citation)

        return citations

    def _from_native_knowledge(self, native: dict[str, Any] | None) -> list[Citation]:
        """抽取原生知识片段（native.knowledge），供 merge_native_citations 使用。"""
        if not isinstance(native, dict):
            return []
        citations: list[Citation] = []
        for knowledge in self._as_list(native.get("knowledge")):
            if isinstance(knowledge, dict):
                item_key = str(knowledge.get("item_key") or "")
                citations.append(
                    Citation(
                        kind="knowledge",
                        item_key=item_key,
                        display_name=str(knowledge.get("title") or item_key or "口径"),
                        snippet=knowledge.get("content") or knowledge.get("snippet"),
                        source_ref=knowledge.get("source_ref"),
                    )
                )
        return citations

    # ================================================================ 内部

    @staticmethod
    def _as_list(value: Any) -> list[Any]:
        """规约为列表；None/非 list 返回空列表。"""
        if isinstance(value, list):
            return value
        return []
