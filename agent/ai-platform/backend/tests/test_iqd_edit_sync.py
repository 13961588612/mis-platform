"""mis-iqd 二期「语义模型编辑写回」单元测试（G7 / P0-7 / P0-8 / S3）。

验证工程师二期实现的关键逻辑正确性（不依赖活体 WrenAI / 常驻服务，wren CLI 经
mock/monkeypatch 隔离）：

1. ``build_mdl_from_catalog``：以 mdl_raw 基线 + edited_items patch 派生完整 MDL，
   重点验证**不丢 relationship.models / model.source**（设计 §7.1 核心约束），
   且同输入幂等（同 hash）。
2. ``trigger_model_build``：编排 model 写回，回填 edit_revision 必须取自
   catalog 当前版本（断点续盖语义）。本文件含两条：
   - ``*_forwards_current_edit_revision_when_present``：契约完备时正确透传（绿）；
   - ``*_backfill_requires_current_edit_revision_from_catalog_full``：复现**当前
     Java getCatalogFull 响应缺 current_edit_revision** 的真实契约缺口——此时回填
     edit_revision=0，stampCatalogSync 的 ``edit_revision <= 0`` 永远匹配不到平台
     已编辑节点（edit_revision>=1），致 stamped_count 恒为 0、built_edit_revision
     被重置为 0、current>built 永久成立、同步状态机永不收敛 SYNCED（违反 PRD G-B/G6）。
     该用例红，精确定位到 Java getCatalogFull 缺字段（与 Java 端 IqdAdminEditTest
     中 getCatalogFull_includes_current_edit_revision 互为印证）。
3. ``IqdCli.get_current_mdl_hash``：WrenAI 不可达（CLI 抛错）时降级返回 None，
   不抛（S3 漂移判定的「无法判定」语义）。
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from src.agent.mis_iqd.service import IqdAskService
from src.adapters.iqd_cli import IqdCli, IqdCliError


# ================================================================ G7 MDL 派生

BASELINE_MDL = {
    "models": [
        {
            "name": "orders",
            "source": "db.public.orders",
            "columns": [{"name": "id", "type": "integer"}],
        },
        {
            "name": "users",
            "source": "db.public.users",
            "columns": [{"name": "id", "type": "integer"}],
        },
    ],
    "relationships": [
        {"name": "orders_user", "models": ["orders", "users"], "condition": "orders.uid = users.id"},
    ],
    "cubes": [
        {"name": "revenue", "measures": [{"name": "total", "expression": "sum(orders.amount)"}]},
    ],
    "views": [],
    "metrics": [],
    "dimensions": [],
}


def _read_manifest(mdl_dir: str) -> dict:
    with open(f"{mdl_dir}/manifest.json", encoding="utf-8") as fh:
        return json.load(fh)


def test_build_mdl_from_catalog_keeps_relationship_models_and_model_source():
    """G7 关键约束：派生不丢 relationship.models 与 model.source；cube display_name→name 被套用。"""
    edited = [
        {
            "item_key": "mdl:cube:revenue",
            "kind": "cube",
            "display_name": "营收(新)",
            "description": "营收 cube",
            "expression": None,
        }
    ]
    mdl_dir, payload = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    mdl = _read_manifest(mdl_dir)

    # 不丢结构信息
    assert mdl["relationships"][0]["models"] == ["orders", "users"]
    assert mdl["models"][0]["source"] == "db.public.orders"
    # patch 生效：cube display_name → name
    assert mdl["cubes"][0]["name"] == "营收(新)"
    assert mdl["cubes"][0]["description"] == "营收 cube"
    # 未编辑节点不受影响
    assert mdl["cubes"][0]["measures"][0]["name"] == "total"
    assert mdl["models"][1]["name"] == "users"


def test_build_mdl_from_catalog_patches_model_display_name():
    edited = [
        {
            "item_key": "mdl:model:orders",
            "kind": "model",
            "display_name": "订单(新)",
            "description": None,
            "expression": None,
        }
    ]
    mdl_dir, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    mdl = _read_manifest(mdl_dir)
    assert mdl["models"][0]["name"] == "订单(新)"
    # model.source 仍保留（未被破坏）
    assert mdl["models"][0]["source"] == "db.public.orders"


def test_build_mdl_from_catalog_is_idempotent_same_input_same_manifest():
    edited = [
        {
            "item_key": "mdl:cube:revenue",
            "kind": "cube",
            "display_name": "营收(新)",
            "description": None,
            "expression": None,
        }
    ]
    d1, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    d2, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    assert _read_manifest(d1) == _read_manifest(d2)


def test_build_mdl_from_catalog_no_baseline_no_edited_raises():
    with pytest.raises(ValueError):
        IqdAskService().build_mdl_from_catalog(1, None, [])


# ================================================================ P0-7 trigger_model_build 回填 revision

FULL_WITH_REVISION = {
    "connection_id": 1,
    "mdl_raw": json.dumps(BASELINE_MDL),
    "edited_items": [
        {
            "item_key": "mdl:cube:revenue",
            "kind": "cube",
            "display_name": "营收(新)",
            "description": None,
            "expression": None,
        }
    ],
    "current_edit_revision": 13,  # 设计 §九.1：get-catalog-full 应携带，供 backfill 断点续盖
}


def _patch_clients(get_catalog_full_payload: dict):
    """patch IqdCli / IqdConfigClient（与 test_iqd_close_loop 同范式）。"""
    MockCli = patch("src.adapters.iqd_cli.IqdCli").start()
    MockClient = patch("src.adapters.iqd_config_client.IqdConfigClient").start()
    cli = MockCli.return_value
    cli.context_build = AsyncMock(return_value={"stdout": '{"mdl_hash":"mdl_xyz"}'})
    cli.memory_index = AsyncMock(return_value={"exit_code": 0})
    client = MockClient.return_value
    client.get_catalog_full = AsyncMock(return_value=dict(get_catalog_full_payload))
    # 旧版 Java（get_catalog_full 未带 current_edit_revision）时，trigger_model_build
    # 回退到此取真实连接级版本（设计 §九.1 / T03 sync-status 契约）。
    client.get_catalog_sync_status = AsyncMock(return_value={
        "connection_id": 1,
        "current_edit_revision": 13,
        "built_edit_revision": 12,
        "edit_status": "EDITED_UNSYNCED",
        "build_status": "success",
        "index_status": "success",
        "mdl_hash": "mdl_xyz",
        "stale_drift": False,
    })
    client.backfill_catalog_sync = AsyncMock(return_value={"stamped_count": 3})
    client.report_sync_job = AsyncMock(return_value={"id": 1})
    return cli, client, (MockCli, MockClient)


async def test_trigger_model_build_forwards_current_edit_revision_when_present():
    """契约完备时，trigger_model_build 把 current_edit_revision 透传给 backfill（绿）。"""
    cli, client, mocks = _patch_clients(FULL_WITH_REVISION)
    try:
        result = await IqdAskService().trigger_model_build(connection_id=1, wait=True)
    finally:
        for m in mocks:
            m.stop()

    assert result.build_status == "success"
    assert result.build_mdl_hash == "mdl_xyz"
    # 回填必须按连接当前版本断点续盖
    assert client.backfill_catalog_sync.call_count == 1
    backfill_arg = client.backfill_catalog_sync.call_args.args[0]
    assert backfill_arg["connection_id"] == 1
    assert backfill_arg["mdl_hash"] == "mdl_xyz"
    assert backfill_arg["edit_revision"] == 13, "应透传 current_edit_revision=13 供 stampCatalogSync 命中已编辑节点"


async def test_trigger_model_build_backfill_requires_current_edit_revision_from_catalog_full():
    """复现真实契约缺口：Java getCatalogFull 当前**不返回** current_edit_revision，
    致回填 edit_revision=0，stampCatalogSync(edit_revision<=0) 匹配不到平台已编辑节点
    （edit_revision>=1）→ stamped 恒为 0、built 态不推进（红，源码缺陷）。"""
    # 与 today's Java getCatalogFull 实际返回一致：仅 connection_id / mdl_raw / edited_items
    full_no_revision = {
        "connection_id": 1,
        "mdl_raw": json.dumps(BASELINE_MDL),
        "edited_items": [
            {
                "item_key": "mdl:cube:revenue",
                "kind": "cube",
                "display_name": "营收(新)",
                "description": None,
                "expression": None,
            }
        ],
    }
    cli, client, mocks = _patch_clients(full_no_revision)
    try:
        result = await IqdAskService().trigger_model_build(connection_id=1, wait=True)
    finally:
        for m in mocks:
            m.stop()

    assert result.build_status == "success"
    backfill_arg = client.backfill_catalog_sync.call_args.args[0]
    # 存在已编辑节点（edit_revision>=1），回填 revision 必须为正整数，否则断点续盖失效
    assert backfill_arg["edit_revision"] >= 1, (
        "current_edit_revision 未从 getCatalogFull 透传：回填 edit_revision=%r，"
        "stampCatalogSync 的 edit_revision<=0 不会命中任何已编辑节点，stamped 恒为 0"
        % (backfill_arg["edit_revision"],)
    )


# ================================================================ S3 get_current_mdl_hash 降级

@pytest.mark.asyncio
async def test_get_current_mdl_hash_returns_none_when_cli_unavailable():
    """WrenAI 不可达（CLI 抛错）时降级为 None，不抛（S3 漂移判定「无法判定」语义）。"""
    with patch.object(IqdCli, "_run", new=AsyncMock(side_effect=IqdCliError("wren CLI 不可用"))):
        cli = IqdCli()
        assert await cli.get_current_mdl_hash() is None
