"""PlanMapper — WrenAI 状态/阶段 → 中文执行计划步骤（v1.9 / B2）。

将 orchestrator 内部阶段（scope_check / understanding / searching / generating /
lineage_check / executing / masking / finished）映射为
``IqdAskResponse.plan[]``（architecture §4.3 示例）。

B2 基础版：固定阶段模板 + 动态 detail；B3/W4 起可消费 WrenAI ``steps`` 产物。
每步 ``duration_ms`` 按「本步开始 → 本步结束」计时（未显式 running 时取相对上一步结束）。
"""

from __future__ import annotations

from time import perf_counter
from typing import Any

from src.models.iqd_schema import PlanStep

#: 阶段顺序模板（seq 从 1 开始）
_PLAN_TEMPLATE: list[dict[str, Any]] = [
    {"code": "scope_check", "label": "校验可问数据范围", "detail": None},
    {"code": "understanding", "label": "理解你的问题", "detail": None},
    {"code": "searching", "label": "检索相关语义模型", "detail": None},
    {"code": "generating", "label": "生成查询", "detail": None},
    {"code": "lineage_check", "label": "复核查询涉及的数据范围", "detail": None},
    {"code": "executing", "label": "执行并汇总结果", "detail": None},
    {"code": "masking", "label": "敏感字段处理", "detail": None},
    {"code": "finished", "label": "完成", "detail": None},
]

_TERMINAL = frozenset({"done", "failed", "skipped"})


class PlanMapper:
    """阶段 → 中文计划步骤映射器。"""

    def __init__(self) -> None:
        self._plan_started: float | None = None
        self._last_mark_at: float | None = None
        self._step_started: dict[str, float] = {}

    def build_empty(self) -> list[PlanStep]:
        """返回初始计划（全部 running，用于 SSE plan_step 首帧）。"""
        now = perf_counter()
        self._plan_started = now
        self._last_mark_at = now
        self._step_started.clear()
        return [
            PlanStep(seq=i, code=item["code"], label=item["label"], status="running")
            for i, item in enumerate(_PLAN_TEMPLATE, start=1)
        ]

    def mark(
        self,
        steps: list[PlanStep],
        code: str,
        status: str,
        *,
        detail: str | None = None,
        sql: str | None = None,
    ) -> list[PlanStep]:
        """按 code 更新某一步状态（幂等；未命中时忽略）。

        Args:
            steps: 待更新的计划列表（原地更新并返回）。
            code: 阶段码。
            status: running | done | skipped | failed。
            detail: 阶段明细。
            sql: 仅 admin 视图保留的 SQL（plan[].sql）。

        Returns:
            更新后的计划列表。
        """
        now = perf_counter()
        for step in steps:
            if step.code != code:
                continue
            if status == "running":
                self._step_started[code] = now
            elif status in _TERMINAL:
                start = (
                    self._step_started.get(code)
                    or self._last_mark_at
                    or self._plan_started
                    or now
                )
                step.duration_ms = max(0, int((now - start) * 1000))
                self._last_mark_at = now
                self._step_started.pop(code, None)
            step.status = status  # type: ignore[assignment]
            if detail is not None:
                step.detail = detail
            if sql is not None:
                step.sql = sql
        return steps

    def mark_done(
        self,
        steps: list[PlanStep],
        code: str,
        *,
        detail: str | None = None,
        sql: str | None = None,
    ) -> list[PlanStep]:
        """将某一步标记为 done（支持附带 SQL 供 admin 视图展示）。"""
        return self.mark(steps, code, "done", detail=detail, sql=sql)

    def from_wren_steps(self, wren_steps: list[Any] | None) -> list[PlanStep]:
        """消费 WrenAI 返回的 steps（B2 基础版透传 label，W4 起增强）。

        Args:
            wren_steps: WrenAI ``steps[]`` 列表（可能为 None）。

        Returns:
            计划步骤列表；输入不可得时返回空列表。
        """
        if not isinstance(wren_steps, list):
            return []
        steps: list[PlanStep] = []
        for idx, raw in enumerate(wren_steps, start=1):
            if not isinstance(raw, dict):
                continue
            steps.append(
                PlanStep(
                    seq=idx,
                    code=str(raw.get("code") or f"step_{idx}"),
                    label=str(raw.get("label") or raw.get("summary") or f"步骤 {idx}"),
                    detail=raw.get("detail") or raw.get("description"),
                    sql=raw.get("sql"),
                    status="done",
                    duration_ms=int(raw.get("duration_ms") or 0),
                )
            )
        return steps
