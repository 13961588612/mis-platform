"""模板报告 Worker 管线：开卡标记、抽槽、miss。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agent.template_report.pipeline import (
    format_open_card_body,
    parse_open_card_marker,
    run_template_report_turn,
)
from src.agent.template_report.slot_extract import extract_slot_params
from src.coordinator.notification import TaskNotification, TaskStatus
from src.coordinator.passthrough import is_skipped_invoke_output
from src.intent_router.models import TemplateReportRouterConfig


def test_open_card_marker_roundtrip() -> None:
    body = format_open_card_body(report_code="RPT_DAILY", title="门店经营日报")
    parsed = parse_open_card_marker(body)
    assert parsed == ("RPT_DAILY", "门店经营日报")


def test_slot_extract_by_label() -> None:
    slots = [
        {
            "wire_key": "spmStoreId",
            "required": True,
            "options": [
                {"value": "101", "label": "溧阳店"},
                {"value": "102", "label": "金坛店"},
            ],
        },
        {
            "wire_key": "spmBizDate",
            "required": True,
            "value_type": "date",
            "options": [],
        },
    ]
    params, missing = extract_slot_params("帮我出溧阳店 2026-03-01 的日报", slots)
    assert params["spmStoreId"] == "101"
    assert params["spmBizDate"] == "2026-03-01"
    assert missing == []


def test_slot_extract_missing_required() -> None:
    slots = [
        {
            "wire_key": "spmStoreId",
            "required": True,
            "options": [{"value": "101", "label": "溧阳店"}],
        }
    ]
    params, missing = extract_slot_params("打开经营日报", slots)
    assert params == {}
    assert missing == ["spmStoreId"]


def test_skipped_notification_has_header() -> None:
    note = TaskNotification.from_worker_result(
        task_id="abc123def456",
        worker_id="template-report",
        result="",
        status=TaskStatus.SKIPPED,
        latency_ms=10,
    )
    out = note.to_tool_output()
    assert out.startswith("[task:abc123def456]")
    assert "status=skipped" in out.split("\n", 1)[0]
    assert is_skipped_invoke_output(out)


@pytest.mark.asyncio
async def test_pipeline_miss_when_decision_none() -> None:
    cfg = TemplateReportRouterConfig(enabled=True, min_confidence=0.75)
    catalog = [
        {
            "group_id": 1,
            "reports": [
                {
                    "report_code": "RPT_DAILY",
                    "title": "门店经营日报",
                    "description": "日报",
                }
            ],
        }
    ]
    client = MagicMock()
    client.catalog = AsyncMock(return_value=catalog)
    client.prepare_card = AsyncMock()
    client.execute = AsyncMock()

    with (
        patch(
            "src.agent.template_report.pipeline.load_template_report_router_config",
            return_value=cfg,
        ),
        patch(
            "src.agent.template_report.pipeline.AiReportClient",
            return_value=client,
        ),
        patch(
            "src.agent.template_report.pipeline.resolve_template_report_route",
            new_callable=AsyncMock,
            return_value=MagicMock(report_code=None, detail="none:ok", raw={}),
        ),
    ):
        outcome = await run_template_report_turn(user_text="溧阳有哪些门店")
    assert outcome.kind == "miss"
    client.prepare_card.assert_not_awaited()
