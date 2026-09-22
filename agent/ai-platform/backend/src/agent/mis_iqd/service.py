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
        self, connection_id: int | None = None, wait: bool = True, scope: str = "materials"
    ) -> SyncResult:
        """编排整库 rebuild：拉待下发物料 → context build → memory index → 回填 + 报作业。

        这是问数闭环补全的核心编排（架构 §1.2 链路 B）。build 成功后统一把
        ``wren_ref_id``（= 本次 mdl_hash）回填给本批 pending 物料；memory index
        失败（Q6：CLI 缺失/不可用）**不阻断** build 回填，仅单独标记 ``index_status=failed``。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            wait: 是否阻塞至完成（True=手动/重试；False=自动接受即返回）。
            scope: 构建范围 ``materials``（一期物料）/ ``model``（二期模型写回）；
                ``model`` 走 :meth:`build_mdl_from_catalog` 以 mdl_raw 基线派生完整 MDL。

        Returns:
            :class:`SyncResult`（build/index 状态 + mdl_hash + 回填计数）。
        """
        if scope == "model":
            return await self.trigger_model_build(connection_id, wait)
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

        # 方案 A 多连接：build/index 落到本连接专属 wren project 目录（project_dir）
        project_home = self._project_home(cid)

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
                project_dir=project_home,
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
                await cli.memory_index(project_dir=project_home)
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

    # ================================================================ 运维自愈三按钮（自愈闭环，同构 trigger_build_index）

    async def trigger_force_rebuild(
        self, connection_id: int | None = None, wait: bool = True
    ) -> SyncResult:
        """强制重建（自愈三按钮之一）：拉物料 → context build(force=True) → memory index → 回填 + 报作业。

        与 :meth:`trigger_build_index` 同构，仅 build 阶段传 ``force=True``（附加
        ``self_heal_force_build_args`` 配置项）；其余容错/回填/报作业完全一致。上报
        ``action="force_rebuild"`` 以区分动作来源（审计 REQ-7）。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            wait: 是否阻塞至完成（自愈为运维主动触发，默认 True）。

        Returns:
            :class:`SyncResult`。
        """
        from src.adapters.iqd_cli import IqdCli, IqdCliError
        from src.adapters.iqd_config_client import IqdConfigClient, IqdConfigClientError

        settings = get_settings()
        cli = IqdCli()
        client = self._get_config_client()

        cid = connection_id or await self._resolve_primary_connection_id(client)
        if cid is None:
            result = SyncResult(
                connection_id=None, coalesced=False,
                build_status="failed", build_error="no primary connection",
            )
            await self._report_selfheal_job(client, None, "force_rebuild", result)
            return result

        # 方案 A 多连接：build/index 落到本连接专属 wren project 目录（project_dir）
        project_home = self._project_home(cid)

        # ① 拉待下发物料（pending + enabled）
        try:
            sql_pairs = await client.get_sql_pairs(cid)
            knowledge = await client.get_knowledge(cid)
        except IqdConfigClientError as exc:
            result = SyncResult(
                connection_id=cid, coalesced=False,
                build_status="failed", build_error=f"拉取待下发物料失败: {exc}",
            )
            await self._report_selfheal_job(client, cid, "force_rebuild", result)
            return result
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

        # ② context build（强制重建：仅 build 阶段传 force=True）
        build_status = "success"
        build_error: str | None = None
        mdl_hash: str | None = None
        try:
            build_result = await cli.context_build(
                sql_pairs=sql_pair_args,
                instructions=instruction_args,
                allow_write=True,
                force=True,
                project_dir=project_home,
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
                await cli.memory_index(project_dir=project_home)
                index_status = "success"
            except IqdCliError as exc:
                index_status = "failed"
                index_error = str(exc)
                logger.warning("IQD force-rebuild memory index failed (non-blocking)", error=str(exc))

        # ④ 回填（wren_ref_id 统一填本次 mdl_hash）
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

        synced_pairs = len(pending_pairs) if backfill_ok else 0
        synced_knowledge = len(pending_knowledge) if backfill_ok else 0
        result = SyncResult(
            connection_id=cid, coalesced=False,
            build_status=build_status, index_status=index_status,
            build_mdl_hash=mdl_hash,
            synced_sql_pair_count=synced_pairs, synced_knowledge_count=synced_knowledge,
            build_error=build_error, index_error=index_error,
        )
        await self._report_selfheal_job(client, cid, "force_rebuild", result)
        return result

    async def trigger_reindex(
        self, connection_id: int | None = None, wait: bool = True
    ) -> SyncResult:
        """重新索引（自愈三按钮之一）：串联 ``memory reset`` + ``memory index``。

        重置 WrenAI 记忆索引后重新下发；``build_status`` 反映 reset 结果，``index_status``
        反映 index 结果（任一失败单独标记，不相互阻断）。上报 ``action="reindex"``。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            wait: 是否阻塞至完成（自愈默认 True）。

        Returns:
            :class:`SyncResult`（build_status=reset 结果，index_status=index 结果）。
        """
        from src.adapters.iqd_cli import IqdCli, IqdCliError
        from src.adapters.iqd_config_client import IqdConfigClient

        cli = IqdCli()
        client = self._get_config_client()

        cid = connection_id or await self._resolve_primary_connection_id(client)
        if cid is None:
            result = SyncResult(
                connection_id=None, coalesced=False,
                build_status="failed", build_error="no primary connection",
            )
            await self._report_selfheal_job(client, None, "reindex", result)
            return result

        # 方案 A 多连接：build/index 落到本连接专属 wren project 目录（project_dir）
        project_home = self._project_home(cid)

        # ① memory reset（重新索引前置）
        build_status = "success"
        build_error: str | None = None
        try:
            await cli.memory_reset(project_dir=project_home)
        except IqdCliError as exc:
            build_status = "failed"
            build_error = str(exc)
            logger.warning("IQD memory reset failed", connection_id=cid, error=str(exc))

        # ② memory index（reset 成功后下发索引；失败单独标 failed）
        index_status = "skipped"
        index_error: str | None = None
        if build_status == "success":
            try:
                await cli.memory_index(project_dir=project_home)
                index_status = "success"
            except IqdCliError as exc:
                index_status = "failed"
                index_error = str(exc)
                logger.warning("IQD reindex memory index failed", connection_id=cid, error=str(exc))

        result = SyncResult(
            connection_id=cid, coalesced=False,
            build_status=build_status, index_status=index_status,
            build_mdl_hash=None,
            synced_sql_pair_count=0, synced_knowledge_count=0,
            build_error=build_error, index_error=index_error,
        )
        await self._report_selfheal_job(client, cid, "reindex", result)
        return result

    async def trigger_validate(
        self, connection_id: int | None = None, wait: bool = True
    ) -> SyncResult:
        """模型校验（自愈三按钮之一）：``context validate`` 校验当前语义上下文。

        ``build_status`` 反映校验结果（success/failed），``build_error`` 携带人可读摘要
        （REQ-8）。校验为只读动作，不改写模型；上报 ``action="validate"``。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            wait: 是否阻塞至完成（自愈默认 True）。

        Returns:
            :class:`SyncResult`（build_status=校验结果，build_error=人可读摘要）。
        """
        from src.adapters.iqd_cli import IqdCli

        cli = IqdCli()
        client = self._get_config_client()

        cid = connection_id or await self._resolve_primary_connection_id(client)
        if cid is None:
            result = SyncResult(
                connection_id=None, coalesced=False,
                build_status="failed", build_error="no primary connection",
            )
            await self._report_selfheal_job(client, None, "validate", result)
            return result

        # 方案 A 多连接：校验落到本连接专属 wren project 目录（project_dir）
        project_home = self._project_home(cid)

        try:
            validate = await cli.context_validate(project_dir=project_home)
        except Exception as exc:  # noqa: BLE001 - 校验调用异常归一为 failed
            logger.error("IQD context validate call failed", connection_id=cid, error=str(exc))
            result = SyncResult(
                connection_id=cid, coalesced=False,
                build_status="failed", build_error=f"校验调用异常: {exc}",
            )
            await self._report_selfheal_job(client, cid, "validate", result)
            return result

        ok = bool(validate.get("ok"))
        summary = validate.get("summary") or ""
        result = SyncResult(
            connection_id=cid, coalesced=False,
            build_status="success" if ok else "failed",
            index_status="skipped",
            build_mdl_hash=None,
            synced_sql_pair_count=0, synced_knowledge_count=0,
            build_error=None if ok else summary,
        )
        await self._report_selfheal_job(client, cid, "validate", result)
        return result

    async def _report_selfheal_job(
        self, client: Any, connection_id: int | None, action: str, result: SyncResult
    ) -> None:
        """上报自愈作业（复用 report_sync_job，注入 action 区分动作来源）。

        Args:
            client: IqdConfigClient 实例。
            connection_id: 问数连接 id（可能为 None，仅告警场景）。
            action: 动作名（force_rebuild / reindex / validate）。
            result: 本次 SyncResult。
        """
        try:
            await client.report_sync_job({
                "connection_id": connection_id,
                "action": action,
                "build_status": result.build_status,
                "build_mdl_hash": result.build_mdl_hash,
                "index_status": result.index_status,
                "build_error": result.build_error,
                "index_error": result.index_error,
                "synced_sql_pair_count": result.synced_sql_pair_count,
                "synced_knowledge_count": result.synced_knowledge_count,
            })
        except Exception as exc:  # noqa: BLE001 - 报作业失败仅告警，不阻断返回
            logger.warning("IQD self-heal job report failed", action=action, error=str(exc))

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

    # ================================================================ 二期：模型写回（G7）

    async def trigger_model_build(
        self, connection_id: int | None = None, wait: bool = True
    ) -> SyncResult:
        """编排「模型写回」rebuild：以平台 catalog 派生完整 MDL 并部署（G7 核心）。

        与一期 :meth:`trigger_build_index` 的区别：本方法先从 mis-iqd 取
        ``{mdl_raw, edited_items}``，以基线 mdl_raw 派生产出完整 MDL（按 item_key→
        MDL 节点映射 patch 编辑字段），写出临时目录 ``manifest.json``，再
        ``context_build(mdl_dir=tmp, ...)`` 一次部署「模型 + 物料」。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            wait: 是否阻塞至完成。

        Returns:
            :class:`SyncResult`（build/index 状态 + mdl_hash + 回填计数；
            edit_source 固定 ``model``）。
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

        # 方案 A 多连接：build/index 落到本连接专属 wren project 目录（project_dir）
        project_home = self._project_home(cid)

        # ① 取基线 mdl_raw + 已编辑节点
        try:
            full = await client.get_catalog_full(cid)
        except IqdConfigClientError as exc:
            return SyncResult(
                connection_id=cid,
                coalesced=False,
                build_status="failed",
                build_error=f"拉取 catalog 全量失败: {exc}",
            )
        mdl_raw = full.get("mdl_raw")
        edited_items = full.get("edited_items") or []

        # ② 派生完整 MDL 并写出临时目录
        try:
            mdl_dir, _payload = self.build_mdl_from_catalog(cid, mdl_raw, edited_items)
        except Exception as exc:  # noqa: BLE001 - 派生失败归一为 build 失败
            logger.error("IQD build_mdl_from_catalog failed", connection_id=cid, error=str(exc))
            await self._report_model_job(
                client, cid, "failed", None, str(exc), None, 0, 0
            )
            return SyncResult(
                connection_id=cid,
                coalesced=False,
                build_status="failed",
                build_error=f"派生完整 MDL 失败: {exc}",
            )

        # ③ context build（部署「模型 + 物料」）
        build_status = "success"
        build_error: str | None = None
        mdl_hash: str | None = None
        try:
            build_result = await cli.context_build(
                mdl_dir=mdl_dir,
                sql_pairs=[],  # 物料已并入 mdl_dir/manifest，不再单列
                instructions=[],
                allow_write=True,
                project_dir=project_home,
            )
            mdl_hash = self._parse_mdl_hash(build_result.get("stdout", ""))
        except IqdCliError as exc:
            build_status = "failed"
            build_error = str(exc)

        # ④ memory index（容错：失败不阻断 build；单独标记 failed）
        index_status = "skipped"
        index_error: str | None = None
        if build_status == "success" and settings.iqd_mcp.memory_index_enabled:
            try:
                await cli.memory_index(project_dir=project_home)
                index_status = "success"
            except IqdCliError as exc:
                index_status = "failed"
                index_error = str(exc)
                logger.warning("IQD model memory index failed (non-blocking)", error=str(exc))

        synced_pairs = 0
        synced_knowledge = 0
        stamped = 0
        if build_status == "success" and mdl_hash:
            # ⑤ 批量回填编辑盖章（P0-8 断点续盖）+ 推进 built 版本
            try:
                edit_revision = await self._current_edit_revision(full, client)
                backfill = await client.backfill_catalog_sync({
                    "connection_id": cid,
                    "mdl_hash": mdl_hash,
                    "edit_revision": edit_revision,
                })
                stamped = int(backfill.get("stamped_count", 0)) if isinstance(backfill, dict) else 0
            except (IqdConfigClientError, ValueError) as exc:
                build_status = "failed"
                build_error = f"编辑盖章回填失败: {exc}"
            # ⑥ 报作业（edit_source=model）
            await self._report_model_job(
                client, cid, build_status, mdl_hash, build_error,
                index_error, stamped, 0,
            )
        else:
            await self._report_model_job(
                client, cid, build_status, mdl_hash, build_error, index_error, 0, 0
            )

        return SyncResult(
            connection_id=cid,
            coalesced=False,
            build_status=build_status,
            index_status=index_status,
            build_mdl_hash=mdl_hash,
            synced_sql_pair_count=stamped,
            synced_knowledge_count=0,
            build_error=build_error,
            index_error=index_error,
        )

    async def _current_edit_revision(self, full: dict[str, Any], client: Any) -> int:
        """取 catalog 全量快照中的当前编辑版本（fail-closed，不默认 0）。

        ``get_catalog_full`` 修复后已在顶层携带 ``current_edit_revision``（设计 §九.1）；
        优先取之。若缺失（旧版 mis-iqd），回退到 ``get_catalog_sync_status`` 取真实连接级
        ``current_edit_revision``（T03 sync-status 契约）。两者皆缺则抛明确异常，拒绝以 0
        回填——否则 backfillCatalogSync 的 ``edit_revision <= 0`` 命中不到任何已编辑节点
        （实际 edit_revision >= 1），stamped_count 恒为 0、built_edit_revision 被重置为 0、
        current > built 永久成立、同步状态机永不收敛 SYNCED（违反 PRD G-B / G6）。
        """
        if isinstance(full, dict) and full.get("current_edit_revision") is not None:
            try:
                return int(full["current_edit_revision"])
            except (TypeError, ValueError):
                logger.warning(
                    "IQD current_edit_revision 不可解析，回退 sync_status",
                    value=full.get("current_edit_revision"),
                )
        # 旧版 Java（getCatalogFull 未带该字段）的兜底：取真实连接级版本。
        try:
            status = await client.get_catalog_sync_status()
            if isinstance(status, dict) and status.get("current_edit_revision") is not None:
                try:
                    return int(status["current_edit_revision"])
                except (TypeError, ValueError):
                    pass
        except Exception as exc:  # noqa: BLE001 - 回退失败归一，下面抛明确异常
            logger.error("IQD get_catalog_sync_status 回退失败", error=str(exc))
        raise ValueError(
            "无法获取 current_edit_revision（get_catalog_full 与 get_catalog_sync_status 均无该字段），"
            "拒绝以 0 回填（将导致 stampCatalogSync 命中不到已编辑节点，违反 PRD G-B/G6）"
        )

    def build_mdl_from_catalog(
        self, connection_id: int, mdl_raw: str | None, edited_items: list[dict[str, Any]]
    ) -> tuple[str, dict[str, Any]]:
        """以 mdl_raw 基线 + edited_items patch 派生完整 MDL，写出临时目录 manifest.json。

        G7 数据流：``mdl = deepcopy(mdl_raw)`` → **物化基线缺失的新建节点**
        （cube/measure/dimension/relationship/计算列，见 :meth:`_materialize_missing_nodes`）
        → 按 ``item_key→MDL 节点`` 映射 patch 编辑字段（display_name→name / description /
        expression）→ 写临时目录 ``manifest.json``（顶层 models/relationships/cubes/views/
        metrics/dimensions）→ 返回 ``(mdl_dir, payload)`` 供 ``context_build(mdl_dir=tmp)`` 部署。

        物化这一步是 T03（M2 建模全量）补上的关键缺口：基线只含「上次同步时 WrenAI 里
        已存在」的对象，平台新建的关系 / cube / 计算列必须新增进去，否则 build 后问数
        永远命中不到（M-G2 的 query_cube 通道因此失效）。

        Args:
            connection_id: 连接 id（仅用于日志/目录命名）。
            mdl_raw: 基线完整 MDL（JSON 字符串）；为 ``None`` 时降级为「仅 edited_items
                重建」（结构缺失将致 build 失败，fail-closed）。
            edited_items: 平台已编辑节点（``item_key/kind/display_name/description/
                expression``）。

        Returns:
            ``(mdl_dir, payload)``：mdl_dir 为写入 manifest.json 的临时目录。

        Raises:
            ValueError: mdl_raw 为空且 edited_items 为空（无可用 MDL 来源）。
        """
        import os
        import tempfile

        if not mdl_raw or not mdl_raw.strip():
            # 降级：无基线，尝试仅从 edited_items 重建（结构大概率残缺 → build 失败提示先同步）
            if not edited_items:
                raise ValueError("mdl_raw 为空且无 edited_items，无法派生完整 MDL（请先做一次 MDL 同步）")
            mdl: dict[str, Any] = {
                "models": [], "relationships": [], "cubes": [],
                "views": [], "metrics": [], "dimensions": [],
            }
            logger.warning(
                "IQD build_mdl_from_catalog degraded: no mdl_raw baseline",
                connection_id=connection_id,
            )
        else:
            try:
                mdl = json.loads(mdl_raw)
                if not isinstance(mdl, dict):
                    mdl = {}
            except (ValueError, AttributeError) as exc:
                raise ValueError(f"mdl_raw 解析失败: {exc}") from exc
            # 归一顶层容器
            for k in ("models", "relationships", "cubes", "views", "metrics", "dimensions"):
                mdl.setdefault(k, [])

        # ② 物化建模台**新建**节点（基线里没有的 cube/measure/dimension/relationship/计算列）
        #    必须早于 _patch_mdl_node：patch 按「name 定位已有节点」，而物化才负责「新增」。
        self._materialize_missing_nodes(mdl, edited_items)

        # ③ patch 编辑字段（item_key → MDL 节点定位）
        for it in edited_items:
            key = it.get("item_key") or ""
            kind = it.get("kind") or ""
            self._patch_mdl_node(mdl, key, kind, it)

        # ④ 写临时目录 manifest.json
        tmp_dir = tempfile.mkdtemp(prefix=f"iqd_mdl_{connection_id}_")
        manifest_path = os.path.join(tmp_dir, "manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(mdl, fh, ensure_ascii=False, indent=2)

        payload: dict[str, Any] = {
            "connection_id": connection_id,
            "mdl_dir": tmp_dir,
            "edited_count": len(edited_items),
        }
        logger.info(
            "IQD build_mdl_from_catalog wrote manifest",
            connection_id=connection_id,
            mdl_dir=tmp_dir,
            edited_count=len(edited_items),
        )
        return tmp_dir, payload

    @staticmethod
    def _patch_mdl_node(mdl: dict[str, Any], item_key: str, kind: str, it: dict[str, Any]) -> None:
        """按 item_key→MDL 节点映射，把编辑字段（display_name/description/expression）套用到节点。

        映射规则（设计 §七 G7）：
        - ``mdl:model:<name>``            → models[] where name==<name>
        - ``<ds>.<schema>.<table>.<col>`` → models[name==<table>].columns[] where name==<col>
        - ``mdl:relationship:<name>``      → relationships[] where name==<name>
        - ``mdl:cube:<name>``             → cubes[] where name==<name>
        - ``<cubeKey>.<measure>``         → cubes[name==<cube>].measures[] where name==<measure>
        - ``mdl:metric:<name>``           → metrics[] where name==<name>
        - ``mdl:dimension:<name>``        → dimensions[] where name==<name>
        - ``mdl:view:<name>``             → views[] where name==<name>
        """
        def _set(node: dict[str, Any]) -> None:
            if it.get("display_name") is not None:
                node["name"] = it["display_name"]
            if it.get("description") is not None:
                node["description"] = it["description"]
            if it.get("expression") is not None:
                node["expression"] = it["expression"]

        if item_key.startswith("mdl:model:"):
            name = item_key[len("mdl:model:"):]
            for node in mdl.get("models", []):
                if node.get("name") == name:
                    _set(node)
                    return
        elif item_key.startswith("mdl:relationship:"):
            name = item_key[len("mdl:relationship:"):]
            for node in mdl.get("relationships", []):
                if node.get("name") == name:
                    _set(node)
                    return
        elif item_key.startswith("mdl:cube:"):
            name = item_key[len("mdl:cube:"):]
            for node in mdl.get("cubes", []):
                if node.get("name") == name:
                    _set(node)
                    return
        elif item_key.startswith("mdl:metric:"):
            name = item_key[len("mdl:metric:"):]
            for node in mdl.get("metrics", []):
                if node.get("name") == name:
                    _set(node)
                    return
        elif item_key.startswith("mdl:dimension:"):
            name = item_key[len("mdl:dimension:"):]
            for node in mdl.get("dimensions", []):
                if node.get("name") == name:
                    _set(node)
                    return
        elif item_key.startswith("mdl:view:"):
            name = item_key[len("mdl:view:"):]
            for node in mdl.get("views", []):
                if node.get("name") == name:
                    _set(node)
                    return
        elif item_key.startswith("mdl:column:") or "." in item_key:
            # <ds>.<schema>.<table>.<col> → models[name==<table>].columns[] where name==<col>
            parts = item_key.split(".")
            if len(parts) >= 4:
                table = parts[2]
                col = parts[3]
                for model in mdl.get("models", []):
                    if model.get("name") == table:
                        for column in model.get("columns", []):
                            if column.get("name") == col:
                                _set(column)
                                return
        # <cubeKey>.<measure> 形态（cubeKey=mdl:cube:<cube>）
        if item_key.startswith("mdl:cube:") and "." in item_key[len("mdl:cube:"):]:
            cube_part = item_key[len("mdl:cube:"):]
            cube_name, measure_name = cube_part.split(".", 1)
            for cube in mdl.get("cubes", []):
                if cube.get("name") == cube_name:
                    for measure in cube.get("measures", []):
                        if measure.get("name") == measure_name:
                            _set(measure)
                            return

    # ================================================================ T03：新建节点物化（R-3）

    @staticmethod
    def _item_key_tail(item_key: str | None) -> str:
        """取 item_key 末段：``mdl:cube:revenue`` → ``revenue``；``a.b.c`` → ``c``。"""
        if not item_key:
            return ""
        if ":" in item_key:
            return item_key.rsplit(":", 1)[1]
        return item_key.rsplit(".", 1)[-1]

    @staticmethod
    def _model_name_of(model_ref: str | None) -> str:
        """``mdl:model:orders`` → ``orders``；``orders`` → ``orders``；空 → ``""``。"""
        if not model_ref:
            return ""
        return IqdAskService._item_key_tail(model_ref)

    @staticmethod
    def _parse_relationship_payload(expression: str | None) -> dict[str, Any] | None:
        """解析建模台写入的关系信封 JSON（``join_type/cardinality/condition/source_model/target_model``）。

        非 JSON（如历史 MDL 同步来源的裸 condition）→ 返回 ``None``，调用方按「无法还原
        models，宁可不物化也不产出非法 relationship」处理。
        """
        if not expression or not expression.strip().startswith("{"):
            return None
        try:
            parsed = json.loads(expression)
        except (ValueError, TypeError):
            return None
        return parsed if isinstance(parsed, dict) else None

    def _materialize_missing_nodes(
        self, mdl: dict[str, Any], edited_items: list[dict[str, Any]]
    ) -> None:
        """把建模台**新建**、但 ``mdl_raw`` 基线中不存在的节点物化进派生 MDL（T03 / R-3 补丁）。

        背景：``mdl_raw`` 是 WrenAI 最近一次同步快照；建模台新建的 cube / measure /
        dimension / relationship / 计算列在基线里**没有对应节点**，而
        :meth:`_patch_mdl_node` 只按 name 定位**已有**节点并改字段 —— 找不到即**静默丢弃**。
        不做物化，M-G2（建关系 → 建 cube → 问数命中 cube 聚合）与 MR-04（计算列）产出的
        语义对象永远不会进入 build，功能形同虚设。

        本方法按 item_key 映射把缺失节点**新增**进派生 MDL，幂等（同名/同键已存在即跳过），
        且不破坏既有节点结构（models/relationships/cubes 的原有数组元素原样保留）。

        Args:
            mdl: 派生中的 MDL dict（**原地修改**；顶层容器已归一）。
            edited_items: 平台已编辑节点（``item_key/kind/parent_key/display_name/data_type/
                expression/model_ref``；T03 起 ``IqdAdminService.getCatalogFull`` 会带上
                后四项）。
        """
        if not edited_items:
            return

        cubes = mdl.setdefault("cubes", [])
        cube_by_name: dict[str, dict[str, Any]] = {
            c.get("name"): c for c in cubes if isinstance(c, dict)
        }
        models = mdl.setdefault("models", [])
        model_by_name: dict[str, dict[str, Any]] = {
            m.get("name"): m for m in models if isinstance(m, dict)
        }
        relationships = mdl.setdefault("relationships", [])
        rel_by_name: dict[str, dict[str, Any]] = {
            r.get("name"): r for r in relationships if isinstance(r, dict)
        }

        # ① cube 容器（先建，供 measure/dimension 挂靠）
        for it in edited_items:
            if (it.get("kind") or "") != "cube":
                continue
            tail = self._item_key_tail(it.get("item_key"))
            name = (it.get("display_name") or "").strip() or tail
            if not name or name in cube_by_name or (tail and tail in cube_by_name):
                continue
            cube: dict[str, Any] = {"name": name, "measures": [], "dimensions": []}
            model_name = self._model_name_of(it.get("model_ref"))
            if model_name:
                cube["baseObject"] = model_name
            cubes.append(cube)
            cube_by_name[name] = cube

        # ② measure / dimension 子节点（按 parent_key=mdl:cube:<cube> 挂靠）
        for it in edited_items:
            kind = it.get("kind") or ""
            if kind not in ("measure", "dimension"):
                continue
            cube = cube_by_name.get(self._item_key_tail(it.get("parent_key")))
            if cube is None:
                continue
            name = (it.get("display_name") or "").strip() or self._item_key_tail(it.get("item_key"))
            if not name:
                continue
            bucket = "measures" if kind == "measure" else "dimensions"
            children = cube.get(bucket)
            if not isinstance(children, list):
                children = []
                cube[bucket] = children
            if any(isinstance(c, dict) and c.get("name") == name for c in children):
                continue
            child: dict[str, Any] = {"name": name}
            if it.get("expression") is not None:
                child["expression"] = it["expression"]
            if kind == "measure" and it.get("data_type"):
                child["format"] = it["data_type"]
            children.append(child)

        # ③ relationship（解信封 JSON 取 models/joinType/condition）
        for it in edited_items:
            if (it.get("kind") or "") != "relationship":
                continue
            name = (it.get("display_name") or "").strip() or self._item_key_tail(it.get("item_key"))
            if not name or name in rel_by_name:
                continue
            payload = self._parse_relationship_payload(it.get("expression"))
            if payload is None:
                continue
            source = self._model_name_of(payload.get("source_model"))
            target = self._model_name_of(payload.get("target_model"))
            if not source or not target:
                continue
            relationship: dict[str, Any] = {"name": name, "models": [source, target]}
            if payload.get("join_type"):
                relationship["joinType"] = str(payload["join_type"]).upper()
            if payload.get("condition"):
                relationship["condition"] = payload["condition"]
            relationships.append(relationship)
            rel_by_name[name] = relationship

        # ④ 计算列（item_key=calc:<model>.<col>，parent_key=mdl:model:<name>）
        for it in edited_items:
            item_key = it.get("item_key") or ""
            if not item_key.startswith("calc:"):
                continue
            model = model_by_name.get(self._model_name_of(it.get("parent_key")))
            if model is None:
                continue
            name = (it.get("display_name") or "").strip() or self._item_key_tail(item_key)
            if not name:
                continue
            columns = model.get("columns")
            if not isinstance(columns, list):
                columns = []
                model["columns"] = columns
            if any(isinstance(c, dict) and c.get("name") == name for c in columns):
                continue
            columns.append({"name": name, "expression": it.get("expression")})

    async def _report_model_job(
        self,
        client: Any,
        connection_id: int,
        build_status: str,
        mdl_hash: str | None,
        build_error: str | None,
        index_error: str | None,
        stamped: int,
        synced_knowledge: int,
    ) -> None:
        """上报模型写回作业（edit_source=model）。"""
        try:
            await client.report_sync_job({
                "connection_id": connection_id,
                "build_status": build_status,
                "build_mdl_hash": mdl_hash,
                "index_status": "skipped" if index_error is None else "failed",
                "build_error": build_error,
                "index_error": index_error,
                "synced_sql_pair_count": stamped,
                "synced_knowledge_count": synced_knowledge,
                "edit_source": "model",
            })
        except Exception as exc:  # noqa: BLE001 - 报作业失败仅告警
            logger.warning("IQD model sync job report failed", connection_id=connection_id, error=str(exc))

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

    @staticmethod
    def _project_home(connection_id: int) -> str:
        """派生连接专属 wren project 目录（方案 A 多连接，build/index 落盘到该目录）。

        与 :meth:`IqdMcpLifecycleService.project_home_of` 同义，确保 build/index 产物
        与「每连接一进程」的 project 目录严格对齐（设计 §3.2），避免多连接互相串扰。
        """
        from src.agent.mis_iqd.mcp_lifecycle import IqdMcpLifecycleService

        return IqdMcpLifecycleService.project_home_of(connection_id)

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
