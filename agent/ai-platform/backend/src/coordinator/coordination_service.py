"""CoordinationService — Coordinator–Worker 调度配置读写（T04 O1g / UI#10）。

对齐 C–W Spec §4/§9/§12/§14.3 与控制台 spec.md §3.8。

职责：
- 读取 / 保存单个 Agent 的调度配置（role / delegation / catalog）；
- 保存时执行 spec.md §3.8 的**四条校验**；
- 持久化到 ``coordination.yaml``（结构源）+ ``agent.yaml`` 的 ``role`` /
  ``routing.enabled``（供 ``WorkerCatalog`` 识别角色）+ Worker 的
  ``metadata.yaml`` catalog 段；
- 保存后触发 :func:`refresh_worker_catalog` 与委派工具 schema 刷新（C3），
  并级联清理引用了被禁用 Worker 的 Coordinator 白名单。

数据映射（impl-plan §10.3 约定 12：不新造 schema）：
- ``role`` → ``agent.yaml: agent.role``；
- Worker ``catalog`` → ``metadata.yaml: metadata.{when_to_use,enabled,
  capabilities,input_contract,output_contract,safety_level,...}``；
- Coordinator ``delegation``（含 ``worker_ids``）→ ``coordination.yaml``。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from src.agent.config import AgentRole
from src.config_manager.file_service import agent_dir
from src.config_manager.manager import ConfigManager, get_config_manager
from src.coordinator.catalog import (
    refresh_worker_catalog,
    update_catalog_entry,
)
from src.utils.exceptions import (
    AgentNotFoundError,
    ConfigValidationError,
)
from src.utils.logging import get_logger

logger = get_logger("coordinator.coordination_service")

ROLE_COORDINATOR: str = "coordinator"
ROLE_WORKER: str = "worker"

#: 协调配置文件名（每 Agent 一份，作为 delegation / catalog 的结构源）。
COORDINATION_FILE: str = "coordination.yaml"


# ===========================================================================
# 请求 / 响应模型
# ===========================================================================


class CoordinationDelegation(BaseModel):
    """Coordinator 委派配置（spec.md §3.8）。"""

    spawn_tools_enabled: bool = True
    enforce_task_brief: bool = True
    max_depth: int = Field(default=1, ge=1, le=5)
    timeout_seconds: int = Field(default=120, ge=1)
    emit_dispatch_trace: bool = True
    forbid_self_invoke: bool = True
    worker_ids: list[str] = Field(default_factory=list)


class CoordinationCatalog(BaseModel):
    """Worker 可委派契约（spec.md §3.8 Worker 形态）。"""

    enabled: bool = True
    when_to_use: str = ""
    capabilities: list[str] = Field(default_factory=list)
    input_contract: list[str] = Field(default_factory=list)
    output_contract: str = "text"
    security_level: str = Field(default="read_only", description="read_only | needs_hitl")
    timeout_seconds: int = Field(default=120, ge=1)
    degrade_message: str = ""


class AgentCoordination(BaseModel):
    """单 Agent 的完整调度配置。"""

    agent_id: str
    role: str = ROLE_WORKER
    routing_enabled: bool = False
    delegation: CoordinationDelegation | None = None
    catalog: CoordinationCatalog | None = None


# ===========================================================================
# 原始 YAML 工具
# ===========================================================================


def _read_yaml(path: Path) -> dict[str, Any]:
    """读取 YAML 文件，不存在返回 ``{}``。"""
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except yaml.YAMLError as exc:
        logger.warning("Failed to parse YAML", path=str(path), error=str(exc))
        return {}


def _write_yaml(path: Path, data: dict[str, Any]) -> None:
    """写 YAML 文件（保 Unicode，不排序键）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _patch_agent_yaml(agent_id: str, *, role: str, routing_enabled: bool) -> None:
    """局部更新 ``agent.yaml`` 的 ``role`` 与 ``routing.enabled``。"""
    path: Path = agent_dir(agent_id) / "agent.yaml"
    data: dict[str, Any] = _read_yaml(path)
    agent_section: dict[str, Any] = data.setdefault("agent", {})
    agent_section["role"] = role
    routing: dict[str, Any] = agent_section.setdefault("routing", {})
    if isinstance(routing, dict):
        routing["enabled"] = routing_enabled
    _write_yaml(path, data)


def _write_coordination_yaml(agent_id: str, coord: AgentCoordination) -> None:
    """把协调配置落盘到 ``coordination.yaml``。"""
    path: Path = agent_dir(agent_id) / COORDINATION_FILE
    payload: dict[str, Any] = {
        "role": coord.role,
        "routing_enabled": coord.routing_enabled,
    }
    if coord.delegation is not None:
        payload["delegation"] = coord.delegation.model_dump()
    if coord.catalog is not None:
        payload["catalog"] = coord.catalog.model_dump()
    _write_yaml(path, payload)


def _write_metadata_catalog(agent_id: str, catalog: CoordinationCatalog) -> None:
    """把 Worker catalog 写回 ``metadata.yaml`` 的 ``metadata:`` 段。"""
    path: Path = agent_dir(agent_id) / "metadata.yaml"
    data: dict[str, Any] = _read_yaml(path)
    meta: dict[str, Any] = data.setdefault("metadata", {})
    meta["enabled"] = catalog.enabled
    meta["when_to_use"] = catalog.when_to_use
    meta["capabilities"] = list(catalog.capabilities)
    meta["input_contract"] = list(catalog.input_contract)
    meta["output_contract"] = catalog.output_contract
    meta["safety_level"] = catalog.security_level
    meta["timeout_seconds"] = catalog.timeout_seconds
    meta["degrade_message"] = catalog.degrade_message
    _write_yaml(path, data)


# ===========================================================================
# 读取
# ===========================================================================


async def read_coordination(agent_id: str) -> AgentCoordination:
    """读取单个 Agent 的调度配置。

    ``coordination.yaml`` 存在则作为结构源；否则由 ``AgentConfig``（role /
    routing）与 ``metadata.yaml``（catalog）推导默认值。

    Args:
        agent_id: Agent ID。

    Returns:
        组装好的 :class:`AgentCoordination`。

    Raises:
        AgentNotFoundError: Agent 配置不存在。
    """
    manager: ConfigManager = get_config_manager()
    try:
        config: Any = await manager.get_config(agent_id)
    except KeyError as exc:
        raise AgentNotFoundError(agent_id) from exc

    role: str = _role_value(config)
    routing_enabled: bool = bool(getattr(config.routing, "enabled", False))

    coord_file: dict[str, Any] = _read_yaml(agent_dir(agent_id) / COORDINATION_FILE)
    if coord_file:
        role = str(coord_file.get("role", role))
        routing_enabled = bool(coord_file.get("routing_enabled", routing_enabled))

    if role == ROLE_COORDINATOR:
        delegation_data: dict[str, Any] = coord_file.get("delegation") or {}
        delegation = CoordinationDelegation(**delegation_data) if delegation_data else CoordinationDelegation()
        catalog = None
    else:
        delegation = None
        meta = getattr(config, "metadata", None)
        catalog_data: dict[str, Any] = coord_file.get("catalog") or {}
        if not catalog_data and meta is not None:
            catalog_data = {
                "enabled": bool(getattr(meta, "enabled", True)),
                "when_to_use": getattr(meta, "when_to_use", "") or "",
                "capabilities": list(getattr(meta, "capabilities", []) or []),
                "input_contract": list(getattr(meta, "input_contract", []) or []),
                "output_contract": getattr(meta, "output_contract", "text") or "text",
                "security_level": getattr(meta, "safety_level", "read_only") or "read_only",
            }
        catalog = CoordinationCatalog(**catalog_data) if catalog_data else CoordinationCatalog()

    return AgentCoordination(
        agent_id=agent_id,
        role=role,
        routing_enabled=routing_enabled,
        delegation=delegation,
        catalog=catalog,
    )


# ===========================================================================
# 写入（含四条校验）
# ===========================================================================


async def write_coordination(
    agent_id: str,
    req: AgentCoordination,
) -> tuple[AgentCoordination, list[str]]:
    """保存单个 Agent 的调度配置（执行四条校验 + 持久化 + 重建 Catalog）。

    Args:
        agent_id: Agent ID。
        req: 请求的调度配置（已含 agent_id，或此处覆盖）。

    Returns:
        ``(保存后的配置, 被级联影响的 agent_id 列表)``。

    Raises:
        AgentNotFoundError: Agent 不存在。
        ConfigValidationError: 校验未通过（code 7001，附 ``validation_errors``）。
    """
    manager: ConfigManager = get_config_manager()
    try:
        config: Any = await manager.get_config(agent_id)
    except KeyError as exc:
        raise AgentNotFoundError(agent_id) from exc

    role: str = (req.role or ROLE_WORKER).strip().lower()
    if role not in (ROLE_COORDINATOR, ROLE_WORKER):
        raise ConfigValidationError([f"Invalid role: {req.role} (must be coordinator|worker)"])

    affected: list[str] = []

    # ---- 校验 1：coordinator 必须 spawn_tools_enabled=true；worker_ids 不含自身 ----
    if role == ROLE_COORDINATOR:
        delegation: CoordinationDelegation = req.delegation or CoordinationDelegation()
        delegation.spawn_tools_enabled = True
        if agent_id in delegation.worker_ids:
            raise ConfigValidationError(
                [f"Coordinator {agent_id} must not list itself in worker_ids"]
            )
        req.delegation = delegation
        req.catalog = None

    # ---- 校验 2：worker 必须剥离 spawn；catalog 为必填结构 ----
    else:
        req.delegation = None
        catalog: CoordinationCatalog = req.catalog or CoordinationCatalog()
        # security_level 归一化
        if catalog.security_level not in ("read_only", "needs_hitl"):
            catalog.security_level = "read_only"
        req.catalog = catalog
        # 禁用态：从所有 Coordinator 的 worker_ids 级联清理（规则 2 友好实现）
        if not catalog.enabled:
            affected.extend(_cascade_remove_worker(agent_id))

    # ---- 校验 3：切到 coordinator 前，若仍在全局 catalog enabled，须先禁用 ----
    # （本服务以 role 为准；build_worker_catalog 仅把 worker 纳入 catalog，
    #   因此切 coordinator 即自动退出 catalog，无需额外动作，仅记录日志。）
    if role == ROLE_COORDINATOR:
        logger.info("Agent promoted to coordinator; it will be excluded from worker catalog", agent_id=agent_id)

    # ---- 持久化 ----
    _patch_agent_yaml(agent_id, role=role, routing_enabled=req.routing_enabled)
    _write_coordination_yaml(agent_id, req)
    if role == ROLE_WORKER and req.catalog is not None:
        _write_metadata_catalog(agent_id, req.catalog)

    # ---- 触发 WorkerCatalog 重建 + 配置热更新链路 ----
    try:
        await manager.reload_agent(agent_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("write_coordination: reload_agent failed", agent_id=agent_id, error=str(exc))
    refresh_worker_catalog()

    saved: AgentCoordination = await read_coordination(agent_id)
    if agent_id not in affected:
        affected.append(agent_id)
    return saved, affected


def _cascade_remove_worker(worker_id: str) -> list[str]:
    """从所有 Coordinator 的 ``worker_ids`` 中移除 ``worker_id``（级联清理）。

    Args:
        worker_id: 被禁用、需从白名单摘除的 Worker ID。

    Returns:
        被改写的 Coordinator agent_id 列表。
    """
    affected: list[str] = []
    root: Path = agent_dir("")  # .../configs/agents
    if not root.exists():
        return affected
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        coord_path: Path = entry / COORDINATION_FILE
        data: dict[str, Any] = _read_yaml(coord_path)
        if data.get("role") != ROLE_COORDINATOR:
            continue
        delegation: dict[str, Any] = data.get("delegation") or {}
        worker_ids: list[str] = list(delegation.get("worker_ids", []) or [])
        if worker_id in worker_ids:
            worker_ids.remove(worker_id)
            delegation["worker_ids"] = worker_ids
            data["delegation"] = delegation
            _write_yaml(coord_path, data)
            affected.append(entry.name)
            logger.info("Cascade-removed worker from coordinator", coordinator=entry.name, worker=worker_id)
    return affected


def _role_value(config: Any) -> str:
    """读取 AgentConfig 的调度角色字符串。"""
    raw: Any = getattr(config, "role", None)
    if isinstance(raw, AgentRole):
        return raw.value
    value: Any = getattr(raw, "value", raw)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in (ROLE_COORDINATOR, ROLE_WORKER):
            return normalized
    return ROLE_WORKER
