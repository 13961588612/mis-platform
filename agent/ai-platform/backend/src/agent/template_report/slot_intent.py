"""命中报告后：用 INTENT_DETECT 模型做一次槽位识别，并按 prepare-card options 校验。"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

import httpx

from src.agent.template_report.slot_extract import _match_by_value_type
from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("agent.template_report.slot_intent")

_NONE_TOKENS = {"", "null", "none", "nil", "undefined", "-", "无", "未指定"}
_JSON_OBJ_RE = re.compile(r"\{[\s\S]*\}")


@dataclass
class SlotIntentResult:
    """一次槽位意图识别结果。"""

    #: 已通过 options / 类型校验的显式值（不含 default）
    explicit: dict[str, str] = field(default_factory=dict)
    #: explicit + 缺省槽用 default 补齐后的完整参数
    params: dict[str, str] = field(default_factory=dict)
    #: 补齐后仍缺的必填 wire_key
    missing_required: list[str] = field(default_factory=list)
    #: 仅缺「模型未识别」的必填（开卡用；有 default 也不算已识别）
    missing_explicit: list[str] = field(default_factory=list)
    latency_ms: int = 0
    detail: str = ""
    raw_model: dict[str, Any] = field(default_factory=dict)


def _elapsed_ms(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def _slot_wire(slot: dict[str, Any]) -> str:
    return str(slot.get("wire_key") or slot.get("wireKey") or "").strip()


def _slot_default(slot: dict[str, Any]) -> str | None:
    raw = slot.get("default_value")
    if raw is None:
        raw = slot.get("defaultValue")
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _option_maps(slot: dict[str, Any]) -> tuple[set[str], dict[str, str]]:
    """返回 (允许的 value 集合, label/value 文本 → value)。"""
    options = slot.get("options") if isinstance(slot.get("options"), list) else []
    values: set[str] = set()
    aliases: dict[str, str] = {}
    for opt in options:
        if not isinstance(opt, dict):
            continue
        value = str(opt.get("value") or "").strip()
        if not value:
            continue
        values.add(value)
        aliases[value.lower()] = value
        label = str(opt.get("label") or "").strip()
        if label:
            aliases[label.lower()] = value
    return values, aliases


def coerce_slot_value(slot: dict[str, Any], raw: Any) -> str | None:
    """把模型原始输出规范为可选用的 value；不在报告数据内则返回 None。"""
    if raw is None:
        return None
    text = str(raw).strip()
    if text.lower() in _NONE_TOKENS:
        return None

    allowed, aliases = _option_maps(slot)
    if allowed:
        if text in allowed:
            return text
        mapped = aliases.get(text.lower())
        if mapped is not None:
            return mapped
        # 模型偶发回「value label」拼接
        for value in allowed:
            if value in text:
                return value
        for alias, value in aliases.items():
            if alias and alias in text.lower():
                return value
        return None

    # 无 options：按 value_type 校验（日期等）；过不了则丢弃，交给 default
    typed = _match_by_value_type(text, str(slot.get("value_type") or slot.get("valueType") or ""))
    if typed:
        return typed
    # 无 options 且无类型规则：不信任自由文本，避免幻觉编码
    return None


def _build_slot_prompt_payload(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for slot in slots:
        if not isinstance(slot, dict):
            continue
        wire = _slot_wire(slot)
        if not wire:
            continue
        options = slot.get("options") if isinstance(slot.get("options"), list) else []
        opt_rows: list[dict[str, str]] = []
        for opt in options:
            if not isinstance(opt, dict):
                continue
            value = str(opt.get("value") or "").strip()
            if not value:
                continue
            opt_rows.append(
                {
                    "value": value,
                    "label": str(opt.get("label") or "").strip(),
                }
            )
        out.append(
            {
                "wire_key": wire,
                "required": bool(slot.get("required")),
                "value_type": str(slot.get("value_type") or slot.get("valueType") or ""),
                "options": opt_rows,
            }
        )
    return out


def _parse_model_json(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    if not text:
        return {}
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else {}
    except json.JSONDecodeError:
        m = _JSON_OBJ_RE.search(text)
        if not m:
            return {}
        try:
            obj = json.loads(m.group(0))
            return obj if isinstance(obj, dict) else {}
        except json.JSONDecodeError:
            return {}


async def extract_slots_with_intent_model(
    user_text: str,
    slots: list[dict[str, Any]],
    *,
    conversation_context: str = "",
    model_name: str = "",
    endpoint: str = "",
    timeout_ms: int | None = None,
) -> SlotIntentResult:
    """决策命中后：INTENT_DETECT 一次抽槽，并按 prepare-card 数据校验。

    - 模型给出的值必须落在该槽 ``options.value``（或可映射的 label）内，否则丢弃；
    - 无 options 的槽仅接受 ``value_type`` 可解析值；
    - 丢弃后回退该槽 ``default_value``；
    - ``missing_explicit``：必填且模型未给出合法值（即使有 default）→ 用于开参数卡。
    """
    t0 = perf_counter()
    usable = [s for s in slots if isinstance(s, dict) and _slot_wire(s)]
    if not usable:
        return SlotIntentResult(detail="empty_slots", latency_ms=_elapsed_ms(t0))

    settings = get_settings()
    model = (model_name or settings.INTENT_DETECT_MODEL or "").strip()
    if not model:
        return SlotIntentResult(detail="model empty", latency_ms=_elapsed_ms(t0))
    # 槽位识别固定走意图 Chat，禁止误用 decision-model System One
    if model.lower().startswith("decision-model"):
        model = (settings.INTENT_DETECT_MODEL or "tongyi-intent-detect-v3").strip()

    api_key = (settings.INTENT_DETECT_API_KEY or "").strip()
    if not api_key or api_key.startswith("your-"):
        return SlotIntentResult(
            detail="INTENT_DETECT_API_KEY not configured",
            latency_ms=_elapsed_ms(t0),
        )
    base = (endpoint or settings.INTENT_DETECT_ENDPOINT or "").rstrip("/")
    if not base:
        return SlotIntentResult(detail="INTENT_DETECT_ENDPOINT empty", latency_ms=_elapsed_ms(t0))

    timeout_s = max(
        0.2,
        (
            timeout_ms
            if timeout_ms is not None
            else settings.INTENT_DETECT_TIMEOUT_MS
        )
        / 1000.0,
    )

    payload_slots = _build_slot_prompt_payload(usable)
    slots_json = json.dumps(payload_slots, ensure_ascii=False)
    system_prompt = (
        "You are Qwen, created by Alibaba Cloud. You are a helpful assistant.\n"
        "从用户话中抽取模板报告参数。只输出一个 JSON 对象："
        "键必须是 wire_key，值为对应参数的 value。"
        "有 options 时 value 必须从 options.value 中选；也可用 label 对应到 value。"
        "短跟问（如「前天的」）须结合对话上文已确认的门店/日期等条件。"
        "相对日（昨天/前天/今天）请写成 YYYY-MM-DD。"
        "用户未提到或无法确定的键填 null。"
        "不要编造不在 options 里的编码。不要输出解释或 markdown。\n"
        f"slots={slots_json}"
    )
    ctx = (conversation_context or "").strip()
    user_payload = (user_text or "").strip()
    if ctx and ctx != user_payload:
        user_payload = f"{ctx}\n\n【本轮】\n{user_payload}"
    url = f"{base}/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_payload},
        ],
        "temperature": 0,
        "max_tokens": 256,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            resp_body = resp.json()
    except Exception as exc:  # noqa: BLE001
        ms = _elapsed_ms(t0)
        logger.warning("slot intent model failed", error=str(exc), latency_ms=ms)
        return SlotIntentResult(detail=f"intent_error:{exc}", latency_ms=ms)

    content = ""
    try:
        content = str(resp_body["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return SlotIntentResult(
            detail="intent_bad_response",
            latency_ms=_elapsed_ms(t0),
        )

    raw_obj = _parse_model_json(content)
    explicit: dict[str, str] = {}
    rejected: dict[str, Any] = {}
    for slot in usable:
        wire = _slot_wire(slot)
        if wire not in raw_obj:
            continue
        coerced = coerce_slot_value(slot, raw_obj.get(wire))
        if coerced is None:
            rejected[wire] = raw_obj.get(wire)
            continue
        explicit[wire] = coerced

    params = dict(explicit)
    missing_explicit: list[str] = []
    missing_required: list[str] = []
    for slot in usable:
        wire = _slot_wire(slot)
        required = bool(slot.get("required"))
        if wire not in params:
            default = _slot_default(slot)
            if default is not None:
                # default 也须过 options 校验（防止脏默认）
                coerced_default = coerce_slot_value(slot, default)
                if coerced_default is None and not _option_maps(slot)[0]:
                    coerced_default = default
                if coerced_default is not None:
                    params[wire] = coerced_default
        if required and wire not in explicit:
            missing_explicit.append(wire)
        if required and wire not in params:
            missing_required.append(wire)

    ms = _elapsed_ms(t0)
    logger.info(
        "template_report_slot_intent",
        latency_ms=ms,
        explicit_keys=sorted(explicit.keys()),
        rejected_keys=sorted(rejected.keys()),
        missing_explicit=missing_explicit,
        model=model,
    )
    return SlotIntentResult(
        explicit=explicit,
        params=params,
        missing_required=missing_required,
        missing_explicit=missing_explicit,
        latency_ms=ms,
        detail="ok",
        raw_model={"content": content[:500], "parsed": raw_obj, "rejected": rejected},
    )
