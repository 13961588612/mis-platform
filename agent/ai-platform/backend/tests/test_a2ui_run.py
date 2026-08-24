"""A2UI run 消费链路单元测试（Task A：Python Agent Core 消费 a2ui_run）。

覆盖：
- ``a2ui_outbound`` 回包格式与 Gateway ``types.ts`` OutboundStreamMessage 期望一致
  （``aip:outbound:{sessionId}`` + ``sessionId`` / ``eventType`` / ``event`` JSON）；
- RunAgentInput 解析（messages / model / tools → LLM 请求）；
- ``render_a2ui`` 工具执行（surfaceId / components 校验、组件名白名单告警）；
- ``A2uiRunLoop`` 事件序列（tool.call → tool.result → text.delta → done）；
- LLM 失败 → ``error`` + ``done`` 回包（Gateway 靠它 complete Observable）；
- ``inbound_worker`` ``a2ui_run`` 分支（含空 content 前置路由）。

使用 fakeredis（真实 GET/XADD 语义），与 ``test_gateway_outbound_routing.py`` 同约定。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import fakeredis
import pytest
from openharness.tools.base import (
    BaseTool,
    ToolExecutionContext,
    ToolRegistry,
    ToolResult,
)
from pydantic import BaseModel

from src.llm.models import LLMResponse
from src.queue.a2ui_outbound import A2uiOutboundPublisher, a2ui_outbound_key
from src.queue.inbound_worker import InboundStreamWorker
from src.queue.redis_stream import InboundStreamMessage
from src.runtime.acl_tool_wrapper import AclToolWrapper
from src.runtime.a2ui_run import (
    A2uiRunLoop,
    agui_messages_to_llm,
    agui_tools_to_openai_tools,
    execute_render_a2ui,
)
from src.runtime.events import AgentEvent
from src.runtime.tool_registry_builder import SafeToolWrapper
from src.skills.acl import SkillAclDenied
from src.utils.exceptions import SessionNotFoundError


@pytest.fixture()
def redis():
    """每用例独立的 fakeredis 服务，避免跨用例键污染。"""
    server = fakeredis.FakeServer()
    r = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    yield r


class _FakeGateway:
    """返回预设 ``LLMResponse`` 队列的 LLM Gateway 替身。"""

    def __init__(self, responses: list[LLMResponse]) -> None:
        self.responses = list(responses)
        self.requests: list[Any] = []

    async def chat(self, request: Any) -> LLMResponse:
        self.requests.append(request)
        if not self.responses:
            raise RuntimeError("unexpected chat() call")
        return self.responses.pop(0)


class _FakeSessionManager:
    """不落库的会话管理器替身：无历史、记录持久化调用。"""

    def __init__(self) -> None:
        self.persisted: list[dict[str, Any]] = []

    async def get_session(self, session_id: str) -> Any:
        raise SessionNotFoundError(session_id)

    async def ensure_session(self, **kwargs: Any) -> Any:
        return None

    async def add_message(self, **kwargs: Any) -> Any:
        self.persisted.append(kwargs)


async def _stream_events(redis: Any, session_id: str) -> list[dict[str, Any]]:
    """读取 ``aip:outbound:{sessionId}`` 流并按序返回解析后的事件 dict。"""
    raw = await redis.xrange(a2ui_outbound_key(session_id))
    return [json.loads(dict(fields)["event"]) for _mid, fields in raw]


# ============================================================================
# 1. a2ui_outbound 回包格式（与 Gateway types.ts / EventConverter 对齐）
# ============================================================================


def test_a2ui_outbound_publisher_writes_expected_fields(redis):
    """回包字段与 Gateway OutboundStreamMessage 契约一致（eventType + event JSON）。"""

    async def run():
        publisher = A2uiOutboundPublisher(redis)
        await publisher.publish("sess-1", AgentEvent.text_delta("你好"))
        await publisher.publish(
            "sess-1",
            AgentEvent.tool_call(
                "render_a2ui", {"surfaceId": "s1", "components": []}
            ),
        )
        key = a2ui_outbound_key("sess-1")
        assert key == "aip:outbound:sess-1"
        messages = await redis.xrange(key)
        assert len(messages) == 2

        fields0 = dict(messages[0][1])
        assert fields0["sessionId"] == "sess-1"
        assert fields0["eventType"] == "text.delta"
        assert "timestamp" in fields0
        event0 = json.loads(fields0["event"])
        assert event0["type"] == "text.delta"
        assert event0["content"] == "你好"

        fields1 = dict(messages[1][1])
        assert fields1["eventType"] == "tool.call"
        event1 = json.loads(fields1["event"])
        assert event1["type"] == "tool.call"
        assert event1["tool_name"] == "render_a2ui"  # snake_case，parseBackendAgentEvent 兼容
        assert event1["args"]["surfaceId"] == "s1"

    asyncio.run(run())


def test_a2ui_outbound_publish_error_ends_with_done(redis):
    """error 回包后必须紧跟 done（Gateway RedisStreamAgent 靠二者终止 Observable）。"""

    async def run():
        publisher = A2uiOutboundPublisher(redis)
        await publisher.publish_error("sess-err", "A2UI_RUN_ERROR", "boom")
        events = await _stream_events(redis, "sess-err")
        assert events[0]["type"] == "error"
        assert events[0]["error_code"] == "A2UI_RUN_ERROR"
        assert events[0]["message"] == "boom"
        assert events[1]["type"] == "done"

    asyncio.run(run())


# ============================================================================
# 2. RunAgentInput 解析（messages / tools）
# ============================================================================


def test_agui_messages_to_llm():
    """RunAgentInput.messages（AG-UI 格式）→ 平台 LLMMessage，tool_calls 转 OpenAI 格式。"""
    messages = [
        {"id": "m1", "role": "user", "content": "帮我查一下"},
        {
            "id": "m2",
            "role": "assistant",
            "content": "好的",
            "tool_calls": [
                {
                    "id": "tc1",
                    "name": "render_a2ui",
                    "input": {"surfaceId": "s"},
                }
            ],
        },
        {"id": "m3", "role": "tool", "content": '{"ok": true}', "tool_call_id": "tc1"},
    ]
    llm_messages = agui_messages_to_llm(messages)
    assert len(llm_messages) == 3
    assert llm_messages[0].role.value == "user"
    assert llm_messages[1].role.value == "assistant"
    assert llm_messages[1].tool_calls[0]["function"]["name"] == "render_a2ui"
    assert llm_messages[1].tool_calls[0]["function"]["arguments"] == '{"surfaceId": "s"}'
    assert llm_messages[2].role.value == "tool"
    assert llm_messages[2].tool_call_id == "tc1"


def test_agui_tools_to_openai_tools():
    """RunAgentInput.tools（AG-UI {name, description, parameters}）→ OpenAI 工具 schema。"""
    tools = [
        {
            "name": "render_a2ui",
            "description": "render an A2UI surface",
            "parameters": {
                "type": "object",
                "properties": {"surfaceId": {"type": "string"}},
            },
        },
        {"description": "missing name -> skipped"},
        "not-a-dict -> skipped",
    ]
    openai_tools = agui_tools_to_openai_tools(tools)
    assert len(openai_tools) == 1
    assert openai_tools[0]["type"] == "function"
    assert openai_tools[0]["function"]["name"] == "render_a2ui"
    assert openai_tools[0]["function"]["description"].startswith("render")
    assert openai_tools[0]["function"]["parameters"]["properties"]["surfaceId"]["type"] == "string"


# ============================================================================
# B1（QA）：嵌套 AG-UI ToolCall 转换（{id, type:'function', function:{name, arguments}}）
# ============================================================================


def test_agui_messages_to_llm_nested_tool_call():
    """真实 AG-UI ToolCall 嵌套格式：name/arguments 在 function 内，转换不丢字段。"""
    messages = [
        {
            "id": "m1",
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "tc-nested",
                    "type": "function",
                    "function": {
                        "name": "render_a2ui",
                        "arguments": '{"surfaceId":"s1","components":[]}',
                    },
                }
            ],
        },
        {
            "id": "m2",
            "role": "tool",
            "content": '{"ok": true}',
            "tool_call_id": "tc-nested",
        },
    ]
    llm_messages = agui_messages_to_llm(messages)
    assert len(llm_messages) == 2
    api_tc = llm_messages[0].tool_calls[0]
    assert api_tc["function"]["name"] == "render_a2ui"
    assert api_tc["function"]["arguments"] == '{"surfaceId":"s1","components":[]}'
    assert llm_messages[0].content == ""
    assert llm_messages[1].role.value == "tool"
    assert llm_messages[1].tool_call_id == "tc-nested"


def test_agui_messages_to_llm_nested_tool_call_arguments_object():
    """嵌套格式 arguments 为对象（非 JSON 字符串）时序列化为 JSON 字符串。"""
    messages = [
        {
            "id": "m1",
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "tc-obj",
                    "type": "function",
                    "function": {
                        "name": "render_a2ui",
                        "arguments": {"surfaceId": "s2", "components": []},
                    },
                }
            ],
        }
    ]
    llm_messages = agui_messages_to_llm(messages)
    api_tc = llm_messages[0].tool_calls[0]
    assert api_tc["function"]["name"] == "render_a2ui"
    assert json.loads(api_tc["function"]["arguments"]) == {
        "surfaceId": "s2",
        "components": [],
    }


def test_agui_messages_to_llm_a2ui_action_continuation():
    """a2ui_action 续跑合成消息（A2UIMiddleware.processUserAction 产出）转换不 malformed。

    中间件合成 toolCalls 为嵌套风格：
    ``[{id, type:'function', function:{name:'log_a2ui_event', arguments: JSON.stringify(userAction)}}]``，
    且后跟同 id 的 tool role 消息——转换后 name 不得为空、arguments 必须还原。
    """
    user_action = {
        "surfaceId": "sfc-1",
        "sourceComponentId": "approve-btn",
        "name": "approve",
        "context": {"approvalId": "WO-1234"},
    }
    messages = [
        {
            "id": "ma1",
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "tc-act",
                    "type": "function",
                    "function": {
                        "name": "log_a2ui_event",
                        "arguments": json.dumps(user_action, ensure_ascii=False),
                    },
                }
            ],
        },
        {
            "id": "ma2",
            "role": "tool",
            "content": json.dumps({"ok": True}, ensure_ascii=False),
            "tool_call_id": "tc-act",
        },
    ]
    llm_messages = agui_messages_to_llm(messages)
    assert len(llm_messages) == 2
    api_tc = llm_messages[0].tool_calls[0]
    assert api_tc["function"]["name"] == "log_a2ui_event"
    assert json.loads(api_tc["function"]["arguments"]) == user_action
    assert llm_messages[1].role.value == "tool"
    assert llm_messages[1].tool_call_id == "tc-act"
    # LLMMessage.to_api_dict 序列化后仍可被 OpenAI 兼容 provider 消费（name 非空）
    api_dict = llm_messages[0].to_api_dict()
    assert api_dict["tool_calls"][0]["function"]["name"] == "log_a2ui_event"


# ============================================================================
# 3. render_a2ui 工具执行（A2UI surface 操作）
# ============================================================================


def test_execute_render_a2ui_valid():
    """合法 args（surfaceId + components）→ ok / rendered / componentCount。"""

    async def run():
        result = await execute_render_a2ui(
            {
                "surfaceId": "sfc-1",
                "components": [
                    {
                        "id": "root",
                        "component": "data-table",
                        "columns": [{"key": "id", "header": "ID"}],
                        "rows": [{"id": "1"}],
                    }
                ],
            },
            session_id="s1",
        )
        assert result["ok"] is True
        assert result["status"] == "rendered"
        assert result["surfaceId"] == "sfc-1"
        assert result["componentCount"] == 1
        assert result["catalogId"] == "mis-a2ui-catalog-v1"

    asyncio.run(run())


def test_execute_render_a2ui_invalid():
    """缺 surfaceId / components 非数组 → 明确错误（fail-closed 校验）。"""

    async def run():
        result = await execute_render_a2ui({"surfaceId": ""}, session_id="s1")
        assert result["ok"] is False
        assert "surfaceId" in result["error"]

        result2 = await execute_render_a2ui(
            {"surfaceId": "s", "components": "not-a-list"}, session_id="s1"
        )
        assert result2["ok"] is False
        assert "components" in result2["error"]

        result3 = await execute_render_a2ui([], session_id="s1")
        assert result3["ok"] is False

    asyncio.run(run())


# ============================================================================
# 4. A2uiRunLoop 事件序列
# ============================================================================


def test_a2ui_run_loop_tool_then_text(redis):
    """一轮 render_a2ui 工具调用 + 最终文本 → tool.call/tool.result/text.delta/done。"""

    async def run():
        gateway = _FakeGateway(
            [
                LLMResponse(
                    content="",
                    tool_calls=[
                        {
                            "id": "tc1",
                            "type": "function",
                            "function": {
                                "name": "render_a2ui",
                                "arguments": (
                                    '{"surfaceId":"s1","components":'
                                    '[{"id":"root","component":"data-table"}]}'
                                ),
                            },
                        }
                    ],
                    finish_reason="tool_calls",
                ),
                LLMResponse(content="已为你生成表格", finish_reason="stop"),
            ]
        )
        publisher = A2uiOutboundPublisher(redis)
        loop = A2uiRunLoop(
            gateway,
            publisher,
            model="test-model",
            session_manager=_FakeSessionManager(),
        )
        await loop.run(
            session_id="sess-2",
            user_id="u1",
            trace_id="t1",
            run_agent_input={
                "messages": [{"role": "user", "content": "查数据"}],
                "tools": [
                    {
                        "name": "render_a2ui",
                        "description": "render",
                        "parameters": {"type": "object", "properties": {}},
                    }
                ],
            },
        )

        events = await _stream_events(redis, "sess-2")
        assert [e["type"] for e in events] == [
            "tool.call",
            "tool.result",
            "text.delta",
            "done",
        ]
        assert events[0]["tool_name"] == "render_a2ui"
        assert events[0]["args"]["surfaceId"] == "s1"
        assert events[1]["tool_name"] == "render_a2ui"
        assert events[1]["result"]["ok"] is True
        assert events[2]["content"] == "已为你生成表格"
        assert events[3]["type"] == "done"
        # 评价锚点（feedback-enhance §2.2 方案 C）：done 事件必须携带 message_id/session_id，
        # 且 message_id 与该条 assistant 消息落库（add_message）的 UUID 一致。
        assert events[3]["session_id"] == "sess-2"
        done_message_id = events[3]["message_id"]
        assert isinstance(done_message_id, str) and done_message_id, (
            "done 事件应携带 assistant 消息 UUID（message_id）"
        )
        assistant_persisted = [
            m for m in loop._session_manager.persisted if m["role"] == "assistant"
        ]
        assert len(assistant_persisted) == 1
        assert assistant_persisted[0]["message_id"] == done_message_id, (
            "done.message_id 必须与 agent_session_message 落库 UUID 一致"
        )

    asyncio.run(run())


def test_a2ui_done_without_assistant_text_omits_message_id(redis):
    """assistant 无正文（仅工具调用）→ done 携带 session_id 但省略 message_id。

    没有可评价的 assistant 消息时，透传 message_id 会产生悬空锚点；此时前端
    评价按钮按缺失 messageId 降级禁用（feedback-enhance §2.2 方案 C）。
    """

    async def run():
        gateway = _FakeGateway(
            [
                LLMResponse(
                    content="",
                    tool_calls=[
                        {
                            "id": "tc-empty",
                            "type": "function",
                            "function": {
                                "name": "render_a2ui",
                                "arguments": (
                                    '{"surfaceId":"s1","components":'
                                    '[{"id":"root","component":"data-table"}]}'
                                ),
                            },
                        }
                    ],
                    finish_reason="tool_calls",
                ),
                LLMResponse(content="", finish_reason="stop"),
            ]
        )
        publisher = A2uiOutboundPublisher(redis)
        loop = A2uiRunLoop(
            gateway,
            publisher,
            model="test-model",
            session_manager=_FakeSessionManager(),
        )
        await loop.run(
            session_id="sess-empty-text",
            user_id="u1",
            trace_id="t1",
            run_agent_input={
                "messages": [{"role": "user", "content": "只渲染表格"}],
                "tools": [
                    {
                        "name": "render_a2ui",
                        "description": "render",
                        "parameters": {"type": "object", "properties": {}},
                    }
                ],
            },
        )

        events = await _stream_events(redis, "sess-empty-text")
        done = events[-1]
        assert done["type"] == "done"
        assert done["session_id"] == "sess-empty-text"
        assert "message_id" not in done, "无 assistant 正文时不应透传 message_id"

    asyncio.run(run())


def test_a2ui_run_loop_llm_failure_publishes_error(redis):
    """LLM 调用抛异常 → error + done 回包（Gateway 靠 error 终止 Observable）。"""

    async def run():
        class _RaisingGateway:
            async def chat(self, request: Any) -> LLMResponse:
                raise RuntimeError("provider down")

        publisher = A2uiOutboundPublisher(redis)
        loop = A2uiRunLoop(
            _RaisingGateway(),
            publisher,
            model="test-model",
            session_manager=_FakeSessionManager(),
        )
        await loop.run(
            session_id="sess-err2",
            user_id="u1",
            run_agent_input={"messages": [{"role": "user", "content": "hi"}]},
        )
        events = await _stream_events(redis, "sess-err2")
        assert events[0]["type"] == "error"
        assert events[0]["error_code"] == "A2UI_RUN_ERROR"
        assert "provider down" in events[0]["message"]
        assert events[1]["type"] == "done"

    asyncio.run(run())


def test_a2ui_run_loop_max_turns_publishes_error(redis):
    """持续工具调用直到达到轮数上限 → error + done（防死循环）。"""

    async def run():
        def _tool_response() -> LLMResponse:
            return LLMResponse(
                content="",
                tool_calls=[
                    {
                        "id": "tc-loop",
                        "type": "function",
                        "function": {
                            "name": "render_a2ui",
                            "arguments": '{"surfaceId":"s","components":[]}',
                        },
                    }
                ],
                finish_reason="tool_calls",
            )

        gateway = _FakeGateway([_tool_response() for _ in range(12)])
        publisher = A2uiOutboundPublisher(redis)
        loop = A2uiRunLoop(
            gateway,
            publisher,
            model="test-model",
            max_turns=2,
            session_manager=_FakeSessionManager(),
        )
        await loop.run(
            session_id="sess-loop",
            user_id="u1",
            run_agent_input={"messages": [{"role": "user", "content": "go"}]},
        )
        events = await _stream_events(redis, "sess-loop")
        assert events[-1]["type"] == "done"
        assert events[-2]["type"] == "error"
        assert "最大执行轮数" in events[-2]["message"]

    asyncio.run(run())


def test_a2ui_run_loop_empty_input_ok(redis):
    """空消息（无历史且 RunAgentInput.messages 为空）→ 空文本 + done，不调 LLM。"""

    async def run():
        gateway = _FakeGateway([])  # 若被调用会抛异常 → 测试失败
        publisher = A2uiOutboundPublisher(redis)
        loop = A2uiRunLoop(
            gateway,
            publisher,
            model="test-model",
            session_manager=_FakeSessionManager(),
        )
        await loop.run(
            session_id="sess-empty",
            user_id="u1",
            run_agent_input={"messages": [], "tools": []},
        )
        events = await _stream_events(redis, "sess-empty")
        assert events[0]["type"] == "text.delta"
        assert events[1]["type"] == "done"

    asyncio.run(run())


# ============================================================================
# 6. skill/mcp 分发接入 A2UI 通道（Task B）
# ============================================================================


class _FakeSkillInput(BaseModel):
    """skill 工具入参替身（字段名保持 name 兼容 ACL E1）。"""

    name: str = ""


class _FakeSkillTool(BaseTool):
    """返回预设输出的 skill 工具替身（记录调用上下文以便断言）。"""

    name = "skill"
    description = "fake skill tool"
    input_model = _FakeSkillInput

    def __init__(self) -> None:
        self.calls: list[tuple[Any, Any]] = []

    async def execute(
        self, arguments: BaseModel, context: ToolExecutionContext
    ) -> ToolResult:
        self.calls.append((arguments, context))
        return ToolResult(output=f"executed:{arguments.name}", is_error=False)


class _FakeMcpTool(BaseTool):
    """MCP 工具替身（名称走 mcp__ 前缀，验证白名单分发）。"""

    name = "mcp__member__profile_query"
    description = "fake mcp tool"
    input_model = _FakeSkillInput

    async def execute(
        self, arguments: BaseModel, context: ToolExecutionContext
    ) -> ToolResult:
        return ToolResult(output=f"mcp:{arguments.name}", is_error=False)


class _DenyGuard:
    """恒拒绝的 ACL guard 替身：E1 skill_id → 权限码，执行前必抛 SkillAclDenied。"""

    def permission_code(self, skill_id: str) -> str:
        return f"ai:skill:{skill_id}:run"

    async def assert_has_permission(
        self,
        ctx: Any,
        required_permission: str,
        *,
        skill_id: str = "",
        message: str = "",
        extra: dict[str, Any] | None = None,
    ) -> None:
        raise SkillAclDenied(
            code="AI_SKILL_FORBIDDEN",
            skill_id=skill_id or "member.profile",
            required_permission=required_permission,
            message=message or f"无权执行技能 {skill_id}",
            extra=dict(extra or {}),
        )


def _make_loop(redis: Any, *, registry: ToolRegistry) -> A2uiRunLoop:
    """构造注入工具注册表的 A2uiRunLoop。"""
    publisher = A2uiOutboundPublisher(redis)
    return A2uiRunLoop(
        _FakeGateway([]),
        publisher,
        model="test-model",
        session_manager=_FakeSessionManager(),
        tool_registry=registry,
    )


def test_a2ui_run_execute_skill_tool_real_dispatch(redis):
    """skill 工具走注册表真实执行：入参经 Pydantic 校验 + identity 注入上下文。"""

    async def run():
        tool = _FakeSkillTool()
        registry = ToolRegistry()
        registry.register(tool)
        loop = _make_loop(redis, registry=registry)

        result = await loop._execute_tool(
            "skill",
            {"name": "member.profile"},
            "sess-skill",
            identity={
                "userId": "u1",
                "userMobile": "",
                "channel": "h5",
                "channelUserId": "",
                "misUserId": "10086",
            },
            agent_id="agent-x",
        )
        assert result["ok"] is True
        assert result["output"] == "executed:member.profile"
        # 身份已注入 ToolExecutionContext.metadata（AclToolWrapper 消费第五键）
        assert len(tool.calls) == 1
        _args, context = tool.calls[0]
        assert context.metadata["session_id"] == "sess-skill"
        assert context.metadata["identity"]["misUserId"] == "10086"

    asyncio.run(run())


def test_a2ui_run_execute_mcp_tool_real_dispatch(redis):
    """mcp__ 工具同样走注册表真实执行（白名单内工具）。"""

    async def run():
        tool = _FakeMcpTool()
        registry = ToolRegistry()
        registry.register(tool)
        loop = _make_loop(redis, registry=registry)

        result = await loop._execute_tool(
            "mcp__member__profile_query",
            {"name": "member.profile"},
            "sess-mcp",
            identity={
                "userId": "u1",
                "userMobile": "",
                "channel": "h5",
                "channelUserId": "",
                "misUserId": "10086",
            },
            agent_id="agent-x",
        )
        assert result["ok"] is True
        assert result["output"] == "mcp:member.profile"

    asyncio.run(run())


def test_a2ui_run_execute_acl_denied(redis):
    """ACL 拒绝（AclToolWrapper fail-closed）→ 明确 error + acl metadata 透传。"""

    async def run():
        inner = _FakeSkillTool()
        registry = ToolRegistry()
        registry.register(AclToolWrapper(SafeToolWrapper(inner), _DenyGuard(), None))
        loop = _make_loop(redis, registry=registry)

        result = await loop._execute_tool(
            "skill",
            {"name": "member.profile"},
            "sess-acl",
            identity={
                "userId": "u1",
                "userMobile": "",
                "channel": "h5",
                "channelUserId": "",
                "misUserId": "10086",
            },
            agent_id="agent-x",
        )
        assert result["ok"] is False
        assert "无权执行技能" in result["error"]
        assert result["metadata"]["acl"]["code"] == "AI_SKILL_FORBIDDEN"
        assert result["metadata"]["acl"]["data"]["required_permission"] == (
            "ai:skill:member.profile:run"
        )
        # 被拒调用不进入内层副作用逻辑（内层 execute 不应被调用）
        assert inner.calls == []

    asyncio.run(run())


def test_a2ui_run_execute_unknown_tool(redis):
    """未注册工具 → TOOL_NOT_FOUND 明确 error（不中断循环）。"""

    async def run():
        loop = _make_loop(redis, registry=ToolRegistry())
        result = await loop._execute_tool(
            "mcp__nope__nope",
            {},
            "sess-unknown",
            identity={
                "userId": "u1",
                "userMobile": "",
                "channel": "h5",
                "channelUserId": "",
                "misUserId": "10086",
            },
            agent_id="agent-x",
        )
        assert result["ok"] is False
        assert result["code"] == "TOOL_NOT_FOUND"
        assert "mcp__nope__nope" in result["error"]

    asyncio.run(run())


def test_a2ui_run_execute_invalid_args(redis):
    """入参非法（Pydantic 校验失败）→ TOOL_ARGS_INVALID 明确 error。"""

    async def run():
        class _StrictInput(BaseModel):
            name: str

        class _StrictTool(BaseTool):
            name = "strict_tool"
            description = "strict"
            input_model = _StrictInput

            async def execute(
                self, arguments: BaseModel, context: ToolExecutionContext
            ) -> ToolResult:
                return ToolResult(output="ok")

        registry = ToolRegistry()
        registry.register(_StrictTool())
        loop = _make_loop(redis, registry=registry)
        # name 缺失 → Pydantic ValidationError → TOOL_ARGS_INVALID
        result = await loop._execute_tool("strict_tool", {}, "sess-args")
        assert result["ok"] is False
        assert result["code"] == "TOOL_ARGS_INVALID"
        assert "strict_tool" in result["error"]

    asyncio.run(run())


def test_a2ui_run_execute_tool_exception_captured(redis):
    """工具执行抛异常 → TOOL_EXEC_ERROR 明确 error（不中断循环）。"""

    async def run():
        class _BoomTool(BaseTool):
            name = "boom"
            description = "boom"
            input_model = _FakeSkillInput

            async def execute(
                self, arguments: BaseModel, context: ToolExecutionContext
            ) -> ToolResult:
                raise RuntimeError("boom inside tool")

        registry = ToolRegistry()
        registry.register(_BoomTool())
        loop = _make_loop(redis, registry=registry)
        result = await loop._execute_tool("boom", {"name": "x"}, "sess-boom")
        assert result["ok"] is False
        assert result["code"] == "TOOL_EXEC_ERROR"
        assert "boom inside tool" in result["error"]

    asyncio.run(run())


def test_a2ui_run_loop_end_to_end_skill_tool(redis):
    """整循环：LLM 先调 skill 工具（真实分发）再输出文本 → tool.call/result/text/done。"""

    async def run():
        registry = ToolRegistry()
        registry.register(_FakeSkillTool())
        gateway = _FakeGateway(
            [
                LLMResponse(
                    content="",
                    tool_calls=[
                        {
                            "id": "tc-skill",
                            "type": "function",
                            "function": {
                                "name": "skill",
                                "arguments": '{"name":"member.profile"}',
                            },
                        }
                    ],
                    finish_reason="tool_calls",
                ),
                LLMResponse(content="已查询会员资料", finish_reason="stop"),
            ]
        )
        publisher = A2uiOutboundPublisher(redis)
        loop = A2uiRunLoop(
            gateway,
            publisher,
            model="test-model",
            session_manager=_FakeSessionManager(),
            tool_registry=registry,
        )
        await loop.run(
            session_id="sess-e2e-skill",
            user_id="u1",
            trace_id="t1",
            mis_user_id=10086,
            run_agent_input={
                "messages": [{"role": "user", "content": "查会员资料"}],
                "tools": [
                    {
                        "name": "render_a2ui",
                        "description": "render",
                        "parameters": {"type": "object", "properties": {}},
                    },
                    {
                        "name": "skill",
                        "description": "skill",
                        "parameters": {"type": "object", "properties": {}},
                    },
                ],
            },
        )
        events = await _stream_events(redis, "sess-e2e-skill")
        assert [e["type"] for e in events] == [
            "tool.call",
            "tool.result",
            "text.delta",
            "done",
        ]
        assert events[0]["tool_name"] == "skill"
        assert events[1]["tool_name"] == "skill"
        assert events[1]["result"]["ok"] is True
        assert events[1]["result"]["output"] == "executed:member.profile"
        assert events[2]["content"] == "已查询会员资料"

    asyncio.run(run())


def test_a2ui_run_lazy_registry_assembly(monkeypatch, redis):
    """未注入注册表时按 Agent 配置懒装配（复用 create_platform_tool_registry）。"""

    async def run():
        import src.agent.manager as am
        import src.runtime.oh_runtime_builder as orb
        import src.runtime.tool_registry_builder as trb

        class _FakeConfig:
            agent_id = "agent-x"
            role = None
            runtime = None
            skills = []

        class _FakeAgentInstance:
            config = _FakeConfig()

        class _FakeManager:
            def get_agent(self, agent_id: str) -> Any:
                return _FakeAgentInstance()

        async def _raise_connect(config: Any) -> Any:
            raise RuntimeError("mcp unavailable")

        built: dict[str, Any] = {}

        def fake_create(
            mcp_manager: Any,
            *,
            allowed_tools: list[str],
            role: Any,
            agent_id: str,
            allowed_skill_ids: list[str],
        ) -> ToolRegistry:
            built["agent_id"] = agent_id
            built["allowed_skill_ids"] = allowed_skill_ids
            registry = ToolRegistry()
            registry.register(_FakeSkillTool())
            return registry

        monkeypatch.setattr(am, "get_agent_manager", lambda: _FakeManager())
        monkeypatch.setattr(orb, "connect_mcp_manager", _raise_connect)
        monkeypatch.setattr(orb, "enabled_package_skill_ids", lambda config: [])
        monkeypatch.setattr(trb, "create_platform_tool_registry", fake_create)

        loop = _make_loop(redis, registry=None)
        assert loop._tool_registry is None
        result = await loop._execute_tool(
            "skill",
            {"name": "member.profile"},
            "sess-lazy",
            identity={
                "userId": "u1",
                "userMobile": "",
                "channel": "h5",
                "channelUserId": "",
                "misUserId": "10086",
            },
            agent_id="agent-x",
        )
        assert result["ok"] is True
        assert result["output"] == "executed:member.profile"
        assert built["agent_id"] == "agent-x"
        assert loop._tool_registry is not None  # 已缓存

    asyncio.run(run())


# ============================================================================
# 5. inbound_worker a2ui_run 分支
# ============================================================================


def test_inbound_worker_forwards_a2ui_run_before_empty_check(monkeypatch):
    """a2ui_run 分支在空消息检查之前触发（a2ui_action 续跑 content 可能为空）。"""

    async def run():
        worker = InboundStreamWorker()
        calls: list[tuple[str, str]] = []

        async def fake_process(inbound: Any, stream_key: str) -> None:
            calls.append((inbound.message_type, stream_key))

        monkeypatch.setattr(worker, "_process_a2ui_run", fake_process)
        inbound = InboundStreamMessage(
            id="1",
            session_id="s",
            user_id="u",
            channel="h5",
            content="",
            message_type="a2ui_run",
            trace_id="t",
            timestamp="",
        )
        await worker._process_inbound(inbound, "aip:stream:inbound:h5")
        assert calls == [("a2ui_run", "aip:stream:inbound:h5")]

    asyncio.run(run())


def test_inbound_worker_process_a2ui_run(monkeypatch):
    """_process_a2ui_run 解析 metadata.a2ui.runAgentInput 并驱动循环。"""

    async def run():
        worker = InboundStreamWorker()
        captured: dict[str, Any] = {}

        class _FakeLoop:
            def __init__(self, gateway: Any, publisher: Any) -> None:
                self.gateway = gateway
                self.publisher = publisher

            async def run(self, **kwargs: Any) -> None:
                captured.update(kwargs)

        import src.queue.inbound_worker as iw

        monkeypatch.setattr(iw, "A2uiRunLoop", _FakeLoop)
        fake_redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        worker._redis = fake_redis  # 直接注入，绕过 _get_redis 真实连接

        inbound = InboundStreamMessage(
            id="1",
            session_id="sess-3",
            user_id="u1",
            channel="h5",
            content="hello",
            message_type="a2ui_run",
            trace_id="t1",
            timestamp="2026-01-01T00:00:00Z",
            metadata={
                "a2ui": {
                    "runId": "r1",
                    "catalogId": "mis-a2ui-catalog-v1",
                    "runAgentInput": {
                        "messages": [{"role": "user", "content": "hi"}],
                        "tools": [],
                    },
                }
            },
        )
        await worker._process_a2ui_run(inbound, "aip:stream:inbound:h5")
        assert captured["session_id"] == "sess-3"
        assert captured["user_id"] == "u1"
        assert captured["trace_id"] == "t1"
        assert captured["run_agent_input"]["messages"][0]["content"] == "hi"

    asyncio.run(run())


def test_inbound_worker_process_a2ui_run_missing_input_no_crash(monkeypatch):
    """metadata.a2ui.runAgentInput 缺失 → 告警返回，不发布任何事件。"""

    async def run():
        worker = InboundStreamWorker()
        fake_redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        worker._redis = fake_redis

        inbound = InboundStreamMessage(
            id="1",
            session_id="sess-4",
            user_id="u1",
            channel="h5",
            content="",
            message_type="a2ui_run",
            trace_id="t1",
            timestamp="",
            metadata={},
        )
        # 不应抛异常
        await worker._process_a2ui_run(inbound, "aip:stream:inbound:h5")
        assert await fake_redis.xlen(a2ui_outbound_key("sess-4")) == 0

    asyncio.run(run())
