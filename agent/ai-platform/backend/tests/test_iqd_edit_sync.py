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


# ================================================================ T03：新建节点物化（R-3 补丁）


def test_build_mdl_from_catalog_materializes_new_cube_with_measures_and_dimensions():
    """M-G2 核心：平台新建的 cube 及其 measures/dimensions 必须物化进派生 MDL。

    基线里没有 ``margin`` cube，而 ``_patch_mdl_node`` 只按 name 改**已有**节点 ——
    没有物化这一步，新建 cube 会被静默丢弃，build 后问数永远命中不到 cube 聚合通道。
    """
    edited = [
        {
            "item_key": "mdl:cube:margin",
            "kind": "cube",
            "parent_key": "mdl:model:orders",
            "display_name": "margin",
            "data_type": None,
            "description": None,
            "expression": None,
            "model_ref": "mdl:model:orders",
        },
        {
            "item_key": "mdl:measure:margin.total",
            "kind": "measure",
            "parent_key": "mdl:cube:margin",
            "display_name": "total",
            "data_type": "¥#,##0",
            "description": None,
            "expression": "sum(orders.amount)",
            "model_ref": None,
        },
        {
            "item_key": "mdl:dimension:margin.store_id",
            "kind": "dimension",
            "parent_key": "mdl:cube:margin",
            "display_name": "store_id",
            "data_type": None,
            "description": None,
            "expression": "orders.store_id",
            "model_ref": None,
        },
    ]

    mdl_dir, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    mdl = _read_manifest(mdl_dir)

    names = [c["name"] for c in mdl["cubes"]]
    assert "margin" in names, "新建 cube 必须被物化"
    cube = next(c for c in mdl["cubes"] if c["name"] == "margin")
    assert cube["baseObject"] == "orders", "cube 的 baseObject 取自 model_ref"
    assert cube["measures"] == [
        {"name": "total", "expression": "sum(orders.amount)", "format": "¥#,##0"}
    ]
    assert cube["dimensions"] == [{"name": "store_id", "expression": "orders.store_id"}]

    # 既有 cube / relationship / model 未被破坏
    assert mdl["cubes"][0]["name"] == "revenue"
    assert mdl["relationships"][0]["models"] == ["orders", "users"]


def test_build_mdl_from_catalog_materializes_new_relationship_from_envelope():
    """M-G2：画布连线建的关系必须物化（否则 orders-customers join 不会进 MDL）。"""
    envelope = json.dumps(
        {
            "join_type": "inner",
            "cardinality": "1:N",
            "condition": "orders.customer_id = customers.id",
            "source_model": "mdl:model:orders",
            "target_model": "mdl:model:customers",
        },
        ensure_ascii=False,
    )
    edited = [
        {
            "item_key": "mdl:relationship:orders_customers",
            "kind": "relationship",
            "parent_key": "mdl:model:orders",
            "display_name": "orders_customers",
            "data_type": None,
            "description": None,
            "expression": envelope,
            "model_ref": None,
        }
    ]

    mdl_dir, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    mdl = _read_manifest(mdl_dir)

    names = [r["name"] for r in mdl["relationships"]]
    assert "orders_customers" in names
    rel = next(r for r in mdl["relationships"] if r["name"] == "orders_customers")
    assert rel["models"] == ["orders", "customers"], "models 由 source/target_model 去 mdl:model: 前缀得到"
    assert rel["joinType"] == "INNER"
    assert rel["condition"] == "orders.customer_id = customers.id"
    # 既有 relationship 未被破坏
    assert mdl["relationships"][0]["name"] == "orders_user"


def test_build_mdl_from_catalog_skips_relationship_without_envelope():
    """防御：非信封（历史 MDL 同步来源的裸 condition）无法还原 models → 宁可不物化。"""
    edited = [
        {
            "item_key": "mdl:relationship:legacy",
            "kind": "relationship",
            "parent_key": None,
            "display_name": "legacy",
            "description": None,
            "expression": "orders.uid = users.id",
            "model_ref": None,
        }
    ]

    mdl_dir, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    mdl = _read_manifest(mdl_dir)

    assert "legacy" not in [r["name"] for r in mdl["relationships"]]


def test_build_mdl_from_catalog_materializes_calculated_column():
    """MR-04：计算列（item_key=calc:<model>.<col>）必须物化进宿主模型的 columns。"""
    edited = [
        {
            "item_key": "calc:orders.margin",
            "kind": "column",
            "parent_key": "mdl:model:orders",
            "display_name": "margin",
            "data_type": None,
            "description": None,
            "expression": "orders.amount * 0.2",
            "model_ref": None,
        }
    ]

    mdl_dir, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    mdl = _read_manifest(mdl_dir)

    orders = next(m for m in mdl["models"] if m["name"] == "orders")
    columns = {c["name"]: c for c in orders["columns"]}
    assert "margin" in columns, "计算列必须挂到宿主模型的 columns"
    assert columns["margin"]["expression"] == "orders.amount * 0.2"
    assert "id" in columns, "既有物理列未被破坏"


def test_build_mdl_from_catalog_patches_existing_cube_without_duplicating():
    """回归守卫：已存在于基线的 cube 只被 patch（改名），不得被物化逻辑重复追加。"""
    edited = [
        {
            "item_key": "mdl:cube:revenue",
            "kind": "cube",
            "parent_key": "mdl:model:orders",
            "display_name": "营收(新)",
            "description": None,
            "expression": None,
            "model_ref": "mdl:model:orders",
        }
    ]

    mdl_dir, _ = IqdAskService().build_mdl_from_catalog(1, json.dumps(BASELINE_MDL), edited)
    mdl = _read_manifest(mdl_dir)

    assert len(mdl["cubes"]) == 1, "既有 cube 不得被重复物化"
    assert mdl["cubes"][0]["name"] == "营收(新)"
    assert mdl["cubes"][0]["measures"][0]["name"] == "total"


# ================================================================ T03e：「静默丢弃」→ 可见告警


def test_build_mdl_from_catalog_flags_new_model_as_unmatched_with_warning():
    """T03e：全新建 model（from-table 路径、基线无对应）**刻意不物化**，但必须被收集进
    未匹配清单并发出结构化 WARNING —— 把此前的「完全静默」变为可定位痕迹。

    ``edited_items`` 源自 ``getCatalogFull`` → ``findEditedItems``，本身即
    ``edit_revision IS NOT NULL`` 的平台编辑节点，故「未落入 MDL」即「被编辑却静默丢弃」。
    """
    edited = [
        {
            "item_key": "mdl:model:customers",
            "kind": "model",
            "parent_key": None,
            "display_name": "customers",
            "data_type": None,
            "description": None,
            "expression": None,
            "model_ref": None,
        }
    ]
    with patch("src.agent.mis_iqd.service.logger") as mock_logger:
        mdl_dir, payload = IqdAskService().build_mdl_from_catalog(
            7, json.dumps(BASELINE_MDL), edited
        )
    mdl = _read_manifest(mdl_dir)

    # 决策不变：新建 model 仍**不**被物化（真实 MDL model schema 未校准，留待 W0 探针）
    assert "customers" not in [m["name"] for m in mdl["models"]]

    # ① 被收集进未匹配清单（随 payload 回传）
    assert payload["unmatched_edit_count"] == 1
    assert payload["unmatched_edits"] == [
        {
            "item_key": "mdl:model:customers",
            "kind": "model",
            "parent_key": None,
            "display_name": "customers",
        }
    ]

    # ② 产生可见 WARNING（带 connection_id / kind / item_key）
    assert mock_logger.warning.call_count == 1
    _, kwargs = mock_logger.warning.call_args
    assert kwargs["connection_id"] == 7
    assert kwargs["unmatched_count"] == 1
    assert kwargs["unmatched_model_count"] == 1
    assert kwargs["unmatched_by_kind"] == {"model": 1}
    assert kwargs["unmatched_items"][0]["item_key"] == "mdl:model:customers"
    assert kwargs["unmatched_items"][0]["kind"] == "model"


def test_build_mdl_from_catalog_unmatched_list_excludes_landed_items():
    """只有「未落入」的节点才进未匹配清单：已成功物化的新建 cube 不得被误报。"""
    edited = [
        {
            "item_key": "mdl:cube:margin",
            "kind": "cube",
            "parent_key": "mdl:model:orders",
            "display_name": "margin",
            "data_type": None,
            "description": None,
            "expression": None,
            "model_ref": "mdl:model:orders",
        },
        {
            "item_key": "mdl:model:customers",
            "kind": "model",
            "parent_key": None,
            "display_name": "customers",
            "data_type": None,
            "description": None,
            "expression": None,
            "model_ref": None,
        },
    ]
    mdl_dir, payload = IqdAskService().build_mdl_from_catalog(
        1, json.dumps(BASELINE_MDL), edited
    )
    mdl = _read_manifest(mdl_dir)

    assert "margin" in [c["name"] for c in mdl["cubes"]], "新建 cube 仍应被物化"
    assert payload["unmatched_edit_count"] == 1
    assert {u["kind"] for u in payload["unmatched_edits"]} == {"model"}, (
        "已物化的 cube 不得进未匹配清单"
    )
    assert payload["unmatched_edits"][0]["item_key"] == "mdl:model:customers"


def test_build_mdl_from_catalog_no_warning_when_all_edits_landed():
    """全部编辑均已落入 MDL → 不发告警（避免噪声 / 不改变既有成功路径行为）。"""
    edited = [
        {
            "item_key": "mdl:cube:revenue",
            "kind": "cube",
            "parent_key": "mdl:model:orders",
            "display_name": "营收(新)",
            "description": None,
            "expression": None,
            "model_ref": "mdl:model:orders",
        }
    ]
    with patch("src.agent.mis_iqd.service.logger") as mock_logger:
        mdl_dir, payload = IqdAskService().build_mdl_from_catalog(
            1, json.dumps(BASELINE_MDL), edited
        )
    mdl = _read_manifest(mdl_dir)

    assert mdl["cubes"][0]["name"] == "营收(新)", "既有成功路径行为不变"
    assert payload["unmatched_edits"] == []
    assert payload["unmatched_edit_count"] == 0
    assert mock_logger.warning.call_count == 0


def test_build_mdl_from_catalog_flags_relationship_without_envelope():
    """同类静默跳过点（非信封 relationship 无法还原 models）现同样可见 —— 收集不抛异常。"""
    edited = [
        {
            "item_key": "mdl:relationship:legacy",
            "kind": "relationship",
            "parent_key": None,
            "display_name": "legacy",
            "data_type": None,
            "description": None,
            "expression": "orders.uid = users.id",
            "model_ref": None,
        }
    ]
    with patch("src.agent.mis_iqd.service.logger") as mock_logger:
        mdl_dir, payload = IqdAskService().build_mdl_from_catalog(
            2, json.dumps(BASELINE_MDL), edited
        )
    mdl = _read_manifest(mdl_dir)

    # 决策不变：仍不物化（不写非法 relationship），且不抛异常中断整个 build
    assert "legacy" not in [r["name"] for r in mdl["relationships"]]
    # 但可见
    assert payload["unmatched_edit_count"] == 1
    assert payload["unmatched_edits"][0]["kind"] == "relationship"
    assert mock_logger.warning.call_count == 1
    assert mock_logger.warning.call_args.kwargs["connection_id"] == 2


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


_ACTIVE_CLIENT_PATCHES: list = []


@pytest.fixture(autouse=True)
def _stop_client_patches():
    """用例结束即 stop 本模块 ``_patch_clients`` 起的 patch。

    <p>此前用 ``patch(...).start()`` 且从不 stop → patch 会泄漏到**同批次后续用例**
    （实测把 test_iqd_selfheal.py 的 13 个用例拖红）。autouse fixture 收口最省事：
    调用点无需改动。
    """
    yield
    while _ACTIVE_CLIENT_PATCHES:
        _ACTIVE_CLIENT_PATCHES.pop().stop()


def _patch_clients(get_catalog_full_payload: dict):
    """patch IqdCli / IqdConfigClient（与 test_iqd_close_loop 同范式）。"""
    # ⚠️ 必须留住 **patcher** 再 start()：``patch(...).start()`` 返回的是 mock 本身，
    # 对它调 ``.stop()`` 只是 MagicMock 的自动属性（静默 no-op）→ patch 永不还原，
    # 会泄漏到同批次后续用例（实测把 test_iqd_selfheal.py 的 13 个用例拖红）。
    patcher_cli = patch("src.adapters.iqd_cli.IqdCli")
    patcher_client = patch("src.adapters.iqd_config_client.IqdConfigClient")
    MockCli = patcher_cli.start()
    MockClient = patcher_client.start()
    _ACTIVE_CLIENT_PATCHES.extend([patcher_cli, patcher_client])
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
    return cli, client, (patcher_cli, patcher_client)


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
