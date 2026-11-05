"""Coordinator system prompt：worker_ids + when_to_use 自动意图表。"""

from __future__ import annotations

from src.coordinator.catalog import WorkerCatalog, WorkerSpec
from src.coordinator.prompt_compose import (
    DELEGATION_TABLE_PLACEHOLDER,
    compose_coordinator_system_prompt,
    inject_delegation_table,
    render_delegation_worker_table,
)


def test_render_delegation_worker_table() -> None:
    catalog = WorkerCatalog(
        workers={
            "spm-report": WorkerSpec(
                agent_id="spm-report",
                display_name="超市报表",
                when_to_use="门店列表与销售报表",
            ),
            "mis-rag": WorkerSpec(
                agent_id="mis-rag",
                display_name="知识库",
                when_to_use="制度检索",
            ),
        }
    )
    table = render_delegation_worker_table(catalog)
    assert "spm-report" in table
    assert "mis-rag" in table
    assert "门店列表" in table
    assert "| agent_id |" in table


def test_inject_replaces_placeholder() -> None:
    base = f"# Copilot\n\n## 可委派\n\n{DELEGATION_TABLE_PLACEHOLDER}\n\n## 禁止\n- x\n"
    out = inject_delegation_table(base, "| agent_id | 名称 | 何时委派 |\n| a | b | c |")
    assert DELEGATION_TABLE_PLACEHOLDER not in out
    assert "| a | b | c |" in out
    assert "## 禁止" in out


def test_compose_with_empty_scoped_catalog(monkeypatch) -> None:
    def _empty(_cid: str) -> WorkerCatalog:
        return WorkerCatalog(workers={})

    monkeypatch.setattr(
        "src.coordinator.prompt_compose.build_scoped_catalog",
        _empty,
    )
    out = compose_coordinator_system_prompt(
        "mis-copilot",
        f"前言\n\n{DELEGATION_TABLE_PLACEHOLDER}\n\n后记\n",
    )
    assert "worker_ids 为空" in out or "可派发执行者" in out
    assert DELEGATION_TABLE_PLACEHOLDER not in out
