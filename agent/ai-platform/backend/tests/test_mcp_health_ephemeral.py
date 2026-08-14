"""MCP 短连接探活：不依赖长连接会话，HTTP 可达即健康。"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.mcp.client import MCPClient, MCPTransportType
from src.mcp.manager import MCPManager, MCPServerConfig


@pytest.mark.asyncio
async def test_health_check_uses_ephemeral_session_not_long_lived() -> None:
    """未 connect 时 health_check 仍应走短连接 initialize + list_tools。"""
    client = MCPClient(
        server_name="demo",
        transport=MCPTransportType.HTTP,
        endpoint="http://127.0.0.1:3333/mcp",
        timeout=5.0,
    )
    assert client.is_connected is False

    session = MagicMock()
    session.initialize = AsyncMock()
    session.list_tools = AsyncMock(return_value=MagicMock(tools=[]))

    with patch.object(client, "_open_session", new=AsyncMock(return_value=session)):
        assert await client.health_check() is True

    session.initialize.assert_awaited_once()
    session.list_tools.assert_awaited_once()
    assert client.is_connected is False


@pytest.mark.asyncio
async def test_health_check_returns_false_on_failure() -> None:
    client = MCPClient(
        server_name="demo",
        transport=MCPTransportType.HTTP,
        endpoint="http://127.0.0.1:9/mcp",
        timeout=1.0,
    )
    with patch.object(
        client,
        "_open_session",
        new=AsyncMock(side_effect=RuntimeError("down")),
    ):
        assert await client.health_check() is False


@pytest.mark.asyncio
async def test_health_check_all_covers_registered_not_only_connected() -> None:
    """探活覆盖全部已注册 Server，不要求先点「连接」。"""
    mgr = MCPManager()
    mgr.register(
        MCPServerConfig(
            name="mcp-api-suite",
            transport=MCPTransportType.HTTP,
            endpoint="http://127.0.0.1:3333/mcp",
            auto_connect=False,
        )
    )
    assert mgr.is_connected("mcp-api-suite") is False

    with patch.object(MCPClient, "health_check", new=AsyncMock(return_value=True)):
        results: dict[str, Any] = await mgr.health_check_all()

    assert results == {"mcp-api-suite": True}
