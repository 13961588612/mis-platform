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


def _parens_balanced(sql: str) -> bool:
    """括号深度归零且中途不出现负深度（忽略单/双引号内字符）。"""
    depth = 0
    in_single = False
    in_double = False
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if in_single:
            if ch == "'" and i + 1 < n and sql[i + 1] == "'":
                i += 2
                continue
            if ch == "'":
                in_single = False
            i += 1
            continue
        if in_double:
            if ch == '"' and i + 1 < n and sql[i + 1] == '"':
                i += 2
                continue
            if ch == '"':
                in_double = False
            i += 1
            continue
        if ch == "'":
            in_single = True
        elif ch == '"':
            in_double = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
        i += 1
    return depth == 0


class SqlGuard:
    """SQL 兜底处理（LIMIT 剥离 + 结构完整性）。"""

    @staticmethod
    def is_structurally_complete(sql: str) -> bool:
        """判断 SQL 是否结构完整（非 LLM max_tokens 截断的半截语句）。

        现网：``WITH leaf AS (SELECT c4.categoryid AS leaf_id`` 因输出截断缺右括号，
        却仍进入 dry_run → ``Expecting )``。括号不平衡或 sqlglot 无法解析则判定不完整。
        """
        text = (sql or "").strip().rstrip(";").strip()
        if not text:
            return False
        upper = text.upper()
        if not (upper.startswith("SELECT") or upper.startswith("WITH")):
            return False
        if not _parens_balanced(text):
            return False
        try:
            import sqlglot

            sqlglot.parse_one(text, read="postgres")
        except Exception:  # noqa: BLE001 - 解析失败即视为不完整/非法
            try:
                import sqlglot

                sqlglot.parse_one(text, read="trino")
            except Exception:  # noqa: BLE001
                return False
        return True

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
