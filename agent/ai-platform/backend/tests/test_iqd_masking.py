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


class _StubConfig:
    async def list_catalog_items(self, *_a, **_k):  # noqa: ANN001
        return []

    async def list_mask_rules(self, *_a, **_k):  # noqa: ANN001
        return []
