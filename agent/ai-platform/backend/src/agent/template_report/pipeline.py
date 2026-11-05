"""模板报告 Worker 主流程。"""

from __future__ import annotations

from dataclasses import dataclass, field
from time import perf_counter
from typing import Any, Literal

from src.adapters.ai_report_client import (
    AiReportCallContext,
    AiReportClient,
    AiReportClientError,
)
from src.agent.template_report.slot_extract import extract_slot_params
from src.intent_router.template_report import (
    NONE_LABEL,
    load_template_report_router_config,
    resolve_template_report_route,
)
from src.utils.logging import get_logger

logger = get_logger("agent.template_report.pipeline")

AGENT_ID = "template-report"
OPEN_CARD_MARKER_PREFIX = "[[ai.report.open_card"

OutcomeKind = Literal["miss", "open_card", "executed", "error"]


@dataclass
class TemplateReportOutcome:
    """Worker 一轮结果。"""

    kind: OutcomeKind
    text: str = ""
    report_code: str | None = None
    title: str | None = None
    latency_ms: int = 0
    detail: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


def format_open_card_body(*, report_code: str, title: str) -> str:
    """构造带机器标记的开卡正文（Coordinator 解析后发 CUSTOM）。"""
    title_s = (title or report_code).strip() or report_code
    tip = f"已为您打开「{title_s}」参数卡，请确认参数后生成报告。"
    return (
        f"{OPEN_CARD_MARKER_PREFIX} reportCode={report_code} title={title_s}]]\n"
        f"{tip}"
    )


def parse_open_card_marker(text: str) -> tuple[str, str] | None:
    """解析开卡标记 → (report_code, title)。"""
    raw = (text or "").strip()
    if not raw.startswith(OPEN_CARD_MARKER_PREFIX):
        return None
    first, _, _rest = raw.partition("\n")
    # [[ai.report.open_card reportCode=X title=Y]]
    inner = first.strip()
    if inner.startswith(OPEN_CARD_MARKER_PREFIX) and inner.endswith("]]"):
        inner = inner[len(OPEN_CARD_MARKER_PREFIX) : -2].strip()
    report_code = ""
    title = ""
    for part in inner.split():
        if part.startswith("reportCode="):
            report_code = part.split("=", 1)[1].strip()
        elif part.startswith("title="):
            title = part.split("=", 1)[1].strip()
    if not report_code:
        return None
    return report_code, title or report_code


def _flatten_catalog(
    groups: list[dict[str, Any]],
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for g in groups:
        if not isinstance(g, dict):
            continue
        reports = g.get("reports")
        if not isinstance(reports, list):
            continue
        for r in reports:
            if not isinstance(r, dict):
                continue
            code = str(r.get("report_code") or r.get("reportCode") or "").strip()
            if not code:
                continue
            title = str(r.get("title") or "").strip() or code
            desc = str(r.get("description") or "").strip()
            items.append({"code": code, "title": title, "description": desc})
    return items


def _build_decision_labels(
    catalog_items: list[dict[str, str]],
    *,
    participate_codes: list[str],
    description_overrides: dict[str, str],
) -> dict[str, str]:
    allow = {c.strip() for c in participate_codes if c and str(c).strip()}
    labels: dict[str, str] = {}
    for item in catalog_items:
        code = item["code"]
        if allow and code not in allow:
            continue
        override = (description_overrides.get(code) or "").strip()
        if override:
            labels[code] = override
        else:
            title = item.get("title") or code
            desc = item.get("description") or ""
            labels[code] = f"{title}。{desc}".strip("。")
    return labels


def _format_execute_markdown(data: dict[str, Any]) -> str:
    title = str(data.get("title") or data.get("report_code") or "模板报告").strip()
    message = str(data.get("message") or "").strip()
    columns = data.get("columns") if isinstance(data.get("columns"), list) else []
    rows = data.get("rows") if isinstance(data.get("rows"), list) else []
    lines = [f"### {title}"]
    if message:
        lines.append(message)
    if columns and rows:
        cols = [str(c) for c in columns]
        lines.append("")
        lines.append("| " + " | ".join(cols) + " |")
        lines.append("| " + " | ".join("---" for _ in cols) + " |")
        for row in rows:
            if not isinstance(row, dict):
                continue
            lines.append(
                "| "
                + " | ".join(str(row.get(c, "")) for c in cols)
                + " |"
            )
    elif not message:
        lines.append("执行完成。")
    return "\n".join(lines).strip()


async def run_template_report_turn(
    *,
    user_text: str,
    authorization: str = "",
    user_id: str = "",
    mis_user_id: int | None = None,
    trace_id: str = "",
    history_messages: list[dict[str, Any]] | None = None,
    session_id: str = "",
) -> TemplateReportOutcome:
    """执行一轮：未命中立即 miss；命中则抽槽执行或开参数卡。"""
    t0 = perf_counter()
    cfg = load_template_report_router_config(AGENT_ID)
    if cfg is None or not cfg.enabled:
        return TemplateReportOutcome(
            kind="miss",
            detail="disabled",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        )

    ctx = AiReportCallContext(
        authorization=authorization,
        user_id=user_id,
        mis_user_id=mis_user_id,
        trace_id=trace_id,
    )
    client = AiReportClient()

    try:
        groups = await client.catalog(ctx)
    except AiReportClientError as exc:
        logger.warning(
            "template report catalog failed",
            error=str(exc),
            code=exc.code,
            session_id=session_id or None,
        )
        return TemplateReportOutcome(
            kind="miss",
            detail=f"catalog_error:{exc}",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        )

    catalog_items = _flatten_catalog(groups)
    if not catalog_items:
        return TemplateReportOutcome(
            kind="miss",
            detail="empty_catalog",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        )

    participate = list(getattr(cfg, "participate_codes", None) or [])
    overrides = dict(getattr(cfg, "description_overrides", None) or {})
    labels = _build_decision_labels(
        catalog_items,
        participate_codes=participate,
        description_overrides=overrides,
    )
    if not labels:
        return TemplateReportOutcome(
            kind="miss",
            detail="empty_labels",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        )

    decision = await resolve_template_report_route(
        AGENT_ID,
        user_text,
        config=cfg,
        history_messages=history_messages,
        session_id=session_id,
        label_overrides=labels,
    )
    if decision is None or not (decision.report_code or "").strip():
        return TemplateReportOutcome(
            kind="miss",
            detail=(decision.detail if decision else "no_decision"),
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
            raw=(decision.raw if decision else {}),
        )

    report_code = str(decision.report_code).strip()
    title = (decision.title or "").strip()
    if not title:
        for item in catalog_items:
            if item["code"] == report_code:
                title = item["title"]
                break
        title = title or report_code

    try:
        prepared = await client.prepare_card(ctx, report_code)
    except AiReportClientError as exc:
        if exc.code == 40321:
            return TemplateReportOutcome(
                kind="error",
                text="无权限或无可选参数，无法打开该模板报告。",
                report_code=report_code,
                title=title,
                detail=f"prepare_40321:{exc}",
                latency_ms=max(0, int((perf_counter() - t0) * 1000)),
            )
        logger.warning(
            "template report prepare-card failed",
            report_code=report_code,
            error=str(exc),
        )
        return TemplateReportOutcome(
            kind="open_card",
            text=format_open_card_body(report_code=report_code, title=title),
            report_code=report_code,
            title=title,
            detail=f"prepare_error_fallback_card:{exc}",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        )

    title = str(prepared.get("title") or title).strip() or title
    slots = prepared.get("slots") if isinstance(prepared.get("slots"), list) else []
    params, missing = extract_slot_params(user_text, slots)

    if missing:
        return TemplateReportOutcome(
            kind="open_card",
            text=format_open_card_body(report_code=report_code, title=title),
            report_code=report_code,
            title=title,
            detail=f"missing_slots:{','.join(missing)}",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
            raw={"params_partial": params, "missing": missing},
        )

    try:
        executed = await client.execute(ctx, report_code, params)
    except AiReportClientError as exc:
        logger.warning(
            "template report execute failed",
            report_code=report_code,
            error=str(exc),
        )
        return TemplateReportOutcome(
            kind="open_card",
            text=format_open_card_body(report_code=report_code, title=title),
            report_code=report_code,
            title=title,
            detail=f"execute_error_fallback_card:{exc}",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        )

    body = _format_execute_markdown(executed)
    return TemplateReportOutcome(
        kind="executed",
        text=body,
        report_code=report_code,
        title=title,
        detail="executed",
        latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        raw={"params": params},
    )


# re-export for tests / clarity
__all__ = [
    "AGENT_ID",
    "NONE_LABEL",
    "OPEN_CARD_MARKER_PREFIX",
    "TemplateReportOutcome",
    "format_open_card_body",
    "parse_open_card_marker",
    "run_template_report_turn",
]
