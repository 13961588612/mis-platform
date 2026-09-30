"""mis-iqd 运维自愈三按钮（T05）单元测试 + 路由集成测试（Q5 / REQ-7 / REQ-8）。

不依赖活体 WrenAI / 常驻服务，wren CLI 经 ``IqdCli._run`` mock 隔离：

1. **Q5 硬约束（参数隔离）**：``IqdCli`` 三原子（`context_build(force)` / `memory_reset`
   / `context_validate`）的可选 flag **仅**来自 `IqdMcpSettings.self_heal_*_args` 配置，
   方法体不得硬编码。用例断言：配置空时 `context_build(force=True)` 的 args 为
   `["context","build","--allow-write"]`（**无** `--force`）；配置 `["--force"]` 时含
   `--force`；`force=False` 时即使配置有 `--force` 也不附加。
2. **三 service 方法**：`trigger_force_rebuild` / `trigger_reindex` / `trigger_validate`
   经 mock cli 跑通返回 `SyncResult`，且 `_report_selfheal_job` 写入 payload 含正确
   `action`（force_rebuild / reindex / validate），状态机收敛正确。
3. **`context_validate` 摘要解析（REQ-8）**：JSON（errors/message）与纯文本两种形态。
4. **路由端到端**：`POST /api/v1/iqd/self-heal/{force-rebuild,re-index,validate}`
   → service → 状态回写（report_sync_job action），复用既有 mock iqd_cli._run 范式。
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import pytest

from src.adapters.iqd_cli import IqdCli, IqdCliError
from src.agent.mis_iqd.service import IqdAskService, SyncResult
from src.config import Settings


# ================================================================ Q5 参数隔离（IqdCli 三原子）

@contextmanager
def _with_iqd_mcp_settings(**overrides: list[str]):
    """monkeypatch ``iqd_cli.get_settings``，注入指定 self_heal_*_args 配置（Q5 隔离验证）。"""
    s = Settings()
    for key, val in overrides.items():
        setattr(s.iqd_mcp, key, val)
    with patch("src.adapters.iqd_cli.get_settings", return_value=s):
        yield


def _capture_args(cli: IqdCli) -> list[str]:
    """取出最后一次 ``_run`` 调用传入的子命令参数列表。"""
    return cli._run.call_args.args[0]


@pytest.mark.asyncio
async def test_context_build_force_true_with_config_injects_force_flag():
    """配置 self_heal_force_build_args=['--force'] 时，force=True 调用 args 含 --force。

    <p>注：新版 wren CLI 无 ``--allow-write``，``context_build`` 已显式忽略该 flag
    （``del allow_write``），故这里只钉「结构命令 + 配置注入的 flag」两件事。
    """
    with _with_iqd_mcp_settings(self_heal_force_build_args=["--force"]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "", "stderr": "", "exit_code": 0})
        await cli.context_build(force=True)
        args = _capture_args(cli)
    assert args[:2] == ["context", "build"]
    assert "--force" in args, "Q5 失败：--force 应来自配置而非硬编码"


@pytest.mark.asyncio
async def test_context_build_force_true_empty_config_has_no_hardcoded_flag():
    """Q5 硬约束：配置为空时 force=True 的 args 恰好为 ["context","build"]，无 --force。"""
    with _with_iqd_mcp_settings(self_heal_force_build_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "", "stderr": "", "exit_code": 0})
        await cli.context_build(force=True)
        args = _capture_args(cli)
    assert args == ["context", "build"], f"Q5 失败：不应硬编码 --force，实际 {args}"
    assert "--force" not in args


@pytest.mark.asyncio
async def test_context_build_force_false_never_appends_force_flag():
    """即使配置有 --force，force=False 也不附加（flag 仅 force=True 时生效）。"""
    with _with_iqd_mcp_settings(self_heal_force_build_args=["--force"]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "", "stderr": "", "exit_code": 0})
        await cli.context_build(force=False)
        args = _capture_args(cli)
    assert args == ["context", "build"]
    assert "--force" not in args


@pytest.mark.asyncio
async def test_memory_reset_args_come_from_config():
    """memory reset 可选参数来自配置：空 → ["memory","reset"]；["--force"] → 含 --force。"""
    with _with_iqd_mcp_settings(self_heal_memory_reset_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "", "stderr": "", "exit_code": 0})
        await cli.memory_reset()
        assert _capture_args(cli) == ["memory", "reset"]

    with _with_iqd_mcp_settings(self_heal_memory_reset_args=["--force"]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "", "stderr": "", "exit_code": 0})
        await cli.memory_reset()
        args = _capture_args(cli)
    assert args[:2] == ["memory", "reset"]
    assert "--force" in args


@pytest.mark.asyncio
async def test_memory_reset_default_includes_force():
    """W0：默认 self_heal_memory_reset_args 含 --force，避免非 TTY Aborted。"""
    assert "--force" in Settings().iqd_mcp.self_heal_memory_reset_args
    with patch("src.adapters.iqd_cli.get_settings", return_value=Settings()):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "", "stderr": "", "exit_code": 0})
        await cli.memory_reset()
        assert _capture_args(cli) == ["memory", "reset", "--force"]


# ================================================================ memory index 瞬时 LanceDB 错误重试

def test_transient_memory_index_error_matcher():
    """只有 LanceDB「Malformed manifest + schema_items」类瞬时错误才判定可重试。"""
    assert IqdCli._is_transient_memory_index_error(
        "Malformed manifest: Table 'schema_items' already exists"
    )
    assert IqdCli._is_transient_memory_index_error(
        "Malformed manifest: Table 'schema_items' was not found"
    )
    # 非瞬时：不得重试，避免掩盖真实错误
    assert not IqdCli._is_transient_memory_index_error("no wren project found")
    assert not IqdCli._is_transient_memory_index_error(
        "Malformed manifest: Table 'query_history' already exists"
    )


@pytest.mark.asyncio
async def test_memory_index_retries_transient_then_succeeds():
    """第一次报瞬时 LanceDB 错误 → 重试后成功，不向上抛（兜底并发抖动）。"""
    cli = IqdCli()
    cli._run = AsyncMock(
        side_effect=[
            IqdCliError("Malformed manifest: Table 'schema_items' already exists"),
            {"stdout": "Indexed 1", "stderr": "", "exit_code": 0},
        ]
    )
    with patch("src.adapters.iqd_cli.asyncio.sleep", new=AsyncMock()):
        result = await cli.memory_index()
    assert result["exit_code"] == 0
    assert cli._run.await_count == 2


@pytest.mark.asyncio
async def test_memory_index_transient_retry_exhausted_raises():
    """三次都是瞬时错误 → 最终仍抛出（不无限重试）。"""
    cli = IqdCli()
    cli._run = AsyncMock(
        side_effect=IqdCliError("Malformed manifest: Table 'schema_items' was not found")
    )
    with patch("src.adapters.iqd_cli.asyncio.sleep", new=AsyncMock()):
        with pytest.raises(IqdCliError):
            await cli.memory_index()
    assert cli._run.await_count == 3


@pytest.mark.asyncio
async def test_memory_index_non_transient_error_does_not_retry():
    """非瞬时错误（如 no wren project）→ 立即抛，不重试。"""
    cli = IqdCli()
    cli._run = AsyncMock(side_effect=IqdCliError("no wren project found"))
    with pytest.raises(IqdCliError):
        await cli.memory_index()
    assert cli._run.await_count == 1


@pytest.mark.asyncio
async def test_context_validate_args_come_from_config():
    """context validate 可选参数来自配置：空 → ["context","validate"]；["--verbose"] → 含 --verbose。"""
    with _with_iqd_mcp_settings(self_heal_context_validate_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "{}", "stderr": "", "exit_code": 0})
        await cli.context_validate()
        assert _capture_args(cli) == ["context", "validate"]

    with _with_iqd_mcp_settings(self_heal_context_validate_args=["--verbose"]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "{}", "stderr": "", "exit_code": 0})
        await cli.context_validate()
        args = _capture_args(cli)
    assert args[:2] == ["context", "validate"]
    assert "--verbose" in args


# ================================================================ REQ-8 摘要解析

def test_parse_validate_summary_json_errors():
    assert IqdCli._parse_validate_summary('{"errors":[{"message":"列 a 不存在"}]}', "") == "列 a 不存在"


def test_parse_validate_summary_json_message():
    assert IqdCli._parse_validate_summary('{"message":"整体校验失败"}', "") == "整体校验失败"


def test_parse_validate_summary_json_errors_list_of_str():
    assert IqdCli._parse_validate_summary('{"errors":["a 缺失", "b 缺失"]}', "") == "a 缺失; b 缺失"


def test_parse_validate_summary_plain_text_error_line():
    assert (
        IqdCli._parse_validate_summary("some context\nError: model drift detected", "")
        == "Error: model drift detected"
    )


def test_parse_validate_summary_plain_text_first_line():
    assert IqdCli._parse_validate_summary("first line info\nsecond line", "") == "first line info"


def test_parse_validate_summary_empty():
    assert IqdCli._parse_validate_summary("", "") == ""


def test_parse_validate_output_json_warnings():
    out = IqdCli._parse_validate_output(
        '{"warnings":[{"message":"缺主键"},{"message":"缺时间维"},"未设 description"]}',
        "",
    )
    assert out["errors"] == []
    assert out["warnings"] == ["缺主键", "缺时间维", "未设 description"]
    assert "缺主键" in out["summary"]


def test_parse_validate_output_wren_section_format():
    """真机 stdout：Warnings: 分区明细 + 收尾计数；明细行不含 warning 字样。"""
    stdout = """
Warnings:
  ⚠ Model 'ads_spm_trd_cost_category_day_df' has no description — add properties.description
  ⚠ Model 'ads_spm_trd_sale_category_day_df' has no description — add properties.description
  ⚠ Model 'dwd_spm_trd_sale_ord_detl_df' has no description — add properties.description

3 warning(s), 0 errors.
"""
    out = IqdCli._parse_validate_output(stdout, "")
    assert out["errors"] == []
    assert out["warn_count"] == 3
    assert out["error_count"] == 0
    assert len(out["warnings"]) == 3
    assert any("ads_spm_trd_cost_category_day_df" in w for w in out["warnings"])
    assert any("dwd_spm_trd_sale_ord_detl_df" in w for w in out["warnings"])


@pytest.mark.asyncio
async def test_context_validate_wren_section_ok_not_failed():
    """含 0 errors 字样不得因 substring 'error' 判失败；应 ok + 3 条明细。"""
    stdout = (
        "Warnings:\n"
        "  Model 'a' has no description\n"
        "  Model 'b' has no description\n"
        "  Model 'c' has no description\n"
        "\n"
        "3 warning(s), 0 errors.\n"
    )
    with _with_iqd_mcp_settings(self_heal_context_validate_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"exit_code": 0, "stdout": stdout, "stderr": ""})
        out = await cli.context_validate()
    assert out["ok"] is True
    assert out["errors"] == []
    assert len(out["warnings"]) == 3


@pytest.mark.asyncio
async def test_context_validate_nonzero_exit_warnings_only_is_ok():
    """Wren 仅警告时常 exit!=0：allow_nonzero 收下输出后仍 ok=True。"""
    with _with_iqd_mcp_settings(self_heal_context_validate_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(
            return_value={
                "exit_code": 1,
                "stdout": "Warning: model orders missing primary key\n"
                "Warning: cube revenue has no measure\n"
                "Warning: column x has no description\n"
                "3 warning(s), 0 errors.\n",
                "stderr": "",
            }
        )
        out = await cli.context_validate()
    assert out["ok"] is True
    assert out["errors"] == []
    assert len(out["warnings"]) >= 3
    assert any("primary key" in w for w in out["warnings"])


def test_parse_validate_output_plain_warning_lines():
    out = IqdCli._parse_validate_output(
        "Warning: missing pk on orders\nWarning: cube revenue has no measure\n3 warnings\n",
        "",
    )
    assert out["errors"] == []
    assert len(out["warnings"]) >= 2
    assert any("missing pk" in w for w in out["warnings"])


@pytest.mark.asyncio
async def test_context_validate_success_returns_ok_summary_empty():
    """成功（stdout 为空、无 error 关键词）：ok=True、summary 为空、raw 为空串。"""
    with _with_iqd_mcp_settings(self_heal_context_validate_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(return_value={"stdout": "", "stderr": ""})
        out = await cli.context_validate()
    assert out == {"ok": True, "summary": "", "raw": "", "warnings": [], "errors": []}


@pytest.mark.asyncio
async def test_context_validate_warnings_only_still_ok():
    """仅 warnings、无 errors：ok=True，warnings 分条回传。"""
    with _with_iqd_mcp_settings(self_heal_context_validate_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(
            return_value={
                "stdout": '{"warnings":["a","b","c"]}',
                "stderr": "",
            }
        )
        out = await cli.context_validate()
    assert out["ok"] is True
    assert out["warnings"] == ["a", "b", "c"]
    assert out["errors"] == []


@pytest.mark.asyncio
async def test_context_validate_raises_returns_failed_with_summary():
    with _with_iqd_mcp_settings(self_heal_context_validate_args=[]):
        cli = IqdCli()
        cli._run = AsyncMock(side_effect=IqdCliError("wren CLI 失败 exit=1: error: bad model"))
        out = await cli.context_validate()
    assert out["ok"] is False
    assert "bad model" in out["summary"]
    assert out["errors"] or out["warnings"]
    assert "wren CLI 失败" in out["raw"]


# ================================================================ 三 service 方法 + action 回写

def _patch_selfheal_clients(cli_return: dict | None = None, validate_return: dict | None = None):
    """patch IqdCli / IqdConfigClient（与 test_iqd_close_loop 同范式），返回 (cli, client, mocks)。"""
    cli_return = cli_return or {"stdout": '{"mdl_hash":"mdl_xyz"}'}
    validate_return = validate_return or {"ok": True, "summary": "", "raw": "ok"}
    # ⚠️ 留住 **patcher** 再 start()：``patch(...).start()`` 返回 mock 本身，
    # 对它 ``.stop()`` 是 MagicMock 的自动属性（静默 no-op）→ patch 永不还原。
    patcher_cli = patch("src.adapters.iqd_cli.IqdCli")
    patcher_client = patch("src.adapters.iqd_config_client.IqdConfigClient")
    MockCli = patcher_cli.start()
    MockClient = patcher_client.start()
    cli = MockCli.return_value
    cli.context_build = AsyncMock(return_value=cli_return)
    cli.memory_reset = AsyncMock(return_value={"exit_code": 0})
    cli.memory_index = AsyncMock(return_value={"exit_code": 0})
    cli.context_validate = AsyncMock(return_value=validate_return)
    client = MockClient.return_value
    client.get_sql_pairs = AsyncMock(return_value=[])
    client.get_knowledge = AsyncMock(return_value=[])
    # force-rebuild 关键修正（2026-09-30）：先派生平台完整 MDL 再 context_build(mdl_dir)。
    # 这里给出最小 catalog（含 from-table 模型）以走通派生路径。
    client.get_catalog_full = AsyncMock(return_value={"mdl_raw": None, "edited_items": [
        {"item_key": "pg_main.adhoc.t1", "kind": "table", "display_name": "t1"},
        {"item_key": "pg_main.adhoc.t1.id", "kind": "column",
         "parent_key": "pg_main.adhoc.t1", "display_name": "id", "data_type": "BIGINT"},
        {"item_key": "mdl:model:t1", "kind": "model", "display_name": "t1"},
    ]})
    client.get_catalog_meta = AsyncMock(return_value=[])
    client.backfill_enhancement_sync = AsyncMock(return_value={"synced_count": 0})
    client.report_sync_job = AsyncMock(return_value={"id": 1})
    return cli, client, (patcher_cli, patcher_client)


@pytest.mark.asyncio
async def test_trigger_force_rebuild_runs_build_and_reports_action():
    """强制重建：context build(force) + memory index，状态成功，report action=force_rebuild。"""
    service = IqdAskService()
    cli, client, mocks = _patch_selfheal_clients()
    try:
        result = await service.trigger_force_rebuild(connection_id=1, wait=True)
    finally:
        for m in mocks:
            m.stop()

    assert result.build_status == "success"
    assert result.build_mdl_hash == "mdl_xyz"
    assert result.index_status == "success"
    assert cli.context_build.call_args.kwargs.get("force") is True
    report = client.report_sync_job.call_args.args[0]
    assert report["action"] == "force_rebuild"
    assert report["build_status"] == "success"


@pytest.mark.asyncio
async def test_trigger_reindex_resets_then_indexes_and_reports_action():
    """重新索引：memory reset + memory index，状态成功，report action=reindex。"""
    service = IqdAskService()
    cli, client, mocks = _patch_selfheal_clients()
    try:
        result = await service.trigger_reindex(connection_id=1, wait=True)
    finally:
        for m in mocks:
            m.stop()

    assert cli.memory_reset.call_count == 1
    assert cli.memory_index.call_count == 1
    assert result.build_status == "skipped"
    assert result.index_status == "success"
    report = client.report_sync_job.call_args.args[0]
    assert report["action"] == "reindex"
    assert "build_status" not in report
    assert report["index_status"] == "success"


@pytest.mark.asyncio
async def test_trigger_validate_ok_reports_action():
    """模型校验成功：build_status=success，report action=validate。"""
    service = IqdAskService()
    cli, client, mocks = _patch_selfheal_clients(validate_return={"ok": True, "summary": "", "raw": "ok"})
    try:
        result = await service.trigger_validate(connection_id=1, wait=True)
    finally:
        for m in mocks:
            m.stop()

    assert result.build_status == "success"
    assert result.index_status == "skipped"
    assert result.build_error is None
    report = client.report_sync_job.call_args.args[0]
    assert report["action"] == "validate"


@pytest.mark.asyncio
async def test_trigger_validate_ok_with_warnings_returns_list():
    """校验成功但有警告：build_status=success，warnings 分条回传供前端查看。"""
    service = IqdAskService()
    cli, client, mocks = _patch_selfheal_clients(
        validate_return={
            "ok": True,
            "summary": "a; b; c",
            "raw": "ok",
            "warnings": ["a", "b", "c"],
            "errors": [],
        }
    )
    try:
        result = await service.trigger_validate(connection_id=1, wait=True)
    finally:
        for m in mocks:
            m.stop()

    assert result.build_status == "success"
    assert result.build_error is None
    assert result.warnings == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_trigger_validate_failed_reports_summary_as_build_error():
    """模型校验失败：build_status=failed，build_error=人可读摘要（REQ-8），report action=validate。"""
    service = IqdAskService()
    cli, client, mocks = _patch_selfheal_clients(
        validate_return={"ok": False, "summary": "列 a 不存在", "raw": "err"}
    )
    try:
        result = await service.trigger_validate(connection_id=1, wait=True)
    finally:
        for m in mocks:
            m.stop()

    assert result.build_status == "failed"
    assert result.build_error == "列 a 不存在"
    assert result.warnings == ["列 a 不存在"]
    report = client.report_sync_job.call_args.args[0]
    assert report["action"] == "validate"
    assert report["build_status"] == "failed"


# ================================================================ 路由端到端（service → 状态回写）

def _route_test_case(action: str, cli_return: dict, validate_return: dict | None = None):
    """驱动真实路由，验证端到端返回 + report_sync_job action 回写。"""
    from fastapi.testclient import TestClient

    from src.api.deps import get_current_user, get_trace_id
    from src.main import app

    with patch("src.adapters.iqd_cli.IqdCli") as MockCli, patch(
        "src.adapters.iqd_config_client.IqdConfigClient"
    ) as MockClient:
        cli = MockCli.return_value
        cli.context_build = AsyncMock(return_value=cli_return)
        cli.memory_reset = AsyncMock(return_value={"exit_code": 0})
        cli.memory_index = AsyncMock(return_value={"exit_code": 0})
        cli.context_validate = AsyncMock(
            return_value=validate_return or {"ok": True, "summary": "", "raw": "ok"}
        )
        client = MockClient.return_value
        client.get_sql_pairs = AsyncMock(return_value=[])
        client.get_knowledge = AsyncMock(return_value=[])
        # force-rebuild 先派生平台完整 MDL（2026-09-30 修正）→ 提供最小 catalog。
        client.get_catalog_full = AsyncMock(return_value={"mdl_raw": None, "edited_items": [
            {"item_key": "pg_main.adhoc.t1", "kind": "table", "display_name": "t1"},
            {"item_key": "pg_main.adhoc.t1.id", "kind": "column",
             "parent_key": "pg_main.adhoc.t1", "display_name": "id", "data_type": "BIGINT"},
            {"item_key": "mdl:model:t1", "kind": "model", "display_name": "t1"},
        ]})
        client.get_catalog_meta = AsyncMock(return_value=[])
        client.backfill_enhancement_sync = AsyncMock(return_value={"synced_count": 0})
        client.report_sync_job = AsyncMock(return_value={"id": 1})

        app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
        app.dependency_overrides[get_trace_id] = lambda: "t-route"
        try:
            tc = TestClient(app)
            resp = tc.post(
                f"/api/v1/iqd/self-heal/{action}",
                json={"connection_id": 1, "wait": True},
            )
        finally:
            app.dependency_overrides.clear()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["code"] == 0, body
    return body, client.report_sync_job.call_args.args[0]


def test_route_force_rebuild_end_to_end():
    body, report = _route_test_case(
        "force-rebuild", cli_return={"stdout": '{"mdl_hash":"mdl_route"}', "stderr": ""}
    )
    assert body["data"]["build_status"] == "success"
    assert body["data"]["build_mdl_hash"] == "mdl_route"
    assert report["action"] == "force_rebuild"


def test_route_re_index_end_to_end():
    body, report = _route_test_case("re-index", cli_return={"stdout": "{}", "stderr": ""})
    assert body["data"]["build_status"] == "skipped"
    assert body["data"]["index_status"] == "success"
    assert report["action"] == "reindex"
    assert "build_status" not in report


def test_route_validate_end_to_end():
    body, report = _route_test_case(
        "validate",
        cli_return={"stdout": "{}", "stderr": ""},
        validate_return={"ok": True, "summary": "", "raw": "ok"},
    )
    assert body["data"]["build_status"] == "success"
    assert report["action"] == "validate"
