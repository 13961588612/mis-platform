"""模板报告 Worker 主流程。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any, Literal

from src.adapters.ai_report_client import (
    AiReportCallContext,
    AiReportClient,
    AiReportClientError,
)
from src.agent.template_report.slot_extract import extract_slot_params
from src.agent.template_report.slot_intent import extract_slots_with_intent_model
from src.agent.template_report.slot_resolve import (
    classify_slot_kind,
    is_t1_blocked_date,
    resolve_slots_deterministic,
)
from src.intent_router.service import format_conversation_context_for_jev
from src.intent_router.template_report import (
    NONE_LABEL,
    load_template_report_router_config,
    resolve_template_report_route,
)
from src.utils.logging import get_logger

logger = get_logger("agent.template_report.pipeline")

AGENT_ID = "template-report"
OPEN_CARD_MARKER_PREFIX = "[[ai.report.open_card"
PREFILL_MARKER_PREFIX = "[[ai.report.prefill "

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


def format_open_card_body(
    *,
    report_code: str,
    title: str,
    prefill: dict[str, str] | None = None,
) -> str:
    """构造带机器标记的开卡正文（Coordinator 解析后发 CUSTOM + 前端预填）。

    第三行 ``[[ai.report.prefill {...}]]`` 供解析写入开卡事件 ``values``。
    """
    title_s = (title or report_code).strip() or report_code
    tip = f"已为您打开「{title_s}」参数卡，请确认参数后生成报告。"
    clean = {
        str(k).strip(): str(v).strip()
        for k, v in (prefill or {}).items()
        if str(k).strip() and str(v).strip()
    }
    if clean:
        tip = f"{tip}（已识别：{', '.join(f'{k}={v}' for k, v in clean.items())}）"
    lines = [
        f"{OPEN_CARD_MARKER_PREFIX} reportCode={report_code} title={title_s}]]",
        tip,
    ]
    if clean:
        lines.append(f"{PREFILL_MARKER_PREFIX}{json.dumps(clean, ensure_ascii=False)}]]")
    return "\n".join(lines)


def parse_open_card_marker(
    text: str,
) -> tuple[str, str, dict[str, str]] | None:
    """解析开卡标记 → (report_code, title, values)。"""
    raw = (text or "").strip()
    if not raw.startswith(OPEN_CARD_MARKER_PREFIX):
        return None
    first, _, rest = raw.partition("\n")
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
    values: dict[str, str] = {}
    for line in rest.splitlines():
        line_s = line.strip()
        if not (
            line_s.startswith(PREFILL_MARKER_PREFIX) and line_s.endswith("]]")
        ):
            continue
        payload = line_s[len(PREFILL_MARKER_PREFIX) : -2].strip()
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            for k, v in obj.items():
                ks, vs = str(k).strip(), str(v).strip()
                if ks and vs:
                    values[ks] = vs
    return report_code, title or report_code, values


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
            has_authorization=bool((authorization or "").strip()),
            has_user_id=bool((user_id or "").strip() or mis_user_id is not None),
        )
        # 权限/鉴权失败必须对用户明示，禁止再当成 miss → 通用「信息不足」
        if exc.code in {40100, 40300, 401, 403} or "无权限" in str(exc):
            tip = (
                "无法打开模板报告：当前账号没有报告目录权限"
                "（需 ai-report:view），或 Agent 调用 BFF 时身份未带上。"
                "请确认权限后重试；若前端目录正常而对话不行，请检查会话 JWT / X-User-Id。"
            )
        else:
            tip = f"无法拉取模板报告目录（{exc}），请稍后重试。"
        return TemplateReportOutcome(
            kind="error",
            text=tip,
            detail=f"catalog_error:{exc}",
            latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        )

    catalog_items = _flatten_catalog(groups)
    if not catalog_items:
        return TemplateReportOutcome(
            kind="error",
            text="当前账号可见的模板报告目录为空，无法打开参数卡。",
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

    # 抽槽上文：优先外部 history；无则用空（硬委派 attachments 由 invoke 侧注入 history）
    conv_ctx = format_conversation_context_for_jev(
        user_text,
        history_messages,
        max_context_turns=int(getattr(cfg, "max_context_turns", 3) or 3),
        max_msg_chars=max(160, int(getattr(cfg, "max_context_msg_chars", 160) or 160)),
    )
    if conv_ctx.strip() == (user_text or "").strip():
        conv_ctx = ""

    # 槽位观测：种类 + options 规模（维表是否从 prepare-card 拉到）
    slot_stats: list[dict[str, Any]] = []
    for s in slots:
        if not isinstance(s, dict):
            continue
        w = str(s.get("wire_key") or s.get("wireKey") or "").strip()
        if not w:
            continue
        opts = s.get("options") if isinstance(s.get("options"), list) else []
        slot_stats.append(
            {
                "wire": w,
                "kind": classify_slot_kind(s),
                "options": len(opts),
                "required": bool(s.get("required")),
            }
        )

    # 1) 确定性解析（日/周/月/门店 → options） 2) INTENT 一次补洞
    resolved = resolve_slots_deterministic(
        user_text, slots, conversation_context=conv_ctx
    )

    slot_cfg = getattr(cfg, "slot_intent", None)
    use_slot_intent = bool(getattr(slot_cfg, "enabled", True))
    intent_meta: dict[str, Any] = {
        "resolved": resolved,
        "conversation_context": bool(conv_ctx),
        "slot_stats": slot_stats,
    }
    explicit: dict[str, str] = dict(resolved)
    if use_slot_intent:
        slot_model = getattr(slot_cfg, "model", None)
        intent_res = await extract_slots_with_intent_model(
            user_text,
            slots,
            conversation_context=conv_ctx,
            model_name=str(getattr(slot_model, "name", "") or ""),
            endpoint=str(getattr(slot_model, "endpoint", "") or ""),
            timeout_ms=getattr(slot_model, "timeout_ms", None),
        )
        intent_meta.update(
            {
                "slot_intent_detail": intent_res.detail,
                "slot_intent_ms": intent_res.latency_ms,
                "slot_intent_raw": intent_res.raw_model,
            }
        )
        if intent_res.detail == "ok" or intent_res.explicit:
            for k, v in intent_res.explicit.items():
                explicit.setdefault(k, v)
        else:
            rules_explicit, _ = extract_slot_params(
                user_text, slots, apply_defaults=False
            )
            for k, v in rules_explicit.items():
                explicit.setdefault(k, v)
            intent_meta["fallback"] = "rules"
    else:
        rules_explicit, _ = extract_slot_params(
            user_text, slots, apply_defaults=False
        )
        for k, v in rules_explicit.items():
            explicit.setdefault(k, v)

    params = dict(explicit)
    missing_explicit: list[str] = []
    for slot in slots:
        if not isinstance(slot, dict):
            continue
        wire = str(slot.get("wire_key") or slot.get("wireKey") or "").strip()
        if not wire:
            continue
        required = bool(slot.get("required"))
        if wire not in params:
            default = slot.get("default_value") or slot.get("defaultValue")
            if default is not None and str(default).strip():
                params[wire] = str(default).strip()
        if required and wire not in explicit:
            missing_explicit.append(wire)
    intent_meta["explicit"] = explicit

    logger.info(
        "template_report_slot_assemble",
        session_id=session_id or None,
        report_code=report_code,
        resolved_keys=sorted(resolved.keys()),
        explicit_keys=sorted(explicit.keys()),
        missing_explicit=missing_explicit,
        slot_stats=slot_stats,
        has_context=bool(conv_ctx),
    )

    # 对话侧一律开参数卡，预填已识别槽；真正出数只在用户点卡确认后走前端 execute
    tip_suffix = ""
    detail = (
        f"missing_slots:{','.join(missing_explicit)}"
        if missing_explicit
        else "open_card_await_confirm"
    )
    for slot in slots:
        if not isinstance(slot, dict):
            continue
        if classify_slot_kind(slot) != "date":
            continue
        wire = str(slot.get("wire_key") or slot.get("wireKey") or "").strip()
        day_v = (explicit.get(wire) or params.get(wire) or "").strip()
        if day_v and is_t1_blocked_date(day_v):
            tip_suffix = (
                "\n经营数据为 T+1，不提供当天及之后的数据；请改选昨天或更早日期。"
            )
            detail = f"t1_blocked:{wire}={day_v}"
            # 非法日期不预填进卡，避免一点确认就带着坏值
            explicit.pop(wire, None)
            params.pop(wire, None)
            break

    return TemplateReportOutcome(
        kind="open_card",
        text=format_open_card_body(
            report_code=report_code, title=title, prefill=explicit or None
        )
        + tip_suffix,
        report_code=report_code,
        title=title,
        detail=detail,
        latency_ms=max(0, int((perf_counter() - t0) * 1000)),
        raw={
            "params_partial": params,
            "missing": missing_explicit,
            **intent_meta,
        },
    )


# re-export for tests / clarity
__all__ = [
    "AGENT_ID",
    "NONE_LABEL",
    "OPEN_CARD_MARKER_PREFIX",
    "PREFILL_MARKER_PREFIX",
    "TemplateReportOutcome",
    "format_open_card_body",
    "parse_open_card_marker",
    "run_template_report_turn",
]
