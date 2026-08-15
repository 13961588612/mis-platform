"""SkillBuilderService 单测（C 功能「AI 对话创建」后端驱动）。

覆盖范围（对应设计 docs/agent/skill-ai-create/system_design.md 决策 A/B/C + T02）：
- build() 组装 messages 调 LLM 网关，reply 原样回传（含 ```SKILL.md 代码块）；
- **ephemeral 硬约束**：不碰 agent_session / agent_session_message，不碰 DB（PG）；
- 系统提示词恒为第一条 system 消息；历史 role 安全映射；user_input 追加为末条 user；
- _detect_converged 收敛判定边界（name + description + 非空正文）；
- 前端 converged 信号作为兜底增强。
"""

from __future__ import annotations

import textwrap
from typing import Any

import pytest

from src.llm.models import LLMRequest, LLMResponse, LLMRole
from src.skills.skill_builder_prompt import SKILL_BUILDER_SYSTEM_PROMPT
from src.skills.skill_builder_service import (
    BuilderChatResponse,
    SkillBuilderService,
    _detect_converged,
)

# ---------------------------------------------------------------------------
# 测试夹具：可断言的假网关
# ---------------------------------------------------------------------------

#: 一份完整的 SKILL.md（裸文本，无代码块围栏）。
RAW_SKILL_MD = textwrap.dedent(
    """
    ---
    name: 会员积分查询
    description: 当用户想查询会员积分余额、等级或明细时调用。
    category: member
    tags: [查询, 只读]
    handler: mcp:crm-server:query_points
    ---

    ## 目标
    帮助用户按会员 ID 查询积分余额、等级与近期积分变动。

    ## 执行流程
    1. 解析 member_id。
    2. 调用 handler 拉取积分数据。
    """
).strip()

#: LLM 真实产出形态：系统提示词强制要求用 ```SKILL.md 围栏包裹（见 skill_builder_prompt）。
FENCED_SKILL_MD = f"```SKILL.md\n{RAW_SKILL_MD}\n```"


class FakeGateway:
    """记录调用的假 LLM 网关（避免真实出网）。"""

    def __init__(self, content: str = FENCED_SKILL_MD) -> None:
        self.content = content
        self.calls: list[LLMRequest] = []

    async def chat(self, request: LLMRequest) -> LLMResponse:
        self.calls.append(request)
        return LLMResponse(content=self.content)


@pytest.fixture
def no_persistence(monkeypatch: pytest.MonkeyPatch) -> None:
    """把会话/DB 的入口全部换成「一碰就炸」，用于证明 ephemeral 约束（决策 B）。

    覆盖 PG 事务上下文与会话仓库单例两个入口：C 功能若偷偷落库，必然经过其一。
    """
    import src.agent.session_store as session_store
    import src.db.session as db_session

    def _boom(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError(
            "ephemeral 约束被破坏：builder chat 不得触碰 agent_session / DB"
        )

    monkeypatch.setattr(db_session, "db_session_context", _boom, raising=False)
    monkeypatch.setattr(session_store, "get_session_pg_store", _boom, raising=False)


# ---------------------------------------------------------------------------
# build()：基本契约
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_returns_reply_containing_skill_md_block() -> None:
    """reply 原样回传 LLM 文本，含 ```SKILL.md 代码块（前端据此抽取）。"""
    gateway = FakeGateway()
    service = SkillBuilderService(gateway)

    result: BuilderChatResponse = await service.build(
        messages=[], user_input="我要一个查会员积分的技能", converged=False
    )

    assert isinstance(result, BuilderChatResponse)
    assert "```SKILL.md" in result.reply
    assert "name: 会员积分查询" in result.reply
    assert result.reply == FENCED_SKILL_MD


@pytest.mark.asyncio
async def test_build_response_shape_matches_frontend_contract() -> None:
    """model_dump() 形状必须与前端 SkillBuilderChatResponse 对齐：reply/status/converged。"""
    service = SkillBuilderService(FakeGateway())
    result = await service.build(messages=[], user_input="x", converged=False)

    dumped = result.model_dump()
    assert set(dumped.keys()) == {"reply", "status", "converged"}
    assert isinstance(dumped["reply"], str)
    assert dumped["status"] in ("generating", "generated")
    assert isinstance(dumped["converged"], bool)


@pytest.mark.asyncio
async def test_build_does_not_touch_session_or_db(no_persistence: None) -> None:
    """**ephemeral 硬约束（决策 B）**：不建/不读/不写 agent_session，不碰 PG。"""
    gateway = FakeGateway()
    service = SkillBuilderService(gateway)

    result = await service.build(
        messages=[{"role": "user", "content": "第一轮"}],
        user_input="第二轮",
        converged=False,
    )

    # 未抛 AssertionError 即证明没走会话/DB 入口；同时确认确实调了 LLM 网关。
    assert result.reply == FENCED_SKILL_MD
    assert len(gateway.calls) == 1


@pytest.mark.asyncio
async def test_build_prepends_system_prompt_and_appends_user_input() -> None:
    """系统提示词恒为首条；历史消息按序透传；user_input 追加为末条 user。"""
    gateway = FakeGateway()
    service = SkillBuilderService(gateway)

    await service.build(
        messages=[
            {"role": "user", "content": "帮我建个技能"},
            {"role": "assistant", "content": "请问目标系统是？"},
        ],
        user_input="CRM",
        converged=False,
    )

    msgs = gateway.calls[0].messages
    assert msgs[0].role == LLMRole.SYSTEM
    assert msgs[0].content == SKILL_BUILDER_SYSTEM_PROMPT
    assert [m.role for m in msgs[1:]] == [LLMRole.USER, LLMRole.ASSISTANT, LLMRole.USER]
    assert msgs[1].content == "帮我建个技能"
    assert msgs[2].content == "请问目标系统是？"
    assert msgs[-1].content == "CRM"


@pytest.mark.asyncio
async def test_build_maps_unknown_role_to_user_and_skips_non_dict() -> None:
    """未知 role 回落 user；非 dict 脏数据跳过（前端上送不可信）。"""
    gateway = FakeGateway()
    service = SkillBuilderService(gateway)

    await service.build(
        messages=[
            {"role": "weird-role", "content": "A"},
            "我不是 dict",  # type: ignore[list-item]
            {"role": None, "content": "B"},
        ],
        user_input="",
        converged=False,
    )

    msgs = gateway.calls[0].messages
    # system + A + B（脏数据被跳过），user_input 为空不追加
    assert len(msgs) == 3
    assert all(m.role == LLMRole.USER for m in msgs[1:])
    assert [m.content for m in msgs[1:]] == ["A", "B"]


@pytest.mark.asyncio
async def test_build_empty_user_input_not_appended() -> None:
    """user_input 为空串时不追加空消息（避免污染上下文）。"""
    gateway = FakeGateway()
    service = SkillBuilderService(gateway)

    await service.build(messages=[], user_input="", converged=False)

    assert len(gateway.calls[0].messages) == 1  # 仅 system


@pytest.mark.asyncio
async def test_build_empty_llm_content_yields_empty_reply_not_crash() -> None:
    """LLM 回空内容时归一为空串（边界：前端据此提示「未产出 SKILL.md」）。"""
    service = SkillBuilderService(FakeGateway(content=""))

    result = await service.build(messages=[], user_input="x", converged=False)

    assert result.reply == ""
    assert result.converged is False
    assert result.status == "generating"


# ---------------------------------------------------------------------------
# 收敛判定：status / converged
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_marks_generated_when_llm_returns_complete_skill_md() -> None:
    """AI 产出完整 SKILL.md（系统提示词强制的 ```SKILL.md 围栏形态）时应判定收敛。

    契约依据：T02「检测到完整 frontmatter+正文即视为 converged」；
    而 skill_builder_prompt 明确要求模型「只输出一个 fenced code block，语言标识用 SKILL.md」，
    故围栏形态是**主路径**，收敛判定必须能识别它，否则 P1-4「已可回填」提示永不触发。
    """
    service = SkillBuilderService(FakeGateway(content=FENCED_SKILL_MD))

    result = await service.build(messages=[], user_input="定稿", converged=False)

    assert result.converged is True, "围栏包裹的完整 SKILL.md 应判定为已收敛"
    assert result.status == "generated"


@pytest.mark.asyncio
async def test_build_marks_generated_for_unfenced_complete_skill_md() -> None:
    """裸 SKILL.md（无围栏）同样应判定收敛。"""
    service = SkillBuilderService(FakeGateway(content=RAW_SKILL_MD))

    result = await service.build(messages=[], user_input="定稿", converged=False)

    assert result.converged is True
    assert result.status == "generated"


@pytest.mark.asyncio
async def test_build_generating_when_ai_only_asks_clarifying_question() -> None:
    """AI 仅追问澄清（无 SKILL.md）时为 generating、未收敛。"""
    service = SkillBuilderService(FakeGateway(content="请问这个技能要对接哪个系统？"))

    result = await service.build(messages=[], user_input="建技能", converged=False)

    assert result.converged is False
    assert result.status == "generating"


@pytest.mark.asyncio
async def test_build_frontend_converged_flag_is_fallback_enhancement() -> None:
    """前端 converged=True 作为兜底增强：即使正文未检出完整 SKILL.md 也标记收敛。"""
    service = SkillBuilderService(FakeGateway(content="还在追问……"))

    result = await service.build(messages=[], user_input="可以了", converged=True)

    assert result.converged is True
    assert result.status == "generated"


# ---------------------------------------------------------------------------
# _detect_converged 边界（纯函数）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "text", "expected"),
    [
        ("name+description+正文 → 收敛", RAW_SKILL_MD, True),
        (
            "缺 description → 不收敛",
            "---\nname: 只有名字\n---\n\n正文非空",
            False,
        ),
        (
            "缺 name → 不收敛",
            "---\ndescription: 只有描述\n---\n\n正文非空",
            False,
        ),
        (
            "有 name+description 但正文为空 → 不收敛",
            "---\nname: A\ndescription: B\n---\n\n   \n",
            False,
        ),
        ("完全无 Front Matter → 不收敛", "就是一段普通文本", False),
        ("空串 → 不收敛", "", False),
        (
            "字段缩进 + 完整正文 → 收敛",
            "---\n  name: A\n  description: B\n---\n\n正文",
            True,
        ),
    ],
)
def test_detect_converged_boundaries(label: str, text: str, expected: bool) -> None:
    """收敛判据边界：Front Matter 同时含 name 与 description，且正文非空。"""
    assert _detect_converged(text) is expected, label


def test_detect_converged_handles_fenced_skill_md() -> None:
    """围栏形态（系统提示词强制的主路径）也必须被识别为收敛。"""
    assert _detect_converged(FENCED_SKILL_MD) is True


def test_detect_converged_accepts_none_safely() -> None:
    """None 入参不应崩溃（防御性）。"""
    assert _detect_converged(None) is False  # type: ignore[arg-type]
