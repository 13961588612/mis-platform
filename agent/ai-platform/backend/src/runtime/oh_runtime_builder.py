"""根据平台的 AgentConfig 构建原生 OpenHarness QueryEngine。"""

from __future__ import annotations
from typing import Any

import asyncio
import shutil
from contextlib import AsyncExitStack
from pathlib import Path
from types import MethodType

from mcp.client.streamable_http import streamable_http_client
from openharness.config.settings import PermissionSettings, load_settings
from openharness.engine.query_engine import QueryEngine
from openharness.mcp.client import McpClientManager
from openharness.mcp.types import McpHttpServerConfig, McpServerConfig, McpStdioServerConfig
from openharness.permissions.checker import PermissionChecker
from openharness.permissions.modes import PermissionMode
from openharness.prompts import build_runtime_system_prompt
from openharness.tools.base import ToolRegistry

from src.agent.config import AgentConfig, MCPServerConfig
from src.config import get_settings
from src.runtime.gateway_api_client import GatewayApiClient
from src.runtime.mcp_identity import IdentityAwareAsyncClient, build_mcp_identity
from src.runtime.tool_registry_builder import (
    apply_role_tool_constraint,
    create_agent_source_registry,
    create_platform_tool_registry,
    is_tool_allowed,
)
from src.skills.spec_parser import read_skill_metadata, resolve_skill_id
from src.utils.logging import get_logger

logger = get_logger("runtime.oh_builder")


def agent_mcp_to_openharness_configs(
    mcp_servers: list[MCPServerConfig],
) -> dict[str, McpServerConfig]:
    """将平台的 mcp-servers.yaml 条目映射为 OpenHarness MCP 配置模型。"""
    configs: dict[str, McpServerConfig] = {}
    for server in mcp_servers:
        if not server.enabled:
            continue
        transport: str = server.transport.strip().lower()
        if transport in {"http", "streamable_http", "streamable-http", "sse"}:
            if not server.endpoint:
                logger.warning("MCP server missing endpoint", name=server.name)
                continue
            configs[server.name] = McpHttpServerConfig(
                url=server.endpoint,
                headers={},
            )
        elif transport == "stdio":
            command: Any = server.command or server.endpoint
            if not command:
                logger.warning("MCP stdio server missing command", name=server.name)
                continue
            configs[server.name] = McpStdioServerConfig(
                command=command,
                args=list(server.args),
                env=dict(server.env) or None,
            )
    return configs


def enabled_package_skill_ids(config: AgentConfig) -> list[str]:
    """本 Agent 已启用、且非 MCP 判别名的正式 skill_id（稳定排序）。

    ``enabled-skills.yaml`` 里可能混有 ``mcp-…`` 判别名；那些不走 ``skill`` 工具
    加载包，故排除，避免污染提示词 / 工具枚举。
    """
    ids: list[str] = []
    seen: set[str] = set()
    for ref in config.skills:
        if not getattr(ref, "enabled", True):
            continue
        skill_id: str = str(getattr(ref, "skill_id", "") or "").strip()
        if not skill_id or skill_id.startswith("mcp-") or skill_id in seen:
            continue
        seen.add(skill_id)
        ids.append(skill_id)
    return sorted(ids)


def _find_package_skill_mds(
    packages_root: Path, enabled_ids: set[str]
) -> dict[str, Path]:
    """扫描 packages，返回 ``skill_id -> SKILL.md``（仅启用集）。"""
    found: dict[str, Path] = {}
    if not packages_root.is_dir() or not enabled_ids:
        return found
    for skill_md in packages_root.rglob("SKILL.md"):
        metadata: dict[str, Any]
        _: str
        metadata, _ = read_skill_metadata(skill_md)
        skill_id: str = resolve_skill_id(metadata, skill_md.parent.name)
        if skill_id in enabled_ids and skill_id not in found:
            found[skill_id] = skill_md
    return found


def _link_or_copy_skill_md(src: Path, dst: Path) -> None:
    """把真实 SKILL.md 挂到以正式 skill_id 命名的视图目录下。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    try:
        dst.symlink_to(src.resolve(), target_is_directory=False)
    except OSError:
        shutil.copy2(src, dst)


def materialize_oh_skill_view(
    config: AgentConfig, config_base: Path
) -> tuple[list[str], list[str]]:
    """物化「目录名 = 正式 skill_id」的 OH 技能视图。

    OpenHarness ``Available Skills`` 用 ``command_name``（= 父目录名）作粗体主名。
    旧实现把整类 ``packages/crm`` 塞进去，主名变成 ``member-points-account``，
    模型易缩写成 ``member``。此处只挂**本 Agent 启用**的技能，且目录名强制为
    正式 ``skill_id``。

    Returns:
        ``(extra_skill_dirs, exposed_skill_ids)``；无启用包技能时两者皆空。
    """
    enabled_ids: list[str] = enabled_package_skill_ids(config)
    if not enabled_ids:
        return [], []

    packages_root: Path = config_base / "skills" / "packages"
    found: dict[str, Path] = _find_package_skill_mds(packages_root, set(enabled_ids))
    if not found:
        logger.warning(
            "No package SKILL.md matched enabled skill_ids",
            agent_id=config.agent_id,
            enabled=enabled_ids,
        )
        return [], []

    staging: Path = (
        config_base / ".runtime" / "oh-skills" / (config.agent_id or "_default")
    ).resolve()
    staging.mkdir(parents=True, exist_ok=True)

    # 清理已停用残留，避免提示词继续列出旧 id
    keep: set[str] = set(found)
    for child in list(staging.iterdir()):
        if child.is_dir() and child.name not in keep:
            shutil.rmtree(child, ignore_errors=True)

    exposed: list[str] = []
    for skill_id, skill_md in sorted(found.items()):
        view_md: Path = staging / skill_id / "SKILL.md"
        try:
            _link_or_copy_skill_md(skill_md, view_md)
            exposed.append(skill_id)
        except OSError as exc:
            logger.warning(
                "Failed to materialize OH skill view",
                skill_id=skill_id,
                error=str(exc),
            )

    if not exposed:
        return [], []
    return [str(staging)], exposed


def resolve_extra_skill_dirs(config: AgentConfig, config_base: Path) -> list[str]:
    """
    根据已启用的 agent skills 解析 OpenHarness 的 extra_skill_dirs。

    OpenHarness 期望 ``<extra_skill_dir>/<skill-name>/SKILL.md``；
    此处 ``skill-name`` **等于正式 skill_id**（见 :func:`materialize_oh_skill_view`）。
    """
    dirs, _exposed = materialize_oh_skill_view(config, config_base)
    return dirs


def build_formal_skill_ids_prompt(skill_ids: list[str]) -> str:
    """追加到系统提示：强制只用正式 skill_id 调 ``skill`` 工具。"""
    if not skill_ids:
        return ""
    lines: list[str] = [
        "# Formal Skill IDs",
        "",
        "调用 `skill` 工具时，`name` **必须**是下列正式 skill_id 之一"
        "（与授权页 / 技能池一致）。禁止缩写、目录名或臆造 id"
        "（错误示例：`member`、`member-profile`）。",
        "",
    ]
    for skill_id in skill_ids:
        lines.append(f"- `{skill_id}`")
    return "\n".join(lines)


async def _connect_http_with_identity(
    self: McpClientManager,
    name: str,
    config: McpHttpServerConfig,
) -> None:
    """与 OpenHarness ``_connect_http`` 等价，但使用可注入身份 Header 的 HTTP 客户端。"""
    stack: AsyncExitStack = AsyncExitStack()
    try:
        http_client: IdentityAwareAsyncClient = await stack.enter_async_context(
            IdentityAwareAsyncClient(headers=config.headers or None)
        )
        read_stream: Any
        write_stream: Any
        read_stream, write_stream, _get_session_id = await stack.enter_async_context(
            streamable_http_client(config.url, http_client=http_client)
        )
        await self._register_connected_session(
            name=name,
            config=config,
            stack=stack,
            read_stream=read_stream,
            write_stream=write_stream,
            auth_configured=bool(config.headers),
        )
    except asyncio.CancelledError as exc:
        await self._close_failed_stack(stack)
        self._mark_connection_failed(
            name,
            config,
            auth_configured=bool(config.headers),
            exc=exc,
        )
    except Exception as exc:
        await self._close_failed_stack(stack)
        self._mark_connection_failed(
            name,
            config,
            auth_configured=bool(config.headers),
            exc=exc,
        )


async def connect_mcp_manager(config: AgentConfig) -> McpClientManager:
    """根据 agent config 创建并连接 OpenHarness MCP 管理器。"""
    mcp_configs: dict[str, McpServerConfig] = agent_mcp_to_openharness_configs(config.mcp_servers)
    mcp_manager: McpClientManager = McpClientManager(mcp_configs)
    # 替换 HTTP 连接实现，使后续 call_tool 的 HTTP POST 能带上身份 Header
    mcp_manager._connect_http = MethodType(_connect_http_with_identity, mcp_manager)  # type: ignore[method-assign]
    await mcp_manager.connect_all()
    return mcp_manager


async def build_native_query_engine(
    config: AgentConfig,
    gateway: Any,
    mcp_manager: McpClientManager,
    *,
    session_id: str = "",
    user_id: str = "",
    user_mobile: str = "",
    channel: str = "",
    channel_user_id: str = "",
    mis_user_id: int | None = None,
    dept: str = "",
) -> QueryEngine:
    """使用原生 SkillTool + MCP 工具组装 OpenHarness QueryEngine。

    Args:
        config: Agent 配置。
        gateway: LLM 网关。
        mcp_manager: 已连接的 MCP 管理器。
        session_id: 会话 ID。
        user_id: 平台用户 ID。
        user_mobile: 用户手机号。
        channel: 接入渠道。
        channel_user_id: 渠道侧 userId。
        mis_user_id: MIS userId（T03 S9 第 4 跳）；写入 ``tool_metadata["identity"]``
            的 ``misUserId`` 键，是 E1–E5 判权的唯一身份来源。
        dept: 部门标识（透传给 Gateway 计费/审计）。

    Returns:
        已装配工具注册表与身份元数据的 ``QueryEngine``。
    """
    settings: Any = load_settings()
    config_base: Path = Path(get_settings().CONFIG_BASE_PATH)
    cwd: str = str(config_base.resolve())
    extra_skill_dirs, exposed_skill_ids = materialize_oh_skill_view(config, config_base)

    mcp_configs: dict[str, McpServerConfig] = agent_mcp_to_openharness_configs(config.mcp_servers)
    allowed_tools: Any = config.runtime.allowed_tools if config.runtime else []
    # 调度角色（C3）：coordinator 自动补齐委派工具，worker 强制剔除；
    # 未配置 role 的旧配置解析为默认值，行为与改造前一致。
    agent_role: Any = getattr(config, "role", None)
    source_registry: ToolRegistry = create_agent_source_registry(
        mcp_manager, allowed_skill_ids=exposed_skill_ids
    )
    allowed_patterns: Any = apply_role_tool_constraint(
        allowed_tools or ["skill", "mcp__*"], agent_role
    )
    concrete_allowed: list[Any] = [
        tool.name
        for tool in source_registry.list_tools()
        if is_tool_allowed(tool.name, allowed_patterns)
    ]
    settings.permission = PermissionSettings(
        mode=PermissionMode.FULL_AUTO,
        allowed_tools=concrete_allowed,
    )
    tool_registry: ToolRegistry = create_platform_tool_registry(
        mcp_manager,
        allowed_tools,
        agent_role,
        config.agent_id,
        allowed_skill_ids=exposed_skill_ids,
    )

    model: Any = config.model.primary if config.model else "qwen3.7-plus"
    runtime_params: Any = config.runtime.params if config.runtime else {}
    max_tokens: int = int(runtime_params.get("maxTokens", 4096))
    max_steps: int = int(runtime_params.get("maxSteps", 20))
    temperature: float = float(runtime_params.get("temperature", 0.7))

    oh_system_prompt: Any = build_runtime_system_prompt(
        settings,
        cwd=cwd,
        extra_skill_dirs=extra_skill_dirs,
        include_project_memory=False,
    )
    agent_prompt: Any = config.system_prompt or ""
    if config.runtime and config.runtime.prompts.get("system_prompt"):
        agent_prompt: Any = config.runtime.prompts["system_prompt"]
    formal_ids_prompt: str = build_formal_skill_ids_prompt(exposed_skill_ids)
    system_prompt: str = "\n\n".join(
        part
        for part in (agent_prompt, formal_ids_prompt, oh_system_prompt)
        if part
    ).strip()

    api_client: GatewayApiClient = GatewayApiClient(
        gateway,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        session_id=session_id,
        user_id=user_id,
        dept=dept,
    )

    mcp_identity: dict[str, str] = build_mcp_identity(
        user_id=user_id,
        user_mobile=user_mobile,
        channel=channel,
        channel_user_id=channel_user_id,
        mis_user_id=mis_user_id,
    )
    engine: QueryEngine = QueryEngine(
        api_client=api_client,
        tool_registry=tool_registry,
        permission_checker=PermissionChecker(settings.permission),
        cwd=cwd,
        model=model,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        max_turns=max_steps,
        tool_metadata={
            "extra_skill_dirs": extra_skill_dirs,
            "session_id": session_id,
            "identity": mcp_identity,
        },
    )

    logger.info(
        "Native OpenHarness QueryEngine built",
        model=model,
        max_turns=max_steps,
        skill_dirs=extra_skill_dirs,
        mcp_servers=list(mcp_configs.keys()),
        tools=[tool.name for tool in tool_registry.list_tools()],
    )
    return engine
