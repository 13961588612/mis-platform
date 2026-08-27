"""IqdMcpClient — 本地 WrenAI MCP server 客户端（v1.9 / B2）。

对接本机 ``wren serve mcp --transport http @127.0.0.1:8080``（MCP-first 桥接，
architecture §4.4①）。工具名抽成**模块常量**，升级只改常量（对齐
``kb_client.py`` 范式）。

管理面（profile / context build）走 :mod:`src.adapters.iqd_cli`，**不走 MCP 写**；
本客户端只负责**运行时问数与执行**（只读）。

离线 mock 模式（``mock=True``）：
- 本机无 ``wren serve mcp`` 时仍可走通 orchestrator 管道（Golden path 离线验证）；
- :meth:`dry_plan` 返回固定 SQL（命中 mock 表集合）；:meth:`dry_run` / :meth:`run_sql`
  返回固定结果集；:meth:`health` 返回 ``{"status":"ok","mock":true}``。
"""

from __future__ import annotations

from typing import Any

import json
import time
import uuid

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("adapters.iqd_mcp_client")

# ===== MCP 工具名常量（升级只改这里）=====
TOOL_ASK = "ask"
TOOL_RUN_SQL = "run_sql"
TOOL_DRY_RUN = "dry_run"
TOOL_DRY_PLAN = "dry_plan"
TOOL_QUERY_CUBE = "query_cube"
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
    ) -> None:
        """初始化客户端。

        Args:
            host: MCP server 主机（缺省取 ``WREN_MCP_HOST``）。
            port: MCP server 端口（缺省取 ``WREN_MCP_PORT``）。
            timeout: 单次工具调用超时秒数（缺省取 ``WREN_MCP_TIMEOUT_SECONDS``）。
            allow_write: 是否放行写工具（缺省取 ``WREN_MCP_ALLOW_WRITE``）。
            mock: 强制离线 mock 模式；``None`` 时自动探测（无连接可回退 mock）。
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
        self._mcp_client: Any = None
        self._connected: bool = False

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
            session = await self._ensure_session()
            if session is None:
                raise IqdMcpClientError("wren MCP session 不可用")
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
            return self._mock_plan(question, allowed_tables)
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
        question: str,
        context: str = "",
        allowed_tables: list[str] | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        """dry_plan：生成 SQL 不执行（Orchestrator 首选阶段）。"""
        if self._mock:
            return self._mock_plan(question, allowed_tables)
        payload: dict[str, Any] = {
            "question": question,
            "context": context,
            "language": language or get_settings().iqd_mcp.wren_language,
        }
        if allowed_tables:
            payload["allowed_tables"] = allowed_tables
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

    # ================================================================ 角色级上下文

    async def get_context(
        self,
        *,
        role_scope: str = "",
        language: str | None = None,
    ) -> dict[str, Any]:
        """读取角色级语义上下文 + 原生引用来源（供前置收窄与 CitationBuilder）。"""
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
        """get_instructions：业务术语/口径/同义词指令。"""
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
        """describe_model：单个语义模型结构。"""
        if self._mock:
            return {"type": "model", "name": model_name, "fields": []}
        payload: dict[str, Any] = dict(kwargs)
        payload["model"] = model_name
        return await self._call_tool(TOOL_DESCRIBE_MODEL, payload)

    # ================================================================ 内部实现

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """调用 MCP 工具；未放行的写工具直接拒绝。"""
        if tool_name not in READ_ONLY_TOOLS and not self._allow_write:
            raise IqdMcpClientError(
                f"写工具 {tool_name} 未放行（wren_mcp_allow_write=false）"
            )

        session = await self._ensure_session()
        if session is None:
            raise IqdMcpClientError("wren MCP session 不可用")

        import asyncio

        try:
            result: Any = await asyncio.wait_for(
                session.call_tool(tool_name, arguments),
                timeout=self._timeout,
            )
        except TimeoutError as exc:
            raise IqdMcpClientError(f"wren MCP 工具超时: {tool_name}") from exc
        except Exception as exc:
            raise IqdMcpClientError(f"wren MCP 工具失败: {tool_name} -> {exc}") from exc

        return self._parse_mcp_result(result, tool_name)

    async def _ensure_session(self) -> Any:
        """懒建立 MCP HTTP transport session（失败时置 mock 并返回 None）。"""
        if self._mock:
            return None
        if self._mcp_client is not None and self._connected:
            return self._mcp_client

        try:
            from mcp import ClientSession, StdioServerParameters  # noqa: F401 - 类型标注
            from mcp.client.http import http_client

            url = f"http://{self._host}:{self._port}/mcp"
            # HTTP transport：streamable http 客户端
            ctx = http_client(url)
            self._mcp_client = await ctx.__aenter__()
            self._connected = True
            return self._mcp_client
        except Exception as exc:
            logger.warning(
                "wren MCP connect failed; degrade to mock",
                host=self._host,
                port=self._port,
                error=str(exc),
            )
            self._mock = True
            return None

    @staticmethod
    def _parse_mcp_result(result: Any, tool_name: str) -> dict[str, Any]:
        """解析 MCP 工具返回（兼容 content text JSON / dict 两种形态）。"""
        if isinstance(result, dict):
            return result

        # MCP CallToolResult：取第一个 text content
        content: Any = getattr(result, "content", None)
        if isinstance(content, list) and content:
            for item in content:
                text: Any = getattr(item, "text", None)
                if text:
                    try:
                        parsed: Any = json.loads(text)
                        if isinstance(parsed, dict):
                            return parsed
                    except (json.JSONDecodeError, TypeError):
                        pass
                    return {"type": "text", "text": str(text)}

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

        进程管理器为进程内单例（:func:`get_process_manager`），本方法据连接 id 取
        该连接专属 ``wren serve mcp`` 端点（host/port）。若端点未就绪（连接未启动 /
        已停止 / 已崩溃未重启），**显式抛错**，绝不静默落到默认单连接 8080 端点
        （REQ-P0-3：多连接间不得串台）。问数链路（orchestrator）捕获该错误后降级
        mock（REQ-P0-1）。

        Args:
            connection_id: 问数连接 id（任意可比较标识，内部统一转 str）。
            registry: 进程管理器（缺省取单例）；可注入便于测试。
            mock: 强制 mock 模式（仅测试 / 离线验证）。

        Returns:
            :class:`IqdMcpClient`（host/port 绑定该连接专属端点）。

        Raises:
            IqdMcpClientError: 连接端点未就绪（须先经 MCP 管理器 /iqd/mcp/start 拉起）。
        """
        if mock is True:
            return cls(mock=True)
        from src.adapters.wren_mcp_registry import WrenMcpProcessManager

        mgr: WrenMcpProcessManager = registry or get_process_manager()
        endpoint = mgr.get_endpoint(connection_id)
        if endpoint is None:
            raise IqdMcpClientError(
                f"连接 {connection_id} 的 MCP 端点未就绪（未启动/已停止/已崩溃未重启）；"
                "请先经 MCP 管理器 /iqd/mcp/start 拉起该连接进程"
            )
        logger.info("IQD MCP client for connection", connection_id=connection_id, port=endpoint.port)
        return cls(host=endpoint.host, port=endpoint.port)

    # ================================================================ Mock 数据

    def _mock_plan(self, question: str, allowed_tables: list[str] | None) -> dict[str, Any]:
        """离线 mock：生成固定 SQL（用于 Golden path 验证）。"""
        tables = allowed_tables or ["pg_main.public.orders"]
        mock_sql = (
            "SELECT channel, SUM(total_amount) AS gmv "
            "FROM pg_main.public.orders "
            "WHERE created_at >= date_trunc('month', CURRENT_DATE) "
            "GROUP BY channel ORDER BY gmv DESC"
        )
        return {
            "type": "text_to_sql",
            "sql": mock_sql,
            "steps": [
                {"code": "understanding", "label": "理解问题"},
                {"code": "searching", "label": "检索语义模型"},
                {"code": "generating", "label": "生成 SQL"},
            ],
            "chart": None,
            "question": question,
            "allowed_tables": tables,
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
