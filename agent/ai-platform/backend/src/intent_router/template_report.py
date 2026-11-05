"""模板报告决策预路由：选人前用决策模型判定是否打开参数卡。"""

from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import Any

import yaml

from src.config import get_settings
from src.intent_router.jev_client import classify_intent_label
from src.intent_router.models import (
    TemplateReportDecision,
    TemplateReportRouterConfig,
)
from src.intent_router.service import (
    format_conversation_context_for_jev,
    parse_confidence_from_detail,
)
from src.utils.logging import get_logger

logger = get_logger("intent_router.template_report")

_CONFIG_CACHE: dict[str, tuple[float, TemplateReportRouterConfig | None]] = {}
_CACHE_TTL_S = 5.0

NONE_LABEL = "not_template_report"
NONE_DESCRIPTION = (
    "不是要打开或生成某份固定模板报告参数卡。"
    "包括：自然语言问销售/毛利数字、门店列表、制度知识库、会员 CRM、闲聊、"
    "跟问上一轮非模板报告话题。"
)

_TEMPLATE_REPORT_INSTRUCTIONS = (
    "判断用户本轮是否要打开某份「固定模板报告」的参数卡。"
    "只选一个标签：参与报告的 code，或 not_template_report。"
    "仅当用户明确点名某类模板报告（日报/周报等固定报表）时才选对应 code；"
    "模糊问数、跟问、闲聊选 not_template_report。"
)


def _elapsed_ms(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def template_report_router_path(agent_id: str) -> Path:
    """``configs/agents/{id}/template-report-router.yaml``。"""
    base = Path(get_settings().CONFIG_BASE_PATH)
    return base / "agents" / agent_id / "template-report-router.yaml"


def load_template_report_router_config(
    agent_id: str, *, use_cache: bool = True
) -> TemplateReportRouterConfig | None:
    """读取 Agent 的模板报告预路由配置；文件不存在返回 None。"""
    path = template_report_router_path(agent_id)
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
            "Failed to load template-report-router.yaml",
            agent_id=agent_id,
            error=str(exc),
        )
        _CONFIG_CACHE[agent_id] = (now, None)
        return None

    section = raw.get("template_report_router", raw)
    try:
        cfg = TemplateReportRouterConfig.model_validate(section or {})
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Invalid template-report-router.yaml",
            agent_id=agent_id,
            error=str(exc),
        )
        _CONFIG_CACHE[agent_id] = (now, None)
        return None
    _CONFIG_CACHE[agent_id] = (now, cfg)
    return cfg


def clear_template_report_router_cache(agent_id: str | None = None) -> None:
    """测试或热更新时清缓存。"""
    if agent_id is None:
        _CONFIG_CACHE.clear()
    else:
        _CONFIG_CACHE.pop(agent_id, None)


async def resolve_template_report_route(
    agent_id: str,
    user_text: str,
    *,
    config: TemplateReportRouterConfig | None = None,
    history_messages: list[dict[str, Any]] | None = None,
    conversation_context: str | None = None,
    session_id: str = "",
    label_overrides: dict[str, str] | None = None,
) -> TemplateReportDecision | None:
    """解析模板报告预路由；未启用返回 None（调用方继续选人）。

    命中时 ``report_code`` 非空；未命中返回 ``report_code=None`` 的 Decision，
    或 ``None``（配置缺失/关闭）。

    Args:
        label_overrides: 外部注入的 ``{report_code: description}``（通常来自
            catalog）；优先于配置内 ``reports``。
    """
    cfg = (
        config
        if config is not None
        else load_template_report_router_config(agent_id)
    )
    if cfg is None or not cfg.enabled:
        return None

    t0 = perf_counter()
    code_to_title: dict[str, str] = {}
    labels: dict[str, str] = {}

    if label_overrides:
        for code, desc in label_overrides.items():
            key = (code or "").strip()
            if not key or key == NONE_LABEL:
                continue
            labels[key] = str(desc or key).strip() or key
            # title 取描述首句或 code
            code_to_title[key] = key
            for item in cfg.reports:
                if (item.code or "").strip() == key and (item.title or "").strip():
                    code_to_title[key] = item.title.strip()
                    break
            # catalog 描述常以「标题。」开头
            head = labels[key].split("。", 1)[0].strip()
            if head and head != key and code_to_title[key] == key:
                code_to_title[key] = head
    else:
        if not cfg.reports:
            return TemplateReportDecision(
                enabled=True,
                detail="empty_reports",
            )
        allow = {
            c.strip() for c in (cfg.participate_codes or []) if c and str(c).strip()
        }
        for item in cfg.reports:
            code = (item.code or "").strip()
            if not code or code == NONE_LABEL:
                continue
            if allow and code not in allow:
                continue
            code_to_title[code] = (item.title or "").strip() or code
            override = (cfg.description_overrides or {}).get(code, "")
            desc = (override or item.description or "").strip() or code_to_title[code]
            labels[code] = desc

    if not labels:
        return TemplateReportDecision(
            enabled=True,
            latency_ms=_elapsed_ms(t0),
            detail="empty_labels",
        )
    labels[NONE_LABEL] = NONE_DESCRIPTION

    ctx = (conversation_context or "").strip() or format_conversation_context_for_jev(
        user_text,
        history_messages,
        max_context_turns=cfg.max_context_turns,
        max_msg_chars=cfg.max_context_msg_chars,
    )

    tag, jev_ms, detail = await classify_intent_label(
        user_text=user_text,
        labels=labels,
        model_name=cfg.model.name or None,
        endpoint=cfg.model.endpoint or None,
        timeout_ms=cfg.model.timeout_ms,
        conversation_context=ctx or None,
        instructions=_TEMPLATE_REPORT_INSTRUCTIONS,
    )
    confidence = parse_confidence_from_detail(detail)
    min_conf = float(cfg.min_confidence or 0.0)

    if tag == NONE_LABEL:
        logger.info(
            "template report route none",
            agent_id=agent_id,
            session_id=session_id or None,
            confidence=confidence,
            latency_ms=jev_ms,
        )
        return TemplateReportDecision(
            enabled=True,
            used_model=True,
            confidence=confidence,
            latency_ms=_elapsed_ms(t0),
            detail=f"none:{detail}",
            raw={"jev_ms": jev_ms, "tag": tag, "confidence": confidence},
        )

    if (
        tag
        and tag in code_to_title
        and min_conf > 0
        and confidence is not None
        and confidence < min_conf
    ):
        logger.info(
            "template report below min_confidence",
            agent_id=agent_id,
            session_id=session_id or None,
            tag=tag,
            confidence=confidence,
            min_confidence=min_conf,
        )
        return TemplateReportDecision(
            enabled=True,
            used_model=True,
            confidence=confidence,
            latency_ms=_elapsed_ms(t0),
            detail=f"low_confidence:{confidence:.3f}<{min_conf:.3f};was={tag};{detail}",
            raw={
                "jev_ms": jev_ms,
                "tag": tag,
                "confidence": confidence,
                "min_confidence": min_conf,
            },
        )

    if tag and tag in code_to_title:
        title = code_to_title[tag]
        logger.info(
            "template report route hit",
            agent_id=agent_id,
            session_id=session_id or None,
            report_code=tag,
            confidence=confidence,
            latency_ms=jev_ms,
        )
        return TemplateReportDecision(
            enabled=True,
            report_code=tag,
            title=title,
            used_model=True,
            confidence=confidence,
            latency_ms=_elapsed_ms(t0),
            detail=detail,
            raw={
                "jev_ms": jev_ms,
                "tag": tag,
                "confidence": confidence,
                "min_confidence": min_conf or None,
            },
        )

    return TemplateReportDecision(
        enabled=True,
        used_model=True,
        confidence=confidence,
        latency_ms=_elapsed_ms(t0),
        detail=detail or "no_match",
        raw={"jev_ms": jev_ms, "tag": tag, "confidence": confidence},
    )
