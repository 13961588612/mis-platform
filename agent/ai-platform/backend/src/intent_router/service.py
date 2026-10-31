"""意图预路由服务：加载 Agent 配置并解析 router_skill / worker。"""

from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import Any

import yaml

from src.config import get_settings
from src.intent_router.jev_client import classify_intent_label
from src.intent_router.models import IntentRouteDecision, IntentRouterConfig, IntentThen
from src.intent_router.rules_engine import evaluate_rules
from src.utils.logging import get_logger

logger = get_logger("intent_router.service")

_CONFIG_CACHE: dict[str, tuple[float, IntentRouterConfig | None]] = {}
_CACHE_TTL_S = 5.0


def _elapsed_ms(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def intent_router_path(agent_id: str) -> Path:
    """``configs/agents/{id}/intent-router.yaml``。"""
    base = Path(get_settings().CONFIG_BASE_PATH)
    return base / "agents" / agent_id / "intent-router.yaml"


def load_intent_router_config(agent_id: str, *, use_cache: bool = True) -> IntentRouterConfig | None:
    """读取 Agent 的意图路由配置；文件不存在返回 None。"""
    path = intent_router_path(agent_id)
    now = perf_counter()
    if use_cache and agent_id in _CONFIG_CACHE:
        cached_at, cached = _CONFIG_CACHE[agent_id]
        if now - cached_at < _CACHE_TTL_S:
            return cached

    if not path.is_file():
        _CONFIG_CACHE[agent_id] = (now, None)
        return None
    try:
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        logger.warning(
            "Failed to load intent-router.yaml",
            agent_id=agent_id,
            error=str(exc),
        )
        _CONFIG_CACHE[agent_id] = (now, None)
        return None

    section = raw.get("intent_router", raw)
    try:
        cfg = IntentRouterConfig.model_validate(section or {})
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Invalid intent-router.yaml",
            agent_id=agent_id,
            error=str(exc),
        )
        _CONFIG_CACHE[agent_id] = (now, None)
        return None
    _CONFIG_CACHE[agent_id] = (now, cfg)
    return cfg


def clear_intent_router_cache(agent_id: str | None = None) -> None:
    """测试或热更新时清缓存。"""
    if agent_id is None:
        _CONFIG_CACHE.clear()
    else:
        _CONFIG_CACHE.pop(agent_id, None)


def format_router_skill_hint(router_skill: str) -> str:
    """注入 turn_reminder 的强制加载提示（Worker）。"""
    sid = (router_skill or "").strip()
    if not sid:
        return ""
    return (
        f"【意图预路由】本轮必须先 skill 加载 `{sid}`（router skill），"
        f"再按其正文编排下游；禁止跳过该 Skill 直接调 MCP。"
    )


def format_coordinator_route_hint(
    *,
    worker_id: str | None = None,
    intent: str | None = None,
    router_skill: str | None = None,
) -> str:
    """Coordinator：预选 Worker / intent 的提示（A2UI 主路径）。"""
    parts: list[str] = []
    wid = (worker_id or "").strip()
    intent_s = (intent or "").strip()
    skill = (router_skill or "").strip()
    if wid:
        parts.append(f"优先 agent__invoke worker=`{wid}`")
        if intent_s:
            parts.append(f"intent=`{intent_s}`")
    elif intent_s:
        parts.append(f"本轮 intent=`{intent_s}`")
    if skill:
        parts.append(f"若需 Skill 先加载 `{skill}`")
    if not parts:
        return ""
    return "【意图预路由】" + "；".join(parts) + "。未匹配到时再自行判断。"


def _clip_text(text: str, max_chars: int) -> str:
    raw = (text or "").strip()
    if max_chars <= 0 or len(raw) <= max_chars:
        return raw
    return raw[: max_chars - 1] + "…"


def format_conversation_context_for_jev(
    user_text: str,
    history_messages: list[dict[str, Any]] | None = None,
    *,
    max_prior_messages: int = 6,
    max_msg_chars: int = 240,
) -> str:
    """拼 JEV 用 user content：若干轮上文 + 本轮（短跟问依赖上文）。

    Args:
        user_text: 本轮用户原文。
        history_messages: ``{role, content}`` 列表（可含本轮）；role 为 user/assistant。
        max_prior_messages: 本轮之前最多保留的消息条数。
        max_msg_chars: 单条截断长度（助手长文不灌满 JEV）。
    """
    current = (user_text or "").strip()
    prior: list[dict[str, str]] = []
    for item in history_messages or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = _clip_text(str(item.get("content") or ""), max_msg_chars)
        if not content:
            continue
        prior.append({"role": role, "content": content})

    # 去掉末尾与本轮相同的 user，避免重复
    if prior and prior[-1]["role"] == "user" and prior[-1]["content"] == _clip_text(
        current, max_msg_chars
    ):
        prior = prior[:-1]
    if max_prior_messages > 0 and len(prior) > max_prior_messages:
        prior = prior[-max_prior_messages:]

    if not prior:
        return current

    lines: list[str] = ["【对话上文】"]
    for msg in prior:
        prefix = "用户" if msg["role"] == "user" else "助手"
        lines.append(f"{prefix}: {msg['content']}")
    lines.append("【本轮用户】")
    lines.append(current or "（空）")
    return "\n".join(lines)


def _label_description(key: str, then: IntentThen) -> str:
    """JEV 标签文案：优先 description，再拼 intent/worker/router。"""
    desc = (then.description or "").strip()
    if desc:
        return desc
    parts: list[str] = []
    if then.intent:
        parts.append(then.intent)
    if then.worker_id:
        parts.append(f"worker={then.worker_id}")
    if then.router_skill:
        parts.append(f"router={then.router_skill}")
    return " / ".join(parts) if parts else key


async def _resolve_model_engine(
    user_text: str,
    config: IntentRouterConfig,
    *,
    conversation_context: str | None = None,
) -> IntentRouteDecision:
    """Coordinator：整表标签一次 JEV，映射到 worker/intent。"""
    t0 = perf_counter()
    label_desc: dict[str, str] = {
        key: _label_description(key, then) for key, then in config.labels.items()
    }

    if not label_desc:
        return IntentRouteDecision(
            enabled=True,
            engine="model",
            latency_ms=_elapsed_ms(t0),
            detail="empty_labels",
        )

    tag, jev_ms, detail = await classify_intent_label(
        user_text=user_text,
        labels=label_desc,
        model_name=config.model.name or None,
        endpoint=config.model.endpoint or None,
        timeout_ms=config.model.timeout_ms,
        conversation_context=conversation_context,
    )
    if tag and tag in config.labels:
        then = config.labels[tag]
        return IntentRouteDecision(
            enabled=True,
            engine="model",
            matched_rule_id=tag,
            router_skill=then.router_skill or None,
            worker_id=then.worker_id or None,
            intent=then.intent or tag,
            used_jev=True,
            latency_ms=_elapsed_ms(t0),
            detail=detail,
            raw={"jev_ms": jev_ms, "tag": tag},
        )

    if config.on_fail == "fallback_router_skill" and config.fallback_router_skill:
        return IntentRouteDecision(
            enabled=True,
            engine="model",
            router_skill=config.fallback_router_skill,
            used_jev=True,
            latency_ms=_elapsed_ms(t0),
            detail=f"fallback:{detail}",
        )
    return IntentRouteDecision(
        enabled=True,
        engine="model",
        used_jev=True,
        latency_ms=_elapsed_ms(t0),
        detail=detail or "no_match",
    )


async def resolve_intent_route(
    agent_id: str,
    user_text: str,
    *,
    config: IntentRouterConfig | None = None,
    history_messages: list[dict[str, Any]] | None = None,
    conversation_context: str | None = None,
    session_id: str = "",
) -> IntentRouteDecision | None:
    """解析本轮意图路由；未启用或无配置返回 None。

    Args:
        history_messages: 会话上文（含或不含本轮）；``engine=model`` 时拼进 JEV。
        conversation_context: 若已拼好则优先使用，不再从 history 生成。
        session_id: 会话号（中文步骤日志用）。
    """
    cfg = config if config is not None else load_intent_router_config(agent_id)
    if cfg is None or not cfg.enabled or cfg.engine == "off":
        return None

    if cfg.engine == "rules":
        decision = await evaluate_rules(user_text, cfg)
    elif cfg.engine == "model":
        ctx = (conversation_context or "").strip() or format_conversation_context_for_jev(
            user_text, history_messages
        )
        decision = await _resolve_model_engine(
            user_text, cfg, conversation_context=ctx or None
        )
    else:
        return None

    has_context = bool(
        (conversation_context or "").strip()
        or (history_messages and len(history_messages) > 0)
    )
    engine_zh = {
        "rules": "规则引擎",
        "model": "JEV意图识别",
    }.get(decision.engine, decision.engine)
    detail_parts = [engine_zh, f"detail={decision.detail or '-'}"]
    if decision.matched_rule_id:
        detail_parts.append(f"命中={decision.matched_rule_id}")
    if decision.worker_id:
        detail_parts.append(f"Worker={decision.worker_id}")
    if decision.router_skill:
        detail_parts.append(f"router={decision.router_skill}")
    if decision.intent:
        detail_parts.append(f"intent={decision.intent}")
    if has_context:
        detail_parts.append("含上文")
    try:
        from src.runtime.step_timing import log_turn_step

        log_turn_step(
            session_id=session_id or "-",
            step_name=f"意图预路由·{engine_zh}",
            duration_ms=decision.latency_ms,
            agent_id=agent_id,
            detail="；".join(detail_parts),
        )
    except Exception:  # noqa: BLE001
        pass
    logger.info(
        "intent_route_decision",
        agent_id=agent_id,
        session_id=session_id or None,
        engine=decision.engine,
        matched_rule_id=decision.matched_rule_id,
        router_skill=decision.router_skill,
        worker_id=decision.worker_id,
        intent=decision.intent,
        used_jev=decision.used_jev,
        latency_ms=decision.latency_ms,
        detail=decision.detail,
        has_context=has_context,
    )
    return decision
