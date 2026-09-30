"""全新 model（from-table 路径）物化单测（2026-09-28）。

<背景>
``_materialize_missing_nodes`` 此前**刻意不物化全新 model** —— 真实 MDL 的 model schema
（``tableReference`` / ``columns`` 必填项）未经真机校准，盲写可能产出非法 MDL 打挂整条 build。

2026-09-28 已从真机 ``mdl_raw`` 校准 schema::

    model = {name, tableReference{catalog,schema,table},
             columns[{name,type,notNull,properties,isCalculated[,expression,isPrimaryKey]}],
             primaryKey[], cached, properties}

因此现在可以安全物化：**以基线任一既有 model 的 tableReference 为模板**取 catalog/schema
（同连接同库），只替换 table；基线无 model 可参照时**跳过**（宁可留在 unmatched 清单）。
"""

from __future__ import annotations

from src.agent.mis_iqd.service import IqdAskService


def _baseline() -> dict:
    """带一个既有 model 的基线（提供 tableReference 模板）。"""
    return {
        "models": [
            {
                "name": "existing_tbl",
                "tableReference": {"catalog": "", "schema": "adhoc", "table": "existing_tbl"},
                "columns": [{"name": "c", "type": "VARCHAR", "notNull": False,
                             "properties": {}, "isCalculated": False}],
                "cached": False,
                "properties": {},
            }
        ],
        "relationships": [],
        "cubes": [],
        "views": [],
        "metrics": [],
        "dimensions": [],
    }


def _edited_new_table() -> list[dict]:
    """模拟 from-table 导入：table + N 列 + model 三类行。"""
    return [
        {"item_key": "new_orders", "kind": "table", "display_name": "new_orders"},
        {"item_key": "new_orders.id", "kind": "column", "parent_key": "new_orders",
         "display_name": "id", "data_type": "BIGINT", "is_primary_key": True},
        {"item_key": "new_orders.amount", "kind": "column", "parent_key": "new_orders",
         "display_name": "amount", "data_type": "DOUBLE"},
        {"item_key": "new_orders.customer", "kind": "column", "parent_key": "new_orders",
         "display_name": "customer", "data_type": "VARCHAR", "description": "客户名"},
        # 计算列（isCalculated + expression）
        {"item_key": "calc:new_orders.amount_x2", "kind": "column", "parent_key": "new_orders",
         "display_name": "amount_x2", "expression": "amount * 2"},
        {"item_key": "mdl:model:new_orders", "kind": "model", "display_name": "new_orders",
         "description": "新订单模型"},
    ]


def test_new_model_is_materialized() -> None:
    mdl = _baseline()
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, _edited_new_table(), landed)

    model = next(m for m in mdl["models"] if m["name"] == "new_orders")
    # 模板 tableReference 继承 catalog/schema，只换 table
    assert model["tableReference"]["schema"] == "adhoc"
    assert model["tableReference"]["table"] == "new_orders"
    # 列：物理列带 type；计算列带 isCalculated + expression
    names = [c["name"] for c in model["columns"]]
    assert names == ["id", "amount", "customer", "amount_x2"], names
    calc = next(c for c in model["columns"] if c["name"] == "amount_x2")
    assert calc["isCalculated"] is True and calc["expression"] == "amount * 2"


def test_new_model_carries_primary_key_and_description() -> None:
    mdl = _baseline()
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, _edited_new_table(), landed)

    model = next(m for m in mdl["models"] if m["name"] == "new_orders")
    assert model["primaryKey"] == ["id"]
    assert model["properties"]["description"] == "新订单模型"
    # 列描述透传
    customer = next(c for c in model["columns"] if c["name"] == "customer")
    assert customer["properties"]["description"] == "客户名"


def test_new_model_marked_landed() -> None:
    """物化成功 → 该 model 行进入 landed（不再报「编辑未生效」）。"""
    mdl = _baseline()
    edited = _edited_new_table()
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)

    model_idx = next(i for i, it in enumerate(edited) if it["item_key"] == "mdl:model:new_orders")
    assert model_idx in landed


def test_new_model_skipped_when_no_baseline_template() -> None:
    """基线无任何可参照 model → 跳过（fail-safe），并留在 unmatched。"""
    mdl = {"models": [], "relationships": [], "cubes": [], "views": [], "metrics": [], "dimensions": []}
    edited = _edited_new_table()
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)

    assert all(m["name"] != "new_orders" for m in mdl["models"]), "不得盲写"
    model_idx = next(i for i, it in enumerate(edited) if it["item_key"] == "mdl:model:new_orders")
    assert model_idx not in landed


def test_new_model_skipped_when_no_columns() -> None:
    """没有列 → 不建空模型（build 会因无列失败）。"""
    mdl = _baseline()
    edited = [
        {"item_key": "empty_tbl", "kind": "table", "display_name": "empty_tbl"},
        {"item_key": "mdl:model:empty_tbl", "kind": "model", "display_name": "empty_tbl"},
    ]
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)
    assert all(m["name"] != "empty_tbl" for m in mdl["models"])


def test_existing_model_not_duplicated() -> None:
    """基线已有同名 model → 不重复添加（幂等），且标记 landed 由 patch 负责。"""
    mdl = _baseline()
    edited = [{"item_key": "mdl:model:existing_tbl", "kind": "model", "display_name": "existing_tbl"}]
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)
    assert len([m for m in mdl["models"] if m["name"] == "existing_tbl"]) == 1
    assert 0 in landed


# ================================================================ 无基线派生（新连接 / mdl_raw=null）

def test_derive_table_reference_from_physical_key() -> None:
    """``{datasource}.{schema}.{table}`` → ``{catalog:'', schema, table}``（真机实测口径）。"""
    ref = IqdAskService._derive_table_reference("pg_main.adhoc.sale_ord")
    assert ref == {"catalog": "", "schema": "adhoc", "table": "sale_ord"}


def test_derive_table_reference_rejects_short_key() -> None:
    """不足两段 → 不盲猜 schema，返回 None。"""
    assert IqdAskService._derive_table_reference("sale_ord") is None
    assert IqdAskService._derive_table_reference("") is None
    assert IqdAskService._derive_table_reference(None) is None


def _edited_no_baseline() -> list[dict]:
    """模拟 from-table 导入但连接尚无 mdl_raw（test 连接的 273 edited_items 同形）。"""
    return [
        {"item_key": "pg_main.adhoc.sale_ord", "kind": "table",
         "display_name": "sale_ord"},
        {"item_key": "pg_main.adhoc.sale_ord.id", "kind": "column",
         "parent_key": "pg_main.adhoc.sale_ord", "display_name": "id",
         "data_type": "BIGINT", "is_primary_key": True},
        {"item_key": "pg_main.adhoc.sale_ord.amount", "kind": "column",
         "parent_key": "pg_main.adhoc.sale_ord", "display_name": "amount",
         "data_type": "DOUBLE"},
        {"item_key": "mdl:model:sale_ord", "kind": "model",
         "display_name": "sale_ord", "description": "订单"},
    ]


def test_new_model_materialized_without_baseline_uses_derived_table_reference() -> None:
    """无 mdl_raw 基线时，也能从 table item_key 推导 tableReference 物化出模型。

    <背景>修复前：无基线 → 无 tableReference 模板 → 新建 model 全部跳过 →
    发布/强制重建产出 **0 models**（test 连接 force-rebuild 的真实故障）。
    """
    mdl = {"models": [], "relationships": [], "cubes": [], "views": [], "metrics": [], "dimensions": []}
    edited = _edited_no_baseline()
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)

    model = next(m for m in mdl["models"] if m["name"] == "sale_ord")
    assert model["tableReference"] == {"catalog": "", "schema": "adhoc", "table": "sale_ord"}
    names = [c["name"] for c in model["columns"]]
    assert names == ["id", "amount"], names
    assert model["primaryKey"] == ["id"]
    assert model["properties"]["description"] == "订单"
    model_idx = next(i for i, it in enumerate(edited) if it["item_key"] == "mdl:model:sale_ord")
    assert model_idx in landed


def test_new_model_without_derivable_key_still_skipped() -> None:
    """table item_key 不足以推导 schema（无点分段）时，仍不盲写（fail-safe）。"""
    mdl = {"models": [], "relationships": [], "cubes": [], "views": [], "metrics": [], "dimensions": []}
    edited = [
        {"item_key": "sale_ord", "kind": "table", "display_name": "sale_ord"},
        {"item_key": "sale_ord.id", "kind": "column", "parent_key": "sale_ord",
         "display_name": "id", "data_type": "BIGINT"},
        {"item_key": "mdl:model:sale_ord", "kind": "model", "display_name": "sale_ord"},
    ]
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)
    assert all(m["name"] != "sale_ord" for m in mdl["models"])
