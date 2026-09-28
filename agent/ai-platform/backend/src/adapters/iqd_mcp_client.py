"""IqdMcpClient — 本地 WrenAI MCP server 客户端（v1.9 / B2）。

对接本机 ``wren serve mcp --transport http @127.0.0.1:8080``（MCP-first 桥接，
architecture §4.4①）。工具名抽成**模块常量**，升级只改常量（对齐
``kb_client.py`` 范式）。

管理面（profile / context build）走 :mod:`src.adapters.iqd_cli`，**不走 MCP 写**；
本客户端只负责**运行时问数与执行**（只读）。

离线 mock 模式（``mock=True``）：
- 本机无 ``wren serve mcp`` 时仍可走通 orchestrator 管道（Golden path 离线验证）；
- :meth:`dry_plan` 透传入参 SQL（Wren 0.13 语义：方言转译，不做 NL→SQL）；
  :meth:`dry_run` / :meth:`run_sql` 返回固定结果集；
  :meth:`health` 返回 ``{"status":"ok","mock":true}``。

NL→SQL 由平台 :mod:`src.agent.mis_iqd.nl2sql`（LLM Gateway）完成，本客户端不承担。
"""

from __future__ import annotations

from typing import Any

import json
import time
import uuid

from src.adapters.wren_mcp_registry import (
    McpStatus,
    WrenMcpProcessManager,
    get_agent_registry,
    get_process_manager,
)
from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("adapters.iqd_mcp_client")

# ===== MCP 工具名常量（升级只改这里）=====
TOOL_ASK = "ask"
TOOL_RUN_SQL = "run_sql"
TOOL_DRY_RUN = "dry_run"
TOOL_DRY_PLAN = "dry_plan"
TOOL_QUERY_CUBE = "query_cube"
TOOL_LIST_CUBES = "list_cubes"
TOOL_DESCRIBE_CUBE = "describe_cube"
TOOL_GET_CONTEXT = "get_context"
TOOL_LIST_KNOWLEDGE = "list_knowledge"
TOOL_RECALL_QUERIES = "recall_queries"
TOOL_GET_INSTRUCTIONS = "get_instructions"
TOOL_GET_MDL = "get_mdl"
TOOL_LIST_MODELS = "list_models"
TOOL_DESCRIBE_MODEL = "describe_model"
TOOL_HEALTH = "health"

#: 只读工具集合（本期默认 allow_write=False，写工具一律禁用）
READ_ONLY_TOOLS: frozenset[str] = frozenset(
    {
        TOOL_ASK,
        TOOL_RUN_SQL,
        TOOL_DRY_RUN,
        TOOL_DRY_PLAN,
        TOOL_QUERY_CUBE,
        TOOL_LIST_CUBES,
        TOOL_DESCRIBE_CUBE,
        TOOL_GET_CONTEXT,
        TOOL_LIST_KNOWLEDGE,
        TOOL_RECALL_QUERIES,
        TOOL_GET_INSTRUCTIONS,
        TOOL_GET_MDL,
        TOOL_LIST_MODELS,
        TOOL_DESCRIBE_MODEL,
        TOOL_HEALTH,
    }
)


class IqdMcpClientError(RuntimeError):
    """本地 WrenAI MCP 调用异常（连接失败 / 工具超时 / 业务错误）。"""


class IqdMcpClient:
    """本地 WrenAI MCP server 客户端。

    默认从全局 ``Settings.iqd_mcp``（:class:`IqdMcpSettings`）读取
    ``wren_mcp_host`` / ``wren_mcp_port`` / ``wren_mcp_timeout_seconds``。

    MCP Python SDK 的 HTTP transport 连接为懒加载：真正调用工具时才握手；
    ``health()`` 用于连通性自检。
    """

    def __init__(
        self,
        *,
        host: str | None = None,
        port: int | None = None,
        timeout: float | None = None,
        allow_write: bool | None = None,
        mock: bool | None = None,
        token: str | None = None,
        path: str | None = None,
    ) -> None:
        """初始化客户端。

        Args:
            host: MCP server 主机（缺省取 ``WREN_MCP_HOST``）。
            port: MCP server 端口（缺省取 ``WREN_MCP_PORT``）。
            timeout: 单次工具调用超时秒数（缺省取 ``WREN_MCP_TIMEOUT_SECONDS``）。
            allow_write: 是否放行写工具（缺省取 ``WREN_MCP_ALLOW_WRITE``）。
            mock: 强制离线 mock 模式；``None`` 时自动探测（无连接可回退 mock）。
            token: 数据面 bearer token（跨机器部署经 agent 反向代理鉴权；
                本地 Plan A 为空，wren serve mcp 无 bearer）。
            path: MCP HTTP transport 挂载路径（缺省 ``/mcp``；跨机器远程模式为
                ``/mcp/{connection_id}``，由代理按 connId 路由到本机 wren 进程）。
        """
        settings = get_settings()
        wren = settings.iqd_mcp
        self._host: str = host or wren.wren_mcp_host
        self._port: int = port or wren.wren_mcp_port
        self._timeout: float = timeout if timeout is not None else wren.wren_mcp_timeout_seconds
        self._allow_write: bool = (
            allow_write if allow_write is not None else wren.wren_mcp_allow_write
        )
        self._mock: bool = bool(mock)
        self._token: str = token or ""
        self._path: str = path or "/mcp"
        self._mcp_client: Any = None
        self._connected: bool = False
        self._exit_stack: Any = None

    # ================================================================ 连通性

    async def health(self) -> dict[str, Any]:
        """MCP server 可达性自检。

        Returns:
            ``{"status":"ok",...}``；mock 模式返回 ``{"status":"ok","mock":true}``。

        Raises:
            IqdMcpClientError: 非 mock 模式且连接失败。
        """
        if self._mock:
            return {"status": "ok", "service": "wren-mcp", "mock": True}
        try:
            await self._probe_session()
            # health 是 MCP 协议层 capability；无法调用时以连通性判断兜底
            return {"status": "ok", "service": "wren-mcp", "host": self._host}
        except Exception as exc:
            raise IqdMcpClientError(f"wren MCP 不可达: {exc}") from exc

    # ================================================================ 运行时工具

    async def ask(
        self,
        *,
        question: str,
        context: str = "",
        allowed_tables: list[str] | None = None,
        thread_id: str | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        """向 WrenAI 提交自然语言问数（返回 SQL + steps + chart，不执行）。

        Args:
            question: 用户原始问题。
            context: 角色级语义上下文（get_context 产物）。
            allowed_tables: 范围裁定后的表集合（item_key）。
            thread_id: WrenAI 线程（追问）。
            language: 生成语言（缺省取配置）。

        Returns:
            WrenAI 响应体（含 ``type`` / ``sql`` / ``steps`` / ``chart``）。
        """
        if self._mock:
            # ask 在 0.13 OSS 未必存在；mock 仅返回占位 SQL，正式链路走 nl2sql。
            mock_sql = (
                "SELECT channel, SUM(total_amount) AS gmv "
                "FROM pg_main.public.orders "
                "WHERE created_at >= date_trunc('month', CURRENT_DATE) "
                "GROUP BY channel ORDER BY gmv DESC"
            )
            return {
                "type": "text_to_sql",
                "sql": mock_sql,
                "question": question,
                "allowed_tables": allowed_tables or [],
            }
        payload: dict[str, Any] = {
            "question": question,
            "context": context,
            "language": language or get_settings().iqd_mcp.wren_language,
        }
        if allowed_tables:
            payload["allowed_tables"] = allowed_tables
        if thread_id:
            payload["thread_id"] = thread_id
        return await self._call_tool(TOOL_ASK, payload)

    async def dry_plan(
        self,
        *,
        sql: str,
        dialect: str = "postgres",
    ) -> dict[str, Any]:
        """dry_plan：把已建模 SQL 转译为目标方言（Wren 0.13，不执行、不做 NL→SQL）。

        Args:
            sql: 已生成的（MDL 或方言）SQL。
            dialect: 目标方言提示（透传；引擎以 project profile 为准）。

        Returns:
            含 ``sql`` 字段的转译结果；mock 模式原样透传。
        """
        if self._mock:
            return self._mock_plan(sql, dialect)
        payload: dict[str, Any] = {"sql": sql}
        if dialect:
            payload["dialect"] = dialect
        return await self._call_tool(TOOL_DRY_PLAN, payload)

    async def dry_run(self, sql: str, dialect: str = "postgres") -> dict[str, Any]:
        """dry_run：确认 SQL 可执行（不落结果）。"""
        if self._mock:
            return {"type": "dry_run", "ok": True, "sql": sql, "dialect": dialect}
        return await self._call_tool(TOOL_DRY_RUN, {"sql": sql, "dialect": dialect})

    async def run_sql(self, sql: str, dialect: str = "postgres") -> dict[str, Any]:
        """run_sql：执行注入后 SQL 并返回结果集。"""
        if self._mock:
            return self._mock_run(sql, dialect)
        return await self._call_tool(TOOL_RUN_SQL, {"sql": sql, "dialect": dialect})

    async def query_cube(self, **kwargs: Any) -> dict[str, Any]:
        """query_cube：cube 查询（B2 骨架透传）。"""
        return await self._call_tool(TOOL_QUERY_CUBE, kwargs)

    async def list_cubes(self, **kwargs: Any) -> dict[str, Any]:
        """list_cubes：列出工程内 cube（名称 / 度量 / 维度）。

        <p>2026-09-28 事实：cube 必须落在 ``cubes/<name>/metadata.yml`` 才能被 MCP 看见；
        只写 ``target/mdl.json`` 时 MCP（与 ``wren context show``）读不到 —— 详见
        ``docs/ai-fusion/wrenai/wrenai-013-field-notes.md``。
        """
        if self._mock:
            return {"cubes": []}
        return await self._call_tool(TOOL_LIST_CUBES, kwargs)

    async def describe_cube(self, cube_name: str, **kwargs: Any) -> dict[str, Any]:
        """describe_cube：单个 cube 的完整定义（度量 / 维度 / 基类）。

        <p>MCP 入参名是 ``name``（与 ``describe_model`` 同构），不是 ``cube``。
        """
        if self._mock:
            return {"cube": cube_name, "measures": [], "dimensions": []}
        payload: dict[str, Any] = dict(kwargs)
        payload.pop("cube", None)
        payload["name"] = cube_name
        return await self._call_tool(TOOL_DESCRIBE_CUBE, payload)

    # ================================================================ 角色级上下文

    async def get_context(
        self,
        *,
        role_scope: str = "",
        language: str | None = None,
    ) -> dict[str, Any]:
        """读取角色级语义上下文 + 原生引用来源（供前置收敛与 CitationBuilder）。"""
        if self._mock:
            return {"type": "context", "models": [], "instructions": [], "knowledge": []}
        payload: dict[str, Any] = {
            "language": language or get_settings().iqd_mcp.wren_language,
        }
        if role_scope:
            payload["role_scope"] = role_scope
        return await self._call_tool(TOOL_GET_CONTEXT, payload)

    async def list_knowledge(self, **kwargs: Any) -> dict[str, Any]:
        """list_knowledge：角色级知识清单（原生引用来源）。"""
        if self._mock:
            return {"type": "knowledge", "items": []}
        return await self._call_tool(TOOL_LIST_KNOWLEDGE, kwargs)

    async def recall_queries(self, **kwargs: Any) -> dict[str, Any]:
        """recall_queries：历史相似查询召回（增强上下文）。"""
        if self._mock:
            return {"type": "recall", "items": []}
        return await self._call_tool(TOOL_RECALL_QUERIES, kwargs)

    async def get_instructions(self, **kwargs: Any) -> dict[str, Any]:
        """get_instructions：业务术语 / 口径 / 同义词指令。"""
        if self._mock:
            return {"type": "instructions", "items": []}
        return await self._call_tool(TOOL_GET_INSTRUCTIONS, kwargs)

    # ================================================================ 清单读取

    async def get_mdl(self, **kwargs: Any) -> dict[str, Any]:
        """get_mdl：读取完整 MDL JSON（catalog 对账 pull）。"""
        if self._mock:
            return {"type": "mdl", "models": []}
        return await self._call_tool(TOOL_GET_MDL, kwargs)

    async def list_models(self, **kwargs: Any) -> dict[str, Any]:
        """list_models：语义模型清单。"""
        if self._mock:
            return {"type": "models", "models": []}
        return await self._call_tool(TOOL_LIST_MODELS, kwargs)

    async def describe_model(self, model_name: str, **kwargs: Any) -> dict[str, Any]:
        """describe_model：单个语义模型结构。

        <p>Wren MCP 工具入参名为 ``name``（见 tools/list 的
        ``describe_modelArguments``），不是 ``model``；传错会返回 validation error
        且列预览为空。
        """
        if self._mock:
            return {"type": "model", "name": model_name, "fields": []}
        payload: dict[str, Any] = dict(kwargs)
        payload.pop("model", None)
        payload["name"] = model_name
        return await self._call_tool(TOOL_DESCRIBE_MODEL, payload)

    # ================================================================ 内部实现

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """调用 MCP 工具；未放行的写工具直接拒绝。"""
        if tool_name not in READ_ONLY_TOOLS and not self._allow_write:
            raise IqdMcpClientError(
                f"写工具 {tool_name} 未放行（wren_mcp_allow_write=false）"
            )

        import asyncio

        try:
            result: Any = await asyncio.wait_for(
                self._call_tool_isolated(tool_name, arguments),
                timeout=self._timeout,
            )
        except TimeoutError as exc:
            raise IqdMcpClientError(f"wren MCP 工具超时: {tool_name}") from exc
        except IqdMcpClientError:
            raise
        except Exception as exc:
            raise IqdMcpClientError(f"wren MCP 工具失败: {tool_name} -> {exc}") from exc

        return self._parse_mcp_result(result, tool_name)

    async def _call_tool_isolated(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """**同一 task 内**建连 → 调用 → 关闭（每次调用独立 session）。

        <p><b>为什么不能复用 session</b>（2026-09-28 实测）：MCP SDK 的
        streamable-http session 把 anyio 的 cancel scope 绑在**创建它的 task** 上；
        FastAPI 每个请求是独立 task，跨请求复用后一旦发生取消/超时，就会在另一个
        task 里退出该 scope →
        ``RuntimeError: Attempted to exit cancel scope in a different task than it was entered in``
        → TaskGroup 抛 ``BaseExceptionGroup`` → **HTTP 连接被重置**（日志里那串
        ``receive_response_headers.failed / CancelledError`` 就是它）。

        <p>建连成本：wren MCP 在本机（经 agent 反代），一次 initialize 约百毫秒级；
        换来的是稳定与「不会被跨 task 取消打穿」。

        <p>A/B 实测：同一 client 3 并发 task 调 ``list_models``，旧实现 3 个挂 2 个，
        本实现 3/3 成功。
        """
        if self._mock:
            raise IqdMcpClientError("wren MCP 不可用（mock 降级）")

        import contextlib

        import httpx
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
        from mcp.shared._httpx_utils import create_mcp_http_client

        url = f"http://{self._host}:{self._port}{self._path}"
        headers = {"Authorization": f"Bearer {self._token}"} if self._token else None
        timeout = httpx.Timeout(self._timeout, read=max(self._timeout * 2, 60.0))

        async with contextlib.AsyncExitStack() as stack:
            http_client = create_mcp_http_client(headers=headers, timeout=timeout)
            await stack.enter_async_context(http_client)
            read, write, _get_sid = await stack.enter_async_context(
                streamable_http_client(
                    url=url,
                    http_client=http_client,
                    terminate_on_close=True,
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            return await session.call_tool(tool_name, arguments)

    async def _probe_session(self) -> None:
        """连通性自检：**同一 task 内**建连即关（不调用工具）。

        <p>与 :meth:`_call_tool_isolated` 同一生命周期约定 —— 见那里的 cancel-scope 说明。
        """
        if self._mock:
            raise IqdMcpClientError("wren MCP 不可用（mock 降级）")

        import contextlib

        import httpx
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
        from mcp.shared._httpx_utils import create_mcp_http_client

        url = f"http://{self._host}:{self._port}{self._path}"
        headers = {"Authorization": f"Bearer {self._token}"} if self._token else None
        timeout = httpx.Timeout(self._timeout, read=max(self._timeout * 2, 60.0))

        async with contextlib.AsyncExitStack() as stack:
            http_client = create_mcp_http_client(headers=headers, timeout=timeout)
            await stack.enter_async_context(http_client)
            read, write, _get_sid = await stack.enter_async_context(
                streamable_http_client(
                    url=url,
                    http_client=http_client,
                    terminate_on_close=True,
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()

    @staticmethod
    def _parse_mcp_result(result: Any, tool_name: str) -> dict[str, Any]:
        """解析 MCP 工具返回（兼容 content text JSON / dict 两种形态）。

        Wren 工具失败时常仍返回 CallToolResult（``isError=True`` + text 错误信息），
        必须显式抛错，避免调用方把错误文案当空结果吞掉（列预览「无字段」假阴性）。
        """
        is_error = bool(getattr(result, "isError", False) or getattr(result, "is_error", False))
        if isinstance(result, dict):
            if result.get("isError") or result.get("is_error"):
                raise IqdMcpClientError(
                    f"wren MCP 工具失败: {tool_name} -> {result.get('content') or result}"
                )
            return result

        # MCP CallToolResult：取第一个 text content
        content: Any = getattr(result, "content", None)
        if isinstance(content, list) and content:
            texts: list[str] = []
            for item in content:
                text: Any = getattr(item, "text", None)
                if text:
                    texts.append(str(text))
                    try:
                        parsed: Any = json.loads(text)
                        if isinstance(parsed, dict):
                            if is_error:
                                raise IqdMcpClientError(
                                    f"wren MCP 工具失败: {tool_name} -> {parsed}"
                                )
                            return parsed
                    except (json.JSONDecodeError, TypeError):
                        pass
            joined = " | ".join(texts) if texts else ""
            if is_error:
                raise IqdMcpClientError(f"wren MCP 工具失败: {tool_name} -> {joined or result}")
            if joined:
                return {"type": "text", "text": joined}

        if isinstance(result, str):
            try:
                parsed = json.loads(result)
                if isinstance(parsed, dict):
                    return parsed
            except (json.JSONDecodeError, TypeError):
                pass
            return {"type": "text", "text": result}

        raise IqdMcpClientError(f"wren MCP 工具返回无法解析: {tool_name}")

    # ================================================================ 方案 A 多连接路由

    @classmethod
    def for_connection(
        cls,
        connection_id: int | str,
        registry: Any = None,
        *,
        mock: bool | None = None,
    ) -> "IqdMcpClient":
        """按 connection_id 取该连接专属 MCP 端点构造 client（方案 A 多连接路由）。

        优先级：
        1. 跨机器部署句柄（:func:`get_agent_registry` 命中 RUNNING 远程部署）：
           经 WrenMcpAgent 数据面反向代理访问本机 wren 进程，数据面带 bearer（决策 ②），
           路径按 connId 路由（``/mcp/{conn_id}``）；host/port 取注册表 ``mcp_endpoint``
           （ai-platform 可达地址，决策 ①⑧）。
        2. 本地 Plan A 子进程模型：进程管理器单例持有该连接专属 ``wren serve mcp``
           端点（host/port）。

        两端点均未就绪（连接未启动/已停止/已崩溃未重拉）时**显式抛错**，绝不静默落到
        默认单连接 8080 端点（REQ-P0-3：多连接间不得串台）。问数链路（orchestrator）
        捕获该错误后降级 mock（REQ-P0-1）。

        Args:
            connection_id: 问数连接 id（任意可比较标识，内部统一转 str）。
            registry: 进程管理器（缺省取单例）；可注入便于测试（仅本地模式生效）。
            mock: 强制 mock 模式（仅测试 / 离线验证）。

        Returns:
            :class:`IqdMcpClient`（host/port 绑定该连接专属端点，或远程代理端点）。

        Raises:
            IqdMcpClientError: 连接端点未就绪（须先经 ensure/start 拉起该连接进程）。
        """
        if mock is True:
            return cls(mock=True)

        # ① 跨机器部署：命中 RUNNING 远程部署句柄 → 经 agent 数据面反向代理访问。
        #    远程模式下 wren 进程在 wren 机，本地进程管理器无端点（不依赖 endpoint）。
        dep = get_agent_registry().get(connection_id)
        if dep is not None and dep.status == McpStatus.RUNNING and dep.mcp_endpoint:
            host, port = _parse_endpoint_host_port(dep.mcp_endpoint)
            settings = get_settings()
            token = settings.iqd_mcp.wren_agent_token or ""
            logger.info(
                "IQD MCP client for connection (remote)",
                connection_id=connection_id,
                host=host,
                port=port,
                mcp_endpoint=dep.mcp_endpoint,
            )
            return cls(host=host, port=port, token=token, path=f"/mcp/{connection_id}")

        # ② 本地 Plan A 子进程模型：进程管理器单例持有专属端点。
        mgr: WrenMcpProcessManager = registry or get_process_manager()
        endpoint = mgr.get_endpoint(connection_id)
        if endpoint is None:
            raise IqdMcpClientError(
                f"连接 {connection_id} 的 MCP 端点未就绪（未启动/已停止/已崩溃未重启）；"
                "请先经 MCP 管理器 /iqd/mcp/ensure 或 /iqd/mcp/start 拉起该连接进程"
            )
        logger.info(
            "IQD MCP client for connection (local)",
            connection_id=connection_id,
            port=endpoint.port,
        )
        return cls(host=endpoint.host, port=endpoint.port, token="", path=None)


    # ================================================================ Mock 数据

    def _mock_plan(self, sql: str, dialect: str) -> dict[str, Any]:
        """离线 mock：方言转译透传（NL→SQL 已在平台侧完成）。"""
        return {
            "type": "dry_plan",
            "sql": sql,
            "dialect": dialect,
        }

    def _mock_run(self, sql: str, dialect: str) -> dict[str, Any]:
        """离线 mock：返回固定结果集。"""
        columns = [
            {"name": "channel", "data_type": "varchar", "display_name": "渠道"},
            {"name": "gmv", "data_type": "numeric", "display_name": "销售额"},
        ]
        rows = [
            ["线上", 7464820.00],
            ["门店", 3891200.00],
            ["分销", 683980.00],
        ]
        return {
            "type": "result",
            "sql": sql,
            "dialect": dialect,
            "summary": "本月三个渠道合计 GMV 1,204 万元，其中线上占 62%。",
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": False,
            "query_id": f"q-mock-{uuid.uuid4().hex[:12]}",
            "execution_time_ms": int(time.time() * 1000) % 1000 + 12,
        }


def _parse_endpoint_host_port(endpoint: str) -> tuple[str, int]:
    """从 ``http://host:port`` 或 ``host:port`` 解析 (host, port)。

    用于跨机器部署数据面 ``mcp_endpoint`` 落地到 :class:`IqdMcpClient` 的
    host/port（决策 ①⑧：ai-platform 经 agent 反向代理访问 wren 机进程）。

    Returns:
        ``(host, port)``；缺省 host=127.0.0.1、port=9101（数据面默认端口）。
    """
    from urllib.parse import urlparse

    parsed = urlparse(endpoint if "://" in endpoint else f"http://{endpoint}")
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 9101
    return host, port
