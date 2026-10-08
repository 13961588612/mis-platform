"""ResponseProjector — 问数结果投影（v1.9 / B2）。

``project(result, view)``：按视图裁剪响应可见性。

- ``view=user``：``_strip_sql()`` **删除**（不是置空）顶层 ``sql`` / ``sql_dialect``
  与 ``plan[].sql`` 键 —— 前端类型层（``iqd-plan-steps.tsx`` 无 ``sql`` prop）形成
  二次保险（architecture §4.3 安全约束）。
- ``view=admin``：原样透传全量（含 SQL 与各阶段耗时）。

**审计先于投影**（architecture §5.1 步骤 28）：``write_ask_log`` 必须在本方法
之前调用，留全量 SQL 供排错。

``compact_ask_payload_for_llm``：给 Worker/Coordinator LLM 看的瘦身副本——
只保留前若干预览行，避免整表 JSON 撑爆上下文导致超时与空气泡。
"""

from __future__ import annotations

import copy
from typing import Any

from src.models.iqd_schema import AskResponse
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.projector")

#: LLM 工具回传预览行数上限（全量仍由审计 / 内部 API 保留）
LLM_PREVIEW_MAX_ROWS = 20


def compact_ask_payload_for_llm(
    payload: dict[str, Any],
    *,
    max_rows: int = LLM_PREVIEW_MAX_ROWS,
) -> dict[str, Any]:
    """压缩问数结果，供 LLM 上下文使用。

    保留 ``answer_summary`` / ``citations`` / ``plan`` / ``status`` 等元信息；
    ``data.rows`` 仅保留前 ``max_rows`` 行，并标记 ``truncated`` 与真实 ``row_count``。

    Args:
        payload: ``project()`` 后的 wire 字典。
        max_rows: 预览行上限。

    Returns:
        深拷贝后的瘦身字典（不修改入参）。
    """
    out: dict[str, Any] = copy.deepcopy(payload)
    # 调试大字段对作答无必要，且易撑爆上下文
    out.pop("nl2sql_debug", None)
    out.pop("sql", None)
    out.pop("sql_dialect", None)

    data = out.get("data")
    if not isinstance(data, dict):
        return out

    rows = data.get("rows")
    if not isinstance(rows, list):
        return out

    total = int(data.get("row_count") or len(rows))
    limit = max(0, int(max_rows))
    preview = rows[:limit]
    truncated = len(rows) > limit or total > limit
    data["rows"] = preview
    data["row_count"] = total
    data["preview_rows"] = len(preview)
    data["truncated"] = truncated
    if truncated:
        note = (
            f"结果共 {total} 行，工具回传仅含前 {len(preview)} 行预览；"
            "请基于 answer_summary 与预览作答，勿要求全量 rows。"
        )
        summary = str(out.get("answer_summary") or "").strip()
        if note not in summary:
            out["answer_summary"] = f"{summary}（{note}）" if summary else note
        logger.info(
            "IQD ask payload compacted for LLM",
            total_rows=total,
            preview_rows=len(preview),
        )
    return out


class ResponseProjector:
    """问数结果投影器。"""

    def project(self, response: AskResponse, view: str) -> dict[str, Any]:
        """按视图投影响应为 wire 字典。

        Args:
            response: 全量问数结果（含 SQL）。
            view: ``user`` / ``admin``；admin 才保留 SQL。

        Returns:
            wire snake_case 字典（user 视图已删 SQL 键）。
        """
        payload: dict[str, Any] = response.to_wire()
        if view == "user":
            self._strip_sql(payload)
        return payload

    def _strip_sql(self, payload: dict[str, Any]) -> None:
        """删除 SQL / NL→SQL 调试相关键（顶层 sql / sql_dialect / plan[].sql / nl2sql_debug）。"""
        payload.pop("sql", None)
        payload.pop("sql_dialect", None)
        payload.pop("nl2sql_debug", None)

        plan: Any = payload.get("plan")
        if isinstance(plan, list):
            for step in plan:
                if isinstance(step, dict):
                    step.pop("sql", None)
        logger.debug("IQD response stripped of sql keys", view="user")
