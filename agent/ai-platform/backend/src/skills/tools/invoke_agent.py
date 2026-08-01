"""agent__invoke — 调度智能体委托调用其他 Agent（Copilot 调度器）。

仅应由 ``mis-copilot`` 暴露。白名单目标：mis-extract / mis-summary / mis-rag / crm-assistant。
深度限制 depth<=1，禁止递归调度与自调用。
"""

from __future__ import annotations

import asyncio
from contextvars import ContextVar, Token
from typing import Any

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.config import get_settings
from src.runtime.events import AgentEventType
from src.utils.exceptions import AgentNotFoundError, AgentNotRunningError
from src.utils.logging import get_logger

logger = get_logger("skills.invoke_agent")

# 协程内调度深度（防止子 Agent 再 invoke）
_invoke_depth: ContextVar[int] = ContextVar("invoke_agent_depth", default=0)

DEFAULT_WHITELIST: frozenset[str] = frozenset(
    {
        "mis-extract",
        "mis-summary",
        "mis-rag",
        "crm-assistant",
    }
)

# 禁止被委托的调度器自身
FORBIDDEN_TARGETS: frozenset[str] = frozenset({"mis-copilot"})


def get_invoke_depth() -> int:
    """当前协程的 invoke 深度（0 = 顶层 Copilot 工具调用）。"""
    return _invoke_depth.get()


def resolve_whitelist(configured: list[str] | None) -> frozenset[str]:
    """解析配置白名单；空配置回退默认。"""
    if configured:
        return frozenset(a.strip() for a in configured if a and a.strip())
    return DEFAULT_WHITELIST


class InvokeAgentInput(BaseModel):
    """agent__invoke 工具入参。"""

    agent_id: str = Field(
        ...,
        description=(
            "要委托的目标智能体 ID。"
            "允许：mis-extract（字段抽取）、mis-summary（摘要）、"
            "mis-rag（知识检索）、crm-assistant（会员/积分/CRM）。"
        ),
    )
    content: str = Field(
        ...,
        description="交给子智能体的用户任务原文（可含必要上下文，勿臆造业务数据）。",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="透传给子智能体的元数据（如 page_context / capability）。",
    )


class InvokeAgentTool(BaseTool):
    """将当前对话任务委托给白名单内的专用智能体，并返回其文本结果。"""

    name = "agent__invoke"
    description = (
        "将任务委托给专用智能体并返回其结果。"
        "当用户需要：表单字段抽取 → mis-extract；审批/文本摘要 → mis-summary；"
        "制度/知识检索 → mis-rag；会员/积分/客户画像/CRM 查询 → crm-assistant。"
        "通用闲聊、文案撰写请直接回答，不要调用本工具。"
        "填单/补全表单字段请用 formfill__execute，不要用本工具。"
    )
    input_model = InvokeAgentInput

    async def execute(
        self, arguments: InvokeAgentInput, context: ToolExecutionContext
    ) -> ToolResult:
        """校验白名单与深度后，同步跑完子 Agent 并汇总文本结果。"""
        settings = get_settings()
        whitelist = resolve_whitelist(settings.INVOKE_AGENT_WHITELIST)
        max_depth = max(1, int(settings.INVOKE_AGENT_MAX_DEPTH or 1))
        timeout_s = max(5, int(settings.INVOKE_AGENT_TIMEOUT_SECONDS or 120))

        agent_id = (arguments.agent_id or "").strip()
        content = (arguments.content or "").strip()
        if not agent_id:
            return ToolResult(output="agent_id 不能为空", is_error=True)
        if not content:
            return ToolResult(output="content 不能为空", is_error=True)

        depth = get_invoke_depth()
        if depth >= max_depth:
            return ToolResult(
                output=(
                    f"调度深度超限（depth={depth}，max={max_depth}）："
                    "禁止子智能体再次委托其他智能体。"
                ),
                is_error=True,
            )

        if agent_id in FORBIDDEN_TARGETS:
            return ToolResult(
                output=f"禁止委托调度器自身或其他调度 Agent：{agent_id}",
                is_error=True,
            )
        if agent_id not in whitelist:
            allowed = ", ".join(sorted(whitelist))
            return ToolResult(
                output=f"目标智能体不在白名单：{agent_id}。允许：{allowed}",
                is_error=True,
            )

        meta = context.metadata or {}
        identity = meta.get("identity") if isinstance(meta.get("identity"), dict) else {}
        parent_session_id = str(meta.get("session_id") or "")

        # 懒导入，避免 tool_registry_builder ↔ agent.manager 循环依赖
        from src.agent.session import get_session_manager

        session_manager = get_session_manager()
        parent = None
        if parent_session_id:
            try:
                parent = await session_manager.get_session(parent_session_id)
            except Exception:
                parent = None

        user_id = (
            (identity.get("userId") or "").strip()
            or (parent.user_id if parent else "")
            or "mis-user"
        )
        channel = (
            (identity.get("channel") or "").strip()
            or (parent.channel if parent else "")
            or "mis_bff"
        )
        user_mobile = (
            (identity.get("userMobile") or "").strip()
            or (getattr(parent, "user_mobile", "") if parent else "")
        )
        channel_user_id = (
            (identity.get("channelUserId") or "").strip()
            or (getattr(parent, "channel_user_id", "") if parent else "")
            or user_id
        )

        child_meta: dict[str, Any] = dict(arguments.metadata or {})
        child_meta.setdefault("source", "mis-copilot-delegate")
        child_meta["delegated_from"] = "mis-copilot"
        if parent_session_id:
            child_meta["parent_session_id"] = parent_session_id

        token: Token[int] = _invoke_depth.set(depth + 1)
        try:
            try:
                text = await asyncio.wait_for(
                    _run_child_agent(
                        agent_id=agent_id,
                        content=content,
                        metadata=child_meta,
                        user_id=user_id,
                        channel=channel,
                        user_mobile=user_mobile,
                        channel_user_id=channel_user_id,
                    ),
                    timeout=timeout_s,
                )
            except TimeoutError:
                return ToolResult(
                    output=f"子智能体 {agent_id} 调用超时（>{timeout_s}s）",
                    is_error=True,
                )
            except AgentNotFoundError:
                return ToolResult(
                    output=f"目标智能体不存在或未加载：{agent_id}",
                    is_error=True,
                )
            except AgentNotRunningError:
                return ToolResult(
                    output=f"目标智能体未运行：{agent_id}",
                    is_error=True,
                )
            except Exception as exc:
                logger.warning(
                    "invoke_agent failed",
                    agent_id=agent_id,
                    error=str(exc),
                    exc_type=exc.__class__.__name__,
                )
                return ToolResult(
                    output=f"委托 {agent_id} 失败：{exc}",
                    is_error=True,
                )
        finally:
            _invoke_depth.reset(token)

        return ToolResult(output=text)


async def _run_child_agent(
    *,
    agent_id: str,
    content: str,
    metadata: dict[str, Any],
    user_id: str,
    channel: str,
    user_mobile: str,
    channel_user_id: str,
) -> str:
    """创建子会话、跑完子 Agent，返回汇总文本（含工具错误提示）。"""
    from src.agent.manager import get_agent_manager
    from src.agent.session import Message, get_session_manager

    session_manager = get_session_manager()
    agent_manager = get_agent_manager()

    child_session = await session_manager.create_session(
        agent_id=agent_id,
        user_id=user_id,
        channel=channel,
    )
    child_session.user_mobile = user_mobile or ""
    child_session.channel_user_id = channel_user_id or user_id
    # 标记委托会话，便于排障
    child_session.state["delegated_from"] = "mis-copilot"
    child_session.state["parent_hint"] = metadata.get("parent_session_id")
    await session_manager.save_session(child_session)

    instance = await agent_manager.ensure_agent_ready(agent_id)

    response_parts: list[str] = []
    tool_errors: list[str] = []
    runtime_error: str | None = None

    async for event in instance.process_message(
        session=child_session,
        message=Message(role="user", content=content, metadata=metadata),
    ):
        if event.type == AgentEventType.TEXT_DELTA and event.content:
            response_parts.append(event.content)
        elif event.type == AgentEventType.TOOL_RESULT and event.result:
            err: Any | None = event.result.get("error")
            if err:
                tool_errors.append(f"{event.tool_name}: {err}")
        elif event.type == AgentEventType.ERROR:
            runtime_error = event.message or "Agent runtime error"

    text = "".join(response_parts).strip()

    if runtime_error:
        raise RuntimeError(runtime_error)

    if not text and tool_errors:
        # 典型：crm-assistant MCP 未连接时工具失败且无正文
        hint = "；".join(tool_errors)
        if agent_id == "crm-assistant":
            raise RuntimeError(
                f"CRM 工具调用失败（请确认 mcp-api-suite / :3333 可用）：{hint}"
            )
        raise RuntimeError(f"子智能体工具失败：{hint}")

    if not text:
        return f"（{agent_id} 未返回文本内容）"

    if tool_errors:
        return f"{text}\n\n[工具告警] " + "；".join(tool_errors)

    logger.info(
        "invoke_agent completed",
        agent_id=agent_id,
        child_session_id=child_session.session_id,
        response_chars=len(text),
    )
    return text
