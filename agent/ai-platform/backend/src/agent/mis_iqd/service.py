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
from src.agent.mis_iqd.publish_selfcheck import PublishSelfCheck
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
        warnings: 模型校验等只读动作的警告条目（可与 success 并存；不落库也可随 API 回传）。
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
    warnings: list[str] = []
    # context validate 原始 stdout/stderr（前端兜底解析 Warnings: 分区）
    raw: str | None = None


def parse_related_item_keys(raw: Any) -> set[str]:
    """解析某条知识/术语条目的 ``related_item_keys`` 为 item_key 集合（T04d，容错）。

    兼容三种来源形态：
    - ``None`` / 空串 → 空集合（= 无关联 / 全连接通用）；
    - JSON 字符串（Java ``iqd_knowledge.related_item_keys`` 是 jsonb 列，经 wire 回传为
      JSON 文本，如 ``'["mdl:model:orders","mdl:cube:revenue"]'``）；
    - 已是 ``list`` / ``tuple`` / ``set``（部分内部接口直接回传解析后的结构）。

    非法 JSON / 非集合类型 → 空集合。这是**刻意的 fail-safe 方向**：视作「无关联」→
    *不裁剪*，宁可多下发一条指令，也不因脏数据把条目静默丢掉（与 masking.py 的
    fail-closed 方向相反 —— 那里失效代价是「泄露敏感数据」，这里只是「少条指令」）。

    Args:
        raw: 原始的 ``related_item_keys`` 值（任意类型）。

    Returns:
        去空白后的 item_key 集合（可能为空）。
    """
    if raw is None:
        return set()
    if isinstance(raw, (list, tuple, set)):
        return {str(x).strip() for x in raw if x is not None and str(x).strip()}
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return set()
        try:
            parsed = json.loads(text)
        except (ValueError, TypeError):
            return set()
        if isinstance(parsed, (list, tuple, set)):
            return {str(x).strip() for x in parsed if x is not None and str(x).strip()}
    return set()


# ================================================================ 知识下发（方案 A：文件即真相）
#
# wren 0.13.3 实测（`wren memory --help` / `wren skills get enrich-context`）：
#   - 样本 NL→SQL 的 source of truth = `{project}/knowledge/sql/<slug>.md`，**必须**经
#     `wren memory store` 写（官方明确「不要手写」），再由 `memory index` 建语义索引；
#   - 术语/口径/业务规则 = `{project}/knowledge/rules/*.md`（自由 markdown，按主题一文件），
#     由 `wren context instructions` 直接读给 LLM，**不进** memory index。
# 平台侧因此：样本逐条 `memory store`；规则整文件**全量覆盖写**
# （只写 pending 会让下一次下发把已下发条目擦掉）。
IQD_RULES_REL_PATH = "knowledge/rules/mis-iqd-platform.md"

# 平台样本文件所在的 wren sink 目录 + 识别标记（写侧 `memory store --tags` 写入 frontmatter）。
IQD_SAMPLE_DIR = "knowledge/sql"
IQD_SAMPLE_TAG = "source:mis-iqd"

# 知识类型 → 规则文件里的二级标题（`iqd_knowledge.kind`；未知类型落「其它」）。
IQD_KNOWLEDGE_SECTIONS: dict[str, str] = {
    "term": "术语",
    "metric_definition": "口径定义",
    "synonym": "同义词",
    "instruction": "业务指令",
}
IQD_KNOWLEDGE_FALLBACK_SECTION = "其它"


def crop_knowledge_by_context(
    knowledge: list[dict[str, Any]],
    context_item_keys: list[str] | None,
) -> list[dict[str, Any]]:
    """按 ``related_item_keys`` 裁剪知识条目（T04d / PRD §5.2 e 点）。

    裁剪语义（下发到 WrenAI 的 instructions）：
    - **无 related_item_keys**（空 / 缺省）→ 全连接通用，**恒保留**（绝不误裁通用条目）；
    - **有 related_item_keys** → 有作用域，仅当其与 ``context_item_keys`` **有交集**时保留；
    - ``context_item_keys`` 缺省 / 为空 → **不裁剪**，原样返回（整库 build / 登记场景，
      保持既有行为，向后兼容）。

    Args:
        knowledge: 待推送知识条目（dict，含 ``related_item_keys``）。
        context_item_keys: 当前上下文的 item_key 列表（model / cube；由问数请求携带）。

    Returns:
        裁剪后的**新**列表（不修改入参）。
    """
    if not context_item_keys:
        return list(knowledge)
    context = {str(k).strip() for k in context_item_keys if k is not None and str(k).strip()}
    if not context:
        return list(knowledge)
    out: list[dict[str, Any]] = []
    for item in knowledge:
        scoped = parse_related_item_keys(item.get("related_item_keys"))
        if not scoped or (scoped & context):
            out.append(item)
    return out


def is_enabled(item: dict[str, Any] | None) -> bool:
    """条目是否启用（容错 bool / int / str 形态；T04e 加固）。

    既有过滤写法是 ``item.get("enabled", True) is not False``，存在**脆弱点**：Python 里
    ``0 is False == False``，故 **int ``0`` 会被判为「启用」** —— 任何回传 int 0 的路径
    （DB 直读 / 新内部接口）都会让**停用条目仍被下发**（静默漏过滤）。``IqdKnowledgeVO.enabled``
    是 ``Boolean``（真实链路当前正确），但该写法不应依赖「wire 恰好是 bool」。

    统一为**值语义**：
    - ``False`` / ``0`` / ``"0"`` / ``"false"`` / ``"no"`` / ``"off"``（大小写 / 空白容错）→ 停用；
    - 缺省（键不存在）或显式 ``None`` → 启用（与既有 ``.get(..., True)`` 语义一致）；
    - 其余 → ``bool(value)``。

    Args:
        item: 条目 dict（知识 / 样本对）；``None`` → 视为停用。

    Returns:
        True = 启用（可下发）。
    """
    if not isinstance(item, dict):
        return False
    value = item.get("enabled", True)
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "no", "off")
    return bool(value)


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

    async def push_enhancements(
        self,
        connection_id: int | None = None,
        context_item_keys: list[str] | None = None,
    ) -> dict[str, Any]:
        """取待推送增强物料并登记（W4；**T04d 起按 related_item_keys 裁剪**）。

        Args:
            connection_id: 问数连接 id（缺省由 mis-iqd 主连接兜底）。
            context_item_keys: **当前上下文** 的 item_key 集合（由问数请求携带的
                model / cube 决定）。提供时按各条 ``related_item_keys`` 裁剪 ``knowledge``
                （= 下发的 instructions）；缺省 / 为空 = 不裁剪（整库 build / 登记场景，
                保持既有行为，向后兼容）。

        Returns:
            ``{"sql_pairs", "knowledge", "sql_pair_count", "knowledge_count",
            "knowledge_total_count", "cropped", "message"}``。

            - ``knowledge``：裁剪后的待下发知识（将注入 WrenAI 的 instructions）；
            - ``knowledge_total_count``：裁剪前总数（可观测「裁掉了多少」）；
            - ``cropped``：本次是否应用了上下文裁剪。

        <p>无 ``related_item_keys`` 的条目 = 全连接通用，**恒保留**（不误裁）。
        fail-closed（异常上抛）与「不写库」的既有语义保持不变。
        """
        client = self._get_config_client()
        # 经内部 API 拉取 pending 物料；mis-iqd /enhance/push 返回同构结果
        sql_pairs = await client.get_sql_pairs(connection_id)
        knowledge = await client.get_knowledge(connection_id)
        pending_pairs = [p for p in sql_pairs if p.get("sync_status") == "pending"]
        pending_knowledge = [
            k for k in knowledge
            if k.get("sync_status") == "pending" and is_enabled(k)
        ]
        cropped_knowledge = crop_knowledge_by_context(pending_knowledge, context_item_keys)
        return {
            "sql_pairs": pending_pairs,
            "knowledge": cropped_knowledge,
            "sql_pair_count": len(pending_pairs),
            "knowledge_count": len(cropped_knowledge),
            "knowledge_total_count": len(pending_knowledge),
            "cropped": bool(context_item_keys),
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
            if p.get("sync_status") == "pending" and is_enabled(p)
        ]
        pending_knowledge = [
            k for k in knowledge
            if k.get("sync_status") == "pending" and is_enabled(k)
        ]

        # ①.5 真正下发（方案 A / 2026-09-27 实测格式）：
        #     样本 → `wren memory store` 写 knowledge/sql/*.md（+ 索引）；
        #     术语/口径/业务规则 → `knowledge/rules/mis-iqd-platform.md`（全量覆盖写）。
        #     说明：**只有写成功的 id 才回填 synced**，避免「界面已同步、wren 侧没有」的假象。
        delivery = await self._deliver_knowledge(
            cli,
            project_home,
            pending_pairs=pending_pairs,
            enabled_pairs=[p for p in sql_pairs if is_enabled(p)],
            enabled_knowledge=[k for k in knowledge if is_enabled(k)],
            pending_knowledge=pending_knowledge,
        )

        # ② context build（整库 rebuild，返回 mdl_hash）
        build_status = "success"
        build_error: str | None = None
        mdl_hash: str | None = None
        try:
            build_result = await cli.context_build(
                allow_write=True,
                project_dir=project_home,
            )
            mdl_hash = self._resolve_mdl_hash(build_result)
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
                    # 只回填**确实写进 wren** 的条目（见 ①.5 delivery）
                    "sql_pair_ids": delivery["pair_ids"],
                    "knowledge_ids": delivery["knowledge_ids"],
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })
                backfill_ok = True
            except IqdConfigClientError as exc:
                build_status = "failed"
                build_error = f"回填失败: {exc}"

        # ⑤ 报作业（失败仅告警，不阻断返回）
        synced_pairs = len(delivery["pair_ids"]) if backfill_ok else 0
        synced_knowledge = len(delivery["knowledge_ids"]) if backfill_ok else 0
        if delivery["error"] and not build_error:
            build_error = delivery["error"]
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
            if p.get("sync_status") == "pending" and is_enabled(p)
        ]
        pending_knowledge = [
            k for k in knowledge
            if k.get("sync_status") == "pending" and is_enabled(k)
        ]

        # ①.5 真正下发（方案 A；与 trigger_build_index 同口径，见 _deliver_knowledge）
        delivery = await self._deliver_knowledge(
            cli,
            project_home,
            pending_pairs=pending_pairs,
            enabled_pairs=[p for p in sql_pairs if is_enabled(p)],
            enabled_knowledge=[k for k in knowledge if is_enabled(k)],
            pending_knowledge=pending_knowledge,
        )

        # ② context build（强制重建：仅 build 阶段传 force=True）
        build_status = "success"
        build_error: str | None = None
        mdl_hash: str | None = None
        try:
            build_result = await cli.context_build(
                allow_write=True,
                force=True,
                project_dir=project_home,
            )
            mdl_hash = self._resolve_mdl_hash(build_result)
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
                    # 只回填**确实写进 wren** 的条目（见 ①.5 delivery）
                    "sql_pair_ids": delivery["pair_ids"],
                    "knowledge_ids": delivery["knowledge_ids"],
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })
                backfill_ok = True
            except IqdConfigClientError as exc:
                build_status = "failed"
                build_error = f"回填失败: {exc}"

        synced_pairs = len(delivery["pair_ids"]) if backfill_ok else 0
        synced_knowledge = len(delivery["knowledge_ids"]) if backfill_ok else 0
        if delivery["error"] and not build_error:
            build_error = delivery["error"]
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

        重置 WrenAI 记忆索引后重新下发。**不改写 MDL / 不跑 context build**。

        <p>⚠️ ``build_status`` 固定为 ``skipped``（本动作与 MDL 构建无关）。reset/index
        任一失败只写 ``index_status=failed`` + ``index_error``。若把 reset 失败写进
        ``build_status=failed``，建模台流水线会误报「MDL 构建失败」（重试 MDL 构建能过、
        点重新索引却必挂的根因）。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            wait: 是否阻塞至完成（自愈默认 True）。

        Returns:
            :class:`SyncResult`（build_status=skipped，index_status=reset+index 结果）。
        """
        from src.adapters.iqd_cli import IqdCli, IqdCliError
        from src.adapters.iqd_config_client import IqdConfigClient

        cli = IqdCli()
        client = self._get_config_client()

        cid = connection_id or await self._resolve_primary_connection_id(client)
        if cid is None:
            result = SyncResult(
                connection_id=None,
                coalesced=False,
                build_status="skipped",
                index_status="failed",
                index_error="no primary connection",
            )
            await self._report_selfheal_job(client, None, "reindex", result)
            return result

        # 方案 A 多连接：index 落到本连接专属 wren project 目录（project_dir）
        project_home = self._project_home(cid)

        index_status = "skipped"
        index_error: str | None = None

        # ① memory reset（失败记到 index，绝不污染 build_status）
        try:
            await cli.memory_reset(project_dir=project_home)
        except IqdCliError as exc:
            index_status = "failed"
            index_error = f"memory reset failed: {exc}"
            logger.warning("IQD memory reset failed", connection_id=cid, error=str(exc))
            result = SyncResult(
                connection_id=cid,
                coalesced=False,
                build_status="skipped",
                index_status=index_status,
                build_mdl_hash=None,
                synced_sql_pair_count=0,
                synced_knowledge_count=0,
                build_error=None,
                index_error=index_error,
            )
            await self._report_selfheal_job(client, cid, "reindex", result)
            return result

        # ② memory index
        try:
            await cli.memory_index(project_dir=project_home)
            index_status = "success"
        except IqdCliError as exc:
            index_status = "failed"
            index_error = str(exc)
            logger.warning("IQD reindex memory index failed", connection_id=cid, error=str(exc))

        result = SyncResult(
            connection_id=cid,
            coalesced=False,
            build_status="skipped",
            index_status=index_status,
            build_mdl_hash=None,
            synced_sql_pair_count=0,
            synced_knowledge_count=0,
            build_error=None,
            index_error=index_error,
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
        warnings_raw = validate.get("warnings") or []
        errors_raw = validate.get("errors") or []
        warnings: list[str] = [str(w).strip() for w in warnings_raw if str(w).strip()]
        # 失败时若无独立 warnings，把 errors/summary 拆条，便于前端逐条查看
        if not ok and not warnings:
            if errors_raw:
                warnings = [str(e).strip() for e in errors_raw if str(e).strip()]
            elif summary:
                warnings = [p.strip() for p in summary.split(";") if p.strip()]
        # 成功但仅有汇总 summary、warnings 空：仍回传一条，避免「有 3 个警告却看不到」
        if ok and not warnings and summary:
            warnings = [summary]
        result = SyncResult(
            connection_id=cid, coalesced=False,
            build_status="success" if ok else "failed",
            index_status="skipped",
            build_mdl_hash=None,
            synced_sql_pair_count=0, synced_knowledge_count=0,
            build_error=None if ok else (summary or "模型校验未通过"),
            warnings=warnings,
            raw=(validate.get("raw") or None) or None,
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
            payload: dict[str, Any] = {
                "connection_id": connection_id,
                "action": action,
                "index_status": result.index_status,
                "index_error": result.index_error,
                "synced_sql_pair_count": result.synced_sql_pair_count,
                "synced_knowledge_count": result.synced_knowledge_count,
            }
            if action == "reindex":
                # 重新索引不跑 context build：不覆盖既有 build_*，避免流水线误报「MDL 构建失败」
                pass
            elif action == "validate":
                # 校验只读：回写 build_status/build_error 供徽标，但不清空 mdl_hash
                payload["build_status"] = result.build_status
                payload["build_error"] = result.build_error
            else:
                payload["build_status"] = result.build_status
                payload["build_mdl_hash"] = result.build_mdl_hash
                payload["build_error"] = result.build_error
            await client.report_sync_job(payload)
        except Exception as exc:  # noqa: BLE001 - 报作业失败仅告警，不阻断返回
            logger.warning("IQD self-heal job report failed", action=action, error=str(exc))

    @staticmethod
    def _apply_primary_keys(
        mdl: dict[str, Any], catalog_items: list[dict[str, Any]]
    ) -> int:
        """把平台 catalog 的主键标记回写进派生 MDL（**只增不减**，返回生效的模型数）。

        <p><b>为什么需要</b>：主键是 wren 去重/聚合/join 基数推断的基础；曾经因为
        「平台派生 MDL →（反向导入）覆盖基线」的自循环，把 wren 原生 MDL 里的主键洗成了空
        （2026-09-28 实测：`mdl_raw` 无 `primaryKey`、catalog 192 列 `is_primary_key` 全 0）。

        <p><b>只增不减</b>：只有「catalog 明确标了主键」的列才会被置位；某张表在 catalog 里
        没有任何主键标记时**一律不动基线**（绝不因为「平台侧没有」就把基线里的主键清掉 ——
        那正是把 PK 洗掉的机制）。

        Args:
            mdl: 派生中的 MDL（原地修改）。
            catalog_items: 平台清单元数据（``get_catalog_meta``；含 ``item_key`` / ``kind`` /
                ``is_primary_key``）。

        Returns:
            被回填主键的模型数量（0=平台侧无主键信息，保持基线原样）。
        """
        pk_by_table: dict[str, list[str]] = {}
        for item in catalog_items or []:
            if str(item.get("kind") or "") != "column":
                continue
            key = str(item.get("item_key") or item.get("itemKey") or "")
            flag = item.get("is_primary_key")
            if flag is None:
                flag = item.get("isPrimaryKey")
            if not flag or "." not in key:
                continue
            table, _, column = key.partition(".")
            pk_by_table.setdefault(table, []).append(column)

        applied = 0
        for model in mdl.get("models", []):
            if not isinstance(model, dict):
                continue
            table = str(model.get("name") or "")
            wanted = pk_by_table.get(table)
            if not wanted:
                continue  # 平台没说 → 保留基线（关键：绝不当作「无主键」清空）
            columns = [c for c in model.get("columns", []) if isinstance(c, dict)]
            present = {str(c.get("name")) for c in columns}
            pks = [c for c in wanted if c in present]
            if not pks:
                continue
            for column in columns:
                if str(column.get("name")) in pks:
                    column["isPrimaryKey"] = True
            if not model.get("primaryKey"):
                # mdl.json 用 camelCase `primaryKey`（复合主键 = 列表；wren context show 会显示 pk=[…]）
                model["primaryKey"] = pks
            applied += 1
        if applied:
            logger.info("IQD primary keys applied from catalog", models=applied)
        return applied

    @staticmethod
    def _render_rules_markdown(knowledge: list[dict[str, Any]]) -> str:
        """把（已启用的）平台知识渲染成 ``knowledge/rules/mis-iqd-platform.md`` 正文。

        <p>**全量渲染**：该文件是平台管理的整份状态 —— 只渲染 pending 会让下一次下发把
        已下发条目擦掉。文件头写明「自动生成、勿手改」，因为每次下发都会整份覆盖。
        """
        grouped: dict[str, list[dict[str, Any]]] = {}
        for item in knowledge:
            kind = str(item.get("kind") or "")
            section = IQD_KNOWLEDGE_SECTIONS.get(kind, IQD_KNOWLEDGE_FALLBACK_SECTION)
            grouped.setdefault(section, []).append(item)

        lines = [
            "# mis-iqd 平台下发知识",
            "",
            "> 由 mis-iqd「知识与规则」页下发，**自动生成**：每次下发整份覆盖，请勿手改。",
            "> 读取入口：`wren context instructions`（本文件不进 memory index）。",
            "",
        ]
        for section, items in grouped.items():
            lines.append(f"## {section}")
            lines.append("")
            for item in items:
                title = str(item.get("title") or "").strip()
                content = str(item.get("content") or "").strip()
                if not title and not content:
                    continue
                lines.append(f"- **{title}**：{content}" if content else f"- **{title}**")
            lines.append("")
        return "\n".join(lines).rstrip() + "\n"

    async def _deliver_knowledge(
        self,
        cli: Any,
        project_home: str,
        *,
        pending_pairs: list[dict[str, Any]],
        enabled_pairs: list[dict[str, Any]],
        enabled_knowledge: list[dict[str, Any]],
        pending_knowledge: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """把知识**真正**下发到 wren project（方案 A），返回「确实写成功」的 id 与错误摘要。

        <p>样本逐条 ``wren memory store``（单条失败不影响其它条目）；规则整文件写
        ``knowledge/rules/mis-iqd-platform.md``。**只有写成功的 id 才允许回填 synced** ——
        此前「build 成功即回填全部 pending」正是「界面已同步、wren 侧没有」的来源。
        """
        pair_ids: list[int] = []
        errors: list[str] = []
        for pair in pending_pairs:
            nl = str(pair.get("question") or "").strip()
            sql = str(pair.get("wren_sql") or pair.get("sql_text") or "").strip()
            if not nl or not sql:
                errors.append(f"sql_pair#{pair.get('id')}: 缺 question/wren_sql")
                continue
            try:
                await cli.memory_store(
                    nl=nl, sql=sql, tags=IQD_SAMPLE_TAG, project_dir=project_home
                )
            except Exception as exc:  # noqa: BLE001 - 单条失败不阻断其余条目
                errors.append(f"sql_pair#{pair.get('id')}: {exc}")
                continue
            if pair.get("id") is not None:
                pair_ids.append(pair["id"])

        # ①b 回收：wren 侧「平台下发但已不再需要」的样本文件（改动/停用/删除都会落到这里）
        pruned = 0
        prune_error: str | None = None
        if hasattr(cli, "list_project_files"):
            pruned, prune_error = await self._prune_stale_sample_files(
                cli, project_home, enabled_pairs=enabled_pairs
            )
            if prune_error:
                errors.append(prune_error)

        rules_error: str | None = None
        if enabled_knowledge:
            try:
                await cli.write_project_files(
                    [
                        {
                            "path": IQD_RULES_REL_PATH,
                            "content": self._render_rules_markdown(enabled_knowledge),
                        }
                    ],
                    project_dir=project_home,
                )
            except Exception as exc:  # noqa: BLE001 - 规则失败只影响 knowledge 回填
                rules_error = f"knowledge/rules 下发失败: {exc}"
        if rules_error:
            errors.append(rules_error)

        knowledge_ids = (
            [] if rules_error else [k["id"] for k in pending_knowledge if k.get("id") is not None]
        )
        logger.info(
            "IQD knowledge delivered",
            project_home=project_home,
            pairs=len(pair_ids),
            pending_pairs=len(pending_pairs),
            knowledge=len(knowledge_ids),
            errors=len(errors),
        )
        return {
            "pair_ids": pair_ids,
            "knowledge_ids": knowledge_ids,
            "pruned": pruned,
            "errors": errors,
            "error": ("知识下发未全部成功: " + "; ".join(errors)) if errors else None,
        }

    @staticmethod
    def _sample_nl_sql(pair: dict[str, Any]) -> tuple[str, str]:
        """取样本的 (nl, sql) 归一值（与 wren ``knowledge/sql/*.md`` frontmatter 对齐）。"""
        return (
            str(pair.get("question") or "").strip(),
            str(pair.get("wren_sql") or pair.get("sql_text") or "").strip(),
        )

    @staticmethod
    def _parse_knowledge_sql_md(content: str) -> dict[str, str]:
        """解析 ``knowledge/sql/*.md`` 的 YAML frontmatter（平铺 ``key: value``）。

        <p>只处理平铺键；长值被 YAML 折行（缩进续行）时按「空格拼接」还原 —— wren 的
        ``memory dump`` 就是这么输出长 SQL 的（``sql: SELECT … GROUP\\n    BY 1``）。
        """
        lines = content.splitlines()
        if not lines or lines[0].strip() != "---":
            return {}
        out: dict[str, str] = {}
        current: str | None = None
        for line in lines[1:]:
            if line.strip() == "---":
                break
            if line[:1] in (" ", "\t") and current:
                out[current] = (out[current] + " " + line.strip()).strip()
                continue
            if ":" not in line:
                current = None
                continue
            key, _, value = line.partition(":")
            current = key.strip()
            out[current] = value.strip().strip('"').strip("'")
        return out

    @staticmethod
    def _frontmatter_block(content: str) -> str:
        """取 ``---`` 之间的 frontmatter 原文（无 frontmatter 返回空串）。"""
        lines = content.splitlines()
        if not lines or lines[0].strip() != "---":
            return ""
        for idx in range(1, len(lines)):
            if lines[idx].strip() == "---":
                return "\n".join(lines[1:idx])
        return ""

    @classmethod
    def _is_platform_sample(cls, content: str) -> bool:
        """是否平台下发的样本文件（按平台标记识别；人工/agent 写的文件一律不碰）。

        <p><b>为什么直接扫 frontmatter 原文</b>：``wren memory store --tags source:mis-iqd`` 落盘是
        **YAML 列表**形态 ——

        <pre>
        source: user
        tags:
        - source:mis-iqd
        </pre>

        按「平铺 key: value」解析会把 ``- source:mis-iqd`` 当成键 ``- source``，``tags`` 读成空，
        于是平台文件被误判成人工写的 → **永不回收**（2026-09-28 真机实测踩到）。这里改成在
        frontmatter 原文里正则匹配标记，同时容忍 ``source: mis-iqd``（冒号后带空格）写法。
        """
        return re.search(r"source\s*:\s*mis-iqd", cls._frontmatter_block(content)) is not None

    async def _prune_stale_sample_files(
        self,
        cli: Any,
        project_home: str,
        *,
        enabled_pairs: list[dict[str, Any]],
    ) -> tuple[int, str | None]:
        """回收 wren 侧「平台下发但已不再需要」的样本文件。

        <p><b>为什么必须有它</b>（2026-09-27 wren 0.13.3 实测）：``wren memory forget``
        只删索引行、**保留** ``knowledge/sql/*.md``；而 ``memory store`` 的文件名由 wren 生成
        （中文统一落 ``query-N.md``，平台无法按 id 反查）。于是「编辑样本 / 停用 / 删除」
        都会在 wren 侧留下旧文件，下次 ``memory index`` 又把旧样本吃回索引。

        <p><b>对账口径</b>：只看带平台 tag 的文件（人工/agent 写的不动）；``(nl, sql)`` 仍在
        启用集里的保留一个（重复的删掉），不在的删除。**解析不出 nl 或 sql 的文件一律跳过**
        —— 宁可留残件，也绝不误删。
        """
        try:
            files = await cli.list_project_files(IQD_SAMPLE_DIR, project_dir=project_home)
        except Exception as exc:  # noqa: BLE001 - 对账失败只告警，不回滚已下发内容
            return 0, f"样本对账失败: {exc}"

        wanted = {self._sample_nl_sql(p) for p in enabled_pairs}
        wanted.discard(("", ""))
        kept: set[tuple[str, str]] = set()
        stale: list[str] = []
        for item in files:
            content = str(item.get("content") or "")
            if not self._is_platform_sample(content):
                continue
            meta = self._parse_knowledge_sql_md(content)
            key = (str(meta.get("nl") or "").strip(), str(meta.get("sql") or "").strip())
            if not key[0] or not key[1]:
                continue  # fail-safe：解析不全 → 不动
            if key in wanted and key not in kept:
                kept.add(key)
                continue
            stale.append(str(item.get("path") or ""))

        stale = [p for p in stale if p]
        if not stale:
            return 0, None
        try:
            await cli.delete_project_files(stale, project_dir=project_home)
        except Exception as exc:  # noqa: BLE001 - 删除失败只告警
            return 0, f"样本回收失败: {exc}"
        logger.info("IQD stale sample files pruned", project_home=project_home, count=len(stale))

        problems: list[str] = []
        # 回收后**必须重建索引**：`wren memory index` 是增量的，清不掉「已删文件对应的孤儿行」
        # （2026-09-28 真机实测：删了 query.md 后 memory check 仍报 index 多 1 条 + stale index）。
        # `memory reset` 只 drop 派生索引、保留 knowledge/sql/*.md 源文件，随后 index 全量重建；
        # 其非交互 flag 来自部署配置 `WREN_SELF_HEAL_MEMORY_RESET_ARGS`（本环境已配 --force）。
        try:
            await cli.memory_reset(project_dir=project_home)
            await cli.memory_index(project_dir=project_home)
        except Exception as exc:  # noqa: BLE001 - 重建失败只告警（文件已删，下轮可再修）
            problems.append(f"回收后重建索引失败: {exc}")

        # 自证：让 wren 自己对账「源文件 vs 索引」，漂移就上报（不再静默）
        try:
            check = await cli.memory_check(project_dir=project_home)
            blob = f"{check.get('stdout') or ''}{check.get('stderr') or ''}".strip()
            lowered = blob.lower()
            if "not indexed" in lowered or "stale index" in lowered or "out of sync" in lowered:
                problems.append("wren memory check 报索引漂移: " + blob.replace("\n", " | ")[:200])
        except Exception as exc:  # noqa: BLE001 - 自检失败只告警
            problems.append(f"memory check 自检失败: {exc}")

        return len(stale), ("；".join(problems) if problems else None)

    @staticmethod
    def _load_derived_mdl(mdl_dir: str | None) -> dict[str, Any] | None:
        """读回本次派生的 MDL（``mdl_dir/manifest.json``），供发布后自检对账。

        Returns:
            dict；不可读时 ``None``（自检据此跳过，不误报）。
        """
        import json as _json
        import os

        if not mdl_dir:
            return None
        path = (
            mdl_dir
            if mdl_dir.endswith("manifest.json")
            else os.path.join(mdl_dir, "manifest.json")
        )
        try:
            with open(path, encoding="utf-8") as fh:
                data = _json.load(fh)
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    @staticmethod
    def _resolve_mdl_hash(result: dict[str, Any] | None) -> str | None:
        """取本次部署的 ``mdl_hash``。

        <p>优先级：① :class:`IqdCli.context_build` 返回的**平台内容哈希**
        （``sha256(target/mdl.json)[:16]``，平台部署 MDL 时算，不再依赖 wren CLI 是否回 hash）；
        ② 解析 CLI stdout（老路径）；③ 最后才用 :meth:`_fallback_mdl_hash` 造的兜底值。

        <p>为什么重要：回填的 ``wren_ref_id`` 与 S3 漂移检测都比对这个值；此前一直是
        ``wqd-{时间}-{随机}``，与 wren 侧任何值都不可比 → 漂移判定形同虚设。
        """
        if isinstance(result, dict):
            value = result.get("mdl_hash")
            if isinstance(value, str) and value.strip():
                return value.strip()
        stdout = result.get("stdout", "") if isinstance(result, dict) else ""
        return IqdAskService._parse_mdl_hash(stdout or "")

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
        ``context_build(mdl_dir=tmp, ...)`` 部署**MDL**（写 ``target/mdl.json``）。

        <p>物料（样本 / 术语口径）**不在本方法**下发：它们属 ``scope=materials`` 路径
        （:meth:`trigger_build_index` → ``wren memory store`` + ``knowledge/rules/``）。

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

        # catalog 元数据（含 is_primary_key）：供主键回填；取不到**不阻断**（保护语义 = 不动基线）
        try:
            catalog_meta = await client.get_catalog_meta(cid)
        except Exception as exc:  # noqa: BLE001 - 主键回填是 best-effort：取不到就保持基线
            logger.warning("IQD get_catalog_meta failed, primary keys untouched", error=str(exc))
            catalog_meta = []

        # ② 派生完整 MDL 并写出临时目录
        try:
            mdl_dir, derived = self.build_mdl_from_catalog(
                cid, mdl_raw, edited_items, catalog_meta
            )
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
                allow_write=True,
                project_dir=project_home,
            )
            mdl_hash = self._resolve_mdl_hash(build_result)
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

        # ④b 发布后自检（2026-09-28）：读回引擎上下文与派生 MDL 对账。
        #     只报不改；读回失败也仅记 warning，绝不改 build_status。
        #     动机：cube/关系曾「发布成功但引擎侧没有」静默存在一整轮（只写了 target/mdl.json）。
        selfcheck_warnings: list[str] = []
        if build_status == "success":
            try:
                shown = await cli.context_show(project_dir=project_home)
                if shown.get("ok"):
                    engine_ctx = shown.get("data") or {}
                    selfcheck_warnings = PublishSelfCheck.compare(
                        self._load_derived_mdl(mdl_dir), engine_ctx
                    )
                    logger.info(
                        "IQD publish selfcheck",
                        connection_id=cid,
                        summary=PublishSelfCheck.summary(engine_ctx),
                        warnings=len(selfcheck_warnings),
                    )
                else:
                    selfcheck_warnings = [
                        f"自检：无法读回引擎上下文（{shown.get('error') or '未知原因'}）"
                    ]
            except Exception as exc:  # noqa: BLE001 - 自检失败不得影响发布结果
                logger.warning("IQD publish selfcheck degraded", error=str(exc))
                selfcheck_warnings = [f"自检：执行异常（{str(exc)[:80]}）"]

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
                unmatched_edit_count=int(derived.get("unmatched_edit_count") or 0),
                unmatched_edits=derived.get("unmatched_edits"),
                warnings=selfcheck_warnings,
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
            warnings=list(selfcheck_warnings),
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
        self,
        connection_id: int,
        mdl_raw: str | None,
        edited_items: list[dict[str, Any]],
        catalog_items: list[dict[str, Any]] | None = None,
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
        #    T03e：``landed`` 收集「成功落入派生 MDL 的 edited_items 下标」，供 ③.1 计算未匹配清单。
        landed: set[int] = set()
        self._materialize_missing_nodes(mdl, edited_items, landed)

        # ③ patch 编辑字段（item_key → MDL 节点定位）；patch 命中即为「已落入」。
        for idx, it in enumerate(edited_items):
            key = it.get("item_key") or ""
            kind = it.get("kind") or ""
            if self._patch_mdl_node(mdl, key, kind, it):
                landed.add(idx)

        # ③.1 T03e（可见性补丁）：收集「已编辑但未能落入 MDL」的节点并发结构化告警。
        #     **不改「跳过」决策**，只把此前的完全静默转为可见痕迹（尤其 kind=model）。
        unmatched = self._collect_unmatched_edits(edited_items, landed)
        self._log_unmatched_edits(connection_id, unmatched)

        # ③.2 主键回填（2026-09-28）：平台 catalog 的 `is_primary_key` 是权威；
        #      历史上「平台派生 MDL → 反向导入覆盖基线」会把主键洗掉（mdl_raw 里已无 PK，
        #      而 catalog 也全是 0），这里做**只增不减**的回写 + 保护。
        pk_applied = self._apply_primary_keys(mdl, catalog_items or [])

        # ④ 写临时目录 manifest.json
        tmp_dir = tempfile.mkdtemp(prefix=f"iqd_mdl_{connection_id}_")
        manifest_path = os.path.join(tmp_dir, "manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(mdl, fh, ensure_ascii=False, indent=2)

        payload: dict[str, Any] = {
            "connection_id": connection_id,
            "mdl_dir": tmp_dir,
            "edited_count": len(edited_items),
            # T03e：随 payload 附带未匹配清单（纯 additive，不改既有接口契约），
            # 供未来 sync 状态 / 前端「N 项编辑未生效」消费（本轮不接前端）。
            "unmatched_edit_count": len(unmatched),
            "unmatched_edits": unmatched,
            "primary_key_applied": pk_applied,
        }
        logger.info(
            "IQD build_mdl_from_catalog wrote manifest",
            connection_id=connection_id,
            mdl_dir=tmp_dir,
            edited_count=len(edited_items),
            unmatched_edit_count=len(unmatched),
        )
        return tmp_dir, payload

    @staticmethod
    def _patch_mdl_node(mdl: dict[str, Any], item_key: str, kind: str, it: dict[str, Any]) -> bool:
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

        Returns:
            ``True`` 表示定位到目标节点并套用了编辑字段（该 item 已落入 MDL）；
            ``False`` 表示未找到对应节点（该 item 未被 patch —— 可能是「未物化的新建节点」，
            如全新建 model；由 :meth:`_collect_unmatched_edits` 汇总为可见告警）。
        """
        def _set(node: dict[str, Any]) -> None:
            if it.get("display_name") is not None:
                node["name"] = it["display_name"]
            if it.get("description") is not None:
                node["description"] = it["description"]
            if it.get("expression") is not None:
                node["expression"] = it["expression"]

        def _set_column(column: dict[str, Any]) -> None:
            """列的 patch：**只改 description / expression，绝不改 name**。

            <p>MDL 的列名是引用锚点（模型/关系/表达式都按它引用），而平台侧列的
            ``display_name`` 只是物理列名回显 —— 按它改 name 会把锚点改坏。
            """
            if it.get("description") is not None:
                column["description"] = it["description"]
            if it.get("expression") is not None:
                column["expression"] = it["expression"]

        if item_key.startswith("mdl:model:"):
            name = item_key[len("mdl:model:"):]
            for node in mdl.get("models", []):
                if node.get("name") == name:
                    _set(node)
                    return True
        elif item_key.startswith("mdl:relationship:"):
            name = item_key[len("mdl:relationship:"):]
            for node in mdl.get("relationships", []):
                if node.get("name") == name:
                    _set(node)
                    return True
        elif item_key.startswith("mdl:cube:"):
            name = item_key[len("mdl:cube:"):]
            for node in mdl.get("cubes", []):
                if node.get("name") == name:
                    _set(node)
                    return True
        elif item_key.startswith("mdl:metric:"):
            name = item_key[len("mdl:metric:"):]
            for node in mdl.get("metrics", []):
                if node.get("name") == name:
                    _set(node)
                    return True
        elif item_key.startswith("mdl:dimension:"):
            name = item_key[len("mdl:dimension:"):]
            for node in mdl.get("dimensions", []):
                if node.get("name") == name:
                    _set(node)
                    return True
        elif item_key.startswith("mdl:view:"):
            name = item_key[len("mdl:view:"):]
            for node in mdl.get("views", []):
                if node.get("name") == name:
                    _set(node)
                    return True
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
                                _set_column(column)
                                return True
            elif len(parts) == 2:
                # <table>.<column>（平台 catalog 里物理列 / 计算列的稳定键形态）→
                # models[name==<table>].columns[name==<column>]。
                # 缺这条分支时，「在语义模型页 / 属性面板改列描述」会**静默不生效**
                # ——T03e 口径收窄后唯一剩下的真实告警正是它（2026-09-28 真机实测）。
                table, col = parts[0], parts[1]
                for model in mdl.get("models", []):
                    if model.get("name") == table:
                        for column in model.get("columns", []):
                            if column.get("name") == col:
                                _set_column(column)
                                return True
        # <cubeKey>.<measure> 形态（cubeKey=mdl:cube:<cube>）
        if item_key.startswith("mdl:cube:") and "." in item_key[len("mdl:cube:"):]:
            cube_part = item_key[len("mdl:cube:"):]
            cube_name, measure_name = cube_part.split(".", 1)
            for cube in mdl.get("cubes", []):
                if cube.get("name") == cube_name:
                    for measure in cube.get("measures", []):
                        if measure.get("name") == measure_name:
                            _set(measure)
                            return True
        return False

    # ================================================================ T03e：未匹配编辑可见化

    @staticmethod
    def _has_effective_patch(it: dict[str, Any]) -> bool:
        """该项是否**真有需要套用的编辑**（T03e 口径收窄，2026-09-28）。

        <p><b>为什么需要</b>：``edited_items`` 里混着两类「没有可套用 patch」的行：
        <ul>
          <li><b>表发现导入的物理列</b>（``item_key=<table>.<column>``）：``display_name`` 只是
              列名回显，``description/expression`` 为空 —— 它本来就在 ``model.columns`` 里；</li>
          <li><b>平台侧展示用行</b>（kind=``table``，与 kind=``model`` 是同一张表的两种表示）。</li>
        </ul>
        旧口径把它们全算成「编辑未生效」。实测 900001：58 条「未生效」里 **56 条是这类噪音**，
        真需要提醒的是「改过 description/expression 的列」与「新建的 cube/view/metric」。

        <p>判据：只有 ``column``（表发现导入的物理列）与 ``table``（展示用行）的
        ``display_name`` 是**列名/表名回显**，必须有 ``description`` / ``expression`` 才算真编辑；
        其余类型（``model`` / ``cube`` / ``measure`` / ``dimension`` / ``relationship`` /
        ``view`` / ``metric``）的 ``display_name`` 本身就代表「新建或改名」——
        **全新建 model 正是这类**（刻意不物化、必须提醒），不能漏。
        （已落入 MDL 的项在调用方已按 ``landed`` 排除，所以模型导入那些不会误报。）
        """
        kind = str(it.get("kind") or "")
        desc = str(it.get("description") or "").strip()
        expr = str(it.get("expression") or "").strip()
        if kind in ("column", "table"):
            return bool(desc or expr)
        return bool(desc or expr or str(it.get("display_name") or "").strip())

    @staticmethod
    def _collect_unmatched_edits(
        edited_items: list[dict[str, Any]], landed: set[int]
    ) -> list[dict[str, Any]]:
        """收集「已编辑（``edit_revision`` 非空）但未能落入派生 MDL」的节点（T03e）。

        入参 ``edited_items`` 源自 mis-iqd ``getCatalogFull`` → ``findEditedItems``，
        **其本身即 ``edit_revision IS NOT NULL`` 的平台编辑节点**（契约见
        ``IqdAdminService#getCatalogFull`` 的 javadoc：edited_items = edit_revision 非空的
        平台编辑节点），故此处只需比对「是否落入 MDL」即可得到「被编辑却静默丢弃」的清单。

        未落入（下标不在 ``landed`` 中）的典型成因：
        - ``kind=model``：全新建 model 走 from-table 路径 —— **刻意不物化**（真实 MDL model
          schema 未经 W0 实测校准，盲写可能产出非法 MDL 致 ``wren context build`` 整体失败，
          比「该模型缺失」更糟）。本清单把它暴露出来，留待 W0 探针校准后再物化。
        - ``kind=relationship``：非信封（历史 MDL 同步来源的裸 condition）无法还原 models。
        - ``measure``/``dimension``：宿主 cube 缺失（如该 cube 为全新建但未成功物化）。
        - 计算列 / 物理列：宿主 model 缺失（如宿主为全新建 model，同 ``kind=model``）。
        - ``metric``/``dimension``/``view``：基线中不存在且无物化能力的新建节点。

        Args:
            edited_items: 平台已编辑节点列表。
            landed: 成功落入派生 MDL 的 ``edited_items`` 下标集合。

        Returns:
            结构化未匹配清单，每项含 ``item_key`` / ``kind`` / ``parent_key`` / ``display_name``。
        """
        unmatched: list[dict[str, Any]] = []
        for idx, it in enumerate(edited_items):
            if idx in landed:
                continue
            if not isinstance(it, dict):
                continue
            # 口径收窄（2026-09-28）：没有可套用 patch 的行不算「编辑未生效」——
            # 导入的物理列（display_name 是同名回显）与展示用 table 行都会落到这里，
            # 否则界面会拿 50+ 条噪音当告警（实测 58 条里 56 条是噪音）。
            if not IqdAskService._has_effective_patch(it):
                continue
            unmatched.append(
                {
                    "item_key": it.get("item_key") or "",
                    "kind": it.get("kind") or "",
                    "parent_key": it.get("parent_key"),
                    "display_name": it.get("display_name"),
                }
            )
        return unmatched

    @staticmethod
    def _log_unmatched_edits(connection_id: int, unmatched: list[dict[str, Any]]) -> None:
        """对「已编辑但未能落入 MDL」的节点发出**可见 WARNING**（T03e 可见性补丁）。

        此前该情形**完全静默**：运维/开发看到「建了模型、状态也 SYNCED，但问数查不到」时
        无从定位。本方法**不改「跳过」决策**，仅把静默丢弃转为结构化告警（含
        ``item_key`` / ``kind`` / ``connection_id`` 及按 kind 的分组计数）。

        Args:
            connection_id: 问数连接 id。
            unmatched: :meth:`_collect_unmatched_edits` 产出的未匹配清单（为空则不记录）。
        """
        if not unmatched:
            return
        by_kind: dict[str, int] = {}
        for item in unmatched:
            kind = str(item.get("kind") or "")
            by_kind[kind] = by_kind.get(kind, 0) + 1
        logger.warning(
            "IQD build_mdl_from_catalog: edited nodes NOT materialized into MDL",
            connection_id=connection_id,
            unmatched_count=len(unmatched),
            unmatched_by_kind=by_kind,
            unmatched_model_count=by_kind.get("model", 0),
            unmatched_items=unmatched,
        )

    # ================================================================ T03：新建节点物化（R-3）

    @staticmethod
    def _table_key_of_model(
        model_item: dict[str, Any],
        edited_items: list[dict[str, Any]],
        model_name: str,
    ) -> str | None:
        """解析「新 model 对应的物理表 key」。

        <p>from-table 导入时 catalog 同时写入 ``kind=table``（item_key=表名，无前缀）
        与 ``kind=column``（parent_key=表名）。优先用 model 的 ``parent_key``；否则回落到
        表名本身（from-table 的 tableKey 就是表名，见 IqdCatalogNodeService.resolveSourceTable）。

        Returns:
            table key（用于取列）；无法确定时 ``None``。
        """
        parent = str(model_item.get("parent_key") or "").strip()
        if parent and parent != model_item.get("item_key"):
            return parent
        # from-table 形态：table 行 item_key == 表名；优先找 name 匹配的 table 行
        for it in edited_items:
            if (it.get("kind") or "") != "table":
                continue
            key = str(it.get("item_key") or "").strip()
            display = str(it.get("display_name") or "").strip()
            if key == model_name or display == model_name:
                return key
        return model_name or None

    @staticmethod
    def _columns_of_table(
        edited_items: list[dict[str, Any]], table_key: str | None
    ) -> list[dict[str, Any]]:
        """取某物理表下的列定义（``kind=column`` 且 ``parent_key`` 命中）。"""
        if not table_key:
            return []
        out: list[dict[str, Any]] = []
        for it in edited_items:
            if (it.get("kind") or "") != "column":
                continue
            if str(it.get("parent_key") or "").strip() == table_key:
                out.append(it)
        return out

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
        self,
        mdl: dict[str, Any],
        edited_items: list[dict[str, Any]],
        landed: set[int] | None = None,
    ) -> None:
        """把建模台**新建**、但 ``mdl_raw`` 基线中不存在的节点物化进派生 MDL（T03 / R-3 补丁）。

        背景：``mdl_raw`` 是 WrenAI 最近一次同步快照；建模台新建的 cube / measure /
        dimension / relationship / 计算列在基线里**没有对应节点**，而
        :meth:`_patch_mdl_node` 只按 name 定位**已有**节点并改字段 —— 找不到即**静默丢弃**。
        不做物化，M-G2（建关系 → 建 cube → 问数命中 cube 聚合）与 MR-04（计算列）产出的
        语义对象永远不会进入 build，功能形同虚设。

        本方法按 item_key 映射把缺失节点**新增**进派生 MDL，幂等（同名/同键已存在即跳过），
        且不破坏既有节点结构（models/relationships/cubes 的原有数组元素原样保留）。

        T03e：新增 ``landed`` 出参，把「本方法已确保其存在于 MDL 的 ``edited_items`` 下标」
        （含**新建**与**基线已有**两种情况）回传，供 :meth:`_collect_unmatched_edits`
        计算「已编辑但未落入 MDL」的清单。仅收集，**不改变任何物化/跳过决策**。

        Args:
            mdl: 派生中的 MDL dict（**原地修改**；顶层容器已归一）。
            edited_items: 平台已编辑节点（``item_key/kind/parent_key/display_name/data_type/
                expression/model_ref``；T03 起 ``IqdAdminService.getCatalogFull`` 会带上
                后四项）。
            landed: 可选出参集合，收集已落入 MDL 的 ``edited_items`` 下标（原地更新）。
        """
        if landed is None:
            landed = set()
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

        # ⓪ 全新 model（from-table 路径）—— 必须先于 cube/relationship，因为它们的
        #    baseObject / models 可能引用新模型。
        #    <p><b>为什么此前刻意不做</b>：真实 MDL 的 model schema（tableReference / columns
        #    必填项）未经真机校准，盲写可能产出非法 MDL 打挂整条 build。
        #    <p><b>2026-09-28 已校准</b>（真机 mdl_raw 实测）：
        #    model = {name, tableReference{catalog,schema,table}, columns[{name,type,notNull,
        #    properties,isCalculated[,expression,isPrimaryKey]}], primaryKey[], cached, properties}。
        #    因此现在可以安全物化：**以基线中任一既有 model 的 tableReference 为模板**取
        #    catalog/schema（同连接同库），只替换 table；基线无 model 可参照时**跳过**
        #    （fail-safe：宁可留在 unmatched 清单，也不盲猜 schema 产出非法 MDL）。
        template_ref: dict[str, Any] | None = None
        for m in models:
            if isinstance(m, dict) and isinstance(m.get("tableReference"), dict):
                template_ref = dict(m["tableReference"])
                break
        for idx, it in enumerate(edited_items):
            if (it.get("kind") or "") != "model":
                continue
            item_key = str(it.get("item_key") or "")
            if not item_key.startswith("mdl:model:"):
                continue
            name = (it.get("display_name") or "").strip() or self._item_key_tail(item_key)
            if not name or name in model_by_name:
                if name in model_by_name:
                    landed.add(idx)  # 基线已有 → 由 patch 负责改名/改描述
                continue
            if template_ref is None:
                # 无基线可参照：不盲写（保持 unmatched，由 T03e 告警可见）
                logger.warning(
                    "IQD new model not materialized (no baseline tableReference to copy)",
                    model=name,
                )
                continue

            table_key = self._table_key_of_model(it, edited_items, name)
            cols = self._columns_of_table(edited_items, table_key)
            mdl_columns: list[dict[str, Any]] = []
            pk_names: list[str] = []
            for col in cols:
                col_name = (col.get("display_name") or "").strip() or self._item_key_tail(
                    col.get("item_key")
                )
                if not col_name:
                    continue
                entry: dict[str, Any] = {
                    "name": col_name,
                    "type": str(col.get("data_type") or "").strip() or "VARCHAR",
                    "notNull": False,
                    "properties": {},
                }
                expression = str(col.get("expression") or "").strip()
                if expression:
                    entry["isCalculated"] = True
                    entry["expression"] = expression
                else:
                    entry["isCalculated"] = False
                description = str(col.get("description") or "").strip()
                if description:
                    entry["properties"]["description"] = description
                if col.get("is_primary_key") or col.get("isPrimaryKey"):
                    entry["isPrimaryKey"] = True
                    pk_names.append(col_name)
                mdl_columns.append(entry)
            if not mdl_columns:
                # 没有可用列 → 不建空模型（build 会因无列失败）
                logger.warning("IQD new model has no columns; skip", model=name)
                continue

            model: dict[str, Any] = {
                "name": name,
                "tableReference": {**template_ref, "table": name},
                "columns": mdl_columns,
                "cached": False,
                "properties": {},
            }
            description = str(it.get("description") or "").strip()
            if description:
                model["properties"]["description"] = description
            if pk_names:
                model["primaryKey"] = pk_names
            models.append(model)
            model_by_name[name] = model
            landed.add(idx)
            logger.info(
                "IQD new model materialized",
                model=name,
                columns=len(mdl_columns),
            )

        # ① cube 容器（先建，供 measure/dimension 挂靠）
        for idx, it in enumerate(edited_items):
            if (it.get("kind") or "") != "cube":
                continue
            tail = self._item_key_tail(it.get("item_key"))
            name = (it.get("display_name") or "").strip() or tail
            if not name:
                continue
            if name in cube_by_name or (tail and tail in cube_by_name):
                # 基线已有 → 视为已落入（后续 _patch_mdl_node 负责改名）
                existing = cube_by_name.get(name) or (cube_by_name.get(tail) if tail else None)
                if existing is not None and tail:
                    # 子节点按 parent_key 的 tail 挂靠，而 cube 的 name 可能是中文显示名 ——
                    # 两个键都指向同一 cube，否则 ② 里查不到宿主、子节点被静默丢弃。
                    cube_by_name.setdefault(tail, existing)
                landed.add(idx)
                continue
            cube: dict[str, Any] = {"name": name, "measures": [], "dimensions": []}
            model_name = self._model_name_of(it.get("model_ref"))
            if model_name:
                cube["baseObject"] = model_name
            cubes.append(cube)
            cube_by_name[name] = cube
            if tail:
                cube_by_name.setdefault(tail, cube)
            landed.add(idx)

        # ② measure / dimension 子节点（按 parent_key=mdl:cube:<cube> 挂靠）
        for idx, it in enumerate(edited_items):
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
                # 已存在 → 视为已落入
                landed.add(idx)
                continue
            child: dict[str, Any] = {"name": name}
            if it.get("expression") is not None:
                child["expression"] = it["expression"]
            if kind == "measure" and it.get("data_type"):
                child["format"] = it["data_type"]
            children.append(child)
            landed.add(idx)

        # ③ relationship（解信封 JSON 取 models/joinType/condition）
        for idx, it in enumerate(edited_items):
            if (it.get("kind") or "") != "relationship":
                continue
            name = (it.get("display_name") or "").strip() or self._item_key_tail(it.get("item_key"))
            if not name:
                continue
            if name in rel_by_name:
                # 基线已有 → 视为已落入（后续 _patch_mdl_node 负责改名）
                landed.add(idx)
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
            landed.add(idx)

        # ④ 计算列（item_key=calc:<model>.<col>，parent_key=mdl:model:<name>）
        for idx, it in enumerate(edited_items):
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
                landed.add(idx)
                continue
            columns.append({"name": name, "expression": it.get("expression")})
            landed.add(idx)

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
        unmatched_edit_count: int = 0,
        unmatched_edits: list[dict[str, Any]] | None = None,
        warnings: list[str] | None = None,
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
                # T03e：编辑未生效清单（前端提示用；没传就是空，见 V102 的全量替换语义）
                "unmatched_edit_count": int(unmatched_edit_count or 0),
                "unmatched_edits": list(unmatched_edits or []),
                "edit_source": "model",
                # 发布后自检告警（2026-09-28）：落 iqd_sync_job.publish_warnings，
                # 前端 SyncStatusBar 解析后以警示条展示。
                "publish_warnings": list(warnings or []),
            })
        except Exception as exc:  # noqa: BLE001 - 报作业失败仅告警
            logger.warning("IQD model sync job report failed", connection_id=connection_id, error=str(exc))

    async def _resolve_primary_connection_id(self, client: Any) -> int | None:
        """解析主连接 id（**委托** :meth:`IqdConfigClient.resolve_primary_connection_id`）。

        ⚠️ 更正历史 docstring：原实现只取 ``client.get_connections()[0].id``（= 最小 id
        enabled），**无视 ``name='default'``**，多条 ``enabled=true`` 并存时会与 Java 侧
        漂移（设计 §14.5.1 C）。现**统一委托**客户端方法（消费 ``is_primary`` 单一真值源，
        与 Java ``findPrimaryConnection()`` 同源），不再本地复现选主规则。

        Args:
            client: :class:`IqdConfigClient` 实例（构造函数注入或懒加载）。

        Returns:
            主连接 id；无可用连接 / 拉取失败时返回 ``None``。
        """
        return await client.resolve_primary_connection_id()

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
