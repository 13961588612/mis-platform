"""mis_iqd 包 — 问数 Worker 编排与裁定（v1.9 / B2）。

对外暴露：
- :class:`~src.agent.mis_iqd.orchestrator.AskOrchestrator`
- :class:`~src.agent.mis_iqd.scope_resolver.ScopeResolver` / :class:`AskIdentity`
- :class:`~src.agent.mis_iqd.service.IqdAskService`
- :class:`~src.agent.mis_iqd.tools.IqdAskTool` / :class:`IqdDescribeScopeTool`
- 452xx 错误码常量与异常（:mod:`src.agent.mis_iqd.errors`）
"""

from __future__ import annotations

from src.agent.mis_iqd.errors import (
    IqdError,
    QuestionUnsupportedError,
    ScopeDeniedError,
    SqlFailedError,
    WrenaiNotConfiguredError,
    WrenaiTimeoutError,
    WrenaiUnreachableError,
    WRENAI_ENHANCE_SYNC_PARTIAL,
    WRENAI_MDL_SYNC_FAILED,
    WRENAI_NOT_CONFIGURED,
    WRENAI_QUESTION_UNSUPPORTED,
    WRENAI_SCOPE_DENIED,
    WRENAI_SQL_FAILED,
    WRENAI_TIMEOUT,
    WRENAI_UNREACHABLE,
    error_message,
)
from src.agent.mis_iqd.lineage import CitationBuilder, LineageExtractor
from src.agent.mis_iqd.masking import MaskOutcome, MaskingEngine
from src.agent.mis_iqd.orchestrator import AskOrchestrator, AskResult
from src.agent.mis_iqd.plan_mapper import PlanMapper
from src.agent.mis_iqd.projector import ResponseProjector
from src.agent.mis_iqd.service import IqdAskService
from src.agent.mis_iqd.tools import (
    IqdAskInput,
    IqdAskTool,
    IqdDescribeScopeInput,
    IqdDescribeScopeTool,
)

__all__ = [
    "AskOrchestrator",
    "AskResult",
    "AskIdentity",
    "IqdScopeResolution",
    "ScopeResolver",
    "IqdAskService",
    "IqdAskInput",
    "IqdAskTool",
    "IqdDescribeScopeInput",
    "IqdDescribeScopeTool",
    "LineageExtractor",
    "CitationBuilder",
    "MaskingEngine",
    "MaskOutcome",
    "PlanMapper",
    "ResponseProjector",
    "IqdError",
    "ScopeDeniedError",
    "WrenaiNotConfiguredError",
    "WrenaiUnreachableError",
    "WrenaiTimeoutError",
    "SqlFailedError",
    "QuestionUnsupportedError",
    "WRENAI_NOT_CONFIGURED",
    "WRENAI_UNREACHABLE",
    "WRENAI_TIMEOUT",
    "WRENAI_SCOPE_DENIED",
    "WRENAI_SQL_FAILED",
    "WRENAI_QUESTION_UNSUPPORTED",
    "WRENAI_MDL_SYNC_FAILED",
    "WRENAI_ENHANCE_SYNC_PARTIAL",
    "error_message",
]
