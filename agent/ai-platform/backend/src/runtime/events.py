"""AgentEvent 类型定义 — 统一的流式事件协议。

所有运行时输出都作为 AsyncIterable[AgentEvent] 流发出。
Gateway 的 EventTransformer 将这些事件映射为各渠道特定的格式。
"""

from __future__ import annotations
from typing import Any

from enum import Enum

from pydantic import BaseModel, Field

from src.utils.logging import get_logger

logger = get_logger("runtime.events")


class AgentEventType(str, Enum):
    """所有 AgentEvent 类型的枚举。"""

    TEXT_DELTA = "text.delta"
    TOOL_CALL = "tool.call"
    TOOL_RESULT = "tool.result"
    UI_RENDER = "ui.render"
    APPROVAL_REQUEST = "approval.request"
    ERROR = "error"
    DONE = "done"
    # 追加在末尾：Coordinator 委派轨迹（通道 C，默认关闭，C4 前端就绪后再开）。
    # 既有取值一律不改，保证 Gateway / BFF / 前端的现网映射零回归。
    DISPATCH_TRACE = "dispatch.trace"


# ============================================================================
# A2UI 组件目录（与前端 H5 组件注册表双向登记）
# ============================================================================
#
# 后端通过 ``AgentEvent.ui_render(component, props)`` 产出生成式 UI 描述，
# ``component`` 取值必须来自下方白名单；前端
# ``frontend/src/components/a2ui/registry.ts`` 维护与之 1:1 对应的
# React 组件注册表。两端组件名严格一致，新增组件须同步登记。
#
# 约定（见 docs/ai-fusion/ai-fusion-deploy-decision.md §决策二 / DEP-9）：
# - 命名语义化、版本无关（如 ``approval-card``、``data-table``、``form-sheet``）
# - ``props`` 为纯 JSON，前端渲染前做白名单字段校验 + 防注入
# - 后端只给「描述」，前端决定「怎么画」
#
# 口径（docs/ai-fusion/a2ui/02-task-breakdown.md §4）：catalogId = mis-a2ui-catalog-v1，
# 与 Gateway `a2ui/types.ts` 的 A2UI_CATALOG_ID 逐字一致（协议版本锚点）。
A2UI_CATALOG_ID: str = "mis-a2ui-catalog-v1"

A2UI_COMPONENTS: frozenset[str] = frozenset(
    {
        "approval-card",  # 审批卡片（纯展示 + 可选操作按钮）
        "data-table",     # 数据表格（只读展示）
        "form-sheet",     # 表单（字段 + 提交按钮）
        "entity-select",  # 实体选择卡片（HITL：候选实体单选 + 确认/手动/取消）
    }
)
"""首期支持的 A2UI 组件名集合（与前端注册表双向登记）。"""


class TokenUsage(BaseModel):
    """单次 LLM 调用的 token 用量。"""

    prompt: int = Field(default=0, description="Prompt token 数量")
    completion: int = Field(default=0, description="Completion token 数量")
    total: int = Field(default=0, description="总 token 数量")

    def __add__(self, other: TokenUsage) -> TokenUsage:
        """将两个 TokenUsage 实例相加（用于累加流式片段）。"""
        return TokenUsage(
            prompt=self.prompt + other.prompt,
            completion=self.completion + other.completion,
            total=self.total + other.total,
        )


class AgentEvent(BaseModel):
    """
    Agent 流式协议中的统一事件。

    每个事件都有一个 `type` 字段，以及根据类型填充的可选字段：
    - text.delta:       content
    - tool.call:        tool_name、args
    - tool.result:      tool_name、result
    - ui.render:        component、props
    - approval.request: skill_id、detail
    - error:            error_code、message
    - done:             token_usage、message_id、session_id
    - dispatch.trace:   trace（Coordinator 委派轨迹，默认不产出）

    ``done`` 的 ``message_id`` / ``session_id`` 为评价锚点（feedback-enhance §2.2
    方案 C）：分别透传本轮 assistant 消息 UUID 与平台会话 UUID，与
    ``agent_feedback`` 表 ``UNIQUE(session_id, message_id)`` 唯一约束对齐。
    均为可选字段，不传时既有事件序列化结果不变（零回归）。
    """

    type: AgentEventType
    content: str | None = None
    tool_name: str | None = None
    args: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    
    # ui.render：前端要渲染的组件名（如卡片、表单）
    component: str | None = None
    # ui.render：传给该组件的属性/数据
    props: dict[str, Any] | None = None
    # approval.request：触发人机审批的 Skill ID
    skill_id: str | None = None
    error_code: str | None = None
    message: str | None = None
    token_usage: TokenUsage | None = None
    # dispatch.trace：本轮 Coordinator 委派轨迹（{"entries": [...]}）。
    # 新增**可选**字段，默认 None → 既有事件的序列化结果不变。
    trace: dict[str, Any] | None = None
    # done：评价锚点（feedback-enhance §2.2 方案 C）——本轮 assistant 消息 UUID，
    # 与 session_manager.add_message(message_id=...) 落库的 agent_session_message.id 一致。
    message_id: str | None = None
    # done：平台会话 UUID（sessionId），与 message_id 共同构成 agent_feedback 定位键。
    session_id: str | None = None

    @classmethod
    def text_delta(cls, content: str) -> AgentEvent:
        """创建一个 text.delta 事件。"""
        return cls(type=AgentEventType.TEXT_DELTA, content=content)

    @classmethod
    def tool_call(cls, tool_name: str, args: dict[str, Any]) -> AgentEvent:
        """创建一个 tool.call 事件。"""
        return cls(type=AgentEventType.TOOL_CALL, tool_name=tool_name, args=args)

    @classmethod
    def tool_result(cls, tool_name: str, result: dict[str, Any]) -> AgentEvent:
        """创建一个 tool.result 事件。"""
        return cls(type=AgentEventType.TOOL_RESULT, tool_name=tool_name, result=result)

    @classmethod
    def ui_render(cls, component: str, props: dict[str, Any]) -> AgentEvent:
        """创建一个 ui.render 事件。

        Args:
            component: A2UI 组件名（须登记于 ``A2UI_COMPONENTS``）。
            props: 传给组件的纯数据 JSON。

        Raises:
            ValueError: ``component`` 未登记在 ``A2UI_COMPONENTS`` 时（双向登记约束）。
        """
        if component not in A2UI_COMPONENTS:
            logger.warning(
                "ui_render 使用了未登记的组件名",
                component=component,
                registered=sorted(A2UI_COMPONENTS),
            )
        return cls(type=AgentEventType.UI_RENDER, component=component, props=props)

    @classmethod
    def approval_request(cls, skill_id: str, detail: dict[str, Any]) -> AgentEvent:
        """创建一个 approval.request 事件。"""
        return cls(type=AgentEventType.APPROVAL_REQUEST, skill_id=skill_id, detail=detail)  # type: ignore[call-arg]

    @classmethod
    def error(cls, error_code: str, message: str) -> AgentEvent:
        """创建一个 error 事件。"""
        return cls(type=AgentEventType.ERROR, error_code=error_code, message=message)

    @classmethod
    def done(
        cls,
        token_usage: TokenUsage | None = None,
        *,
        message_id: str | None = None,
        session_id: str | None = None,
    ) -> AgentEvent:
        """创建一个 done 事件。

        Args:
            token_usage: 本轮 token 用量（可选）。
            message_id: 本轮 assistant 消息 UUID（评价锚点，可选；不传则
                done 事件不含 messageId，前端评价按钮降级禁用）。
            session_id: 平台会话 UUID（评价锚点，可选）。

        Returns:
            ``done`` 类型的 AgentEvent。
        """
        return cls(
            type=AgentEventType.DONE,
            token_usage=token_usage,
            message_id=message_id,
            session_id=session_id,
        )

    @classmethod
    def dispatch_trace(cls, entries: list[dict[str, Any]]) -> AgentEvent:
        """创建一个 dispatch.trace 事件（Coordinator 委派轨迹，通道 C）。

        Args:
            entries: 本轮委派轨迹条目列表（`DispatchTraceEntry.model_dump()`）。

        Returns:
            `dispatch.trace` 类型的 AgentEvent，`trace` 字段形如
            ``{"entries": [...]}``。

        Note:
            仅当 ``DISPATCH_TRACE_EVENT_ENABLED=True`` 时才会被运行时产出；
            默认关闭，避免 Gateway ``toH5Event`` 无 default 分支导致语义误标。
        """
        return cls(type=AgentEventType.DISPATCH_TRACE, trace={"entries": entries})


class HealthStatus(BaseModel):
    """运行时或 agent 实例的健康检查结果。"""

    healthy: bool = Field(..., description="组件是否健康")
    details: dict[str, Any] = Field(default_factory=dict, description="额外的健康详情")
    timestamp: str | None = None
