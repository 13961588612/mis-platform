"""脱敏在「真实 run_sql 列形状」下的回归测试（2026-09-28 真机实测驱动）。

<Bug（安全级）>
真实 ``wren run_sql`` 返回的 ``columns`` 是**纯列名字符串数组**（如 ``["store_name"]``），
**不含表前缀**；而 catalog 的 ``item_key`` 形如 ``<table>.<column>``。
旧实现只按整串 item_key 建索引 → 字符串列名永远查不到 meta → ``_resolve_rule`` 返回 None
→ **脱敏静默失效**（敏感列明文返回真实数据）。此前单测用 dict 形状的 columns，掩盖了该缺陷。
"""

from __future__ import annotations

from src.agent.mis_iqd.masking import MaskingEngine
from src.models.iqd_schema import ColumnMeta

CATALOG = [
    {
        "item_key": "ads_df.store_name",
        "kind": "column",
        "data_type": "STRING",
        "sensitive_level": "high",
        "mask_rule": "mask-phone",
    },
    {"item_key": "ads_df.store_id", "kind": "column", "data_type": "STRING", "sensitive_level": "none"},
]
RULES = [{"name": "mask-phone", "enabled": True, "algorithm": "phone"}]


async def _engine() -> MaskingEngine:
    return MaskingEngine(config_client=None)


# ---------------------------------------------------------------- 核心回归


async def test_masks_with_string_columns() -> None:
    """真机形状：columns 为字符串数组 → 必须仍能命中脱敏（旧实现漏脱敏）。"""
    eng = MaskingEngine(config_client=None)
    out = await eng.apply(
        ["store_name"],
        [["金坛南门店"]],
        connection_id=1,
        catalog_items=CATALOG,
        mask_rules=RULES,
    )
    assert out.masked_columns == ["store_name"], "字符串列名必须通过别名索引命中 catalog"
    assert out.rows == [["****"]], "明文必须被脱敏"


async def test_masks_with_dict_columns() -> None:
    """对照：dict 形状（带 item_key）同样脱敏（不能因为修 A 破坏 B）。"""
    eng = MaskingEngine(config_client=None)
    cols = [ColumnMeta(name="store_name", item_key="ads_df.store_name", data_type="STRING")]
    out = await eng.apply(
        cols, [["金坛南门店"]], connection_id=1, catalog_items=CATALOG, mask_rules=RULES
    )
    assert out.masked_columns == ["store_name"]
    assert out.rows == [["****"]]


async def test_unconfigured_column_untouched() -> None:
    """未配脱敏的列不受影响（避免过度脱敏）。"""
    eng = MaskingEngine(config_client=None)
    out = await eng.apply(
        ["store_id"], [["0027"]], connection_id=1, catalog_items=CATALOG, mask_rules=RULES
    )
    assert out.masked_columns == []
    assert out.rows == [["0027"]]


async def test_same_column_name_any_match_masks() -> None:
    """fail-closed：同名列在多表且只有一张配了脱敏时，仍按脱敏处理（不漏）。"""
    catalog = [
        {"item_key": "a.store_name", "kind": "column", "sensitive_level": "none"},
        {"item_key": "b.store_name", "kind": "column", "sensitive_level": "high"},
    ]
    eng = MaskingEngine(config_client=None)
    out = await eng.apply(
        ["store_name"], [["某店"]], connection_id=1, catalog_items=catalog, mask_rules=RULES
    )
    assert out.masked_columns == ["store_name"], "任一 catalog 条目要求脱敏即脱敏"


async def test_unknown_column_not_masked() -> None:
    """catalog 里没有的列 → 不脱敏（也不报错）。"""
    eng = MaskingEngine(config_client=None)
    out = await eng.apply(
        ["unknown_col"], [["x"]], connection_id=1, catalog_items=CATALOG, mask_rules=RULES
    )
    assert out.masked_columns == []
    assert out.rows == [["x"]]
