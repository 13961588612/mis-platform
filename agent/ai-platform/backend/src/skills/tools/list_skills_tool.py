"""list_skills 工具 — 给 mis-admin-helper 提供「浏览技能池」能力（1.3 选择器兜底增强）。

设计（§4 / Q3 / T02）：

- 工具名 ``list_skills``，供 LLM 自行检索技能池（前端选择器走 ``GET /skills``，互不冲突）；
- 入参 ``{keyword?, limit=20}``；读 ``get_skill_registry().list_all()``；
- 输出 ``skill_id | name | description`` 文本行，便于 LLM 在 create_skill 合成时引用；
- 任何异常转 ``ToolResult(is_error=True)``，不向上抛（与 ``SafeToolWrapper`` 一致，
  避免中断 ``mis-admin-helper`` 的对话循环）。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.utils.logging import get_logger

logger = get_logger("skills.list_skills_tool")


class ListSkillsInput(BaseModel):
    """list_skills 工具入参。"""

    keyword: str = Field(
        default="",
        description=(
            "可选关键词，按 skill_id / name / description 不区分大小写子串匹配；"
            "留空返回全部技能"
        ),
    )
    limit: int = Field(
        default=20,
        ge=1,
        le=100,
        description="返回条数上限（1–100），默认 20",
    )


def _format_skills(skills: list[Any], *, limit: int) -> str:
    """把技能列表渲染为 ``skill_id | name | description`` 文本。

    Args:
        skills: 技能对象列表。
        limit: 渲染条数上限。

    Returns:
        多行文本；空列表时返回友好提示。
    """
    rows: list[str] = []
    for skill in skills[: max(0, limit)]:
        skill_id = str(getattr(skill, "skill_id", "") or "")
        name = str(getattr(skill, "name", "") or "")
        description = str(getattr(skill, "description", "") or "")
        rows.append(f"{skill_id} | {name} | {description}")
    if not rows:
        return "未找到匹配技能。"
    return "\n".join(rows)


class ListSkillsTool(BaseTool):
    """列出技能池中的技能（供 create_skill 合成时检索 / 引用）。"""

    name = "list_skills"
    description = (
        "列出技能池（Skill Registry）中的技能，按 skill_id / name / description 模糊检索。"
        "返回每行 `skill_id | name | description`，便于在创建 / 合并技能时参考现有能力、避免重复。"
        "需要联网补全或浏览现有技能时调用；前端选择器不依赖本工具。"
    )
    input_model = ListSkillsInput

    async def execute(
        self, arguments: ListSkillsInput, context: ToolExecutionContext
    ) -> ToolResult:
        """读取技能注册表并格式化输出。

        Args:
            arguments: 经 Pydantic 校验的工具入参。
            context: OpenHarness 执行上下文。

        Returns:
            成功时为技能清单文本；失败时为 ``is_error=True`` 的结果。
        """
        try:
            from src.bootstrap.skills_mcp import get_skill_registry

            registry = get_skill_registry()
            if registry is None:
                return ToolResult(output="技能注册表尚未初始化，暂无法列出技能。", is_error=True)

            all_skills = registry.list_all()
            keyword = (arguments.keyword or "").strip().lower()
            if keyword:
                filtered = [
                    s
                    for s in all_skills
                    if keyword in str(getattr(s, "skill_id", "")).lower()
                    or keyword in str(getattr(s, "name", "")).lower()
                    or keyword in str(getattr(s, "description", "")).lower()
                ]
            else:
                filtered = list(all_skills)

            # 稳定排序：按 skill_id，便于 LLM 稳定引用
            filtered.sort(key=lambda s: str(getattr(s, "skill_id", "")))
            return ToolResult(output=_format_skills(filtered, limit=arguments.limit))
        except Exception as exc:  # noqa: BLE001 - 安全降级，避免中断助手对话
            logger.warning(
                "list_skills failed",
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )
            return ToolResult(output=f"列出技能失败：{exc}", is_error=True)
