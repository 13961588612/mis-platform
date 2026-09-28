"""LIMIT 剥离兜底（2026-09-28 真机实测驱动）。

<Bug>
真机（Doris/StarRocks）实测：wren 的 SQL 重写**不接受 LIMIT** —— 连
``SELECT store_id FROM ads_..._df LIMIT 1`` 都报
``(1064, "You have an error in your SQL syntax ... near 'LIMIT'")``；
同一查询去掉 LIMIT 正常。``run_sql`` 工具自带的 ``limit`` 参数工作正常。
因此 LLM 若在 SQL 里写 LIMIT，会因与业务无关的原因打挂整条查询。
"""

from __future__ import annotations

from src.agent.mis_iqd.sql_guard import SqlGuard


def test_strips_simple_limit() -> None:
    sql, limit = SqlGuard.strip_trailing_limit("SELECT a FROM t LIMIT 1")
    assert sql == "SELECT a FROM t"
    assert limit == 1


def test_strips_limit_with_where() -> None:
    sql, limit = SqlGuard.strip_trailing_limit(
        "SELECT store_name FROM ads_df WHERE store_id = '0027' LIMIT 10"
    )
    assert sql == "SELECT store_name FROM ads_df WHERE store_id = '0027'"
    assert limit == 10


def test_strips_mysql_style_offset_count() -> None:
    """`LIMIT offset, count`：第二个数是行数。"""
    sql, limit = SqlGuard.strip_trailing_limit("SELECT a FROM t LIMIT 5, 10")
    assert sql == "SELECT a FROM t"
    assert limit == 10


def test_strips_limit_with_offset() -> None:
    sql, limit = SqlGuard.strip_trailing_limit("SELECT a FROM t LIMIT 10 OFFSET 20")
    assert sql == "SELECT a FROM t"
    assert limit == 10


def test_strips_trailing_semicolon_too() -> None:
    sql, limit = SqlGuard.strip_trailing_limit("SELECT a FROM t LIMIT 3;")
    assert sql == "SELECT a FROM t"
    assert limit == 3


def test_keeps_inner_subquery_limit() -> None:
    """子查询内的 LIMIT 不动（只剥最外层尾部）。"""
    original = "SELECT a FROM (SELECT b FROM t LIMIT 3) x"
    sql, limit = SqlGuard.strip_trailing_limit(original)
    assert sql == original
    assert limit is None


def test_no_limit_returns_unchanged() -> None:
    for original in ("SELECT a FROM t", "SELECT a FROM t ORDER BY a"):
        sql, limit = SqlGuard.strip_trailing_limit(original)
        assert sql == original
        assert limit is None


def test_empty_input() -> None:
    assert SqlGuard.strip_trailing_limit("") == ("", None)
    assert SqlGuard.strip_trailing_limit(None) == (None, None)


def test_does_not_mangle_limit_like_identifier() -> None:
    """`a_limit_col` 这类标识符不该被误判（不含 ``LIMIT n`` 结尾）。"""
    original = "SELECT a_limit_col FROM t"
    sql, limit = SqlGuard.strip_trailing_limit(original)
    assert sql == original and limit is None
