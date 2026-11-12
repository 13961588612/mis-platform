"""模板报告决策预路由：置信度门槛与负例。"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.intent_router.models import (
    TemplateReportItem,
    TemplateReportRouterConfig,
)
from src.intent_router.template_report import resolve_template_report_route


def _cfg(**over: object) -> TemplateReportRouterConfig:
    base = TemplateReportRouterConfig(
        enabled=True,
        min_confidence=0.75,
        reports=[
            TemplateReportItem(
                code="RPT_DAILY",
                title="门店经营日报",
                description="日报",
            ),
            TemplateReportItem(
                code="RPT_WEEKLY",
                title="门店经营周报",
                description="周报",
            ),
        ],
    )
    return base.model_copy(update=over)


@pytest.mark.asyncio
async def test_disabled_returns_none() -> None:
    decision = await resolve_template_report_route(
        "mis-copilot",
        "打开经营日报",
        config=_cfg(enabled=False),
    )
    assert decision is None


@pytest.mark.asyncio
async def test_hit_above_min_confidence() -> None:
    with patch(
        "src.intent_router.template_report.classify_intent_label",
        new_callable=AsyncMock,
        return_value=("RPT_DAILY", 12, "ok;confidence=0.910"),
    ):
        decision = await resolve_template_report_route(
            "mis-copilot",
            "打开门店经营日报",
            config=_cfg(),
        )
    assert decision is not None
    assert decision.report_code == "RPT_DAILY"
    assert decision.title == "门店经营日报"
    assert decision.confidence == pytest.approx(0.91)


@pytest.mark.asyncio
async def test_low_confidence_not_hit() -> None:
    with patch(
        "src.intent_router.template_report.classify_intent_label",
        new_callable=AsyncMock,
        return_value=("RPT_WEEKLY", 8, "ok;confidence=0.400"),
    ):
        decision = await resolve_template_report_route(
            "mis-copilot",
            "好像要周报？",
            config=_cfg(),
        )
    assert decision is not None
    assert decision.report_code is None
    assert "low_confidence" in decision.detail


@pytest.mark.asyncio
async def test_none_label_not_hit() -> None:
    with patch(
        "src.intent_router.template_report.classify_intent_label",
        new_callable=AsyncMock,
        return_value=("not_template_report", 5, "ok;confidence=0.950"),
    ):
        decision = await resolve_template_report_route(
            "mis-copilot",
            "溧阳有哪些门店",
            config=_cfg(),
        )
    assert decision is not None
    assert decision.report_code is None
    assert decision.detail.startswith("none:")


@pytest.mark.asyncio
async def test_empty_reports_not_hit() -> None:
    decision = await resolve_template_report_route(
        "mis-copilot",
        "打开日报",
        config=_cfg(reports=[]),
    )
    assert decision is not None
    assert decision.report_code is None
    assert decision.detail == "empty_reports"
