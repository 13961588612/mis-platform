"""T03 fail-closed 权限闸门测试共用替身与工厂。

被 ``test_t03_*.py`` 系列复用。所有替身都记录调用次数，
用于断言「被拒时零副作用」（spec §5 TC-33）。
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult
from pydantic import BaseModel

from src.identity.mis_permission_resolver import PermissionUnavailable

__all__ = [
    "AnyArgs",
    "FakeRegistry",
    "FakeResolver",
    "InnerTool",
    "McpInnerTool",
    "SafeLikeWrapper",
    "ToolInfo",
    "make_ctx",
    "make_settings",
]


class AnyArgs(BaseModel):
    """宽松入参模型：允许任意字段，便于构造 E1/E3/E4 入参。"""

    model_config = {"extra": "allow"}


class ToolInfo:
    """``PlatformMcpToolAdapter._tool_info`` 的最小替身（保留**原始未净化名**）。"""

    def __init__(self, server_name: str, name: str) -> None:
        self.server_name = server_name
        self.name = name
        self.description = f"{server_name}/{name}"
        self.input_schema: dict[str, Any] = {}


class InnerTool(BaseTool):
    """被包装的内层工具替身；记录是否真的被执行（副作用探针）。"""

    def __init__(self, name: str = "skill", description: str = "inner") -> None:
        self.name = name
        self.description = description
        self.input_model = AnyArgs
        #: 执行次数 —— 被拒场景必须恒为 0。
        self.calls = 0

    async def execute(
        self, arguments: BaseModel, context: ToolExecutionContext
    ) -> ToolResult:
        """记录一次调用并返回成功结果。"""
        self.calls += 1
        return ToolResult(output="INNER_EXECUTED", is_error=False, metadata={})

    def is_read_only(self, arguments: BaseModel) -> bool:
        """内层只读判定（透传测试用）。"""
        return True


class McpInnerTool(InnerTool):
    """带 ``_tool_info`` 的 MCP 工具替身（E2）。"""

    def __init__(self, server_name: str, tool_name: str, display_name: str) -> None:
        super().__init__(name=display_name, description="mcp inner")
        self._tool_info = ToolInfo(server_name, tool_name)


class SafeLikeWrapper(BaseTool):
    """``SafeToolWrapper`` 的最小替身：持 ``_inner``，供 ``_unwrap`` 穿透。"""

    def __init__(self, inner: BaseTool) -> None:
        self._inner = inner
        self.name = inner.name
        self.description = inner.description
        self.input_model = inner.input_model

    async def execute(
        self, arguments: BaseModel, context: ToolExecutionContext
    ) -> ToolResult:
        """透传给内层工具。"""
        return await self._inner.execute(arguments, context)

    def is_read_only(self, arguments: BaseModel) -> bool:
        """透传内层只读判定。"""
        return self._inner.is_read_only(arguments)


class FakeResolver:
    """``MisPermissionResolver`` 替身。

    Args:
        codes: 命中时返回的权限码集合。
        raise_unavailable: 为真则每次 ``resolve`` 抛 ``PermissionUnavailable``。
    """

    def __init__(
        self,
        codes: set[str] | None = None,
        raise_unavailable: bool = False,
    ) -> None:
        self.codes: set[str] = set(codes or set())
        self.raise_unavailable = raise_unavailable
        #: 被调用次数 —— 无 misUserId 场景必须恒为 0（绝不拿 userId 去查）。
        self.hits = 0
        #: 每次调用记录 ``(user_id, app_id, raw_jwt)``。
        self.seen: list[tuple[Any, str, str | None]] = []

    async def resolve(
        self, user_id: Any, app_id: str = "", raw_jwt: str | None = None
    ) -> set[str]:
        """返回预置码集合或抛不可用异常。"""
        self.hits += 1
        self.seen.append((user_id, app_id, raw_jwt))
        if self.raise_unavailable:
            raise PermissionUnavailable("BFF 不可达", user_id, "ConnectError")
        return set(self.codes)


class FakeRegistry:
    """``SkillRegistry`` 替身：按判别名精确查表（**不做任何名字改写**）。"""

    def __init__(self, mapping: dict[str, str] | None = None) -> None:
        self._mapping: dict[str, str] = dict(mapping or {})
        #: 记录每次 ``get`` 的入参，用于断言「用的是判别名而非展示名」。
        self.queried: list[str] = []

    def get(self, skill_id: str) -> Any | None:
        """按 skill_id 精确查找，命中返回带 ``skill_id`` 属性的对象。"""
        self.queried.append(skill_id)
        found = self._mapping.get(skill_id)
        return SimpleNamespace(skill_id=found) if found else None


def make_settings(**overrides: Any) -> SimpleNamespace:
    """构造 ``Settings`` 替身（仅含 guard 会读的字段）。"""
    base: dict[str, Any] = {
        "MIS_ACL_ENABLED": True,
        "MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES": [],
        "MIS_ACL_DEFAULT_APP_ID": "",
        "MIS_ACL_MCP_FALLBACK_PERMISSION": "agent:mcp:call",
        "acl": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def make_ctx(metadata: dict[str, Any] | None = None) -> ToolExecutionContext:
    """构造 ``ToolExecutionContext``（身份放在 ``metadata["identity"]``）。"""
    return ToolExecutionContext(cwd=Path("."), metadata=metadata or {})
