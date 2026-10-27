"""MaskingEngine：run_sql 列形态（str / dict / ColumnMeta）归一化。"""

from __future__ import annotations

import asyncio

from src.agent.mis_iqd.masking import MaskingEngine
from src.models.iqd_schema import ColumnMeta


def test_as_column_meta_str_dict_and_object() -> None:
    assert MaskingEngine._as_column_meta("store_name").name == "store_name"
    assert MaskingEngine._as_column_meta({"name": "amt", "data_type": "decimal"}).data_type == "decimal"
    meta = ColumnMeta(name="x", item_key="x")
    assert MaskingEngine._as_column_meta(meta) is meta


def test_apply_accepts_string_columns() -> None:
    engine = MaskingEngine(config_client=_StubConfig())

    async def _run() -> None:
        outcome = await engine.apply(
            ["store_name", "phone"],
            [["门店A", "13812345678"], ["门店B", "13900001111"]],
            connection_id=1,
            catalog_items=[],
            mask_rules=[
                {
                    "name": "phone",
                    "match_type": "column_name",
                    "pattern": "phone",
                    "rule": "phone",
                    "priority": 1,
                    "enabled": True,
                }
            ],
        )
        assert len(outcome.columns) == 2
        assert all(isinstance(c, ColumnMeta) for c in outcome.columns)
        assert "phone" in outcome.masked_columns
        assert outcome.rows[0][1] == "138****5678"

    asyncio.run(_run())


def test_apply_enriches_display_name_from_catalog_description() -> None:
    """建模备注 → 结果列 display_name，供表头/对话解释中文口径。"""
    engine = MaskingEngine(config_client=_StubConfig())

    async def _run() -> None:
        outcome = await engine.apply(
            ["qtml", "zhml", "store_id"],
            [[1.0, 2.0, "0001"]],
            connection_id=1,
            catalog_items=[
                {
                    "item_key": "pg_main.spm_result.ads_spm_trd_cpi_category_day_df.qtml",
                    "kind": "column",
                    "display_name": "qtml",
                    "description": "前台毛利（含税）",
                    "data_type": "DOUBLE",
                },
                {
                    "item_key": "pg_main.spm_result.ads_spm_trd_cpi_category_day_df.zhml",
                    "kind": "column",
                    "display_name": "zhml",
                    "description": "综合毛利（含税）",
                },
                {
                    "item_key": "pg_main.spm_result.ads_spm_trd_cpi_category_day_df.store_id",
                    "kind": "column",
                    "display_name": "store_id",
                    "description": "",
                },
            ],
            mask_rules=[],
        )
        by_name = {c.name: c for c in outcome.columns}
        assert by_name["qtml"].display_name == "前台毛利（含税）"
        assert by_name["zhml"].display_name == "综合毛利（含税）"
        assert by_name["store_id"].display_name == "store_id"
        assert "qtml" in by_name["qtml"].item_key

    asyncio.run(_run())


class _StubConfig:
    async def list_catalog_items(self, *_a, **_k):  # noqa: ANN001
        return []

    async def list_mask_rules(self, *_a, **_k):  # noqa: ANN001
        return []
