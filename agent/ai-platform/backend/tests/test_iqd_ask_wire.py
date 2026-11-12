"""问数测试台：失败帧与角色头回落。"""

from __future__ import annotations

import json
from typing import Any

from src.agent.session import Message
from src.api.routes.mis_capability import (
    _collect_agent_response,
    _merge_identity_headers_into_metadata,
    iqd_ask_wire_json,
)
from src.runtime.events import AgentEvent


def test_scope_denied_payload_becomes_ask_response() -> None:
    wire = iqd_ask_wire_json(
        {
            "output": json.dumps(
                {"code": 45204, "message": "当前角色无可问数据范围"},
                ensure_ascii=False,
            ),
            "error": "ignored",
        }
    )
    assert wire is not None
    payload = json.loads(wire)
    assert payload["status"] == "failed"
    assert payload["error_code"] == "45204"
    assert payload["error_message"] == "当前角色无可问数据范围"
    assert payload["scope"]["decision"] == "deny"


def test_existing_ask_response_is_kept() -> None:
    original = {"status": "succeeded", "answer_summary": "3 家门店", "data": {"row_count": 3}}
    wire = iqd_ask_wire_json({"output": original})
    assert wire is not None
    assert json.loads(wire)["answer_summary"] == "3 家门店"


async def test_tool_error_json_wins_over_llm_prose() -> None:
    error_json = json.dumps(
        {"code": 45204, "message": "当前角色无可问数据范围"},
        ensure_ascii=False,
    )
    events = [
        AgentEvent.tool_result("iqd__ask", {"output": error_json, "error": error_json}),
        AgentEvent.text_delta("查询未执行成功，无法返回门店清单。"),
    ]

    class _Agent:
        async def process_message(self, **kwargs: Any):
            del kwargs
            for event in events:
                yield event

    text, runtime_error, tool_errors = await _collect_agent_response(
        _Agent(),
        object(),
        Message(role="user", content="无锡有哪些门店"),
    )
    payload = json.loads(text)
    assert payload["error_code"] == "45204"
    assert "查询未执行成功" not in text
    assert runtime_error is None
    assert tool_errors and "45204" in tool_errors[0]


async def test_non_iqd_tool_error_keeps_assistant_text() -> None:
    events = [
        AgentEvent.tool_result("other_tool", {"output": "boom", "error": "boom"}),
        AgentEvent.text_delta("工具失败"),
    ]

    class _Agent:
        async def process_message(self, **kwargs: Any):
            del kwargs
            for event in events:
                yield event

    text, _, tool_errors = await _collect_agent_response(
        _Agent(),
        object(),
        Message(role="user", content="q"),
    )
    assert text == "工具失败"
    assert tool_errors == ["other_tool: boom"]


def test_missing_role_header_uses_verified_jwt_roles() -> None:
    merged = _merge_identity_headers_into_metadata(
        {},
        current_user={"roles": ["TENANT_ADMIN"], "profile": {"mis_user_id": 1}},
    )
    assert "TENANT_ADMIN" in merged["X-Mis-Roles"]
    assert merged["X-User-Id"] == "1"


def test_explicit_role_header_not_replaced_by_jwt() -> None:
    merged = _merge_identity_headers_into_metadata(
        {},
        current_user={"roles": ["TENANT_ADMIN"], "profile": {"mis_user_id": 1}},
        x_mis_roles='[{"code":"OTHER"}]',
    )
    assert "OTHER" in merged["X-Mis-Roles"]
    assert "TENANT_ADMIN" not in merged["X-Mis-Roles"]
