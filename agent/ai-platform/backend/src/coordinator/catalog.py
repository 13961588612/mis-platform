"""WorkerCatalog — 可委派 Worker 目录（Coordinator–Worker 基座 C3）。

数据源：``ConfigManager.list_configs()`` 过滤 ``role == worker and enabled``，
再与 ``settings.INVOKE_AGENT_WHITELIST`` 求交集（design-impl.md §6 T03 要点 1）。

设计要点：

* **单例 + 显式刷新**：``get_worker_catalog()`` 惰性构建进程内单例；配置热更新
  后由 ``refresh_worker_catalog()`` 重建。``create_platform_tool_registry()``
  在每次会话构建时调用 → 新会话即刻拿到新目录（§8 Q12 裁定）。
* **永不抛异常**：ConfigManager 未初始化 / 配置缺失时回退到
  ``DEFAULT_WHITELIST`` 的静态描述，保证委派能力不会因配置问题整体失效。
* **动态收窄**：``build_input_model()`` 用 ``pydantic.create_model`` 继承既有
  ``InvokeAgentInput``，把 ``agent_id`` 收窄为 ``Literal[...]``；Catalog 为空
  或未注入时不做任何改动（既有无参构造行为一字不变，§7.5 红线）。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, PrivateAttr, create_model

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("coordinator.catalog")

#: 调度角色字面量（与 ``src.agent.config.AgentRole`` 取值保持一致）
ROLE_COORDINATOR: str = "coordinator"
ROLE_WORKER: str = "worker"

#: 静态兜底契约：configs/agents/*/metadata.yaml 未提供 when_to_use 时使用。
#: 文案与 spec.md §5「意图与委派表」逐条对齐，避免语义重叠。
STATIC_WORKER_HINTS: dict[str, dict[str, Any]] = {
    "mis-rag": {
        "display_name": "MIS 知识库问答助手",
        "when_to_use": "制度、规章、知识库条款检索，需给出条款依据",
        "capabilities": ["rag"],
        "input_contract": ["user_question"],
        "output_contract": "answer+citations",
        "safety_level": "read_only",
    },
    "crm-assistant": {
        "display_name": "CRM 助手",
        "when_to_use": "会员、积分、客户画像等 CRM 业务数据查询",
        "capabilities": ["crm"],
        "input_contract": ["user_question"],
        "output_contract": "text",
        "safety_level": "read_only",
    },
    "mis-extract": {
        "display_name": "MIS 字段抽取助手",
        "when_to_use": "从给定文本中抽取结构化表单字段，不做检索",
        "capabilities": ["extract"],
        "input_contract": ["user_question", "attachments_text"],
        "output_contract": "json",
        "safety_level": "read_only",
    },
    "mis-summary": {
        "display_name": "MIS 摘要助手",
        "when_to_use": "对已给定文本做摘要或审批意见归纳，不做检索",
        "capabilities": ["summary"],
        "input_contract": ["user_question", "attachments_text"],
        "output_contract": "text",
        "safety_level": "read_only",
    },
}


class WorkerSpec(BaseModel):
    """单个 Worker 的可委派契约（源自 configs/agents/*/metadata.yaml）。"""

    agent_id: str
    display_name: str = ""
    when_to_use: str = Field(
        default="", description="供 Coordinator/LLM 判断的一句话适用场景"
    )
    capabilities: list[str] = Field(default_factory=list)
    input_contract: list[str] = Field(
        default_factory=list,
        description="接受的 TaskBrief 字段，如 user_question/page_context_slice",
    )
    output_contract: str = Field(
        default="text", description="text / json / answer+citations"
    )
    safety_level: str = Field(default="read_only", description="read_only / needs_hitl")
    enabled: bool = True

    def is_read_only(self) -> bool:
        """该 Worker 是否为只读（决定 C5 是否允许并行）。

        Returns:
            ``safety_level == "read_only"`` 时返回 True。
        """
        return (self.safety_level or "").strip().lower() == "read_only"

    def summary_line(self) -> str:
        """渲染成工具 description 中的一行说明。

        Returns:
            形如 ``- mis-rag（MIS 知识库问答助手）：制度检索…；输出：answer+citations``。
        """
        title = f"- {self.agent_id}"
        if self.display_name and self.display_name != self.agent_id:
            title = f"{title}（{self.display_name}）"
        hint = self.when_to_use.strip() or "（未声明适用场景，谨慎委派）"
        line = f"{title}：{hint}"
        output = (self.output_contract or "").strip()
        if output:
            line = f"{line}；输出：{output}"
        return line


class WorkerCatalog(BaseModel):
    """可委派 Worker 目录：白名单 ∩ role=worker ∩ enabled。"""

    workers: dict[str, WorkerSpec] = Field(default_factory=dict)
    coordinators: list[str] = Field(
        default_factory=list, description="role=coordinator 的 Agent（禁止被委派）"
    )
    fallback: bool = Field(
        default=False, description="True 表示由 DEFAULT_WHITELIST 静态兜底构建"
    )

    #: ``build_input_model()`` 结果缓存，避免每次构造工具都重建 pydantic 模型
    _input_model_cache: dict[str, type] = PrivateAttr(default_factory=dict)

    def worker_ids(self) -> list[str]:
        """返回稳定排序的可委派 Worker ID 列表。

        Returns:
            升序排列的 Worker ID 列表（可能为空）。
        """
        return sorted(self.workers.keys())

    def get(self, agent_id: str) -> WorkerSpec | None:
        """按 ID 取 Worker 契约。

        Args:
            agent_id: 目标 Worker ID。

        Returns:
            命中的 :class:`WorkerSpec`；未命中返回 ``None``。
        """
        return self.workers.get((agent_id or "").strip())

    def is_coordinator(self, agent_id: str) -> bool:
        """判断目标是否为 Coordinator（Coordinator 不可被委派）。

        Args:
            agent_id: 目标 Agent ID。

        Returns:
            是 Coordinator 返回 True。
        """
        return (agent_id or "").strip() in set(self.coordinators)

    def render_tool_description(self, *, base: str) -> str:
        """把 when_to_use 渲染进委派工具的 description（C3 动态同步）。

        Args:
            base: 静态回退文案（Catalog 为空时原样返回，保证零回归）。

        Returns:
            追加了 Worker 清单的工具描述。
        """
        specs = [self.workers[worker_id] for worker_id in self.worker_ids()]
        if not specs:
            return base
        lines: list[str] = [base.strip(), "", "当前可委派 Worker（按适用场景选择，不确定时不要委派）："]
        lines.extend(spec.summary_line() for spec in specs)
        return "\n".join(lines)

    def build_input_model(self, static_model: type) -> type:
        """用 ``create_model()`` 生成 ``agent_id: Literal[...]`` 的动态子模型。

        Args:
            static_model: 静态入参模型（``InvokeAgentInput``）。

        Returns:
            收窄 ``agent_id`` 取值的子模型；Catalog 为空时原样返回
            ``static_model``（不引入任何 schema 变化）。
        """
        worker_ids = self.worker_ids()
        if not worker_ids:
            return static_model

        cache_key = f"{static_model.__module__}.{static_model.__qualname__}"
        cached = self._input_model_cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            literal_type: Any = Literal[tuple(worker_ids)]  # type: ignore[valid-type]
            model: type = create_model(  # type: ignore[call-overload]
                static_model.__name__,
                __base__=static_model,
                __module__=static_model.__module__,
                agent_id=(
                    literal_type,
                    Field(
                        ...,
                        description=self._render_agent_id_description(),
                        # 单值 Literal 在 pydantic v2 只渲染 const，这里显式补 enum，
                        # 保证 LLM 侧 tool schema 形状稳定（始终为字符串枚举）。
                        json_schema_extra={"enum": list(worker_ids)},
                    ),
                ),
            )
        except Exception as exc:  # noqa: BLE001 - 动态建模失败必须降级而非中断委派
            logger.warning(
                "Failed to build dynamic invoke input model",
                workers=worker_ids,
                error=str(exc),
            )
            return static_model

        self._input_model_cache[cache_key] = model
        return model

    def _render_agent_id_description(self) -> str:
        """渲染 ``agent_id`` 字段的枚举说明。

        Returns:
            形如 ``要委托的目标智能体 ID。允许：mis-rag（制度检索…）、…``。
        """
        parts: list[str] = []
        for worker_id in self.worker_ids():
            spec = self.workers[worker_id]
            hint = spec.when_to_use.strip() or spec.display_name.strip()
            parts.append(f"{worker_id}（{hint}）" if hint else worker_id)
        return "要委托的目标智能体 ID。允许：" + "、".join(parts) + "。"


def _load_agent_configs() -> list[Any]:
    """读取全部已加载的 AgentConfig（ConfigManager 不可用时返回空表）。

    Returns:
        AgentConfig 列表；任何异常都降级为 ``[]``。
    """
    try:
        from src.config_manager.manager import get_config_manager

        configs: Any = get_config_manager().list_configs()
    except Exception as exc:  # noqa: BLE001 - 目录构建不得因配置层异常而失败
        logger.warning("Worker catalog: config manager unavailable", error=str(exc))
        return []
    if isinstance(configs, dict):
        return list(configs.values())
    if isinstance(configs, (list, tuple)):
        return list(configs)
    return []


def _resolve_whitelist() -> frozenset[str]:
    """解析委派白名单（复用 invoke_agent 的既有解析逻辑）。

    Returns:
        白名单集合；未配置时为 ``DEFAULT_WHITELIST``。
    """
    from src.skills.tools.invoke_agent import resolve_whitelist

    configured: Any = None
    try:
        configured = getattr(get_settings(), "INVOKE_AGENT_WHITELIST", None)
    except Exception as exc:  # noqa: BLE001 - 配置读取失败按未配置处理
        logger.warning("Worker catalog: settings unavailable", error=str(exc))
    if not isinstance(configured, list):
        configured = None
    return resolve_whitelist(configured)


def _forbidden_targets() -> list[str]:
    """静态兜底的 Coordinator 列表（``FORBIDDEN_TARGETS``）。

    Returns:
        禁止被委派的 Agent ID 列表。
    """
    from src.skills.tools.invoke_agent import FORBIDDEN_TARGETS

    return sorted(FORBIDDEN_TARGETS)


def _role_of(config: Any) -> str:
    """读取 AgentConfig 的调度角色（未配置默认 worker）。

    Args:
        config: AgentConfig 实例。

    Returns:
        ``"coordinator"`` 或 ``"worker"``；无法识别时返回 ``"worker"``。
    """
    raw: Any = getattr(config, "role", None)
    value: Any = getattr(raw, "value", raw)
    if not isinstance(value, str):
        return ROLE_WORKER
    normalized = value.strip().lower()
    return normalized if normalized in (ROLE_COORDINATOR, ROLE_WORKER) else ROLE_WORKER


def _first_sentence(text: str, *, limit: int = 60) -> str:
    """取描述文本的首句作为 when_to_use 兜底。

    Args:
        text: 原始描述。
        limit: 最大保留字符数。

    Returns:
        去换行、截断后的首句。
    """
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return ""
    for sep in ("。", "；", ";", ".", "\n"):
        index = cleaned.find(sep)
        if 0 < index < limit:
            return cleaned[:index]
    return cleaned[:limit]


def _spec_from_config(config: Any, agent_id: str) -> WorkerSpec:
    """从 AgentConfig（含 metadata section）构建 WorkerSpec。

    Args:
        config: AgentConfig 实例。
        agent_id: Agent ID。

    Returns:
        构建好的 :class:`WorkerSpec`。
    """
    hint: dict[str, Any] = STATIC_WORKER_HINTS.get(agent_id, {})
    metadata: Any = getattr(config, "metadata", None)

    def _meta(name: str, default: Any) -> Any:
        """读取 metadata 字段，缺失时回落默认值。"""
        if metadata is None:
            return default
        value = getattr(metadata, name, None)
        return default if value in (None, "", [], {}) else value

    display_name: str = str(
        _meta("display_name", "")
        or getattr(config, "display_name", "")
        or hint.get("display_name", "")
        or agent_id
    )
    when_to_use: str = str(
        _meta("when_to_use", "")
        or hint.get("when_to_use", "")
        or _first_sentence(str(_meta("description", "") or getattr(config, "description", "")))
    )
    return WorkerSpec(
        agent_id=agent_id,
        display_name=display_name,
        when_to_use=when_to_use,
        capabilities=list(_meta("capabilities", hint.get("capabilities", [])) or []),
        input_contract=list(
            _meta("input_contract", hint.get("input_contract", ["user_question"])) or []
        ),
        output_contract=str(
            _meta("output_contract", hint.get("output_contract", "text")) or "text"
        ),
        safety_level=str(
            _meta("safety_level", hint.get("safety_level", "read_only")) or "read_only"
        ),
        enabled=bool(_meta("enabled", True)),
    )


def _static_catalog(
    whitelist: frozenset[str], coordinators: list[str]
) -> WorkerCatalog:
    """构建静态兜底目录（配置缺失时保证委派不整体失效）。

    Args:
        whitelist: 委派白名单。
        coordinators: 已识别的 Coordinator 列表。

    Returns:
        ``fallback=True`` 的 :class:`WorkerCatalog`。
    """
    workers: dict[str, WorkerSpec] = {}
    for agent_id in sorted(whitelist):
        hint: dict[str, Any] = STATIC_WORKER_HINTS.get(agent_id, {})
        workers[agent_id] = WorkerSpec(
            agent_id=agent_id,
            display_name=str(hint.get("display_name", agent_id)),
            when_to_use=str(hint.get("when_to_use", "")),
            capabilities=list(hint.get("capabilities", [])),
            input_contract=list(hint.get("input_contract", ["user_question"])),
            output_contract=str(hint.get("output_contract", "text")),
            safety_level=str(hint.get("safety_level", "read_only")),
        )
    return WorkerCatalog(
        workers=workers,
        coordinators=sorted(set(coordinators)) or _forbidden_targets(),
        fallback=True,
    )


def build_worker_catalog() -> WorkerCatalog:
    """按当前配置构建目录（不写单例，供测试与刷新复用）。

    Returns:
        构建好的 :class:`WorkerCatalog`；配置不可用时为静态兜底目录。
    """
    whitelist: frozenset[str] = _resolve_whitelist()
    workers: dict[str, WorkerSpec] = {}
    coordinators: list[str] = []
    skipped: list[str] = []

    for config in _load_agent_configs():
        agent_id: str = str(getattr(config, "agent_id", "") or "").strip()
        if not agent_id:
            continue
        role: str = _role_of(config)
        if role == ROLE_COORDINATOR:
            coordinators.append(agent_id)
            continue
        if agent_id not in whitelist:
            skipped.append(agent_id)
            continue
        spec: WorkerSpec = _spec_from_config(config, agent_id)
        if not spec.enabled:
            skipped.append(agent_id)
            continue
        workers[agent_id] = spec

    if not workers:
        catalog: WorkerCatalog = _static_catalog(whitelist, coordinators)
        logger.info(
            "Worker catalog fell back to static whitelist",
            workers=catalog.worker_ids(),
            coordinators=catalog.coordinators,
        )
        return catalog

    catalog = WorkerCatalog(
        workers=workers,
        coordinators=sorted(set(coordinators)) or _forbidden_targets(),
        fallback=False,
    )
    logger.info(
        "Worker catalog built",
        workers=catalog.worker_ids(),
        coordinators=catalog.coordinators,
        skipped=skipped,
    )
    return catalog


#: 进程内单例（惰性构建 + 显式刷新）
_catalog: WorkerCatalog | None = None


def get_worker_catalog() -> WorkerCatalog:
    """惰性构建的进程内单例。

    Returns:
        当前 :class:`WorkerCatalog` 单例；构建异常时返回静态兜底目录。
    """
    global _catalog
    if _catalog is None:
        try:
            _catalog = build_worker_catalog()
        except Exception as exc:  # noqa: BLE001 - 目录构建绝不允许阻断会话构建
            logger.warning("Worker catalog build failed", error=str(exc))
            _catalog = _static_catalog(frozenset(), [])
    return _catalog


def refresh_worker_catalog() -> WorkerCatalog:
    """配置热更新后强制重建（供运营控制台 / 配置 reload 钩子调用）。

    Returns:
        重建后的 :class:`WorkerCatalog` 单例。
    """
    global _catalog
    _catalog = None
    return get_worker_catalog()


def _reset_for_test() -> None:
    """清空单例（仅供单测隔离使用）。"""
    global _catalog
    _catalog = None
