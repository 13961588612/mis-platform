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
#: 当前 timing schema 版本，结构变更时 +1。
TIMING_SCHEMA_VERSION = 1
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
    ) -> None:
        self.total_ms = total_ms
        self.stages = stages or StageTiming()
        self.sampled_at = sampled_at
        self.schema_version = schema_version


class SessionTimingRecorder:
    """包裹 ``process_message`` 的事件流，按 wall-clock 切 5 阶段。

    用法::

        recorder = SessionTimingRecorder(session_id, turn_key)
        async for event in stream:
            recorder.observe(event)
            yield event
        recorder.complete()   # 正常结束
        # 或 recorder.fail()  # 异常结束
        await store.save(session_id, turn_key, recorder.snapshot())
    """

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
        self._tool_call_stack: list[float] = []
        self._tool_call_ms: float = 0.0
        self._retrieval_ms: float = 0.0
        self._has_rag_trace: bool = False
        self._ended = False
        self._end_t: float | None = None

    # ---- 内部辅助 ----

    def _mark_external(self, t: float) -> None:
        if self._first_external is None:
            self._first_external = t
        self._last_external = t

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
        elif etype == AgentEventType.TOOL_CALL:
            self._mark_external(t)
            self._tool_call_stack.append(t)
        elif etype == AgentEventType.TOOL_RESULT:
            self._mark_external(t)
            if self._tool_call_stack:
                call_t = self._tool_call_stack.pop(0)
                self._tool_call_ms += max(0.0, t - call_t)
        elif etype == AgentEventType.TEXT_DELTA:
            if self._first_text is None:
                self._first_text = t
            self._last_text = t
        elif etype in (AgentEventType.DONE, AgentEventType.ERROR):
            self._ended = True
            self._end_t = t

    def complete(self) -> None:
        """正常结束（done 事件已被 observe 处理；兜底收口）。"""
        if not self._ended:
            self._ended = True
            self._end_t = time.monotonic()

    def fail(self) -> None:
        """异常结束（流未产出 done/error，由调用方在 except 中调用）。"""
        self._ended = True
        self._end_t = time.monotonic()

    # ---- 快照 ----

    def snapshot(self) -> dict[str, Any]:
        """生成可 JSON 序列化的耗时快照。

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

        # post_process：末个外部动作（或末文本）→ 结束
        last_work = self._last_external if self._last_external is not None else self._last_text
        post_process_ms = (end_t - last_work) * 1000.0 if last_work is not None else 0.0

        # retrieval：仅当出现过 rag 轨迹时返回数值，否则 None（前端显示「—」）
        retrieval_ms: int | None = (
            round(self._retrieval_ms) if self._has_rag_trace else None
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
            "sampled_at": datetime.now(timezone.utc).isoformat(),
            "schema_version": TIMING_SCHEMA_VERSION,
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
