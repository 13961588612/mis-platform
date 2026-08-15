"""自建 custom 技能正文持久化（文件系统，B-7 / Q3，T02）。

custom 技能的正文（SKILL.md body）落盘到
``{SKILL_CUSTOM_STORE_DIR}/{skill_id}/SKILL.md``，启动或重建时从该目录重载回注册表。
不新增 DB 表 / 迁移：复用既有的文件系统技能包范式，与 Agent Skills Spec 的
``packages/*/SKILL.md`` 平级。

设计约束（主理人默认决策 Q3）：
- 仅 custom 技能落盘；package 技能正文仍走各自的 package_dir。
- GET /skills/{id} 对 custom 且内存 body 缺失时读盘回填（read_custom_skill_body）。
- 启动 reload（load_custom_skills_from_disk）保证进程重启后 custom 正文不丢。
"""

from __future__ import annotations

from typing import Any

import yaml
from pathlib import Path

from src.config import get_settings
from src.skills.models import Skill, SkillCategory, SkillSource, SkillStatus
from src.skills.spec_parser import parse_front_matter
from src.utils.logging import get_logger

logger = get_logger("skills.custom_store")

#: 写盘 Front Matter 时持久化的字段（其余为运行态 / 派生字段，不落盘）。
_FRONT_MATTER_FIELDS: tuple[str, ...] = (
    "skill_id",
    "name",
    "description",
    "category",
    "tags",
    "parameters",
    "required_permissions",
    "handler",
    "timeout",
    "version",
    "priority",
    "requires_approval",
    "mcp_server",
)


def custom_skill_dir(skill_id: str) -> Path:
    """返回某 custom 技能落盘目录：``{SKILL_CUSTOM_STORE_DIR}/{skill_id}``。"""
    return Path(get_settings().SKILL_CUSTOM_STORE_DIR) / skill_id


def save_custom_skill(skill: Skill) -> None:
    """把 custom 技能的元数据 + 正文写入文件系统（覆盖写）。

    非 custom 技能（package 等）直接跳过——它们的正文已有自己的 package_dir 来源。
    """
    if skill.source != SkillSource.CUSTOM:
        return

    directory = custom_skill_dir(skill.skill_id)
    directory.mkdir(parents=True, exist_ok=True)

    front: dict[str, Any] = {"source": SkillSource.CUSTOM.value}
    for field in _FRONT_MATTER_FIELDS:
        value = getattr(skill, field, None)
        if value is not None:
            front[field] = value
    # status 需持久化（用户可能停用），用枚举值字符串
    status_val = getattr(skill, "status", None)
    front["status"] = status_val.value if isinstance(status_val, SkillStatus) else "active"

    body = skill.body or ""
    content = "---\n" + yaml.safe_dump(front, allow_unicode=True, sort_keys=False) + "---\n" + body

    (directory / "SKILL.md").write_text(content, encoding="utf-8")
    logger.info("custom skill 正文已落盘", skill_id=skill.skill_id, path=str(directory / "SKILL.md"))


def read_custom_skill_body(skill_id: str) -> str | None:
    """读盘回填正文（GET /skills/{id} 对 custom 且内存 body 缺失时调用）。

    文件不存在或解析失败返回 ``None``（前端显示「（正文未提供）」）。
    """
    path = custom_skill_dir(skill_id) / "SKILL.md"
    if not path.is_file():
        return None
    try:
        _meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
    except OSError:
        return None
    return body


async def load_custom_skills_from_disk(registry: Any) -> int:
    """启动重载：扫描 ``{SKILL_CUSTOM_STORE_DIR}/*/SKILL.md`` 重建 custom 技能并补正文。

    已存在于内存注册表的技能会被补上 body（与本次新增的等价）；不存在的则全量重建。
    返回实际加载 / 补全的 custom 技能数。
    """
    base = Path(get_settings().SKILL_CUSTOM_STORE_DIR)
    if not base.is_dir():
        return 0

    loaded = 0
    for entry in sorted(base.iterdir()):
        if not entry.is_dir():
            continue
        skill_md = entry / "SKILL.md"
        if not skill_md.is_file():
            continue
        try:
            metadata, body = parse_front_matter(skill_md.read_text(encoding="utf-8"))
        except OSError:
            continue
        if not metadata or not metadata.get("skill_id"):
            logger.warning("跳过无效 custom skill 文件", path=str(skill_md))
            continue

        skill_id = metadata["skill_id"]
        existing = registry.get(skill_id)
        if existing is not None:
            skill = existing
        else:
            skill = Skill(
                skill_id=skill_id,
                name=metadata.get("name", skill_id),
                description=metadata.get("description", ""),
                category=metadata.get("category", SkillCategory.BUILT_IN),
                tags=metadata.get("tags", []) or [],
                parameters=metadata.get("parameters", {}) or {},
                required_permissions=metadata.get("required_permissions", []) or [],
                handler=metadata.get("handler", "") or "",
                timeout=int(metadata.get("timeout", 30)),
                version=metadata.get("version", "1.0.0"),
                priority=float(metadata.get("priority", 1.0)),
                requires_approval=bool(metadata.get("requires_approval", False)),
                source=SkillSource.CUSTOM,
                status=SkillStatus(metadata.get("status", "active")),
            )
        skill.body = body
        skill.body_loaded = True
        skill.source = SkillSource.CUSTOM
        await registry.register(skill)
        loaded += 1

    if loaded:
        logger.info("custom skills 已从磁盘重载", count=loaded)
    return loaded
