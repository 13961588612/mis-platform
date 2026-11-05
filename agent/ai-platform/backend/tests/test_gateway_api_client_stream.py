"""GatewayApiClient：有/无 tools 一律 chat_stream 真流式。"""

from __future__ import annotations

from typing import Any

import pytest

from src.llm.models import LLMChunk, TokenUsage
from src.runtime.gateway_api_client import (
    GatewayApiClient,
    _merge_tool_call_delta,
    _normalize_assistant_text,
    _tool_calls_to_content_blocks,
    looks_like_garbage_text,
    sanitize_model_text,
)


def test_merge_tool_call_delta_accumulates_arguments() -> None:
    acc: dict[int, dict[str, Any]] = {}
    _merge_tool_call_delta(
        acc,
        [
            {
                "index": 0,
                "id": "call_1",
                "type": "function",
                "function": {"name": "skill", "arguments": ""},
            }
        ],
    )
    _merge_tool_call_delta(
        acc,
        [{"index": 0, "id": "", "type": "function", "function": {"name": "", "arguments": '{"a"'}}],
    )
    _merge_tool_call_delta(
        acc,
        [{"index": 0, "id": "", "type": "function", "function": {"name": "", "arguments": ":1}"}}],
    )
    assert acc[0]["id"] == "call_1"
    assert acc[0]["function"]["name"] == "skill"
    assert acc[0]["function"]["arguments"] == '{"a":1}'


def test_tool_calls_to_content_blocks_parses_json() -> None:
    blocks = _tool_calls_to_content_blocks(
        [
            {
                "id": "c1",
                "type": "function",
                "function": {"name": "skill", "arguments": '{"name":"x"}'},
            }
        ]
    )
    assert len(blocks) == 1
    assert blocks[0].id == "c1"
    assert blocks[0].name == "skill"
    assert blocks[0].input == {"name": "x"}


def test_sanitize_strips_think_tags() -> None:
    raw = "前言<think>内部推理</think>对用户说：库存未开放"
    assert sanitize_model_text(raw) == "前言对用户说：库存未开放"


def test_garbage_text_marked_as_sentinel() -> None:
    from src.runtime.gateway_api_client import (
        MODEL_GARBAGE_RETRY_MESSAGE,
        _GARBAGE_SENTINEL,
        is_model_garbage_payload,
    )

    junk = '= < n0 {"m:3Xbabaal( (n=1N=2='
    assert looks_like_garbage_text(junk)
    out = _normalize_assistant_text(junk)
    assert out == _GARBAGE_SENTINEL
    assert is_model_garbage_payload(out)
    assert "库存未开放" not in out
    assert not looks_like_garbage_text("抱歉，库存查询暂未开放，可改问门店销售。")
    control = (
        "# 强制行为控制（所有任务必须遵守）\n"
        "1. 如果任务复杂，必须先拆解任务\n"
        "4. 必须对所有操作使用中文"
    )
    assert looks_like_garbage_text(control)
    assert _normalize_assistant_text(control) == _GARBAGE_SENTINEL
    # chat_15：无中文数字循环碎片（旧规则漏判）
    digit_loop = (
        'i1=70659843={"2ba3b0p0p99<ceava2.;p3012P013F1120131401314031403140'
        "3140314031314031403131403140314031403140314031403140314031403140"
    )
    assert looks_like_garbage_text(digit_loop)
    assert _normalize_assistant_text(digit_loop) == _GARBAGE_SENTINEL
    assert is_model_garbage_payload(MODEL_GARBAGE_RETRY_MESSAGE)


def test_tool_calls_to_content_blocks_skips_empty_name() -> None:
    blocks = _tool_calls_to_content_blocks(
        [
            {"id": "e1", "type": "function", "function": {"name": "", "arguments": "{}"}},
            {"id": "e2", "type": "function", "function": {"name": "  ", "arguments": "{}"}},
            {
                "id": "ok",
                "type": "function",
                "function": {"name": "skill", "arguments": "{}"},
            },
        ]
    )
    assert len(blocks) == 1
    assert blocks[0].id == "ok"
    assert blocks[0].name == "skill"


class _FakeGateway:
    def __init__(self, *, mode: str = "text") -> None:
        self.chat_calls = 0
        self.stream_calls = 0
        self.last_request: Any = None
        self._mode = mode

    async def chat_stream(self, request: Any):  # noqa: ANN401
        self.stream_calls += 1
        self.last_request = request
        if self._mode == "tools":
            yield LLMChunk(
                tool_call_deltas=[
                    {
                        "index": 0,
                        "id": "call_x",
                        "type": "function",
                        "function": {"name": "skill", "arguments": "{}"},
                    }
                ]
            )
            yield LLMChunk(
                finish_reason="tool_calls",
                usage=TokenUsage(prompt_tokens=1, completion_tokens=2, total_tokens=3),
            )
            return
        yield LLMChunk(content="你")
        yield LLMChunk(content="好")
        yield LLMChunk(
            finish_reason="stop",
            usage=TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )

    async def chat(self, request: Any) -> Any:  # noqa: ANN401
        self.chat_calls += 1
        self.last_request = request
        raise AssertionError("有/无 tools 均不应再走非流式 chat()")


@pytest.mark.asyncio
async def test_with_tools_uses_chat_stream() -> None:
    from openharness.api.client import ApiMessageCompleteEvent, ApiMessageRequest, ApiTextDeltaEvent
    from openharness.engine.messages import ConversationMessage, TextBlock

    gateway = _FakeGateway(mode="tools")
    client = GatewayApiClient(gateway, model="test-model")
    events = []
    async for ev in client.stream_message(
        ApiMessageRequest(
            model="test-model",
            messages=[ConversationMessage(role="user", content=[TextBlock(text="查报表")])],
            system_prompt="sys",
            tools=[{"name": "skill", "description": "d", "input_schema": {"type": "object"}}],
            max_tokens=128,
        )
    ):
        events.append(ev)

    assert gateway.stream_calls == 1
    assert gateway.chat_calls == 0
    assert gateway.last_request is not None
    assert gateway.last_request.stream is True
    assert gateway.last_request.tool_choice == "auto"
    assert [e.text for e in events if isinstance(e, ApiTextDeltaEvent)] == []
    complete = events[-1]
    assert isinstance(complete, ApiMessageCompleteEvent)
    assert complete.stop_reason == "tool_calls"


@pytest.mark.asyncio
async def test_without_tools_uses_chat_stream() -> None:
    from openharness.api.client import ApiMessageCompleteEvent, ApiMessageRequest, ApiTextDeltaEvent
    from openharness.engine.messages import ConversationMessage, TextBlock

    gateway = _FakeGateway(mode="text")
    client = GatewayApiClient(gateway, model="test-model")
    events = []
    async for ev in client.stream_message(
        ApiMessageRequest(
            model="test-model",
            messages=[ConversationMessage(role="user", content=[TextBlock(text="你好")])],
            system_prompt="sys",
            tools=[],
            max_tokens=128,
        )
    ):
        events.append(ev)

    assert gateway.stream_calls == 1
    assert gateway.chat_calls == 0
    assert gateway.last_request.stream is True
    assert gateway.last_request.tool_choice == "none"
    assert [e.text for e in events if isinstance(e, ApiTextDeltaEvent)] == ["你", "好"]
    assert isinstance(events[-1], ApiMessageCompleteEvent)
