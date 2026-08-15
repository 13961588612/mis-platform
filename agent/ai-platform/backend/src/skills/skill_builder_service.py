"""无状态技能构建服务（C 功能后端驱动）。

复用平台既有 LLM 网关（``get_llm_gateway().chat()``）直驱一个固定系统提示词的
``SkillBuilderService``，产出符合 Anthropic skill-creator 规范的 SKILL.md。

设计硬约束（决策 A/B）：
- 不复用 mis-copilot coordinator / TaskBrief，避免强制持久会话；
- ephemeral：不创建、不读取、不写入 ``agent_session`` / ``agent_session_message``，
  前端把完整多轮上下文作为请求体上送，本服务无状态；
- 不引入外部 WorkBuddy 技能，复用既有 LLM 集成，不新增接入。
"""

from __future__ import annotations

import re
from typing import Any

from src.llm.gateway import get_llm_gateway
from src.llm.models import LLMMessage, LLMRequest, LLMRole
from src.skills.skill_builder_prompt import SKILL_BUILDER_SYSTEM_PROMPT

# 与 src.skills.spec_parser / api/routes/skill.py 同形：判断文本是否带 Front Matter 分隔符。
_FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


class BuilderChatResponse:
    """AI 对话创建技能的单次响应（与前端 ``SkillBuilderChatResponse`` 对齐）。

    使用普通类 + ``model_dump()`` 而非 pydantic，便于在路由中以
    ``_api_response(0, result.model_dump(), "OK")`` 直接塞进统一信封；
    同时规避与请求模型 ``BuilderChatRequest``（定义在 api/routes/skill.py）的跨模块导入环。
    """

    def __init__(self, reply: str, status: str, converged: bool) -> None:
        self.reply: str = reply
        self.status: str = status
        self.converged: bool = converged

    def model_dump(self) -> dict[str, Any]:
        return {"reply": self.reply, "status": self.status, "converged": self.converged}


def _to_llm_role(role: str) -> LLMRole:
    """把前端/历史消息的 role 字符串安全映射到 LLMRole，未知值回落到 user。"""
    value = (role or "user").lower()
    if value in ("system", "assistant", "user", "tool"):
        return LLMRole(value)
    return LLMRole.USER


def _strip_code_fence(text: str) -> str:
    """剥掉外层 ``` 代码围栏（含任意 info string，如 ``SKILL.md``），返回围栏内内容。

    无围栏时原样返回。与前端 ``extractSkillMd`` 等价：收敛判定的对象应是围栏内的
    SKILL.md 文本，而非被 ```SKILL.md 包裹的原始 reply（见 QA BUG-2）。
    """
    text = (text or "").strip()
    if not text.startswith("```"):
        return text
    body = text[3:]  # 去掉首行开头的 ```
    nl = body.find("\n")
    if nl == -1:
        return ""  # 只有一行（无内容），直接返回空
    body = body[nl + 1:]
    end = body.rfind("```")
    if end != -1:
        body = body[:end]
    return body.strip()


def _detect_converged(skill_md: str) -> bool:
    """检测 SKILL.md 是否已完整：含 ``name`` + ``description`` 的 Front Matter 且正文非空。

    收敛判据（设计待明确项 2 的落地）：Front Matter 同时具备 name 与 description，
    且其后的正文（body）非空，即认为这是一份可回填的成品 SKILL.md。
    先剥围栏（QA BUG-2），再跑现有 Front Matter 判据。
    """
    text = _strip_code_fence(skill_md).strip()
    match = _FRONT_MATTER_RE.match(text)
    if not match:
        return False
    fm_text: str = match.group(1)
    body: str = text[match.end():]
    has_name = re.search(r"^\s*name\s*:", fm_text, re.MULTILINE) is not None
    has_desc = re.search(r"^\s*description\s*:", fm_text, re.MULTILINE) is not None
    return has_name and has_desc and body.strip() != ""


class SkillBuilderService:
    """无状态：每次请求组装完整 messages 调 LLM，不持久化任何内部状态。"""

    def __init__(self, gateway: Any | None = None) -> None:
        # 允许注入（测试 / 显式传入），缺省走单例网关。
        self._gateway = gateway

    async def build(
        self,
        messages: list[dict[str, Any]],
        user_input: str,
        converged: bool = False,
    ) -> BuilderChatResponse:
        """驱动一次 AI 生成。

        Args:
            messages: 历史多轮对话（前端全量维护并上送），每条 ``{role, content}``。
            user_input: 本轮新增的用户输入，追加为最后一条 user 消息。
            converged: 前端提示的收敛信号（如「定稿」），作为检测结果的兜底增强。

        Returns:
            包含 AI 文本 ``reply``、生成状态 ``status``、是否收敛 ``converged`` 的响应。
        """
        gateway = self._gateway or get_llm_gateway()

        llm_messages: list[LLMMessage] = [
            LLMMessage(role=LLMRole.SYSTEM, content=SKILL_BUILDER_SYSTEM_PROMPT),
        ]
        for m in messages:
            if not isinstance(m, dict):
                continue
            content = m.get("content") or ""
            llm_messages.append(LLMMessage(role=_to_llm_role(m.get("role")), content=content))
        if user_input:
            llm_messages.append(LLMMessage(role=LLMRole.USER, content=user_input))

        request = LLMRequest(
            messages=llm_messages,
            temperature=0.4,
            max_tokens=2048,
        )
        response = await gateway.chat(request)
        reply = response.content or ""

        is_converged = _detect_converged(reply) or bool(converged)
        status = "generated" if is_converged else "generating"
        return BuilderChatResponse(reply=reply, status=status, converged=is_converged)
