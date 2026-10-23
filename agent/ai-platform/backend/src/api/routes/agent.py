"""Agent API 路由 — CRUD 操作与生命周期管理。

端点：
- POST   /api/v1/agents              — 创建新 Agent
- GET    /api/v1/agents              — 列出所有 Agent
- GET    /api/v1/agents/{agent_id}   — 获取 Agent 详情
- PUT    /api/v1/agents/{agent_id}   — 更新 Agent 配置
- DELETE /api/v1/agents/{agent_id}   — 删除 Agent
- POST   /api/v1/agents/{agent_id}/start   — 启动 Agent
- POST   /api/v1/agents/{agent_id}/pause   — 暂停 Agent
- POST   /api/v1/agents/{agent_id}/resume  — 恢复 Agent
- POST   /api/v1/agents/{agent_id}/stop    — 停止 Agent
- GET    /api/v1/agents/{agent_id}/health  — 检查 Agent 健康状态
- POST   /api/v1/agents/{agent_id}/runtime — 切换运行时
"""

from __future__ import annotations
from typing import Any


from fastapi import APIRouter, Depends, status
from pathlib import Path
from pydantic import BaseModel, Field

import yaml

from src.agent.config import AgentConfig, AgentRole
from src.agent.manager import AgentManager
from src.api.deps import get_agent_manager_dep, get_config_manager_dep, get_current_user
from src.api.response import error_response, success
from src.config_manager.file_service import agent_dir
from src.config_manager.manager import ConfigManager
from src.coordinator.coordination_service import (
    AgentCoordination,
    read_coordination,
    write_coordination,
)
from src.skills.models import SkillStatus
from src.utils.exceptions import (
    AgentAlreadyExistsError,
    AgentNotFoundError,
    AgentStateError,
    ConfigValidationError,
)
from src.utils.logging import get_logger

logger = get_logger("api.routes.agent")

router = APIRouter(prefix="/agents", tags=["agents"])


# ===== 请求/响应模型 =====


class CreateAgentRequest(BaseModel):
    """创建新 Agent 的请求体。"""

    agent_id: str = Field(..., description="Agent ID（必须唯一）")
    display_name: str = Field(..., description="显示名称")
    description: str = Field(default="")
    version: str = Field(default="1.0.0")
    tags: list[str] = Field(default_factory=list)
    runtime_type: str = Field(default="openharness")
    model_primary: str = Field(default="deepseek-v4-flash")
    model_fallback: str = Field(default="qwen3.7-plus")
    keywords: list[str] = Field(default_factory=list)
    routing_enabled: bool = True
    routing_priority: int = 10


class UpdateAgentRequest(BaseModel):
    """更新 Agent 配置的请求体。"""

    display_name: str | None = None
    description: str | None = None
    version: str | None = None
    tags: list[str] | None = None
    keywords: list[str] | None = None
    routing_enabled: bool | None = None
    routing_priority: int | None = None


class SwitchRuntimeRequest(BaseModel):
    """切换 Agent 运行时的请求体。"""

    runtime_type: str = Field(..., description="新的运行时类型：openharness | custom | langgraph")


class AgentSummary(BaseModel):
    """列表响应中的 Agent 配置摘要（含本机运行位 / 租约标记）。"""

    agent_id: str
    display_name: str
    state: str
    runtime_type: str
    active_sessions: int
    is_active: bool
    role: str = Field(
        default=AgentRole.WORKER.value,
        description="调度角色：coordinator（可委派）/ worker（不可再委派）",
    )
    #: 是否已装入本进程 ``AgentManager._instances``。
    in_process: bool = False
    #: Redis ``aip:agent:{id}:owner`` 当前持有者 coreId；无键 / 未启租约为 ``None``。
    lease_owner: str | None = None
    #: 租约是否由本机 CORE_ID 持有。
    lease_held_locally: bool = False
    #: 本机 CORE_ID；未注入多 Core 租约时为 ``None``。
    core_id: str | None = None


class AgentDetail(BaseModel):
    """Agent 详细信息。"""

    agent_id: str
    display_name: str
    description: str
    version: str
    tags: list[str]
    state: str
    runtime_type: str
    active_sessions: int
    model_primary: str
    model_fallback: str
    routing_enabled: bool
    routing_priority: int
    routing_keywords: list[str]
    started_at: str | None = None


# ===== 内部工具 =====


def _resolve_role_value(config: Any) -> str:
    """从 AgentConfig 取出调度角色的字符串值（C4：/agents 暴露 role）。

    Args:
        config: Agent 实例的配置对象（通常为 :class:`AgentConfig`）。

    Returns:
        ``"coordinator"`` 或 ``"worker"``；无法识别时回落为 ``"worker"``，
        保证 `/agents` 响应始终携带合法 role，不破坏既有序列化。
    """
    raw: Any = getattr(config, "role", None)
    if isinstance(raw, AgentRole):
        return raw.value
    if isinstance(raw, str):
        normalized: str = raw.strip().lower()
        for role in AgentRole:
            if role.value == normalized:
                return role.value
    return AgentRole.WORKER.value


def _local_core_id(agent_manager: AgentManager) -> str | None:
    """本机 CORE_ID；未 bind_core 时返回 ``None``。"""
    raw: Any = getattr(agent_manager, "_core_id", None) or ""
    text: str = str(raw).strip()
    return text or None


async def _lease_owner_safe(agent_manager: AgentManager, agent_id: str) -> str | None:
    """读取 Redis 租约 owner；无 ownership / 读失败时返回 ``None``（不拖垮列表）。"""
    ownership: Any = getattr(agent_manager, "_core_ownership", None)
    if ownership is None:
        return None
    try:
        owner: Any = await ownership.current_owner(agent_id)
    except Exception as exc:  # noqa: BLE001 - 列表 enrichment 不得因 Redis 抖动 500
        logger.debug(
            "lease owner lookup failed",
            agent_id=agent_id,
            error=str(exc),
        )
        return None
    if owner is None:
        return None
    text: str = str(owner).strip()
    return text or None


def _summary_from_config(
    config: AgentConfig,
    *,
    instance: Any | None,
    lease_owner: str | None,
    core_id: str | None,
) -> AgentSummary:
    """把本地配置 + 可选运行时实例拼成列表摘要。"""
    in_process: bool = instance is not None
    if in_process:
        state: str = instance.lifecycle.current_state.value
        active_sessions: int = int(getattr(instance, "active_sessions", 0) or 0)
        is_active: bool = bool(instance.lifecycle.is_active())
    else:
        state = "stopped"
        active_sessions = 0
        is_active = False

    runtime_type: str = "openharness"
    if config.runtime is not None and getattr(config.runtime, "type", None):
        runtime_type = str(config.runtime.type)

    return AgentSummary(
        agent_id=config.agent_id,
        display_name=config.display_name or config.agent_id,
        state=state,
        runtime_type=runtime_type,
        active_sessions=active_sessions,
        is_active=is_active,
        role=_resolve_role_value(config),
        in_process=in_process,
        lease_owner=lease_owner,
        lease_held_locally=bool(lease_owner and core_id and lease_owner == core_id),
        core_id=core_id,
    )


# ===== 端点 =====


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_agent(
    req: CreateAgentRequest,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    config_manager: ConfigManager = Depends(get_config_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """创建新 Agent 实例。"""
    try:
        # 从请求构建 AgentConfig
        from src.agent.config import (
            ModelConfig,
            RoutingConfig,
            RuntimeConfig,
        )

        config: AgentConfig = AgentConfig(
            agent_id=req.agent_id,
            name=req.agent_id,
            display_name=req.display_name,
            description=req.description,
            version=req.version,
            tags=req.tags,
            runtime=RuntimeConfig(type=req.runtime_type),
            model=ModelConfig(primary=req.model_primary, fallback=req.model_fallback),
            routing=RoutingConfig(
                keywords=req.keywords,
                enabled=req.routing_enabled,
                priority=req.routing_priority,
            ),
        )

        # 保存配置
        await config_manager.save_config(config)

        # 创建 agent 实例
        instance: dict[str, Any] = await agent_manager.create_agent(config)

        return success(
            data={"agent_id": req.agent_id, "state": instance.lifecycle.current_state.value},
            message="Agent created successfully",
        )
    except AgentAlreadyExistsError as exc:
        return error_response(exc.code, exc.message, status.HTTP_409_CONFLICT)
    except ConfigValidationError as exc:
        return error_response(exc.code, exc.message, status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.error("Failed to create agent", error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("")
async def list_agents(
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    config_manager: ConfigManager = Depends(get_config_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """列出本地配置目录中的全部 Agent，并标注本机内存 / Redis 租约。

    行集合以 ``ConfigManager.list_configs()`` 为准（磁盘已加载配置），
    不再仅暴露本进程已 claim 并装入 ``_instances`` 的子集。
    """
    del user  # 鉴权由 Depends 完成；列表本身不按用户过滤
    configs: list[AgentConfig] = sorted(
        config_manager.list_configs(),
        key=lambda c: c.agent_id,
    )
    instances_by_id: dict[str, Any] = {
        inst.id: inst for inst in agent_manager.list_agents()
    }
    core_id: str | None = _local_core_id(agent_manager)

    summaries: list[dict[str, Any]] = []
    for config in configs:
        lease_owner: str | None = await _lease_owner_safe(agent_manager, config.agent_id)
        summary: AgentSummary = _summary_from_config(
            config,
            instance=instances_by_id.get(config.agent_id),
            lease_owner=lease_owner,
            core_id=core_id,
        )
        summaries.append(summary.model_dump())
    return success(data=summaries)


@router.get("/{agent_id}")
async def get_agent(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """获取指定 Agent 的详细信息。"""
    try:
        instance: dict[str, Any] = agent_manager.get_agent(agent_id)
        config: Any = instance.config
        detail: AgentDetail = AgentDetail(
            agent_id=config.agent_id,
            display_name=config.display_name,
            description=config.description,
            version=config.version,
            tags=config.tags,
            state=instance.lifecycle.current_state.value,
            runtime_type=config.runtime.type,
            active_sessions=instance.active_sessions,
            model_primary=config.model.primary,
            model_fallback=config.model.fallback,
            routing_enabled=config.routing.enabled,
            routing_priority=config.routing.priority,
            routing_keywords=config.routing.keywords,
            started_at=instance.started_at.isoformat() if instance.started_at else None,
        )
        return success(data=detail.model_dump())
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)


@router.put("/{agent_id}")
async def update_agent(
    agent_id: str,
    req: UpdateAgentRequest,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    config_manager: ConfigManager = Depends(get_config_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """更新 Agent 配置（热重载）。"""
    try:
        instance: dict[str, Any] = agent_manager.get_agent(agent_id)
        config: Any = instance.config

        # 应用更新
        if req.display_name is not None:
            config.display_name = req.display_name
        if req.description is not None:
            config.description = req.description
        if req.version is not None:
            config.version = req.version
        if req.tags is not None:
            config.tags = req.tags
        if req.keywords is not None:
            config.routing.keywords = req.keywords
        if req.routing_enabled is not None:
            config.routing.enabled = req.routing_enabled
        if req.routing_priority is not None:
            config.routing.priority = req.routing_priority

        # 保存并热重载
        await config_manager.save_config(config)
        await agent_manager.update_config(agent_id, config)

        return success(message="Agent updated successfully")
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except ConfigValidationError as exc:
        return error_response(exc.code, exc.message, status.HTTP_400_BAD_REQUEST)


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    config_manager: ConfigManager = Depends(get_config_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """删除 Agent 实例及其配置。"""
    try:
        await agent_manager.delete_agent(agent_id)
        await config_manager.delete_config(agent_id)
        return success(message="Agent deleted successfully")
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)


@router.post("/{agent_id}/start")
async def start_agent(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """启动 Agent 实例。"""
    try:
        state: dict[str, Any] = await agent_manager.start_agent(agent_id)
        return success(
            data={"agent_id": agent_id, "state": state.value},
            message="Agent started",
        )
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except AgentStateError as exc:
        return error_response(exc.code, exc.message, status.HTTP_409_CONFLICT)


@router.post("/{agent_id}/pause")
async def pause_agent(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """暂停正在运行的 Agent 实例。"""
    try:
        state: dict[str, Any] = await agent_manager.pause_agent(agent_id)
        return success(
            data={"agent_id": agent_id, "state": state.value},
            message="Agent paused",
        )
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except AgentStateError as exc:
        return error_response(exc.code, exc.message, status.HTTP_409_CONFLICT)


@router.post("/{agent_id}/resume")
async def resume_agent(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """恢复已暂停的 Agent 实例。"""
    try:
        state: dict[str, Any] = await agent_manager.resume_agent(agent_id)
        return success(
            data={"agent_id": agent_id, "state": state.value},
            message="Agent resumed",
        )
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except AgentStateError as exc:
        return error_response(exc.code, exc.message, status.HTTP_409_CONFLICT)


@router.post("/{agent_id}/stop")
async def stop_agent(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """停止 Agent 实例。"""
    try:
        state: dict[str, Any] = await agent_manager.stop_agent(agent_id)
        return success(
            data={"agent_id": agent_id, "state": state.value},
            message="Agent stopped",
        )
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)


@router.get("/{agent_id}/health")
async def get_agent_health(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """检查指定 Agent 的健康状态。"""
    try:
        health: dict[str, Any] = await agent_manager.get_agent_health(agent_id)
        return success(data=health.model_dump())
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)


@router.post("/{agent_id}/runtime")
async def switch_runtime(
    agent_id: str,
    req: SwitchRuntimeRequest,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """将 Agent 切换到不同的运行时类型。"""
    try:
        await agent_manager.switch_runtime(agent_id, req.runtime_type)
        return success(
            data={"agent_id": agent_id, "runtime_type": req.runtime_type},
            message="Runtime switched successfully",
        )
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except AgentStateError as exc:
        return error_response(exc.code, exc.message, status.HTTP_409_CONFLICT)


# ===== O1c：Agent 技能绑定（UI#5） =====


class PutSkillsRequest(BaseModel):
    """更新 Agent 启用技能的请求体。"""

    skill_ids: list[str] = Field(default_factory=list, description="要绑定的技能 ID 列表")


class SkillPoolItem(BaseModel):
    """技能池中的可选技能。"""

    skill_id: str
    name: str
    description: str = ""
    category: str = ""
    status: str = ""
    enabled: bool = False


def _read_yaml_file(path: Path) -> dict[str, Any]:
    """读取 YAML 文件（不存在 / 解析失败返回 ``{}``）。"""
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except yaml.YAMLError:
        return {}


def _write_yaml_file(path: Path, data: dict[str, Any]) -> None:
    """写 YAML 文件（保 Unicode，不排序键）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _agent_config_exists(agent_id: str) -> bool:
    """Agent 配置目录是否存在（不要求运行时实例已启动）。"""
    return (agent_dir(agent_id) / "agent.yaml").is_file()


def _enabled_skills_path(agent_id: str) -> Path:
    return agent_dir(agent_id) / "skills" / "enabled-skills.yaml"


def _read_enabled_skill_ids(agent_id: str) -> list[str]:
    """从 ``skills/enabled-skills.yaml`` 读取启用技能 ID（磁盘为绑定真值源）。

    运营台保存后若热重载失败，内存 ``instance.config.skills`` 可能仍是旧值；
    GET 必须读盘，否则「保存成功 → 离开再进 → 绑定未增加」。
    """
    raw: dict[str, Any] = _read_yaml_file(_enabled_skills_path(agent_id))
    skills_section: Any = raw.get("skills", raw) if isinstance(raw, dict) else {}
    if not isinstance(skills_section, dict):
        return []
    enabled: Any = skills_section.get("enabled", [])
    if not isinstance(enabled, list):
        return []
    out: list[str] = []
    for item in enabled:
        if isinstance(item, str):
            sid = item.strip()
            if sid:
                out.append(sid)
            continue
        if isinstance(item, dict) and item.get("skill_id") and item.get("enabled", True):
            sid = str(item["skill_id"]).strip()
            if sid:
                out.append(sid)
    return out


def _sync_instance_skills(agent_manager: AgentManager, agent_id: str, skill_ids: list[str]) -> None:
    """尽最大努力把运行中实例的 ``config.skills`` 与磁盘对齐（热重载失败时的兜底）。"""
    from src.agent.config import SkillRef

    if not agent_manager.has_instance(agent_id):
        return
    try:
        instance: Any = agent_manager.get_agent(agent_id)
        config: Any = getattr(instance, "config", None)
        if config is None:
            return
        config.skills = [SkillRef(skill_id=sid, enabled=True) for sid in skill_ids]
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "update_agent_skills: sync instance skills skipped",
            agent_id=agent_id,
            error=str(exc),
        )


@router.get("/{agent_id}/skills")
async def get_agent_skills(
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """获取 Agent 当前启用技能 + 池内可选集（仅 status=active）。

    启用列表以 ``enabled-skills.yaml`` 为准；不要求 Agent 正在运行。
    """
    if not _agent_config_exists(agent_id):
        # 兼容：配置文件缺失时仍尝试运行中实例（测试 stub / 特殊部署）
        try:
            agent_manager.get_agent(agent_id)
        except AgentNotFoundError as exc:
            return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)

    enabled_ids: list[str] = _read_enabled_skill_ids(agent_id)

    pool: list[SkillPoolItem] = []
    seen: set[str] = set()
    from src.bootstrap.skills_mcp import get_skill_registry

    registry = get_skill_registry()
    if registry is not None:
        # 含 MCP discover 注册的技能；用 list_all 避免仅 active 时漏展示
        for skill in registry.list_all():
            status_val: str = (
                skill.status.value if hasattr(skill.status, "value") else str(skill.status)
            )
            pool.append(
                SkillPoolItem(
                    skill_id=skill.skill_id,
                    name=skill.name,
                    description=skill.description,
                    category=str(skill.category),
                    status=status_val,
                    enabled=skill.skill_id in enabled_ids,
                )
            )
            seen.add(skill.skill_id)

    # 已绑定但不在注册表：常见于 MCP 动态发现后进程重启未再「发现」
    for sid in enabled_ids:
        if sid in seen:
            continue
        is_mcp = sid.startswith("mcp-")
        tool_name = sid.rsplit("-", 1)[-1] if is_mcp else sid
        pool.append(
            SkillPoolItem(
                skill_id=sid,
                name=tool_name,
                description=(
                    "MCP 工具未加载到技能注册表，请到「MCP 管理」重新「发现」后再绑定"
                    if is_mcp
                    else "技能未在注册表中，可能已删除或未同步"
                ),
                category="mcp" if is_mcp else "",
                status="missing",
                enabled=True,
            )
        )

    return success(
        data={
            "agent_id": agent_id,
            "enabled_skill_ids": enabled_ids,
            "pool": [p.model_dump() for p in pool],
        }
    )


@router.put("/{agent_id}/skills")
async def update_agent_skills(
    req: PutSkillsRequest,
    agent_id: str,
    agent_manager: AgentManager = Depends(get_agent_manager_dep),
    config_manager: ConfigManager = Depends(get_config_manager_dep),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """更新 Agent 绑定的技能（持久化到 skills/enabled-skills.yaml + 热更新）。

    以磁盘写入为准；Agent 未启动也可保存。热重载失败时仍返回已落盘的 ID，
    并尝试直接改写运行中实例的 ``config.skills``。
    """
    if not _agent_config_exists(agent_id):
        try:
            agent_manager.get_agent(agent_id)
        except AgentNotFoundError as exc:
            return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)

    # 校验：所有请求的技能必须在池内且 status=active
    from src.bootstrap.skills_mcp import get_skill_registry

    registry = get_skill_registry()
    if registry is not None:
        for sid in req.skill_ids:
            skill = registry.get(sid)
            if skill is None or skill.status != SkillStatus.ACTIVE:
                return error_response(
                    7001,
                    f"skill is not available for binding: {sid}",
                    status.HTTP_400_BAD_REQUEST,
                )

    # 写回 enabled-skills.yaml（保留 custom_skills_dir / overrides_dir）
    path: Path = _enabled_skills_path(agent_id)
    existing: dict[str, Any] = _read_yaml_file(path)
    skills_section: dict[str, Any] = existing.get("skills", {}) if isinstance(existing, dict) else {}
    if not isinstance(skills_section, dict):
        skills_section = {}
    # 去重且保序，避免重复 ID 污染
    deduped: list[str] = list(dict.fromkeys(sid.strip() for sid in req.skill_ids if sid and sid.strip()))
    skills_section["enabled"] = deduped
    if "custom_skills_dir" not in skills_section:
        skills_section["custom_skills_dir"] = "skills/custom-skills/"
    if "overrides_dir" not in skills_section:
        skills_section["overrides_dir"] = "skills/skill-overrides/"
    _write_yaml_file(path, {"skills": skills_section})

    # 触发配置热更新链路（含 WorkerCatalog 刷新）
    reload_ok = True
    reload_warning: str | None = None
    try:
        reloaded, runtime_error = await config_manager.reload_agent(agent_id)
        if runtime_error:
            reload_ok = False
            reload_warning = (
                f"{runtime_error}。绑定已写入配置，新会话或重启 Agent 后生效。"
            )
        elif reloaded is None and _agent_config_exists(agent_id):
            reload_ok = False
            reload_warning = "配置热重载失败：未能重新加载 Agent。绑定已写入配置，新会话或重启后生效。"
    except Exception as exc:  # noqa: BLE001
        reload_ok = False
        reload_warning = f"配置热重载异常：{exc}。绑定已写入配置，新会话或重启 Agent 后生效。"
        logger.warning("update_agent_skills: reload_agent failed", agent_id=agent_id, error=str(exc))

    persisted: list[str] = _read_enabled_skill_ids(agent_id)
    _sync_instance_skills(agent_manager, agent_id, persisted)

    return success(
        data={
            "agent_id": agent_id,
            "enabled_skill_ids": persisted,
            "reload_ok": reload_ok,
            "reload_warning": reload_warning,
        },
        message="Agent skills updated" if reload_ok else "Agent skills saved with reload warning",
    )


# ===== O1g：Coordinator–Worker 调度配置（UI#10） =====


@router.get("/{agent_id}/coordination")
async def get_agent_coordination(
    agent_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """获取单个 Agent 的调度配置（role / delegation / catalog）。"""
    try:
        coord: AgentCoordination = await read_coordination(agent_id)
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except Exception as exc:
        logger.error("Failed to read coordination", agent_id=agent_id, error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)
    return success(data=coord.model_dump())


@router.put("/{agent_id}/coordination")
async def update_agent_coordination(
    req: AgentCoordination,
    agent_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """保存单个 Agent 的调度配置（四条校验 + 持久化 + 重建 Catalog）。"""
    req.agent_id = agent_id
    try:
        saved, affected = await write_coordination(agent_id, req)
    except AgentNotFoundError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except ConfigValidationError as exc:
        return error_response(exc.code, exc.message, status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.error("Failed to write coordination", agent_id=agent_id, error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)
    return success(
        data={"coordination": saved.model_dump(), "affected_agents": affected},
        message="Coordination updated",
    )
