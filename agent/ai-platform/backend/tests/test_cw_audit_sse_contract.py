"""QA2 对抗性审计 — P0 兼容红线：SSE `done` 帧与 AgentEvent 协议的只增不改。

审计目标（team-lead P0 #1 / #4）：
1. **默认配置下 `done` 帧逐字节一致**：不是"出现但值为 null / 空数组"，而是
   `dispatchTrace` 键**根本不出现**。测试直接对 SSE 原始文本做子串断言 +
   对解析后的 done payload 做**键集合全等**断言（而非 `in` 弱断言）。
2. **即便本轮真的产生了委派轨迹**（`_last_turn` 有快照），开关关闭时仍必须不出现。
   这是最强形式——只测"没有 trace 时不出现"是假绿。
3. 开关打开且有轨迹时 → 键出现且结构正确（证明测试本身不是恒真）。
4. `AgentEventType` 只增不改：既有 7 个取值的字面量逐一锁死；
   `AgentEvent` 只增可选字段：既有工厂方法构造 + 生产序列化路径
   （`exclude_none=True`）输出不含 `trace`。

设计说明：本文件不 mock `dispatch_trace_sse_enabled`，而是改真实 `Settings`
字段并清 `get_settings` 缓存，走 `flags.bool_flag` 真实读取路径——避免
"把被测逻辑 mock 掉"的假绿。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.config import Settings, get_settings  # noqa: E402
from src.runtime.events import AgentEvent, AgentEventType  # noqa: E402

_KEYS = Path("d:/code/mis-platform/backend/keys")
REAL_PRIVATE_PEM = (_KEYS / "private.pem").read_text()
REAL_PUBLIC_PEM = (_KEYS / "public.pem").read_text()

SESSION_ID = "sess-qa2-sse-001"

# 改动前（C1~C5 之前）done 帧的**完整**键集合，来自 mis_capability.py 历史实现。
LEGACY_DONE_KEYS = {"traceId", "finishReason", "sessionId"}


def _sign() -> str:
    return jwt.encode(
        {
            "sub": "42",
            "employeeId": 2001,
            "tenantId": 10,
            "appId": 20,
            "username": "zhangsan",
            "roles": ["hr"],
            "permVersion": "v1",
        },
        REAL_PRIVATE_PEM,
        algorithm="RS256",
    )


def _mis_settings(**overrides: object) -> Settings:
    s = Settings()
    s.MIS_JWT_PUBLIC_KEY_PEM = REAL_PUBLIC_PEM
    s.MIS_JWT_PUBLIC_KEY_PATH = ""
    s.MIS_JWT_ISSUER = "mis-platform"
    s.MIS_JWT_ALGORITHM = "RS256"
    for key, value in overrides.items():
        setattr(s, key, value)
    return s


def _parse_frames(text: str) -> list[dict]:
    frames: list[dict] = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event, data_lines = None, []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].strip())
        if event is None or not data_lines:
            continue
        frames.append({"event": event, "data": json.loads("\n".join(data_lines))})
    return frames


def _post_stream(settings: Settings) -> str:
    """驱动真实 SSE 端点，仅打桩 session/agent manager，**保留真实 done 帧组装逻辑**。

    `trace.dispatch_trace_sse_enabled()` 内部是函数级懒导入
    `from src.config import get_settings`，因此 patch 源模块属性即可命中
    真实 `flags.bool_flag` 读取路径（不 mock 被测逻辑本身）。
    """
    from fastapi.testclient import TestClient

    from src.api.routes import mis_capability as mc
    from src.main import app

    fake_session = MagicMock()
    fake_session.session_id = SESSION_ID
    session_mgr = MagicMock()
    session_mgr.create_session = AsyncMock(return_value=fake_session)
    session_mgr.add_message = AsyncMock()

    async def fake_process_message(session, message):
        yield AgentEvent.text_delta("好的")

    instance = MagicMock()
    instance.process_message = fake_process_message
    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=instance)

    with patch.object(mc, "get_session_manager", return_value=session_mgr), patch.object(
        mc, "get_agent_manager", return_value=agent_mgr
    ), patch("src.api.deps.get_settings", return_value=settings), patch(
        "src.config.get_settings", return_value=settings
    ):
        client = TestClient(app)
        resp = client.post(
            f"/api/v1/agents/mis-copilot/chat/stream",
            headers={"Authorization": f"Bearer {_sign()}", "X-Trace-Id": "t-qa2-1"},
            json={"content": "你好", "role": "user", "metadata": {"capability": "chat"}},
        )
        assert resp.status_code == 200, resp.text
        return resp.text


@pytest.fixture(autouse=True)
def _clean_trace_buffers():
    """每例前后清空 dispatch_trace 全局缓冲，杜绝跨用例串味（审计项 P1 #13）。"""
    from src.coordinator import trace as trace_mod

    trace_mod._reset_for_test()
    get_settings.cache_clear()
    yield
    trace_mod._reset_for_test()
    get_settings.cache_clear()


class TestSseDoneFrameByteIdentical:
    """P0 #1：默认开关下 done 帧与改动前逐字节一致。"""

    def test_default_done_frame_has_no_dispatch_trace_key_even_when_traces_exist(self):
        """**最强形式**：本轮真的产生了轨迹快照，默认开关下 done 帧仍不得出现该键。"""
        import asyncio

        from src.coordinator.trace import DispatchTraceEntry, drain_dispatch_traces, push_dispatch_trace

        # 制造真实轨迹快照：push → drain（drain 会把快照写进 _last_turn）
        async def _seed():
            await push_dispatch_trace(
                SESSION_ID,
                DispatchTraceEntry(
                    intent="rag", worker_id="mis-rag", status="completed", latency_ms=12
                ),
            )
            await drain_dispatch_traces(SESSION_ID)

        asyncio.run(_seed())

        from src.coordinator.trace import _last_turn

        assert _last_turn.get(SESSION_ID), "前置条件失败：应已存在本轮轨迹快照"

        text = _post_stream(_mis_settings())  # DISPATCH_TRACE_SSE_ENABLED 默认 False

        # ① 原始字节层面：整个 SSE 响应中不得出现 dispatchTrace 字样
        assert "dispatchTrace" not in text, (
            f"默认开关下 SSE 文本仍出现 dispatchTrace：\n{text}"
        )

        # ② 键集合全等（不是 `in`）：证明既不是 null 也不是空数组，而是键不存在
        done = [f for f in _parse_frames(text) if f["event"] == "done"][0]
        assert set(done["data"].keys()) == LEGACY_DONE_KEYS, (
            f"done 帧键集合与改动前不一致：{sorted(done['data'].keys())}"
        )

        # ③ 逐字节：done 帧文本必须与历史格式完全一致
        expected = (
            "event: done\n"
            + "data: "
            + json.dumps(
                {"traceId": "t-qa2-1", "finishReason": "stop", "sessionId": SESSION_ID},
                ensure_ascii=False,
            )
            + "\n\n"
        )
        assert expected in text, f"done 帧非逐字节一致。\n期望片段：{expected!r}\n实际：{text!r}"

    def test_default_done_frame_no_key_when_no_traces(self):
        """无轨迹时同样不得出现（基线对照）。"""
        text = _post_stream(_mis_settings())
        assert "dispatchTrace" not in text
        done = [f for f in _parse_frames(text) if f["event"] == "done"][0]
        assert set(done["data"].keys()) == LEGACY_DONE_KEYS

    def test_flag_on_with_traces_emits_dispatch_trace(self):
        """反向用例：开关打开且有轨迹 → 键出现。证明上面的断言不是恒真（防假绿）。"""
        import asyncio

        from src.coordinator.trace import DispatchTraceEntry, drain_dispatch_traces, push_dispatch_trace

        async def _seed():
            await push_dispatch_trace(
                SESSION_ID,
                DispatchTraceEntry(
                    intent="crm", worker_id="crm-assistant", status="completed", latency_ms=34
                ),
            )
            await drain_dispatch_traces(SESSION_ID)

        asyncio.run(_seed())

        text = _post_stream(_mis_settings(DISPATCH_TRACE_SSE_ENABLED=True))
        done = [f for f in _parse_frames(text) if f["event"] == "done"][0]
        assert "dispatchTrace" in done["data"], f"开关打开却未附加轨迹：{done}"
        assert set(done["data"].keys()) == LEGACY_DONE_KEYS | {"dispatchTrace"}
        entries = done["data"]["dispatchTrace"]
        assert isinstance(entries, list) and entries
        assert entries[0]["worker_id"] == "crm-assistant"
        assert entries[0]["intent"] == "crm"

    def test_flag_on_without_traces_still_omits_key(self):
        """开关打开但本轮无轨迹 → 仍不得出现空数组（spec：`if dispatch_trace:` 守卫）。"""
        text = _post_stream(_mis_settings(DISPATCH_TRACE_SSE_ENABLED=True))
        assert "dispatchTrace" not in text
        done = [f for f in _parse_frames(text) if f["event"] == "done"][0]
        assert set(done["data"].keys()) == LEGACY_DONE_KEYS


class TestAgentEventOnlyAppend:
    """P0 #4：AgentEventType 只增不改 / AgentEvent 只增可选字段。"""

    def test_existing_event_type_values_frozen(self):
        """既有 7 个事件类型的**字面量取值**逐一锁死（Gateway/BFF/前端映射依赖）。"""
        frozen = {
            "TEXT_DELTA": "text.delta",
            "TOOL_CALL": "tool.call",
            "TOOL_RESULT": "tool.result",
            "UI_RENDER": "ui.render",
            "APPROVAL_REQUEST": "approval.request",
            "ERROR": "error",
            "DONE": "done",
        }
        for member, value in frozen.items():
            assert hasattr(AgentEventType, member), f"既有事件类型被删除：{member}"
            assert getattr(AgentEventType, member).value == value, (
                f"既有事件类型取值被改：{member} -> {getattr(AgentEventType, member).value}"
            )

    def test_new_event_type_is_appended_at_tail(self):
        """新增 DISPATCH_TRACE 必须追加在末尾，不得插队（保 Enum 迭代顺序稳定）。"""
        names = [m.name for m in AgentEventType]
        assert names[:7] == [
            "TEXT_DELTA",
            "TOOL_CALL",
            "TOOL_RESULT",
            "UI_RENDER",
            "APPROVAL_REQUEST",
            "ERROR",
            "DONE",
        ], f"既有事件顺序被破坏：{names}"
        assert names[7:] == ["DISPATCH_TRACE"], f"末尾新增项异常：{names[7:]}"
        assert AgentEventType.DISPATCH_TRACE.value == "dispatch.trace"

    @pytest.mark.parametrize(
        "factory,kwargs",
        [
            ("text_delta", {"content": "x"}),
            ("tool_call", {"tool_name": "t", "args": {}}),
            ("tool_result", {"tool_name": "t", "result": {}}),
        ],
    )
    def test_legacy_factories_still_construct_without_trace(self, factory, kwargs):
        """既有工厂方法签名未变，且产出的事件 trace 恒为 None。"""
        event = getattr(AgentEvent, factory)(**kwargs)
        assert event.trace is None

    def test_production_serialization_path_unchanged(self):
        """生产序列化路径（redis_stream.py:198 用 exclude_none=True）不含 trace 键。

        注意：裸 `model_dump()` **会**多出 `trace: None` 键——本例锁定的是
        真实上线路径的字节形态，避免用宽松断言掩盖。
        """
        event = AgentEvent.text_delta("hi")
        wire = event.model_dump(mode="json", exclude_none=True)
        assert wire == {"type": "text.delta", "content": "hi"}, wire
        assert "trace" not in wire

    def test_dispatch_trace_event_factory_shape(self):
        """新事件的 trace 结构为 {"entries": [...]}（spec §7.2）。"""
        event = AgentEvent.dispatch_trace([{"worker_id": "mis-rag"}])
        assert event.type == AgentEventType.DISPATCH_TRACE
        assert event.trace == {"entries": [{"worker_id": "mis-rag"}]}
        wire = event.model_dump(mode="json", exclude_none=True)
        assert wire["type"] == "dispatch.trace"
        assert wire["trace"] == {"entries": [{"worker_id": "mis-rag"}]}
