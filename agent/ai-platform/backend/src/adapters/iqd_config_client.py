"""IqdConfigClient — mis-iqd 配置读取 API 的异步 HTTP 客户端（v1.9 / B1）。

对齐 :mod:`src.adapters.kb_client` 范式：httpx + MIS ``Result`` 信封 + 透传头。

v1.9（A1 业务改判）后 Worker 不直连 mis_platform 库：问数配置（连接/ACL/范围策略/
维度注册表/脱敏规则/字典同步状态）经本客户端调 mis-iqd ``/internal/v1/iqd/**``
读取，并在 Worker 本地做配置缓存（启动/连接自检全量加载 + 变更事件 + 每日定期
刷新兜底）。缓存不可得 → 上层 fail-closed ``45204``（宁拒不可漏，见
architecture §4.2.2 D.7.3）。

B1 本批实现：
- :meth:`health` —— 连通性自检
- :meth:`get_configs` —— 空配置拉取（启用连接清单）骨架
- :meth:`load_configs` —— 拉取并写入本地缓存（缓存骨架，TTL 由配置驱动）

B3 起扩展 get-acls / get-scope-policies / get-dimensions / get-mask-rules /
get-dict-sync-status 的增量拉取与变更事件订阅。

透传头（与 BFF→mis-kb 同一套约定）：``Authorization`` / ``X-User-Id`` /
``X-Tenant-Id`` / ``X-App-Id`` / ``X-Trace-Id``。
"""

from __future__ import annotations

import json
import time as _time
from dataclasses import dataclass, field
from typing import Any

import httpx

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("adapters.iqd_config_client")

# ===== 端点常量（与 Java IqdInternalController 一一对应）=====
HEALTH_PATH = "/internal/v1/iqd/health"
GET_CONNECTIONS_PATH = "/internal/v1/iqd/get-connections"
GET_ACLS_PATH = "/internal/v1/iqd/get-acls"
GET_SCOPE_POLICIES_PATH = "/internal/v1/iqd/get-scope-policies"
GET_DIMENSIONS_PATH = "/internal/v1/iqd/get-dimensions"
GET_MASK_RULES_PATH = "/internal/v1/iqd/get-mask-rules"
GET_DICT_SYNC_STATUS_PATH = "/internal/v1/iqd/get-dict-sync-status"
GET_CATALOG_IN_SCOPE_PATH = "/internal/v1/iqd/get-catalog-in-scope"
GET_CATALOG_META_PATH = "/internal/v1/iqd/get-catalog-meta"
GET_SQL_PAIRS_PATH = "/internal/v1/iqd/get-sql-pairs"
GET_KNOWLEDGE_PATH = "/internal/v1/iqd/get-knowledge"
GET_ASK_LOGS_PATH = "/internal/v1/iqd/get-ask-logs"
WRITE_ASK_LOG_PATH = "/internal/v1/iqd/write-ask-log"
# —— 闭环补全（P0-3 / P1-1）：增强同步回填 + 作业上报 ——
BACKFILL_PATH = "/internal/v1/iqd/enhance/backfill"
SYNC_JOB_PATH = "/internal/v1/iqd/enhance/sync-job"
# —— 二期语义模型编辑（G7 / S3）：catalog 全量快照 + 编辑回填 + 漂移标记 ——
GET_CATALOG_FULL_PATH = "/internal/v1/iqd/get-catalog-full"
CATALOG_BACKFILL_PATH = "/internal/v1/iqd/enhance/catalog-backfill"
CATALOG_SYNC_STATUS_PATH = "/internal/v1/iqd/catalog/sync-status"
SET_DRIFT_PATH = "/internal/v1/iqd/enhance/drift"
# —— 方案 A 多连接：MCP 进程状态回写（可观测 REQ-P1-2）——
REPORT_MCP_STATUS_PATH = "/internal/v1/iqd/mcp-status"
# —— 方案 A 跨机器落地 v0.2：MCP 部署句柄回写（mcp_host/agent_handle/mcp_status）——
REPORT_MCP_DEPLOY_PATH = "/internal/v1/iqd/mcp-deploy"
# —— 方案 A 多连接：取连接 secret_ref（D6 凭证解析前置；内部端点仅回引用不回明文）——
GET_CONNECTION_CREDENTIALS_PATH = "/internal/v1/iqd/connection-credentials"

#: 配置缓存桶名（与 IqdConfigClient 分桶缓存一一对应）
CACHE_BUCKET_CONNECTIONS = "connections"
CACHE_BUCKET_ACLS = "acls"
CACHE_BUCKET_SCOPE_POLICIES = "scope_policies"
CACHE_BUCKET_DIMENSIONS = "dimensions"
CACHE_BUCKET_MASK_RULES = "mask_rules"
CACHE_BUCKET_DICT_SYNC_STATUS = "dict_sync_status"
CACHE_BUCKET_CATALOG_IN_SCOPE = "catalog_in_scope"
CACHE_BUCKET_CATALOG_META = "catalog_meta"
CACHE_BUCKET_SQL_PAIRS = "sql_pairs"
CACHE_BUCKET_KNOWLEDGE = "knowledge"
CACHE_BUCKET_ASK_LOGS = "ask_logs"

#: 变更事件 → 失效桶映射（变更事件推送入口，见 :meth:`invalidate_bucket`）
EVENT_BUCKET_MAP: dict[str, str] = {
    "iqd.config.changed": CACHE_BUCKET_CONNECTIONS,
    "iqd.acl.changed": CACHE_BUCKET_ACLS,
    "iqd.scope.changed": CACHE_BUCKET_SCOPE_POLICIES,
    "iqd.dimension.changed": CACHE_BUCKET_DIMENSIONS,
    "iqd.mask.changed": CACHE_BUCKET_MASK_RULES,
    "iqd.dict.synced": CACHE_BUCKET_DICT_SYNC_STATUS,
    "iqd.catalog.changed": CACHE_BUCKET_CATALOG_META,
    "iqd.enhancement.changed": CACHE_BUCKET_SQL_PAIRS,
}

# 日志脱敏的敏感头
_SENSITIVE_HEADERS = {"Authorization"}


class IqdConfigClientError(RuntimeError):
    """mis-iqd 配置读取 API 调用异常（网络失败、非 JSON、业务 code != 0）。"""


@dataclass
class IqdCallContext:
    """一次配置读取调用的身份与追踪上下文。

    Attributes:
        user_id: MIS 用户 ID（服务间调用通常为 ``None``，走服务身份）。
        tenant_id: 租户 ID。
        app_id: 应用 ID。
        authorization: 完整的 ``Bearer <token>`` 头值（用户 JWT 或服务账号）。
        trace_id: 链路追踪 ID，贯穿 BFF → ai-platform → mis-iqd。
        extra_headers: 额外透传头（如 ``X-Mis-Dept-Scope`` / ``X-Mis-Stores``）。
    """

    user_id: int | None = None
    tenant_id: int | None = None
    app_id: int | None = None
    authorization: str = ""
    trace_id: str = ""
    extra_headers: dict[str, str] = field(default_factory=dict)


class IqdConfigClient:
    """mis-iqd 配置读取 API 异步客户端。

    默认从全局 ``Settings.iqd_config``（:class:`IqdConfigClientSettings`）读取
    ``internal_api_base_url`` / ``timeout_seconds`` / ``cache_ttl_seconds``。
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: float | None = None,
        cache_ttl: int | None = None,
    ) -> None:
        """初始化客户端。

        Args:
            base_url: mis-iqd 基址（缺省取 ``IQD_CONFIG_INTERNAL_API_BASE_URL``）。
            timeout: 请求超时（秒，缺省取 ``IQD_CONFIG_TIMEOUT_SECONDS``）。
            cache_ttl: 配置缓存 TTL（秒，缺省取 ``IQD_CONFIG_CACHE_TTL_SECONDS``）。
        """
        settings = get_settings()
        iqd_cfg = settings.iqd_config
        self._base_url: str = (base_url or iqd_cfg.internal_api_base_url).rstrip("/")
        self._timeout: float = timeout if timeout is not None else iqd_cfg.timeout_seconds
        self._cache_ttl: int = cache_ttl if cache_ttl is not None else iqd_cfg.cache_ttl_seconds
        self._client: httpx.AsyncClient = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
        )
        # 本地配置缓存骨架：{cache_key: (loaded_at_epoch, value)}；
        # B3 起按配置类别（acls/scope_policies/dimensions/mask_rules/dict_sync_status）
        # 分桶存储，变更事件命中时按桶失效。
        self._cache: dict[str, tuple[float, Any]] = {}

    async def aclose(self) -> None:
        """关闭底层 httpx 客户端，释放连接池。"""
        await self._client.aclose()

    async def __aenter__(self) -> IqdConfigClient:
        """支持 ``async with IqdConfigClient() as client:`` 用法。"""
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        """退出上下文时自动关闭连接。"""
        await self.aclose()

    # ================================================================ 连通性

    async def health(self, ctx: IqdCallContext | None = None) -> dict[str, Any]:
        """mis-iqd 配置读取 API 健康检查。

        Args:
            ctx: 身份与追踪上下文（可为空，服务身份调用）。

        Returns:
            健康响应体（含 status/service/time）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = ctx or IqdCallContext()
        data = await self._request("GET", HEALTH_PATH, ctx)
        result = data if isinstance(data, dict) else {"status": "unknown"}
        logger.info("IQD config API health", status=result.get("status"), trace_id=ctx.trace_id)
        return result

    # ================================================================ 配置拉取

    async def get_configs(self, ctx: IqdCallContext | None = None) -> list[dict[str, Any]]:
        """拉取启用连接配置清单（B1 空配置拉取骨架）。

        Args:
            ctx: 身份与追踪上下文。

        Returns:
            连接最小配置视图列表；一期无连接时返回空数组。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = ctx or IqdCallContext()
        data = await self._request("GET", GET_CONNECTIONS_PATH, ctx)
        items = data if isinstance(data, list) else []
        logger.info("IQD configs pulled", count=len(items), trace_id=ctx.trace_id)
        return items

    async def load_configs(self, ctx: IqdCallContext | None = None) -> list[dict[str, Any]]:
        """拉取并写入本地缓存（缓存骨架，TTL 由配置驱动）。

        语义：启动/连接自检时全量加载；缓存未过期直接命中，过期或缺失回源。
        缓存不可得（回源失败）时抛 :class:`IqdConfigClientError`，由上层
        fail-closed ``45204`` 处理，绝不静默放行。

        Args:
            ctx: 身份与追踪上下文。

        Returns:
            连接配置列表（与 :meth:`get_configs` 同构）。

        Raises:
            IqdConfigClientError: 回源失败。
        """
        ctx = ctx or IqdCallContext()

        now = _time.time()
        cached = self._cache.get("connections")
        if cached is not None and now - cached[0] < self._cache_ttl:
            return cached[1]

        items = await self.get_configs(ctx)
        self._cache["connections"] = (now, items)
        logger.debug(
            "IQD configs cached",
            count=len(items),
            ttl=self._cache_ttl,
            trace_id=ctx.trace_id,
        )
        return items

    def invalidate(self, cache_key: str = "connections") -> None:
        """失效指定配置缓存桶（变更事件推送入口，B3 起由订阅器调用）。

        Args:
            cache_key: 缓存桶名（缺省连接桶）。
        """
        self._cache.pop(cache_key, None)
        logger.info("IQD config cache invalidated", cache_key=cache_key)

    # ================================================================ 审计写入

    async def write_ask_log(self, payload: dict[str, Any]) -> dict[str, Any]:
        """写问数审计日志（投影前全量，经 mis-iqd 内部 API）。

        Args:
            payload: 审计载荷（trace_id / session_id / query_id / user_id /
                question / resolved_scope / sql_text / plan_steps / view_mode 等）。

        Returns:
            mis-iqd 返回的 data（通常为 ``{"id": ...}``）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = IqdCallContext()
        data = await self._request("POST", WRITE_ASK_LOG_PATH, ctx, payload=payload)
        logger.info("IQD ask log written", trace_id=ctx.trace_id)
        return data if isinstance(data, dict) else {"id": data}

    # ================================================================ 闭环补全：回填 + 作业上报

    async def backfill_enhancement_sync(self, payload: dict[str, Any]) -> dict[str, Any]:
        """回填增强同步（wren_ref_id + pending 物料 id；经 mis-iqd 内部 API）。

        ai-platform 在「拉取待下发物料」时已持有 pending 物料 id，build 完成后直接组装
        回填报文（与 :meth:`write_ask_log` 同一内部 API 范式），无需把 ref 映射上抛 BFF。

        Args:
            payload: ``{connection_id, wren_ref_id, sql_pair_ids, knowledge_ids, synced_at}``。

        Returns:
            mis-iqd 返回的 data（通常含受影响行数 ``{"updated": N}``）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = IqdCallContext()
        data = await self._request("POST", BACKFILL_PATH, ctx, payload=payload)
        logger.info("IQD enhancement backfill sent", trace_id=ctx.trace_id)
        return data if isinstance(data, dict) else {}

    async def report_sync_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        """上报同步作业（build/index 状态 + 回填计数；经 mis-iqd 内部 API）。

        ai-platform 每完成一次整库 rebuild（context build + memory index）即上报作业，
        由 mis-iqd 写入 ``iqd_sync_job``（按连接覆盖写），驱动前端 SyncStatusBar。

        Args:
            payload: ``{connection_id, build_status, build_mdl_hash, index_status,
                      build_error, index_error, synced_sql_pair_count, synced_knowledge_count}``。

        Returns:
            mis-iqd 返回的 data（通常含作业 ``{"id": ...}``）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = IqdCallContext()
        data = await self._request("POST", SYNC_JOB_PATH, ctx, payload=payload)
        logger.info("IQD sync job reported", trace_id=ctx.trace_id)
        return data if isinstance(data, dict) else {}

    # ================================================================ 二期：catalog 编辑写回（G7 / S3）

    async def get_catalog_full(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> dict[str, Any]:
        """取连接完整 MDL 快照 + 已编辑节点（G7：以 mdl_raw 为基线派生完整 MDL）。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            ctx: 身份与追踪上下文。

        Returns:
            ``{connection_id, mdl_raw, edited_items[], current_edit_revision,
            built_edit_revision}``（mdl_raw 为基线 JSON 字符串；current_edit_revision /
            built_edit_revision 为连接级编辑版本，由 mis-iqd ``getCatalogFull`` 原样透传，
            key 命名与 sync-status 契约一致，供 trigger_model_build 取 current_edit_revision
            回填断点续盖）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = ctx or IqdCallContext()
        cid = connection_id or await self._resolve_primary_connection_id(ctx)
        if cid is None:
            raise IqdConfigClientError("no primary connection")
        data = await self._request(
            "GET", GET_CATALOG_FULL_PATH, ctx, params={"connection_id": cid}
        )
        # 原样透传 mis-iqd 响应（含 current_edit_revision / built_edit_revision）。
        return data if isinstance(data, dict) else {}

    async def backfill_catalog_sync(self, payload: dict[str, Any]) -> dict[str, Any]:
        """批量回填 catalog 编辑盖章（P0-8 / U8 断点续盖）。

        ai-platform 在 ``build_mdl_from_catalog`` build 成功后组装报文体，把本次纳入的
        已编辑节点（``edit_revision ≤ built``）统一置 ``wren_ref_id``，并推进连接级
        ``built_edit_revision``。

        Args:
            payload: ``{connection_id, mdl_hash, edit_revision}``。

        Returns:
            mis-iqd 返回的 data（通常含 ``{"stamped_count": N}``）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = IqdCallContext()
        data = await self._request("POST", CATALOG_BACKFILL_PATH, ctx, payload=payload)
        logger.info("IQD catalog backfill sent", trace_id=ctx.trace_id)
        return data if isinstance(data, dict) else {}

    async def get_catalog_sync_status(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> dict[str, Any]:
        """取连接级编辑同步状态（前端 CatalogSyncStatusBar 轮询）。

        Args:
            connection_id: 问数连接 id（缺省解析主连接）。
            ctx: 身份与追踪上下文。

        Returns:
            ``{connection_id, current_edit_revision, built_edit_revision, edit_status,
            build_status, index_status, mdl_hash, stale_drift}``。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = ctx or IqdCallContext()
        cid = connection_id or await self._resolve_primary_connection_id(ctx)
        if cid is None:
            raise IqdConfigClientError("no primary connection")
        data = await self._request(
            "GET", CATALOG_SYNC_STATUS_PATH, ctx, params={"connection_id": cid}
        )
        return data if isinstance(data, dict) else {}

    async def set_stale_drift(
        self, connection_id: int, drift: bool, ctx: IqdCallContext | None = None
    ) -> dict[str, Any]:
        """置外部漂移标记（S3：ai-platform 漂移检测命中回调）。

        Args:
            connection_id: 问数连接 id。
            drift: ``True``=检测到 WrenAI 当前 mdl_hash 与 built_mdl_hash 不一致；
                ``False``=收敛清零。
            ctx: 身份与追踪上下文。

        Returns:
            mis-iqd 返回的 data（``{"ok": true}``）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = ctx or IqdCallContext()
        data = await self._request(
            "POST",
            SET_DRIFT_PATH,
            ctx,
            payload={"connection_id": connection_id, "drift": drift},
        )
        logger.info("IQD stale drift set", connection_id=connection_id, drift=drift)
        return data if isinstance(data, dict) else {}

    async def report_mcp_status(
        self,
        connection_id: int,
        mcp_status: str,
        mcp_port: int | None,
        ctx: IqdCallContext | None = None,
    ) -> dict[str, Any]:
        """回写连接级 WrenAI MCP 进程状态（方案 A 多连接可观测，REQ-P1-2）。

        ai-platform Worker 进程管理器（WrenMcpProcessManager）在启停/健康自检后回调，
        使 mis-iqd ``iqd_connection.mcp_status`` / ``mcp_port`` 与内存注册表一致，
        供前端轮询展示，无需登机 ``ps``。

        Args:
            connection_id: 问数连接 id。
            mcp_status: 进程状态（running/stopped/starting/crashed/unhealthy）。
            mcp_port: 进程监听端口（未启动为 None）。
            ctx: 身份与追踪上下文。

        Returns:
            mis-iqd 返回的 data（``{"ok": true}``）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = ctx or IqdCallContext()
        data = await self._request(
            "POST",
            REPORT_MCP_STATUS_PATH,
            ctx,
            payload={
                "connection_id": connection_id,
                "mcp_status": mcp_status,
                "mcp_port": mcp_port,
            },
        )
        logger.info(
            "IQD mcp status reported",
            connection_id=connection_id,
            mcp_status=mcp_status,
            mcp_port=mcp_port,
        )
        return data if isinstance(data, dict) else {}

    async def report_mcp_deployment(
        self,
        connection_id: int,
        mcp_host: str,
        agent_handle: str,
        mcp_status: str,
        ctx: IqdCallContext | None = None,
    ) -> dict[str, Any]:
        """回写连接级 WrenAI MCP 跨机器部署句柄（方案 A 跨机器落地 v0.2）。

        ai-platform Worker 经 :class:`WrenMcpAgentClient`.``ensure`` 拉起 wren 机部署后
        回调，把数据面 ``mcp_host`` / ``agent_handle`` / ``mcp_status`` 写回 mis-iqd
        ``iqd_connection``，供前端/可观测定位跨机器部署位置。仅存引用，不存凭证明文
        （决策 ③ S1）。

        Args:
            connection_id: 问数连接 id。
            mcp_host: agent 数据面可达 host（ai-platform 侧视角，如 http://10.x:9101）。
            agent_handle: WrenMcpAgent 部署句柄（control 通道路由定位）。
            mcp_status: MCP 进程状态（running/stopped/starting/crashed/unhealthy）。
            ctx: 身份与追踪上下文。

        Returns:
            mis-iqd 返回的 data（``{"ok": true}``）。

        Raises:
            IqdConfigClientError: 网络失败或 mis-iqd 返回 ``code != 0``。
        """
        ctx = ctx or IqdCallContext()
        data = await self._request(
            "POST",
            REPORT_MCP_DEPLOY_PATH,
            ctx,
            payload={
                "connection_id": connection_id,
                "mcp_host": mcp_host or "",
                "agent_handle": agent_handle or "",
                "mcp_status": mcp_status or "running",
            },
        )
        logger.info(
            "IQD mcp deployment reported",
            connection_id=connection_id,
            mcp_host=mcp_host,
            agent_handle=agent_handle,
            mcp_status=mcp_status,
        )
        return data if isinstance(data, dict) else {}

    async def get_connection(
        self, connection_id: int, ctx: IqdCallContext | None = None
    ) -> dict[str, Any] | None:
        """取单连接配置视图（方案 A 多连接生命周期用）。

        Args:
            connection_id: 问数连接 id。
            ctx: 身份与追踪上下文。

        Returns:
            连接配置字典（含 name/enabled/defaultConnector/mcp_status/mcp_port 等）；
            未找到返回 ``None``。
        """
        ctx = ctx or IqdCallContext()
        items = await self._request(
            "GET", GET_CONNECTIONS_PATH, ctx, params={"connection_id": connection_id}
        )
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict) and str(it.get("id")) == str(connection_id):
                    return it
        return None

    async def get_connection_env(
        self, connection_id: int, ctx: IqdCallContext | None = None
    ) -> dict[str, str]:
        """解析连接凭证为 wren 启动期 env 映射（D6 铁律：仅 env、不落盘）。

        解析链路：mis-iqd 内部端点取 ``secret_ref`` → ai-platform
        :class:`CredentialVault.resolve_by_ref` 解密明文 → 映射 wren env
        占位名（postgres 标准 ``WREN_PG_*`` + 整份凭证 JSON 透传）。

        Args:
            connection_id: 问数连接 id。
            ctx: 身份与追踪上下文。

        Returns:
            env 名 → 明文值 的字典（已剔除 ``None``/空值）。

        Raises:
            IqdConfigClientError: mis-iqd 调用失败 / secretRef 缺失 / 凭证不可解析。
        """
        ctx = ctx or IqdCallContext()
        cred_body = await self._request(
            "GET", GET_CONNECTION_CREDENTIALS_PATH, ctx, params={"connection_id": connection_id}
        )
        secret_ref: str | None = None
        if isinstance(cred_body, dict):
            secret_ref = cred_body.get("secret_ref") or cred_body.get("secretRef")
        if not secret_ref:
            raise IqdConfigClientError(
                f"连接 {connection_id} 无 secret_ref（mis-iqd 未返回引用）"
            )

        from src.identity.credential_vault import CredentialVault

        cred = await CredentialVault().resolve_by_ref(secret_ref)
        if not cred:
            raise IqdConfigClientError(
                f"连接 {connection_id} 凭证不可解析（secret_ref={secret_ref} 无匹配明文）"
            )
        return self._map_credential_to_env(cred)

    @staticmethod
    def _map_credential_to_env(cred: dict[str, Any]) -> dict[str, str]:
        """把凭证明文字典映射为 wren 启动期 env（postgres 标准占位名 + 整份透传）。

        实际 env 名须与运维经 ``wren profile add`` 写入的 profile 模板 ``${ENV:...}``
        占位保持一致；此处缺省 postgres 一套 + ``WREN_IQD_CREDENTIAL_JSON`` 整份透传
        （自定义模板可经该键读取任意字段）。凭证明文**绝不写入日志/磁盘**。
        """
        env: dict[str, str] = {}
        host = cred.get("host") or cred.get("hostname")
        port = cred.get("port")
        user = cred.get("user") or cred.get("username")
        password = cred.get("password") or cred.get("pwd")
        database = cred.get("database") or cred.get("db") or cred.get("dbname")
        if host is not None:
            env["WREN_PG_HOST"] = str(host)
        if port is not None:
            env["WREN_PG_PORT"] = str(port)
        if user is not None:
            env["WREN_PG_USER"] = str(user)
        if password is not None:
            env["WREN_PG_PASSWORD"] = str(password)
        if database is not None:
            env["WREN_PG_DB"] = str(database)
        env["WREN_IQD_CREDENTIAL_JSON"] = json.dumps(cred, ensure_ascii=False)
        # 剔除空值，避免注入空 env 变量
        return {k: v for k, v in env.items() if v != ""}

    async def _resolve_primary_connection_id(self, ctx: IqdCallContext) -> int | None:
        """解析主连接 id（name='default' 或首条 enabled）。"""
        try:
            connections = await self.get_connections(ctx)
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

    # ================================================================ 配置拉取扩展

    async def get_acls(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取表级 ACL（带本地缓存，按连接分桶；变更事件失效桶）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(
            CACHE_BUCKET_ACLS, GET_ACLS_PATH, ctx,
            connection_id=connection_id,
        )

    async def get_scope_policies(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取范围策略（带本地缓存，按连接分桶；变更事件失效桶）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(
            CACHE_BUCKET_SCOPE_POLICIES, GET_SCOPE_POLICIES_PATH, ctx,
            connection_id=connection_id,
        )

    async def get_dimensions(self, ctx: IqdCallContext | None = None) -> list[dict[str, Any]]:
        """拉取行级范围维度注册表（带本地缓存；变更事件失效桶）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(CACHE_BUCKET_DIMENSIONS, GET_DIMENSIONS_PATH, ctx)

    async def get_mask_rules(self, ctx: IqdCallContext | None = None) -> list[dict[str, Any]]:
        """拉取脱敏规则（带本地缓存；变更事件失效桶）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(CACHE_BUCKET_MASK_RULES, GET_MASK_RULES_PATH, ctx)

    async def get_catalog_in_scope(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取纳入问数范围的清单项（in_scope=1；范围裁定消费）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(
            CACHE_BUCKET_CATALOG_IN_SCOPE, GET_CATALOG_IN_SCOPE_PATH, ctx,
            connection_id=connection_id,
        )

    async def get_catalog_meta(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取清单元数据（item_key/kind/mask_rule/sensitive_level/data_type；脱敏消费）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(
            CACHE_BUCKET_CATALOG_META, GET_CATALOG_META_PATH, ctx,
            connection_id=connection_id,
        )

    async def get_catalog_items(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取清单元数据（MaskingEngine 别名：脱敏需要 mask_rule/sensitive_level）。"""
        return await self.get_catalog_meta(connection_id, ctx)

    async def get_dict_sync_status(
        self, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取字典同步状态（mis_dept_scope / mis_store_scope 每维度一行）。

        供 Worker 判断行级字典是否就绪：维度已配但字典未同步 → 上层 fail-closed。
        """
        ctx = ctx or IqdCallContext()
        return await self._cached_get(
            CACHE_BUCKET_DICT_SYNC_STATUS, GET_DICT_SYNC_STATUS_PATH, ctx
        )

    async def get_sql_pairs(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取样本对（W4：few-shot 增强物料；带本地缓存，变更事件失效桶）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(
            CACHE_BUCKET_SQL_PAIRS, GET_SQL_PAIRS_PATH, ctx,
            connection_id=connection_id,
        )

    async def get_knowledge(
        self, connection_id: int | None = None, ctx: IqdCallContext | None = None
    ) -> list[dict[str, Any]]:
        """拉取知识/术语/口径（W4：instructions 增强物料；带本地缓存）。"""
        ctx = ctx or IqdCallContext()
        return await self._cached_get(
            CACHE_BUCKET_KNOWLEDGE, GET_KNOWLEDGE_PATH, ctx,
            connection_id=connection_id,
        )

    async def get_ask_logs(
        self,
        ctx: IqdCallContext | None = None,
        *,
        limit: int | None = None,
        status: str | None = None,
        user_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """拉取问数审计日志（W3：审计回查；不带缓存，实时回源）。"""
        ctx = ctx or IqdCallContext()
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if status:
            params["status"] = status
        if user_id is not None:
            params["userId"] = user_id
        data = await self._request("GET", GET_ASK_LOGS_PATH, ctx, params=params or None)
        items = data if isinstance(data, list) else []
        logger.info("IQD ask logs pulled", count=len(items), trace_id=ctx.trace_id)
        return items

    async def invalidate_bucket(self, event: str) -> None:
        """按变更事件失效对应缓存桶（W2：变更事件推送入口）。

        Args:
            event: 变更事件名（如 ``iqd.acl.changed``）。
        """
        bucket = EVENT_BUCKET_MAP.get(event)
        if bucket:
            self.invalidate(bucket)
        else:
            logger.info("IQD config change event ignored", event=event)

    # ================================================================ 定期刷新兜底

    async def refresh_all(self, ctx: IqdCallContext | None = None) -> None:
        """全量刷新所有配置缓存桶（启动/自检/每日兜底）。

        Args:
            ctx: 身份与追踪上下文（服务身份调用）。

        Raises:
            IqdConfigClientError: 任一桶回源失败（由调用方决定降级策略）。
        """
        ctx = ctx or IqdCallContext()
        # 连接桶
        configs = await self.load_configs(ctx)
        # 各连接维度桶
        for conn in configs:
            connection_id = conn.get("id")
            if isinstance(connection_id, (int, str)):
                try:
                    cid = int(connection_id)
                except (TypeError, ValueError):
                    continue
                await self.get_acls(cid, ctx)
                await self.get_scope_policies(cid, ctx)
                await self.get_catalog_in_scope(cid, ctx)
                await self.get_catalog_meta(cid, ctx)
                await self.get_sql_pairs(cid, ctx)
                await self.get_knowledge(cid, ctx)
        # 全局桶
        await self.get_dimensions(ctx)
        await self.get_mask_rules(ctx)
        await self.get_dict_sync_status(ctx)
        logger.info("IQD config cache refreshed all buckets", connections=len(configs))

    def start_background_refresh(self, interval_seconds: float | None = None) -> asyncio.Task[Any]:
        """启动后台定期刷新任务（每日兜底；interval 缺省取 cache_ttl 的 1/3，下限 10s）。

        事件丢失 / 进程重启后兜底：即使没有变更事件，缓存也会在 interval 内回源。

        Args:
            interval_seconds: 刷新间隔（秒）；缺省取 max(10, cache_ttl // 3)。

        Returns:
            asyncio 后台任务（调用方持有引用避免被 GC）。
        """
        interval = (
            interval_seconds
            if interval_seconds is not None
            else max(10.0, self._cache_ttl / 3.0)
        )

        async def _loop() -> None:
            while True:
                await asyncio.sleep(interval)
                try:
                    await self.refresh_all()
                except Exception as exc:  # noqa: BLE001 - 兜底刷新失败仅告警
                    logger.warning("IQD config background refresh failed", error=str(exc))

        task = asyncio.create_task(_loop())
        logger.info("IQD config background refresh started", interval=interval)
        return task

    def start_event_subscriber(self) -> asyncio.Task[Any] | None:
        """启动可选 Redis 变更事件订阅（架构 D.7.3 事件增量路径）。

        <p>依赖 ``redis`` 包且配置了 ``IQD_REDIS_URL`` 才启动；未配置/不可用时返回
        ``None``（退回 TTL/每日兜底，默认 ≤10s 生效）。

        Returns:
            asyncio 后台订阅任务；不可用时返回 ``None``。
        """
        redis_url = self._redis_url()
        if not redis_url:
            logger.info("IQD config event subscriber disabled (IQD_REDIS_URL unset)")
            return None
        if importlib.util.find_spec("redis") is None:
            logger.warning("IQD config event subscriber disabled (redis package missing)")
            return None

        import redis.asyncio as aioredis  # type: ignore[import-not-found]

        bucket_by_channel = {
            "iqd.config.changed": CACHE_BUCKET_CONNECTIONS,
            "iqd.acl.changed": CACHE_BUCKET_ACLS,
            "iqd.scope.changed": CACHE_BUCKET_SCOPE_POLICIES,
            "iqd.dimension.changed": CACHE_BUCKET_DIMENSIONS,
            "iqd.mask.changed": CACHE_BUCKET_MASK_RULES,
            "iqd.dict.synced": CACHE_BUCKET_DICT_SYNC_STATUS,
            "iqd.catalog.changed": CACHE_BUCKET_CATALOG_META,
            "iqd.enhancement.changed": CACHE_BUCKET_SQL_PAIRS,
        }
        channels = list(bucket_by_channel.keys())

        async def _subscribe() -> None:
            client = aioredis.from_url(redis_url)
            try:
                pubsub = client.pubsub()
                await pubsub.subscribe(*channels)
                logger.info("IQD config event subscriber started", channels=channels)
                async for message in pubsub.listen():
                    if message is None or message.get("type") != "message":
                        continue
                    channel = str(message.get("channel") or "")
                    bucket = bucket_by_channel.get(channel)
                    if bucket:
                        self.invalidate(bucket)
                        logger.info("IQD config cache invalidated by event", channel=channel)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - 订阅失败退回 TTL 兜底
                logger.warning("IQD config event subscriber stopped", error=str(exc))
            finally:
                try:
                    await client.aclose()
                except Exception:  # noqa: BLE001
                    pass

        task = asyncio.create_task(_subscribe())
        return task

    def _redis_url(self) -> str:
        """返回 Redis 连接 URL（缺省空 = 不启用订阅）。"""
        settings = get_settings()
        return str(getattr(settings.iqd_config, "redis_url", "") or "").strip()

    async def _cached_get(
        self,
        bucket: str,
        path: str,
        ctx: IqdCallContext,
        *,
        connection_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """带 TTL 缓存的配置拉取（按连接分桶）；回源失败抛 :class:`IqdConfigClientError`。"""
        cache_key = f"{bucket}:{connection_id}" if connection_id is not None else bucket
        now = _time.time()
        cached = self._cache.get(cache_key)
        if cached is not None and now - cached[0] < self._cache_ttl:
            return cached[1]
        params: dict[str, Any] | None = None
        if connection_id is not None:
            params = {"connection_id": connection_id}
        data = await self._request("GET", path, ctx, params=params)
        items = data if isinstance(data, list) else []
        self._cache[cache_key] = (now, items)
        logger.debug("IQD config bucket cached", bucket=cache_key, count=len(items))
        return items

    # ================================================================ 内部工具

    def _headers(self, ctx: IqdCallContext) -> dict[str, str]:
        """构造透传头（Authorization / X-User-Id / X-Tenant-Id / X-App-Id / X-Trace-Id）。"""
        headers: dict[str, str] = {"Accept": "application/json"}

        auth = (ctx.authorization or "").strip()
        if auth:
            headers["Authorization"] = auth

        if ctx.user_id is not None:
            headers["X-User-Id"] = str(ctx.user_id)
        if ctx.tenant_id is not None:
            headers["X-Tenant-Id"] = str(ctx.tenant_id)
        if ctx.app_id is not None:
            headers["X-App-Id"] = str(ctx.app_id)
        if ctx.trace_id:
            headers["X-Trace-Id"] = ctx.trace_id
        for key, value in ctx.extra_headers.items():
            if value:
                headers[key] = value
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        ctx: IqdCallContext,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        """发起请求并 unwrap ``Result`` 信封。

        Returns:
            ``Result.data`` 的原始值（dict / int / list）。

        Raises:
            IqdConfigClientError: 超时、网络错误、5xx、非 JSON 响应或 ``code != 0``。
        """
        headers = self._headers(ctx)
        safe_headers = {
            k: ("<redacted>" if k in _SENSITIVE_HEADERS else v) for k, v in headers.items()
        }
        logger.debug("IQD config request", method=method, path=path, headers=safe_headers)

        try:
            if method.upper() == "GET":
                resp = await self._client.get(path, params=params, headers=headers)
            else:
                resp = await self._client.post(
                    path, params=params, json=payload or {}, headers=headers
                )
        except httpx.TimeoutException as exc:
            raise IqdConfigClientError(f"mis-iqd 调用超时: {path}") from exc
        except httpx.HTTPError as exc:
            raise IqdConfigClientError(f"mis-iqd 调用失败: {path} -> {exc}") from exc

        if resp.status_code >= 500:
            raise IqdConfigClientError(f"mis-iqd 服务端错误 {resp.status_code}: {path}")
        if resp.status_code in (401, 403):
            raise IqdConfigClientError(f"mis-iqd 鉴权失败 {resp.status_code}: {path}")

        try:
            body: Any = resp.json()
        except ValueError as exc:
            raise IqdConfigClientError(
                f"mis-iqd 响应非 JSON (status={resp.status_code}): {resp.text[:500]}"
            ) from exc

        # unwrap Result 信封 {"code":0,"data":...}；code != 0 一律视为业务失败
        if isinstance(body, dict) and "code" in body:
            code = body.get("code", 0)
            if code != 0:
                raise IqdConfigClientError(
                    f"mis-iqd 业务错误 code={code} message={body.get('message')} path={path}"
                )
            return body.get("data")
        return body
