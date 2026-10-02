"""AskOrchestrator — 问数编排核心（v1.9 / B2）。

串起完整链路（architecture §5.1 步骤 10–30，已按 Wren 0.13 校正）::

    scope_check → get_context → [cube 优先] → nl2sql(LLM Gateway) → dry_plan(SQL 转译)
    → lineage_check(断言) → dry_run → run_sql → citations
    → (write_ask_log 由 service 层在投影前调用) → AskResult（全量，含 SQL）

设计要点：
- **NL→SQL 在平台侧**：Wren OSS 0.13 的 ``dry_plan`` 只做方言转译；生成 SQL 走
  :class:`~src.agent.mis_iqd.nl2sql.Nl2SqlGenerator`（LLM Gateway）。
- **不臆造数据**：任何错误都抛出 :class:`IqdError`（452xx），由 tools 层如实上报，
  禁止用 LLM 兜底编造**查询结果数字**（NFR-2 降级铁律）；NL→SQL 仅产出 SQL 文本。
- **fail-closed**：范围裁定 deny / 血缘越权 → 45204，不执行、不返回任何数据。
- **可注入**：``mcp_client`` / ``nl2sql`` / ``scope_resolver`` / ``lineage`` /
  ``plan_mapper`` / ``citation_builder`` 全部可注入，便于离线 mock 验证（Golden path）。
- 行级注入（``inject_row_scope``）与脱敏（``MaskingEngine``）为 B3（W2）扩展钩子；
  B2 本版在 mock 下直跑，脱敏留空（``masked_columns=[]``）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any
from uuid import uuid4

from src.adapters.iqd_mcp_client import IqdMcpClient, IqdMcpClientError
from src.agent.mis_iqd.errors import (
    QuestionUnsupportedError,
    ScopeDeniedError,
    SqlFailedError,
    WrenaiUnreachableError,
)
from src.agent.mis_iqd.lineage import CitationBuilder, LineageExtractor
from src.agent.mis_iqd.mcp_watchdog import McpConnectionWatchdog
from src.agent.mis_iqd.masking import MaskingEngine, MaskOutcome
from src.agent.mis_iqd.nl2sql import CubeQuerySpec, Nl2SqlGenerator, Nl2SqlResult
from src.agent.mis_iqd.plan_mapper import PlanMapper
from src.agent.mis_iqd.rules_context import RuleContext
from src.agent.mis_iqd.sql_guard import SqlGuard
from src.agent.mis_iqd.sql_errors import (
    is_infra_error as _is_infra_error_text,
    is_repairable_sql_error as _is_repairable_sql_error_text,
)
from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    RowScopeInjectOutcome,
    ScopeResolver,
)
from src.models.iqd_schema import (
    AskRequest,
    AskResponse,
    ColumnMeta,
    Citation,
    PlanStep,
    ResultData,
    RESULT_STATUS_FAILED,
    RESULT_STATUS_SUCCEEDED,
    RESULT_STATUS_UNSUPPORTED,
)
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.orchestrator")

def _build_default_watchdog() -> McpConnectionWatchdog | None:
    """按配置构造默认连接看门狗（阈值 <= 0 时返回 ``None`` 表示停用）。

    重启回调委托给 :class:`~src.agent.mis_iqd.mcp_lifecycle.IqdMcpLifecycleService`
    （跨机器走 agent ``/restart``，本地走进程管理器），与运营台「重启 MCP」同一路径。
    """
    from src.config import get_settings

    wren = get_settings().iqd_mcp
    threshold = int(getattr(wren, "wren_mcp_dryrun_restart_threshold", 0) or 0)
    if threshold <= 0:
        return None
    cooldown = float(
        getattr(wren, "wren_mcp_dryrun_restart_cooldown_seconds", 120.0) or 0.0
    )

    async def _restart(connection_id: int | str) -> object:
        from src.agent.mis_iqd.mcp_lifecycle import IqdMcpLifecycleService

        return await IqdMcpLifecycleService().restart_connection(int(connection_id))

    return McpConnectionWatchdog(
        threshold=threshold, cooldown_seconds=cooldown, restart=_restart
    )


@dataclass
class AskResult:
    """问数编排聚合结果（全量，投影前形态）。

    Attributes:
        response: 标准 :class:`AskResponse`（含 SQL 全量）。
        scope: 范围裁定结果（审计用）。
        wren_status_trail: WrenAI 状态轨迹（审计用，B2 可空）。
        inject_outcome: 行级注入结果（审计用，W2；无命中为 NONE）。
    """

    response: AskResponse = field(default_factory=AskResponse)
    scope: IqdScopeResolution = field(default_factory=IqdScopeResolution)
    wren_status_trail: list[dict[str, Any]] = field(default_factory=list)
    inject_outcome: RowScopeInjectOutcome = field(default_factory=RowScopeInjectOutcome)


class AskOrchestrator:
    """问数编排器。

    Args:
        mcp_client: 本地 WrenAI MCP 客户端（缺省懒加载；mock 场景注入 mock client）。
        scope_resolver: 范围裁定器（缺省懒加载）。
        lineage: SQL 血缘提取器（缺省新建）。
        plan_mapper: 计划步骤映射器（缺省新建）。
        citation_builder: 引用构建器（缺省新建）。
    """

    def __init__(
        self,
        *,
        mcp_client: IqdMcpClient | None = None,
        nl2sql: Nl2SqlGenerator | None = None,
        scope_resolver: ScopeResolver | None = None,
        lineage: LineageExtractor | None = None,
        plan_mapper: PlanMapper | None = None,
        citation_builder: CitationBuilder | None = None,
        masking_engine: MaskingEngine | None = None,
        mcp_watchdog: "McpConnectionWatchdog | None" = None,
    ) -> None:
        """初始化编排器（全部依赖可注入）。"""
        self._mcp_client: IqdMcpClient | None = mcp_client
        # 方案 A 多连接：按 connection_id 缓存专属 client（避免跨连接串台，REQ-P0-3）。
        # 单连接默认端点走 ``_mcp_client``，专属端点走本字典。
        self._mcp_clients: dict[int | str, IqdMcpClient] = {}
        self._nl2sql: Nl2SqlGenerator | None = nl2sql
        self._scope_resolver: ScopeResolver | None = scope_resolver
        self._lineage: LineageExtractor = lineage or LineageExtractor()
        self._plan_mapper: PlanMapper = plan_mapper or PlanMapper()
        self._citation_builder: CitationBuilder = citation_builder or CitationBuilder()
        self._masking_engine: MaskingEngine = masking_engine or MaskingEngine()
        self._mcp_watchdog: McpConnectionWatchdog | None = (
            mcp_watchdog if mcp_watchdog is not None else _build_default_watchdog()
        )

    # ================================================================ 主入口

    async def ask(
        self,
        request: AskRequest,
        identity: AskIdentity,
        resolution: IqdScopeResolution,
        *,
        context_native: dict[str, Any] | None = None,
    ) -> AskResult:
        """执行一次完整问数。

        Args:
            request: 问数请求。
            identity: 问数身份（审计用）。
            resolution: 前置范围裁定结果（scope_check 已通过）。
            context_native: WrenAI get_context 原生产物（引用来源；可空）。

        Returns:
            全量 :class:`AskResult`。

        Raises:
            IqdError: 452xx 系列错误（fail-closed）。
        """
        started_at = perf_counter()
        query_id: str = f"q-{uuid4().hex[:12]}"
        steps: list[PlanStep] = self._plan_mapper.build_empty()
        self._plan_mapper.mark_done(steps, "scope_check", detail=self._scope_detail(resolution))

        mcp = self._get_mcp_client(resolution.connection_id)
        plan = self._plan_mapper

        # ===== understanding + searching（get_context）=====
        plan.mark_done(steps, "understanding")
        native: dict[str, Any] = context_native or {}
        try:
            if not native:
                # 真机（0.13.3）get_context 必填 question：只传 role_scope 会校验失败，
                # 而旧实现把异常吞成 native={} → 语义上下文一直是空的（2026-09-28 实测）。
                native = await mcp.get_context(question=request.question)
            plan.mark_done(
                steps,
                "searching",
                detail=self._search_detail(native),
            )
        except Exception as exc:  # noqa: BLE001 - 上下文获取失败降级为空引用，不阻断主链路
            # 可观测性（2026-09-28）：语义上下文缺失会让生成质量明显下降（少列/臆造列），
            # 但以前只写日志 —— 界面上看不出「本轮没有语义上下文」。
            # 这里把 searching 步标 skipped 并写明原因，plan[] 会随响应回给前端。
            logger.warning("IQD get_context degraded", error=str(exc))
            native = {}
            plan.mark(
                steps,
                "searching",
                "skipped",
                detail=f"语义上下文不可得，已降级：{self._brief_error(exc)}",
            )

        # ===== cube 优先（2026-09-28）：命中 cube 时用结构化聚合替代手写 SQL =====
        # 设计：cube 只做「SQL 生成器」—— 生成出的 SQL 仍走原有
        # inject_row_scope → lineage 断言 → dry_run → run_sql 管线，安全链路零改动。
        # 血缘断言天然兜住越权：cube 若引用了未授权模型，lineage 会 fail-closed。
        # 命中时把结果包装成等价的 Nl2SqlResult(type=text_to_sql, sql=<cube 生成 SQL>)，
        # 后续零改动复用同一管线；未命中/失败一律降级到 NL→SQL（cube_error 记原因）。
        cube_outcome: CubeQuerySpec | None = None
        cube_error: str = ""
        try:
            cube_outcome, cube_error = await self._try_cube_query(
                mcp,
                native,
                resolution=resolution,
                question=request.question,
                identity=identity,
            )
        except Exception as exc:  # noqa: BLE001 - cube 分支任何异常都降级到 NL→SQL
            logger.warning("IQD cube branch degraded", error=str(exc))
            cube_outcome = None
            cube_error = self._brief_error(exc)

        # ===== NL→SQL（平台 LLM Gateway）+ dry_plan（Wren 方言转译）=====
        plan.mark(steps, "generating", "running")
        context_text, described_models = await self._build_nl2sql_context(
            mcp,
            native,
            resolution.allowed_item_keys,
            question=request.question,
        )
        # 授权 item_key 若无法在 Wren 落成模型（如 pg_main.public.orders），
        # 本轮 describe 成功的模型名并入血缘放行集，避免「有列上下文却被 45204 挡住」。
        lineage_extra = self._lineage_extra_models(
            resolution.allowed_item_keys, described_models
        )
        nl2sql = self._get_nl2sql(prefer_mock=bool(getattr(mcp, "_mock", False)))
        nl2sql_attempts: list[dict[str, Any]] = []

        def _record_attempt(outcome: Any, *, label: str) -> None:
            nl2sql_attempts.append(
                {
                    "label": label,
                    "prompt_system": getattr(outcome, "prompt_system", "") or "",
                    "prompt_user": getattr(outcome, "prompt_user", "") or "",
                    "raw_output": getattr(outcome, "raw", "") or "",
                    "type": getattr(outcome, "type", "") or "",
                    "sql": getattr(outcome, "sql", "") or "",
                    "summary": getattr(outcome, "summary", "") or "",
                }
            )

        nl_outcome: Nl2SqlResult | None = None
        if cube_outcome is not None and cube_outcome.type == "cube_query":
            plan.mark_done(
                steps,
                "generating",
                detail=(
                    f"命中 cube「{cube_outcome.cube}」结构化聚合"
                    f"（{len(cube_outcome.measures)} 度量"
                    + (f" / {len(cube_outcome.dimensions)} 维度" if cube_outcome.dimensions else "")
                    + "）"
                ),
                sql=cube_outcome.sql,
            )
            nl_outcome = Nl2SqlResult(
                type="text_to_sql",
                sql=cube_outcome.sql,
                raw=getattr(cube_outcome, "raw", ""),
                prompt_system=getattr(cube_outcome, "prompt_system", ""),
                prompt_user=getattr(cube_outcome, "prompt_user", ""),
            )
            _record_attempt(nl_outcome, label="cube")

        try:
            if nl_outcome is None:
                nl_outcome = await nl2sql.generate(
                    question=request.question,
                    context=context_text,
                    allowed_tables=resolution.allowed_item_keys,
                    user_id=str(identity.user_id or ""),
                    session_id=str(request.thread_id or query_id),
                )
                _record_attempt(nl_outcome, label="generate")
        except Exception as exc:
            plan.mark(steps, "generating", "failed", detail="自然语言转 SQL 失败")
            return self._failed_ask_result(
                query_id=query_id,
                request=request,
                resolution=resolution,
                steps=steps,
                started_at=started_at,
                message=f"未能生成有效查询: {exc}",
                nl2sql_attempts=nl2sql_attempts,
                sql=None,
                context_text=context_text,
            )

        if str(nl_outcome.type or "").upper() == "GENERAL":
            # 已有授权表时，不应把「查销售额」类问题当成闲聊；降级为可重试的 SQL 失败
            if resolution.allowed_item_keys:
                plan.mark(steps, "generating", "failed", detail="未能生成有效查询")
                return self._failed_ask_result(
                    query_id=query_id,
                    request=request,
                    resolution=resolution,
                    steps=steps,
                    started_at=started_at,
                    message=(
                        nl_outcome.summary
                        or "未能根据当前授权表生成有效查询，请检查语义模型或换一种问法"
                    ),
                    nl2sql_attempts=nl2sql_attempts,
                    sql=None,
                    context_text=context_text,
                )
            plan.mark_done(steps, "generating", detail="非数据类问题")
            raise QuestionUnsupportedError(summary=nl_outcome.summary or "")

        sql: str = (nl_outcome.sql or "").strip()
        if not sql:
            plan.mark(steps, "generating", "failed", detail="未能生成有效查询")
            return self._failed_ask_result(
                query_id=query_id,
                request=request,
                resolution=resolution,
                steps=steps,
                started_at=started_at,
                message="未能生成有效查询",
                nl2sql_attempts=nl2sql_attempts,
                sql=None,
                context_text=context_text,
            )

        sql = await self._transpile_sql(mcp, sql)

        # ===== 行级注入（W2）：生成 SQL → inject_row_scope（多维度 AND）=====
        inject_outcome: RowScopeInjectOutcome = await self._inject_row_scope(
            sql, resolution, identity
        )
        if inject_outcome.verdict == "deny":
            plan.mark(
                steps,
                "lineage_check",
                "failed",
                detail=inject_outcome.denied_reason or "行级范围校验拒绝",
            )
            raise ScopeDeniedError(inject_outcome.denied_reason or "当前角色无权查询相关数据")
        final_sql: str = inject_outcome.sql or sql
        plan.mark_done(
            steps,
            "generating",
            detail="SQL 已生成" + ("（含行级范围）" if inject_outcome.dimensions else ""),
            sql=final_sql,
        )

        # ===== lineage_check：血缘后置断言（fail-closed，基于注入后最终 SQL）=====
        tables: list[str] = self._lineage.extract_tables(final_sql)
        self._scope_resolver_assert(resolution, tables, extra_allowed=lineage_extra)
        plan.mark_done(
            steps,
            "lineage_check",
            detail=self._lineage_detail(tables, resolution),
        )

        # ===== dry_run：确认可执行；列错误时带 repair_hint 重生成一次 =====
        plan.mark(steps, "executing", "running")
        try:
            await mcp.dry_run(final_sql)
            self._watchdog_success(resolution.connection_id)
        except Exception as exc:
            await self._watchdog_failure(resolution.connection_id, exc)
            if not self._is_repairable_sql_error(exc):
                # 基础设施 / 连接类错误 vs 真正的 SQL 语法/列错误，分开定性与定码：
                #   基础设施 → 45202「服务暂不可用，稍后重试」（不该暗示用户换说法）
                #   其它     → 45205「未能生成有效查询」
                infra = self._is_infra_error(exc)
                if infra:
                    plan.mark(
                        steps, "executing", "failed",
                        detail=f"SQL 预检失败：底层数据源连接中断（{exc}）",
                    )
                else:
                    plan.mark(steps, "executing", "failed", detail="SQL 预检失败")
                return self._failed_ask_result(
                    query_id=query_id,
                    request=request,
                    resolution=resolution,
                    steps=steps,
                    started_at=started_at,
                    message=(
                        f"问数服务暂不可用（数据源连接异常）: {exc}"
                        if infra
                        else f"未能生成有效查询: {exc}"
                    ),
                    nl2sql_attempts=nl2sql_attempts,
                    sql=final_sql,
                    inject_outcome=inject_outcome,
                    error_code="45202" if infra else "45205",
                    context_text=context_text,
                )
            logger.warning(
                "IQD dry_run repairable error; regenerating SQL once",
                error=str(exc),
            )
            try:
                repaired = await nl2sql.generate(
                    question=request.question,
                    context=context_text,
                    allowed_tables=resolution.allowed_item_keys,
                    user_id=str(identity.user_id or ""),
                    session_id=str(request.thread_id or query_id),
                    repair_hint=(
                        f"previous_sql:\n{final_sql}\n\n"
                        f"engine_error:\n{exc}"
                    ),
                )
                _record_attempt(repaired, label="repair")
            except Exception as regen_exc:
                plan.mark(steps, "executing", "failed", detail="SQL 预检失败（重生成异常）")
                return self._failed_ask_result(
                    query_id=query_id,
                    request=request,
                    resolution=resolution,
                    steps=steps,
                    started_at=started_at,
                    message=f"未能生成有效查询: {exc}",
                    nl2sql_attempts=nl2sql_attempts,
                    sql=final_sql,
                    inject_outcome=inject_outcome,
                    error_detail=str(regen_exc),
                    context_text=context_text,
                )

            repaired_sql = (repaired.sql or "").strip()
            if not repaired_sql or str(repaired.type or "").upper() == "GENERAL":
                plan.mark(steps, "executing", "failed", detail="SQL 预检失败")
                return self._failed_ask_result(
                    query_id=query_id,
                    request=request,
                    resolution=resolution,
                    steps=steps,
                    started_at=started_at,
                    message=f"未能生成有效查询: {exc}",
                    nl2sql_attempts=nl2sql_attempts,
                    sql=final_sql,
                    inject_outcome=inject_outcome,
                    context_text=context_text,
                )

            repaired_sql = await self._transpile_sql(mcp, repaired_sql)
            inject_outcome = await self._inject_row_scope(
                repaired_sql, resolution, identity
            )
            if inject_outcome.verdict == "deny":
                plan.mark(
                    steps,
                    "lineage_check",
                    "failed",
                    detail=inject_outcome.denied_reason or "行级范围校验拒绝",
                )
                raise ScopeDeniedError(
                    inject_outcome.denied_reason or "当前角色无权查询相关数据"
                )
            final_sql = inject_outcome.sql or repaired_sql
            tables = self._lineage.extract_tables(final_sql)
            self._scope_resolver_assert(
                resolution, tables, extra_allowed=lineage_extra
            )
            try:
                await mcp.dry_run(final_sql)
                self._watchdog_success(resolution.connection_id)
            except Exception as retry_exc:
                await self._watchdog_failure(resolution.connection_id, retry_exc)
                retry_infra = self._is_infra_error(retry_exc)
                plan.mark(steps, "executing", "failed", detail="SQL 预检失败（重试后）")
                return self._failed_ask_result(
                    query_id=query_id,
                    request=request,
                    resolution=resolution,
                    steps=steps,
                    started_at=started_at,
                    message=(
                        f"问数服务暂不可用（数据源连接异常）: {retry_exc}"
                        if retry_infra
                        else f"未能生成有效查询: {retry_exc}"
                    ),
                    nl2sql_attempts=nl2sql_attempts,
                    sql=final_sql,
                    inject_outcome=inject_outcome,
                    error_code="45202" if retry_infra else "45205",
                    context_text=context_text,
                )
            plan.mark_done(
                steps,
                "generating",
                detail="SQL 已按列错误重生成",
                sql=final_sql,
            )

        # ===== run_sql：执行注入后 SQL =====
        try:
            run_outcome: dict[str, Any] = await mcp.run_sql(final_sql)
        except Exception as exc:
            plan.mark(steps, "executing", "failed", detail="查询执行失败")
            return self._failed_ask_result(
                query_id=query_id,
                request=request,
                resolution=resolution,
                steps=steps,
                started_at=started_at,
                message=f"问数服务暂不可用: {exc}",
                nl2sql_attempts=nl2sql_attempts,
                sql=final_sql,
                inject_outcome=inject_outcome,
                error_code="45202",
                context_text=context_text,
            )

        # ===== masking（W2：唯一脱敏出口）=====
        mask_outcome: MaskOutcome = await self._apply_masking(run_outcome, resolution)
        data: ResultData = self._build_result_data(run_outcome, mask_outcome)
        answer_summary: str = str(run_outcome.get("summary") or "").strip()
        if not answer_summary:
            answer_summary = f"查询返回 {data.row_count} 行结果。"
        plan.mark_done(
            steps,
            "executing",
            detail=f"返回 {data.row_count} 行",
        )

        plan.mark_done(steps, "masking", detail=self._mask_detail(mask_outcome))

        # ===== citations（W4：原生 + 平台知识缓存统一归一化）=====
        knowledge_cache: list[dict[str, Any]] = []
        try:
            knowledge_cache = await self._get_config_client().get_knowledge(
                resolution.connection_id
            )
        except Exception as exc:  # noqa: BLE001 - 知识缓存不可得仅降级引用，不阻断主链路
            logger.warning("IQD knowledge cache degraded", error=str(exc))
        citations: list[Citation] = self._citation_builder.merge_native_citations(
            native,
            knowledge=knowledge_cache,
            allowed_item_keys=resolution.allowed_item_keys,
        )
        plan.mark_done(steps, "finished")

        latency_ms: int = max(0, int((perf_counter() - started_at) * 1000))
        response = AskResponse(
            query_id=query_id,
            thread_id=request.thread_id,
            status=RESULT_STATUS_SUCCEEDED,
            answer_summary=answer_summary,
            sql=final_sql,
            sql_dialect="postgres",
            data=data,
            citations=citations,
            plan=steps,
            scope=resolution.to_payload(),
            masked_columns=mask_outcome.masked_columns,
            latency_ms=latency_ms,
            error_code=None,
            error_message=None,
            nl2sql_debug=self._nl2sql_debug_payload(nl2sql_attempts, context_text),
        )
        logger.info(
            "IQD ask succeeded",
            query_id=query_id,
            user_id=identity.user_id,
            rows=data.row_count,
            latency_ms=latency_ms,
        )
        return AskResult(
            response=response,
            scope=resolution,
            inject_outcome=inject_outcome,
        )

    # ================================================================ 内部

    def _failed_ask_result(
        self,
        *,
        query_id: str,
        request: AskRequest,
        resolution: IqdScopeResolution,
        steps: list[PlanStep],
        started_at: float,
        message: str,
        nl2sql_attempts: list[dict[str, Any]],
        sql: str | None,
        inject_outcome: RowScopeInjectOutcome | None = None,
        error_code: str = "45205",
        error_detail: str = "",
        context_text: str = "",
    ) -> AskResult:
        """SQL 生成/预检失败时返回 failed 帧（携带 nl2sql_debug，便于测试台排查）。"""
        self._plan_mapper.mark_done(steps, "finished")
        latency_ms: int = max(0, int((perf_counter() - started_at) * 1000))
        debug = self._nl2sql_debug_payload(nl2sql_attempts, context_text)
        if error_detail:
            debug["error_detail"] = error_detail[:1000]
        response = AskResponse(
            query_id=query_id,
            thread_id=request.thread_id,
            status=RESULT_STATUS_FAILED,
            answer_summary=message,
            sql=sql,
            sql_dialect="postgres" if sql else None,
            data=ResultData(),
            citations=[],
            plan=steps,
            scope=resolution.to_payload(),
            masked_columns=[],
            latency_ms=latency_ms,
            error_code=error_code,
            error_message=message,
            nl2sql_debug=debug,
        )
        logger.warning(
            "IQD ask failed with nl2sql debug",
            query_id=query_id,
            error_code=error_code,
            attempts=len(nl2sql_attempts),
        )
        return AskResult(
            response=response,
            scope=resolution,
            inject_outcome=inject_outcome or RowScopeInjectOutcome(),
        )

    @staticmethod
    def _nl2sql_debug_payload(
        attempts: list[dict[str, Any]],
        context_text: str = "",
    ) -> dict[str, Any]:
        """组装 admin 可见的 NL→SQL 调试块（截断防爆）。"""
        clipped: list[dict[str, Any]] = []
        for item in attempts:
            clipped.append(
                {
                    "label": item.get("label"),
                    "type": item.get("type"),
                    "sql": (item.get("sql") or "")[:4000],
                    "summary": (item.get("summary") or "")[:500],
                    "prompt_system": (item.get("prompt_system") or "")[:4000],
                    "prompt_user": (item.get("prompt_user") or "")[:12000],
                    "raw_output": (item.get("raw_output") or "")[:4000],
                }
            )
        latest = clipped[-1] if clipped else {}
        return {
            "attempts": clipped,
            "prompt_system": latest.get("prompt_system") or "",
            "prompt_user": latest.get("prompt_user") or "",
            "raw_output": latest.get("raw_output") or "",
            "context_chars": len(context_text or ""),
            "note": (
                "准确率依赖：① describe 列清单 ② 字段注释 ③ sql_pairs/recall 样本 "
                "④ 业务 instructions；缺样本/注释时易臆造列名。"
            ),
        }

    def _scope_detail(self, resolution: IqdScopeResolution) -> str:
        """scope_check 阶段明细。"""
        return f"命中 {len(resolution.allowed_item_keys)} 张授权表"

    @staticmethod
    def _brief_error(exc: BaseException) -> str:
        """把异常压成一行短句（用于 plan[].detail，避免把堆栈/长文本带给前端）。"""
        text = str(exc).strip().replace("\n", " ")
        if not text:
            text = type(exc).__name__
        return text[:120]

    def _search_detail(self, native: dict[str, Any]) -> str:
        """searching 阶段明细。"""
        models = native.get("models") if isinstance(native, dict) else None
        if isinstance(models, list) and models:
            names = [
                str(m.get("name") or m.get("item_key") or "")
                for m in models
                if isinstance(m, dict)
            ]
            return "检索到 " + " / ".join(n for n in names if n)[:120] or "语义模型"
        return "语义模型"

    def _lineage_detail(self, tables: list[str], resolution: IqdScopeResolution) -> str:
        """lineage_check 阶段明细。"""
        if not tables:
            return "未涉及业务表"
        return f"涉及 {len(tables)} 张表，全部在授权范围内"

    @staticmethod
    def _render_context(native: dict[str, Any]) -> str:
        """把 get_context 产物渲染为 NL→SQL 的 context 文本。"""
        parts: list[str] = []
        models = native.get("models") if isinstance(native, dict) else None
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict) and (m.get("name") or m.get("item_key")):
                    parts.append(
                        f"- {m.get('name') or m.get('item_key')}: "
                        f"{m.get('description') or ''}"
                    )
                    columns = m.get("columns") or m.get("fields")
                    if isinstance(columns, list) and columns:
                        col_bits: list[str] = []
                        for col in columns[:40]:
                            if isinstance(col, dict):
                                col_bits.append(
                                    str(col.get("name") or col.get("column") or "")
                                )
                            else:
                                col_bits.append(str(col))
                        col_bits = [c for c in col_bits if c]
                        if col_bits:
                            parts.append(f"  columns: {', '.join(col_bits)}")
        instructions = native.get("instructions") if isinstance(native, dict) else None
        if isinstance(instructions, list):
            for ins in instructions:
                if isinstance(ins, dict) and ins.get("content"):
                    parts.append(f"- 口径: {ins.get('content')}")
                elif isinstance(ins, str) and ins.strip():
                    parts.append(f"- 口径: {ins.strip()}")
        # 部分 Wren 版本把全文 schema 放在 text / schema 字段
        for key in ("text", "schema", "describe_schema"):
            blob = native.get(key) if isinstance(native, dict) else None
            if isinstance(blob, str) and blob.strip():
                parts.append(blob.strip()[:2000])
                break
        return "\n".join(parts)[:6000]

    async def _build_nl2sql_context(
        self,
        mcp: IqdMcpClient,
        native: dict[str, Any],
        allowed_tables: list[str] | None,
        *,
        question: str = "",
    ) -> tuple[str, list[str]]:
        """组装 NL→SQL 上下文：get_context + 授权表 + list_models + describe_model 列清单。

        Returns:
            ``(context_text, described_model_names)``：后者为本轮成功 describe 的模型名，
            供血缘放行补集使用。
        """
        parts: list[str] = []
        rendered = self._render_context(native)
        if rendered:
            parts.append(rendered)

        tables = [t for t in (allowed_tables or []) if t]
        if tables:
            parts.append(
                "allowed_tables (catalog scope keys; SQL FROM must use Wren MDL "
                "model names from model blocks below, not datasource.schema.table paths):"
            )
            parts.extend(f"- {t}" for t in tables[:80])

        parts.append(
            "HARD RULE: every selected column MUST appear in a model columns list; "
            "never invent partition columns like dt/ds/biz_date."
        )

        # 相似样本召回（有则极利于对齐业务口径；无样本时跳过）
        if question.strip():
            try:
                recalled = await mcp.recall_queries(question=question.strip())
                items = None
                if isinstance(recalled, dict):
                    items = (
                        recalled.get("items")
                        or recalled.get("queries")
                        or recalled.get("results")
                    )
                sample_lines: list[str] = []
                if isinstance(items, list):
                    for item in items[:5]:
                        if isinstance(item, dict):
                            q = str(
                                item.get("question")
                                or item.get("ask")
                                or item.get("query")
                                or ""
                            ).strip()
                            s = str(
                                item.get("sql")
                                or item.get("wren_sql")
                                or item.get("answer")
                                or ""
                            ).strip()
                            if q or s:
                                sample_lines.append(f"- Q: {q[:200]}")
                                if s:
                                    sample_lines.append(f"  SQL: {s[:500]}")
                        elif isinstance(item, str) and item.strip():
                            sample_lines.append(f"- {item.strip()[:300]}")
                if sample_lines:
                    parts.append("similar_sql_pairs (few-shot samples):")
                    parts.extend(sample_lines)
            except Exception as exc:  # noqa: BLE001
                logger.debug("IQD recall_queries for nl2sql skipped", error=str(exc))

        # 业务规则 / 术语（knowledge/rules/*.md）：wren ``get_instructions`` 直读。
        # 真机（2026-09-28）：该工具此前**从未被调用** —— 规则下发了却对问数无效。
        # 这段是「口径」类硬约束（如 ads_* 必须过滤 data_type），必须进 NL→SQL 上下文。
        rules_error: str = ""
        try:
            rules = await mcp.get_instructions()
            rules_text = RuleContext.extract(rules)
            if rules_text:
                parts.append("business_rules (MUST follow; from knowledge/rules):")
                parts.append(rules_text)
        except Exception as exc:  # noqa: BLE001 - 规则不可得仅降级，不阻断主链路
            # 规则缺失会让「口径类问题」（如 ads_* 必须过滤 data_type）重新变回裸生成，
            # 用 warning 留痕（get_context 的降级另有 plan 标记）。
            rules_error = self._brief_error(exc)
            logger.warning("IQD get_instructions for nl2sql degraded", error=rules_error)

        candidates = self._collect_model_candidates(native, tables)
        listed_names: list[str] = []
        try:
            listed = await mcp.list_models()
            raw_models = listed.get("models") if isinstance(listed, dict) else None
            if isinstance(raw_models, list):
                for item in raw_models:
                    if isinstance(item, dict):
                        name = str(item.get("name") or item.get("model") or "")
                    else:
                        name = str(item)
                    if name:
                        listed_names.append(name)
                        if name not in candidates:
                            candidates.append(name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("IQD list_models for nl2sql degraded", error=str(exc))

        ranked = self._rank_model_candidates(candidates, question=question, allowed=tables)
        described_names: list[str] = []
        for model_name in ranked[:5]:
            block = await self._describe_model_block(mcp, model_name)
            if block:
                if not described_names:
                    parts.append("model_schemas (authoritative columns):")
                described_names.append(model_name)
                parts.append(block)

        if not described_names and listed_names:
            parts.append("available_models:")
            parts.extend(f"- {n}" for n in listed_names[:40])

        return "\n".join(parts)[:8000], described_names

    async def _try_cube_query(
        self,
        mcp: IqdMcpClient,
        native: dict[str, Any],
        *,
        resolution: IqdScopeResolution,
        question: str,
        identity: AskIdentity,
    ) -> tuple[CubeQuerySpec | None, str]:
        """尝试走 cube 结构化聚合；命中则返回带 SQL 的规格。

        流程（**cube 只做 SQL 生成器**）：
        1. ``list_cubes`` 取工程内 cube 清单（MCP 读 YAML 真源，2026-09-28 已打通）；
        2. 用问题与 cube 名/度量/维度做关键词打分，挑最可能的 cube（无把握就不命中）；
        3. LLM 产出 cube 查询规格（``generate_cube_query``，只选清单内的度量/维度）；
        4. ``query_cube(sql_only=True)`` 让 wren 生成 SQL；
        5. 返回规格 + SQL，交给主链路原有的
           ``inject_row_scope → lineage 断言 → dry_run → run_sql`` 继续。

        **安全**：第 5 步的血缘断言是兜底 —— 若 cube 引用了未授权模型，会在
        ``_scope_resolver_assert`` 处 fail-closed，无需在 cube 分支另建一套授权。

        Returns:
            ``(spec | None, reason)``：未命中或失败时 spec 为 ``None``，reason 供日志/降级说明。
        """
        # 1) cube 清单
        try:
            listed = await mcp.list_cubes()
        except Exception as exc:  # noqa: BLE001
            return None, f"list_cubes 不可用: {exc}"
        cubes = listed.get("cubes") if isinstance(listed, dict) else None
        if not isinstance(cubes, list) or not cubes:
            return None, "工程内无 cube"

        # 2) 选 cube（关键词打分；无把握不命中，避免把普通问数强行套 cube）
        picked = self._pick_cube(cubes, question=question)
        if picked is None:
            return None, "未匹配到合适 cube"

        cube_name = str(picked.get("name") or "").strip()
        measures = self._cube_child_names(picked, "measures")
        dimensions = self._cube_child_names(picked, "dimensions")
        time_dims = self._cube_child_names(
            picked, "time_dimensions", "timeDimensions"
        )
        if not cube_name or not measures:
            return None, "cube 缺名字或度量"

        # 3) LLM 出规格
        nl2sql = self._get_nl2sql(prefer_mock=bool(getattr(mcp, "_mock", False)))
        spec = await nl2sql.generate_cube_query(
            question=question,
            cube=cube_name,
            measures=measures,
            dimensions=dimensions,
            time_dimensions=time_dims,
            allowed_tables=resolution.allowed_item_keys,
            user_id=str(identity.user_id or ""),
            session_id=question[:64],
        )
        if spec.type != "cube_query":
            return None, f"LLM 判为非 cube 问题（{spec.type}）"
        if not spec.measures:
            return None, "LLM 未选出度量"

        # 4) 白名单校验：LLM 只能选清单内的名字（防臆造）
        allowed_m = set(measures)
        allowed_d = set(dimensions) | set(time_dims)
        bad = [m for m in spec.measures if m not in allowed_m]
        if bad:
            return None, f"度量越界: {bad}"
        bad_d = [d for d in spec.dimensions if d not in allowed_d]
        if bad_d:
            return None, f"维度越界: {bad_d}"
        picked_td = ""
        if spec.time_dimension:
            head = spec.time_dimension.split(":", 1)[0].strip()
            if head not in allowed_d:
                return None, f"时间维度越界: {spec.time_dimension}"
            picked_td = spec.time_dimension

        # 5) wren 生成 SQL
        payload = spec.to_payload()
        if picked_td:
            payload["time_dimension"] = picked_td
        payload["sql_only"] = True
        try:
            generated = await mcp.query_cube(**payload)
        except Exception as exc:  # noqa: BLE001
            return None, f"query_cube 规划失败: {exc}"
        sql = ""
        if isinstance(generated, dict):
            sql = str(generated.get("sql") or "").strip()
        if not sql:
            return None, "query_cube 未返回 SQL"

        spec.sql = sql
        logger.info(
            "IQD cube query planned",
            cube=cube_name,
            measures=spec.measures,
            dimensions=spec.dimensions,
            sql_chars=len(sql),
        )
        return spec, ""

    @staticmethod
    def _cube_child_names(cube: dict[str, Any], *keys: str) -> list[str]:
        """取 cube 下 measure/dimension 的名字清单（兼容 camelCase/snake_case）。"""
        for key in keys:
            value = cube.get(key)
            if isinstance(value, list):
                names: list[str] = []
                for item in value:
                    if isinstance(item, dict):
                        name = str(item.get("name") or "").strip()
                    else:
                        name = str(item).strip()
                    if name:
                        names.append(name)
                if names:
                    return names
        return []

    @classmethod
    def _pick_cube(
        cls, cubes: list[Any], *, question: str
    ) -> dict[str, Any] | None:
        """按问题与 cube 名/度量/维度的中文/英文词重合度挑 cube；平局或无信号则不命中。

        <p>刻意保守：只有得分 > 0 且显著高于次席时才命中 —— cube 适合聚合类问题，
        普通明细问数交给 NL→SQL 更稳。
        """
        q = (question or "").lower()
        if not q.strip():
            return None
        scored: list[tuple[int, dict[str, Any]]] = []
        for item in cubes:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            score = 0
            if name.lower() in q:
                score += 10
            for token in re.split(r"[^0-9a-z_\u4e00-\u9fff]+", name.lower()):
                if len(token) >= 3 and token in q:
                    score += 3
            for child in cls._cube_child_names(item, "measures", "dimensions"):
                if child.lower() in q:
                    score += 2
            if score > 0:
                scored.append((score, item))
        if not scored:
            return None
        scored.sort(key=lambda pair: pair[0], reverse=True)
        if len(scored) > 1 and scored[0][0] <= scored[1][0]:
            return None  # 打平 → 不冒险
        return scored[0][1]

    @staticmethod
    def _lineage_extra_models(
        allowed_tables: list[str] | None,
        described_models: list[str],
    ) -> list[str]:
        """当授权键在 Wren 侧无同名模型时，把本轮 describe 成功的模型并入血缘放行集。"""
        if not described_models:
            return []
        allowed = [t for t in (allowed_tables or []) if t]
        if not allowed:
            return list(described_models)
        allowed_norm = {a.lower() for a in allowed}
        allowed_shorts = {a.rsplit(".", 1)[-1].lower() for a in allowed}
        # 任一授权键已能对上 describe 模型 → 不扩权
        for name in described_models:
            low = name.lower()
            short = low.rsplit(".", 1)[-1]
            if low in allowed_norm or short in allowed_shorts:
                return []
        return list(described_models)

    @staticmethod
    def _collect_model_candidates(
        native: dict[str, Any],
        allowed_tables: list[str],
    ) -> list[str]:
        """从 get_context / 授权表收集候选 Wren 模型名（保序去重）。"""
        names: list[str] = []
        seen: set[str] = set()

        def _add(raw: str) -> None:
            name = (raw or "").strip()
            if not name or name in seen:
                return
            seen.add(name)
            names.append(name)

        models = native.get("models") if isinstance(native, dict) else None
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict):
                    _add(str(m.get("name") or m.get("item_key") or ""))
                else:
                    _add(str(m))

        for key in allowed_tables:
            _add(key)
            # pg_main.public.orders → orders
            short = key.rsplit(".", 1)[-1].strip()
            if short and short != key:
                _add(short)

        return names

    @staticmethod
    def _rank_model_candidates(
        candidates: list[str],
        *,
        question: str,
        allowed: list[str],
    ) -> list[str]:
        """按问题关键词与授权表短名给候选模型打分排序。"""
        q = (question or "").lower()
        tokens = {
            t
            for t in re.split(r"[\s/_\-]+", q)
            if len(t) >= 2
        }
        # 中文业务词补充（与常见 ads_* 命名对齐）
        for word, aliases in (
            ("销售", ("sale", "sales", "gmv", "trd", "order")),
            ("门店", ("store", "shop", "spm")),
            ("订单", ("order", "ord", "trd")),
            ("客户", ("customer", "cust", "user", "member")),
            ("成本", ("cost",)),
            ("季度", ("day", "date", "ord_date")),
            ("上季", ("day", "date")),
        ):
            if word in (question or ""):
                tokens.update(aliases)

        allowed_shorts = {
            a.rsplit(".", 1)[-1].lower() for a in allowed if a
        }

        scored: list[tuple[int, str]] = []
        for name in candidates:
            low = name.lower()
            score = 0
            short = low.rsplit(".", 1)[-1]
            if short in allowed_shorts or low in {a.lower() for a in allowed}:
                score += 50
            for tok in tokens:
                if tok in low:
                    score += 10
            # 日表/销售相关轻度偏好（无命中也不惩罚）
            if any(x in low for x in ("sale", "order", "trd", "store", "spm")):
                score += 3
            scored.append((score, name))

        scored.sort(key=lambda x: (-x[0], x[1]))
        return [n for _, n in scored]

    async def _describe_model_block(
        self,
        mcp: IqdMcpClient,
        model_name: str,
    ) -> str:
        """调用 describe_model，渲染为带列清单的上下文块；失败返回空串。"""
        try:
            payload = await mcp.describe_model(model_name)
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "IQD describe_model for nl2sql skipped",
                model=model_name,
                error=str(exc),
            )
            return ""
        if not isinstance(payload, dict):
            return ""

        name = str(payload.get("name") or model_name)
        desc = str(payload.get("description") or payload.get("display_name") or "")
        raw_fields = payload.get("fields") or payload.get("columns") or []
        col_bits: list[str] = []
        if isinstance(raw_fields, list):
            for col_item in raw_fields[:80]:
                if isinstance(col_item, dict):
                    col = str(
                        col_item.get("name")
                        or col_item.get("column")
                        or col_item.get("column_name")
                        or ""
                    )
                    dtype = str(col_item.get("type") or col_item.get("data_type") or "")
                    comment = str(
                        col_item.get("comment")
                        or col_item.get("description")
                        or col_item.get("display_name")
                        or ""
                    ).strip()
                    if col:
                        bit = f"{col}:{dtype}" if dtype else col
                        if comment:
                            bit = f"{bit}({comment[:40]})"
                        col_bits.append(bit)
                else:
                    text = str(col_item).strip()
                    if text:
                        col_bits.append(text)
        if not col_bits:
            return ""

        lines = [f"model: {name}"]
        if desc:
            lines.append(f"  description: {desc[:200]}")
        lines.append(f"  columns: {', '.join(col_bits)}")
        return "\n".join(lines)

    async def _transpile_sql(self, mcp: IqdMcpClient, sql: str) -> str:
        """Wren dry_plan：MDL SQL → 目标方言；失败时沿用原 SQL。"""
        try:
            # 真机实测（2026-09-28）：wren 的 SQL 重写会因 LIMIT 报 1064
            # （连 `SELECT c FROM t LIMIT 1` 都失败）；行数截断应用 run_sql(limit=)。
            # 这里兜底剥掉最外层尾部 LIMIT，避免 LLM 违反提示词就打挂整条查询。
            guarded_sql, _stripped_limit = SqlGuard.strip_trailing_limit(sql)
            plan_outcome: dict[str, Any] = await mcp.dry_plan(sql=guarded_sql)
            translated = str(plan_outcome.get("sql") or "").strip()
            if translated:
                return translated
        except Exception as exc:  # noqa: BLE001
            logger.warning("IQD dry_plan transpile degraded", error=str(exc))
        return sql

    @staticmethod
    def _is_column_error(exc: BaseException) -> bool:
        """判断是否为列不存在类错误（可触发一次重生成）。"""
        return AskOrchestrator._is_repairable_sql_error(exc)

    @staticmethod
    def _is_repairable_sql_error(exc: BaseException) -> bool:
        """列错误或 DataFusion 方言错误 → 允许带 repair_hint 重生成一次。

        <b>先判基础设施错误</b>：连接中断 / 超时 / wren 预检通用错误等**绝不可修复**，
        重生成 SQL 只会白烧一次 LLM 调用（故障期实测多耗 3~5s，且必然再次失败）。
        判定逻辑收敛在 :mod:`src.agent.mis_iqd.sql_errors`（与看门狗共用，避免循环导入）。
        """
        return _is_repairable_sql_error_text(exc)

    @staticmethod
    def _is_infra_error(exc: BaseException) -> bool:
        """是否基础设施 / 连接类错误（据此把错误码归到 45202 而非 45205）。"""
        return _is_infra_error_text(exc)

    def _get_nl2sql(self, *, prefer_mock: bool = False) -> Nl2SqlGenerator:
        """懒加载 NL→SQL 生成器；MCP mock 时默认走 mock 生成，避免离线无 Key 断链。"""
        if self._nl2sql is not None:
            return self._nl2sql
        self._nl2sql = Nl2SqlGenerator(mock=prefer_mock)
        return self._nl2sql

    def _build_result_data(
        self,
        run_outcome: dict[str, Any],
        mask_outcome: MaskOutcome | None = None,
    ) -> ResultData:
        """从 run_sql 产物构建结果集（截断上限 1000 行 / 50 列；脱敏优先）。"""
        columns: list[Any] = []
        raw_columns: Any = run_outcome.get("columns")
        if mask_outcome is not None and mask_outcome.columns:
            # 脱敏后的列元信息（masked 标记已置位）
            raw_columns = mask_outcome.columns
        if isinstance(raw_columns, list):
            for col in raw_columns:
                if isinstance(col, ColumnMeta):
                    columns.append(col)
                elif isinstance(col, dict):
                    columns.append(
                        ColumnMeta(
                            name=str(col.get("name") or ""),
                            item_key=str(col.get("item_key") or col.get("name") or ""),
                            data_type=str(col.get("data_type") or ""),
                            display_name=str(col.get("display_name") or col.get("name") or ""),
                            masked=bool(col.get("masked") or False),
                        )
                    )
                else:
                    columns.append(ColumnMeta(name=str(col), display_name=str(col)))
        columns = columns[:50]
        col_names = [c.name for c in columns]

        rows: list[list[Any]] = []
        raw_rows: Any = run_outcome.get("rows")
        # apply 已归一化并可能脱敏；有列元信息说明脱敏阶段已跑过，优先用其 rows
        if mask_outcome is not None and mask_outcome.columns:
            raw_rows = mask_outcome.rows
        if isinstance(raw_rows, list):
            rows = self._normalize_result_rows(raw_rows[:1000], col_names)

        return ResultData(
            columns=columns,
            rows=rows,
            row_count=len(rows),
            truncated=bool(run_outcome.get("truncated") or len(rows) > 1000),
        )

    @staticmethod
    def _normalize_result_rows(
        raw_rows: list[Any],
        col_names: list[str],
    ) -> list[list[Any]]:
        """把 run_sql 的 list/tuple 或 dict 行统一为二维 list。"""
        rows: list[list[Any]] = []
        for row in raw_rows:
            if isinstance(row, (list, tuple)):
                rows.append(list(row))
            elif isinstance(row, dict):
                if col_names:
                    rows.append([row.get(name) for name in col_names])
                else:
                    rows.append(list(row.values()))
        return rows

    async def _inject_row_scope(
        self,
        sql: str,
        resolution: IqdScopeResolution,
        identity: AskIdentity,
    ) -> RowScopeInjectOutcome:
        """行级注入：无命中表/维度时原样返回（NONE）。"""
        resolver = self._get_scope_resolver()
        return await resolver.inject_row_scope(sql, "postgres", resolution, identity)

    async def _apply_masking(
        self,
        run_outcome: dict[str, Any],
        resolution: IqdScopeResolution,
    ) -> MaskOutcome:
        """结果脱敏（唯一出口；规则缓存不可得 → fail-closed 45204）。"""
        columns: Any = run_outcome.get("columns")
        rows: Any = run_outcome.get("rows")
        if not isinstance(columns, list):
            return MaskOutcome()
        col_names = [
            str(c.get("name") if isinstance(c, dict) else getattr(c, "name", c) or "")
            for c in columns
        ]
        raw_rows: list[list[Any]] = (
            self._normalize_result_rows(rows, col_names) if isinstance(rows, list) else []
        )
        return await self._masking_engine.apply(
            columns,
            raw_rows,
            connection_id=resolution.connection_id,
        )

    def _mask_detail(self, outcome: MaskOutcome) -> str:
        """masking 阶段明细。"""
        if not outcome.masked_columns:
            return "无命中"
        return "脱敏 " + ", ".join(outcome.masked_columns)

    def _scope_resolver_assert(
        self,
        resolution: IqdScopeResolution,
        tables: list[str],
        *,
        extra_allowed: list[str] | None = None,
    ) -> None:
        """血缘断言（fail-closed 45204）。"""
        self._get_scope_resolver().assert_sql_within_scope(
            tables, resolution, extra_allowed=extra_allowed
        )

    # ================================================================ 依赖

    def _get_mcp_client(self, connection_id: int | str | None = None) -> IqdMcpClient:
        """按 connection_id 取该连接专属 MCP client（方案 A 多连接路由）。

        优先级：
        1. 构造时显式注入的 ``mcp_client``（golden path mock 测试 / 单连接场景）直接复用；
        2. 无 ``connection_id`` → 退化单连接默认端点（向后兼容）；
        3. 有 ``connection_id`` → 经 :meth:`IqdMcpClient.for_connection` 取专属端点，
           并缓存于 ``_mcp_clients``（同一 orchestrator 实例多次问数命中缓存、按连接隔离，
           杜绝跨连接串台，REQ-P0-3）。端点未就绪（未启动/已停止/崩溃未重启）时**降级 mock**
           （REQ-P0-1），绝不静默落到默认单连接 8080 端点。

        Args:
            connection_id: 问数连接 id（来自前置范围裁定结果）。

        Returns:
            :class:`IqdMcpClient`（绑定该连接专属端点，或降级 mock）。
        """
        # 1. 显式注入的 client 优先（注入即单连接/测试用途）
        if self._mcp_client is not None:
            return self._mcp_client
        # 2. 无 connection_id：单连接默认端点（向后兼容）
        if connection_id is None:
            self._mcp_client = IqdMcpClient()
            return self._mcp_client
        # 3. 按 connection_id 取专属端点，per-connection 缓存（REQ-P0-3）
        cached: IqdMcpClient | None = self._mcp_clients.get(connection_id)
        if cached is not None:
            return cached
        try:
            client = IqdMcpClient.for_connection(connection_id)
        except IqdMcpClientError as exc:
            logger.warning(
                "IQD MCP 端点未就绪，问数降级 mock",
                connection_id=connection_id,
                error=str(exc),
            )
            client = IqdMcpClient(mock=True)
        self._mcp_clients[connection_id] = client
        return client

    def _get_scope_resolver(self) -> ScopeResolver:
        """懒加载范围裁定器。"""
        if self._scope_resolver is None:
            self._scope_resolver = ScopeResolver()
        return self._scope_resolver

    # ---------------------------------------------------------------- 连接看门狗

    def _watchdog_success(self, connection_id: int | str | None) -> None:
        """dry_run 成功：清空该连接的连续失败计数。"""
        if self._mcp_watchdog is None or connection_id is None:
            return
        try:
            self._mcp_watchdog.record_success(connection_id)
        except Exception as exc:  # noqa: BLE001 - 看门狗绝不影响主链路
            logger.warning("IQD MCP watchdog record_success failed", error=str(exc))

    async def _watchdog_failure(
        self, connection_id: int | str | None, exc: BaseException
    ) -> None:
        """dry_run 失败：基础设施类错误累计到阈值即重启该连接的 wren 进程。

        这是连接池失效（``Server has gone away`` 且不自愈）的唯一自动恢复手段——
        进程存活探测与 MCP HTTP probe 都覆盖不到这种故障。
        """
        if self._mcp_watchdog is None or connection_id is None:
            return
        try:
            await self._mcp_watchdog.record_failure(connection_id, exc)
        except Exception as e:  # noqa: BLE001 - 看门狗绝不影响主链路
            logger.warning("IQD MCP watchdog record_failure failed", error=str(e))

    def _get_config_client(self) -> Any:
        """懒加载 IqdConfigClient（W4 知识缓存拉取）。"""
        from src.adapters.iqd_config_client import IqdConfigClient

        return IqdConfigClient()
