"""血缘抽取不得把 SQL 表别名 / CTE 名带进 item_key（否则已授权表被 45204 误拒）。"""

from __future__ import annotations

import pytest

from src.agent.mis_iqd.lineage import LineageExtractor
from src.agent.mis_iqd.scope_resolver import (
    IqdScopeResolution,
    ScopeDeniedError,
    ScopeResolver,
)


def test_extract_tables_strips_aliases() -> None:
    sql = (
        "SELECT DISTINCT c4.categoryid, c4.categoryname "
        "FROM dim_spmrkt_chl_category_df c "
        "JOIN dim_spmrkt_chl_category_df c4 "
        "ON c4.categoryid LIKE CONCAT(c.categoryid, '%') "
        "WHERE c.categoryname LIKE '%蔬菜%' AND c4.deptlevelid = '4' "
        "ORDER BY c4.categoryid"
    )
    tables = LineageExtractor().extract_tables(sql)
    assert tables == ["dim_spmrkt_chl_category_df"]


def test_aliased_dim_table_passes_scope_assert() -> None:
    sql = (
        "SELECT c.categoryid FROM dim_spmrkt_chl_category_df c "
        "WHERE c.deptlevelid = '4'"
    )
    tables = LineageExtractor().extract_tables(sql)
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=[
            "mdl:model:dim_spmrkt_chl_category_df",
            "pg_main.spm_result.dim_spmrkt_chl_category_df",
        ],
        subject_summary="role:TENANT_ADMIN",
    )
    ScopeResolver().assert_sql_within_scope(tables, resolution)


def test_extract_tables_skips_cte_names() -> None:
    """现网：蔬菜下级分类 WITH veg AS (...) ... FROM veg → 不得把 veg 当表。"""
    sql = (
        "WITH veg AS ("
        "SELECT categoryid FROM dim_spm_chl_category_df "
        "WHERE TRIM(categoryname) = '蔬菜'"
        ") "
        "SELECT c.categoryid, TRIM(c.categoryname) AS categoryname "
        "FROM dim_spm_chl_category_df c "
        "WHERE c.parentcategoryid IN (SELECT categoryid FROM veg) "
        "ORDER BY c.categoryid"
    )
    tables = LineageExtractor().extract_tables(sql)
    assert tables == ["dim_spm_chl_category_df"]
    assert "veg" not in tables


def test_cte_self_join_passes_full_scope_assert() -> None:
    sql = (
        "WITH veg AS ("
        "SELECT categoryid FROM dim_spm_chl_category_df "
        "WHERE TRIM(categoryname) = '蔬菜'"
        ") "
        "SELECT c.categoryid FROM dim_spm_chl_category_df c "
        "WHERE c.parentcategoryid IN (SELECT categoryid FROM veg)"
    )
    tables = LineageExtractor().extract_tables(sql)
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=[
            "mdl:model:dim_spm_chl_category_df",
            "pg_main.spm_result.dim_spm_chl_category_df",
        ],
        subject_summary="role:TENANT_ADMIN",
    )
    ScopeResolver().assert_sql_within_scope(tables, resolution)


def test_model_only_scope_matches_bare_table_name() -> None:
    """scope_hint 仅 mdl:model:* 时，SQL 裸表名应能短名对齐。"""
    sql = (
        "SELECT c.categoryid, c.categoryname, c.parentcategoryid "
        "FROM dim_spm_chl_category_df c "
        "WHERE c.parentcategoryid IN ("
        "SELECT p.categoryid FROM dim_spm_chl_category_df p "
        "WHERE TRIM(p.categoryname) = '蔬菜')"
    )
    tables = LineageExtractor().extract_tables(sql)
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=["mdl:model:dim_spm_chl_category_df"],
        subject_summary="role:TENANT_ADMIN",
    )
    ScopeResolver().assert_sql_within_scope(tables, resolution)


def test_model_only_scope_still_denies_unrelated_table() -> None:
    tables = ["dim_spm_chl_category_df", "secret_other_table"]
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=["mdl:model:dim_spm_chl_category_df"],
        subject_summary="role:TENANT_ADMIN",
    )
    with pytest.raises(ScopeDeniedError):
        ScopeResolver().assert_sql_within_scope(tables, resolution)
