"""AskOrchestrator — 问数编排核心（v1.9 / B2）。

串起完整链路（architecture §5.1 步骤 10–30）::

    scope_check → get_context → dry_plan → lineage_check(断言) → dry_run
    → run_sql → citations → (write_ask_log 由 service 层在投影前调用)
    → AskResult（全量，含 SQL）

设计要点：
- **不臆造数据**：任何错误都抛出 :class:`IqdError`（452xx），由 tools 层如实上报，
  禁止 LLM 兜底编造数字（NFR-2 降级铁律）。
- **fail-closed**：范围裁定 deny / 血缘越权 → 45204，不执行、不返回任何数据。
- **可注入**：``mcp_client`` / ``scope_resolver`` / ``lineage`` / ``plan_mapper`` /
  ``citation_builder`` 全部可注入，便于离线 mock 验证（Golden path）。
- 行级注入（``inject_row_scope``）与脱敏（``MaskingEngine``）为 B3（W2）扩展钩子；
  B2 本版在 mock 下直跑，脱敏留空（``masked_columns=[]``）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from time import perf_counter
from typing import Any
from uuid import uuid4

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.agent.mis_iqd.errors import (
    QuestionUnsupportedError,
    ScopeDeniedError,
    SqlFailedError,
    WrenaiNotConfiguredError,
    WrenaiUnreachableError,
)
from src.agent.mis_iqd.lineage import CitationBuilder, LineageExtractor
from src.agent.mis_iqd.masking import MaskingEngine, MaskOutcome
from src.agent.mis_iqd.plan_mapper import PlanMapper
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
        scope_resolver: ScopeResolver | None = None,
        lineage: LineageExtractor | None = None,
        plan_mapper: PlanMapper | None = None,
        citation_builder: CitationBuilder | None = None,
        masking_engine: MaskingEngine | None = None,
    ) -> None:
        """初始化编排器（全部依赖可注入）。"""
        self._mcp_client: IqdMcpClient | None = mcp_client
        self._scope_resolver: ScopeResolver | None = scope_resolver
        self._lineage: LineageExtractor = lineage or LineageExtractor()
        self._plan_mapper: PlanMapper = plan_mapper or PlanMapper()
        self._citation_builder: CitationBuilder = citation_builder or CitationBuilder()
        self._masking_engine: MaskingEngine = masking_engine or MaskingEngine()

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

        mcp = self._get_mcp_client()
        plan = self._plan_mapper

        # ===== understanding + searching（get_context）=====
        plan.mark_done(steps, "understanding")
        native: dict[str, Any] = context_native or {}
        try:
            if not native:
                native = await mcp.get_context(role_scope=resolution.subject_summary)
            plan.mark_done(
                steps,
                "searching",
                detail=self._search_detail(native),
            )
        except Exception as exc:  # noqa: BLE001 - 上下文获取失败降级为空引用，不阻断主链路
            logger.warning("IQD get_context degraded", error=str(exc))
            native = {}

        # ===== dry_plan：生成 SQL（不执行）=====
        plan.mark(steps, "generating", "running")
        try:
            plan_outcome: dict[str, Any] = await mcp.dry_plan(
                question=request.question,
                context=self._render_context(native),
                allowed_tables=resolution.allowed_item_keys,
                language=None,
            )
        except Exception as exc:
            raise WrenaiUnreachableError(f"问数服务暂不可用: {exc}") from exc

        query_type: str = str(plan_outcome.get("type") or "text_to_sql")
        if query_type.upper() == "GENERAL":
            summary = str(plan_outcome.get("summary") or plan_outcome.get("answer") or "")
            plan.mark_done(steps, "generating", detail="非数据类问题")
            raise QuestionUnsupportedError(summary=summary)

        sql: str = str(plan_outcome.get("sql") or "").strip()
        if not sql:
            plan.mark(steps, "generating", "failed", detail="未能生成有效查询")
            raise SqlFailedError()

        # ===== 行级注入（W2）：dry 生成 SQL → inject_row_scope（多维度 AND）=====
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
        self._scope_resolver_assert(resolution, tables)
        plan.mark_done(
            steps,
            "lineage_check",
            detail=self._lineage_detail(tables, resolution),
        )

        # ===== dry_run：确认可执行 =====
        plan.mark(steps, "executing", "running")
        try:
            await mcp.dry_run(final_sql)
        except Exception as exc:
            plan.mark(steps, "executing", "failed", detail="SQL 预检失败")
            raise SqlFailedError(f"未能生成有效查询: {exc}") from exc

        # ===== run_sql：执行注入后 SQL =====
        try:
            run_outcome: dict[str, Any] = await mcp.run_sql(final_sql)
        except Exception as exc:
            plan.mark(steps, "executing", "failed", detail="查询执行失败")
            raise WrenaiUnreachableError(f"问数服务暂不可用: {exc}") from exc

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

    def _scope_detail(self, resolution: IqdScopeResolution) -> str:
        """scope_check 阶段明细。"""
        return f"命中 {len(resolution.allowed_item_keys)} 张授权表"

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
        """把 get_context 产物渲染为 dry_plan 的 context 文本。"""
        parts: list[str] = []
        models = native.get("models") if isinstance(native, dict) else None
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict) and (m.get("name") or m.get("item_key")):
                    parts.append(
                        f"- {m.get('name') or m.get('item_key')}: "
                        f"{m.get('description') or ''}"
                    )
        instructions = native.get("instructions") if isinstance(native, dict) else None
        if isinstance(instructions, list):
            for ins in instructions:
                if isinstance(ins, dict) and ins.get("content"):
                    parts.append(f"- 口径: {ins.get('content')}")
        return "\n".join(parts)[:4000]

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
                if isinstance(col, dict):
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

        rows: list[list[Any]] = []
        raw_rows: Any = run_outcome.get("rows")
        if mask_outcome is not None and mask_outcome.rows:
            raw_rows = mask_outcome.rows
        if isinstance(raw_rows, list):
            rows = [list(row) for row in raw_rows[:1000] if isinstance(row, (list, tuple))]

        return ResultData(
            columns=columns,
            rows=rows,
            row_count=len(rows),
            truncated=bool(run_outcome.get("truncated") or len(rows) > 1000),
        )

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
        raw_rows: list[list[Any]] = [
            list(row) for row in rows if isinstance(row, (list, tuple))
        ] if isinstance(rows, list) else []
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
        self, resolution: IqdScopeResolution, tables: list[str]
    ) -> None:
        """血缘断言（fail-closed 45204）。"""
        self._get_scope_resolver().assert_sql_within_scope(tables, resolution)

    # ================================================================ 依赖

    def _get_mcp_client(self) -> IqdMcpClient:
        """懒加载 MCP 客户端。"""
        if self._mcp_client is None:
            self._mcp_client = IqdMcpClient()
        return self._mcp_client

    def _get_scope_resolver(self) -> ScopeResolver:
        """懒加载范围裁定器。"""
        if self._scope_resolver is None:
            self._scope_resolver = ScopeResolver()
        return self._scope_resolver

    def _get_config_client(self) -> Any:
        """懒加载 IqdConfigClient（W4 知识缓存拉取）。"""
        from src.adapters.iqd_config_client import IqdConfigClient

        return IqdConfigClient()
