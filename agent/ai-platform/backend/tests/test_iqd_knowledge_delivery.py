"""知识下发（方案 A：文件即真相）单元测试。

<p><b>为什么值得钉</b>：2026-09-27 之前，``trigger_build_index`` 把样本/知识传给
``context_build`` 的 ``sql_pairs`` / ``instructions`` 参数 —— 而 wren 0.13.3 的 CLI 根本没有
这两个 option，代码只打 warning 跳过；可回填仍按「build 成功」把它们标成 ``synced``。
结果是**界面显示已同步、wren 侧一条都没有**（实测 ``wren memory check``：
``knowledge/sql: 0 pair(s)``）。

<p>本用例钉住真格式（wren 0.13.3 实测）与真回填：
<ul>
  <li>样本 → ``wren memory store --nl … --sql … --tags source:mis-iqd``
      （wren 侧写 ``knowledge/sql/<slug>.md`` 并索引）；</li>
  <li>术语/口径/指令 → ``knowledge/rules/mis-iqd-platform.md``，**全量**（含已 synced 的
      启用条目，否则下次下发会把旧条目擦掉）；</li>
  <li>只有**写成功**的 id 才进回填；单条失败/规则失败只记录、不冒充成功。</li>
</ul>
"""

from __future__ import annotations

import pytest

from src.adapters.iqd_cli import IqdCli, IqdCliError
from src.agent.mis_iqd.service import IQD_RULES_REL_PATH, IqdAskService


class FakeCli:
    """记录调用的假 CLI（覆盖下发 + 对账回收用到的方法）。"""

    def __init__(
        self,
        *,
        fail_pairs: bool = False,
        fail_rules: bool = False,
        existing_files: list[dict] | None = None,
        fail_list: bool = False,
        memory_check_output: str = "In sync.\n",
    ) -> None:
        self.store_calls: list[dict] = []
        self.file_calls: list[dict] = []
        self.deleted_calls: list[list[str]] = []
        self.reset_calls = 0
        self.index_calls = 0
        self.fail_pairs = fail_pairs
        self.fail_rules = fail_rules
        self.existing_files = existing_files or []
        self.fail_list = fail_list
        self.memory_check_output = memory_check_output

    async def memory_store(self, *, nl: str, sql: str, tags=None, project_dir=None):
        if self.fail_pairs:
            raise IqdCliError("store boom")
        self.store_calls.append({"nl": nl, "sql": sql, "tags": tags, "project_dir": project_dir})
        return {"exit_code": 0}

    async def write_project_files(self, files, *, project_dir=None):
        if self.fail_rules:
            raise IqdCliError("rules boom")
        self.file_calls.append({"files": files, "project_dir": project_dir})
        return {"exit_code": 0, "written": [f["path"] for f in files]}

    async def list_project_files(self, rel_dir, *, prefix=None, project_dir=None):
        if self.fail_list:
            raise IqdCliError("list boom")
        self.listed_dir = rel_dir
        return list(self.existing_files)

    async def delete_project_files(self, paths, *, project_dir=None):
        self.deleted_calls.append(list(paths))
        return {"exit_code": 0, "deleted": list(paths)}

    async def memory_reset(self, *, project_dir=None):
        self.reset_calls += 1
        return {"exit_code": 0}

    async def memory_index(self, *, project_dir=None):
        self.index_calls += 1
        return {"exit_code": 0}

    async def memory_check(self, *, project_dir=None):
        return {"exit_code": 0, "stdout": self.memory_check_output, "stderr": ""}


PAIRS = [
    {"id": 1, "question": "月活?", "wren_sql": "SELECT 1"},
    {"id": 2, "question": "坏的", "wren_sql": ""},
]
KNOWLEDGE = [
    {"id": 20, "kind": "term", "title": "月活", "content": "去重用户数"},
    {"id": 21, "kind": "metric_definition", "title": "毛利率", "content": "（收入-成本）/收入"},
    {"id": 22, "kind": "instruction", "title": "禁用词", "content": "不要用「大概」"},
]


@pytest.mark.asyncio
async def test_deliver_samples_via_memory_store_and_backfill_only_written():
    """样本逐条 ``memory store``；缺 sql 的条目不调用 CLI、也不回填。"""
    cli = FakeCli()
    out = await IqdAskService()._deliver_knowledge(
        cli,
        "/proj/9",
        pending_pairs=PAIRS,
        enabled_pairs=[PAIRS[0]],
        enabled_knowledge=KNOWLEDGE,
        pending_knowledge=[KNOWLEDGE[0]],
    )

    assert len(cli.store_calls) == 1, cli.store_calls
    assert cli.store_calls[0] == {
        "nl": "月活?",
        "sql": "SELECT 1",
        "tags": "source:mis-iqd",
        "project_dir": "/proj/9",
    }
    assert out["pair_ids"] == [1], out
    assert out["knowledge_ids"] == [20], out
    assert out["error"] and "sql_pair#2" in out["error"], out


@pytest.mark.asyncio
async def test_deliver_rules_writes_full_snapshot_with_sections():
    """规则文件：整份覆盖写、按类型分节、含全部启用条目（不只 pending）。"""
    cli = FakeCli()
    await IqdAskService()._deliver_knowledge(
        cli,
        "/proj/9",
        pending_pairs=[],
        enabled_pairs=[],
        enabled_knowledge=KNOWLEDGE,
        pending_knowledge=[KNOWLEDGE[0]],
    )

    assert len(cli.file_calls) == 1, cli.file_calls
    call = cli.file_calls[0]
    assert call["project_dir"] == "/proj/9"
    assert call["files"][0]["path"] == IQD_RULES_REL_PATH
    markdown = call["files"][0]["content"]
    for fragment in (
        "# mis-iqd 平台下发知识",
        "自动生成",
        "## 术语",
        "## 口径定义",
        "## 业务指令",
        "**月活**：去重用户数",
        "**毛利率**：（收入-成本）/收入",
        "**禁用词**：不要用「大概」",
    ):
        assert fragment in markdown, f"缺失片段 {fragment!r}：\n{markdown}"


@pytest.mark.asyncio
async def test_rules_failure_blocks_knowledge_backfill_only():
    """规则写失败 → knowledge 不回填且带 error（不再冒充已同步）。"""
    out = await IqdAskService()._deliver_knowledge(
        FakeCli(fail_rules=True),
        "/proj/9",
        pending_pairs=[],
        enabled_pairs=[],
        enabled_knowledge=KNOWLEDGE,
        pending_knowledge=[KNOWLEDGE[0]],
    )

    assert out["knowledge_ids"] == [], out
    assert out["error"] and "knowledge/rules" in out["error"], out


@pytest.mark.asyncio
async def test_pair_failure_does_not_block_rules_delivery():
    """样本 CLI 失败不阻断规则下发（互不牵连）。"""
    cli = FakeCli(fail_pairs=True)
    out = await IqdAskService()._deliver_knowledge(
        cli,
        "/proj/9",
        pending_pairs=PAIRS,
        enabled_pairs=[PAIRS[0]],
        enabled_knowledge=KNOWLEDGE,
        pending_knowledge=[KNOWLEDGE[1]],
    )

    assert out["pair_ids"] == [], out
    assert out["knowledge_ids"] == [21], out
    assert len(cli.file_calls) == 1, out


# ================================================================ 删除同步（对账回收）

def _sample_md(path: str, nl: str, sql: str, *, tags: str = "source:mis-iqd") -> dict:
    return {
        "path": path,
        # 与 wren 真实落盘一致：tags 是 **YAML 列表**（不是平铺 key: value）
        "content": f"---\nnl: {nl}\nsql: {sql}\nsource: user\ntags:\n- {tags}\n---\n",
    }


@pytest.mark.asyncio
async def test_prune_deletes_stale_and_duplicate_platform_samples_only():
    """回收：仍启用的 (nl,sql) 只留一个；过期的删；非平台文件与解析不全的都不动。"""
    enabled = [{"id": 1, "question": "月活?", "wren_sql": "SELECT 1"}]
    cli = FakeCli(
        existing_files=[
            _sample_md("knowledge/sql/query.md", "月活?", "SELECT 1"),  # 保留
            _sample_md("knowledge/sql/query-2.md", "月活?", "SELECT 1"),  # 重复 → 删
            _sample_md("knowledge/sql/query-3.md", "已删除的问题?", "SELECT 9"),  # 过期 → 删
            _sample_md(  # 人工/agent 写的（无平台 tag）→ 不动
                "knowledge/sql/monthly-revenue-check.md",
                "monthly revenue check",
                "SELECT SUM(amount) FROM orders",
                tags="source:enrich",
            ),
            {"path": "knowledge/sql/broken.md", "content": "no frontmatter"},  # 解析不全 → 不动
        ]
    )

    out = await IqdAskService()._deliver_knowledge(
        cli,
        "/proj/9",
        pending_pairs=[],
        enabled_pairs=enabled,
        enabled_knowledge=[],
        pending_knowledge=[],
    )

    assert [sorted(p) for p in cli.deleted_calls] == [
        ["knowledge/sql/query-2.md", "knowledge/sql/query-3.md"]
    ], cli.deleted_calls
    assert out["pruned"] == 2, out
    assert out["error"] is None, out
    # 回收后必须重建索引：增量 index 清不掉孤儿行（否则 memory check 会一直报 stale index）
    assert cli.reset_calls == 1 and cli.index_calls == 1, (cli.reset_calls, cli.index_calls)


@pytest.mark.asyncio
async def test_no_prune_keeps_index_untouched():
    """没有需要回收的文件时，不做 reset/index 重建（省一次全量索引）。"""
    cli = FakeCli(existing_files=[])
    out = await IqdAskService()._deliver_knowledge(
        cli,
        "/proj/9",
        pending_pairs=[],
        enabled_pairs=[],
        enabled_knowledge=[],
        pending_knowledge=[],
    )
    assert out["pruned"] == 0 and out["error"] is None, out
    assert cli.reset_calls == 0 and cli.index_calls == 0


@pytest.mark.asyncio
async def test_index_drift_is_reported():
    """wren 自检报漂移（删文件后索引残留）→ 必须上报，不静默。"""
    cli = FakeCli(
        existing_files=[_sample_md("knowledge/sql/query-9.md", "过期问题?", "SELECT 9")],
        memory_check_output=(
            "knowledge/sql: 0 pair(s); index: 1 pair(s)\n"
            "  1 user pair(s) indexed without markdown — stale index, run `wren memory index`.\n"
        ),
    )
    out = await IqdAskService()._deliver_knowledge(
        cli,
        "/proj/9",
        pending_pairs=[],
        enabled_pairs=[],
        enabled_knowledge=[],
        pending_knowledge=[],
    )
    assert out["pruned"] == 1, out
    assert out["error"] and "索引漂移" in out["error"], out


@pytest.mark.asyncio
async def test_prune_failure_is_reported_not_fatal():
    """对账/回收失败只记 error（不回滚已下发内容、不影响其它步骤）。"""
    cli = FakeCli(fail_list=True)
    out = await IqdAskService()._deliver_knowledge(
        cli,
        "/proj/9",
        pending_pairs=[],
        enabled_pairs=[],
        enabled_knowledge=[],
        pending_knowledge=[],
    )
    assert out["pruned"] == 0
    assert out["error"] and "样本对账失败" in out["error"], out


def test_parse_frontmatter_handles_yaml_folding():
    """wren 对长 SQL 会折行（缩进续行）——解析必须还原，否则会误判为「过期」而删错文件。"""
    content = (
        "---\n"
        "nl: kds by data_type\n"
        "sql: SELECT data_type, SUM(kds) FROM t GROUP\n"
        "    BY 1\n"
        "source: user\n"
        "tags:\n"
        "- source:mis-iqd\n"
        "---\n"
    )
    meta = IqdAskService._parse_knowledge_sql_md(content)
    assert meta["sql"] == "SELECT data_type, SUM(kds) FROM t GROUP BY 1", meta
    # 平台标记看 frontmatter 原文（wren 落的是 tags 列表形态，平铺解析读不到）
    assert IqdAskService._is_platform_sample(content) is True
    assert IqdAskService._is_platform_sample("---\ntags:\n- source:enrich\n---\n") is False
    assert IqdAskService._is_platform_sample("no frontmatter") is False
    assert IqdAskService._is_platform_sample("---\ntags:\n- source: mis-iqd\n---\n") is True


def test_safe_rel_path_rejects_escape():
    """project 内相对路径防护：绝对路径 / ``..`` / 空段一律拒绝。"""
    assert IqdCli._safe_rel_path("knowledge/rules/x.md") == "knowledge/rules/x.md"
    for bad in ("../etc/passwd", "/etc/passwd", "C:/Windows/x", "knowledge/../../x", "", "a//b"):
        with pytest.raises(IqdCliError):
            IqdCli._safe_rel_path(bad)
