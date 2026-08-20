"""平台 Skill 工具 — 只向 LLM 暴露正式 ``skill_id``。

OpenHarness 原生 ``SkillTool`` 的入参描述是自由文本 ``name``，且
``Available Skills`` 段落默认用**目录名**作为粗体主名。模型容易缩写成
``member`` 一类假 id，再被 ACL 拼成 ``ai:skill:member:run``。

本包装器：

1. 工具 description / ``name`` 字段只列出正式 ``skill_id``；
2. 有启用列表时把 ``name`` 收窄为 ``Literal`` + ``enum``（与 ``InvokeAgentTool`` 同套路）；
3. 执行前经注册表 ``resolve_canonical_id``；未命中启用集则拒识并回显允许列表。
"""

from __future__ import annotations

from typing import Any, Literal, Sequence

from openharness.skills import load_skill_registry
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult
from openharness.tools.skill_tool import SkillTool
from pydantic import BaseModel, Field, create_model

from src.utils.logging import get_logger

logger = get_logger("runtime.platform_skill_tool")

_STATIC_DESCRIPTION = (
    "按正式 skill_id 读取已启用技能的 SKILL.md 说明。"
    "name 必须是正式 skill_id（如 member.profile），禁止缩写或臆造（如 member）。"
)


class PlatformSkillToolInput(BaseModel):
    """Skill 工具入参：字段名保持 ``name`` 以兼容 OpenHarness / ACL E1。"""

    name: str = Field(
        ...,
        description=(
            "正式 skill_id（与技能池 / 授权页一致）。"
            "禁止使用目录名缩写或域前缀（例如不可传 member）。"
        ),
    )


def _build_input_model(allowed_ids: Sequence[str]) -> type[BaseModel]:
    """把 ``name`` 收窄为启用技能的 ``Literal`` 枚举。"""
    ids: list[str] = sorted({sid.strip() for sid in allowed_ids if sid and sid.strip()})
    if not ids:
        return PlatformSkillToolInput

    literal_type: Any = Literal[tuple(ids)]  # type: ignore[valid-type]
    id_list = ", ".join(ids)
    return create_model(  # type: ignore[call-overload]
        "PlatformSkillToolInput",
        __base__=PlatformSkillToolInput,
        __module__=PlatformSkillToolInput.__module__,
        name=(
            literal_type,
            Field(
                ...,
                description=(
                    f"正式 skill_id，只能是以下之一：{id_list}。"
                    "禁止缩写或臆造（例如不可传 member）。"
                ),
                json_schema_extra={"enum": list(ids)},
            ),
        ),
    )


class PlatformSkillTool(BaseTool):
    """只暴露正式 skill_id 的 ``skill`` 工具。"""

    name = "skill"
    description = _STATIC_DESCRIPTION
    input_model = PlatformSkillToolInput

    def __init__(self, allowed_skill_ids: Sequence[str] | None = None) -> None:
        """按 Agent 启用技能收窄 schema。

        Args:
            allowed_skill_ids: 本 Agent 启用的正式 skill_id 列表；
                空 / ``None`` 时保持自由字符串（但仍走注册表归一与拒识文案）。
        """
        self._allowed: frozenset[str] = frozenset(
            sid.strip() for sid in (allowed_skill_ids or []) if sid and str(sid).strip()
        )
        self.name = type(self).name
        if self._allowed:
            ids = ", ".join(sorted(self._allowed))
            self.description = (
                f"{_STATIC_DESCRIPTION} 本 Agent 允许：{ids}。"
            )
            self.input_model = _build_input_model(sorted(self._allowed))
        else:
            self.description = _STATIC_DESCRIPTION
            self.input_model = PlatformSkillToolInput

    def is_read_only(self, arguments: BaseModel) -> bool:
        del arguments
        return True

    async def execute(
        self, arguments: BaseModel, context: ToolExecutionContext
    ) -> ToolResult:
        """读取技能正文；非法名拒识并回显允许列表。"""
        raw_name: str = str(getattr(arguments, "name", "") or "").strip()
        if not raw_name:
            return ToolResult(output="skill name（正式 skill_id）不能为空", is_error=True)

        canonical: str = raw_name
        try:
            from src.bootstrap.skills_mcp import get_skill_registry

            registry = get_skill_registry()
            if registry is not None and hasattr(registry, "resolve_canonical_id"):
                canonical = str(registry.resolve_canonical_id(raw_name) or raw_name).strip()
        except Exception as exc:  # noqa: BLE001 - 注册表不可用时仍按原文查找
            logger.debug("skill registry unavailable for canonical resolve", error=str(exc))

        if self._allowed and canonical not in self._allowed:
            allowed = ", ".join(sorted(self._allowed))
            return ToolResult(
                output=(
                    f"未知或不允许的 skill_id：{raw_name}。"
                    f"请使用正式 id，本 Agent 允许：{allowed}"
                ),
                is_error=True,
            )

        # 委托原生加载逻辑（按 OH registry 的 name=frontmatter name / skill_id）
        inner = SkillTool()
        return await inner.execute(
            type(inner.input_model)(name=canonical),
            context,
        )
