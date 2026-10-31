"""意图预路由：规则引擎 → router_skill；步骤可 JEV。"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.intent_router.models import (
    IntentRouterConfig,
    IntentRule,
    IntentThen,
    IntentWhen,
)
from src.intent_router.rules_engine import evaluate_rules
from src.intent_router.service import (
    format_conversation_context_for_jev,
    format_coordinator_route_hint,
    format_router_skill_hint,
    resolve_intent_route,
)


@pytest.mark.asyncio
async def test_keyword_rule_returns_router_skill() -> None:
    cfg = IntentRouterConfig(
        enabled=True,
        engine="rules",
        on_fail="none",
        rules=[
            IntentRule(
                id="kw",
                when=IntentWhen(type="keyword", any=["门店", "宜兴"]),
                then=IntentThen(router_skill="sm-report-router", intent="spm_report"),
            )
        ],
    )
    decision = await evaluate_rules("宜兴地区有哪些门店", cfg)
    assert decision.matched_rule_id == "kw"
    assert decision.router_skill == "sm-report-router"
    assert decision.intent == "spm_report"
    assert decision.used_jev is False


@pytest.mark.asyncio
async def test_rules_fallback_router_skill() -> None:
    cfg = IntentRouterConfig(
        enabled=True,
        engine="rules",
        on_fail="fallback_router_skill",
        fallback_router_skill="sm-report-router",
        rules=[
            IntentRule(
                id="kw",
                when=IntentWhen(type="keyword", any=["不会命中"]),
                then=IntentThen(router_skill="other"),
            )
        ],
    )
    decision = await evaluate_rules("随便问一句", cfg)
    assert decision.router_skill == "sm-report-router"
    assert decision.detail == "fallback_router_skill"


@pytest.mark.asyncio
async def test_jev_step_uses_intent_detect() -> None:
    cfg = IntentRouterConfig(
        enabled=True,
        engine="rules",
        on_fail="none",
        rules=[
            IntentRule(
                id="jev1",
                when=IntentWhen(
                    type="jev",
                    labels={"report": "报表", "other": "其他"},
                    match_label="report",
                ),
                then=IntentThen(router_skill="sm-report-router"),
            )
        ],
    )
    with patch(
        "src.intent_router.rules_engine.classify_intent_label",
        new=AsyncMock(return_value=("report", 12, "ok")),
    ) as mocked:
        decision = await evaluate_rules("本周毛利", cfg)
    mocked.assert_awaited_once()
    assert decision.matched_rule_id == "jev1"
    assert decision.router_skill == "sm-report-router"
    assert decision.used_jev is True


@pytest.mark.asyncio
async def test_resolve_disabled_returns_none() -> None:
    cfg = IntentRouterConfig(enabled=False, engine="rules")
    assert await resolve_intent_route("spm-report", "门店", config=cfg) is None


def test_format_hints() -> None:
    assert "sm-report-router" in format_router_skill_hint("sm-report-router")
    assert format_router_skill_hint("") == ""
    hint = format_coordinator_route_hint(worker_id="spm-report", intent="spm_report")
    assert "spm-report" in hint
    assert "spm_report" in hint


def test_format_conversation_context_for_jev_includes_prior_user() -> None:
    ctx = format_conversation_context_for_jev(
        "溧阳地区呢",
        [
            {"role": "user", "content": "超市 宜兴地区有那些店"},
            {"role": "assistant", "content": "宜兴区共 8 家门店……"},
            {"role": "user", "content": "溧阳地区呢"},
        ],
    )
    assert "【对话上文】" in ctx
    assert "宜兴" in ctx
    assert "【本轮用户】" in ctx
    assert ctx.strip().endswith("溧阳地区呢")


@pytest.mark.asyncio
async def test_model_engine_passes_context_and_description() -> None:
    cfg = IntentRouterConfig(
        enabled=True,
        engine="model",
        on_fail="none",
        labels={
            "spm_report": IntentThen(
                worker_id="spm-report",
                intent="spm_report",
                description="超市区域门店列表",
            ),
            "rag": IntentThen(
                worker_id="mis-rag",
                intent="rag",
                description="知识库制度问答",
            ),
        },
    )
    with patch(
        "src.intent_router.service.classify_intent_label",
        new=AsyncMock(return_value=("spm_report", 20, "ok")),
    ) as mocked:
        decision = await resolve_intent_route(
            "mis-copilot",
            "溧阳地区呢",
            config=cfg,
            history_messages=[
                {"role": "user", "content": "超市 宜兴有哪些店"},
                {"role": "assistant", "content": "宜兴区……"},
                {"role": "user", "content": "溧阳地区呢"},
            ],
        )
    assert decision is not None
    assert decision.worker_id == "spm-report"
    kwargs = mocked.await_args.kwargs
    assert "超市门店" in kwargs["labels"]["spm_report"] or "区域门店" in kwargs["labels"][
        "spm_report"
    ]
    assert "【对话上文】" in (kwargs.get("conversation_context") or "")
    assert "溧阳地区呢" in (kwargs.get("conversation_context") or "")
