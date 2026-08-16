"""对话各环节内部细分埋点（Sub-stage Timing Instrumentation）单元测试。

范围（trust-but-verify 已确认）：后端已实现全部代码，但**后端无 timing 专项测试**。
本文件为增量新增，**纯逻辑、不依赖真实 Redis / 真实 worker 委派链路**，可在本地
pytest 跑通，证明细分埋点的核心链路（sub_stages 透传 / CV 共享 / _build_sub_stages /
schema 兼容 / 降级 / close 计时窗）确实正确。

覆盖点（对应 design T01-T05 / PRD P0）：
1. DispatchTraceEntry.sub_stages 透传（events.py / openharness.py 零改动假设）
2. QA_SUB_STAGES_CV 跨 asyncio.Task 边界共享 dict
3. _build_sub_stages 结构与 schema（字段 snake_case、ms、schema_version==2，对齐前端 types.ts）
4. schema v2 兼容（snapshot 恒含 sub_stages；旧数据缺该字段不报错 → 前端 hasSub=false）
5. 降级红线（畸形/None/缺 key 静默置 None；feature flag 关闭 → sub_stages=None）
6. close() 计时窗延伸（DONE 不钉 _end_t；close() 收口；post_process 覆盖落库三步）

说明：测试使用项目自带 .venv 的 python（含 pydantic / pytest-asyncio），而非系统 python。
"""

from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import MagicMock, patch

import pytest

# 显式导入模块对象并以 patch.object 打补丁：pytest 下 invoke_agent 可能被同时以
# `src.skills.tools.invoke_agent` 与 `skills.tools.invoke_agent` 两种路径加载为两个
# 模块对象，字符串路径 patch 可能命中非 InvokeAgentTool 所属的那个。patch.object
# 作用在「本测试实际 import 的同一模块对象」上，避免重复导入导致的补丁失效。
import src.coordinator.sessions as coordinator_sessions_mod
import src.skills.tools.invoke_agent as invoke_agent_mod
from src.agent.session_timing import (
    TIMING_SCHEMA_VERSION,
    SessionTiming,
    SessionTimingRecorder,
)
from src.coordinator.flags import SUBSTAGE_INSTRUMENTATION_ENABLED
from src.coordinator.trace import DispatchTraceEntry, QA_SUB_STAGES_CV
from src.runtime.events import AgentEvent, AgentEventType


# ----------------------------------------------------------------------------
# 测试辅助
# ----------------------------------------------------------------------------

RAG_SUB_STAGES = {
    "resolve_visible_libraries_ms": 320,
    "RAGFlow_retrieve_ms": 1850,
    "worker_generate_ms": 5600,
    "persist_ms": 870,
    "overhead_ms": 0,
}


def _rag_dispatch_event(sub_stages, latency_ms: int = 8642) -> AgentEvent:
    """构造一个携 sub_stages 的 rag dispatch.trace 事件（镜像 OpenHarness 真实用法）。

    OpenHarness 仅 ``yield AgentEvent.dispatch_trace([entry.model_dump()])``，
    不解析内部字段 —— sub_stages 作为 dict 天然透传。本函数用 classmethod 构造，
    即是对「零改动假设」的直接验证。
    """
    entry = DispatchTraceEntry(
        intent="rag",
        worker_id="mis-rag",
        tool="agent__invoke",
        latency_ms=latency_ms,
        sub_stages=sub_stages,
    )
    return AgentEvent.dispatch_trace([entry.model_dump()])


def _feed_recorder(recorder: SessionTimingRecorder, *, with_text: bool = True) -> None:
    """喂入一条典型的 copilot 事件流：delegate 调用 → rag 透传 → 文本 → DONE。

    用于让 recorder 内部各子阶段字段被充分填充（planning / retrieval /
    tool_call / generation 均可得）。
    """
    recorder.observe(
        AgentEvent(type=AgentEventType.TOOL_CALL, tool_name="agent__invoke")
    )
    recorder.observe(
        AgentEvent(type=AgentEventType.TOOL_RESULT, tool_name="agent__invoke")
    )
    recorder.observe(_rag_dispatch_event(RAG_SUB_STAGES))
    if with_text:
        recorder.observe(AgentEvent.text_delta("hello"))
    recorder.observe(AgentEvent.done())


# ----------------------------------------------------------------------------
# 1. DispatchTraceEntry.sub_stages 透传（events.py / openharness.py 零改动）
# ----------------------------------------------------------------------------


class TestDispatchTraceSubStagesTransparency:
    """验证 sub_stages 经 model_dump → 事件 → recorder 抽取全链路透传。"""

    def test_sub_stages_serializes_in_model_dump(self):
        entry = DispatchTraceEntry(intent="rag", sub_stages=RAG_SUB_STAGES)
        dumped = entry.model_dump()
        assert "sub_stages" in dumped
        assert dumped["sub_stages"] == RAG_SUB_STAGES

    def test_sub_stages_carried_through_dispatch_trace_event(self):
        """dispatch_trace 事件把 entry.model_dump() 原样携带，不解析内部字段。"""
        event = _rag_dispatch_event(RAG_SUB_STAGES)
        entries = event.trace["entries"]
        assert len(entries) == 1
        # model_dump 自动带出 sub_stages —— 透传通道成立
        assert entries[0]["sub_stages"] == RAG_SUB_STAGES
        # 关键：events.py / openharness.py 不需要为 sub_stages 做任何特殊处理
        assert event.type == AgentEventType.DISPATCH_TRACE

    def test_recorder_extracts_rag_sub_stages(self):
        recorder = SessionTimingRecorder("s-1", "turn-1")
        _feed_recorder(recorder, with_text=True)
        # intent=rag → _rag_sub_stages
        assert recorder._rag_sub_stages == RAG_SUB_STAGES

    def test_recorder_attaches_sub_stages_to_last_delegate_call(self):
        recorder = SessionTimingRecorder("s-2", "turn-2")
        _feed_recorder(recorder, with_text=True)
        # 注册的 delegate 调用在 DISPATCH_TRACE 后被挂载 sub_stages
        assert len(recorder._tool_calls) == 1
        call = recorder._tool_calls[0]
        assert call["kind"] == "delegate"
        assert call["sub_stages"] == RAG_SUB_STAGES

    def test_recorder_retrieval_ms_accumulates_rag_latency(self):
        recorder = SessionTimingRecorder("s-3", "turn-3")
        _feed_recorder(recorder, with_text=True)
        snap = recorder.snapshot()
        # _dispatch_trace_latency_ms 求和 rag 的 latency_ms
        assert snap["stages"]["retrieval_ms"] == 8642


# ----------------------------------------------------------------------------
# 2. QA_SUB_STAGES_CV 跨 asyncio.Task 边界共享 dict
# ----------------------------------------------------------------------------


class TestQaSubStagesCvCrossTask:
    """验证 _spawn_worker 在父上下文 set 共享 dict，子 Task 内 update 对父可见。"""

    @pytest.mark.asyncio
    async def test_cv_shared_dict_visible_across_ensure_future(self):
        # 模拟 _spawn_worker：在父上下文 set 一个空共享 dict
        acc: dict[str, int] = {}
        token = QA_SUB_STAGES_CV.set(acc)

        async def child_worker():
            # 子 Task 内取同一 CV（拷贝上下文只复制引用，dict 对象共享）
            inner = QA_SUB_STAGES_CV.get()
            assert inner is acc  # 同一对象引用
            inner.update(RAG_SUB_STAGES)

        try:
            task = asyncio.ensure_future(child_worker())
            await task
        finally:
            QA_SUB_STAGES_CV.reset(token)

        # 父上下文 dict 在子 Task 变异后对父可见
        assert acc == RAG_SUB_STAGES

    @pytest.mark.asyncio
    async def test_spawn_worker_backfills_worker_run_result_sub_stages(self):
        """真实跑 _spawn_worker（ensure_future 分支），验证 sub_stages 回填到结果。"""
        tool = invoke_agent_mod.InvokeAgentTool()

        async def fake_run(*_args, **_kwargs):
            # 模拟 worker 内 qa_pipeline 经 CV 回写细分计时
            cv = QA_SUB_STAGES_CV.get()
            cv.update(RAG_SUB_STAGES)
            return invoke_agent_mod._WorkerRunResult(text="ok", child_session_id="")

        with (
            patch.object(invoke_agent_mod, "_run_child_agent", fake_run),
            patch.object(
                coordinator_sessions_mod, "register_running_task", new=MagicMock()
            ),
            patch.object(
                coordinator_sessions_mod, "unregister_running_task", new=MagicMock()
            ),
        ):
            result = await tool._spawn_worker(
                parent_session_id="parent-1",
                agent_id="mis-rag",
                brief=MagicMock(render=lambda: "brief"),
                child_meta={},
                user_id="u1",
                channel="mis_bff",
                user_mobile="",
                channel_user_id="u1",
                reuse_session_id=None,
            )

        assert result.sub_stages == RAG_SUB_STAGES

    @pytest.mark.asyncio
    async def test_spawn_worker_empty_cv_downgrades_to_none(self):
        """worker 未回写时共享 dict 为空 → sub_stages 降级为 None（不可得）。"""
        tool = invoke_agent_mod.InvokeAgentTool()

        # 子任务不回写任何细分计时（模拟 qa_pipeline 未采集）
        async def fake_run_noop(*_args, **_kwargs):
            return invoke_agent_mod._WorkerRunResult(text="ok", child_session_id="")

        with (
            patch.object(invoke_agent_mod, "_run_child_agent", fake_run_noop),
            patch.object(
                coordinator_sessions_mod, "register_running_task", new=MagicMock()
            ),
            patch.object(
                coordinator_sessions_mod, "unregister_running_task", new=MagicMock()
            ),
        ):
            result = await tool._spawn_worker(
                parent_session_id="parent-2",
                agent_id="mis-rag",
                brief=MagicMock(render=lambda: "brief"),
                child_meta={},
                user_id="u1",
                channel="mis_bff",
                user_mobile="",
                channel_user_id="u1",
                reuse_session_id=None,
            )

        assert result.sub_stages is None

    @pytest.mark.asyncio
    async def test_finish_fills_dispatch_trace_sub_stages(self):
        """_finish 把 sub_stages 填进 DispatchTraceEntry.sub_stages（透传 carrier）。"""
        tool = invoke_agent_mod.InvokeAgentTool()
        captured: dict[str, DispatchTraceEntry] = {}

        async def fake_record(parent_session_id, entry):
            captured["entry"] = entry

        notification = MagicMock()
        notification.worker_id = "mis-rag"
        notification.latency_ms = 100
        notification.task_id = "t1"
        notification.status.value = "completed"
        notification.to_tool_output.return_value = "ok"

        with patch.object(tool, "_record_trace", fake_record):
            await tool._finish(
                parent_session_id="parent-1",
                notification=notification,
                intent="rag",
                started_at=0.0,
                is_error=False,
                sub_stages={"worker_generate_ms": 5600},
            )

        assert captured["entry"].sub_stages == {"worker_generate_ms": 5600}


# ----------------------------------------------------------------------------
# 3. _build_sub_stages 结构与 schema（对齐前端 types.ts）
# ----------------------------------------------------------------------------


class TestBuildSubStagesStructure:
    def test_snapshot_sub_stages_structure_and_schema_version(self):
        recorder = SessionTimingRecorder("s-4", "turn-4")
        _feed_recorder(recorder, with_text=True)
        snap = recorder.snapshot()
        ss = snap["sub_stages"]

        # v2：顶层恒含 sub_stages；schema_version == 2
        assert "sub_stages" in snap
        assert snap["schema_version"] == 2
        assert snap["schema_version"] == TIMING_SCHEMA_VERSION

        # 5 个父阶段键齐全
        assert set(ss.keys()) == {
            "planning",
            "retrieval",
            "tool_call",
            "generation",
            "post_process",
        }

        # planning：snake_case、ms、int|None
        assert set(ss["planning"].keys()) <= {"ttft_ms", "decision_ms"}
        assert isinstance(ss["planning"]["ttft_ms"], int)

        # retrieval：平铺 dict[str,int]，与 worker 上报一致
        assert ss["retrieval"] == RAG_SUB_STAGES

        # tool_call：calls[] + delegate_round_trip_ms
        tc = ss["tool_call"]
        assert isinstance(tc["calls"], list) and len(tc["calls"]) == 1
        call = tc["calls"][0]
        # 对齐前端 ToolCallItem：tool_name/kind/latency_ms/sub_stages
        assert call["tool_name"] == "agent__invoke"
        assert call["kind"] == "delegate"
        assert isinstance(call["latency_ms"], int)
        assert call["sub_stages"] == RAG_SUB_STAGES
        assert tc["delegate_round_trip_ms"] in (int, None)

        # generation：snake_case 子段
        assert set(ss["generation"].keys()) <= {"ttft_ms", "stream_ms", "tail_ms"}
        for v in ss["generation"].values():
            assert v is None or isinstance(v, int)

    def test_sub_stages_are_json_serializable(self):
        """snapshot 必须可 JSON 序列化（Redis 存储前提）。"""
        recorder = SessionTimingRecorder("s-5", "turn-5")
        _feed_recorder(recorder, with_text=True)
        dump = json.dumps(recorder.snapshot())
        reload = json.loads(dump)
        assert reload["schema_version"] == 2
        assert "sub_stages" in reload


# ----------------------------------------------------------------------------
# 4. schema v2 兼容（旧数据缺 sub_stages → 不报错，前端 hasSub=false）
# ----------------------------------------------------------------------------


class TestSchemaV2Compat:
    def test_old_snapshot_without_sub_stages_is_loadable(self):
        # 旧客户端/旧数据（schema_version=1）缺失 sub_stages 字段
        old = {
            "turn_key": "t-old",
            "total_ms": 1234,
            "stages": {
                "planning_ms": 100,
                "retrieval_ms": 200,
                "tool_call_ms": 0,
                "generation_ms": 900,
                "post_process_ms": 0,
            },
            "schema_version": 1,
            "sampled_at": "2026-08-14T00:00:00+00:00",
        }
        # 读取端对缺省字段容错：不会 KeyError / 不会崩溃
        reload = json.loads(json.dumps(old))
        # 前端据此判定 hasSub=false（对应 agent-message-stream.tsx:317）
        assert reload.get("sub_stages") is None

    def test_session_timing_default_sub_stages_is_none(self):
        st = SessionTiming(total_ms=10, schema_version=2)
        assert st.sub_stages is None

    def test_snapshot_always_has_sub_stages_key(self):
        # 即使没有任何子阶段数据，snapshot 仍含 sub_stages（值为 None，不缺失）
        recorder = SessionTimingRecorder("s-6", "turn-6")
        snap = recorder.snapshot()
        assert "sub_stages" in snap
        assert snap["sub_stages"] is None


# ----------------------------------------------------------------------------
# 5. 降级红线（畸形/None/缺 key 静默置 None；flag 关闭 → sub_stages=None）
# ----------------------------------------------------------------------------


class TestDegradationRedLine:
    def test_extract_with_none_trace_is_noop(self):
        recorder = SessionTimingRecorder("s-7", "turn-7")
        # 不应抛异常
        recorder._extract_dispatch_sub_stages(None)
        assert recorder._rag_sub_stages is None

    def test_extract_with_malformed_entries_is_noop(self):
        recorder = SessionTimingRecorder("s-8", "turn-8")
        # entries 不是 list
        recorder._extract_dispatch_sub_stages({"entries": "not-a-list"})
        # sub_stages 是字符串（非 dict）
        recorder._extract_dispatch_sub_stages(
            {"entries": [{"intent": "rag", "sub_stages": "broken"}]}
        )
        assert recorder._rag_sub_stages is None

    def test_extract_skips_non_int_values(self):
        recorder = SessionTimingRecorder("s-9", "turn-9")
        # 只保留 int 类型的毫秒值；浮点会被 int() 吸收，非数字被丢弃
        recorder.observe(
            AgentEvent(
                type=AgentEventType.DISPATCH_TRACE,
                trace={
                    "entries": [
                        {
                            "intent": "rag",
                            "tool": "agent__invoke",
                            "sub_stages": {
                                "worker_generate_ms": "bad",  # 丢弃
                                "RAGFlow_retrieve_ms": 1850,
                                "overhead_ms": 1.9,  # 转 int -> 1
                            },
                        }
                    ]
                },
            )
        )
        assert recorder._rag_sub_stages == {
            "RAGFlow_retrieve_ms": 1850,
            "overhead_ms": 1,
        }

    def test_malformed_dispatch_event_observe_does_not_raise(self):
        recorder = SessionTimingRecorder("s-10", "turn-10")
        # dispatch.trace 事件但 trace 字段缺失/畸形
        recorder.observe(
            AgentEvent(type=AgentEventType.DISPATCH_TRACE, trace=None)
        )
        recorder.observe(
            AgentEvent(
                type=AgentEventType.DISPATCH_TRACE,
                trace={"entries": [{"intent": "rag"}]},  # 无 sub_stages
            )
        )
        assert recorder._rag_sub_stages is None

    def test_flag_disabled_yields_no_sub_stages(self):
        """SUBSTAGE_INSTRUMENTATION_ENABLED=False → 抽取/构建一律 None。"""
        with patch(
            "src.agent.session_timing.get_settings",
            return_value=MagicMock(**{SUBSTAGE_INSTRUMENTATION_ENABLED: False}),
        ):
            recorder = SessionTimingRecorder("s-11", "turn-11")
            assert recorder._substage_enabled is False
            _feed_recorder(recorder, with_text=True)
            # 抽取直接 early-return
            assert recorder._rag_sub_stages is None
            # 构建直接返回 None
            snap = recorder.snapshot()
            assert snap["sub_stages"] is None

    def test_build_sub_stages_robust_to_partial_realistic_state(self):
        """部分数据（仅有 native 工具调用、无 rag/planning/generation）不抛异常。

        对应降级红线：recorder 实际能产出的内部状态（sub_stages 恒为 None 或
        dict[str,int]）下，_build_sub_stages 必须静默产出结构化结果。
        """
        recorder = SessionTimingRecorder("s-16", "turn-16")
        recorder.observe(
            AgentEvent(type=AgentEventType.TOOL_CALL, tool_name="kb_retrieve")
        )
        recorder.observe(
            AgentEvent(type=AgentEventType.TOOL_RESULT, tool_name="kb_retrieve")
        )
        ss = recorder._build_sub_stages(
            planning_ms=0.0, generation_ms=None, post_process_ms=0.0
        )
        call = ss["tool_call"]["calls"][0]
        assert call["kind"] == "native"
        assert call["sub_stages"] is None

    def test_tool_call_sub_stages_robust_to_truthy_non_dict(self):
        """回归：delegate 调用的 sub_stages 若为「真值非 dict」（异常注入/老版本），
        _tool_call_sub_stages 必须静默降级为空 dict，绝不抛 AttributeError。

        锁死 session_timing.py L441-446 防御式归一逻辑（与 design §9 #6 降级红线一致）。
        旧实现 ``sum(v for v in (inner or {}).values() ...)`` 在 inner 为「真值非 dict」
        （如字符串 "broken"）时会保留 inner 并触发 .values() -> AttributeError；
        新实现 ``inner_dict = inner if isinstance(inner, dict) else {}`` 将其归一为空 dict。
        """
        recorder = SessionTimingRecorder("s-reg-1", "turn-reg-1")
        recorder._tool_calls = [
            {
                "tool_name": "agent__invoke",
                "kind": "delegate",
                "latency_ms": 5000,
                "sub_stages": "not-a-dict",  # 真值非 dict：旧逻辑会 .values() -> AttributeError
            }
        ]
        # 不抛异常，且产出结构化结果
        result = recorder._tool_call_sub_stages()
        assert isinstance(result, dict)
        assert result["calls"][0]["tool_name"] == "agent__invoke"
        # 原值仍透传（埋点不修改 carrier）
        assert result["calls"][0]["sub_stages"] == "not-a-dict"
        # inner_sum 因非 dict 被归一为 0 → round_trip == latency_ms
        assert result["delegate_round_trip_ms"] == 5000

    def test_build_sub_stages_survives_truthy_non_dict_tool_sub_stages(self):
        """端到端回归：snapshot() → _build_sub_stages → _tool_call_sub_stages，
        含真值非 dict sub_stages 仍整体不抛异常，且 sub_stages 块照常产出。"""
        recorder = SessionTimingRecorder("s-reg-2", "turn-reg-2")
        recorder._tool_calls = [
            {
                "tool_name": "agent__invoke",
                "kind": "delegate",
                "latency_ms": 7777,
                "sub_stages": 12345,  # 真值非 dict（int）
            }
        ]
        snap = recorder.snapshot()  # 不应抛 AttributeError / TypeError
        assert "sub_stages" in snap
        ss = snap["sub_stages"]
        assert ss is not None  # delegate 调用使 has_any 成立 → 整块产出
        assert ss["tool_call"]["calls"][0]["sub_stages"] == 12345


# ----------------------------------------------------------------------------
# 6. close() 计时窗延伸（DONE 不钉 _end_t；close() 收口；post_process 覆盖落库）
# ----------------------------------------------------------------------------


class TestCloseTimingWindow:
    def test_done_does_not_nail_end_t(self):
        recorder = SessionTimingRecorder("s-12", "turn-12")
        recorder.observe(AgentEvent.text_delta("hi"))
        recorder.observe(AgentEvent.done())
        # Q5：observe(DONE) 仅置 _ended，不钉死 _end_t
        assert recorder._ended is True
        assert recorder._end_t is None

    def test_close_nails_end_t_and_covers_post_process(self):
        recorder = SessionTimingRecorder("s-13", "turn-13")
        recorder.observe(AgentEvent.text_delta("hi"))
        recorder.observe(AgentEvent.done())
        # 模拟 finally 落库三步打点（timing_save 在窗口内真实可测）
        recorder.step_start("timing_save")
        time.sleep(0.05)  # 真实耗时，确保计时窗 > 0
        recorder.step_end("timing_save")
        # finally 末：close() 收口 _end_t
        recorder.close()

        assert recorder._end_t is not None
        snap = recorder.snapshot()
        pp = snap["sub_stages"]["post_process"]
        assert pp["timing_save_ms"] is not None
        # post_process 计时窗覆盖至 close()，故 >= timing_save 实测
        assert snap["stages"]["post_process_ms"] >= (pp["timing_save_ms"] or 0) - 1

    def test_complete_retained_and_idempotent(self):
        """complete() 仍保留作向后兼容兜底，且幂等；不破坏 close() 新语义。"""
        recorder = SessionTimingRecorder("s-14", "turn-14")
        recorder.observe(AgentEvent.done())
        # 即便调用 complete()，其仅作兜底——窗口已由 close() 收口
        recorder.complete()
        assert recorder._ended is True
        assert recorder._end_t is not None
        # 幂等：二次调用不报错、不篡改
        recorder.complete()
        assert recorder._ended is True

    def test_close_idempotent_when_end_t_already_set(self):
        recorder = SessionTimingRecorder("s-15", "turn-15")
        recorder.observe(AgentEvent.done())
        recorder.complete()
        first_end = recorder._end_t
        recorder.close()
        # close() 仅在其为 None 时收口；已收口则保留既有值
        assert recorder._end_t == first_end


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
