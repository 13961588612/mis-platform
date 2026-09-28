"""SQL 兜底改写（2026-09-28 真机实测驱动）。

<背景>
真机（Doris/StarRocks，连接 900001）实测：**wren 的 SQL 重写不接受 `LIMIT`** ——
连 ``SELECT store_id FROM ads_..._df LIMIT 1`` 都会报
``(1064, "You have an error in your SQL syntax ... near 'LIMIT'")``；
而去掉 LIMIT 的同一查询正常返回。``run_sql`` 工具**自带 ``limit`` 参数**工作正常。

因此：LLM 若在 SQL 里写了 ``LIMIT``/``OFFSET``，整条查询会因这个与业务无关的原因失败。
本模块做**兜底剥离**：把尾部 ``LIMIT n [OFFSET m]`` 摘掉，返回给平台用工具参数截断
（``run_sql(limit=n)``），从而「LLM 违反提示词」也不会打挂查询。

设计原则：
- **只处理语义安全的尾部 LIMIT**：SQL 文本里的 LIMIT 一律剥掉（即使子查询里有，保留最外层
  语义也无法保证正确），因此这里只剥**最外层尾部**的 LIMIT/OFFSET；
- 拿不准（找不到/语法奇怪）时**原样返回**，绝不猜着改。
"""

from __future__ import annotations

import re

#: 最外层尾部 ``LIMIT n [OFFSET m]`` / ``LIMIT m, n``（MySQL 风格）
_TAIL_LIMIT_RE = re.compile(
    r"""
    \s+LIMIT\s+(\d+)\s*(?:,\s*(\d+))?   # LIMIT n   | LIMIT offset, n
    (?:\s+OFFSET\s+(\d+))?              # 可选 OFFSET m
    \s*;?\s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)


class SqlGuard:
    """SQL 兜底处理（LIMIT 剥离）。"""

    @staticmethod
    def strip_trailing_limit(sql: str) -> tuple[str, int | None]:
        """剥掉最外层尾部的 ``LIMIT``，返回 ``(改写后 SQL, 建议的 limit)``。

        Args:
            sql: LLM 生成的 SQL（可能带尾部 LIMIT）。

        Returns:
            ``(sql_without_limit, limit_or_None)``：未命中时原样返回 ``(sql, None)``。
            建议的 limit 供 ``run_sql(limit=...)`` 使用，保持「截断」语义不丢失。
        """
        text = (sql or "").strip()
        if not text:
            return sql, None
        match = _TAIL_LIMIT_RE.search(text)
        if not match:
            return sql, None

        # MySQL 风格 `LIMIT offset, count`：第二个数才是行数
        first = match.group(1)
        second = match.group(2)
        if second is not None:
            limit: int | None = int(second)
            offset = int(first)
        else:
            limit = int(first)
            offset = int(match.group(3)) if match.group(3) else 0

        stripped = text[: match.start()].rstrip().rstrip(";").rstrip()
        if not stripped:
            return sql, None  # 不该发生；保守原样返回
        # offset>0 时不能用 run_sql(limit) 精确表达，但仍比整条失败好：保留 limit 建议
        _ = offset
        return stripped, (limit if limit and limit > 0 else None)
