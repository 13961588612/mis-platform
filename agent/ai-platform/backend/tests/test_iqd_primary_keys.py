"""主键回填（``_apply_primary_keys``）：平台 catalog 权威 + **只增不减**保护。

<p><b>为什么钉</b>（2026-09-28 真机排查）：wren 原生 MDL 里本有主键（`context show` 显示
`pk=[…]`），但「平台派生 MDL →（反向导入）覆盖 `mdl_raw` 基线」的自循环把主键洗成了空
（实测：平台 catalog 192 列 `is_primary_key` 全 0、`mdl_raw` 无 `primaryKey`）。
主键缺失会影响 wren 的去重/聚合/join 基数推断 —— 即「SUM 类度量是否重复计数」。

<p>两条护栏：
<ol>
  <li>catalog 明确标主键 → 回写列级 `isPrimaryKey` + 模型顶层 `primaryKey`（复合主键=列表）；</li>
  <li>catalog **没有**该表主键信息 → **一律不动基线**（绝不把基线里的主键清空，
      否则又是把 PK 洗掉的机制）。</li>
</ol>
"""

from __future__ import annotations

from src.agent.mis_iqd.service import IqdAskService


def _mdl_with_columns(*names: str) -> dict:
    return {
        "models": [
            {
                "name": "ads_sale",
                "columns": [{"name": n, "type": "VARCHAR"} for n in names],
            }
        ],
        "relationships": [],
        "cubes": [],
        "views": [],
        "metrics": [],
        "dimensions": [],
    }


def test_primary_keys_backfilled_from_catalog():
    """catalog 标了复合主键 → 列级 + 模型顶层都写回。"""
    mdl = _mdl_with_columns("store_id", "ord_date", "kds")
    catalog = [
        {"kind": "column", "item_key": "ads_sale.store_id", "is_primary_key": True},
        {"kind": "column", "item_key": "ads_sale.ord_date", "is_primary_key": True},
        {"kind": "column", "item_key": "ads_sale.kds", "is_primary_key": False},
    ]

    applied = IqdAskService._apply_primary_keys(mdl, catalog)

    model = mdl["models"][0]
    assert applied == 1
    assert model["primaryKey"] == ["store_id", "ord_date"]
    flags = {c["name"]: c.get("isPrimaryKey") for c in model["columns"]}
    assert flags == {"store_id": True, "ord_date": True, "kds": None}


def test_catalog_without_pk_info_leaves_baseline_untouched():
    """catalog 全 false（平台侧没存过主键）→ 绝不清空基线里的主键。"""
    mdl = _mdl_with_columns("store_id", "kds")
    mdl["models"][0]["primaryKey"] = ["store_id"]
    mdl["models"][0]["columns"][0]["isPrimaryKey"] = True
    catalog = [
        {"kind": "column", "item_key": "ads_sale.store_id", "is_primary_key": False},
        {"kind": "column", "item_key": "ads_sale.kds", "is_primary_key": False},
    ]

    applied = IqdAskService._apply_primary_keys(mdl, catalog)

    assert applied == 0
    assert mdl["models"][0]["primaryKey"] == ["store_id"]
    assert mdl["models"][0]["columns"][0]["isPrimaryKey"] is True


def test_existing_top_level_primary_key_not_overwritten():
    """基线已有顶层 primaryKey（顺序有意义）→ 只补列标记，不改写顶层值。"""
    mdl = _mdl_with_columns("a", "b")
    mdl["models"][0]["primaryKey"] = ["b", "a"]
    catalog = [
        {"kind": "column", "item_key": "ads_sale.a", "is_primary_key": True},
        {"kind": "column", "item_key": "ads_sale.b", "is_primary_key": True},
    ]

    IqdAskService._apply_primary_keys(mdl, catalog)

    assert mdl["models"][0]["primaryKey"] == ["b", "a"]
    assert all(c.get("isPrimaryKey") for c in mdl["models"][0]["columns"])
