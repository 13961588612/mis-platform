"""IqdAskService 运维自愈三按钮 per-connection 透传测试（方案 A 多连接，P0-3 / P1-1 / P1-2）。

覆盖：
- force-rebuild / re-index / validate 三个按钮必须把 connection_id 透传给
  - IqdCli 的 context_build / memory_index / memory_reset / context_validate 的 project_dir
    （project_dir = {wren_projects_root}/{connection_id}，与每连接一进程目录严格对齐）；
  - IqdConfigClient 的 backfill / report_sync_job 的 connection_id（作业回写按连接隔离）。
- 自愈为同构编排，仅 build 阶段 flag 不同；三动作上报 action 区分（force_rebuild /
  reindex / validate）供审计 REQ-7。

全部 mock IqdCli / IqdConfigClient，不依赖真实 wren CLI / mis-iqd HTTP。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.agent.mis_iqd.mcp_lifecycle import IqdMcpLifecycleService
from src.agent.mis_iqd.service import IqdAskService, SyncResult
from src.adapters.iqd_cli import IqdCli


def _make_cli_config_mocks() -> tuple[AsyncMock, AsyncMock]:
    """构造 mock 的 IqdCli 实例与 IqdConfigClient 实例。"""
    cli = AsyncMock(spec=IqdCli)
    cli.context_build.return_value = {"stdout": '{"mdl_hash":"mdl-abc-123"}'}
    cli.memory_index.return_value = {}
    cli.memory_reset.return_value = {}
    cli.context_validate.return_value = {"ok": True, "summary": ""}

    config = AsyncMock()
    config.get_sql_pairs.return_value = []
    config.get_knowledge.return_value = []
    # force-rebuild 现在先派生平台完整 MDL 再部署（关键修正 2026-09-30）：
    # 提供一组最小 catalog（含一个 from-table 模型）以走通「派生 → context_build(mdl_dir)」。
    config.get_catalog_full.return_value = {"mdl_raw": None, "edited_items": [
        {"item_key": "pg_main.adhoc.t1", "kind": "table", "display_name": "t1"},
        {"item_key": "pg_main.adhoc.t1.id", "kind": "column",
         "parent_key": "pg_main.adhoc.t1", "display_name": "id", "data_type": "BIGINT"},
        {"item_key": "mdl:model:t1", "kind": "model", "display_name": "t1"},
    ]}
    config.get_catalog_meta.return_value = []
    config.backfill_enhancement_sync.return_value = {}
    config.report_sync_job.return_value = {}
    return cli, config


@pytest.mark.asyncio
async def test_force_rebuild_passes_connid_and_project_dir_to_cli() -> None:
    """force-rebuild：connection_id=2 时 context_build/memory_index 的 project_dir
    必须指向该连接专属目录，且回填/上报带 connection_id=2、action=force_rebuild。"""
    cli, config = _make_cli_config_mocks()
    expected_home = IqdMcpLifecycleService.project_home_of(2)

    with patch("src.adapters.iqd_cli.IqdCli", return_value=cli), patch.object(
        IqdAskService, "_get_config_client", return_value=config
    ):
        svc = IqdAskService()
        result: SyncResult = await svc.trigger_force_rebuild(2, wait=True)

    # build 落到该连接专属 project 目录
    cli.context_build.assert_awaited_once()
    _, kwargs = cli.context_build.call_args
    assert kwargs.get("project_dir") == expected_home
    assert kwargs.get("force") is True
    # 派生出的完整 MDL 目录必须一并下发（否则空 YAML 会覆盖成 0 models）
    assert kwargs.get("mdl_dir")

    # memory index 同样落到该连接目录
    cli.memory_index.assert_awaited_once()
    assert cli.memory_index.call_args.kwargs.get("project_dir") == expected_home

    # 回填 + 作业上报均按连接隔离（connection_id 在 payload 字典中，按位置传入）
    config.backfill_enhancement_sync.assert_awaited_once()
    assert config.backfill_enhancement_sync.call_args.args[0]["connection_id"] == 2
    config.report_sync_job.assert_awaited_once()
    assert config.report_sync_job.call_args.args[0]["connection_id"] == 2
    assert config.report_sync_job.call_args.args[0]["action"] == "force_rebuild"
    assert result.connection_id == 2
    assert result.build_status == "success"


@pytest.mark.asyncio
async def test_reindex_passes_connid_and_project_dir_to_cli() -> None:
    """re-index：connection_id=3 时 memory_reset/memory_index 的 project_dir 指向该连接目录，
    作业上报 action=reindex、connection_id=3。"""
    cli, config = _make_cli_config_mocks()
    expected_home = IqdMcpLifecycleService.project_home_of(3)

    with patch("src.adapters.iqd_cli.IqdCli", return_value=cli), patch.object(
        IqdAskService, "_get_config_client", return_value=config
    ):
        svc = IqdAskService()
        result: SyncResult = await svc.trigger_reindex(3, wait=True)

    cli.memory_reset.assert_awaited_once()
    assert cli.memory_reset.call_args.kwargs.get("project_dir") == expected_home
    cli.memory_index.assert_awaited_once()
    assert cli.memory_index.call_args.kwargs.get("project_dir") == expected_home

    config.report_sync_job.assert_awaited_once()
    assert config.report_sync_job.call_args.args[0]["connection_id"] == 3
    assert config.report_sync_job.call_args.args[0]["action"] == "reindex"
    assert result.connection_id == 3


@pytest.mark.asyncio
async def test_validate_passes_connid_and_project_dir_to_cli() -> None:
    """validate：connection_id=4 时 context_validate 的 project_dir 指向该连接目录，
    作业上报 action=validate、connection_id=4；不调用 context_build/memory_index。"""
    cli, config = _make_cli_config_mocks()
    expected_home = IqdMcpLifecycleService.project_home_of(4)

    with patch("src.adapters.iqd_cli.IqdCli", return_value=cli), patch.object(
        IqdAskService, "_get_config_client", return_value=config
    ):
        svc = IqdAskService()
        result: SyncResult = await svc.trigger_validate(4, wait=True)

    cli.context_validate.assert_awaited_once()
    assert cli.context_validate.call_args.kwargs.get("project_dir") == expected_home
    # validate 是只读校验，不得触发 build/index
    cli.context_build.assert_not_awaited()
    cli.memory_index.assert_not_awaited()
    cli.memory_reset.assert_not_awaited()

    config.report_sync_job.assert_awaited_once()
    assert config.report_sync_job.call_args.args[0]["connection_id"] == 4
    assert config.report_sync_job.call_args.args[0]["action"] == "validate"
    assert result.connection_id == 4
    assert result.build_status == "success"


@pytest.mark.asyncio
async def test_selfheal_distinct_project_dir_per_connection() -> None:
    """不同连接 id 落不同 project 目录（多连接隔离不串台）：1 vs 2 目录必须不同。"""
    cli, config = _make_cli_config_mocks()

    with patch("src.adapters.iqd_cli.IqdCli", return_value=cli), patch.object(
        IqdAskService, "_get_config_client", return_value=config
    ):
        svc = IqdAskService()
        await svc.trigger_force_rebuild(1, wait=True)
        await svc.trigger_force_rebuild(2, wait=True)

    homes = [c.kwargs.get("project_dir") for c in cli.context_build.call_args_list]
    assert homes[0] == IqdMcpLifecycleService.project_home_of(1)
    assert homes[1] == IqdMcpLifecycleService.project_home_of(2)
    assert homes[0] != homes[1]
