"""mis-iqd 闭环补全（一期）单元测试。

验证工程师一期实现的关键逻辑正确性（不依赖活体 WrenAI / 常驻服务）：

1. ``SyncCoordinator`` 合并窗口（P1-2）：同一 connection 在窗口内多次 save 自动触发，
   只合并为 1 次 build；超过窗口的第二次触发另算。
2. ``IqdAskService``：
   - ``_parse_mdl_hash`` 从 ``wren context build`` 输出解析 mdl_hash；
     非法输入走 ``_fallback_mdl_hash`` 生成 ``wqd-{timestamp}-{uuid}`` 格式。
   - ``trigger_build_index`` 在 ``memory index`` 调用抛异常时：**仅** index_status=failed
     + 记录 index_error，**不**置 build_status=failed，**不**阻断 context build 回填
     （Q6 容错设计）。
"""

from __future__ import annotations

import asyncio
import re

import pytest
from unittest.mock import AsyncMock, patch

from src.agent.mis_iqd.service import IqdAskService, SyncResult
from src.agent.mis_iqd.sync_coordinator import SyncCoordinator
from src.adapters.iqd_cli import IqdCliError


# ================================================================ P1-2 合并窗口

@pytest.mark.asyncio
async def test_coordinator_coalesces_within_window_and_rearms_after():
    """窗口内 3 次触发合并为 1 次 build；窗口结束后第 4 次触发另起 1 次 build。"""
    coordinator = SyncCoordinator(coalesce_window_sec=0.1)

    with patch("src.agent.mis_iqd.sync_coordinator.IqdAskService") as MockSvc:
        instance = MockSvc.return_value
        instance.trigger_build_index = AsyncMock(
            return_value=SyncResult(connection_id=1, build_status="success")
        )

        # —— 窗口内连续 3 次自动触发（wait=false）——
        r1 = await coordinator.trigger(1, False)
        r2 = await coordinator.trigger(1, False)
        r3 = await coordinator.trigger(1, False)

        # 首次 accepted（coalesced=False），其余两次合并进在进行的 build
        assert r1.coalesced is False
        assert r2.coalesced is True
        assert r3.coalesced is True

        # 等待合并窗口过去，让首个合并 build 任务完成（窗口内只发起 1 次 build）
        await asyncio.sleep(0.25)
        assert instance.trigger_build_index.call_count == 1

        # —— 窗口结束后再次触发：应另起 1 次新 build ——
        r4 = await coordinator.trigger(1, False)
        assert r4.coalesced is False

        # 让第二次 build 完成
        await asyncio.sleep(0.2)

        # 总共只执行 2 次 build（窗口内合并的 1 次 + 窗口后新起的 1 次）
        assert instance.trigger_build_index.call_count == 2


@pytest.mark.asyncio
async def test_coordinator_wait_true_runs_build_inline():
    """wait=true 立即同步：阻塞至 build 完成并返回完整 SyncResult。"""
    coordinator = SyncCoordinator(coalesce_window_sec=0.1)

    with patch("src.agent.mis_iqd.sync_coordinator.IqdAskService") as MockSvc:
        instance = MockSvc.return_value
        instance.trigger_build_index = AsyncMock(
            return_value=SyncResult(connection_id=1, build_status="success")
        )

        result = await coordinator.trigger(1, True)
        assert result.build_status == "success"
        assert instance.trigger_build_index.call_count == 1


# ================================================================ P1 mdl_hash 解析 / 降级

def test_parse_mdl_hash_json_primary_keys():
    assert IqdAskService._parse_mdl_hash('{"mdl_hash":"abc123"}') == "abc123"
    # 缺 mdl_hash 时回退到 hash / deployment_id 等别名
    assert IqdAskService._parse_mdl_hash('{"hash":"xyz"}') == "xyz"
    assert IqdAskService._parse_mdl_hash('{"deployment_id":"dep_9"}') == "dep_9"


def test_parse_mdl_hash_regex_fallback():
    out = 'building model...\nmdl_hash="foo_bar" done'
    assert IqdAskService._parse_mdl_hash(out) == "foo_bar"


def test_parse_mdl_hash_invalid_falls_back_to_wqd():
    # 非法 / 空输入：回退到 wqd-{yyyyMMddHHmmss}-{uuid8}
    val = IqdAskService._parse_mdl_hash("not a json at all")
    assert re.fullmatch(r"wqd-\d{14}-[0-9a-f]{8}", val), val

    val2 = IqdAskService._parse_mdl_hash("")
    assert re.fullmatch(r"wqd-\d{14}-[0-9a-f]{8}", val2), val2


def test_fallback_mdl_hash_format():
    val = IqdAskService._fallback_mdl_hash()
    assert re.fullmatch(r"wqd-\d{14}-[0-9a-f]{8}", val), val


# ================================================================ P1 Q6 容错：memory index 失败不阻断 build 回填

@pytest.mark.asyncio
async def test_trigger_build_index_memory_index_failure_is_non_blocking():
    """memory index 抛 IqdCliError：仅 index_status=failed + index_error，
    build_status 仍为 success，回填照常进行（Q6 容错）。"""
    service = IqdAskService()

    pending_pair = {
        "id": 10,
        "sync_status": "pending",
        "enabled": 1,
        "question": "月活多少?",
        "wren_sql": "SELECT count(*) FROM users",
    }
    pending_knowledge = {
        "id": 20,
        "sync_status": "pending",
        "enabled": 1,
        "title": "口径A",
        "content": "定义...",
    }

    # IqdCli / IqdConfigClient 在 trigger_build_index 内 lazy import，需 patch 其定义模块
    with patch("src.adapters.iqd_cli.IqdCli") as MockCli, patch(
        "src.adapters.iqd_config_client.IqdConfigClient"
    ) as MockClient:
        cli = MockCli.return_value
        cli.context_build = AsyncMock(
            return_value={"stdout": '{"mdl_hash":"mdl_abc123"}'}
        )
        # 方案 A：知识下发先于 build（样本走 memory store、规则写 knowledge/rules/*.md）
        cli.memory_store = AsyncMock(return_value={"exit_code": 0})
        cli.write_project_files = AsyncMock(return_value={"exit_code": 0})
        cli.list_project_files = AsyncMock(return_value=[])
        cli.delete_project_files = AsyncMock(return_value={"exit_code": 0})
        # memory index 不可用（Q6：CLI 缺失 / 部署版本未提供子命令）
        cli.memory_index = AsyncMock(side_effect=IqdCliError("memory index 子命令不可用"))

        client = MockClient.return_value
        client.get_sql_pairs = AsyncMock(return_value=[pending_pair])
        client.get_knowledge = AsyncMock(return_value=[pending_knowledge])
        client.backfill_enhancement_sync = AsyncMock(return_value={"synced_count": 2})
        client.report_sync_job = AsyncMock(return_value={"id": 1})

        result = await service.trigger_build_index(connection_id=1, wait=True)

    # —— 核心断言：Q6 容错 ——
    assert result.build_status == "success", "memory index 失败不应置 build_status=failed"
    assert result.build_error is None, "build 未失败，build_error 应 None"
    assert result.index_status == "failed", "memory index 失败应标记 index_status=failed"
    assert result.index_error is not None, "应记录 index_error"
    assert result.build_mdl_hash == "mdl_abc123"

    # 回填照常进行（build 成功即回填，不因 index 失败而中断）
    assert result.synced_sql_pair_count == 1
    assert result.synced_knowledge_count == 1

    # backfill 实际被调用，且 wren_ref_id 用本次 mdl_hash 覆盖本批 pending 物料
    assert client.backfill_enhancement_sync.call_count == 1
    backfill_payload = client.backfill_enhancement_sync.call_args.args[0]
    assert backfill_payload["connection_id"] == 1
    assert backfill_payload["wren_ref_id"] == "mdl_abc123"
    assert backfill_payload["sql_pair_ids"] == [10]
    assert backfill_payload["knowledge_ids"] == [20]

    # 作业上报 payload 中 build_status=success / index_status=failed
    report_payload = client.report_sync_job.call_args.args[0]
    assert report_payload["build_status"] == "success"
    assert report_payload["index_status"] == "failed"


@pytest.mark.asyncio
async def test_trigger_build_index_context_build_failure_blocks_backfill_and_index():
    """context build 本身失败：build_status=failed，不回填、不尝试 memory index。"""
    service = IqdAskService()

    pending_pair = {
        "id": 10,
        "sync_status": "pending",
        "enabled": 1,
        "question": "q",
        "wren_sql": "SELECT 1",
    }

    with patch("src.adapters.iqd_cli.IqdCli") as MockCli, patch(
        "src.adapters.iqd_config_client.IqdConfigClient"
    ) as MockClient:
        cli = MockCli.return_value
        cli.context_build = AsyncMock(side_effect=IqdCliError("wren CLI 不可用"))
        cli.memory_store = AsyncMock(return_value={"exit_code": 0})
        cli.write_project_files = AsyncMock(return_value={"exit_code": 0})
        cli.list_project_files = AsyncMock(return_value=[])
        cli.delete_project_files = AsyncMock(return_value={"exit_code": 0})
        cli.memory_index = AsyncMock(return_value={"exit_code": 0})

        client = MockClient.return_value
        client.get_sql_pairs = AsyncMock(return_value=[pending_pair])
        client.get_knowledge = AsyncMock(return_value=[])
        client.backfill_enhancement_sync = AsyncMock(return_value={"synced_count": 0})
        client.report_sync_job = AsyncMock(return_value={"id": 1})

        result = await service.trigger_build_index(connection_id=1, wait=True)

    assert result.build_status == "failed"
    # build 失败 → 不应回填
    assert client.backfill_enhancement_sync.call_count == 0
    assert result.synced_sql_pair_count == 0
    # build 失败 → 不会进入 memory index 分支（index_status 保持 skipped）
    assert result.index_status == "skipped"
    assert cli.memory_index.call_count == 0
