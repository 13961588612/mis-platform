"""ResponseProjector — 问数结果投影（v1.9 / B2）。

``project(result, view)``：按视图裁剪响应可见性。

- ``view=user``：``_strip_sql()`` **删除**（不是置空）顶层 ``sql`` / ``sql_dialect``
  与 ``plan[].sql`` 键 —— 前端类型层（``iqd-plan-steps.tsx`` 无 ``sql`` prop）形成
  二次保险（architecture §4.3 关键约束）。
- ``view=admin``：原样透传全量（含 SQL 与各阶段耗时）。

**审计先于投影**（architecture §5.1 步骤 28）：``write_ask_log`` 必须在本方法
之前调用，留全量 SQL 供排错。
"""

from __future__ import annotations

from typing import Any

from src.models.iqd_schema import AskResponse
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.projector")


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
