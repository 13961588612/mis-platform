"""模板报告 Worker 管线：目录拉取 → 决策命中 → 抽槽 → 执行/开卡。"""

from src.agent.template_report.pipeline import (
    OPEN_CARD_MARKER_PREFIX,
    TemplateReportOutcome,
    run_template_report_turn,
)

__all__ = [
    "OPEN_CARD_MARKER_PREFIX",
    "TemplateReportOutcome",
    "run_template_report_turn",
]
