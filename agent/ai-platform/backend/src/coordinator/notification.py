"""task_notification 结果信封：Worker 执行结果的统一回传结构。

对齐 `docs/ai-fusion/coordinator-worker/spec.md` §7.1 与实现级设计 §3.1。

渲染策略（design-impl.md §7.2 / §7.6 硬约束）：

* `text_with_header`（默认）：**成功路径**首行加结构化头 + 空行 + 正文，
  正文与改造前 `_run_child_agent()` 的返回文本**逐字节一致**；
* **失败路径**（`status != completed`）一律**不加头**，逐字保留现网错误文案，
  确保既有测试的子串/等值断言不回归；
* `json`：输出紧凑 JSON（运维/结构化消费场景，默认不启用）。
"""

from __future__ import annotations

import json
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.config import get_settings
from src.coordinator.flags import str_flag
from src.utils.logging import get_logger

logger = get_logger("coordinator.notification")

NOTIFICATION_MODE_TEXT_WITH_HEADER: str = "text_with_header"
NOTIFICATION_MODE_JSON: str = "json"
NOTIFICATION_MODES: tuple[str, ...] = (
    NOTIFICATION_MODE_TEXT_WITH_HEADER,
    NOTIFICATION_MODE_JSON,
)

SUMMARY_MAX_CHARS: int = 120
"""summary 字段的最大字符数（spec.md §7.1：≤120 字短摘要）。"""


class TaskStatus(str, Enum):
    """委派任务终态（对齐 spec.md §7.1）。"""

    COMPLETED = "completed"
    FAILED = "failed"
    KILLED = "killed"
    TIMEOUT = "timeout"


class TaskUsage(BaseModel):
    """Worker 资源用量（尽力而为，缺失时为 0）。"""

    model_config = ConfigDict(extra="ignore")

    tokens: int = 0
    tool_uses: int = 0
    duration_ms: int = 0


def resolve_notification_mode() -> str:
    """读取当前生效的信封渲染模式。

    Returns:
        `text_with_header` 或 `json`；配置非法时回落默认值。
    """
    return str_flag(
        get_settings(),
        "TASK_NOTIFICATION_MODE",
        NOTIFICATION_MODE_TEXT_WITH_HEADER,
        allowed=NOTIFICATION_MODES,
    )


def build_summary(text: str, *, max_chars: int = SUMMARY_MAX_CHARS) -> str:
    """把 Worker 正文压成一行短摘要。

    Args:
        text: Worker 返回的原始正文。
        max_chars: 摘要最大字符数。

    Returns:
        单行摘要；超长时以 `…` 结尾。
    """
    flat = " ".join((text or "").split())
    if len(flat) <= max_chars:
        return flat
    return flat[: max_chars - 1] + "…"


class TaskNotification(BaseModel):
    """Worker 结果信封（spec.md §7.1）。"""

    model_config = ConfigDict(extra="ignore")

    task_id: str = Field(..., description="本次委派 ID（uuid4 hex 前 12 位）")
    worker_id: str
    status: TaskStatus
    summary: str = Field(default="", description="≤120 字短摘要，供 Coordinator 快速判断")
    result: str = Field(default="", description="Worker 最终文本或结构化摘要 JSON 串")
    usage: TaskUsage = Field(default_factory=TaskUsage)
    latency_ms: int = 0
    error_code: str = ""
    worker_session_id: str = Field(default="", description="C5 续聊锚点")

    @classmethod
    def from_worker_result(
        cls,
        *,
        task_id: str,
        worker_id: str,
        result: str,
        status: TaskStatus = TaskStatus.COMPLETED,
        usage: TaskUsage | None = None,
        latency_ms: int = 0,
        error_code: str = "",
        worker_session_id: str = "",
    ) -> "TaskNotification":
        """由 Worker 执行结果构造信封（自动生成 summary）。

        Args:
            task_id: 本次委派 ID。
            worker_id: 目标 Worker ID。
            result: Worker 正文（成功）或错误文案（失败）。
            status: 终态，默认 `COMPLETED`。
            usage: 资源用量；`None` 时用全 0 占位。
            latency_ms: 端到端耗时（毫秒）。
            error_code: 失败错误码（成功时为空串）。
            worker_session_id: C5 续聊锚点子会话 ID。

        Returns:
            构造好的 :class:`TaskNotification`。
        """
        return cls(
            task_id=task_id,
            worker_id=worker_id,
            status=status,
            summary=build_summary(result),
            result=result or "",
            usage=usage or TaskUsage(),
            latency_ms=max(0, int(latency_ms)),
            error_code=error_code or "",
            worker_session_id=worker_session_id or "",
        )

    def header_line(self) -> str:
        """生成结构化信封首行。

        Returns:
            形如 ``[task:abc123def456] worker=mis-rag status=completed latency=1200ms``。
        """
        return (
            f"[task:{self.task_id}] worker={self.worker_id} "
            f"status={self.status.value} latency={self.latency_ms}ms"
        )

    def to_dict(self) -> dict[str, Any]:
        """导出为纯 JSON 兼容字典（枚举转字符串）。

        Returns:
            可直接 `json.dumps` 的字典。
        """
        data = self.model_dump()
        data["status"] = self.status.value
        return data

    def to_tool_output(self, *, mode: str | None = None) -> str:
        """渲染为 ToolResult.output。

        默认 ``TASK_NOTIFICATION_MODE=text_with_header``：首行结构化头 + 空行 + 正文，
        保证既有「LLM 直接读文本」行为不退化，同时可被正则/单测解析。
        ``TASK_NOTIFICATION_MODE=json`` 时输出紧凑 JSON。

        Note:
            非 `COMPLETED` 终态**不加信封头**，逐字返回原始错误文案
            （design-impl.md §7.6：错误路径不加头 → 既有 8 例零修改通过）。

        Args:
            mode: 显式指定渲染模式；`None` 时读取配置。

        Returns:
            工具输出文本。
        """
        resolved = mode or resolve_notification_mode()
        if resolved == NOTIFICATION_MODE_JSON:
            return json.dumps(self.to_dict(), ensure_ascii=False, separators=(",", ":"))
        if self.status is not TaskStatus.COMPLETED:
            return self.result
        return f"{self.header_line()}\n\n{self.result}"
