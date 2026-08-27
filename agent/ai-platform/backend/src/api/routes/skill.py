"""
Skill CRUD API 路由。

端点：
  GET    /api/v1/skills            — 列出 Skill（分页，可筛选）
  GET    /api/v1/skills/{id}       — 获取 Skill 详情
  POST   /api/v1/skills            — 手动注册自定义 Skill
  PUT    /api/v1/skills/{id}       — 更新 Skill
  DELETE /api/v1/skills/{id}       — 注销 Skill
  POST   /api/v1/skills/{id}/enable   — 启用 Skill
  POST   /api/v1/skills/{id}/disable  — 禁用 Skill
  POST   /api/v1/skills/reindex    — 触发全量重建索引
  GET    /api/v1/skills/stats      — 注册表统计
  POST   /api/v1/skills/builder/chat — AI 对话创建技能（ephemeral，不落库）
"""

from __future__ import annotations
from typing import Any

import re
import uuid
import yaml
from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.llm.gateway import get_llm_gateway
from src.skills.custom_store import read_custom_skill_body, save_custom_skill
from src.skills.models import (
    Skill,
    SkillCreateRequest,
    SkillListResponse,
    SkillSource,
    SkillStatus,
    SkillUpdateRequest,
)
from src.skills.spec_parser import list_package_attachments, parse_front_matter
from src.skills.skill_builder_service import BuilderChatResponse, SkillBuilderService

logger = structlog.get_logger(__name__)

router = APIRouter()

# 与 src.skills.spec_parser._FRONT_MATTER_RE 同形：判断请求体是否真的带 Front Matter 分隔符，
# 仅当存在分隔符时才严格校验内部 YAML，避免把纯正文误判为解析失败（见 parse_skill）。
_FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


class SkillParseRequest(BaseModel):
    """解析 SKILL.md 请求体（content 为 SKILL.md 全文）。"""

    content: str


class SkillParseResponse(BaseModel):
    """解析 SKILL.md 结果（仅预览，不持久化）。"""

    metadata: dict[str, Any]
    body: str

# 单例注册表（在应用启动时注入；参见 main.py 中的 lifespan）
_registry: Any = None


def set_registry(registry: Any) -> None:
    """注入 SkillRegistry 实例（在应用启动时调用）。"""
    global _registry
    _registry = registry


def _api_response(code: int, data: Any, message: str) -> dict[str, Any]:
    """构建统一的 API 响应信封。"""
    return {
        "code": code,
        "data": data,
        "message": message,
        "traceId": str(uuid.uuid4()),
    }


@router.get("", response_model=dict)
async def list_skills(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    source: str | None = None,
    keyword: str | None = None,
) -> dict[str, Any]:
    """分页列出 Skill，支持可选筛选。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")

    skills: list[Skill] = _registry.list_all()

    # 筛选
    if category:
        skills: list[Any] = [s for s in skills if s.category == category]
    if status_filter:
        skills: list[Any] = [s for s in skills if s.status == status_filter]
    if source:
        skills: list[Any] = [s for s in skills if s.source == source]
    if keyword:
        kw_lower: str = keyword.lower()
        skills: list[Any] = [
            s for s in skills
            if kw_lower in s.name.lower() or kw_lower in s.description.lower()
        ]

    total: Any = len(skills)
    start: Any = (page - 1) * page_size
    end: Any = start + page_size
    items: Any = skills[start:end]

    response: SkillListResponse = SkillListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )
    return _api_response(0, response.model_dump(mode="json"), "OK")


@router.get("/stats", response_model=dict)
async def get_skill_stats() -> dict[str, Any]:
    """返回注册表统计信息。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")
    return _api_response(0, _registry.stats(), "OK")


@router.post("/parse", response_model=dict)
async def parse_skill(req: SkillParseRequest) -> dict[str, Any]:
    """解析 SKILL.md 的 Front Matter 与正文（仅预览，不持久化）。

    - 标准 SKILL.md：返回解析后的 metadata 与正文 body；
    - 无 ``---`` 分隔符：返回 ``{metadata: {}, body: 原文}``，不报错；
    - ``---`` 分隔符内 YAML 语法错误：返回 400 + 错误信息（由下游/前端展示）。
    """
    # 仅当请求体真的带 Front Matter 分隔符时，才对内部 YAML 做严格校验；
    # 否则 parse_front_matter 会把整段正文当 body 返回，无需校验。
    fm_match: Any = _FRONT_MATTER_RE.match(req.content)
    if fm_match is not None:
        try:
            yaml.safe_load(fm_match.group(1))
        except yaml.YAMLError as exc:
            return _api_response(400, None, f"SKILL.md Front Matter 解析失败：{exc}")

    try:
        metadata: Any
        body: str
        metadata, body = parse_front_matter(req.content)
    except Exception as exc:  # pragma: no cover - parse_front_matter 已对异常兜底
        return _api_response(400, None, f"SKILL.md Front Matter 解析失败：{exc}")

    return _api_response(0, {"metadata": metadata, "body": body}, "OK")


class SkillBuilderMessage(BaseModel):
    """AI 对话创建中的单条历史消息（role / content）。status 由前端维护，此处仅透传 content。"""

    role: str = "user"
    content: str = ""


class BuilderChatRequest(BaseModel):
    """AI 对话创建技能请求（ephemeral，不落库）。

    - ``messages``：前端全量维护的多轮上下文（role/content）；
    - ``user_input``：本轮新增用户输入，追加为最后一条 user 消息；
    - ``converged``：前端收敛信号（如「定稿」），作为后端收敛检测的兜底增强。
    """

    messages: list[SkillBuilderMessage] = Field(default_factory=list)
    user_input: str = ""
    converged: bool = False


@router.post("/builder/chat", response_model=dict)
async def builder_chat(req: BuilderChatRequest) -> dict[str, Any]:
    """AI 对话创建技能（ephemeral）。

    硬约束（决策 A/B）：无状态、不建会话、不落库（不碰 agent_session /
    agent_session_message，Redis + PG 均不动）。后端仅把前端上送的多轮上下文喂给
    平台既有 LLM 网关（get_llm_gateway().chat()）直驱一个固定系统提示词的
    SkillBuilderService，回传 AI 文本 ``reply`` 与生成状态。
    """
    gateway = get_llm_gateway()
    service = SkillBuilderService(gateway)
    try:
        result: BuilderChatResponse = await service.build(
            messages=[m.model_dump() for m in req.messages],
            user_input=req.user_input,
            converged=req.converged,
        )
    except Exception as exc:  # noqa: BLE001 — 任何 LLM/下游异常都归一为信封，避免 500 裸崩
        logger.warning("skill builder chat failed", error=str(exc))
        return _api_response(50000, None, f"AI 生成失败：{exc}")
    return _api_response(0, result.model_dump(), "OK")


@router.get("/{skill_id}", response_model=dict)
async def get_skill(skill_id: str) -> dict[str, Any]:
    """按 ID 获取单个 Skill（package skill 额外懒加载 SKILL.md 正文与附件）。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")
    skill: Skill | None = _registry.get(skill_id)
    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{skill_id}' not found",
        )

    # 渐进式披露阶段二（R8）：对 Agent Skills Spec 技能包额外读取 SKILL.md 正文与附件；
    # 对自建 custom 技能（Q3）：正文已落盘文件系统，内存缺失时读盘回填。
    if skill.is_package_skill():
        skill_md: Path = Path(skill.package_dir) / "SKILL.md"
        try:
            raw_text: str = skill_md.read_text(encoding="utf-8")
        except OSError:
            raw_text = ""
        _meta: Any
        body: str
        _meta, body = parse_front_matter(raw_text)
        attachments: dict[str, list[str]] = list_package_attachments(Path(skill.package_dir))
        skill.load_body(body, attachments)
    elif skill.source == SkillSource.CUSTOM:
        if not skill.body_loaded:
            disk_body = read_custom_skill_body(skill.skill_id)
            if disk_body is not None:
                skill.load_body(disk_body)

    # B-1.5：references 文件内容一并读出，供前端点击查看（仅 package 技能有 references）。
    # custom 技能 references 恒为空，循环不进入；package 技能经 read_reference_file 安全读取。
    reference_contents: dict[str, str] = {}
    for rel_path in skill.references:
        content = skill.read_reference_file(rel_path)
        if content is not None:
            reference_contents[rel_path] = content
    if reference_contents:
        skill.reference_contents = reference_contents

    return _api_response(0, skill.model_dump(mode="json"), "OK")


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_skill(req: SkillCreateRequest) -> dict[str, Any]:
    """手动注册自定义 Skill。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")

    existing: Skill | None = _registry.get(req.skill_id)
    if existing:
        return _api_response(3001, None, f"Skill '{req.skill_id}' already exists")

    skill: Skill = Skill(
        skill_id=req.skill_id,
        name=req.name,
        description=req.description,
        category=req.category,
        tags=req.tags,
        parameters=req.parameters,
        required_permissions=req.required_permissions,
        handler=req.handler,
        timeout=req.timeout,
        version=req.version,
        status=SkillStatus.ACTIVE,
        source=SkillSource.CUSTOM,
        priority=req.priority,
        requires_approval=req.requires_approval,
        body=req.body,
    )
    await _registry.register(skill)
    # Q3：custom 技能正文落盘文件系统（覆盖写 SKILL.md），失败仅告警不阻断创建。
    try:
        save_custom_skill(skill)
    except Exception as exc:  # noqa: BLE001
        logger.warning("custom skill 正文落盘失败", skill_id=req.skill_id, error=str(exc))
    return _api_response(0, skill.model_dump(mode="json"), "Skill created")


@router.put("/{skill_id}", response_model=dict)
async def update_skill(
    skill_id: str,
    req: SkillUpdateRequest,
) -> dict[str, Any]:
    """更新已有 Skill。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")

    skill: Skill | None = _registry.get(skill_id)
    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{skill_id}' not found",
        )

    update_data: dict[str, Any] = req.model_dump(exclude_unset=True)
    # 契约 §3.4.3：SkillUpdateRequest.body 显式传 null = 清空正文，
    # 故 body 不受下方 `is not None` 守卫约束，需单独特判（无论 None 与否都落盘）。
    body_explicit: bool = "body" in update_data
    body_value: str | None = update_data.pop("body", None)
    for key, value in update_data.items():
        if value is not None:
            setattr(skill, key, value)
    if body_explicit:
        skill.body = body_value  # None = 清空正文；save_custom_skill 会以空串落盘

    await _registry.register(skill)  # 重新注册（覆盖 + 重建索引）
    # Q3：custom 技能正文 / 元数据变更后同步落盘（覆盖写 SKILL.md）。
    if skill.source == SkillSource.CUSTOM:
        try:
            save_custom_skill(skill)
        except Exception as exc:  # noqa: BLE001
            logger.warning("custom skill 正文落盘失败", skill_id=skill_id, error=str(exc))
    return _api_response(0, skill.model_dump(mode="json"), "Skill updated")


@router.delete("/{skill_id}", response_model=dict)
async def delete_skill(skill_id: str) -> dict[str, Any]:
    """注销 Skill。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")

    if not _registry.get(skill_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{skill_id}' not found",
        )

    await _registry.unregister(skill_id)
    return _api_response(0, None, "Skill deleted")


@router.post("/{skill_id}/enable", response_model=dict)
async def enable_skill(skill_id: str) -> dict[str, Any]:
    """启用 Skill（将状态设置为 active）。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")

    skill: Skill | None = _registry.get(skill_id)
    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{skill_id}' not found",
        )

    skill.status = SkillStatus.ACTIVE
    await _registry.register(skill)
    return _api_response(0, None, "Skill enabled")


@router.post("/{skill_id}/disable", response_model=dict)
async def disable_skill(skill_id: str) -> dict[str, Any]:
    """禁用 Skill（将状态设置为 inactive）。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")

    skill: Skill | None = _registry.get(skill_id)
    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{skill_id}' not found",
        )

    skill.status = SkillStatus.INACTIVE
    await _registry.register(skill)
    return _api_response(0, None, "Skill disabled")


@router.post("/reindex", response_model=dict)
async def reindex_skills() -> dict[str, Any]:
    """触发对所有活跃 Skill 的全量重建索引，索引到 Qdrant。"""
    if _registry is None:
        return _api_response(9001, None, "SkillRegistry not initialized")

    count: int = await _registry.reindex_all()
    return _api_response(0, {"indexed": count}, "Reindex complete")
