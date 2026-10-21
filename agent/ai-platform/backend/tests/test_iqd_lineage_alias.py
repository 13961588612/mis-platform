"""血缘抽取不得把 SQL 表别名带进 item_key（否则已授权表被 45204 误拒）。"""

from __future__ import annotations

from src.agent.mis_iqd.lineage import LineageExtractor
from src.agent.mis_iqd.scope_resolver import IqdScopeResolution, ScopeResolver


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
