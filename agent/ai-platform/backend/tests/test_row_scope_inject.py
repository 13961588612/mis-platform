"""行级注入 inject_row_scope 测试（P2-7 交付物之一，≥20 用例）。

覆盖：单表/多表（JOIN/CTE/UNION）注入、P0-3 逐表注入与别名隔离、
P1-4 越权显式引用 45204 拒绝与授权内幂等放行、P1-6 dept/store 维度来源、
fail-closed（头缺失/未知维度/解析失败/改写失败）、脱敏无关路径原样返回。
"""
from __future__ import annotations

import asyncio
import json

import pytest

from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    ScopeResolver,
    PREDICATE_FAIL_CLOSED,
    _builtin_dimensions,
)


class FakeConfigClient:
    """注入用假配置客户端（get_dimensions 返回空 → 走内置种子）。"""

    async def get_dimensions(self, ctx=None):
        return []

    async def load_configs(self, ctx=None):
        return [{"id": 1, "name": "wren", "enabled": 1}]

    async def get_scope_policies(self, connection_id, ctx=None):
        return []

    async def get_acls(self, connection_id, ctx=None):
        return []

    async def get_catalog_in_scope(self, connection_id, ctx=None):
        return []

    async def get_catalog_items(self, connection_id, ctx=None):
        return []

    async def get_mask_rules(self, ctx=None):
        return []


def make_resolver() -> ScopeResolver:
    return ScopeResolver(config_client=FakeConfigClient())


def dept_identity(path: str | None = "/0/1/A/", n_anchors: int = 1) -> AskIdentity:
    anchors = [
        {"id": "A", "path": path, "scope": "dept_subtree"} for _ in range(n_anchors)
    ]
    return AskIdentity(
        user_id=1,
        role_codes=["SALES"],
        raw_headers={"X-Mis-Dept-Scope": json.dumps(anchors)},
    )


def store_identity(codes: list[str] | None = None) -> AskIdentity:
    codes = codes or ["S1", "S2"]
    return AskIdentity(
        user_id=1,
        role_codes=["SALES"],
        raw_headers={"X-Mis-Stores": json.dumps(codes)},
    )


def dept_store_identity() -> AskIdentity:
    return AskIdentity(
        user_id=1,
        role_codes=["SALES"],
        raw_headers={
            "X-Mis-Dept-Scope": '[{"id":"A","path":"/0/1/A/","scope":"dept_subtree"}]',
            "X-Mis-Stores": '["S1","S2"]',
        },
    )


def no_header_identity() -> AskIdentity:
    return AskIdentity(user_id=1, role_codes=["SALES"], raw_headers={})


def resolution_for(table: str, rules: list[dict]) -> IqdScopeResolution:
    return IqdScopeResolution(
        decision="allow",
        allowed_item_keys=[table],
        row_scope_rules={table: rules},
        connection_id=1,
    )


def run_inject(resolver, sql, resolution, identity):
    return asyncio.run(resolver.inject_row_scope(sql, "postgres", resolution, identity))


# ================================================================ 单表注入


def test_inject_single_table_dept_path_prefix():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert "mis_dept_scope" in out.sql
    assert "dept_path = '/0/1/A/'" in out.sql
    assert "dept_path LIKE" in out.sql
    assert out.dimensions == ["dept"]


def test_inject_single_table_store_enum():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "store"}])
    out = run_inject(resolver, sql, resolution, store_identity(["S1", "S2"]))
    assert out.verdict == "allow", out.denied_reason
    assert "store_id IN ('S1', 'S2')" in out.sql
    assert out.dimensions == ["store"]


# ================================================================ 多表/复杂形态（P0-3）


def test_inject_join_both_tables():
    """P0-3：JOIN 两表都有规则时逐表注入，且保留 LEFT JOIN 语义。"""
    resolver = make_resolver()
    sql = (
        "SELECT o.id, d.name FROM pg_main.public.orders o "
        "LEFT JOIN pg_main.public.departments d ON o.dept_id = d.id"
    )
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    resolution.row_scope_rules["pg_main.public.departments"] = [{"dimension": "dept"}]
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert out.sql.count("(SELECT * FROM") >= 2, out.sql
    assert "LEFT JOIN" in out.sql
    assert out.sql.count("mis_dept_scope") >= 2, out.sql


def test_inject_join_dict_alias_isolated():
    """P0-3 + 别名隔离：外层表别名 d 时，字典别名 rs 不冲突，谓词不退化自引用。"""
    resolver = make_resolver()
    sql = (
        "SELECT o.id, d.name FROM pg_main.public.orders o "
        "LEFT JOIN pg_main.public.departments d ON o.dept_id = d.id"
    )
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    resolution.row_scope_rules["pg_main.public.departments"] = [{"dimension": "dept"}]
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    # 两个派生表分别引用各自外层别名（o / d），不得出现 rs.dept_id = rs.dept_id 自引用
    assert "rs.dept_id = o.dept_id" in out.sql
    assert "rs.dept_id = d.dept_id" in out.sql
    assert "rs.dept_id = rs.dept_id" not in out.sql


def test_inject_like_path_single_slash():
    """回归：path 以 / 结尾时 LIKE 不得产生双斜杠（/0/1/A//%）。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert "LIKE '/0/1/A/%'" in out.sql
    assert "//%" not in out.sql


def test_inject_cte():
    resolver = make_resolver()
    sql = (
        "WITH t AS (SELECT dept_id, SUM(amount) s FROM pg_main.public.orders GROUP BY dept_id) "
        "SELECT * FROM t"
    )
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert "mis_dept_scope" in out.sql


def test_inject_union_branches():
    resolver = make_resolver()
    sql = (
        "SELECT store_id, amount FROM pg_main.public.orders WHERE store_id='S1' "
        "UNION ALL "
        "SELECT store_id, amount FROM pg_main.public.orders WHERE store_id='S2'"
    )
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "store"}])
    out = run_inject(resolver, sql, resolution, store_identity(["S1", "S2"]))
    assert out.verdict == "allow", out.denied_reason
    assert "UNION ALL" in out.sql
    assert out.sql.count("store_id IN") >= 1


def test_inject_unqualified_table_name():
    """未限定表名（FROM orders）匹配规则键（orders）。"""
    resolver = make_resolver()
    sql = "SELECT * FROM orders"
    resolution = resolution_for("orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert "mis_dept_scope" in out.sql


# ================================================================ 多维度 AND


def test_inject_double_dimension_and():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    rules = [{"dimensions": [{"dimension": "dept"}, {"dimension": "store"}]}]
    resolution = resolution_for("pg_main.public.orders", rules)
    out = run_inject(resolver, sql, resolution, dept_store_identity())
    assert out.verdict == "allow", out.denied_reason
    assert out.dimensions == ["dept", "store"], out.dimensions
    assert "mis_dept_scope" in out.sql
    assert "store_id IN ('S1', 'S2')" in out.sql


def test_inject_multi_rule_single_table_and():
    """同表两条独立规则（dept + store）叠加 AND。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    rules = [{"dimension": "dept"}, {"dimension": "store"}]
    resolution = resolution_for("pg_main.public.orders", rules)
    out = run_inject(resolver, sql, resolution, dept_store_identity())
    assert out.verdict == "allow", out.denied_reason
    assert out.dimensions == ["dept", "store"], out.dimensions
    assert "mis_dept_scope" in out.sql
    assert "store_id IN ('S1', 'S2')" in out.sql


# ================================================================ fail-closed 路径


def test_inject_header_missing_fails_closed():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, no_header_identity())
    assert out.verdict == "deny"
    assert out.strategy == PREDICATE_FAIL_CLOSED
    assert out.denied_reason


def test_inject_store_header_missing_fails_closed():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "store"}])
    out = run_inject(resolver, sql, resolution, no_header_identity())
    assert out.verdict == "deny"


def test_inject_unknown_dimension_fails_closed():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "unknown_xyz"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "deny"
    assert "未配置" in (out.denied_reason or "")


def test_inject_unparseable_sql_fails_closed():
    resolver = make_resolver()
    sql = "SELEC * FRM pg_main.public.orders WHERE"  # 语法错误
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "deny"
    assert "解析失败" in (out.denied_reason or "")


def test_inject_no_row_scope_denies_fail_closed():
    """无命中行级规则 + 非 ALL → fail-closed（缺失必须显式 X-Mis-Data-Scope: all）。"""
    from src.agent.mis_iqd.errors import ScopeDeniedError

    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=["pg_main.public.orders"],
        row_scope_rules={},
        connection_id=1,
    )
    with pytest.raises(ScopeDeniedError):
        run_inject(resolver, sql, resolution, no_header_identity())


def test_inject_no_row_scope_with_all_scope_skips_injection():
    """显式 X-Mis-Data-Scope: all → 跳过行级注入，原样返回（NONE）。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=["pg_main.public.orders"],
        row_scope_rules={},
        connection_id=1,
    )
    identity = no_header_identity()
    identity.data_scope_all = True
    out = run_inject(resolver, sql, resolution, identity)
    assert out.verdict == "allow"
    assert out.sql == sql
    assert out.strategy == "NONE"


# ================================================================ P1-4 越权显式引用


def test_inject_explicit_unauthorized_dept_deny():
    """授权 A 下用户写 dept_id='B' → 45204 拒绝（不静默空集）。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders WHERE dept_id = 'B'"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "deny"
    assert "未授权" in (out.denied_reason or "")


def test_inject_explicit_qualified_unauthorized_dept_deny():
    """带表别名限定列 o.dept_id='B' 同样 45204 拒绝。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders o WHERE o.dept_id = 'B'"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "deny"


def test_inject_explicit_authorized_dept_idempotent():
    """授权集合内（含层级子 id 前缀）幂等放行，不重复注入。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders WHERE dept_id IN ('A','A1')"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert out.sql.count("mis_dept_scope") <= 1, out.sql


def test_inject_explicit_unauthorized_store_deny():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders WHERE store_id = 'S9'"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "store"}])
    out = run_inject(resolver, sql, resolution, store_identity(["S1", "S2"]))
    assert out.verdict == "deny"
    assert "未授权" in (out.denied_reason or "")


def test_inject_explicit_authorized_store_allow():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders WHERE store_id = 'S1'"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "store"}])
    out = run_inject(resolver, sql, resolution, store_identity(["S1", "S2"]))
    assert out.verdict == "allow", out.denied_reason
    assert out.sql.count("store_id IN") >= 1


def test_inject_explicit_unauthorized_in_list_deny():
    """IN 列表内混入越权值 → 45204 拒绝。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders WHERE store_id IN ('S1','S9')"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "store"}])
    out = run_inject(resolver, sql, resolution, store_identity(["S1", "S2"]))
    assert out.verdict == "deny"


def test_inject_explicit_join_on_columns_not_denied():
    """JOIN ON 条件（o.dept_id = d.id）是列引用不是字面量 → 不误判越权。"""
    resolver = make_resolver()
    sql = (
        "SELECT o.id, d.name FROM pg_main.public.orders o "
        "JOIN pg_main.public.departments d ON o.dept_id = d.id"
    )
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert "mis_dept_scope" in out.sql


# ================================================================ P1-6 维度来源


def test_inject_dept_enum_downgrade_uses_dept_anchors():
    """dept 无 path 降级 ENUM：谓词用 dept 锚点 id，不得误用门店编码。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    identity = dept_identity(path="")
    out = run_inject(resolver, sql, resolution, identity)
    assert out.verdict == "allow", out.denied_reason
    assert "dept_id IN ('A')" in out.sql
    assert "store_id" not in out.sql


def test_inject_store_enum_uses_store_codes():
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "store"}])
    out = run_inject(resolver, sql, resolution, store_identity(["S1", "S2"]))
    assert out.verdict == "allow", out.denied_reason
    assert "store_id IN ('S1', 'S2')" in out.sql


# ================================================================ 边界


def test_inject_empty_sql_without_rules_denies_fail_closed():
    """空 SQL + 无行级规则 + 非 ALL → 同样 fail-closed。"""
    from src.agent.mis_iqd.errors import ScopeDeniedError

    resolver = make_resolver()
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=["pg_main.public.orders"],
        row_scope_rules={},
        connection_id=1,
    )
    with pytest.raises(ScopeDeniedError):
        run_inject(resolver, "", resolution, no_header_identity())


def test_inject_outcome_payload_audit_fields():
    """审计字段：deny 时 sql 保持原始但 verdict=deny + FAIL_CLOSED。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders WHERE dept_id = 'B'"
    resolution = resolution_for("pg_main.public.orders", [{"dimension": "dept"}])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    payload = out.to_payload()
    assert payload["verdict"] == "deny"
    assert payload["strategy"] == PREDICATE_FAIL_CLOSED
    assert payload["original_sql"] == sql
    assert out.sql == sql  # deny 时保持原始（上层不得执行）




# ================================================================ P3-1 Object-level column override


def test_inject_column_override_enum():
    """对象级 column 覆盖生效：ENUM 策略使用覆盖列名而非维度全局列。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.stores"
    resolution = resolution_for("pg_main.public.stores", [
        {"dimensions": [{"dimension": "store", "column": "shop_no"}]}
    ])
    out = run_inject(resolver, sql, resolution, store_identity(["S1", "S2"]))
    assert out.verdict == "allow", out.denied_reason
    assert "shop_no IN ('S1', 'S2')" in out.sql
    assert "store_id IN" not in out.sql
    assert out.dimensions == ["store"]


def test_inject_column_override_path_prefix():
    """对象级 column 覆盖生效：PATH_PREFIX 策略的 EXISTS 子句使用覆盖列名。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.sales"
    resolution = resolution_for("pg_main.public.sales", [
        {"dimension": "dept", "column": "org_dept_code"}
    ])
    out = run_inject(
        resolver, sql, resolution,
        dept_identity(path="/0/1/A/"),
    )
    assert out.verdict == "allow", out.denied_reason
    # EXISTS clause should reference org_dept_code, not default dept_id
    assert "rs.dept_id = sales.org_dept_code" in out.sql
    assert "org_dept_code" in out.sql


def test_inject_no_override_fallback_to_global():
    """未写 column 时回落维度全局列（保持零回归）。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [
        {"dimensions": [{"dimension": "dept"}]}
    ])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    assert "mis_dept_scope" in out.sql
    # Default column is dept_id for dept dimension
    assert "rs.dept_id = orders.dept_id" in out.sql


def test_inject_invalid_column_fail_closed():
    """非法 column  SQL 注入字符 → fail-closed (45204)。"""
    from src.agent.mis_iqd.errors import ScopeDeniedError

    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [
        {"dimension": "dept", "column": "dept_id; DROP TABLE --"}
    ])

    try:
        _ = asyncio.run(resolver._effective_column(
            next(d for d in _builtin_dimensions() if d.dimension_code == "dept"),
            {"dimension": "dept", "column": "dept_id; DROP TABLE --"},
        ))
        assert False, "Should have raised ScopeDeniedError"
    except ScopeDeniedError as exc:
        assert "行级覆盖列名非法" in str(exc) or "非法" in str(exc)


def test_inject_empty_column_fallback():
    """空字符串 column 回落到维度全局列。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.orders"
    resolution = resolution_for("pg_main.public.orders", [
        {"dimensions": [{"dimension": "dept", "column": ""}]}
    ])
    out = run_inject(resolver, sql, resolution, dept_identity(path="/0/1/A/"))
    assert out.verdict == "allow", out.denied_reason
    # Should fall back to default dept_id column
    assert "rs.dept_id = orders.dept_id" in out.sql


def test_inject_multi_dim_mixed_columns():
    """多度混合：部分有覆盖列，部分无覆盖列（混用）。"""
    resolver = make_resolver()
    sql = "SELECT * FROM pg_main.public.complex_report"
    resolution = resolution_for("pg_main.public.complex_report", [
        {
            "dimensions": [
                {"dimension": "dept", "column": "department_key"},
                {"dimension": "store"},  # no override → uses global store_id
            ]
        }
    ])
    identity = dept_store_identity()
    out = run_inject(resolver, sql, resolution, identity)
    assert out.verdict == "allow", out.denied_reason
    # dept should use override column
    assert "department_key" in out.sql
    # store should use global column
    assert "store_id IN" in out.sql


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
