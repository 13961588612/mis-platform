"""MCP 客户端 — 通过 stdio、Streamable HTTP 或 SSE 传输连接 MCP Server。

使用官方 ``mcp`` Python SDK（JSON-RPC over Streamable HTTP / SSE / stdio）。
"""

from __future__ import annotations
from typing import Any

import contextlib
from contextlib import AsyncExitStack
from enum import Enum

import httpx
import structlog
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

logger = structlog.get_logger(__name__)


class MCPTransportType(str, Enum):
    """支持的 MCP 传输协议。"""

    STDIO = "stdio"
    HTTP = "http"
    SSE = "sse"


class MCPClientError(Exception):
    """MCP 客户端操作失败时抛出。"""


def _tool_to_dict(tool: Any) -> dict[str, Any]:
    """将 MCP SDK 工具对象转为 JSON 兼容的 dict。

    Args:
        tool: ``list_tools`` 返回的工具对象。

    Returns:
        工具元数据的字典表示。
    """
    if hasattr(tool, "model_dump"):
        return tool.model_dump(mode="json", exclude_none=True)
    return dict(tool)


def _call_result_to_dict(result: Any) -> dict[str, Any]:
    """将 ``call_tool`` 结果转为 dict，并展平 text 内容块。

    Args:
        result: MCP SDK 的 ``CallToolResult`` 或等价对象。

    Returns:
        含 ``content`` 及可选 ``text`` 字段的结果字典。
    """
    if hasattr(result, "model_dump"):
        data: dict[str, Any] = result.model_dump(mode="json", exclude_none=True)
    else:
        data: dict[str, Any] = dict(result)
    # 将 text 内容块展平，方便下游使用
    if "content" in data and isinstance(data["content"], list):
        texts: list[Any] = [
            block.get("text", "")
            for block in data["content"]
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        if texts:
            data["text"] = "\n".join(texts)
    return data


class MCPClient:
    """与 MCP Server 通信的统一客户端。"""

    def __init__(
        self,
        server_name: str,
        transport: MCPTransportType,
        endpoint: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        timeout: float = 30.0,
    ) -> None:
        """初始化 MCP 客户端（不建立连接）。

        Args:
            server_name: MCP Server 注册名称。
            transport: 传输协议（stdio / http / sse）。
            endpoint: HTTP/SSE URL 或 stdio 可执行文件路径。
            args: stdio 模式下传递给命令的参数。
            env: stdio 模式下的额外环境变量。
            timeout: 连接与请求超时（秒）。
        """
        self._server_name = server_name
        self._transport = transport
        self._endpoint = endpoint
        self._args = args or []
        self._env = env or {}
        self._timeout = timeout
        self._connected = False
        self._session: ClientSession | None = None
        self._exit_stack: contextlib.AsyncExitStack | None = None
        self._tools_cache: list[dict[str, Any]] | None = None

    @property
    def server_name(self) -> str:
        """MCP Server 注册名称。"""
        return self._server_name

    @property
    def transport(self) -> MCPTransportType:
        """当前传输协议。"""
        return self._transport

    @property
    def is_connected(self) -> bool:
        """当前是否已建立可用的 MCP 会话。"""
        return self._connected and self._session is not None

    @property
    def uses_ephemeral_io(self) -> bool:
        """HTTP/SSE 在 FastAPI 下不宜跨请求复用长连接，读写一律短连接。"""
        return self._transport in (MCPTransportType.HTTP, MCPTransportType.SSE)

    async def connect(self) -> None:
        """建立到 MCP Server 的连接。"""
        if self._connected and self._session is not None:
            return

        stack: AsyncExitStack = contextlib.AsyncExitStack()
        try:
            session: ClientSession = await self._open_session(stack)
            await session.initialize()
            self._exit_stack = stack
            self._session = session
            self._connected = True
            logger.info(
                "MCP client connected",
                server=self._server_name,
                transport=self._transport.value,
                endpoint=self._endpoint,
            )
        except Exception as exc:
            await stack.aclose()
            raise MCPClientError(
                f"Failed to connect to MCP server {self._server_name} at {self._endpoint}: {exc}"
            ) from exc

    async def _open_session(self, stack: contextlib.AsyncExitStack) -> ClientSession:
        """按传输类型打开 MCP 传输并创建 ``ClientSession``。

        Args:
            stack: 用于托管传输上下文管理器的异步退出栈。

        Returns:
            已就绪、尚未 ``initialize`` 的 ``ClientSession``。
        """
        # 解包赋值不能写 read: T, write: U = ...，先注解再赋值
        read: Any
        write: Any
        if self._transport == MCPTransportType.STDIO:
            params: StdioServerParameters = StdioServerParameters(
                command=self._endpoint,
                args=self._args,
                env=self._env or None,
            )
            read, write = await stack.enter_async_context(stdio_client(params))
        elif self._transport == MCPTransportType.SSE:
            read, write = await stack.enter_async_context(
                sse_client(
                    url=self._endpoint,
                    timeout=self._timeout,
                    sse_read_timeout=max(self._timeout * 2, 60.0),
                )
            )
        elif self._transport == MCPTransportType.HTTP:
            http_client: Any = create_mcp_http_client(
                timeout=httpx.Timeout(self._timeout, read=max(self._timeout * 2, 60.0)),
            )
            await stack.enter_async_context(http_client)
            read, write, _ = await stack.enter_async_context(
                streamable_http_client(
                    url=self._endpoint,
                    http_client=http_client,
                    terminate_on_close=True,
                )
            )
        else:
            raise MCPClientError(f"Unsupported transport: {self._transport}")

        return await stack.enter_async_context(ClientSession(read, write))

    async def disconnect(self) -> None:
        """关闭到 MCP Server 的连接。

        <p>Streamable HTTP / SSE 的 transport 常在「连接请求」的 asyncio task 里
        进入 cancel scope；跨 FastAPI 请求再 ``aclose`` 可能抛
        ``Attempted to exit cancel scope in a different task``。此处吞掉关闭异常，
        确保管理器能摘掉僵尸客户端。
        """
        self._connected = False
        self._session = None
        self._tools_cache = None
        stack = self._exit_stack
        self._exit_stack = None
        if stack is not None:
            try:
                await stack.aclose()
            except Exception as exc:  # noqa: BLE001 — 跨 task 关闭是预期噪声
                logger.debug(
                    "MCP client disconnect cleanup ignored",
                    server=self._server_name,
                    error=str(exc),
                )
        logger.info("MCP client disconnected", server=self._server_name)

    async def list_tools(self) -> list[dict[str, Any]]:
        """返回 MCP Server 暴露的工具列表。"""
        if self.uses_ephemeral_io:
            return await self._list_tools_ephemeral()

        if not self._session:
            raise MCPClientError(f"Not connected to {self._server_name}")

        if self._tools_cache is not None:
            return self._tools_cache

        result: Any = await self._session.list_tools()
        tools: list[Any] = [_tool_to_dict(tool) for tool in result.tools]
        self._tools_cache = tools
        return tools

    async def _list_tools_ephemeral(self) -> list[dict[str, Any]]:
        """短连接 ``initialize`` + ``tools/list``，用完即关。"""
        try:
            async with contextlib.AsyncExitStack() as stack:
                session: ClientSession = await self._open_session(stack)
                await session.initialize()
                result: Any = await session.list_tools()
                return [_tool_to_dict(tool) for tool in result.tools]
        except MCPClientError:
            raise
        except Exception as exc:
            raise MCPClientError(
                f"Failed to list tools on {self._server_name} at {self._endpoint}: {exc}"
            ) from exc

    async def call_tool(
        self, tool_name: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        """在 MCP Server 上调用一个工具。"""
        if self.uses_ephemeral_io:
            return await self._call_tool_ephemeral(tool_name, arguments or {})

        if not self._session:
            raise MCPClientError(f"Not connected to {self._server_name}")

        result: Any = await self._session.call_tool(tool_name, arguments or {})
        return _call_result_to_dict(result)

    async def _call_tool_ephemeral(
        self, tool_name: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        """短连接 ``initialize`` + ``tools/call``，用完即关。"""
        try:
            async with contextlib.AsyncExitStack() as stack:
                session: ClientSession = await self._open_session(stack)
                await session.initialize()
                result: Any = await session.call_tool(tool_name, arguments)
                return _call_result_to_dict(result)
        except MCPClientError:
            raise
        except Exception as exc:
            raise MCPClientError(
                f"Failed to call tool {tool_name} on {self._server_name}: {exc}"
            ) from exc

    async def health_check(self) -> bool:
        """短连接探活：``initialize`` + ``tools/list``，不依赖长连接会话。

        <p>运营台「实时探测」走此路径。即使从未点过「连接」、或长连接已成僵尸，
        只要 Endpoint 上的 MCP Server 可达且协议正常，即返回 ``True``。
        """
        try:
            async with contextlib.AsyncExitStack() as stack:
                session: ClientSession = await self._open_session(stack)
                await session.initialize()
                await session.list_tools()
                return True
        except Exception as exc:  # noqa: BLE001 — 探活失败只反映为 False
            logger.debug(
                "MCP health probe failed",
                server=self._server_name,
                endpoint=self._endpoint,
                error=str(exc),
            )
            return False
