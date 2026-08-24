"""A2UI run 循环 — Python Agent Core 消费 Gateway 的 ``a2ui_run`` 入站消息。

Gateway ``RedisStreamAgent`` 将 ``A2UIMiddleware`` 处理后的完整 ``RunAgentInput``
（含自动注入的 ``render_a2ui`` 工具 + 组件 Schema，见 ``gateway/src/a2ui/A2UIRuntime.ts``）
序列化到 ``InboundMessage.metadata.a2ui.runAgentInput`` 并写入入站流；本模块消费后：

1. 解析 RunAgentInput（``messages`` / ``model`` / ``tools``）；
2. 驱动 LLM 循环（复用 ``LLMGateway`` 的 OpenAI function-calling 工具能力）；
3. LLM 请求调用 ``render_a2ui`` → 执行 A2UI surface 操作（对照
   ``events.A2UI_COMPONENTS`` 白名单校验 / 归一化，工具事件原样透传给
   Gateway 中间件做实际 surface 生成）；
4. 所有 AgentEvent 经 ``A2uiOutboundPublisher`` XADD 到 ``aip:outbound:{sessionId}``
   （02 文档 §6 时序图：Python 将 A2UI run 的 AgentEvent 写入该会话私有流）；
5. LLM 失败 / 超时 → ``error`` + ``done`` 事件回包（Gateway 靠它们 complete Observable）。

``render_a2ui`` 的 A2UI surface 实际生成由 Gateway ``A2UIMiddleware`` 拦截
``tool.call`` 事件完成（D1：中间件注入工具 + 流式拦截 + 生成恢复循环）。本模块只需：

- 下发 ``tool.call``（携带完整 args，中间件 ``extractCompleteItems`` 渐进提取组件）；
- 校验 / 归一化 args（``surfaceId`` + ``components``，组件名对照 ``A2UI_COMPONENTS``）；
- 下发 ``tool.result`` 供 LLM 继续循环直至结束。

事件回包格式与 Gateway ``EventConverter.ts`` 期望**反向一致**：
``text.delta`` / ``tool.call`` / ``tool.result`` / ``error`` / ``done`` 均为
snake_case AgentEvent JSON，由 ``parseBackendAgentEvent`` 解析（tool_name / error_code 等）。
``done`` 事件额外携带 ``message_id`` / ``session_id``（评价锚点，feedback-enhance
§2.2 方案 C）：``message_id`` 与本轮 assistant 消息在 agent_session_message 落库的
UUID 一致，Gateway ``parseBackendAgentEvent`` → ``EventConverter`` RUN_FINISHED
透传给前端（缺失时前端评价按钮降级禁用）。
"""

from __future__ import annotations
from typing import Any

import json
import uuid
from pathlib import Path

from openharness.tools.base import ToolExecutionContext, ToolRegistry

from src.agent.session import SessionManager, get_session_manager
from src.config import get_settings
from src.llm.gateway import LLMGateway
from src.llm.models import LLMMessage, LLMRequest, LLMRole, LLMResponse
from src.queue.a2ui_outbound import A2uiOutboundPublisher
from src.runtime.events import A2UI_CATALOG_ID, A2UI_COMPONENTS, AgentEvent, TokenUsage
from src.runtime.mcp_identity import build_mcp_identity
from src.utils.exceptions import SessionNotFoundError
from src.utils.logging import get_logger

logger = get_logger("runtime.a2ui_run")

#: Gateway A2UIMiddleware 注入的 A2UI 渲染工具名（与 @ag-ui/a2ui-middleware 一致）
RENDER_A2UI_TOOL_NAME = "render_a2ui"

#: 单轮 A2UI run 的最大 LLM 执行轮数（与 OpenHarness maxSteps 默认一致）
DEFAULT_MAX_TURNS = 10
#: 默认采样温度
DEFAULT_TEMPERATURE = 0.7
#: 默认单次补全 token 上限
DEFAULT_MAX_TOKENS = 4096
#: 会话历史最多携带条数（防上下文无限膨胀）
HISTORY_LIMIT = 30


# ============================================================================
# RunAgentInput → LLM 请求 转换（AG-UI 协议 ↔ 平台 LLM 模型）
# ============================================================================


def _agui_content_to_text(content: Any) -> str:
    """将 AG-UI 消息 content（字符串 / 内容块数组）规约为纯文本。

    Args:
        content: AG-UI Message 的 ``content`` 字段。

    Returns:
        拼接后的文本；无法识别时 ``str()`` 兜底。
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str) and text:
                    parts.append(text)
                elif isinstance(text, list):
                    for item in text:
                        if isinstance(item, str):
                            parts.append(item)
        return "\n".join(parts)
    return str(content)


def _tool_call_to_api(tool_call: Any) -> dict[str, Any]:
    """将 AG-UI ToolCall 转为 OpenAI function-calling 格式。

    兼容两种 AG-UI 承载（**优先嵌套风格**，QA B1）：
    - 嵌套（AG-UI 真实 ToolCall / A2UIMiddleware.processUserAction 合成消息）：
      ``{id, type: 'function', function: {name, arguments}}``；
    - 扁平（历史 / 宽松输入）：``{id, name, input|arguments}``。

    Args:
        tool_call: AG-UI 工具调用描述（dict）。

    Returns:
        OpenAI 格式 ``{id, type, function: {name, arguments}}``；
        无法识别时返回空 dict。
    """
    if not isinstance(tool_call, dict):
        return {}

    tool_call_id: str = str(tool_call.get("id") or "")
    function: Any = tool_call.get("function")
    if isinstance(function, dict):
        # 嵌套风格：name/arguments 从 function 内取（arguments 可能是 JSON 字符串或对象）
        raw_args: Any = function.get("arguments", "{}")
        name: Any = function.get("name")
    else:
        # 扁平风格：{id, name, input|arguments}
        raw_args = tool_call.get("input", tool_call.get("arguments", "{}"))
        name = tool_call.get("name")

    if isinstance(raw_args, (dict, list)):
        args_str: str = json.dumps(raw_args, ensure_ascii=False)
    elif isinstance(raw_args, str):
        args_str = raw_args
    else:
        args_str = "{}"
    return {
        "id": tool_call_id,
        "type": "function",
        "function": {
            "name": str(name or ""),
            "arguments": args_str,
        },
    }


def agui_messages_to_llm(messages: list[dict[str, Any]]) -> list[LLMMessage]:
    """将 RunAgentInput.messages（AG-UI 格式）转换为平台 ``LLMMessage`` 列表。

    兼容 system / user / assistant（含 tool_calls）/ tool 四种角色；assistant 的
    ``tool_calls`` 转为 OpenAI function-calling 格式（``LLMMessage.to_api_dict`` 消费）。

    Args:
        messages: RunAgentInput 的消息数组。

    Returns:
        平台 LLM 消息列表。
    """
    result: list[LLMMessage] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role: str = str(msg.get("role") or "user")
        content: str = _agui_content_to_text(msg.get("content"))
        if role == "system":
            result.append(LLMMessage(role=LLMRole.SYSTEM, content=content))
        elif role == "assistant":
            tool_calls: list[dict[str, Any]] = []
            for tc in msg.get("tool_calls") or []:
                api_tc: dict[str, Any] = _tool_call_to_api(tc)
                if api_tc:
                    tool_calls.append(api_tc)
            result.append(
                LLMMessage(
                    role=LLMRole.ASSISTANT,
                    content=content,
                    tool_calls=tool_calls,
                )
            )
        elif role == "tool":
            result.append(
                LLMMessage(
                    role=LLMRole.TOOL,
                    content=content,
                    tool_call_id=str(msg.get("tool_call_id") or ""),
                )
            )
        else:
            result.append(LLMMessage(role=LLMRole.USER, content=content))
    return result


def agui_tools_to_openai_tools(tools: list[Any]) -> list[dict[str, Any]]:
    """将 RunAgentInput.tools（AG-UI ``{name, description, parameters}``）转为
    OpenAI function-calling 工具 schema 列表（``LLMRequest.tools`` 消费）。

    Args:
        tools: AG-UI 工具定义数组（含中间件注入的 ``render_a2ui``）。

    Returns:
        OpenAI 格式工具列表；非法条目跳过。
    """
    result: list[dict[str, Any]] = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        name: Any = tool.get("name")
        if not isinstance(name, str) or not name:
            continue
        parameters: Any = tool.get("parameters")
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}
        result.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": str(tool.get("description") or ""),
                    "parameters": parameters,
                },
            }
        )
    return result


def _parse_tool_args(raw_args: Any) -> dict[str, Any]:
    """将 LLM 返回的 tool 入参（JSON 字符串或对象）规约为 dict。

    Args:
        raw_args: ``function.arguments`` 原始值。

    Returns:
        解析后的参数 dict；无法解析时返回空 dict。
    """
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str):
        try:
            parsed: Any = json.loads(raw_args)
        except (json.JSONDecodeError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


# ============================================================================
# render_a2ui 工具执行（A2UI surface 操作）
# ============================================================================


async def execute_render_a2ui(
    args: dict[str, Any], *, session_id: str = ""
) -> dict[str, Any]:
    """执行 ``render_a2ui`` 工具：校验 / 归一化 A2UI surface 描述并返回执行结果。

    Gateway ``A2UIMiddleware`` 会拦截 ``tool.call`` 事件中的完整 args 生成 A2UI
    surface（D1 权威源）；本函数只做**最小语义校验**（``surfaceId`` + ``components``）
    与组件名白名单告警（对照 ``A2UI_COMPONENTS``），并返回 ``tool.result`` 供
    LLM 继续循环。未知组件名不阻断（Gateway catalog 校验仍会执行），仅告警。

    Args:
        args: render_a2ui 工具入参（``{surfaceId, components, data?}``）。
        session_id: 会话 ID（仅日志）。

    Returns:
        执行结果 dict：``{"ok": True, "status": "rendered", ...}`` 或
        ``{"ok": False, "error": "..."}``。
    """
    if not isinstance(args, dict):
        return {"ok": False, "error": "render_a2ui 入参必须是对象"}
    surface_id: Any = args.get("surfaceId") or args.get("surface_id")
    components: Any = args.get("components")
    if not isinstance(surface_id, str) or not surface_id:
        return {"ok": False, "error": "render_a2ui 缺少 surfaceId"}
    if not isinstance(components, list):
        return {"ok": False, "error": "render_a2ui 缺少 components 数组"}

    unknown: list[str] = []
    for comp in components:
        if isinstance(comp, dict):
            name: Any = comp.get("component")
            if isinstance(name, str) and name and name not in A2UI_COMPONENTS:
                unknown.append(name)
    if unknown:
        logger.warning(
            "render_a2ui 包含未登记组件名（Gateway catalog 权威校验仍会执行）",
            session_id=session_id,
            surface_id=surface_id,
            unknown=sorted(set(unknown)),
            registered=sorted(A2UI_COMPONENTS),
        )
    return {
        "ok": True,
        "status": "rendered",
        "surfaceId": surface_id,
        "componentCount": len(components),
        "catalogId": A2UI_CATALOG_ID,
    }


# ============================================================================
# A2UI run 循环
# ============================================================================


class A2uiRunLoop:
    """按 RunAgentInput 驱动 LLM 循环，事件回包到 ``aip:outbound:{sessionId}``。

    循环语义：每轮调用 ``LLMGateway.chat``（带 tools）；有 ``tool_calls`` 则逐条
    下发 ``tool.call`` / 执行 / ``tool.result`` 并追加消息继续；无工具调用即收尾。
    会话历史经 ``SessionManager`` 按 sessionId 持久化（Gateway 每轮只下发最新用户
    消息，多轮上下文由本循环维护）。
    """

    def __init__(
        self,
        gateway: LLMGateway,
        publisher: A2uiOutboundPublisher,
        *,
        model: str | None = None,
        max_turns: int = DEFAULT_MAX_TURNS,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        session_manager: SessionManager | None = None,
        tool_registry: ToolRegistry | None = None,
    ) -> None:
        """初始化 A2UI run 循环。

        Args:
            gateway: 平台 ``LLMGateway`` 实例。
            publisher: A2UI 出站发布器（写 ``aip:outbound:{sessionId}``）。
            model: 默认模型名；未指定用配置 ``LLM_PRIMARY_MODEL``。
            max_turns: 最大 LLM 执行轮数（防死循环）。
            temperature: 采样温度。
            max_tokens: 单次补全 token 上限。
            session_manager: 会话管理器（测试可注入替身；缺省全局单例）。
            tool_registry: 平台工具注册表（skill/mcp 分发，含 ACL 包装）；
                测试可注入替身；缺省按 Agent 配置懒装配（见 ``_ensure_tool_registry``）。
        """
        self._gateway = gateway
        self._publisher = publisher
        self._settings = get_settings()
        self._model = model or self._settings.LLM_PRIMARY_MODEL
        self._max_turns = max_turns or DEFAULT_MAX_TURNS
        self._temperature = temperature
        self._max_tokens = max_tokens or DEFAULT_MAX_TOKENS
        self._session_manager = session_manager
        self._tool_registry = tool_registry

    # ------------------------------------------------------------------ 主入口

    async def run(
        self,
        *,
        session_id: str,
        user_id: str = "",
        trace_id: str = "",
        agent_id: str | None = None,
        mis_user_id: int | None = None,
        run_agent_input: dict[str, Any],
    ) -> None:
        """执行一轮 A2UI run 并回包事件流。

        事件顺序（与 Gateway EventConverter 期望一致）：``tool.call`` /
        ``text.delta`` → ``tool.result`` → … → ``done``（成功）或 ``error`` +
        ``done``（失败）。会话历史按 sessionId 持久化（首轮建会话）。

        Args:
            session_id: 会话 ID（= Gateway RunAgentInput.threadId）。
            user_id: 用户 ID（JWT 验签结果，P4 身份来源）。
            trace_id: 分布式追踪 ID。
            agent_id: 会话绑定的 Agent ID（建会话用；缺省取默认 Agent）。
            mis_user_id: MIS userId（T03 S9 第五键）；skill/mcp 工具 ACL
                fail-closed 判权的唯一身份来源；``None`` 时工具执行按无身份拒绝。
            run_agent_input: ``metadata.a2ui.runAgentInput``（RunAgentInput dict）。
        """
        messages: list[dict[str, Any]] = run_agent_input.get("messages") or []
        tools: list[Any] = run_agent_input.get("tools") or []
        model: str = str(run_agent_input.get("model") or self._model)
        # 工具执行身份（P4：只来自 JWT 验签结果 + 上游解析的 misUserId）。
        identity: dict[str, str] = build_mcp_identity(
            user_id=user_id,
            channel="h5",
            mis_user_id=mis_user_id,
        )

        history: list[LLMMessage] = await self._load_history(
            session_id, user_id=user_id, agent_id=agent_id
        )
        llm_messages: list[LLMMessage] = history + agui_messages_to_llm(messages)
        if not llm_messages:
            # 空输入兜底：避免调用 LLM，直接回包空文本 + done
            await self._publisher.publish(
                session_id, AgentEvent.text_delta("（空消息）")
            )
            await self._publisher.publish(session_id, AgentEvent.done())
            return

        # 持久化本轮用户文本（工具/系统消息不入历史，保持上下文干净）
        for msg in messages:
            if isinstance(msg, dict) and msg.get("role") == "user":
                user_text: str = _agui_content_to_text(msg.get("content")).strip()
                if user_text:
                    await self._persist_user(session_id, user_text)

        openai_tools: list[dict[str, Any]] = agui_tools_to_openai_tools(tools)
        total_usage: TokenUsage = TokenUsage()
        assistant_parts: list[str] = []
        error_message: str | None = None
        completed: bool = False

        for turn in range(1, self._max_turns + 1):
            try:
                response: LLMResponse = await self._gateway.chat(
                    LLMRequest(
                        messages=llm_messages,
                        model=model,
                        temperature=self._temperature,
                        max_tokens=self._max_tokens,
                        tools=openai_tools,
                        tool_choice="auto" if openai_tools else "none",
                        session_id=session_id,
                        user_id=user_id,
                    )
                )
            except Exception as exc:  # noqa: BLE001 - LLM 失败统一回 error 事件
                logger.error(
                    "A2UI LLM call failed",
                    session_id=session_id,
                    turn=turn,
                    error=str(exc),
                    exc_info=True,
                )
                error_message = f"LLM 调用失败：{exc}"
                break

            if response.usage.total_tokens > 0:
                total_usage += TokenUsage(
                    prompt=response.usage.prompt_tokens,
                    completion=response.usage.completion_tokens,
                    total=response.usage.total_tokens,
                )

            if response.content:
                assistant_parts.append(response.content)
                await self._publisher.publish(
                    session_id, AgentEvent.text_delta(response.content)
                )

            if not response.tool_calls:
                completed = True
                break

            llm_messages.append(
                LLMMessage(
                    role=LLMRole.ASSISTANT,
                    content=response.content or "",
                    tool_calls=response.tool_calls,
                )
            )

            processed: bool = False
            for tc in response.tool_calls:
                function: Any = tc.get("function") if isinstance(tc, dict) else None
                if not isinstance(function, dict):
                    continue
                tool_name: str = str(function.get("name") or "")
                tool_call_id: str = str(tc.get("id") or "")
                args: dict[str, Any] = _parse_tool_args(function.get("arguments", "{}"))
                processed = True
                await self._publisher.publish(
                    session_id, AgentEvent.tool_call(tool_name, args)
                )
                result: dict[str, Any] = await self._execute_tool(
                    tool_name, args, session_id, identity=identity, agent_id=agent_id
                )
                await self._publisher.publish(
                    session_id, AgentEvent.tool_result(tool_name, result)
                )
                llm_messages.append(
                    LLMMessage(
                        role=LLMRole.TOOL,
                        content=json.dumps(result, ensure_ascii=False),
                        tool_call_id=tool_call_id,
                    )
                )
            if not processed:
                error_message = "A2UI run 工具调用格式无法解析"
                break
            # 本轮有工具调用 → 继续下一轮 LLM（直到无工具调用或达到轮数上限）

        if not completed and error_message is None:
            error_message = f"A2UI run 达到最大执行轮数（{self._max_turns}）"

        if error_message is not None:
            logger.warning(
                "A2UI run failed",
                session_id=session_id,
                error=error_message,
            )
            await self._publisher.publish_error(
                session_id, "A2UI_RUN_ERROR", error_message
            )
            return

        assistant_text: str = "".join(assistant_parts).strip()
        # 评价锚点（feedback-enhance §2.2 方案 C）：预生成 assistant 消息 UUID，
        # 落库（_persist_assistant → add_message(message_id=...)）与 done 事件
        # 透传共用同一 UUID，保证 agent_feedback 评价回放能精确命中该条消息。
        assistant_message_id: str | None = None
        if assistant_text:
            assistant_message_id = str(uuid.uuid4())
            await self._persist_assistant(
                session_id, assistant_text, message_id=assistant_message_id
            )

        await self._publisher.publish(
            session_id,
            AgentEvent.done(
                total_usage,
                message_id=assistant_message_id,
                session_id=session_id,
            ),
        )

    # ------------------------------------------------------------------ 工具执行

    async def _execute_tool(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_id: str,
        *,
        identity: dict[str, str] | None = None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """执行单个 LLM 工具调用并返回 ``tool.result`` 载荷。

        ``render_a2ui`` 走内置执行器（A2UI surface 操作）；``skill`` /
        ``mcp__*`` 等平台工具走 OpenHarness 平台工具注册表 —— 复用存量文本通道
        的装配方式（``create_platform_tool_registry`` + ``AclToolWrapper``
        fail-closed 判权），按 Agent 配置装配 allowed_tools 白名单后真实执行，
        结果回 ``tool.result``。权限不足 / 工具不存在 / 入参非法均返回明确 error
        载荷（``code`` 字段供前端/运维定位），**不中断** LLM 循环。

        Args:
            tool_name: 工具名。
            args: 工具入参（已解析 dict）。
            session_id: 会话 ID。
            identity: 工具执行身份（含 ``misUserId`` 第五键）；缺省空身份（fail-closed）。
            agent_id: Agent ID（懒装配注册表时使用）。

        Returns:
            ``tool.result`` 载荷 dict。
        """
        if tool_name == RENDER_A2UI_TOOL_NAME:
            return await execute_render_a2ui(args, session_id=session_id)

        registry: ToolRegistry | None = await self._ensure_tool_registry(agent_id)
        tool: Any = registry.get(tool_name) if registry is not None else None
        if tool is None:
            logger.warning(
                "A2UI run 收到未注册的工具调用",
                tool=tool_name,
                session_id=session_id,
                agent_id=agent_id,
            )
            return {
                "ok": False,
                "code": "TOOL_NOT_FOUND",
                "error": f"tool not found in a2ui run: {tool_name}",
            }

        # 经 Pydantic 输入模型校验（与 OpenHarness 执行路径一致；非法入参明确报错）。
        try:
            arguments: Any = (
                tool.input_model(**args) if isinstance(args, dict) else tool.input_model()
            )
        except Exception as exc:  # noqa: BLE001 - 入参校验失败回 error 载荷
            logger.warning(
                "A2UI run tool arguments invalid",
                tool=tool_name,
                session_id=session_id,
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )
            return {
                "ok": False,
                "code": "TOOL_ARGS_INVALID",
                "error": f"invalid arguments for {tool_name}: {exc}",
            }

        context: ToolExecutionContext = ToolExecutionContext(
            cwd=Path(self._settings.CONFIG_BASE_PATH).resolve(),
            metadata={
                "session_id": session_id,
                "identity": identity or build_mcp_identity(),
            },
        )
        try:
            result: Any = await tool.execute(arguments, context)
        except Exception as exc:  # noqa: BLE001 - 执行失败回 error 载荷，不中断循环
            logger.warning(
                "A2UI run tool execution failed",
                tool=tool_name,
                session_id=session_id,
                error=str(exc),
                exc_type=exc.__class__.__name__,
            )
            return {
                "ok": False,
                "code": "TOOL_EXEC_ERROR",
                "error": f"tool execution failed: {tool_name}: {exc}",
            }

        payload: dict[str, Any] = {"ok": not result.is_error, "output": result.output}
        if result.is_error:
            payload["error"] = result.output
        # ACL 拒绝等结构化 metadata（如 ``{"acl": {...}}``）原样透传，供前端分支。
        if result.metadata:
            payload["metadata"] = result.metadata
        return payload

    async def _ensure_tool_registry(self, agent_id: str | None) -> ToolRegistry | None:
        """取平台工具注册表；未注入时按 Agent 配置懒装配并缓存。

        复用存量文本通道的装配方式（``create_platform_tool_registry`` +
        ``AclToolWrapper`` fail-closed 判权）：按 Agent 的 allowed_tools 白名单
        （含调度角色约束）过滤 skill / MCP / formfill 等工具，每个工具包一层
        ``AclToolWrapper(SafeToolWrapper(tool), guard, lookup_registry)``。
        Agent 配置不可用 / MCP 连接失败时降级（无 MCP 工具仍保留 skill 等
        内置工具），**绝不阻断** A2UI run 主链路。

        Args:
            agent_id: Agent ID；缺省或不可用时用默认装配（仅 skill 等内置工具）。

        Returns:
            平台工具注册表；装配失败时返回 ``None``（工具调用按未找到处理）。
        """
        if self._tool_registry is not None:
            return self._tool_registry

        from src.agent.manager import get_agent_manager
        from src.runtime.oh_runtime_builder import (
            connect_mcp_manager,
            enabled_package_skill_ids,
        )
        from src.runtime.tool_registry_builder import create_platform_tool_registry

        config: Any = None
        try:
            config = get_agent_manager().get_agent(agent_id or "").config
        except Exception as exc:  # noqa: BLE001 - Agent 不可用降级默认装配
            logger.warning(
                "A2UI run agent config unavailable; using default tool registry",
                agent_id=agent_id,
                error=str(exc),
            )

        allowed_skill_ids: list[str] = []
        allowed_tools: list[str] = []
        role: Any = None
        mcp_manager: Any = None
        if config is not None:
            allowed_skill_ids = enabled_package_skill_ids(config)
            role = getattr(config, "role", None)
            if getattr(config, "runtime", None) is not None:
                allowed_tools = list(config.runtime.allowed_tools or [])
            try:
                mcp_manager = await connect_mcp_manager(config)
            except Exception as exc:  # noqa: BLE001 - MCP 连接失败降级无 MCP 工具
                logger.warning(
                    "A2UI run MCP connect failed; proceeding without MCP tools",
                    agent_id=agent_id,
                    error=str(exc),
                )
                mcp_manager = None

        try:
            registry: ToolRegistry = create_platform_tool_registry(
                mcp_manager,
                allowed_tools=allowed_tools,
                role=role,
                agent_id=agent_id or "",
                allowed_skill_ids=allowed_skill_ids,
            )
        except Exception as exc:  # noqa: BLE001 - 装配失败不阻断主链路
            logger.error(
                "A2UI run tool registry assembly failed",
                agent_id=agent_id,
                error=str(exc),
                exc_info=True,
            )
            return None

        self._tool_registry = registry
        logger.info(
            "A2UI run tool registry ready",
            agent_id=agent_id,
            tools=[tool.name for tool in registry.list_tools()],
        )
        return registry

    # ------------------------------------------------------------------ 会话历史

    async def _load_history(
        self, session_id: str, *, user_id: str, agent_id: str | None
    ) -> list[LLMMessage]:
        """加载会话历史（最近 ``HISTORY_LIMIT`` 条文本消息）为 LLM 消息。

        会话不存在时尝试创建（Gateway 稳定 sessionId 场景）；SessionManager
        任何异常都降级为空历史（**不阻断** A2UI run 主链路）。

        Args:
            session_id: 会话 ID。
            user_id: 用户 ID（建会话用）。
            agent_id: Agent ID（建会话用；缺省取默认 Agent）。

        Returns:
            平台 LLM 消息列表（可能为空）。
        """
        session_manager: SessionManager = self._session_manager or get_session_manager()
        try:
            session = await session_manager.get_session(session_id)
        except SessionNotFoundError:
            try:
                await session_manager.ensure_session(
                    session_id=session_id,
                    agent_id=agent_id or self._settings.AGENT_ROUTER_DEFAULT_AGENT,
                    user_id=user_id,
                    channel="h5",
                )
            except Exception as exc:  # noqa: BLE001 - 建会话失败不阻断
                logger.warning(
                    "A2UI run ensure_session failed (degraded)",
                    session_id=session_id,
                    error=str(exc),
                )
            return []
        except Exception as exc:  # noqa: BLE001 - 读会话失败降级为空历史
            logger.warning(
                "A2UI run load session failed (degraded)",
                session_id=session_id,
                error=str(exc),
            )
            return []

        result: list[LLMMessage] = []
        for msg in session.messages[-HISTORY_LIMIT:]:
            role: str = getattr(msg, "role", "") or ""
            content: str = str(getattr(msg, "content", "") or "").strip()
            if not content:
                continue
            if role == "assistant":
                result.append(LLMMessage(role=LLMRole.ASSISTANT, content=content))
            elif role == "system":
                result.append(LLMMessage(role=LLMRole.SYSTEM, content=content))
            else:
                result.append(LLMMessage(role=LLMRole.USER, content=content))
        return result

    async def _persist_user(self, session_id: str, content: str) -> None:
        """持久化用户文本到会话历史（失败仅告警，不阻断）。"""
        session_manager: SessionManager = self._session_manager or get_session_manager()
        try:
            await session_manager.add_message(
                session_id=session_id, role="user", content=content
            )
        except Exception as exc:  # noqa: BLE001 - 持久化失败降级
            logger.warning(
                "A2UI run persist user message failed (degraded)",
                session_id=session_id,
                error=str(exc),
            )

    async def _persist_assistant(
        self,
        session_id: str,
        content: str,
        *,
        message_id: str | None = None,
    ) -> None:
        """持久化助手文本到会话历史（失败仅告警，不阻断）。

        Args:
            session_id: 会话 ID。
            content: 助手正文。
            message_id: 预生成的 assistant 消息 UUID（评价锚点）；传 None 时由
                ``add_message`` 内部生成（无锚点场景）。
        """
        session_manager: SessionManager = self._session_manager or get_session_manager()
        try:
            await session_manager.add_message(
                session_id=session_id,
                role="assistant",
                content=content,
                message_id=message_id,
            )
        except Exception as exc:  # noqa: BLE001 - 持久化失败降级
            logger.warning(
                "A2UI run persist assistant message failed (degraded)",
                session_id=session_id,
                error=str(exc),
            )
