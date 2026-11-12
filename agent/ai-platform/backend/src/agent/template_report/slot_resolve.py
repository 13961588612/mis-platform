"""模板报告槽位确定性解析（权威源 = prepare-card options）。

按 value_type / wire 约定解析：相对日、周次、月、门店/枚举。
自然语言结果必须落在 options.value（有 options 时）；禁止臆造周键。
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any, Literal

from src.agent.template_report.slot_extract import _match_by_value_type
from src.agent.template_report.slot_intent import _option_maps, _slot_wire, coerce_slot_value

SlotKind = Literal["date", "week", "month", "enum"]

_RELATIVE_DAY: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"大前天"), -3),
    (re.compile(r"前天"), -2),
    (re.compile(r"昨天|昨日"), -1),
    (re.compile(r"今天|今日|当天"), 0),
    (re.compile(r"明天|明日"), 1),
]

_WEEK_REL: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"上上周|大上周"), -2),
    (re.compile(r"上周|上一周"), -1),
    (re.compile(r"本周|这周|这一周"), 0),
    (re.compile(r"下周|下一周"), 1),
]

_MONTH_REL: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"上上个月"), -2),
    (re.compile(r"上个月|上月"), -1),
    (re.compile(r"本月|这个月|当月"), 0),
    (re.compile(r"下个月|下月"), 1),
]


def _today() -> date:
    return datetime.now().astimezone().date()


def _parse_iso_date(raw: str | None) -> date | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def classify_slot_kind(slot: dict[str, Any]) -> SlotKind:
    """根据 value_type / wire_key / options.extra.grain 判定槽位种类。"""
    vt = str(slot.get("value_type") or slot.get("valueType") or "").lower()
    wire = _slot_wire(slot).lower()
    if vt in {"date", "biz_date", "day"} or wire.endswith("bizdate") or (
        wire.endswith("date") and "week" not in wire and "month" not in wire
    ):
        return "date"
    if vt in {"week", "ord_week"} or "ordweek" in wire or wire.endswith("week"):
        return "week"
    if vt in {"month", "ord_month"} or "ordmonth" in wire or wire.endswith("month"):
        return "month"
    options = slot.get("options") if isinstance(slot.get("options"), list) else []
    for opt in options[:3]:
        if not isinstance(opt, dict):
            continue
        extra = opt.get("extra") if isinstance(opt.get("extra"), dict) else {}
        grain = str(extra.get("grain") or "").lower()
        if grain == "week":
            return "week"
        if grain == "month":
            return "month"
        if grain == "day":
            return "date"
    return "enum"


def resolve_relative_date_iso(
    text: str,
    *,
    today: date | None = None,
) -> str | None:
    """从文本解析相对日 → ``YYYY-MM-DD``。"""
    raw = (text or "").strip()
    if not raw:
        return None
    base = today or _today()
    for pattern, delta in _RELATIVE_DAY:
        if pattern.search(raw):
            return (base + timedelta(days=delta)).isoformat()
    return None


def expand_relative_dates_in_text(
    text: str,
    *,
    today: date | None = None,
) -> str:
    """把相对日短语替换成 ISO 日期。"""
    raw = text or ""
    if not raw.strip():
        return raw
    base = today or _today()
    out = raw
    for pattern, delta in _RELATIVE_DAY:
        iso = (base + timedelta(days=delta)).isoformat()

        def _sub(_m: re.Match[str], *, _iso: str = iso) -> str:
            return _iso

        out = pattern.sub(_sub, out)
    return out


def match_enum_option(text: str, options: list[Any]) -> str | None:
    """枚举/门店：label/value/去「店」后缀最长子串命中。"""
    blob = (text or "").strip()
    if not blob or not options:
        return None
    scored: list[tuple[int, str]] = []
    for opt in options:
        if not isinstance(opt, dict):
            continue
        value = str(opt.get("value") or "").strip()
        label = str(opt.get("label") or "").strip()
        if not value:
            continue
        if value in blob:
            scored.append((len(value), value))
            continue
        if label and label in blob:
            scored.append((len(label), value))
            continue
        if label.endswith("店") and len(label) > 1:
            short = label[:-1]
            if short and short in blob:
                scored.append((len(short), value))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


_STORE_NAME_HINT = re.compile(
    r"[\u4e00-\u9fffA-Za-z0-9]{1,20}店|"
    r"(?:门店|分店)\s*[:：]?\s*[\u4e00-\u9fffA-Za-z0-9]{1,20}"
)
_DATE_ABS = re.compile(
    r"20\d{2}[-/年.]\s*\d{1,2}[-/月.]\s*\d{1,2}日?|"
    r"\d{1,2}月\d{1,2}日"
)
_WEEK_ABS = re.compile(r"20\d{2}\s*第?\s*\d{1,2}\s*周|第?\s*\d{1,2}\s*周|20\d{4}\b")
_MONTH_ABS = re.compile(r"20\d{2}[-/年.]\s*\d{1,2}\s*月?|\d{1,2}\s*月(?!\d)")


def _looks_like_store_slot(slot: dict[str, Any], options: list[Any]) -> bool:
    wire = _slot_wire(slot).lower()
    if "store" in wire or wire.endswith("storeid"):
        return True
    for opt in options[:8]:
        if not isinstance(opt, dict):
            continue
        label = str(opt.get("label") or "")
        if "店" in label:
            return True
    return False


def _has_date_signal(text: str) -> bool:
    blob = (text or "").strip()
    if not blob:
        return False
    if any(p.search(blob) for p, _ in _RELATIVE_DAY):
        return True
    return bool(_DATE_ABS.search(blob))


def _has_week_signal(text: str) -> bool:
    blob = (text or "").strip()
    if not blob:
        return False
    if any(p.search(blob) for p, _ in _WEEK_REL):
        return True
    return bool(_WEEK_ABS.search(blob))


def _has_month_signal(text: str) -> bool:
    blob = (text or "").strip()
    if not blob:
        return False
    if any(p.search(blob) for p, _ in _MONTH_REL):
        return True
    return bool(_MONTH_ABS.search(blob))


def _has_enum_signal(text: str, options: list[Any], slot: dict[str, Any]) -> bool:
    """本轮像在点该枚举，但未必能命中 options。"""
    blob = (text or "").strip()
    if not blob:
        return False
    if match_enum_option(blob, options):
        return True
    if _looks_like_store_slot(slot, options) and _STORE_NAME_HINT.search(blob):
        return True
    # 近失配：option 标签/值的前缀出现在本轮，但完整 match 失败
    for opt in options:
        if not isinstance(opt, dict):
            continue
        for raw in (str(opt.get("label") or ""), str(opt.get("value") or "")):
            token = raw.strip()
            if len(token) < 2:
                continue
            stem = token[:-1] if token.endswith("店") and len(token) > 2 else token
            if len(stem) >= 2 and stem in blob and token not in blob:
                return True
    return False


def _current_blocks_context(
    kind: SlotKind,
    user_text: str,
    *,
    options: list[Any],
    slot: dict[str, Any],
) -> bool:
    """本轮对该槽有表述却未解析成功时，禁止用上文兜底。"""
    text = (user_text or "").strip()
    if not text:
        return False
    if kind == "date":
        return _has_date_signal(text)
    if kind == "week":
        return _has_week_signal(text)
    if kind == "month":
        return _has_month_signal(text)
    return _has_enum_signal(text, options, slot)


def _apply_allowed(value: str | None, allowed: set[str]) -> str | None:
    if not value:
        return None
    if allowed and value not in allowed:
        return None
    return value


def _option_range(opt: dict[str, Any]) -> tuple[date | None, date | None]:
    extra = opt.get("extra") if isinstance(opt.get("extra"), dict) else {}
    start = _parse_iso_date(str(extra.get("startDate") or extra.get("start_date") or ""))
    end = _parse_iso_date(str(extra.get("endDate") or extra.get("end_date") or ""))
    return start, end


def _sorted_week_options(options: list[Any]) -> list[dict[str, Any]]:
    rows: list[tuple[date, dict[str, Any]]] = []
    for opt in options:
        if not isinstance(opt, dict):
            continue
        if not str(opt.get("value") or "").strip():
            continue
        start, _end = _option_range(opt)
        # 无起止时用极早日期垫底，仍参与 label 匹配但不参与相对周偏移
        rows.append((start or date.min, opt))
    rows.sort(key=lambda x: x[0], reverse=True)
    return [r[1] for r in rows]


def resolve_week_option(
    text: str,
    options: list[Any],
    *,
    today: date | None = None,
) -> str | None:
    """周次：相对语（本周/上周）或 label/value 子串 → options.value。"""
    if not options:
        return None
    blob = (text or "").strip()
    if not blob:
        return None
    base = today or _today()

    # 1) label / value 直接命中
    hit = match_enum_option(blob, options)
    if hit:
        return hit

    # 2) 相对周：用 startDate/endDate 锚定
    offset: int | None = None
    for pattern, delta in _WEEK_REL:
        if pattern.search(blob):
            offset = delta
            break
    if offset is None:
        return None

    ordered = _sorted_week_options(options)
    current_idx: int | None = None
    for i, opt in enumerate(ordered):
        start, end = _option_range(opt)
        if start and end and start <= base <= end:
            current_idx = i
            break
    if current_idx is None and ordered:
        # 列表按 start 倒序：第一条常为最近周，近似「本周」
        current_idx = 0
    if current_idx is None:
        return None
    # ordered 新→旧：offset=-1(上周) → index+1
    target = current_idx - offset
    if target < 0 or target >= len(ordered):
        return None
    return str(ordered[target].get("value") or "").strip() or None


def _shift_month(ym: date, delta: int) -> str:
    y, m = ym.year, ym.month + delta
    while m <= 0:
        m += 12
        y -= 1
    while m > 12:
        m -= 12
        y += 1
    return f"{y:04d}-{m:02d}"


def resolve_month_option(
    text: str,
    options: list[Any],
    *,
    today: date | None = None,
) -> str | None:
    """月：相对语或 YYYY-MM / label → options.value。"""
    blob = (text or "").strip()
    if not blob:
        return None
    base = today or _today()

    hit = match_enum_option(blob, options) if options else None
    if hit:
        return hit

    offset: int | None = None
    for pattern, delta in _MONTH_REL:
        if pattern.search(blob):
            offset = delta
            break
    candidate: str | None = None
    if offset is not None:
        candidate = _shift_month(base.replace(day=1), offset)
    else:
        m = re.search(r"(20\d{2})[-/年.]?\s*(\d{1,2})月?", blob)
        if m and "日" not in blob[m.start() : m.end() + 2]:
            candidate = f"{m.group(1)}-{int(m.group(2)):02d}"

    if not candidate:
        return None
    if not options:
        return candidate
    allowed = {
        str(o.get("value") or "").strip()
        for o in options
        if isinstance(o, dict) and str(o.get("value") or "").strip()
    }
    if candidate in allowed:
        return candidate
    # value 可能是 202611 无横线
    compact = candidate.replace("-", "")
    for v in allowed:
        if v.replace("-", "") == compact or candidate in v or v in candidate:
            return v
    return None


def is_t1_blocked_date(iso_day: str, *, today: date | None = None) -> bool:
    """经营日 T+1：今天及以后不可用。"""
    d = _parse_iso_date(iso_day)
    if d is None:
        return False
    return d >= (today or _today())


def _resolve_date_in_text(
    text: str,
    *,
    today: date,
    allowed: set[str],
) -> str | None:
    value = resolve_relative_date_iso(text, today=today)
    if not value:
        expanded = expand_relative_dates_in_text(text, today=today)
        value = _match_by_value_type(expanded, "date")
    return _apply_allowed(value, allowed)


def resolve_slots_deterministic(
    user_text: str,
    slots: list[dict[str, Any]],
    *,
    conversation_context: str = "",
    today: date | None = None,
) -> dict[str, str]:
    """确定性抽槽：本轮优先；本轮有表述未命中则不开上文兜底。"""
    base = today or _today()
    current = (user_text or "").strip()
    context = (conversation_context or "").strip()
    if not current and not context:
        return {}

    found: dict[str, str] = {}
    for slot in slots:
        if not isinstance(slot, dict):
            continue
        wire = _slot_wire(slot)
        if not wire:
            continue
        kind = classify_slot_kind(slot)
        options = slot.get("options") if isinstance(slot.get("options"), list) else []
        allowed, _ = _option_maps(slot)

        value: str | None = None
        if kind == "date":
            value = _resolve_date_in_text(current, today=base, allowed=allowed)
        elif kind == "week":
            value = resolve_week_option(current, options, today=base)
        elif kind == "month":
            value = resolve_month_option(current, options, today=base)
        else:
            value = match_enum_option(
                expand_relative_dates_in_text(current, today=base),
                options,
            )

        if not value and context and not _current_blocks_context(
            kind, current, options=options, slot=slot
        ):
            if kind == "date":
                value = _resolve_date_in_text(context, today=base, allowed=allowed)
            elif kind == "week":
                value = resolve_week_option(context, options, today=base)
            elif kind == "month":
                value = resolve_month_option(context, options, today=base)
            else:
                value = match_enum_option(
                    expand_relative_dates_in_text(context, today=base),
                    options,
                )

        if value:
            coerced = coerce_slot_value(slot, value)
            if coerced:
                found[wire] = coerced
    return found


# 兼容旧名
match_store_option = match_enum_option
