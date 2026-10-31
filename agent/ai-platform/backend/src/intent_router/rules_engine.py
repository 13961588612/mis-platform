"""规则引擎：按序匹配；``when.type=jev`` 的步骤调用意图模型。"""

from __future__ import annotations

import re
from time import perf_counter

from src.intent_router.jev_client import classify_intent_label
from src.intent_router.models import (
    IntentRouteDecision,
    IntentRouterConfig,
    IntentRule,
    IntentThen,
)
from src.utils.logging import get_logger

logger = get_logger("intent_router.rules")


def _elapsed_ms(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def _match_keyword(text: str, rule: IntentRule) -> bool:
    when = rule.when
    hay = text if when.case_sensitive else text.lower()
    anys = when.any or []
    alls = when.all or []
    if not anys and not alls:
        return False

    def _norm(s: str) -> str:
        return s if when.case_sensitive else s.lower()

    if anys and not any(_norm(k) in hay for k in anys if k):
        return False
    if alls and not all(_norm(k) in hay for k in alls if k):
        return False
    return True


def _match_regex(text: str, rule: IntentRule) -> bool:
    flags = 0 if rule.when.case_sensitive else re.IGNORECASE
    for pattern in rule.when.patterns or []:
        if not pattern:
            continue
        try:
            if re.search(pattern, text, flags=flags):
                return True
        except re.error as exc:
            logger.warning("Invalid intent rule regex", rule_id=rule.id, error=str(exc))
    return False


async def _match_jev(
    text: str,
    rule: IntentRule,
    config: IntentRouterConfig,
) -> tuple[bool, int, str]:
    labels = rule.when.labels or {}
    want = (rule.when.match_label or "").strip()
    if not labels or not want:
        return False, 0, "jev_rule_incomplete"
    tag, ms, detail = await classify_intent_label(
        user_text=text,
        labels=labels,
        model_name=config.model.name or None,
        endpoint=config.model.endpoint or None,
        timeout_ms=config.model.timeout_ms,
    )
    if tag == want:
        return True, ms, detail
    return False, ms, f"jev_miss:{tag}:{detail}"


def _decision_from_then(
    *,
    config: IntentRouterConfig,
    rule: IntentRule | None,
    then: IntentThen,
    used_jev: bool,
    latency_ms: int,
    detail: str,
) -> IntentRouteDecision:
    return IntentRouteDecision(
        enabled=True,
        engine=config.engine,
        matched_rule_id=rule.id if rule else None,
        router_skill=then.router_skill or None,
        worker_id=then.worker_id or None,
        intent=then.intent or None,
        used_jev=used_jev,
        latency_ms=latency_ms,
        detail=detail,
    )


async def evaluate_rules(
    user_text: str,
    config: IntentRouterConfig,
) -> IntentRouteDecision:
    """按规则列表求值，返回首个命中决策。"""
    t0 = perf_counter()
    text = user_text or ""
    total_jev_ms = 0
    used_jev = False

    for rule in config.rules:
        when_type = rule.when.type
        matched = False
        step_detail = ""

        if when_type == "always":
            matched = True
            step_detail = "always"
        elif when_type == "keyword":
            matched = _match_keyword(text, rule)
            step_detail = "keyword"
        elif when_type == "regex":
            matched = _match_regex(text, rule)
            step_detail = "regex"
        elif when_type == "jev":
            matched, jev_ms, step_detail = await _match_jev(text, rule, config)
            total_jev_ms += jev_ms
            used_jev = True
        else:
            logger.warning("Unknown when.type", rule_id=rule.id, type=when_type)
            continue

        if matched:
            return _decision_from_then(
                config=config,
                rule=rule,
                then=rule.then,
                used_jev=used_jev,
                latency_ms=_elapsed_ms(t0),
                detail=step_detail,
            )

    # 未命中
    if config.on_fail == "fallback_router_skill" and config.fallback_router_skill:
        return IntentRouteDecision(
            enabled=True,
            engine=config.engine,
            router_skill=config.fallback_router_skill,
            used_jev=used_jev,
            latency_ms=_elapsed_ms(t0),
            detail="fallback_router_skill",
        )
    return IntentRouteDecision(
        enabled=True,
        engine=config.engine,
        used_jev=used_jev,
        latency_ms=_elapsed_ms(t0),
        detail="no_match",
    )
