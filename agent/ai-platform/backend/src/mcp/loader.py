"""从 Agent 的 system/mcp-servers.yaml 文件加载 MCP Server 定义。"""

from __future__ import annotations
from typing import Any

from pathlib import Path

import yaml

from src.config import get_settings
from src.mcp.client import MCPTransportType
from src.mcp.manager import MCPManager, MCPServerConfig
from src.mcp.naming import assert_valid_mcp_server_name
from src.utils.logging import get_logger

logger = get_logger("mcp.loader")

_TRANSPORT_ALIASES: dict[str, MCPTransportType] = {
    "stdio": MCPTransportType.STDIO,
    "http": MCPTransportType.HTTP,
    "sse": MCPTransportType.SSE,
    "streamable_http": MCPTransportType.HTTP,
    "streamable-http": MCPTransportType.HTTP,
}


def _parse_transport(raw: str) -> MCPTransportType:
    """将 YAML 中的传输类型字符串解析为 ``MCPTransportType``。

    Args:
        raw: 配置中的 transport 字段值。

    Returns:
        对应的传输枚举；未知值时回退为 HTTP 并记录警告。
    """
    key: str = raw.strip().lower()
    if key not in _TRANSPORT_ALIASES:
        logger.warning("Unknown MCP transport, defaulting to http", transport=raw)
        return MCPTransportType.HTTP
    return _TRANSPORT_ALIASES[key]


def _parse_server(entry: dict[str, Any]) -> MCPServerConfig | None:
    """将 YAML 条目解析为 ``MCPServerConfig``。

    Args:
        entry: ``mcp-servers.yaml`` 中的单条服务器配置。

    Returns:
        解析成功时返回配置对象；缺少 ``name`` 或 ``endpoint`` 时返回 ``None``。

    Raises:
        McpServerNameError: server 名不满足 T03 命名准入正则
            :data:`~src.mcp.naming.MCP_SERVER_NAME_PATTERN`。**故意不吞异常** ——
            非法命名会让工具展示名撞车进而越权，宁可启动失败。
    """
    name: str | None = entry.get("name")
    endpoint: str = entry.get("endpoint", "")
    if not name:
        return None
    # T03 §2.6：命名准入。校验先于 endpoint 检查，避免非法命名靠"缺 endpoint"被静默跳过。
    assert_valid_mcp_server_name(name)
    if not endpoint:
        logger.warning("MCP server missing endpoint, skipped", name=name)
        return None

    return MCPServerConfig(
        name=name,
        transport=_parse_transport(str(entry.get("transport", "http"))),
        endpoint=endpoint,
        args=list(entry.get("args", []) or []),
        env=dict(entry.get("env", {}) or {}),
        timeout=float(entry.get("timeout", 30.0)),
        auto_connect=bool(entry.get("auto_connect", False)),
        description=str(entry.get("description", "")),
    )


def load_mcp_servers_from_files(
    manager: MCPManager,
    *,
    config_base: Path | None = None,
) -> int:
    """注册 configs/agents/*/system/mcp-servers.yaml 下声明的 MCP Server。

    Args:
        manager: 待填充的 MCP 管理器。
        config_base: 配置根目录；省略时取 ``CONFIG_BASE_PATH``。

    Returns:
        成功装载的 server 数量。

    Raises:
        McpServerNameError: 任一 **启用中** 的 server 名不满足 T03 命名准入正则。
            异常向上冒泡 → 应用启动失败（fail-closed，spec §2.6）。
    """
    base: Any = config_base or Path(get_settings().CONFIG_BASE_PATH)
    agents_dir: Any = base / "agents"
    if not agents_dir.is_dir():
        logger.warning("Agents config directory not found", path=str(agents_dir))
        return 0

    loaded: int = 0
    seen: set[str] = set()

    for agent_dir in sorted(agents_dir.iterdir()):
        if not agent_dir.is_dir():
            continue
        mcp_file: Any = agent_dir / "system" / "mcp-servers.yaml"
        if not mcp_file.is_file():
            continue

        try:
            with open(mcp_file, encoding="utf-8") as f:
                data: Any = yaml.safe_load(f) or {}
        except yaml.YAMLError as exc:
            logger.error("Invalid MCP servers YAML", path=str(mcp_file), error=str(exc))
            continue

        for entry in data.get("mcp_servers", []):
            if not isinstance(entry, dict):
                continue
            if entry.get("enabled", True) is False:
                continue

            config: MCPServerConfig | None = _parse_server(entry)
            if config is None:
                continue
            if config.name in seen:
                continue

            manager.register(config)
            seen.add(config.name)
            loaded += 1
            logger.info(
                "MCP server loaded",
                agent=agent_dir.name,
                name=config.name,
                endpoint=config.endpoint,
                transport=config.transport.value,
            )

    logger.info("MCP servers loaded from files", count=loaded)
    return loaded
