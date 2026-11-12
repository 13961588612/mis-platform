"""cube 子节点物化 + T03e「未生效编辑」判定口径。

<p><b>为什么钉</b>（2026-09-28 真机实测踩到）：平台创建 cube 时 `display_name` 是中文
（「门店销售」），物化进 MDL 时 `name` 取的是 **display_name 优先**；而它的
measure/dimension 子节点按 `parent_key="mdl:cube:sale_by_store"` 的 **tail** 挂靠。
只按 name 建索引 → 查不到宿主 → 子节点被**静默丢弃** → 引擎里 cube 成了空壳
（`cubes[0].measures == []`），建模台配的度量维度等于白配。
"""

from __future__ import annotations

from src.agent.mis_iqd.service import IqdAskService


def test_unmatched_ignores_imported_columns_and_display_rows():
    """口径收窄：导入的物理列 / 展示用 table 行不算「编辑未生效」；真有 patch 的才算。

    实测背景：900001 旧口径报 58 条「未生效」，其中 57 条是表发现导入的物理列
    （``display_name`` 只是列名回显）、1 条是展示用 table 行 —— 全是噪音，
    真需要提醒的只有「改过 description/expression 的列」和「新建的 view/cube/metric」。
    """
    edited = [
        # 导入的物理列：display_name 是同名回显，desc/expr 皆空 → 不算
        {"item_key": "ads_x.data_type", "kind": "column", "display_name": "data_type"},
        # 平台侧展示用行 → 不算
        {"item_key": "ads_x", "kind": "table", "display_name": "ads_x"},
        # 真编辑过 description 的物理列 → 算（这条现在确实进不了 MDL，值得提醒）
        {
            "item_key": "ads_x.ord_date",
            "kind": "column",
            "display_name": "ord_date",
            "description": "销售日期",
        },
        # 新建 view（无物化能力）→ 算
        {"item_key": "mdl:view:v1", "kind": "view", "display_name": "新视图"},
    ]
    out = IqdAskService._collect_unmatched_edits(edited, set())

    assert [o["item_key"] for o in out] == ["ads_x.ord_date", "mdl:view:v1"], out


def test_physical_column_edit_lands_via_two_part_key():
    """``<table>.<column>`` 两段式键：改列描述必须落到 model.columns（且不改列名）。"""
    mdl = _empty_mdl()
    mdl["models"].append(
        {
            "name": "ads_sale",
            "columns": [
                {"name": "ord_date", "type": "VARCHAR", "description": None},
                {"name": "kds", "type": "DECIMAL"},
            ],
        }
    )

    landed = IqdAskService._patch_mdl_node(
        mdl,
        "ads_sale.ord_date",
        "column",
        {"item_key": "ads_sale.ord_date", "kind": "column", "display_name": "ord_date",
         "description": "销售日期"},
    )

    assert landed is True
    col = mdl["models"][0]["columns"][0]
    assert col["description"] == "销售日期"
    # 关键：列名不得被 display_name 改写（MDL 列名是引用锚点）
    assert col["name"] == "ord_date"


def test_physical_column_edit_no_longer_reported_as_unmatched():
    """修好映射后，改过描述的物理列应计入 landed → 不再出现在「编辑未生效」清单。"""
    mdl = _empty_mdl()
    mdl["models"].append({"name": "ads_sale", "columns": [{"name": "ord_date"}]})
    edited = [
        {
            "item_key": "ads_sale.ord_date",
            "kind": "column",
            "display_name": "ord_date",
            "description": "销售日期",
        }
    ]
    landed: set[int] = set()
    IqdAskService._materialize_missing_nodes(mdl, edited, landed)
    for idx, it in enumerate(edited):
        if IqdAskService._patch_mdl_node(mdl, it["item_key"], it["kind"], it):
            landed.add(idx)

    assert IqdAskService._collect_unmatched_edits(edited, landed) == []


def _empty_mdl() -> dict:
    return {
        "models": [],
        "relationships": [],
        "cubes": [],
        "views": [],
        "metrics": [],
        "dimensions": [],
    }


def test_measures_land_when_cube_named_by_display_name():
    """cube 用中文 display_name 作 MDL name 时，子节点仍按 tail 挂靠上。"""
    mdl = _empty_mdl()
    edited = [
        {
            "item_key": "mdl:cube:sale_by_store",
            "kind": "cube",
            "display_name": "门店销售",
            "model_ref": "mdl:model:ads_sale",
        },
        {
            "item_key": "mdl:measure:sale_by_store.kds_sum",
            "kind": "measure",
            "parent_key": "mdl:cube:sale_by_store",
            "display_name": "kds_sum",
            "expression": "SUM(kds)",
            "data_type": "DECIMAL",
        },
        {
            "item_key": "mdl:dimension:sale_by_store.store_id",
            "kind": "dimension",
            "parent_key": "mdl:cube:sale_by_store",
            "display_name": "store_id",
            "expression": "store_id",
        },
    ]
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)

    assert len(mdl["cubes"]) == 1, mdl["cubes"]
    cube = mdl["cubes"][0]
    assert cube["name"] == "门店销售"
    assert cube["baseObject"] == "ads_sale"
    assert [m["name"] for m in cube["measures"]] == ["kds_sum"], cube
    assert cube["measures"][0]["expression"] == "SUM(kds)"
    assert [d["name"] for d in cube["dimensions"]] == ["store_id"], cube
    # 三个编辑项都算「已落入」（否则前端会误报「编辑未生效」）
    assert landed == {0, 1, 2}, landed


def test_measures_land_for_existing_baseline_cube():
    """基线里已有该 cube（按 tail 命中）时，新加的 measure 也要挂上去。"""
    mdl = _empty_mdl()
    mdl["cubes"].append({"name": "sale_by_store", "measures": [], "dimensions": []})
    edited = [
        {"item_key": "mdl:cube:sale_by_store", "kind": "cube", "display_name": "门店销售"},
        {
            "item_key": "mdl:measure:sale_by_store.ord_cnt",
            "kind": "measure",
            "parent_key": "mdl:cube:sale_by_store",
            "display_name": "ord_cnt",
            "expression": "COUNT(DISTINCT ord_id)",
        },
    ]
    landed: set[int] = set()
    IqdAskService()._materialize_missing_nodes(mdl, edited, landed)

    assert len(mdl["cubes"]) == 1, mdl["cubes"]
    assert [m["name"] for m in mdl["cubes"][0]["measures"]] == ["ord_cnt"], mdl["cubes"][0]
    assert landed == {0, 1}, landed
