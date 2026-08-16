"""会话各阶段耗时埋点（A-2 / A-3 / A-4，T01）。

在 ``AgentInstance.process_message`` 的事件流外层包裹一个计时器，按 wall-clock 把一轮
对话切分为 5 个阶段，运行完成后把**该轮（按 assistant 消息 id 寻址）**的耗时写入 Redis
（key 见 ``RedisTimingStore``，TTL 24h，仅供调试回放，过期不影响会话本身的持久化内容）。

设计要点（与现状 T04 双写解耦）：
- 会话元数据 / 消息已全部落 PG + Redis 双写，本模块**不改**那套；
- 仅「各步骤执行时间」这类瞬态调试数据存 Redis，TTL 86400；
- 任何异常都静默降级（warning），绝不阻断主对话链路（见 manager.py 的 finally）。

2.1 改造（按轮存储）：
- 旧设计把整轮耗时覆盖写进单个 key（``aip:agent:session:{id}:timing``），
  只能保留「最近一轮」且无法与某条 assistant 消息对应 —— 这正是 2.2「刚写入却显示已过期」
  的根因（session 级单键无法稳定寻址到具体一轮）。
- 新设计以 **turn_key（= assistant 消息 id，最稳定且前端可直接映射）** 为维度，
  把每轮耗时存进 per-session 的 map（``aip:agent:session:{id}:timings``），
  值为 ``{turn_key: timing}``，并维持一个最多 ``TIMING_RING_SIZE`` 条的环形缓冲
  （仅保留最近 N 轮，避免长会话无限膨胀）。写入时刷新 TTL 24h。
- 读取端点返回整个 per-turn map（含兼容字段 ``last`` 指向最近一轮），
  前端按 ``message.id`` 在 map 中查到对应轮的耗时，逐条内联展示。
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis

from src.config import Settings, get_settings
from src.coordinator.flags import substage_instrumentation_enabled
from src.runtime.events import AgentEvent, AgentEventType
from src.utils.logging import get_logger

logger = get_logger("agent.session_timing")

#: 5 阶段枚举（与前端 StageTiming 字段逐字一致）。
STAGE_NAMES: tuple[str, ...] = (
    "planning",
    "retrieval",
    "tool_call",
    "generation",
    "post_process",
)

#: Redis 键中间段（与 REDIS_KEY_PREFIX 拼出 ``aip:agent:session:{id}:timings``，**注意复数**）。
TIMING_KEY_PREFIX = "agent:session:"
TIMING_KEY_SUFFIX = ":timings"
#: 调试数据过期时间（秒）：24h。过期后前端显示「已过期 / 暂无」。
TIMING_TTL_SECONDS = 86400
#: 当前 timing schema 版本，结构变更时 +1（v2：per-turn snapshot 顶层新增 sub_stages）。
TIMING_SCHEMA_VERSION = 2
#: 每个会话最多保留的轮次条数（环形缓冲，仅保留最近 N 轮调试耗时）。
TIMING_RING_SIZE = 50


class StageTiming:
    """单轮对话的 5 阶段耗时（毫秒）。``None`` 表示该项不可得（前端显示「—」）。"""

    def __init__(
        self,
        planning_ms: int | None = 0,
        retrieval_ms: int | None = None,
        tool_call_ms: int | None = 0,
        generation_ms: int | None = None,
        post_process_ms: int | None = 0,
    ) -> None:
        self.planning_ms = planning_ms
        self.retrieval_ms = retrieval_ms
        self.tool_call_ms = tool_call_ms
        self.generation_ms = generation_ms
        self.post_process_ms = post_process_ms


class SessionTiming:
    """单轮对话端到端 + 5 阶段耗时快照（与前端 ``SessionTiming`` 对齐）。"""

    def __init__(
        self,
        total_ms: int | None = None,
        stages: StageTiming | None = None,
        sampled_at: str = "",
        schema_version: int = TIMING_SCHEMA_VERSION,
        sub_stages: dict[str, Any] | None = None,
    ) -> None:
        self.total_ms = total_ms
        self.stages = stages or StageTiming()
        self.sampled_at = sampled_at
        self.schema_version = schema_version
        # v2：顶层子阶段下钻结构；旧调用方不传则为 None（前端显示「—」）
        self.sub_stages = sub_stages


class SessionTimingRecorder:
    """包裹 ``process_message`` 的事件流，按 wall-clock 切 5 阶段 + 子阶段下钻。

    用法::

        recorder = SessionTimingRecorder(session_id, turn_key)
        async for event in stream:
            recorder.observe(event)
            yield event
        recorder.complete()   # 正常结束（向后兼容兜底）
        # 或 recorder.fail()  # 异常结束
        await store.save(session_id, turn_key, recorder.snapshot())

    增量（v2）：在既有 5 阶段外，额外从 ``DISPATCH_TRACE`` 事件抽取 worker 内部
    子阶段（``retrieval.sub_stages`` / ``tool_call.calls[].sub_stages``），并新增
    planning / generation 的子阶段细分与 post_process 三步打点（Q5 计时窗延伸）。
    """

    # delegate 类工具（其 sub_stages 来自对应 worker 的 DispatchTraceEntry）
    DELEGATE_TOOL_NAMES: frozenset[str] = frozenset({"agent__invoke", "agent"})

    def __init__(self, session_id: str, turn_key: str | None = None) -> None:
        self.session_id = session_id
        # turn_key：本轮对应的 assistant 消息 id（由调用方在落库前生成并复用）。
        # 为 None 时回退为 session 级单键，保证未改造的调用方仍能写入（仅无法前端逐条映射）。
        self.turn_key = turn_key or f"{session_id}:latest"
        self._start = time.monotonic()
        self._first_external: float | None = None
        self._last_external: float | None = None
        self._first_text: float | None = None
        self._last_text: float | None = None
        # 首个 TOOL_CALL 时刻（用于 planning TTFT 的「首个 token」口径）
        self._first_tool_call_t: float | None = None
        # DONE 事件时刻（生成阶段收口点，用于 generation_tail；不钉死 _end_t）
        self._done_t: float | None = None
        # TOOL_CALL 配对栈：{tool_name, started_at}
        self._tool_call_stack: list[dict[str, Any]] = []
        self._tool_call_ms: float = 0.0
        # 每个工具调用的明细（tool_name / kind / latency_ms / sub_stages）
        self._tool_calls: list[dict[str, Any]] = []
        self._retrieval_ms: float = 0.0
        self._has_rag_trace: bool = False
        # intent=rag 的子阶段细分数组（平铺 dict[str,int]）
        self._rag_sub_stages: dict[str, int] | None = None
        self._ended = False
        # 端到端 + post_process 终点；由 close() 最终落定（计时窗延伸，Q5）
        self._end_t: float | None = None
        # post_process 三步打点（名称 -> [start, end]）
        self._post_steps: dict[str, list[float | None]] = {}
        # 子阶段采集开关（默认开；高频会话可经 flags 关闭以控开销）
        self._substage_enabled = substage_instrumentation_enabled(get_settings())

    # ---- 内部辅助 ----

    def _mark_external(self, t: float) -> None:
        if self._first_external is None:
            self._first_external = t
        self._last_external = t

    @staticmethod
    def _tool_kind(tool_name: str) -> str:
        """delegate：委派类工具（agent__invoke 等）；native：普通工具。"""
        return "delegate" if tool_name in SessionTimingRecorder.DELEGATE_TOOL_NAMES else "native"

    @staticmethod
    def _dispatch_trace_latency_ms(trace: Any) -> float:
        """从 dispatch.trace 事件抽取 rag 意图的 latency_ms 之和（防御式解析）。"""
        if not isinstance(trace, dict):
            return 0.0
        entries = trace.get("entries")
        if not isinstance(entries, list):
            return 0.0
        total = 0.0
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if entry.get("intent") != "rag":
                continue
            lat = entry.get("latency_ms")
            if isinstance(lat, (int, float)):
                total += float(lat)
        return total

    def _extract_dispatch_sub_stages(self, trace: Any) -> None:
        """从 dispatch.trace 抽取各 worker 的 sub_stages（防御式；降级红线）。

        约定（§9 共享知识 #3）：
        - intent=="rag"            → 作为 retrieval 子阶段（sub_stages.retrieval）。
        - tool=="agent__invoke" 且带 sub_stages → 挂到最近一个未填的 delegate 调用明细。
        """
        if not self._substage_enabled or not isinstance(trace, dict):
            return
        entries = trace.get("entries")
        if not isinstance(entries, list):
            return
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            sub = entry.get("sub_stages")
            if not isinstance(sub, dict) or not sub:
                continue
            # 仅保留 int 类型的毫秒值，其余静默丢弃（避免污染快照）
            norm: dict[str, int] = {}
            for k, v in sub.items():
                if isinstance(v, int):
                    norm[str(k)] = v
                elif isinstance(v, float):
                    norm[str(k)] = int(v)
            if not norm:
                continue
            if entry.get("intent") == "rag":
                self._rag_sub_stages = norm
            if entry.get("tool") in self.DELEGATE_TOOL_NAMES:
                self._attach_sub_stages_to_last_delegate(norm)

    def _attach_sub_stages_to_last_delegate(self, sub_stages: dict[str, int]) -> None:
        """把 worker 子阶段挂到最近一个尚未填充的 delegate 调用明细。"""
        for call in reversed(self._tool_calls):
            if call.get("kind") == "delegate" and call.get("sub_stages") is None:
                call["sub_stages"] = sub_stages
                return

    # ---- 事件观测 ----

    def observe(self, event: AgentEvent) -> None:
        """消费一个事件，更新内部计时状态。done/error 之后幂等于不再处理。"""
        if self._ended:
            return
        etype = event.type
        t = time.monotonic()

        if etype == AgentEventType.DISPATCH_TRACE:
            self._mark_external(t)
            self._has_rag_trace = True
            self._retrieval_ms += self._dispatch_trace_latency_ms(getattr(event, "trace", None))
            self._extract_dispatch_sub_stages(getattr(event, "trace", None))
        elif etype == AgentEventType.TOOL_CALL:
            self._mark_external(t)
            if self._first_tool_call_t is None:
                self._first_tool_call_t = t
            name = getattr(event, "tool_name", None) or "unknown"
            self._tool_call_stack.append({"tool_name": name, "started_at": t})
        elif etype == AgentEventType.TOOL_RESULT:
            self._mark_external(t)
            name = getattr(event, "tool_name", None) or "unknown"
            if self._tool_call_stack:
                call = self._tool_call_stack.pop(0)
                latency = max(0.0, (t - call["started_at"])) * 1000.0
                self._tool_call_ms += latency
                self._tool_calls.append(
                    {
                        "tool_name": call["tool_name"],
                        "kind": self._tool_kind(call["tool_name"]),
                        "latency_ms": round(latency),
                        "sub_stages": None,
                    }
                )
        elif etype == AgentEventType.TEXT_DELTA:
            if self._first_text is None:
                self._first_text = t
            self._last_text = t
        elif etype == AgentEventType.DONE:
            # 置 _ended（保持生成阶段口径），但**不钉死 _end_t**——
            # _end_t 交由 finally 末的 close() 收口到 post_process 完成之后（Q5）。
            self._ended = True
            self._done_t = t
        elif etype == AgentEventType.ERROR:
            self._ended = True

    def complete(self) -> None:
        """正常结束兜底（done 事件已被 observe 处理；向后兼容保留）。

        Q5：成功路径不再由 complete() 钉死 _end_t，_end_t 改由 close() 收口；
        此处仅在确实尚未收口时兜底设置两枚时间戳，避免 _end_t 永远为 None。
        """
        if not self._ended:
            self._ended = True
        if self._done_t is None:
            self._done_t = time.monotonic()
        if self._end_t is None:
            self._end_t = self._done_t

    def fail(self) -> None:
        """异常结束（流未产出 done/error，由调用方在 except 中调用）。"""
        self._ended = True
        now = time.monotonic()
        if self._done_t is None:
            self._done_t = now
        if self._end_t is None:
            self._end_t = now

    # ---- post_process 三步打点（弱引用，异常静默）----

    def step_start(self, name: str) -> None:
        """记录 post_process 某步的开始时刻（db_persist / redis_write / timing_save）。"""
        try:
            entry = self._post_steps.setdefault(name, [None, None])
            entry[0] = time.monotonic()
        except Exception:  # noqa: BLE001 — 可观测性不得影响主链路
            pass

    def step_end(self, name: str) -> None:
        """记录 post_process 某步的结束时刻。"""
        try:
            entry = self._post_steps.setdefault(name, [None, None])
            entry[1] = time.monotonic()
        except Exception:  # noqa: BLE001
            pass

    def close(self) -> None:
        """成功路径落定 _end_t（窗口关闭点）。

        幂等：若 _ended 由 fail()/complete() 错误路径已收口（_end_t 已定），
        则保留既有 _end_t；否则以当前时刻收口到 finally 三步打点之后，
        使 post_process 计时窗覆盖落库各步（Q5）。绝不抛异常。
        """
        if self._end_t is None:
            self._end_t = time.monotonic()

    # ---- 子阶段计算 ----

    def _first_token_t(self) -> float | None:
        """首个 LLM 输出信号 = min(首个文本, 首个工具调用)；二者皆无为 None。"""
        candidates = [t for t in (self._first_text, self._first_tool_call_t) if t is not None]
        return min(candidates) if candidates else None

    def _post_step_ms(self, name: str) -> int | None:
        entry = self._post_steps.get(name)
        if not entry or entry[0] is None or entry[1] is None:
            return None
        return max(0, int((entry[1] - entry[0]) * 1000))

    # ---- 快照 ----

    def snapshot(self) -> dict[str, Any]:
        """生成可 JSON 序列化的耗时快照（顶层加 sub_stages，schema v2）。

        5 阶段各自独立测量，total 为权威的端到端 wall-clock；retrieval 走 trace
        上报的子延迟（不可得为 None），其余阶段为 wall-clock 片段。
        """
        end_t = self._end_t if self._end_t is not None else time.monotonic()
        total_ms = max(0.0, end_t - self._start) * 1000.0

        # planning：流开始 → 首个外部动作（tool.call / dispatch.trace）或首个文本
        first_work = self._first_external if self._first_external is not None else self._first_text
        planning_ms = (first_work - self._start) * 1000.0 if first_work is not None else 0.0

        # generation：首个文本 → 末个文本的跨度（无文本则为 None）
        generation_ms: float | None
        if self._first_text is not None and self._last_text is not None:
            generation_ms = max(0.0, self._last_text - self._first_text) * 1000.0
        else:
            generation_ms = None

        # post_process：末个外部动作（或末文本）→ 结束（close() 收口）
        last_work = self._last_external if self._last_external is not None else self._last_text
        post_process_ms = (end_t - last_work) * 1000.0 if last_work is not None else 0.0

        # retrieval：仅当出现过 rag 轨迹时返回数值，否则 None（前端显示「—」）
        retrieval_ms: int | None = (
            round(self._retrieval_ms) if self._has_rag_trace else None
        )

        sub_stages = self._build_sub_stages(
            planning_ms=planning_ms,
            generation_ms=generation_ms,
            post_process_ms=post_process_ms,
        )

        return {
            # turn_key：本轮对应的 assistant 消息 id，供前端按 message.id 映射。
            "turn_key": self.turn_key,
            "total_ms": round(total_ms),
            "stages": {
                "planning_ms": round(planning_ms),
                "retrieval_ms": retrieval_ms,
                "tool_call_ms": round(self._tool_call_ms),
                "generation_ms": round(generation_ms) if generation_ms is not None else None,
                "post_process_ms": round(post_process_ms),
            },
            "sub_stages": sub_stages,
            "sampled_at": datetime.now(timezone.utc).isoformat(),
            "schema_version": TIMING_SCHEMA_VERSION,
        }

    def _build_sub_stages(
        self,
        planning_ms: float,
        generation_ms: float | None,
        post_process_ms: float,
    ) -> dict[str, Any] | None:
        """构建顶层 sub_stages 对象；开关关闭或无任何子阶段时返回 None。"""
        if not self._substage_enabled:
            return None

        planning = self._planning_sub_stages(planning_ms)
        retrieval = self._rag_sub_stages  # 可能 None
        tool_call = self._tool_call_sub_stages()
        generation = self._generation_sub_stages(generation_ms)
        post_process = self._post_process_sub_stages(post_process_ms)

        has_any = any(
            v is not None for v in (planning, retrieval, tool_call, generation, post_process)
        )
        if not has_any:
            return None
        return {
            "planning": planning,
            "retrieval": retrieval,
            "tool_call": tool_call,
            "generation": generation,
            "post_process": post_process,
        }

    def _planning_sub_stages(self, planning_ms: float) -> dict[str, int] | None:
        """planning_ttft_ms（首 token 延迟）+ planning_decision_ms（决策推理）。"""
        first_token = self._first_token_t()
        if first_token is None:
            return None
        ttft_ms = max(0, int((first_token - self._start) * 1000))
        decision_ms: int | None = None
        if self._first_external is not None:
            decision_ms = max(0, int((self._first_external - first_token) * 1000))
        return {"ttft_ms": ttft_ms, "decision_ms": decision_ms}

    def _tool_call_sub_stages(self) -> dict[str, Any] | None:
        """按调用分别计时（calls[]）；delegate 类挂 sub_stages + delegate_round_trip_ms。"""
        if not self._tool_calls:
            return None
        calls = [
            {
                "tool_name": c["tool_name"],
                "kind": c["kind"],
                "latency_ms": c["latency_ms"],
                "sub_stages": c.get("sub_stages"),
            }
            for c in self._tool_calls
        ]
        # delegate_round_trip_ms ≈ Σ delegate 调用 latency − Σ 其 worker 内部子阶段
        # （近似：worker 内部段之外即委派往返/编排开销；精确化留 P2 增强）
        round_trip = 0
        for c in self._tool_calls:
            if c["kind"] != "delegate":
                continue
            # 防御式净化：sub_stages 经管线恒为 dict[str,int] 或 None，但按 §9 #6 红线
            # 仍做一层类型守护——若未来出现「真值非 dict」（如异常注入），(inner or {})
            # 会保留原值并触发 .values() AttributeError；此处显式归一为空 dict，静默降级。
            inner = c.get("sub_stages")
            inner_dict = inner if isinstance(inner, dict) else {}
            inner_sum = sum(v for v in inner_dict.values() if isinstance(v, int))
            round_trip += max(0, c["latency_ms"] - inner_sum)
        return {
            "calls": calls,
            "delegate_round_trip_ms": round_trip if round_trip else None,
        }

    def _generation_sub_stages(self, generation_ms: float | None) -> dict[str, int] | None:
        """generation_ttft_ms（首字延迟）/ stream_ms（流式，=generation_ms）/ tail_ms（收尾）。"""
        if self._first_text is None:
            return None
        ttft_ms = max(0, int((self._first_text - self._start) * 1000))
        stream_ms = (
            max(0, int((self._last_text - self._first_text) * 1000))
            if self._last_text is not None
            else None
        )
        tail_ms: int | None = None
        if self._last_text is not None and self._done_t is not None:
            tail_ms = max(0, int((self._done_t - self._last_text) * 1000))
        return {"ttft_ms": ttft_ms, "stream_ms": stream_ms, "tail_ms": tail_ms}

    def _post_process_sub_stages(self, post_process_ms: float) -> dict[str, int] | None:
        """post_process 三步：db_persist / redis_write / timing_save。

        本代码库消息落库（PG + Redis）由 API 路由在 recorder 窗口外完成，
        manager.finally 内仅 timing_save 在窗口内真实可测；前两项缺测记 ``None``
        （降级红线：不虚构 0ms）。只要有任一实测即输出该块。
        """
        db = self._post_step_ms("db_persist")
        redis_w = self._post_step_ms("redis_write")
        timing = self._post_step_ms("timing_save")
        if db is None and redis_w is None and timing is None:
            return None
        return {
            "db_persist_ms": db,
            "redis_write_ms": redis_w,
            "timing_save_ms": timing,
        }


class RedisTimingStore:
    """各会话**按轮（turn_key=assistant 消息 id）**耗时的 Redis 存储（map 结构）。

    key：``{REDIS_KEY_PREFIX}agent:session:{session_id}:timings``
    value：JSON ``{turn_key: timing_snapshot, ...}``，环形缓冲保留最近 ``TIMING_RING_SIZE`` 轮。
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _key(self, session_id: str) -> str:
        return (
            f"{self._settings.REDIS_KEY_PREFIX}{TIMING_KEY_PREFIX}"
            f"{session_id}{TIMING_KEY_SUFFIX}"
        )

    def _client(self) -> "aioredis.Redis":
        return aioredis.from_url(
            self._settings.redis_url,
            max_connections=self._settings.REDIS_MAX_CONNECTIONS,
            decode_responses=True,
        )

    async def save(self, session_id: str, turn_key: str, timing: dict[str, Any]) -> None:
        """按轮 upsert 一轮耗时（turn_key 维度），并刷新 TTL / 维持环形缓冲。

        写入路径异常一律静默降级（warning），绝不阻断主对话链路。
        """
        if not turn_key:
            turn_key = f"{session_id}:latest"
        client = self._client()
        try:
            key = self._key(session_id)
            # 读取既有 map（无则空 dict），upsert 本轮，再裁剪到环形缓冲上限。
            raw = await client.get(key)
            mapping: dict[str, Any] = json.loads(raw) if raw else {}
            if not isinstance(mapping, dict):
                mapping = {}
            mapping[turn_key] = timing
            # 环形缓冲：超出上限时丢弃最早的轮次（按 sampled_at 升序）。
            if len(mapping) > TIMING_RING_SIZE:
                ordered = sorted(
                    mapping.items(),
                    key=lambda kv: str(kv[1].get("sampled_at", "")),
                )
                mapping = dict(ordered[-TIMING_RING_SIZE:])
            await client.set(key, json.dumps(mapping, ensure_ascii=False), ex=TIMING_TTL_SECONDS)
        finally:
            await client.close()

    async def get(self, session_id: str) -> dict[str, Any] | None:
        """读取单会话的 per-turn 耗时 map；过期 / 不存在返回 None（前端显示「已过期 / 暂无」）。"""
        client = self._client()
        try:
            raw = await client.get(self._key(session_id))
            data = json.loads(raw) if raw else None
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            logger.warning("session timing payload corrupt", session_id=session_id)
            return None
        finally:
            await client.close()

    async def get_many(self, session_ids: list[str]) -> dict[str, dict[str, Any] | None]:
        """批量读取当前页会话的 per-turn 耗时 map（列表列用，pipeline 一次往返）。"""
        if not session_ids:
            return {}
        client = self._client()
        try:
            pipe = client.pipeline()
            for sid in session_ids:
                pipe.get(self._key(sid))
            raws = await pipe.execute()
            result: dict[str, dict[str, Any] | None] = {}
            for sid, raw in zip(session_ids, raws):
                if not raw:
                    result[sid] = None
                    continue
                try:
                    data = json.loads(raw)
                    result[sid] = data if isinstance(data, dict) else None
                except json.JSONDecodeError:
                    result[sid] = None
            return result
        finally:
            await client.close()
