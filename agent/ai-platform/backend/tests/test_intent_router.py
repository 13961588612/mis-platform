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
    router_hint = format_router_skill_hint("sm-report-router")
    assert "sm-report-router" in router_hint
    assert "router skill" not in router_hint
    assert format_router_skill_hint("") == ""
    diary_hint = format_router_skill_hint("sm-shop-ops-diary-report")
    assert "sm-shop-ops-diary-report" in diary_hint
    assert "其它" in diary_hint
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


def test_format_conversation_context_keeps_only_recent_turns() -> None:
    history = [
        {"role": "user", "content": "旧问1"},
        {"role": "assistant", "content": "旧答1"},
        {"role": "user", "content": "旧问2"},
        {"role": "assistant", "content": "旧答2"},
        {"role": "user", "content": "宜兴有哪些店"},
        {"role": "assistant", "content": "宜兴区共 8 家"},
        {"role": "user", "content": "各柜组销售情况"},
    ]
    ctx = format_conversation_context_for_jev(
        "各柜组销售情况",
        history,
        max_context_turns=1,
    )
    assert "宜兴有哪些店" in ctx
    assert "宜兴区共 8 家" in ctx
    assert "旧问1" not in ctx
    assert "旧问2" not in ctx
    assert ctx.strip().endswith("各柜组销售情况")


def test_intent_router_config_accepts_context_turns() -> None:
    cfg = IntentRouterConfig(enabled=True, engine="model", max_context_turns=2)
    assert cfg.max_context_turns == 2
    assert cfg.max_context_msg_chars == 240


@pytest.mark.asyncio
async def test_rules_then_model_keyword_skips_jev() -> None:
    cfg = IntentRouterConfig(
        enabled=True,
        engine="rules_then_model",
        on_fail="fallback_primary",
        rules=[
            IntentRule(
                id="store_list_phrases",
                when=IntentWhen(type="keyword", any=["有哪些门店", "有哪些店"]),
                then=IntentThen(worker_id="spm-report", intent="spm_report"),
            )
        ],
        labels={
            "spm_report": IntentThen(worker_id="spm-report", intent="spm_report"),
            "rag": IntentThen(worker_id="mis-rag", intent="rag"),
        },
    )
    with patch(
        "src.intent_router.service.classify_intent_label",
        new=AsyncMock(return_value=("rag", 20, "ok;confidence=0.900")),
    ) as mocked:
        decision = await resolve_intent_route(
            "mis-copilot",
            "宜兴地区有哪些门店",
            config=cfg,
        )
    mocked.assert_not_awaited()
    assert decision is not None
    assert decision.worker_id == "spm-report"
    assert decision.intent == "spm_report"
    assert decision.matched_rule_id == "store_list_phrases"
    assert decision.used_jev is False
    assert decision.detail.startswith("rules:")


@pytest.mark.asyncio
async def test_rules_then_model_falls_back_to_jev() -> None:
    cfg = IntentRouterConfig(
        enabled=True,
        engine="rules_then_model",
        on_fail="none",
        min_confidence=0.6,
        rules=[
            IntentRule(
                id="store_list_phrases",
                when=IntentWhen(type="keyword", any=["有哪些门店"]),
                then=IntentThen(worker_id="spm-report", intent="spm_report"),
            )
        ],
        labels={
            "rag": IntentThen(
                worker_id="mis-rag",
                intent="rag",
                description="制度规章",
            ),
        },
    )
    with patch(
        "src.intent_router.service.classify_intent_label",
        new=AsyncMock(return_value=("rag", 18, "ok;confidence=0.820")),
    ) as mocked:
        decision = await resolve_intent_route(
            "mis-copilot",
            "请假制度怎么规定",
            config=cfg,
        )
    mocked.assert_awaited_once()
    assert decision is not None
    assert decision.worker_id == "mis-rag"
    assert decision.used_jev is True
    assert "rules_miss:" in (decision.detail or "")


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
