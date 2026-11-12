"""Coordinator system prompt：按 worker_ids + when_to_use 注入可委派意图表。"""

from __future__ import annotations

from src.coordinator.catalog import WorkerCatalog, WorkerSpec, build_scoped_catalog
from src.utils.logging import get_logger

logger = get_logger("coordinator.prompt_compose")

#: system.md 中可替换占位符；缺失时在「可委派」标题后追加或文末追加
DELEGATION_TABLE_PLACEHOLDER = "{{DELEGATION_WORKER_TABLE}}"


def render_delegation_worker_table(catalog: WorkerCatalog) -> str:
    """渲染 Markdown 意图表（仅 scoped catalog 内 Worker）。"""
    specs = [catalog.workers[wid] for wid in catalog.worker_ids()]
    if not specs:
        return (
            "（当前 coordination.worker_ids 为空或无可用 Worker；"
            "请在管理台「可派发执行者」中勾选。）"
        )
    lines = [
        "| agent_id | 名称 | 何时委派 |",
        "|----------|------|----------|",
    ]
    for spec in specs:
        lines.append(_table_row(spec))
    return "\n".join(lines)


def _table_row(spec: WorkerSpec) -> str:
    name = (spec.display_name or spec.agent_id).replace("|", "/")
    hint = (spec.when_to_use or "（未声明 when_to_use，谨慎委派）").replace("|", "/")
    # 表格单元格压成一行
    hint = " ".join(hint.split())
    return f"| {spec.agent_id} | {name} | {hint} |"


def inject_delegation_table(base_prompt: str, table: str) -> str:
    """把意图表写入 base prompt。"""
    base = (base_prompt or "").rstrip()
    table_s = (table or "").strip()
    if not base:
        return (
            "# Coordinator\n\n## 可委派执行者（由调度配置自动生成）\n\n"
            f"{table_s}\n"
        )
    if DELEGATION_TABLE_PLACEHOLDER in base:
        return base.replace(DELEGATION_TABLE_PLACEHOLDER, table_s)
    # 兼容旧文案：已有「可委派」小节则插在其后首个空行块；否则文末追加
    marker = "## 可委派"
    idx = base.find(marker)
    if idx >= 0:
        # 找到该节标题行结束，插入自动表并去掉其后手写旧表（直到下一个 ##）
        rest = base[idx:]
        nl = rest.find("\n")
        head = base[: idx + (nl + 1 if nl >= 0 else len(rest))]
        after = rest[nl + 1 :] if nl >= 0 else ""
        next_h = after.find("\n## ")
        tail = after[next_h:] if next_h >= 0 else ""
        return (
            f"{head.rstrip()}\n\n"
            f"（以下表格由 coordination.worker_ids + 各 Worker when_to_use 自动生成，"
            f"勿与详情页可派名单双写。）\n\n"
            f"{table_s}\n"
            f"{tail}"
        ).rstrip() + "\n"
    return (
        f"{base}\n\n## 可委派执行者（自动生成）\n\n{table_s}\n"
    )


def compose_coordinator_system_prompt(
    coordinator_id: str,
    base_prompt: str,
) -> str:
    """为 Coordinator 组装最终 system prompt（注入 scoped 意图表）。

    Args:
        coordinator_id: 如 ``mis-copilot``。
        base_prompt: ``system.md`` 原文。

    Returns:
        注入后的全文；catalog 失败时返回原文并打日志。
    """
    cid = (coordinator_id or "").strip()
    if not cid:
        return base_prompt or ""
    try:
        catalog = build_scoped_catalog(cid)
        table = render_delegation_worker_table(catalog)
        return inject_delegation_table(base_prompt or "", table)
    except Exception as exc:  # noqa: BLE001 - 注入失败不阻断对话
        logger.warning(
            "compose coordinator system prompt failed",
            coordinator_id=cid,
            error=str(exc),
        )
        return base_prompt or ""
