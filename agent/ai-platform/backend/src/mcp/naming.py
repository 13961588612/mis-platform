"""MCP Server 命名准入（T03 spec §2.6，E2 命名铁律的**前置保障**）。

**为什么必须在入口卡住**

E2（MCP 工具）判权依赖两个**永不互推**的名字：

- **展示名**（给 LLM 看）：``mcp__{server}__{tool}``，由
  :func:`~src.runtime.tool_registry_builder._sanitize_tool_segment` 把
  ``[^A-Za-z0-9_-]`` 一律替换为 ``_`` 后拼出。
- **判别名**（给权限系统看）：``mcp-{server}-{tool}``，取
  ``PlatformMcpToolAdapter._tool_info`` 的**原始未净化名**。

若允许 server 名里出现 ``.`` / 中文 / 空格等字符，净化会把不同 server
折叠成同一个展示名（``a.b`` 与 ``a_b`` 都变 ``a_b``），造成
**展示名撞车 → 工具覆盖 → 越权调用**。

本模块的正则恰好等于「净化的不动点集合」：凡通过校验的名字，
``_sanitize_tool_segment(name) == name`` 恒成立，展示名与判别名一一对应。

**准入规则**：``^[A-Za-z][A-Za-z0-9_-]{0,63}$``

- 必须以英文字母开头（避免净化时被加 ``mcp_`` 前缀）；
- 其余字符仅允许字母、数字、下划线、连字符；
- 总长度 1–64。

**违规处置**：

- 运行时注册（``POST /api/v1/mcp``）→ HTTP 400；
- 启动装载（``mcp-servers.yaml``）→ 抛 :class:`McpServerNameError`，**启动失败**
  （fail-closed：宁可起不来，也不带着会撞车的命名对外服务）。
"""

from __future__ import annotations

import re

__all__ = [
    "MCP_SERVER_NAME_MAX_LENGTH",
    "MCP_SERVER_NAME_PATTERN",
    "MCP_SERVER_NAME_REGEX",
    "McpServerNameError",
    "assert_valid_mcp_server_name",
    "is_valid_mcp_server_name",
    "mcp_server_name_error_message",
]

#: MCP Server 名准入正则（字符串形式，供文档 / 错误提示复用）。
MCP_SERVER_NAME_PATTERN: str = r"^[A-Za-z][A-Za-z0-9_-]{0,63}$"

#: 预编译的准入正则。
MCP_SERVER_NAME_REGEX: re.Pattern[str] = re.compile(MCP_SERVER_NAME_PATTERN)

#: 名称最大长度（与正则中的 ``{0,63}`` 对应：首字符 + 63）。
MCP_SERVER_NAME_MAX_LENGTH: int = 64


class McpServerNameError(ValueError):
    """MCP Server 名不满足准入正则。

    Attributes:
        name: 违规的原始名称。
    """

    def __init__(self, name: str) -> None:
        """记录违规名称并生成统一文案。

        Args:
            name: 违规的原始名称。
        """
        self.name: str = name
        super().__init__(mcp_server_name_error_message(name))


def mcp_server_name_error_message(name: str) -> str:
    """生成统一的违规提示文案（API 400 与启动异常共用）。

    Args:
        name: 违规的原始名称。

    Returns:
        面向运维的中文提示。
    """
    return (
        f"MCP server 名 '{name}' 不合法：必须匹配 {MCP_SERVER_NAME_PATTERN}"
        f"（英文字母开头，仅允许字母/数字/下划线/连字符，长度 1–"
        f"{MCP_SERVER_NAME_MAX_LENGTH}）。"
        "含其他字符会在生成工具展示名时被净化，导致不同 server 撞名并覆盖工具。"
    )


def is_valid_mcp_server_name(name: str | None) -> bool:
    """判断 MCP Server 名是否满足准入正则。

    Args:
        name: 待校验名称；``None`` / 空串一律不合法。

    Returns:
        合法返回 ``True``。
    """
    if not name or not isinstance(name, str):
        return False
    return MCP_SERVER_NAME_REGEX.match(name) is not None


def assert_valid_mcp_server_name(name: str | None) -> str:
    """校验 MCP Server 名，不合法则抛 :class:`McpServerNameError`。

    Args:
        name: 待校验名称。

    Returns:
        原样返回合法名称（便于链式赋值）。

    Raises:
        McpServerNameError: 名称为空或不匹配准入正则。
    """
    if not is_valid_mcp_server_name(name):
        raise McpServerNameError(str(name or ""))
    return str(name)
