"""从用户自然语言对照 prepare-card options 抽取槽位。"""

from __future__ import annotations

import re
from typing import Any


def extract_slot_params(
    user_text: str,
    slots: list[dict[str, Any]],
) -> tuple[dict[str, str], list[str]]:
    """抽取 ``wire_key → value``；返回 (params, missing_required_wire_keys)。"""
    text = (user_text or "").strip()
    params: dict[str, str] = {}
    missing: list[str] = []

    for slot in slots:
        if not isinstance(slot, dict):
            continue
        wire = str(slot.get("wire_key") or slot.get("wireKey") or "").strip()
        if not wire:
            continue
        required = bool(slot.get("required"))
        options = slot.get("options") if isinstance(slot.get("options"), list) else []
        value = _match_option(text, options)
        if not value:
            default = slot.get("default_value") or slot.get("defaultValue")
            if default is not None and str(default).strip():
                value = str(default).strip()
        if not value:
            value = _match_by_value_type(text, str(slot.get("value_type") or ""))
        if value:
            params[wire] = value
        elif required:
            missing.append(wire)

    return params, missing


def _match_option(text: str, options: list[Any]) -> str | None:
    if not text or not options:
        return None
    # 长 label 优先，减少短串误伤
    scored: list[tuple[int, str]] = []
    for opt in options:
        if not isinstance(opt, dict):
            continue
        value = str(opt.get("value") or "").strip()
        label = str(opt.get("label") or "").strip()
        if not value:
            continue
        if value and value in text:
            scored.append((len(value), value))
            continue
        if label and label in text:
            scored.append((len(label), value))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


_DATE_RE = re.compile(r"(20\d{2})[-/年.]?\s*(\d{1,2})[-/月.]?\s*(\d{1,2})日?")
_YM_RE = re.compile(r"(20\d{2})[-/年.]?\s*(\d{1,2})月?")


def _match_by_value_type(text: str, value_type: str) -> str | None:
    vt = (value_type or "").lower()
    if vt in {"date", "biz_date", "day"}:
        m = _DATE_RE.search(text)
        if m:
            y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
            return f"{y}-{mo:02d}-{d:02d}"
    if vt in {"week", "ord_week"}:
        # 无权威周键时交给参数卡；不强行编造
        return None
    if vt in {"month", "ord_month"}:
        m = _YM_RE.search(text)
        if m and "日" not in text[m.start() : m.end() + 2]:
            y, mo = m.group(1), int(m.group(2))
            return f"{y}-{mo:02d}"
    return None
