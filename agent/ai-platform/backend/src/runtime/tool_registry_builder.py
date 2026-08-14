"""按 Agent 配置构建 OpenHarness 工具注册表。"""

from __future__ import annotations

import asyncio
import fnmatch
import json
import re
from typing import Annotated, Any

from openharness.mcp.client import McpClientManager, McpServerNotConnectedError
from openharness.mcp.types import McpToolInfo
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolRegistry, ToolResult
from openharness.tools.skill_tool import SkillTool
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, create_model

from src.config import get_settings
from src.identity.mis_permission_resolver import get_mis_permission_resolver
from src.runtime.acl_tool_wrapper import AclToolWrapper
from src.runtime.mcp_identity import (
    identity_from_tool_metadata,
    identity_to_headers,
    merge_identity_into_args,
    reset_mcp_identity,
    set_mcp_identity,
)
from src.skills.acl import SkillAclGuard
from src.skills.tools.formfill_apply import FormFillApplyTool
from src.skills.tools.formfill_execute import FormFillExecuteTool
from src.skills.tools.invoke_agent import (
    DELEGATE_TOOL_ALIAS,
    DELEGATE_TOOL_NAME,
    InvokeAgentTool,
)
from src.skills.tools.kb_retrieve import KbRetrieveTool
from src.utils.logging import get_logger

logger = get_logger("runtime.tool_registry")

_MCP_LOG_LIMIT = 4000

#: 委派工具名集合（role 约束的作用对象，design-impl.md §6 T03 要点 3）
DELEGATE_TOOL_NAMES: tuple[str, ...] = (DELEGATE_TOOL_NAME, DELEGATE_TOOL_ALIAS)


def _clip_mcp_log(text: str, limit: int = _MCP_LOG_LIMIT) -> str:
    """截断 MCP 工具日志输出，避免单行过长。

    Args:
        text: 原始日志文本。
        limit: 最大保留字符数。

    Returns:
        去首尾空白并截断后的字符串。
    """
    cleaned: str = (text or "").strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + "…"


def _format_mcp_output(output: str) -> str:
    """尽量格式化 JSON 输出，便于日志阅读。"""
    cleaned: str = (output or "").strip()
    try:
        parsed: Any = json.loads(cleaned)
        formatted: str = json.dumps(parsed, ensure_ascii=False, indent=2)
        return _clip_mcp_log(formatted)
    except (json.JSONDecodeError, TypeError):
        return _clip_mcp_log(cleaned)

def _coerce_json_container(value: Any) -> Any:
    """将 LLM 误传的 JSON 字符串还原为 object/array。

    MCP ``callApi`` 的 ``params`` 要求 object；模型常把
    ``{"mobile":"..."}`` 再序列化成字符串，触发
    ``Expected object, received string``。
    """
    if not isinstance(value, str):
        return value
    text: str = value.strip()
    if not text or text[0] not in "{[":
        return value
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return value


# object/array 字段：校验前自动把 JSON 字符串反序列化
_JsonObject = Annotated[dict, BeforeValidator(_coerce_json_container)]
_JsonArray = Annotated[list, BeforeValidator(_coerce_json_container)]

_JSON_TYPE_MAP: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": _JsonArray,
    "object": _JsonObject,
}


def _sanitize_tool_segment(value: str) -> str:
    """将 MCP 服务器/工具名规范为 OpenHarness 工具名安全片段。

    仅保留字母、数字、下划线与连字符；若首字符非字母则加 ``mcp_`` 前缀。

    Args:
        value: 原始名称片段。

    Returns:
        可用于 ``mcp__{server}__{tool}`` 组合的合法片段。
    """
    sanitized: Any = re.sub(r"[^A-Za-z0-9_-]", "_", value)
    if not sanitized:
        return "tool"
    if not sanitized[0].isalpha():
        return f"mcp_{sanitized}"
    return sanitized


def _pydantic_field_name(json_key: str) -> str:
    """将 JSON Schema 字段名转为 Pydantic 合法属性名（不能以 _ 开头）。"""
    name: Any = re.sub(r"[^A-Za-z0-9_]", "_", json_key)
    if not name or name[0] == "_":
        name: Any = f"field_{name.lstrip('_')}" or "field"
    if name[0].isdigit():
        name: str = f"field_{name}"
    return name


def _input_model_from_schema(tool_name: str, schema: dict[str, object]) -> type[BaseModel]:
    """从 MCP JSON Schema 构建 Pydantic 输入模型，兼容 _ 开头字段名。"""
    properties: dict[str, Any] = schema.get("properties", {})
    if not isinstance(properties, dict):
        return create_model(f"{tool_name.title().replace('-', '_')}Input")

    fields: dict[str, tuple[Any, Any]] = {}
    required: set[Any] = (
        set(schema.get("required", []))
        if isinstance(schema.get("required", []), list)
        else set()
    )
    for json_key in properties:
        prop: Any = properties[json_key] if isinstance(properties[json_key], dict) else {}
        json_type: str = str(prop.get("type", "") or "")
        # anyOf / oneOf 常见于可空 object（如 identity）；按 object 处理并做字符串反序列化
        if not json_type and isinstance(prop.get("anyOf") or prop.get("oneOf"), list):
            variants: list[Any] = list(prop.get("anyOf") or prop.get("oneOf") or [])
            if any(
                isinstance(v, dict) and v.get("type") == "object" for v in variants
            ):
                json_type = "object"
        py_type: Any = _JSON_TYPE_MAP.get(json_type, object)
        attr_name: str = _pydantic_field_name(str(json_key))
        field_kwargs: dict[str, Any] = {}
        if str(json_key) != attr_name:
            field_kwargs["alias"] = str(json_key)
        if json_key in required:
            fields[attr_name] = (py_type, Field(default=..., **field_kwargs))
        else:
            fields[attr_name] = (py_type | None, Field(default=None, **field_kwargs))
    model_base: Any = type(
        "_McpToolInputBase",
        (BaseModel,),
        {"model_config": ConfigDict(populate_by_name=True)},
    )
    return create_model(
        f"{tool_name.title().replace('-', '_')}Input",
        __base__=model_base,
        **fields,
    )


class PlatformMcpToolAdapter(BaseTool):
    """MCP 工具适配器 — 修复 Pydantic v2 对 _ 开头字段名的限制。"""

    def __init__(self, manager: McpClientManager, tool_info: McpToolInfo) -> None:
        """绑定 MCP 管理器与工具元数据，生成平台侧工具名与输入模型。

        Args:
            manager: 已连接的 ``McpClientManager``。
            tool_info: MCP 工具描述（含 server、name、schema）。
        """
        self._manager = manager
        self._tool_info = tool_info
        server_segment: str = _sanitize_tool_segment(tool_info.server_name)
        tool_segment: str = _sanitize_tool_segment(tool_info.name)
        self.name = f"mcp__{server_segment}__{tool_segment}"
        self.description = tool_info.description or f"MCP tool {tool_info.name}"
        self.input_model = _input_model_from_schema(self.name, tool_info.input_schema)

    async def execute(self, arguments: BaseModel, context: ToolExecutionContext) -> ToolResult:
        """调用远端 MCP 工具并将结果或错误封装为 ``ToolResult``。

        带超时与连接失败处理；超时、未连接及未捕获异常均返回
        ``is_error=True`` 的结果，不向上抛出。

        从 ``context.metadata`` 读取平台身份，注入：
        - A: MCP tool arguments（userId / userMobile / channel / channelUserId）
        - B: HTTP Header（经 IdentityAwareAsyncClient + ContextVar）

        Args:
            arguments: 经 Pydantic 校验的工具入参。
            context: OpenHarness 执行上下文（含 tool_metadata 身份字段）。

        Returns:
            成功时为工具输出字符串；失败时 ``is_error=True``。
        """
        identity: dict[str, str] = identity_from_tool_metadata(context.metadata)
        payload: dict[str, Any] = arguments.model_dump(
            mode="json", exclude_none=True, by_alias=True
        )
        # 兜底：即便校验层漏过，仍确保 object 型字段不是 JSON 字符串
        for key, value in list(payload.items()):
            coerced: Any = _coerce_json_container(value)
            if coerced is not value:
                payload[key] = coerced
        payload = merge_identity_into_args(payload, identity)

        logger.info(
            "MCP tool call started",
            tool=self.name,
            server=self._tool_info.server_name,
            mcp_tool=self._tool_info.name,
            arguments=payload,
            identity=identity,
            identity_headers=identity_to_headers(identity) or None,
        )
        timeout: Any = get_settings().MCP_TOOL_CALL_TIMEOUT
        token = set_mcp_identity(identity)
        try:
            output: Any = await asyncio.wait_for(
                self._manager.call_tool(
                    self._tool_info.server_name,
                    self._tool_info.name,
                    payload,
                ),
                timeout=timeout,
            )
        except TimeoutError:
            message: str = (
                f"MCP 工具调用超时（{timeout}s）: "
                f"{self._tool_info.server_name}/{self._tool_info.name}"
            )
            logger.warning(
                "MCP tool call timed out",
                tool=self.name,
                server=self._tool_info.server_name,
                mcp_tool=self._tool_info.name,
                arguments=payload,
                timeout=timeout,
            )
            return ToolResult(output=message, is_error=True)
        except McpServerNotConnectedError as exc:
            logger.warning(
                "MCP tool call failed",
                tool=self.name,
                server=self._tool_info.server_name,
                mcp_tool=self._tool_info.name,
                arguments=payload,
                error=str(exc),
            )
            return ToolResult(output=str(exc), is_error=True)
        except Exception as exc:
            message: Any = str(exc).strip() or exc.__class__.__name__
            logger.warning(
                "MCP tool call failed",
                tool=self.name,
                server=self._tool_info.server_name,
                mcp_tool=self._tool_info.name,
                arguments=payload,
                error=message,
                exc_type=exc.__class__.__name__,
            )
            return ToolResult(output=message, is_error=True)
        finally:
            reset_mcp_identity(token)

        logger.info(
            "MCP tool response",
            tool=self.name,
            server=self._tool_info.server_name,
            mcp_tool=self._tool_info.name,
            arguments=payload,
            output=_format_mcp_output(output),
            output_length=len(output or ""),
        )
        return ToolResult(output=output)

    def is_read_only(self, arguments: BaseModel) -> bool:
        """MCP 工具默认视为只读，不触发写操作确认。

        Args:
            arguments: 工具入参（未用于判断）。

        Returns:
            恒为 ``True``。
        """
        return True


def _resolve_worker_catalog() -> Any | None:
    """取 Worker 目录单例（失败时返回 None → 委派工具退回静态 schema）。

    Returns:
        :class:`src.coordinator.catalog.WorkerCatalog` 或 ``None``。
    """
    try:
        from src.coordinator.catalog import get_worker_catalog

        return get_worker_catalog()
    except Exception as exc:  # noqa: BLE001 - 目录不可用不得阻断工具注册
        logger.warning("Worker catalog unavailable; using static schema", error=str(exc))
        return None


def _delegate_alias_enabled() -> bool:
    """读取双名过渡开关 ``DELEGATE_TOOL_ALIAS_ENABLED``（默认关）。

    Returns:
        开关为真时返回 True。
    """
    from src.coordinator.flags import bool_flag

    try:
        return bool_flag(get_settings(), "DELEGATE_TOOL_ALIAS_ENABLED", False)
    except Exception:  # noqa: BLE001 - 读配置失败按关闭处理
        return False


def create_agent_source_registry(mcp_manager: McpClientManager | None) -> ToolRegistry:
    """构建 Agent 可用工具源：skill + MCP（跳过 schema 不兼容的工具）。"""
    registry: ToolRegistry = ToolRegistry()
    registry.register(SkillTool())

    # 平台侧 FormFill 工具（ai-platform × MIS FormFill 引擎 P0）
    registry.register(FormFillExecuteTool())
    registry.register(FormFillApplyTool())
    # Copilot 调度：委托专用 Agent（仅 role=coordinator / allowed_tools 放开）
    # Catalog 注入后按 metadata.yaml 动态渲染 description 与 agent_id 枚举。
    catalog: Any | None = _resolve_worker_catalog()
    registry.register(InvokeAgentTool(catalog=catalog))
    if _delegate_alias_enabled():
        registry.register(InvokeAgentTool(tool_name=DELEGATE_TOOL_ALIAS, catalog=catalog))

    # mis-rag 内部知识库检索原生工具（T4/TOOL）：让 mis-rag 自行检索 + 合成，
    # 统一 A（BFF→mis-rag）与 B（Copilot→mis-rag 子 Agent）两路。仅当 mis-rag
    # runtime.yaml 的 allowed_tools 显式放行后才对 LLM 可见。
    registry.register(KbRetrieveTool())

    if mcp_manager is None:
        return registry

    for tool_info in mcp_manager.list_tools():
        try:
            registry.register(PlatformMcpToolAdapter(mcp_manager, tool_info))
        except Exception as exc:
            logger.warning(
                "Skipped MCP tool due to schema error",
                server=tool_info.server_name,
                tool=tool_info.name,
                error=str(exc),
            )
    return registry


class SafeToolWrapper(BaseTool):
    """包装工具执行，将未捕获异常转为 ToolResult 错误，避免中断 Agent 循环。"""

    def __init__(self, inner: BaseTool) -> None:
        """包装内层工具，透传名称、描述与输入模型。

        Args:
            inner: 待包装的真实 ``BaseTool`` 实现。
        """
        self._inner = inner
        self.name = inner.name
        self.description = inner.description
        self.input_model = inner.input_model

    async def execute(self, arguments: BaseModel, context: ToolExecutionContext) -> ToolResult:
        """委托内层执行，将未捕获异常转为 ``ToolResult`` 错误。

        Args:
            arguments: 工具入参。
            context: OpenHarness 执行上下文。

        Returns:
            内层成功结果，或 ``is_error=True`` 的错误描述。
        """
        try:
            return await self._inner.execute(arguments, context)
        except Exception as exc:
            logger.warning(
                "Tool execution failed (captured)",
                tool=self.name,
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )
            message: Any = str(exc).strip() or exc.__class__.__name__
            return ToolResult(output=message, is_error=True)

    def is_read_only(self, arguments: BaseModel) -> bool:
        """透传内层工具的只读判定。

        Args:
            arguments: 工具入参。

        Returns:
            内层 ``is_read_only`` 的返回值。
        """
        return self._inner.is_read_only(arguments)


# ---------------------------------------------------------------------------
# T03 fail-closed 权限闸门装配（spec §2.4）
# ---------------------------------------------------------------------------


def resolve_acl_lookup_registry(source: ToolRegistry) -> Any:
    """取 E2 判别名反查用的注册表。

    E2（MCP 工具）需要用 ``mcp-{server}-{tool}`` 判别名反查平台 Skill，
    因此优先使用 :class:`~src.skills.registry.SkillRegistry`
    （``import_from_mcp`` 正是以该判别名作为 ``skill_id`` 注册的）。

    平台尚未 bootstrap（如单测直接构建注册表）时回落到工具源注册表 —— 此时
    反查必然未命中，E2 走 ``ai:mcp:call`` 兜底码（V22 执行码），**仍是 fail-closed**。

    Args:
        source: Agent 工具源注册表（回落对象）。

    Returns:
        用于 ``registry.get(discriminant)`` 反查的对象。
    """
    try:
        from src.bootstrap.skills_mcp import get_skill_registry

        skill_registry: Any = get_skill_registry()
    except Exception as exc:  # noqa: BLE001 - 反查注册表不可用不得阻断工具装配
        logger.warning(
            "Skill registry unavailable for ACL lookup; falling back to tool source",
            error=str(exc),
        )
        return source
    return skill_registry if skill_registry is not None else source


def create_acl_guard(lookup_registry: Any | None = None) -> SkillAclGuard:
    """构造 T03 fail-closed 判权闸门。

    Args:
        lookup_registry: E2 判别名反查注册表（见 :func:`resolve_acl_lookup_registry`）。

    Returns:
        绑定进程内单例 ``MisPermissionResolver`` 的守卫。
    """
    return SkillAclGuard(get_mis_permission_resolver(), lookup_registry, get_settings())


def _wrap_tool(tool: BaseTool, guard: SkillAclGuard, lookup_registry: Any) -> BaseTool:
    """按 T03 装配铁律包装工具：``AclToolWrapper(SafeToolWrapper(tool))``。

    ``AclToolWrapper`` **必须在外层** —— 先判权、后执行，被拒的调用不进入
    任何副作用逻辑（spec §4.1 读图要点 1）。

    Args:
        tool: 工具源中的原始工具。
        guard: fail-closed 判定器。
        lookup_registry: E2 判别名反查注册表。

    Returns:
        双层包装后的工具。
    """
    return AclToolWrapper(SafeToolWrapper(tool), guard, lookup_registry)


def normalize_role(role: Any) -> str | None:
    """归一化调度角色取值。

    Args:
        role: ``AgentRole`` 枚举、字符串或 ``None``。

    Returns:
        ``"coordinator"`` / ``"worker"``；无法识别时返回 ``None``
        （= 保持既有行为，零回归）。
    """
    value: Any = getattr(role, "value", role)
    if not isinstance(value, str):
        return None
    normalized: str = value.strip().lower()
    return normalized if normalized in ("coordinator", "worker") else None


def apply_role_tool_constraint(patterns: list[str], role: Any = None) -> list[str]:
    """按调度角色对工具白名单做后置约束（纵深防御 D6 / A7 第二道闸）。

    Args:
        patterns: 已解析的 allowed_tools 模式列表。
        role: 调度角色；``None`` 表示不约束（既有行为）。

    Returns:
        约束后的模式列表：``coordinator`` 自动补齐委派工具；``worker``
        强制剔除委派工具名；``None`` 原样返回。
    """
    normalized: str | None = normalize_role(role)
    if normalized is None:
        return list(patterns)

    if normalized == "worker":
        constrained: list[str] = [
            pattern for pattern in patterns if pattern.strip() not in DELEGATE_TOOL_NAMES
        ]
        if len(constrained) != len(patterns):
            logger.info(
                "Delegation tools stripped for worker role",
                before=list(patterns),
                after=constrained,
            )
        return constrained

    constrained = list(patterns)
    if not is_tool_allowed(DELEGATE_TOOL_NAME, constrained):
        constrained.append(DELEGATE_TOOL_NAME)
    if _delegate_alias_enabled() and not is_tool_allowed(DELEGATE_TOOL_ALIAS, constrained):
        constrained.append(DELEGATE_TOOL_ALIAS)
    return constrained


def resolve_allowed_tool_patterns(
    configured: list[str],
    mcp_manager: McpClientManager | None,
    role: Any = None,
) -> list[str]:
    """
    解析 allowed_tools 配置。

    未配置时默认仅暴露 ``skill`` 与 ``mcp__*``（业务 Agent 安全默认值）。

    Args:
        configured: agent.yaml / runtime.yaml 中配置的模式列表。
        mcp_manager: 已连接的 MCP 管理器（仅用于调试日志）。
        role: 调度角色；``None``（默认）时行为与改造前完全一致。

    Returns:
        最终生效的模式列表（已应用 role 后置约束）。
    """
    if configured:
        return apply_role_tool_constraint(configured, role)
    patterns: list[str] = ["skill", "mcp__*", "formfill__*"]
    if mcp_manager is not None:
        mcp_names: list[str] = [
            f"mcp__{info.server_name}__{info.name}"
            for info in mcp_manager.list_tools()
        ]
        logger.debug("Default allowed_tools patterns", patterns=patterns, mcp_tools=mcp_names)
    return apply_role_tool_constraint(patterns, role)


def is_tool_allowed(tool_name: str, patterns: list[str]) -> bool:
    """支持精确匹配与 glob（如 ``mcp__*``）。"""
    for pattern in patterns:
        if fnmatch.fnmatch(tool_name, pattern):
            return True
    return False


def create_platform_tool_registry(
    mcp_manager: McpClientManager | None,
    allowed_tools: list[str] | None = None,
    role: Any = None,
) -> ToolRegistry:
    """
    从 OpenHarness 默认工具集按 allowed_tools 过滤，并包装为安全执行。

    Args:
        mcp_manager: 已连接的 MCP 管理器。
        allowed_tools: agent.yaml / runtime.yaml 中的工具白名单；空则使用平台默认。
        role: 调度角色（``coordinator`` / ``worker``）；``None`` 时行为与改造前
            完全一致。``worker`` 会在模式过滤之外再做一次委派工具剔除，
            确保 YAML 写了通配符（如 ``*``）也不会越权拿到 ``agent__invoke``。
    """
    patterns: list[str] = resolve_allowed_tool_patterns(
        allowed_tools or [], mcp_manager, role
    )
    source: ToolRegistry = create_agent_source_registry(mcp_manager)
    is_worker: bool = normalize_role(role) == "worker"

    # T03 §2.4：每个工具在执行前先过 fail-closed 权限闸门。
    acl_lookup: Any = resolve_acl_lookup_registry(source)
    guard: SkillAclGuard = create_acl_guard(acl_lookup)

    registry: ToolRegistry = ToolRegistry()
    registered: list[str] = []
    for tool in source.list_tools():
        if is_worker and tool.name in DELEGATE_TOOL_NAMES:
            logger.info("Delegation tool denied for worker role", tool=tool.name)
            continue
        if not is_tool_allowed(tool.name, patterns):
            continue
        registry.register(_wrap_tool(tool, guard, acl_lookup))
        registered.append(tool.name)

    if not registered:
        logger.warning(
            "No tools matched allowed_tools; falling back to skill only",
            patterns=patterns,
        )
        skill_tool: BaseTool | None = source.get("skill")
        if skill_tool is not None:
            registry.register(_wrap_tool(skill_tool, guard, acl_lookup))
            registered.append(skill_tool.name)

    logger.info(
        "Platform tool registry built",
        allowed_patterns=patterns,
        tools=registered,
        acl_enabled=bool(getattr(get_settings(), "MIS_ACL_ENABLED", True)),
    )
    return registry
