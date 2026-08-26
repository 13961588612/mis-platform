"""IqdAskService — Worker 问数服务门面（v1.9 / B2）。

把「范围裁定 → 编排 → 审计（投影前）→ 投影」串成单一入口，供
:mod:`src.agent.mis_iqd.tools` 的 ``iqd__ask`` 工具调用。

关键顺序（architecture §5.1 步骤 28–30）：
1. :meth:`ScopeResolver.resolve` 前置裁定（deny → 45204）；
2. :meth:`AskOrchestrator.ask` 编排（血缘后置断言、执行、引用）；
3. :meth:`write_ask_log` **投影前**写审计（留全量 SQL）；
4. :meth:`ResponseProjector.project` 按视图投影（user 删 SQL 键）。

审计写入经 mis-iqd 内部 API（``IqdConfigClient.write_ask_log``），Worker 不直连
mis_platform 库；审计失败**不阻断答案返回**（降级：仅记 warning，answer 照回）。

W3 扩展：:meth:`list_ask_logs` 审计回查（运营/QA 联调审计）。
W4 扩展：:meth:`list_sql_pairs` / :meth:`list_knowledge`（增强物料缓存拉取）、
:meth:`push_enhancements`（待推送物料登记）。
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from src.adapters.iqd_mcp_client import IqdMcpClient
from src.agent.mis_iqd.errors import IqdError
from src.agent.mis_iqd.sql_translate import (
    WREN_TARGET_DIALECT,
    translate_sql_pair as sql_translate_translate,
)
from src.agent.mis_iqd.orchestrator import AskOrchestrator, AskResult
from src.agent.mis_iqd.projector import ResponseProjector
from src.agent.mis_iqd.scope_resolver import AskIdentity, ScopeResolver
from src.config import get_settings
from src.models.iqd_schema import AskRequest, VIEW_USER
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.service")


class SyncResult(BaseModel):
    """增强同步作业结果（闭环 build+index+回填 的统一返回）。

    Attributes:
        connection_id: 问数连接 id。
        coalesced: 本次触发是否合并进在进行的 build（wait=false 合并窗口内为 True）。
        build_status: pending | running | success | failed（context build 阶段）。
        index_status: pending | running | success | failed | skipped（memory index 阶段）。
        build_mdl_hash: context build 返回的 mdl_hash（解析失败回退 ``wqd-*``）。
        synced_sql_pair_count: 本次回填成功的样本对数。
        synced_knowledge_count: 本次回填成功的知识条数。
        build_error: build 失败原因（成功为 None）。
        index_error: memory index 失败原因（成功/跳过为 None）。
    """

    connection_id: int | None = None
    coalesced: bool = False
    build_status: str = "pending"
    index_status: str = "pending"
    build_mdl_hash: str | None = None
    synced_sql_pair_count: int = 0
    synced_knowledge_count: int = 0
    build_error: str | None = None
    index_error: str | None = None


class IqdAskService:
    """问数服务门面。

    Args:
        scope_resolver: 范围裁定器（可注入 mock）。
        orchestrator: 问数编排器（可注入 mock mcp client）。
        projector: 结果投影器（缺省新建）。
    """

    def __init__(
        self,
        *,
        scope_resolver: ScopeResolver | None = None,
        orchestrator: AskOrchestrator | None = None,
        projector: ResponseProjector | None = None,
    ) -> None:
        """初始化服务（依赖可注入）。"""
        self._scope_resolver: ScopeResolver | None = scope_resolver
        self._orchestrator: AskOrchestrator | None = orchestrator
        self._projector: ResponseProjector = projector or ResponseProjector()

    async def ask(
        self,
        request: AskRequest,
        identity: AskIdentity,
        *,
        view: str = VIEW_USER,
        mock_allowed_keys: list[str] | None = None,
    ) -> dict[str, Any]:
        """执行一次问数并投影。

        Args:
            request: 问数请求。
            identity: 问数身份（BFF 透传头 / TaskBrief）。
            view: ``user`` / ``admin``。
            mock_allowed_keys: 离线 mock 时注入的允许表集合（跳过真实配置拉取）；
                仅测试/演示用途。

        Returns:
            投影后的 wire 字典（user 视图无 SQL）。

        Raises:
            IqdError: 452xx 系列错误（fail-closed）。
        """
        resolver = self._get_scope_resolver()
        # 使用 resolve_effective：模拟角色（metadata.iqd.simulate_role_code）时按模拟
        # role_codes 裁定，并与真实用户范围求交收紧（模拟不放大权限，T-W3-01 验收 2）
        scope = await resolver.resolve_effective(
            identity,
            request.connection_id,
            scope_hint=request.scope_hint or None,
        )

        if mock_allowed_keys:
            # 离线 mock：把真实裁定替换为固定允许集（Golden path 验证）
            scope.allowed_item_keys = list(mock_allowed_keys)
            scope.decision = "allow"
            scope.reason = None

        orchestrator = self._get_orchestrator()
        result: AskResult = await orchestrator.ask(request, identity, scope)

        # ===== 投影前写审计（失败不阻断）=====
        try:
            await self.write_ask_log(request, identity, result, view)
        except Exception as exc:  # noqa: BLE001 - 审计失败降级，不得吞答案
            logger.warning(
                "IQD ask log write failed (degraded)",
                query_id=result.response.query_id,
                error=str(exc),
            )

        return self._projector.project(result.response, view)

    # ================================================================ 审计

    async def write_ask_log(
        self,
        request: AskRequest,
        identity: AskIdentity,
        result: AskResult,
        view: str,
    ) -> None:
        """写问数审计日志（经 mis-iqd 内部 API，投影前调用留全量 SQL）。

        Args:
            request: 问数请求。
            identity: 问数身份。
            result: 全量编排结果（含 SQL）。
            view: 视图模式。

        Raises:
            IqdError: 审计写入失败时向上抛（由 :meth:`ask` 捕获降级）。
        """
        from src.adapters.iqd_config_client import IqdConfigClientError

        response = result.response
        # 审计 resolved_scope：范围裁定 + 行级注入判定（W2）
        resolved_scope: dict[str, Any] = result.scope.to_payload()
        resolved_scope["row_scope"] = result.inject_outcome.to_payload()
        payload: dict[str, Any] = {
            "trace_id": identity.raw_headers.get("X-Trace-Id") or request.session_id or "",
            "session_id": request.session_id,
            "thread_id": request.thread_id,
            "query_id": response.query_id,
            "user_id": identity.user_id,
            "employee_id": identity.employee_id,
            "role_codes": identity.role_codes,
            # W3 验收：审计记录 simulated_role_code（有模拟则记录，无则 null），
            # 但 user_id 恒为真实用户（模拟不放大权限、不改真实身份）
            "simulated_role_code": identity.simulated_role_code,
            "question": request.question,
            "resolved_scope": resolved_scope,
            "status": response.status,
            "wren_status_trail": result.wren_status_trail,
            "sql_text": response.sql,
            "sql_dialect": response.sql_dialect,
            "summary": response.answer_summary,
            "citations": [c.model_dump(mode="json") for c in response.citations],
            "plan_steps": [p.model_dump(mode="json") for p in response.plan],
            "row_count": response.data.row_count,
            "masked_columns": response.masked_columns,
            "latency_ms": response.latency_ms,
            "error_code": response.error_code,
            "error_message": response.error_message,
            "view_mode": view,
        }

        client = self._get_config_client()
        try:
            await client.write_ask_log(payload)
        except IqdConfigClientError as exc:
            raise IqdError(50000, f"审计写入失败: {exc}") from exc

    # ================================================================ 依赖

    def _get_scope_resolver(self) -> ScopeResolver:
        """懒加载范围裁定器。"""
        if self._scope_resolver is None:
            self._scope_resolver = ScopeResolver()
        return self._scope_resolver

    def _get_orchestrator(self) -> AskOrchestrator:
        """懒加载编排器。"""
        if self._orchestrator is None:
            self._orchestrator = AskOrchestrator()
        return self._orchestrator

    def _get_config_client(self) -> Any:
        """懒加载 IqdConfigClient（审计写入）。"""
        from src.adapters.iqd_config_client import IqdConfigClient

        return IqdConfigClient()

    # ================================================================ W3 审计回查

    async def list_ask_logs(
        self,
        *,
        limit: int | None = None,
        status: str | None = None,
        user_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """回查问数审计日志（W3：运营/QA 联调审计）。

        Args:
            limit: 每页条数（缺省由 mis-iqd 兜底 50）。
            status: 状态过滤（如 succeeded / failed / denied）。
            user_id: 用户 id 过滤。

        Returns:
            审计日志列表（snake_case wire，含 sql_text / plan_steps / citations）。
        """
        client = self._get_config_client()
        try:
            return await client.get_ask_logs(
                limit=limit, status=status, user_id=user_id
            )
        except Exception as exc:  # noqa: BLE001 - 回查失败抛业务错误
            raise IqdError(50000, f"审计回查失败: {exc}") from exc

    # ================================================================ W4 增强物料

    async def list_sql_pairs(self, connection_id: int | None = None) -> list[dict[str, Any]]:
        """拉取样本对（W4：few-shot 增强物料，经 IqdConfigClient 缓存）。"""
        client = self._get_config_client()
        return await client.get_sql_pairs(connection_id)

    async def list_knowledge(self, connection_id: int | None = None) -> list[dict[str, Any]]:
        """拉取知识/术语/口径（W4：instructions 增强物料，经 IqdConfigClient 缓存）。"""
        client = self._get_config_client()
        return await client.get_knowledge(connection_id)

    async def push_enhancements(self, connection_id: int | None = None) -> dict[str, Any]:
        """取待推送增强物料并登记（W4：pending 清单；真实 push 由 CLI context build 执行）。

        Args:
            connection_id: 问数连接 id（缺省由 mis-iqd 主连接兜底）。

        Returns:
            ``{"sql_pairs": [...], "knowledge": [...], "sql_pair_count": N,
            "knowledge_count": N, "message": ...}``。
        """
        client = self._get_config_client()
        # 经内部 API 拉取 pending 物料；mis-iqd /enhance/push 返回同构结果
        sql_pairs = await client.get_sql_pairs(connection_id)
        knowledge = await client.get_knowledge(connection_id)
        pending_pairs = [p for p in sql_pairs if p.get("sync_status") == "pending"]
        pending_knowledge = [
            k for k in knowledge
            if k.get("sync_status") == "pending" and k.get("enabled", True) is not False
        ]
        return {
            "sql_pairs": pending_pairs,
            "knowledge": pending_knowledge,
            "sql_pair_count": len(pending_pairs),
            "knowledge_count": len(pending_knowledge),
            "message": "待推送物料已就绪（Worker 经 context build 同步并回填 wren_ref_id）",
        }

    # ================================================================ 闭环补全（P0-3 / P1-1 / P1-2）

    async def trigger_build_index(
        self, connection_id: int | None = None, wait: bool = True
    ) -> SyncResult:
        """编排整库 rebuild：拉待下发物料 → context build → memory index → 回填 + 报作业。

        这是问数闭环补全的核心编排（架构 §1.2 链路 B）。build 成功后统一把
        ``wren_ref_id``（= 本次 mdl_hash）回填给本批 pending 物料；memory index
        失败（Q6：CLI 缺失/不可用）**不阻断** build 回填，仅单独标记 ``index_status=failed``。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            wait: 是否阻塞至完成（True=手动/重试；False=自动接受即返回）。

        Returns:
            :class:`SyncResult`（build/index 状态 + mdl_hash + 回填计数）。
        """
        from src.adapters.iqd_cli import IqdCli, IqdCliError
        from src.adapters.iqd_config_client import IqdConfigClient, IqdConfigClientError

        settings = get_settings()
        cli = IqdCli()
        client = self._get_config_client()

        cid = connection_id or await self._resolve_primary_connection_id(client)
        if cid is None:
            return SyncResult(
                connection_id=None,
                coalesced=False,
                build_status="failed",
                build_error="no primary connection",
            )

        # ① 拉待下发物料（pending + enabled）
        try:
            sql_pairs = await client.get_sql_pairs(cid)
            knowledge = await client.get_knowledge(cid)
        except IqdConfigClientError as exc:
            return SyncResult(
                connection_id=cid,
                coalesced=False,
                build_status="failed",
                build_error=f"拉取待下发物料失败: {exc}",
            )
        pending_pairs = [
            p for p in sql_pairs
            if p.get("sync_status") == "pending" and p.get("enabled", True) is not False
        ]
        pending_knowledge = [
            k for k in knowledge
            if k.get("sync_status") == "pending" and k.get("enabled", True) is not False
        ]

        sql_pair_args = [
            {"question": p.get("question"), "sql": p.get("wren_sql") or p.get("sql_text")}
            for p in pending_pairs
        ]
        instruction_args = [
            {"title": k.get("title"), "content": k.get("content") or ""}
            for k in pending_knowledge
        ]

        # ② context build（整库 rebuild，返回 mdl_hash）
        build_status = "success"
        build_error: str | None = None
        mdl_hash: str | None = None
        try:
            build_result = await cli.context_build(
                sql_pairs=sql_pair_args,
                instructions=instruction_args,
                allow_write=True,
            )
            mdl_hash = self._parse_mdl_hash(build_result.get("stdout", ""))
        except IqdCliError as exc:
            build_status = "failed"
            build_error = str(exc)

        # ③ memory index（容错：缺失/失败不阻断 build；单独记 index 状态）
        index_status = "skipped"
        index_error: str | None = None
        if build_status == "success" and settings.iqd_mcp.memory_index_enabled:
            try:
                await cli.memory_index()
                index_status = "success"
            except IqdCliError as exc:
                index_status = "failed"
                index_error = str(exc)
                logger.warning("IQD memory index failed (non-blocking)", error=str(exc))

        # ④ 回填（wren_ref_id 统一填本次 mdl_hash，覆盖本批 pending 物料）
        backfill_ok = False
        if build_status == "success" and mdl_hash:
            try:
                await client.backfill_enhancement_sync({
                    "connection_id": cid,
                    "wren_ref_id": mdl_hash,
                    "sql_pair_ids": [p.get("id") for p in pending_pairs if p.get("id") is not None],
                    "knowledge_ids": [k.get("id") for k in pending_knowledge if k.get("id") is not None],
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })
                backfill_ok = True
            except IqdConfigClientError as exc:
                build_status = "failed"
                build_error = f"回填失败: {exc}"

        # ⑤ 报作业（失败仅告警，不阻断返回）
        synced_pairs = len(pending_pairs) if backfill_ok else 0
        synced_knowledge = len(pending_knowledge) if backfill_ok else 0
        try:
            await client.report_sync_job({
                "connection_id": cid,
                "build_status": build_status,
                "build_mdl_hash": mdl_hash,
                "index_status": index_status,
                "build_error": build_error,
                "index_error": index_error,
                "synced_sql_pair_count": synced_pairs,
                "synced_knowledge_count": synced_knowledge,
            })
        except IqdConfigClientError as exc:
            logger.warning("IQD report sync job failed", connection_id=cid, error=str(exc))

        return SyncResult(
            connection_id=cid,
            coalesced=False,
            build_status=build_status,
            index_status=index_status,
            build_mdl_hash=mdl_hash,
            synced_sql_pair_count=synced_pairs,
            synced_knowledge_count=synced_knowledge,
            build_error=build_error,
            index_error=index_error,
        )

    @staticmethod
    def _parse_mdl_hash(stdout: str) -> str | None:
        """从 context build 的 stdout 提取 mdl_hash。

        优先 JSON 解析（``mdl_hash`` / ``hash`` / ``deployment_id``），失败回退带
        前缀正则提取；均失败则用回退值 ``wqd-{yyyyMMddHHmmss}-{uuid}``。解析失败不得
        中断回填（返回回退值）。
        """
        if stdout and stdout.strip():
            try:
                data = json.loads(stdout)
                if isinstance(data, dict):
                    for key in ("mdl_hash", "hash", "deployment_id", "mdlHash", "deploymentId"):
                        val = data.get(key)
                        if isinstance(val, str) and val.strip():
                            return val.strip()
            except (ValueError, AttributeError):
                match = re.search(
                    r"(?:mdl_hash|hash|deployment_id)['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9_\-]+)",
                    stdout,
                )
                if match:
                    return match.group(1)
        return IqdAskService._fallback_mdl_hash()

    @staticmethod
    def _fallback_mdl_hash() -> str:
        """mdl_hash 解析失败时的回退值（格式 ``wqd-{yyyyMMddHHmmss}-{uuid8}``）。"""
        from uuid import uuid4

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        return f"wqd-{stamp}-{uuid4().hex[:8]}"

    async def _resolve_primary_connection_id(self, client: Any) -> int | None:
        """解析主连接 id（name='default' 或首条 enabled）。"""
        try:
            connections = await client.get_connections()
        except Exception as exc:  # noqa: BLE001 - 解析失败降级为无连接
            logger.warning("IQD resolve primary connection failed", error=str(exc))
            return None
        if connections:
            cid = connections[0].get("id")
            if isinstance(cid, (int, str)):
                try:
                    return int(cid)
                except (TypeError, ValueError):
                    return None
        return None

    # ================================================================ v1.10 方言转化 + 试运行

    async def translate_sql_pair(self, db_type: str, native_sql: str) -> dict[str, Any]:
        """样本对方言转化（v1.10 / §4.2.3）。

        用 :mod:`src.agent.mis_iqd.sql_translate` 把源方言翻到 WrenAI 方言
        （目标方言见 :data:`WREN_TARGET_DIALECT`，待 W0 探针 3f 校准）。

        Args:
            db_type: 用户所选关系库类型（oracle / mysql / postgres / clickhouse）。
            native_sql: 用户手写的原生 SQL（源方言）。

        Returns:
            ``{"wren_sql": str, "warnings": list[str]}``（翻译失败不抛异常，见 A14③）。
        """
        return sql_translate_translate(db_type, native_sql)

    async def trial_sql_pair(self, wren_sql: str) -> dict[str, Any]:
        """样本对试运行（v1.10 / §4.2.3）。

        经 :class:`IqdMcpClient` 在 WrenAI 引擎侧执行转化后的 ``wren_sql``，
        验证「转化后的 wrensql 能在 WrenAI 跑通」（非源业务库，A14②）。

        归一为 ``{"columns": [...], "rows": [[...]], "error": null|str,
        "duration_ms": int}``；异常时 ``error`` 填信息、``columns``/``rows`` 空。

        Args:
            wren_sql: 转化后的 WrenAI 方言 SQL（可经前端手改）。

        Returns:
            试运行结果字典（异常不抛 500，error 字段承载）。
        """
        client = IqdMcpClient()
        start = time.perf_counter()
        try:
            result = await client.run_sql(wren_sql, dialect=WREN_TARGET_DIALECT)
            measured_ms = int((time.perf_counter() - start) * 1000)
            columns = result.get("columns") or []
            rows = result.get("rows") or []
            error = result.get("error") or None
            # 优先用引擎返回的执行耗时；缺省用本地测得耗时
            engine_ms = result.get("execution_time_ms")
            duration_ms = int(engine_ms) if engine_ms is not None else measured_ms
            return {
                "columns": columns,
                "rows": rows,
                "error": error,
                "duration_ms": duration_ms,
            }
        except Exception as exc:  # noqa: BLE001 - 试运行失败返回 error，不抛 500
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.warning("IQD trial_sql_pair failed", error=str(exc))
            return {
                "columns": [],
                "rows": [],
                "error": str(exc),
                "duration_ms": duration_ms,
            }
