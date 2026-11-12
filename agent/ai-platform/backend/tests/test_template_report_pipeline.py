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


@pytest.mark.asyncio
async def test_confirmed_task_does_not_open_card() -> None:
    outcome = await run_template_report_turn(
        user_text="【已确认模板报告任务】参数已齐，禁止再打开参数卡或走 template-report；请按「日报」直接成文。",
    )
    assert outcome.kind == "miss"
    assert outcome.detail == "skip_open_card_confirmed"


def test_open_card_marker_roundtrip() -> None:
    body = format_open_card_body(report_code="RPT_DAILY", title="门店经营日报")
    parsed = parse_open_card_marker(body)
    assert parsed == ("RPT_DAILY", "门店经营日报", {})


def test_open_card_marker_with_prefill_values() -> None:
    body = format_open_card_body(
        report_code="SPM-STORE-DAY-REPORT",
        title="日报",
        prefill={"spmStoreId": "0021", "spmBizDate": "2026-11-04"},
    )
    parsed = parse_open_card_marker(body)
    assert parsed is not None
    code, title, values = parsed
    assert code == "SPM-STORE-DAY-REPORT"
    assert title == "日报"
    assert values == {"spmStoreId": "0021", "spmBizDate": "2026-11-04"}
    assert "[[ai.report.prefill" in body


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


def test_slot_extract_defaults_ignored_when_disabled() -> None:
    """有 default 但不算用户显式给出 → 开卡判定应 missing。"""
    slots = [
        {
            "wire_key": "spmStoreId",
            "required": True,
            "default_value": "101",
            "options": [{"value": "101", "label": "溧阳店"}],
        },
        {
            "wire_key": "spmBizDate",
            "required": True,
            "default_value": "2026-03-01",
            "value_type": "date",
            "options": [],
        },
    ]
    with_def, miss_def = extract_slot_params("打开门店经营日报", slots)
    assert with_def == {"spmStoreId": "101", "spmBizDate": "2026-03-01"}
    assert miss_def == []

    no_def, miss_no = extract_slot_params(
        "打开门店经营日报", slots, apply_defaults=False
    )
    assert no_def == {}
    assert miss_no == ["spmStoreId", "spmBizDate"]


def test_resolve_relative_date_and_store() -> None:
    from datetime import date

    from src.agent.template_report.slot_resolve import resolve_slots_deterministic

    slots = [
        {
            "wire_key": "spmStoreId",
            "required": True,
            "options": [
                {"value": "0001", "label": "宜兴城中店"},
                {"value": "0021", "label": "宜兴城北店"},
            ],
        },
        {
            "wire_key": "spmBizDate",
            "required": True,
            "value_type": "date",
            "options": [],
        },
    ]
    today = date(2026, 11, 5)
    hit = resolve_slots_deterministic(
        "打开宜兴城北店昨天日报",
        slots,
        today=today,
    )
    assert hit["spmStoreId"] == "0021"
    assert hit["spmBizDate"] == "2026-11-04"

    follow = resolve_slots_deterministic(
        "前天的",
        slots,
        conversation_context="用户: 打开宜兴城北店昨天日报",
        today=today,
    )
    assert follow["spmStoreId"] == "0021"
    assert follow["spmBizDate"] == "2026-11-03"

    # 本轮点名不在 options 的店：不得用上文门店兜底（否则会误 execute、不开卡）
    unmatched = resolve_slots_deterministic(
        "金坛西门店经营日报",
        slots,
        conversation_context="用户: 宜兴城北店经营前天日报\n助手: 已出报告",
        today=today,
    )
    assert "spmStoreId" not in unmatched
    assert unmatched.get("spmBizDate") == "2026-11-03"

    # 本轮有日期表述但未落入 options：不得用上文日期兜底
    rejected_today = resolve_slots_deterministic(
        "宜兴城北店经营今天日报",
        [
            slots[0],
            {
                "wire_key": "spmBizDate",
                "required": True,
                "value_type": "date",
                "options": [
                    {"value": "2026-11-03", "label": "2026-11-03"},
                    {"value": "2026-11-04", "label": "2026-11-04"},
                ],
            },
        ],
        conversation_context="用户: 打开宜兴城中店前天日报",
        today=today,
    )
    assert rejected_today.get("spmStoreId") == "0021"
    assert "spmBizDate" not in rejected_today


def test_resolve_week_and_month_from_options() -> None:
    from datetime import date

    from src.agent.template_report.slot_resolve import resolve_slots_deterministic

    today = date(2026, 11, 5)  # 周四，落在 11-03~11-09
    slots = [
        {
            "wire_key": "spmOrdWeek",
            "required": True,
            "value_type": "ord_week",
            "options": [
                {
                    "value": "202645",
                    "label": "202645（2026-11-03~2026-11-09）",
                    "extra": {
                        "grain": "week",
                        "startDate": "2026-11-03",
                        "endDate": "2026-11-09",
                    },
                },
                {
                    "value": "202644",
                    "label": "202644（2026-10-27~2026-11-02）",
                    "extra": {
                        "grain": "week",
                        "startDate": "2026-10-27",
                        "endDate": "2026-11-02",
                    },
                },
            ],
        },
        {
            "wire_key": "spmOrdMonth",
            "required": True,
            "value_type": "ord_month",
            "options": [
                {"value": "2026-11", "label": "2026-11"},
                {"value": "2026-10", "label": "2026-10"},
            ],
        },
    ]
    week_hit = resolve_slots_deterministic("打开上周经营周报", slots, today=today)
    assert week_hit["spmOrdWeek"] == "202644"

    month_hit = resolve_slots_deterministic("出上月月报", slots, today=today)
    assert month_hit["spmOrdMonth"] == "2026-10"

    # 本轮「上上周」无法落到 options：不得用上文周次兜底
    week_block = resolve_slots_deterministic(
        "打开上上周经营周报",
        [slots[0]],
        conversation_context="用户: 打开上周经营周报",
        today=today,
    )
    assert "spmOrdWeek" not in week_block

    # 本轮无周表述：允许上文周次
    week_ctx = resolve_slots_deterministic(
        "再出一份",
        [slots[0]],
        conversation_context="用户: 打开上周经营周报",
        today=today,
    )
    assert week_ctx.get("spmOrdWeek") == "202644"


def test_open_card_body_includes_prefill() -> None:
    body = format_open_card_body(
        report_code="SPM-STORE-DAY-REPORT",
        title="日报",
        prefill={"spmStoreId": "0021", "spmBizDate": "2026-11-04"},
    )
    assert "已识别：spmStoreId=0021" in body
    parsed = parse_open_card_marker(body)
    assert parsed == (
        "SPM-STORE-DAY-REPORT",
        "日报",
        {"spmStoreId": "0021", "spmBizDate": "2026-11-04"},
    )


def test_coerce_slot_value_rejects_outside_options() -> None:
    from src.agent.template_report.slot_intent import coerce_slot_value

    slot = {
        "wire_key": "spmStoreId",
        "required": True,
        "default_value": "101",
        "options": [
            {"value": "101", "label": "溧阳店"},
            {"value": "102", "label": "金坛店"},
        ],
    }
    assert coerce_slot_value(slot, "102") == "102"
    assert coerce_slot_value(slot, "金坛店") == "102"
    assert coerce_slot_value(slot, "9999") is None
    assert coerce_slot_value(slot, None) is None


@pytest.mark.asyncio
async def test_slot_intent_uses_default_when_model_out_of_options() -> None:
    from src.agent.template_report.slot_intent import extract_slots_with_intent_model

    slots = [
        {
            "wire_key": "spmStoreId",
            "required": True,
            "default_value": "101",
            "options": [
                {"value": "101", "label": "溧阳店"},
                {"value": "102", "label": "金坛店"},
            ],
        }
    ]
    fake_resp = MagicMock()
    fake_resp.raise_for_status = MagicMock()
    fake_resp.json.return_value = {
        "choices": [{"message": {"content": '{"spmStoreId":"9999"}'}}]
    }
    fake_client = MagicMock()
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=None)
    fake_client.post = AsyncMock(return_value=fake_resp)

    with (
        patch(
            "src.agent.template_report.slot_intent.get_settings",
            return_value=MagicMock(
                INTENT_DETECT_MODEL="tongyi-intent-detect-v3",
                INTENT_DETECT_API_KEY="sk-test",
                INTENT_DETECT_ENDPOINT="https://example.invalid/v1",
                INTENT_DETECT_TIMEOUT_MS=2000,
            ),
        ),
        patch("src.agent.template_report.slot_intent.httpx.AsyncClient", return_value=fake_client),
    ):
        res = await extract_slots_with_intent_model("打开金坛店日报", slots)

    assert res.detail == "ok"
    assert res.explicit == {}  # 9999 非法，不算显式
    assert res.params == {"spmStoreId": "101"}  # 回退 default
    assert res.missing_explicit == ["spmStoreId"]


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
async def test_pipeline_catalog_forbidden_is_error_not_miss() -> None:
    from src.adapters.ai_report_client import AiReportClientError

    cfg = TemplateReportRouterConfig(enabled=True, min_confidence=0.75)
    client = MagicMock()
    client.catalog = AsyncMock(
        side_effect=AiReportClientError("无权限", code=40300)
    )

    with (
        patch(
            "src.agent.template_report.pipeline.load_template_report_router_config",
            return_value=cfg,
        ),
        patch(
            "src.agent.template_report.pipeline.AiReportClient",
            return_value=client,
        ),
    ):
        outcome = await run_template_report_turn(user_text="打开门店经营日报")
    assert outcome.kind == "error"
    assert "ai-report:view" in outcome.text
    assert "catalog_error" in outcome.detail


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


@pytest.mark.asyncio
async def test_pipeline_full_slots_still_open_card_not_execute() -> None:
    """参数齐了也只开卡预填，对话侧不自动 execute。"""
    from datetime import date

    cfg = TemplateReportRouterConfig(enabled=True, min_confidence=0.35)
    catalog = [
        {
            "group_id": 1,
            "reports": [
                {
                    "report_code": "SPM-STORE-DAY-REPORT",
                    "title": "门店经营日报",
                    "description": "日报",
                }
            ],
        }
    ]
    prepared = {
        "report_code": "SPM-STORE-DAY-REPORT",
        "title": "门店经营日报",
        "slots": [
            {
                "wire_key": "spmStoreId",
                "required": True,
                "options": [
                    {"value": "0001", "label": "宜兴城中店"},
                    {"value": "0021", "label": "宜兴城北店"},
                ],
            },
            {
                "wire_key": "spmBizDate",
                "required": True,
                "value_type": "date",
                "options": [],
            },
        ],
    }
    client = MagicMock()
    client.catalog = AsyncMock(return_value=catalog)
    client.prepare_card = AsyncMock(return_value=prepared)
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
            return_value=MagicMock(
                report_code="SPM-STORE-DAY-REPORT",
                detail="ok",
                raw={},
            ),
        ),
        patch(
            "src.agent.template_report.pipeline.extract_slots_with_intent_model",
            new_callable=AsyncMock,
            return_value=MagicMock(
                detail="skipped", explicit={}, raw_model=None, latency_ms=0
            ),
        ),
        patch(
            "src.agent.template_report.slot_resolve._today",
            return_value=date(2026, 11, 5),
        ),
    ):
        outcome = await run_template_report_turn(
            user_text="打开宜兴城北店昨天日报",
            authorization="Bearer x",
        )

    assert outcome.kind == "open_card"
    assert outcome.detail == "open_card_await_confirm"
    assert "[[ai.report.open_card" in outcome.text
    assert "spmStoreId" in (outcome.text or "")
    client.execute.assert_not_awaited()
