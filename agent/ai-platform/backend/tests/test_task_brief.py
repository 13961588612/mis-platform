"""TaskBrief 构建 / 校验 / 脱敏 / 结果信封单元测试（T01·C1）。"""

from __future__ import annotations

import json

import pytest

from src.coordinator.brief import (
    MIN_BRIEF_CHARS,
    BriefValidationError,
    TaskBrief,
    TaskBriefBuilder,
    TaskBriefInputs,
    is_lazy_delegation,
    sanitize_page_context,
)
from src.coordinator.notification import (
    NOTIFICATION_MODE_JSON,
    NOTIFICATION_MODE_TEXT_WITH_HEADER,
    TaskNotification,
    TaskStatus,
    TaskUsage,
    build_summary,
)

# ===== sanitize_page_context =====


def test_sanitize_page_context_keeps_only_allow_keys():
    raw = {
        "pageId": "P-001",
        "formCode": "TRAVEL",
        "unknownKey": "should-be-dropped",
        "rows": [{"a": 1}],
    }
    cleaned = sanitize_page_context(raw)
    assert cleaned == {"formCode": "TRAVEL", "pageId": "P-001"}


def test_sanitize_page_context_drops_sensitive_top_level_keys():
    raw = {"pageId": "P-1", "userMobile": "13800138000", "authorization": "Bearer x"}
    cleaned = sanitize_page_context(raw)
    assert "userMobile" not in cleaned
    assert "authorization" not in cleaned
    assert cleaned["pageId"] == "P-1"


def test_sanitize_page_context_drops_nested_sensitive_keys():
    raw = {"visibleFields": {"name": "张三", "id_card": "110101199001011234"}}
    cleaned = sanitize_page_context(raw)
    assert cleaned["visibleFields"] == {"name": "张三"}


def test_sanitize_page_context_masks_values():
    raw = {
        "visibleFields": {
            "contact": "联系电话 13800138000",
            "cert": "110101199001011234",
            "card": "6222021234567890123",
        }
    }
    cleaned = sanitize_page_context(raw)
    fields = cleaned["visibleFields"]
    assert fields["contact"] == "联系电话 138****8000"
    assert fields["cert"] == "110101********1234"
    assert fields["card"] == "6222***********0123"


def test_sanitize_page_context_truncates_by_total_length():
    raw = {
        "pageId": "P" * 200,
        "pageName": "N" * 200,
        "formCode": "F" * 200,
    }
    cleaned = sanitize_page_context(raw, max_chars=230)
    assert cleaned.get("_truncated") is True
    payload = json.dumps(cleaned, ensure_ascii=False)
    # 仅保留能放下的键，剩余整键丢弃
    assert len([k for k in cleaned if k != "_truncated"]) < 3
    assert len(payload) < 300


def test_sanitize_page_context_handles_none_and_non_dict():
    assert sanitize_page_context(None) == {}
    assert sanitize_page_context({}) == {}


# ===== 懒委托判据 =====


@pytest.mark.parametrize(
    "text",
    [
        "帮我查一下",
        "根据你的发现",
        "看看情况",
        "你看着办",
        "继续吧",
        "随便",
    ],
)
def test_is_lazy_delegation_hits(text: str):
    assert is_lazy_delegation(text) is True


def test_is_lazy_delegation_not_hit_when_has_real_content():
    assert is_lazy_delegation("帮我查一下差旅报销标准的条款依据") is False
    assert is_lazy_delegation("检索差旅报销标准并给出条款依据") is False


# ===== TaskBriefBuilder =====


def test_build_structured_success():
    builder = TaskBriefBuilder()
    brief, error = builder.build(
        task_brief={
            "goal": "检索差旅报销标准并给出条款依据",
            "purpose": "直接回复用户",
            "inputs": {
                "user_question": "差旅报销制度怎么规定？",
                "page_context_slice": {"pageId": "P-1", "token": "abc"},
            },
            "constraints": ["无命中须如实说明"],
            "expected_output": "answer+citations",
        },
        content="",
        metadata={},
        identity={"userId": "u1", "channel": "mis_bff"},
    )
    assert error is None
    assert brief is not None
    assert brief.goal == "检索差旅报销标准并给出条款依据"
    assert brief.inputs.page_context_slice == {"pageId": "P-1"}
    assert brief.identity == {"userId": "u1", "channel": "mis_bff"}
    assert brief.expected_output == "answer+citations"


def test_build_text_fallback_uses_content_as_goal():
    builder = TaskBriefBuilder()
    brief, error = builder.build(
        task_brief=None,
        content="检索差旅报销标准并给出条款依据",
        metadata={"user_question": "差旅报销制度怎么规定？", "page_context": {"pageId": "P-9"}},
        identity={},
    )
    assert error is None
    assert brief is not None
    assert brief.goal == "检索差旅报销标准并给出条款依据"
    assert brief.inputs.user_question == "差旅报销制度怎么规定？"
    assert brief.inputs.page_context_slice == {"pageId": "P-9"}


def test_build_rejects_missing_goal():
    builder = TaskBriefBuilder()
    brief, error = builder.build(
        task_brief={"inputs": {"user_question": "差旅报销制度怎么规定？"}},
        content="",
        metadata={},
        identity={},
    )
    assert brief is None
    assert error is not None
    assert error.reason == "missing_goal"
    assert "goal" in error.missing_fields


def test_build_rejects_lazy_delegation():
    builder = TaskBriefBuilder()
    brief, error = builder.build(
        task_brief=None,
        content="帮我查一下",
        metadata={"user_question": "差旅报销制度怎么规定？"},
        identity={},
    )
    assert brief is None
    assert error is not None
    assert error.reason == "lazy_delegation"


def test_build_rejects_too_short_goal():
    builder = TaskBriefBuilder()
    brief, error = builder.build(
        task_brief=None,
        content="查制度",
        metadata={"user_question": "制度？"},
        identity={},
    )
    assert brief is None
    assert error is not None
    assert error.reason == "too_short"
    assert len("查制度") < MIN_BRIEF_CHARS


def test_build_rejects_empty_question_and_goal():
    builder = TaskBriefBuilder()
    brief, error = builder.build(
        task_brief=None,
        content="   ",
        metadata={},
        identity={},
    )
    assert brief is None
    assert error is not None
    assert error.reason == "empty_question"


def test_build_lenient_mode_never_rejects():
    builder = TaskBriefBuilder()
    brief, error = builder.build(
        task_brief=None,
        content="帮我查一下",
        metadata={},
        identity={},
        strict=False,
    )
    assert error is None
    assert brief is not None
    assert brief.goal == "帮我查一下"


def test_build_identity_never_leaks_into_render():
    builder = TaskBriefBuilder()
    brief, _ = builder.build(
        task_brief={
            "goal": "检索差旅报销标准并给出条款依据",
            "inputs": {"user_question": "差旅报销制度怎么规定？"},
        },
        content="",
        metadata={},
        identity={"userId": "u1", "userMobile": "13800138000"},
    )
    assert brief is not None
    rendered = brief.render()
    assert "13800138000" not in rendered
    assert "userMobile" not in rendered


# ===== render 稳定顺序 =====


def test_render_bare_text_is_verbatim():
    brief = TaskBrief(goal="检索差旅报销标准并给出条款依据")
    assert brief.render() == "检索差旅报销标准并给出条款依据"


def test_render_snapshot_stable_order():
    brief = TaskBrief(
        goal="检索差旅报销标准并给出条款依据",
        purpose="直接回复用户",
        inputs=TaskBriefInputs(
            user_question="差旅报销制度怎么规定？",
            page_context_slice={"pageId": "P-1"},
            attachments_text="附件正文",
        ),
        constraints=["无命中须如实说明", "禁止臆造"],
        identity={"userId": "u1"},
        expected_output="answer+citations",
    )
    expected = (
        "## 目标\n检索差旅报销标准并给出条款依据\n\n"
        "## 用途\n直接回复用户\n\n"
        "## 用户原问\n差旅报销制度怎么规定？\n\n"
        '## 页面上下文（已脱敏）\n```json\n{"pageId": "P-1"}\n```\n\n'
        "## 附件文本\n附件正文\n\n"
        "## 约束\n- 无命中须如实说明\n- 禁止臆造\n\n"
        "## 期望输出\nanswer+citations"
    )
    assert brief.render() == expected


# ===== BriefValidationError 重写模板 =====


def test_validation_error_tool_output_contains_template_and_example():
    error = BriefValidationError(
        reason="lazy_delegation",
        missing_fields=["goal"],
        rewrite_hint="禁止指代式口令。",
    )
    output = error.to_tool_output()
    assert "[任务书校验未通过]" in output
    assert "懒委托" in output
    assert '"goal"' in output
    assert "正确示例" in output
    assert "禁止指代式口令。" in output


# ===== TaskNotification 信封 =====


def test_notification_text_with_header_body_is_byte_identical():
    worker_text = "字段A=1；完成"
    notification = TaskNotification.from_worker_result(
        task_id="a1b2c3d4e5f6",
        worker_id="mis-extract",
        result=worker_text,
        latency_ms=1200,
    )
    output = notification.to_tool_output(mode=NOTIFICATION_MODE_TEXT_WITH_HEADER)
    assert output.startswith("[task:a1b2c3d4e5f6] worker=mis-extract status=completed latency=1200ms")
    assert output.split("\n\n", 1)[1] == worker_text
    assert output.endswith(worker_text)


def test_notification_error_status_has_no_header():
    notification = TaskNotification.from_worker_result(
        task_id="ffffffffffff",
        worker_id="mis-rag",
        result="子智能体 mis-rag 调用超时（>30s）",
        status=TaskStatus.TIMEOUT,
        error_code="WORKER_TIMEOUT",
        latency_ms=30000,
    )
    output = notification.to_tool_output(mode=NOTIFICATION_MODE_TEXT_WITH_HEADER)
    assert output == "子智能体 mis-rag 调用超时（>30s）"


def test_notification_json_mode():
    notification = TaskNotification.from_worker_result(
        task_id="a1b2c3d4e5f6",
        worker_id="mis-rag",
        result="结果",
        usage=TaskUsage(tokens=10, tool_uses=2, duration_ms=5),
        latency_ms=5,
    )
    payload = json.loads(notification.to_tool_output(mode=NOTIFICATION_MODE_JSON))
    assert payload["task_id"] == "a1b2c3d4e5f6"
    assert payload["status"] == "completed"
    assert payload["usage"]["tokens"] == 10


def test_build_summary_truncates():
    assert build_summary("a b\n c") == "a b c"
    long_text = "字" * 200
    summary = build_summary(long_text)
    assert len(summary) == 120
    assert summary.endswith("…")
