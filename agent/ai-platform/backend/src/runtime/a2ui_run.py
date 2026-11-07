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
from dataclasses import dataclass
from typing import Any

import json
import uuid
from pathlib import Path
from time import perf_counter

from openharness.tools.base import ToolExecutionContext, ToolRegistry

from src.agent.session import SessionManager, get_session_manager
from src.agent.session_timing import RedisTimingStore, SessionTimingRecorder
from src.config import get_settings
from src.coordinator.passthrough import (
    build_hard_dispatch_invoke_args,
    extract_passthrough_worker_text,
    is_skipped_invoke_output,
    load_delegation_worker_sets,
    should_hard_dispatch,
    should_passthrough_invoke,
)
from src.coordinator.routing_llm import enrich_invoke_args_with_template
from src.coordinator.trace import peek_dispatch_traces
from src.llm.gateway import LLMGateway
from src.llm.models import LLMMessage, LLMRequest, LLMRole, LLMResponse
from src.queue.a2ui_outbound import A2uiOutboundPublisher
from src.runtime.events import A2UI_CATALOG_ID, A2UI_COMPONENTS, AgentEvent, TokenUsage
from src.runtime.mcp_identity import build_mcp_identity
from src.runtime.step_timing import (
    FORMFILL_TOOL_PREFIX,
    INVOKE_TOOL_NAMES,
    elapsed_ms,
    infer_route_kind,
    intent_from_tool_input,
    log_agent_step_timing,
    log_route_timing,
    skill_id_from_tool_input,
    worker_from_tool_input,
)
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


def platform_registry_to_openai_tools(registry: ToolRegistry) -> list[dict[str, Any]]:
    """将平台 ToolRegistry（含 ``agent__invoke``）转为 OpenAI function schema。

    Args:
        registry: ``create_platform_tool_registry`` 装配结果。

    Returns:
        OpenAI 格式工具列表；无工具时为空列表。
    """
    result: list[dict[str, Any]] = []
    for tool in registry.list_tools():
        try:
            api_schema: dict[str, Any] = tool.to_api_schema()
        except Exception as exc:  # noqa: BLE001 - 单工具 schema 失败不阻断
            logger.warning(
                "A2UI run skip tool schema",
                tool=getattr(tool, "name", "?"),
                error=str(exc),
            )
            continue
        name: Any = api_schema.get("name")
        if not isinstance(name, str) or not name:
            continue
        parameters: Any = api_schema.get("input_schema")
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}
        result.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": str(api_schema.get("description") or ""),
                    "parameters": parameters,
                },
            }
        )
    return result


def merge_openai_tools(
    primary: list[dict[str, Any]], secondary: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """合并两套 OpenAI tools，按 function.name 去重（primary 优先）。

    Args:
        primary: 优先保留（通常是 Gateway 注入的 ``render_a2ui``）。
        secondary: 补充（平台 ``agent__invoke`` / skill 等）。

    Returns:
        去重后的工具列表。
    """
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for item in primary + secondary:
        function: Any = item.get("function") if isinstance(item, dict) else None
        name: Any = function.get("name") if isinstance(function, dict) else None
        if not isinstance(name, str) or not name or name in seen:
            continue
        seen.add(name)
        merged.append(item)
    return merged


def filter_openai_tools_by_exclude(
    tools: list[dict[str, Any]],
    exclude_names: list[str] | set[str] | tuple[str, ...] | None,
) -> list[dict[str, Any]]:
    """按工具名黑名单过滤 OpenAI tools（用于协调者收窄 LLM 可见工具面）。

    Args:
        tools: ``merge_openai_tools`` 结果。
        exclude_names: 要剔除的 function.name；空则原样返回。

    Returns:
        过滤后的列表（保持原顺序）。
    """
    if not tools:
        return []
    blocked = {
        str(name).strip()
        for name in (exclude_names or [])
        if str(name).strip()
    }
    if not blocked:
        return list(tools)
    kept: list[dict[str, Any]] = []
    for item in tools:
        function: Any = item.get("function") if isinstance(item, dict) else None
        name: Any = function.get("name") if isinstance(function, dict) else None
        if isinstance(name, str) and name in blocked:
            continue
        kept.append(item)
    return kept


def load_exclude_llm_tools(agent_id: str) -> list[str]:
    """读取 ``runtime.params.excludeLlmTools``（A2UI 通道交给模型的工具黑名单）。

    Args:
        agent_id: Agent ID。

    Returns:
        工具名列表；缺省 / 读失败返回 ``[]``。
    """
    if not (agent_id or "").strip():
        return []
    try:
        from src.config_manager.manager import get_config_manager

        config = get_config_manager().get_config_cached(agent_id.strip())
        if config is None or not getattr(config, "runtime", None):
            return []
        params = getattr(config.runtime, "params", None) or {}
        if not isinstance(params, dict):
            return []
        raw = params.get("excludeLlmTools") or params.get("exclude_llm_tools") or []
        if not isinstance(raw, list):
            return []
        return [str(x).strip() for x in raw if str(x).strip()]
    except Exception as exc:  # noqa: BLE001 - 配置失败不阻断对话
        logger.warning(
            "load excludeLlmTools failed",
            agent_id=agent_id,
            error=str(exc),
        )
        return []


@dataclass(frozen=True)
class A2uiLlmRuntime:
    """从 Agent ``runtime.params`` + ``model`` 解析出的 A2UI LLM 运行参数。

    字段为 ``None`` 表示配置缺失，调用方回退到 ``A2uiRunLoop`` 构造默认值。
    """

    temperature: float | None = None
    max_tokens: int | None = None
    max_turns: int | None = None
    model: str | None = None


def load_a2ui_llm_runtime(agent_id: str) -> A2uiLlmRuntime:
    """读取 Agent 模型/运行时参数，供 A2UI 通道与 OpenHarness 对齐。

    来源：
    - ``runtime.params.temperature`` / ``maxTokens`` / ``maxSteps``
    - ``model.primary``（``system/model.yaml``）

    Args:
        agent_id: Agent ID（如 ``mis-copilot``）。

    Returns:
        解析结果；缺省 / 读失败时各字段为 ``None``。
    """
    if not (agent_id or "").strip():
        return A2uiLlmRuntime()
    try:
        from src.config_manager.manager import get_config_manager

        config = get_config_manager().get_config_cached(agent_id.strip())
        if config is None:
            return A2uiLlmRuntime()

        temperature: float | None = None
        max_tokens: int | None = None
        max_turns: int | None = None
        model: str | None = None

        params = getattr(getattr(config, "runtime", None), "params", None) or {}
        if isinstance(params, dict):
            if params.get("temperature") is not None:
                temperature = float(params["temperature"])
            raw_max_tokens = params.get("maxTokens", params.get("max_tokens"))
            if raw_max_tokens is not None:
                max_tokens = int(raw_max_tokens)
            raw_max_steps = params.get("maxSteps", params.get("max_steps"))
            if raw_max_steps is not None:
                max_turns = int(raw_max_steps)

        model_cfg = getattr(config, "model", None)
        primary = getattr(model_cfg, "primary", None) if model_cfg is not None else None
        if isinstance(primary, str) and primary.strip():
            model = primary.strip()

        return A2uiLlmRuntime(
            temperature=temperature,
            max_tokens=max_tokens,
            max_turns=max_turns,
            model=model,
        )
    except Exception as exc:  # noqa: BLE001 - 配置失败不阻断对话
        logger.warning(
            "load_a2ui_llm_runtime failed",
            agent_id=agent_id,
            error=str(exc),
        )
        return A2uiLlmRuntime()


def _looks_like_truncated_assistant_text(text: str) -> bool:
    """粗检助手正文是否像半截（表未收尾 / 未闭合加粗 / 句末残缺）。"""
    raw = (text or "").rstrip()
    if not raw:
        return False
    if raw.count("**") % 2 == 1:
        return True
    if raw.count("|") >= 2 and not raw.endswith("|") and "\n|" in raw:
        # 表行开了但最后一行不像完整单元格收尾
        last = raw.rsplit("\n", 1)[-1].strip()
        if last.startswith("|") and not last.endswith("|"):
            return True
        if last.startswith("|") and last.count("|") < 2:
            return True
    # 常见半截：以未配对左括号 / 「门店」等截断词尾结束
    if raw.endswith(("（", "(", "【", "[", "，", ",", "、")):
        return True
    return False


#: 自行决策（无 tool_calls / finish=stop）排障：单条 message content 上限
_SELF_STOP_MSG_CHARS = 4000
#: 自行决策排障：assistant 正文 / reasoning 上限
_SELF_STOP_RESPONSE_CHARS = 8000


def _text_for_log(value: Any, max_chars: int) -> str:
    """把 message content（str / 多模态 list）压成可入日志的字符串。"""
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    elif isinstance(value, list):
        parts: list[str] = []
        for part in value:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    parts.append(str(part.get("text") or ""))
                elif part.get("type") == "image_url":
                    parts.append("[image_url]")
                else:
                    parts.append(json.dumps(part, ensure_ascii=False)[:200])
            else:
                parts.append(str(part))
        text = "\n".join(parts)
    else:
        text = str(value)
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}…(truncated,total={len(text)})"


def _messages_for_self_stop_log(
    messages: list[LLMMessage],
    *,
    max_chars_per_msg: int = _SELF_STOP_MSG_CHARS,
) -> list[dict[str, Any]]:
    """序列化发给协调者 LLM 的 messages，供 finish=stop 排障。"""
    out: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.role.value if isinstance(msg.role, LLMRole) else str(msg.role)
        entry: dict[str, Any] = {
            "role": role,
            "content": _text_for_log(msg.content, max_chars_per_msg),
        }
        if msg.tool_calls:
            entry["tool_calls"] = msg.tool_calls
        if msg.tool_call_id:
            entry["tool_call_id"] = msg.tool_call_id
        if msg.name:
            entry["name"] = msg.name
        out.append(entry)
    return out


def _tool_names_for_log(tools: list[dict[str, Any]] | None) -> list[str]:
    """从 OpenAI tools schema 抽出工具名列表。"""
    names: list[str] = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function") if tool.get("type") == "function" else tool
        if isinstance(fn, dict) and fn.get("name"):
            names.append(str(fn["name"]))
        elif tool.get("name"):
            names.append(str(tool["name"]))
    return names


def _log_coordinator_self_stop_detail(
    *,
    agent_id: str,
    session_id: str,
    turn: int,
    model: str,
    temperature: float,
    max_tokens: int,
    tool_choice: str,
    openai_tools: list[dict[str, Any]],
    llm_messages: list[LLMMessage],
    response: LLMResponse,
    finish_reason: str,
    content_chars: int,
    completion_tokens: int | None,
    looks_truncated: bool,
) -> None:
    """协调者自行决策（无 tool_calls）时落详细请求/响应，便于查无故 finish=stop。"""
    content = response.content or ""
    reasoning = getattr(response, "reasoning_content", None) or ""
    logger.warning(
        "coordinator llm self-stop detail",
        agent_id=agent_id,
        session_id=session_id,
        turn=turn,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        tool_choice=tool_choice,
        tools=_tool_names_for_log(openai_tools),
        tools_count=len(openai_tools or []),
        messages_count=len(llm_messages),
        messages=_messages_for_self_stop_log(llm_messages),
        finish_reason=finish_reason,
        upstream_finish=str(getattr(response, "finish_reason", "") or ""),
        content_chars=content_chars,
        completion_tokens=completion_tokens,
        prompt_tokens=(
            int(response.usage.prompt_tokens)
            if response.usage and response.usage.prompt_tokens
            else None
        ),
        looks_truncated=looks_truncated,
        response_content=_text_for_log(content, _SELF_STOP_RESPONSE_CHARS),
        reasoning_content=_text_for_log(reasoning, _SELF_STOP_RESPONSE_CHARS)
        if reasoning
        else "",
    )


#: A2UI 通道专用调度纪律（补丁到 system；与 Coordinator ``system.md`` 叠加）。
#:
#: 设计判断：A2UI 是「可交互界面」能力，不是「每种回复的必选外壳」。
#: 路由/委派一律由 MIS-COPILOT（Coordinator system.md + agent__invoke）决定，
#: 本 hint **不**写死「某类问题必须调某 Worker」，避免与 Coordinator 意图表抢权。
#: 曾写「拿到 mis-rag 后必须 render_a2ui」→ 模型为凑 UI 自创「确认清单」+ 空表。
A2UI_COORDINATOR_HINT = """A2UI 通道：只调 coordinator__decide；route 后系统委派并结束。禁止裸答经营数字。勿造空确认清单。
"""

DECIDE_TOOL_NAME = "coordinator__decide"
REFUSE_NO_TOOL_MESSAGE = (
    "【信息不足，缺少必要业务数据，无法给出有效结果，不编造数据】"
)

#: Coordinator system.md 特征串（已注入则不重复）。
_COORDINATOR_SYSTEM_MARKER = "MIS Copilot"


def load_agent_system_prompt(agent_id: str) -> str:
    """从 ConfigManager 读取 Agent 的 system prompt（``runtime/prompts/system.md``）。

    Coordinator 会再注入 ``worker_ids`` + 各 Worker ``when_to_use`` 意图表。

    Args:
        agent_id: 如 ``mis-copilot``。

    Returns:
        提示词正文；配置未加载或为空时返回 ``""``。
    """
    if not agent_id:
        return ""
    try:
        from src.config_manager.manager import get_config_manager

        manager = get_config_manager()
        config = manager.get_config_cached(agent_id)
        if config is None:
            return ""
        prompt = (config.system_prompt or "").strip()
        if not prompt and config.runtime and isinstance(config.runtime.prompts, dict):
            # 兼容：部分加载路径只写在 runtime.prompts
            nested = config.runtime.prompts.get("system_prompt") or config.runtime.prompts.get(
                "system"
            )
            if isinstance(nested, str) and nested.strip() and not nested.endswith((".md", ".txt")):
                prompt = nested.strip()
        if not prompt:
            return ""
        # Coordinator：自动生成可委派意图表，避免与详情页 worker_ids 双写
        role_value = getattr(getattr(config, "role", None), "value", None) or str(
            getattr(config, "role", "") or ""
        )
        if str(role_value).lower() == "coordinator":
            from src.coordinator.prompt_compose import compose_coordinator_system_prompt

            return compose_coordinator_system_prompt(agent_id, prompt)
        return prompt
    except Exception as exc:  # noqa: BLE001 - 配置缺失时降级，仅靠 A2UI hint
        logger.warning(
            "load_agent_system_prompt failed",
            agent_id=agent_id,
            error=str(exc),
        )
        return ""


def ensure_coordinator_system_prompt(
    messages: list[LLMMessage],
    agent_id: str,
) -> list[LLMMessage]:
    """确保消息列表含 Coordinator system prompt（含自动意图表）。

    A2UI 通道原先只注入短 hint，导致 CRM 等委派规则丢失。
    """
    for msg in messages:
        if msg.role == LLMRole.SYSTEM and _COORDINATOR_SYSTEM_MARKER in (msg.content or ""):
            return messages
    prompt = load_agent_system_prompt(agent_id)
    if not prompt:
        return messages
    return [LLMMessage(role=LLMRole.SYSTEM, content=prompt), *messages]


def ensure_a2ui_system_hint(messages: list[LLMMessage]) -> list[LLMMessage]:
    """确保消息列表含 A2UI 调度纪律 system 提示（已有则不重复插入）。

    Args:
        messages: 当前 LLM 消息。

    Returns:
        可能前置了 system hint 的新列表。
    """
    marker = "你在 A2UI 对话通道中"
    for msg in messages:
        if msg.role == LLMRole.SYSTEM and marker in (msg.content or ""):
            return messages
    return [LLMMessage(role=LLMRole.SYSTEM, content=A2UI_COORDINATOR_HINT), *messages]

def _openai_tools_contain(tools: list[dict[str, Any]], name: str) -> bool:
    """OpenAI tools 列表是否包含指定 function.name。"""
    for item in tools or []:
        function = item.get("function") if isinstance(item, dict) else None
        if isinstance(function, dict) and str(function.get("name") or "") == name:
            return True
    return False


def _parse_template_open_card_from_invoke_output(
    tool_output: str,
) -> tuple[str, str, str, dict[str, str]] | None:
    """解析 ``agent__invoke`` 输出中的模板报告开卡标记。

    Returns:
        ``(report_code, title, tip, values)``；非开卡结果返回 ``None``。
    """
    text = (tool_output or "").strip()
    body = text
    if text.startswith("[task:"):
        first_line, _, rest = text.partition("\n")
        if "status=completed" not in first_line:
            return None
        body = rest.lstrip("\n").strip()
    if not body:
        return None
    try:
        from src.agent.template_report.pipeline import (
            PREFILL_MARKER_PREFIX,
            parse_open_card_marker,
        )
    except Exception:  # noqa: BLE001
        return None
    parsed = parse_open_card_marker(body)
    if not parsed:
        return None
    report_code, title, values = parsed
    tip_lines: list[str] = []
    for line in body.split("\n")[1:]:
        if line.strip().startswith(PREFILL_MARKER_PREFIX):
            continue
        tip_lines.append(line)
    tip = "\n".join(tip_lines).strip() or (
        f"已为您打开「{title}」参数卡，请确认参数后生成报告。"
    )
    return report_code, title, tip, values


def _try_json_loads(raw: str) -> Any:
    """尝试 ``json.loads``；失败（非法 JSON）原样返回输入字符串。

    Args:
        raw: 待解析字符串。

    Returns:
        解析结果（dict / list / 标量）或原始字符串（解析失败）。
    """
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return raw


def _parse_tool_args(raw_args: Any) -> dict[str, Any]:
    """将 LLM 返回的 tool 入参（JSON 字符串或对象）规约为 dict。

    兼容两种常见形态：
    - 标准 OpenAI function-calling：``arguments`` 为 JSON 对象字符串 → 解析为 dict；
    - 双编码（部分 OpenAI 兼容 provider 偶发）：``arguments`` 为「再包一层引号的
      JSON 字符串」（如 ``'"{...}"'``）→ 先解一层得到字符串，再解一层得到 dict。

    Args:
        raw_args: ``function.arguments`` 原始值（dict / str / 其它）。

    Returns:
        解析后的参数 dict；无法解析为 dict 时返回空 dict。
    """
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str):
        parsed: Any = _try_json_loads(raw_args)
        # 双编码兜底：首层解出仍是字符串 → 再解一层（LLM 真实输出 surfaceId 等字段
        # 可能因 provider 实现被二次序列化，导致字段「明明存在却取不到」）。
        if isinstance(parsed, str):
            parsed = _try_json_loads(parsed)
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
    if isinstance(args, str):
        # 防御：个别调用方可能直接传入 JSON 字符串（而非已解析 dict）。
        args = _parse_tool_args(args)
    if not isinstance(args, dict):
        return {"ok": False, "error": "render_a2ui 入参必须是对象"}
    # 兼容 camelCase（模型真实输出）与 snake_case；双编码 JSON 已在 _parse_tool_args 解包。
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


def _snapshot_render_a2ui_args(args: dict[str, Any]) -> dict[str, Any] | None:
    """从成功的 ``render_a2ui`` 入参抽出可落库快照（切会话后前端还原表格）。

    Args:
        args: 已解析的 render_a2ui 工具入参。

    Returns:
        ``{surfaceId, components, data?}``；缺关键字段时 ``None``。
    """
    if not isinstance(args, dict):
        return None
    surface_id: Any = args.get("surfaceId") or args.get("surface_id")
    components: Any = args.get("components")
    if not isinstance(surface_id, str) or not surface_id:
        return None
    if not isinstance(components, list):
        return None
    snap: dict[str, Any] = {
        "surfaceId": surface_id,
        "components": components,
    }
    data: Any = args.get("data")
    if data is not None:
        snap["data"] = data
    return snap


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
        ask_tool_metadata: dict[str, Any] | None = None,
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
            ask_tool_metadata: BFF 问数身份头（``X-Mis-*`` / ``iqd.connection_id``），
                写入工具上下文供 ``agent__invoke`` → Worker ``iqd__ask`` 消费。
        """
        messages: list[dict[str, Any]] = run_agent_input.get("messages") or []
        tools: list[Any] = run_agent_input.get("tools") or []
        # A2UI 入站常不带 agentId；回落默认 Coordinator，才能装配 agent__invoke。
        resolved_agent_id: str = (
            agent_id or self._settings.AGENT_ROUTER_DEFAULT_AGENT or "mis-copilot"
        )
        # 与 OpenHarness 对齐：读 Agent runtime.params + model.primary（如 mis-copilot 的 0.3）。
        agent_llm = load_a2ui_llm_runtime(resolved_agent_id)
        temperature: float = (
            agent_llm.temperature
            if agent_llm.temperature is not None
            else self._temperature
        )
        max_tokens: int = (
            agent_llm.max_tokens
            if agent_llm.max_tokens is not None
            else self._max_tokens
        )
        max_turns: int = (
            agent_llm.max_turns
            if agent_llm.max_turns is not None
            else self._max_turns
        )
        inbound_model = str(run_agent_input.get("model") or "").strip()
        # Agent model.primary 优先，避免 Gateway/全局默认覆盖 Coordinator 配置。
        model: str = agent_llm.model or inbound_model or self._model
        if (
            agent_llm.temperature is not None
            or agent_llm.max_tokens is not None
            or agent_llm.max_turns is not None
            or agent_llm.model
        ):
            logger.info(
                "A2UI LLM runtime from agent config",
                agent_id=resolved_agent_id,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                max_turns=max_turns,
                inbound_model=inbound_model or None,
            )
        # 工具执行身份（P4：只来自 JWT 验签结果 + 上游解析的 misUserId）。
        identity: dict[str, str] = build_mcp_identity(
            user_id=user_id,
            channel="h5",
            mis_user_id=mis_user_id,
        )
        ask_meta: dict[str, Any] = dict(ask_tool_metadata or {})

        history: list[LLMMessage] = await self._load_history(
            session_id,
            user_id=user_id,
            agent_id=resolved_agent_id,
            mis_user_id=mis_user_id,
        )
        combined: list[LLMMessage] = history + agui_messages_to_llm(messages)
        # system hint 不算「有效输入」：无 user/assistant 正文时直接空回包，不调 LLM。
        if not any(
            m.role != LLMRole.SYSTEM and str(m.content or "").strip() for m in combined
        ):
            await self._publisher.publish(
                session_id, AgentEvent.text_delta("（空消息）")
            )
            await self._publisher.publish(session_id, AgentEvent.done())
            return

        # 与文本通道对齐：预先生成 assistant 消息 UUID，计时 turn_key / 落库 / done 共用。
        assistant_message_id: str = str(uuid.uuid4())
        recorder = SessionTimingRecorder(session_id, assistant_message_id)
        store = RedisTimingStore(get_settings())

        async def emit(event: AgentEvent) -> None:
            """出站发布同时喂给 SessionTimingRecorder（失败不阻断主链路）。"""
            try:
                recorder.observe(event)
            except Exception:  # noqa: BLE001
                pass
            await self._publisher.publish(session_id, event)

        # 委派期间 Worker 工具事件经 ContextVar 回灌到父会话 SSE（Copilot 步骤条）
        from src.coordinator.parent_progress import (
            reset_parent_progress_emit,
            set_parent_progress_emit,
        )

        progress_token = set_parent_progress_emit(emit)
        try:
            llm_messages: list[LLMMessage] = ensure_a2ui_system_hint(
                ensure_coordinator_system_prompt(combined, resolved_agent_id)
            )

            # 持久化本轮用户文本（工具/系统消息不入历史，保持上下文干净）
            last_user_for_route = ""
            for msg in messages:
                if isinstance(msg, dict) and msg.get("role") == "user":
                    user_text: str = _agui_content_to_text(msg.get("content")).strip()
                    if user_text:
                        last_user_for_route = user_text
                        await self._persist_user(session_id, user_text)

            # Coordinator：可选 JEV / 规则预路由（INTENT_DETECT_* 独立 Key）
            # 传入对话上文，避免短跟问（如「溧阳呢」）脱离超市门店语境。
            route_decision: Any = None
            history_for_jev: list[dict[str, str]] = []
            for msg in combined:
                role = getattr(msg.role, "value", None) or str(msg.role or "")
                role_s = str(role).lower()
                if role_s not in {"user", "assistant"}:
                    continue
                content_s = str(msg.content or "").strip()
                if not content_s:
                    continue
                history_for_jev.append({"role": role_s, "content": content_s})
            try:
                from src.intent_router.service import (
                    format_coordinator_route_hint,
                    format_router_skill_hint,
                    resolve_intent_route,
                )

                route_decision = await resolve_intent_route(
                    resolved_agent_id,
                    last_user_for_route,
                    history_messages=history_for_jev,
                    session_id=session_id,
                )
                if route_decision is not None:
                    hint = ""
                    if route_decision.worker_id or route_decision.intent:
                        hint = format_coordinator_route_hint(
                            worker_id=route_decision.worker_id,
                            intent=route_decision.intent,
                            router_skill=route_decision.router_skill,
                        )
                    elif route_decision.router_skill:
                        hint = format_router_skill_hint(route_decision.router_skill)
                    if hint:
                        for i in range(len(llm_messages) - 1, -1, -1):
                            if llm_messages[i].role == LLMRole.USER:
                                base = (llm_messages[i].content or "").rstrip()
                                llm_messages[i] = LLMMessage(
                                    role=LLMRole.USER,
                                    content=f"{base}\n\n{hint}" if base else hint,
                                )
                                break
            except Exception:  # noqa: BLE001 - 预路由失败不阻断对话
                logger.warning(
                    "intent route resolve failed (a2ui)",
                    agent_id=resolved_agent_id,
                    exc_info=True,
                )

            (
                passthrough_workers,
                hard_dispatch_workers,
            ) = await load_delegation_worker_sets(resolved_agent_id)

            # Gateway 注入 render_a2ui + 平台委派工具（agent__invoke 等）。
            # 缺后者时 LLM 只会瞎编 A2UI /「外部资料」，走不到 mis-rag。
            agui_openai: list[dict[str, Any]] = agui_tools_to_openai_tools(tools)
            platform_openai: list[dict[str, Any]] = []
            registry: ToolRegistry | None = await self._ensure_tool_registry(
                resolved_agent_id
            )
            if registry is not None:
                platform_openai = platform_registry_to_openai_tools(registry)
            openai_tools: list[dict[str, Any]] = merge_openai_tools(
                agui_openai, platform_openai
            )
            exclude_llm_tools = load_exclude_llm_tools(resolved_agent_id)
            if exclude_llm_tools:
                before_names = [
                    str((t.get("function") or {}).get("name") or "")
                    for t in openai_tools
                    if isinstance(t, dict)
                ]
                openai_tools = filter_openai_tools_by_exclude(
                    openai_tools, exclude_llm_tools
                )
                after_names = [
                    str((t.get("function") or {}).get("name") or "")
                    for t in openai_tools
                    if isinstance(t, dict)
                ]
                logger.info(
                    "A2UI LLM tools narrowed by excludeLlmTools",
                    agent_id=resolved_agent_id,
                    session_id=session_id,
                    exclude=exclude_llm_tools,
                    before=before_names,
                    after=after_names,
                )
            # 委派入参模板补全用的上文（与硬委派同口径；不另开「精简选人轮」）
            routing_ctx = ""
            try:
                from src.intent_router.service import (
                    format_conversation_context_for_jev as _fmt_route_ctx,
                )

                routing_ctx = _fmt_route_ctx(
                    last_user_for_route,
                    history_for_jev,
                    max_context_turns=3,
                    max_msg_chars=800,
                )
            except Exception:  # noqa: BLE001
                routing_ctx = ""
            force_decide_tools = _openai_tools_contain(openai_tools, DECIDE_TOOL_NAME)
            llm_tool_choice: str = (
                "required"
                if force_decide_tools
                else ("auto" if openai_tools else "none")
            )
            total_usage: TokenUsage = TokenUsage()
            assistant_parts: list[str] = []
            # 本轮成功 render_a2ui 快照，写入 assistant metadata.a2ui 供历史还原。
            a2ui_surfaces: list[dict[str, Any]] = []
            error_message: str | None = None
            completed: bool = False

            # 与 openharness 对齐的路由/逐步耗时基线（Copilot 主路径）
            turn_t0: float = perf_counter()
            role_value = "coordinator"
            ms_to_first_text: int | None = None
            ms_to_first_tool: int | None = None
            first_tool: str | None = None
            ms_to_first_invoke: int | None = None
            invoke_intent: str | None = None
            invoke_worker: str | None = None
            ms_to_first_formfill: int | None = None
            llm_turn_index = 0
            tool_call_index = 0
            skill_call_index = 0
            sum_llm_ms = 0
            sum_tool_ms = 0
            sum_skill_ms = 0
            route_timing_emitted = False

            async def _emit_a2ui_route_timing() -> None:
                nonlocal route_timing_emitted
                if route_timing_emitted:
                    return
                route_timing_emitted = True
                dispatch_items: list[dict[str, Any]] = []
                try:
                    dispatch_items = await peek_dispatch_traces(session_id)
                except Exception:  # noqa: BLE001 - 观测失败不影响主链路
                    dispatch_items = []
                first_dispatch_latency: int | None = None
                for entry in dispatch_items:
                    raw_latency = entry.get("latency_ms")
                    if isinstance(raw_latency, (int, float)):
                        first_dispatch_latency = int(raw_latency)
                        break
                log_route_timing(
                    agent_id=resolved_agent_id,
                    role=role_value,
                    session_id=session_id,
                    model=model,
                    total_ms=elapsed_ms(turn_t0),
                    ms_to_first_text=ms_to_first_text,
                    ms_to_first_tool=ms_to_first_tool,
                    first_tool=first_tool,
                    ms_to_first_invoke=ms_to_first_invoke,
                    invoke_intent=invoke_intent,
                    invoke_worker=invoke_worker,
                    ms_to_first_formfill=ms_to_first_formfill,
                    route_kind=infer_route_kind(
                        ms_to_first_invoke=ms_to_first_invoke,
                        ms_to_first_formfill=ms_to_first_formfill,
                        ms_to_first_tool=ms_to_first_tool,
                        ms_to_first_text=ms_to_first_text,
                    ),
                    dispatch_count=len(dispatch_items),
                    dispatch_worker_latency_ms=first_dispatch_latency,
                    llm_turns=llm_turn_index,
                    tool_calls=tool_call_index,
                    skill_calls=skill_call_index,
                    sum_llm_ms=sum_llm_ms,
                    sum_tool_ms=sum_tool_ms,
                    sum_skill_ms=sum_skill_ms,
                )

            # 模板报告 / JEV：硬派发 Worker（跳过 Coordinator 首轮选人 LLM）
            hard_worker = ""
            report_forced = False
            report_skill = ""
            report_run_meta = ask_meta.get("ai_report_run") if isinstance(ask_meta, dict) else None
            if isinstance(report_run_meta, dict):
                hard_worker = str(report_run_meta.get("agent_id") or "").strip()
                report_skill = str(report_run_meta.get("skill_id") or "").strip()
                report_forced = bool(hard_worker)
            if not hard_worker and route_decision is not None:
                hard_worker = str(getattr(route_decision, "worker_id", None) or "").strip()
            if (
                hard_worker
                and last_user_for_route
                and (
                    report_forced
                    or should_hard_dispatch(
                        worker_id=hard_worker,
                        hard_dispatch_workers=hard_dispatch_workers,
                    )
                )
            ):
                from src.intent_router.service import (
                    format_conversation_context_for_jev,
                    format_router_skill_hint,
                )
                from src.runtime.step_timing import log_turn_step

                # Worker 需比 JEV 更长的单条截断，保住门店表/已确认条件
                hard_ctx = format_conversation_context_for_jev(
                    last_user_for_route,
                    history_for_jev,
                    max_context_turns=3,
                    max_msg_chars=800,
                )
                user_text_for_invoke = last_user_for_route
                skill_for_hint = report_skill or (
                    str(getattr(route_decision, "router_skill", None) or "").strip()
                    if route_decision is not None
                    else ""
                )
                if skill_for_hint:
                    hint = format_router_skill_hint(skill_for_hint)
                    if hint:
                        user_text_for_invoke = (
                            f"{last_user_for_route.rstrip()}\n\n{hint}"
                            if last_user_for_route.strip()
                            else hint
                        )
                invoke_args = build_hard_dispatch_invoke_args(
                    worker_id=hard_worker,
                    user_text=user_text_for_invoke,
                    intent=str(
                        (report_run_meta or {}).get("report_code")
                        if report_forced
                        else (getattr(route_decision, "intent", None) or "")
                    )
                    or "",
                    conversation_context=hard_ctx,
                    mode="continue",
                )
                hard_has_ctx = bool(
                    (invoke_args.get("task_brief") or {})
                    .get("inputs", {})
                    .get("attachments_text")
                )
                log_turn_step(
                    session_id=session_id,
                    step_name="协调者·硬委派(跳过选人LLM)",
                    duration_ms=0,
                    agent_id=resolved_agent_id,
                    detail=(
                        f"Worker={hard_worker}；"
                        f"intent={invoke_args.get('intent') or '-'}；"
                        f"mode={invoke_args.get('mode') or '-'}；"
                        f"{'含上文' if hard_has_ctx else '无上文'}"
                    ),
                )
                logger.info(
                    "coordinator_hard_dispatch",
                    session_id=session_id,
                    coordinator_id=resolved_agent_id,
                    worker_id=hard_worker,
                    intent=invoke_args.get("intent") or None,
                )
                await emit(AgentEvent.tool_call("agent__invoke", invoke_args))
                tool_t0 = perf_counter()
                if ms_to_first_tool is None:
                    ms_to_first_tool = elapsed_ms(turn_t0)
                    first_tool = "agent__invoke"
                if ms_to_first_invoke is None:
                    ms_to_first_invoke = elapsed_ms(turn_t0)
                    invoke_intent = str(invoke_args.get("intent") or "") or None
                    invoke_worker = hard_worker
                hard_result = await self._execute_tool(
                    "agent__invoke",
                    invoke_args,
                    session_id,
                    identity=identity,
                    agent_id=resolved_agent_id,
                    ask_tool_metadata=ask_meta,
                )
                tool_duration = elapsed_ms(tool_t0)
                tool_call_index += 1
                sum_tool_ms += tool_duration
                log_agent_step_timing(
                    agent_id=resolved_agent_id,
                    role=role_value,
                    session_id=session_id,
                    model=model,
                    kind="tool",
                    step=0,
                    index=tool_call_index,
                    duration_ms=tool_duration,
                    since_turn_ms=elapsed_ms(turn_t0),
                    tool="agent__invoke",
                    skill_id=None,
                    is_error=bool(
                        hard_result.get("error") or hard_result.get("ok") is False
                    ),
                )
                await emit(AgentEvent.tool_result("agent__invoke", hard_result))
                hard_output = str(hard_result.get("output") or "")
                open_card = _parse_template_open_card_from_invoke_output(hard_output)
                if open_card:
                    report_code, title, tip, card_values = open_card
                    if ms_to_first_text is None:
                        ms_to_first_text = elapsed_ms(turn_t0)
                    await emit(AgentEvent.text_delta(tip))
                    await emit(
                        AgentEvent.report_open_card(
                            report_code, title=title, values=card_values or None
                        )
                    )
                    assistant_parts.append(tip)
                    completed = True
                hard_body = (
                    None
                    if open_card
                    else extract_passthrough_worker_text(hard_output)
                )
                if hard_body:
                    from src.coordinator.parent_progress import (
                        format_parent_stream_detail,
                        parent_text_stream_stats,
                        parent_text_was_streamed,
                    )

                    stream_stats = parent_text_stream_stats()
                    already_streamed = parent_text_was_streamed()
                    log_turn_step(
                        session_id=session_id,
                        step_name="协调者·透传收尾(跳过复述LLM)",
                        duration_ms=0,
                        agent_id=resolved_agent_id,
                        detail=(
                            f"Worker={hard_worker}；正文{len(hard_body)}字；"
                            f"来源=hard_dispatch；"
                            f"{format_parent_stream_detail(stream_stats)}；"
                            f"保底整段=下发"
                        ),
                    )
                    logger.info(
                        "coordinator_passthrough",
                        session_id=session_id,
                        coordinator_id=resolved_agent_id,
                        worker_id=hard_worker,
                        body_chars=len(hard_body),
                        source="hard_dispatch",
                        already_streamed=already_streamed,
                        stream_mode=stream_stats.get("stream_mode"),
                        stream_delta_count=stream_stats.get("delta_count"),
                        stream_total_chars=stream_stats.get("total_chars"),
                        stream_span_ms=stream_stats.get("span_ms"),
                        stream_max_chunk_chars=stream_stats.get("max_chunk_chars"),
                        safety_dump="emit",
                    )
                    if ms_to_first_text is None:
                        ms_to_first_text = elapsed_ms(turn_t0)
                    # 保底整段下发：若委派中流式帧被中间件吞掉，靠此避免前端空气泡。
                    # 前端对「已流式全文 == 整段」去重，不会叠字。
                    await emit(AgentEvent.text_delta(hard_body))
                    assistant_parts.append(hard_body)
                    completed = True
                elif not open_card:
                    from src.runtime.gateway_api_client import (
                        MODEL_GARBAGE_RETRY_MESSAGE,
                        is_model_garbage_payload,
                    )

                    hard_err = str(
                        hard_result.get("error") or hard_result.get("output") or ""
                    )
                    # 乱码：明确失败提示重试，禁止当成功透传，也不再静默交给协调者复述
                    if (
                        hard_result.get("ok") is False
                        and is_model_garbage_payload(hard_err)
                    ) or is_model_garbage_payload(
                        str(hard_result.get("output") or "")
                    ):
                        fail_msg = MODEL_GARBAGE_RETRY_MESSAGE
                        log_turn_step(
                            session_id=session_id,
                            step_name="协调者·硬委派失败(模型异常)",
                            duration_ms=0,
                            agent_id=resolved_agent_id,
                            detail=f"Worker={hard_worker}；乱码/哨兵→明确失败",
                        )
                        logger.warning(
                            "coordinator_hard_dispatch model_garbage_fail",
                            session_id=session_id,
                            worker_id=hard_worker,
                            error=hard_err[:200],
                        )
                        if ms_to_first_text is None:
                            ms_to_first_text = elapsed_ms(turn_t0)
                        await emit(AgentEvent.text_delta(fail_msg))
                        assistant_parts.append(fail_msg)
                        completed = True
                    else:
                        logger.warning(
                            "coordinator_hard_dispatch fallback_to_llm",
                            session_id=session_id,
                            worker_id=hard_worker,
                            ok=bool(hard_result.get("ok")),
                            error=hard_result.get("error"),
                        )

            for turn in range(1, max_turns + 1):
                if completed:
                    break
                llm_t0 = perf_counter()
                try:
                    from src.llm.thinking import (
                        llm_request_extra_for_thinking,
                        resolve_agent_enable_thinking,
                    )

                    enable_thinking: bool | None = None
                    try:
                        from src.config_manager.manager import get_config_manager

                        agent_cfg = get_config_manager().get_config_cached(
                            resolved_agent_id
                        )
                        enable_thinking = resolve_agent_enable_thinking(agent_cfg)
                    except Exception:  # noqa: BLE001
                        enable_thinking = None
                    response: LLMResponse = await self._gateway.chat(
                        LLMRequest(
                            messages=llm_messages,
                            model=model,
                            temperature=temperature,
                            max_tokens=max_tokens,
                            tools=openai_tools,
                            tool_choice=llm_tool_choice,
                            session_id=session_id,
                            user_id=user_id,
                            extra=llm_request_extra_for_thinking(
                                enable_thinking=enable_thinking,
                                model=model,
                            ),
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

                llm_duration = elapsed_ms(llm_t0)
                llm_turn_index += 1
                sum_llm_ms += llm_duration
                turn_tokens = 0
                if response.usage.total_tokens > 0:
                    turn_tokens = response.usage.total_tokens
                    total_usage += TokenUsage(
                        prompt=response.usage.prompt_tokens,
                        completion=response.usage.completion_tokens,
                        total=response.usage.total_tokens,
                    )
                # 保留上游真实 finish_reason（勿再改写成仅有/无 tool_calls）
                upstream_finish = str(getattr(response, "finish_reason", "") or "").strip()
                if response.tool_calls:
                    finish_reason = (
                        f"tool_calls/upstream={upstream_finish or 'n/a'}"
                    )
                else:
                    finish_reason = upstream_finish or "stop"
                content_chars = len(response.content or "")
                completion_tokens = (
                    int(response.usage.completion_tokens)
                    if response.usage and response.usage.completion_tokens
                    else None
                )
                log_agent_step_timing(
                    agent_id=resolved_agent_id,
                    role=role_value,
                    session_id=session_id,
                    model=model,
                    kind="llm",
                    step=turn,
                    index=llm_turn_index,
                    duration_ms=llm_duration,
                    since_turn_ms=elapsed_ms(turn_t0),
                    finish_reason=finish_reason,
                    tokens=turn_tokens or None,
                    ttft_ms=llm_duration if response.content else None,
                    content_chars=content_chars or None,
                    completion_tokens=completion_tokens,
                    has_tool_calls=bool(response.tool_calls),
                )
                if not response.tool_calls:
                    looks_truncated = bool(
                        response.content
                        and _looks_like_truncated_assistant_text(response.content)
                    )
                    _log_coordinator_self_stop_detail(
                        agent_id=resolved_agent_id,
                        session_id=session_id,
                        turn=turn,
                        model=model,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        tool_choice=llm_tool_choice,
                        openai_tools=openai_tools,
                        llm_messages=llm_messages,
                        response=response,
                        finish_reason=finish_reason,
                        content_chars=content_chars,
                        completion_tokens=completion_tokens,
                        looks_truncated=looks_truncated,
                    )
                    if looks_truncated:
                        logger.warning(
                            "coordinator assistant text looks truncated",
                            agent_id=resolved_agent_id,
                            session_id=session_id,
                            finish_reason=finish_reason,
                            content_chars=content_chars,
                            completion_tokens=completion_tokens,
                            preview=(response.content or "")[:120],
                        )

                # 有 tool_calls 时 content 多为过程旁白，不对用户展示（仍写入 llm_messages）
                if response.content and not response.tool_calls:
                    if force_decide_tools:
                        # 决策模式下禁止裸答：丢弃模型正文，固定拒答
                        logger.warning(
                            "coordinator self-stop blocked by decide-only mode",
                            session_id=session_id,
                            content_chars=content_chars,
                        )
                        if ms_to_first_text is None:
                            ms_to_first_text = elapsed_ms(turn_t0)
                        await emit(AgentEvent.text_delta(REFUSE_NO_TOOL_MESSAGE))
                        assistant_parts.append(REFUSE_NO_TOOL_MESSAGE)
                    else:
                        if ms_to_first_text is None:
                            ms_to_first_text = elapsed_ms(turn_t0)
                        assistant_parts.append(response.content)
                        await emit(AgentEvent.text_delta(response.content))

                if not response.tool_calls:
                    if force_decide_tools and not assistant_parts:
                        if ms_to_first_text is None:
                            ms_to_first_text = elapsed_ms(turn_t0)
                        await emit(AgentEvent.text_delta(REFUSE_NO_TOOL_MESSAGE))
                        assistant_parts.append(REFUSE_NO_TOOL_MESSAGE)
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
                invoke_count_in_turn = 0
                other_tool_count_in_turn = 0
                passthrough_text: str | None = None
                passthrough_worker: str | None = None
                for tc in response.tool_calls:
                    function: Any = tc.get("function") if isinstance(tc, dict) else None
                    if not isinstance(function, dict):
                        continue
                    tool_name: str = str(function.get("name") or "")
                    tool_call_id: str = str(tc.get("id") or "")
                    args: dict[str, Any] = _parse_tool_args(
                        function.get("arguments", "{}")
                    )
                    # 选人轮：LLM 只出 agent_id/content 时，用模板补全 TaskBrief
                    if tool_name in INVOKE_TOOL_NAMES:
                        args = enrich_invoke_args_with_template(
                            args,
                            user_text=last_user_for_route,
                            conversation_context=routing_ctx or None,
                        )
                    processed = True
                    skill_id = skill_id_from_tool_input(tool_name, args)
                    worker_id_for_tool = worker_from_tool_input(args)
                    if ms_to_first_tool is None:
                        ms_to_first_tool = elapsed_ms(turn_t0)
                        first_tool = tool_name or None
                    if tool_name in INVOKE_TOOL_NAMES:
                        invoke_count_in_turn += 1
                        if ms_to_first_invoke is None:
                            ms_to_first_invoke = elapsed_ms(turn_t0)
                            invoke_intent = intent_from_tool_input(args)
                            invoke_worker = worker_id_for_tool
                    else:
                        other_tool_count_in_turn += 1
                    if tool_name.startswith(FORMFILL_TOOL_PREFIX) and ms_to_first_formfill is None:
                        ms_to_first_formfill = elapsed_ms(turn_t0)
                    await emit(AgentEvent.tool_call(tool_name, args))
                    tool_t0 = perf_counter()
                    result: dict[str, Any] = await self._execute_tool(
                        tool_name,
                        args,
                        session_id,
                        identity=identity,
                        agent_id=resolved_agent_id,
                        ask_tool_metadata=ask_meta,
                    )
                    tool_duration = elapsed_ms(tool_t0)
                    tool_call_index += 1
                    sum_tool_ms += tool_duration
                    if tool_name == "skill":
                        skill_call_index += 1
                        sum_skill_ms += tool_duration
                    log_agent_step_timing(
                        agent_id=resolved_agent_id,
                        role=role_value,
                        session_id=session_id,
                        model=model,
                        kind="tool",
                        step=turn,
                        index=tool_call_index,
                        duration_ms=tool_duration,
                        since_turn_ms=elapsed_ms(turn_t0),
                        tool=tool_name or None,
                        skill_id=skill_id,
                        is_error=bool(result.get("error") or result.get("ok") is False),
                    )
                    # 快照成功的 render_a2ui，供切会话后历史还原表格/卡片。
                    if tool_name == RENDER_A2UI_TOOL_NAME and result.get("ok"):
                        snap = _snapshot_render_a2ui_args(args)
                        if snap is not None:
                            a2ui_surfaces.append(snap)
                    body = should_passthrough_invoke(
                        tool_name=tool_name,
                        worker_id=worker_id_for_tool,
                        tool_result=result,
                        passthrough_workers=passthrough_workers,
                    )
                    if body is not None:
                        passthrough_text = body
                        passthrough_worker = worker_id_for_tool
                    # 模板报告开卡：由通道消费标记并推事件，不交给收尾 LLM
                    open_card = None
                    if body is None and tool_name in INVOKE_TOOL_NAMES:
                        open_card = _parse_template_open_card_from_invoke_output(
                            str(result.get("output") or "")
                        )
                    await emit(AgentEvent.tool_result(tool_name, result))
                    if open_card:
                        report_code, title, tip, card_values = open_card
                        if ms_to_first_text is None:
                            ms_to_first_text = elapsed_ms(turn_t0)
                        await emit(AgentEvent.text_delta(tip))
                        await emit(
                            AgentEvent.report_open_card(
                                report_code, title=title, values=card_values or None
                            )
                        )
                        assistant_parts.append(tip)
                        completed = True
                        break
                    # 决策工具：route → 硬委派并结束；clarify/refuse/chitchat → 短文收口
                    if tool_name == DECIDE_TOOL_NAME:
                        from src.skills.tools.coordinator_decide import (
                            REFUSE_FIXED_MESSAGE,
                            parse_decide_tool_output,
                        )

                        decision = parse_decide_tool_output(
                            str(result.get("output") or "")
                        ) or {}
                        action = str(decision.get("action") or "").strip().lower()
                        if action == "route":
                            decide_worker = str(
                                decision.get("worker_id") or ""
                            ).strip()
                            decide_intent = str(decision.get("intent") or "").strip()
                            decide_content = str(
                                decision.get("content") or ""
                            ).strip() or last_user_for_route
                            if not decide_worker:
                                tip = REFUSE_FIXED_MESSAGE
                                if ms_to_first_text is None:
                                    ms_to_first_text = elapsed_ms(turn_t0)
                                await emit(AgentEvent.text_delta(tip))
                                assistant_parts.append(tip)
                                completed = True
                                break
                            invoke_args = build_hard_dispatch_invoke_args(
                                worker_id=decide_worker,
                                user_text=decide_content,
                                intent=decide_intent,
                                conversation_context=routing_ctx or None,
                                mode="continue",
                            )
                            if ms_to_first_invoke is None:
                                ms_to_first_invoke = elapsed_ms(turn_t0)
                                invoke_intent = decide_intent or None
                                invoke_worker = decide_worker
                            await emit(
                                AgentEvent.tool_call("agent__invoke", invoke_args)
                            )
                            inv_t0 = perf_counter()
                            inv_result = await self._execute_tool(
                                "agent__invoke",
                                invoke_args,
                                session_id,
                                identity=identity,
                                agent_id=resolved_agent_id,
                                ask_tool_metadata=ask_meta,
                            )
                            inv_ms = elapsed_ms(inv_t0)
                            tool_call_index += 1
                            sum_tool_ms += inv_ms
                            await emit(
                                AgentEvent.tool_result("agent__invoke", inv_result)
                            )
                            inv_output = str(inv_result.get("output") or "")
                            card = _parse_template_open_card_from_invoke_output(
                                inv_output
                            )
                            if card:
                                report_code, title, tip, card_values = card
                                if ms_to_first_text is None:
                                    ms_to_first_text = elapsed_ms(turn_t0)
                                await emit(AgentEvent.text_delta(tip))
                                await emit(
                                    AgentEvent.report_open_card(
                                        report_code,
                                        title=title,
                                        values=card_values or None,
                                    )
                                )
                                assistant_parts.append(tip)
                            else:
                                pass_body = extract_passthrough_worker_text(
                                    inv_output
                                )
                                if not pass_body:
                                    # skipped 空结果 → 通用拒答；其它非空正文（含权限说明）直出
                                    raw_out = (inv_output or "").strip()
                                    if raw_out and not is_skipped_invoke_output(
                                        raw_out
                                    ):
                                        if raw_out.startswith("[task:"):
                                            _hdr, _, rest = raw_out.partition("\n")
                                            pass_body = rest.lstrip("\n").strip() or None
                                        else:
                                            pass_body = raw_out
                                if pass_body:
                                    if ms_to_first_text is None:
                                        ms_to_first_text = elapsed_ms(turn_t0)
                                    await emit(AgentEvent.text_delta(pass_body))
                                    assistant_parts.append(pass_body)
                                else:
                                    tip = REFUSE_FIXED_MESSAGE
                                    if ms_to_first_text is None:
                                        ms_to_first_text = elapsed_ms(turn_t0)
                                    await emit(AgentEvent.text_delta(tip))
                                    assistant_parts.append(tip)
                            logger.info(
                                "coordinator_decide routed and finished",
                                session_id=session_id,
                                worker_id=decide_worker,
                                intent=decide_intent or None,
                            )
                            completed = True
                            break
                        tip = str(decision.get("message") or "").strip() or (
                            REFUSE_FIXED_MESSAGE
                        )
                        if ms_to_first_text is None:
                            ms_to_first_text = elapsed_ms(turn_t0)
                        await emit(AgentEvent.text_delta(tip))
                        assistant_parts.append(tip)
                        completed = True
                        break
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
                if completed:
                    break
                # 透传：本轮仅一次成功 invoke 且目标在 passthrough_workers → 跳过收尾 LLM
                if (
                    passthrough_text
                    and invoke_count_in_turn == 1
                    and other_tool_count_in_turn == 0
                ):
                    from src.coordinator.parent_progress import (
                        format_parent_stream_detail,
                        parent_text_stream_stats,
                        parent_text_was_streamed,
                    )
                    from src.runtime.step_timing import log_turn_step

                    stream_stats = parent_text_stream_stats()
                    already_streamed = parent_text_was_streamed()
                    log_turn_step(
                        session_id=session_id,
                        step_name="协调者·透传收尾(跳过复述LLM)",
                        duration_ms=0,
                        agent_id=resolved_agent_id,
                        detail=(
                            f"Worker={passthrough_worker or '-'}；"
                            f"正文{len(passthrough_text)}字；"
                            f"{format_parent_stream_detail(stream_stats)}；"
                            f"保底整段=下发"
                        ),
                    )
                    logger.info(
                        "coordinator_passthrough",
                        session_id=session_id,
                        coordinator_id=resolved_agent_id,
                        worker_id=passthrough_worker,
                        body_chars=len(passthrough_text),
                        already_streamed=already_streamed,
                        stream_mode=stream_stats.get("stream_mode"),
                        stream_delta_count=stream_stats.get("delta_count"),
                        stream_total_chars=stream_stats.get("total_chars"),
                        stream_span_ms=stream_stats.get("span_ms"),
                        stream_max_chunk_chars=stream_stats.get("max_chunk_chars"),
                        safety_dump="emit",
                    )
                    if ms_to_first_text is None:
                        ms_to_first_text = elapsed_ms(turn_t0)
                    # 保底整段下发（与 hard_dispatch 同口径；前端去重）
                    await emit(AgentEvent.text_delta(passthrough_text))
                    assistant_parts.append(passthrough_text)
                    completed = True
                    break
                # 本轮有工具调用 → 继续下一轮 LLM（直到无工具调用或达到轮数上限）

            if not completed and error_message is None:
                error_message = f"A2UI run 达到最大执行轮数（{max_turns}）"

            if error_message is not None:
                logger.warning(
                    "A2UI run failed",
                    session_id=session_id,
                    error=error_message,
                )
                # 同时下发可读正文 + done，避免前端只拿到 error 条或空气泡。
                # 不用 publish_error（其内部会再发无锚点 done），改由 emit 统一观测。
                user_facing = (
                    f"抱歉，本轮回复失败：{error_message}\n"
                    "请重试提问；若刚查询了较多数据，可缩小时间范围或门店后再问。"
                )
                await emit(AgentEvent.text_delta(user_facing))
                await emit(AgentEvent.error("A2UI_RUN_ERROR", error_message))
                await self._persist_assistant(
                    session_id, user_facing, message_id=assistant_message_id
                )
                await emit(
                    AgentEvent.done(
                        total_usage,
                        message_id=assistant_message_id,
                        session_id=session_id,
                    )
                )
                await _emit_a2ui_route_timing()
                return

            # 与文本通道 inbound_worker 对齐：委派 mis-rag 时 pending_kb_sources_fence
            # 可能落在会话 state；A2UI 常只 render_a2ui 不回 Markdown，须在 done 前补发围栏。
            pending_fence = await self._take_pending_kb_sources_fence(session_id)
            assembled_so_far = "".join(assistant_parts)
            from src.agent.mis_rag.qa_pipeline import (
                should_append_pending_kb_sources_fence,
            )

            if pending_fence and should_append_pending_kb_sources_fence(
                assembled_so_far, pending_fence
            ):
                fence_text = (
                    pending_fence
                    if pending_fence.startswith("\n")
                    else f"\n\n{pending_fence}"
                )
                await emit(AgentEvent.text_delta(fence_text))
                assistant_parts.append(fence_text)

            assistant_text: str = "".join(assistant_parts).strip()
            # 成功结束但无任何正文/围栏：补一句可读提示，避免「未收到有效回复」空壳。
            if not assistant_text:
                assistant_text = (
                    "未生成有效文字回复。若查询已成功，请重试让我整理结论；"
                    "也可缩小范围后再问。"
                )
                await emit(AgentEvent.text_delta(assistant_text))
                assistant_parts.append(assistant_text)

            # 评价锚点：落库与 done / 计时 turn_key 共用开局预生成的 UUID。
            # metadata.a2ui：切会话后前端按 surfaces 回填可翻页表 / 卡片。
            persist_meta: dict[str, Any] | None = (
                {"a2ui": {"surfaces": a2ui_surfaces}} if a2ui_surfaces else None
            )
            await self._persist_assistant(
                session_id,
                assistant_text,
                message_id=assistant_message_id,
                metadata=persist_meta,
            )
            await emit(
                AgentEvent.done(
                    total_usage,
                    message_id=assistant_message_id,
                    session_id=session_id,
                )
            )
            await _emit_a2ui_route_timing()
        except Exception:
            recorder.fail()
            emit_timing = locals().get("_emit_a2ui_route_timing")
            if callable(emit_timing):
                try:
                    await emit_timing()
                except Exception:  # noqa: BLE001
                    pass
            raise
        finally:
            reset_parent_progress_emit(progress_token)
            # 与 AgentInstance.process_message 同口径：按轮写入 Redis（TTL 24h）。
            try:
                recorder.step_start("db_persist")
                recorder.step_end("db_persist")
                recorder.step_start("redis_write")
                recorder.step_end("redis_write")
                recorder.step_start("timing_save")
                await store.save(
                    session_id,
                    assistant_message_id,
                    recorder.snapshot(),
                )
                recorder.step_end("timing_save")
            except Exception as save_exc:  # noqa: BLE001
                logger.warning(
                    "A2UI session timing save failed (degraded)",
                    session_id=session_id,
                    error=str(save_exc),
                )
            finally:
                recorder.close()

    # ------------------------------------------------------------------ 工具执行

    async def _execute_tool(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_id: str,
        *,
        identity: dict[str, str] | None = None,
        agent_id: str | None = None,
        ask_tool_metadata: dict[str, Any] | None = None,
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
            ask_tool_metadata: 问数身份头（``X-Mis-*``），合并进工具 metadata。

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

        tool_meta: dict[str, Any] = {
            "session_id": session_id,
            "identity": identity or build_mcp_identity(),
            "agent_id": agent_id or "",
            "coordinator_id": agent_id or "",
        }
        # 只合并受信 BFF 头（入站已剥伪造）；供 agent__invoke / iqd__ask 读取。
        for key, value in (ask_tool_metadata or {}).items():
            if key in ("session_id", "identity"):
                continue
            if value is not None and value != "":
                tool_meta[key] = value
        context: ToolExecutionContext = ToolExecutionContext(
            cwd=Path(self._settings.CONFIG_BASE_PATH).resolve(),
            metadata=tool_meta,
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
        self,
        session_id: str,
        *,
        user_id: str,
        agent_id: str | None,
        mis_user_id: int | None = None,
    ) -> list[LLMMessage]:
        """加载会话历史（最近 ``HISTORY_LIMIT`` 条文本消息）为 LLM 消息。

        会话不存在时尝试创建（Gateway 稳定 sessionId 场景）；SessionManager
        任何异常都降级为空历史（**不阻断** A2UI run 主链路）。

        Args:
            session_id: 会话 ID。
            user_id: 用户 ID（建会话用）。
            agent_id: Agent ID（建会话用；缺省取默认 Agent）。
            mis_user_id: MIS userId；建会话 / 刷新既有会话第五键（T03 S9）。

        Returns:
            平台 LLM 消息列表（可能为空）。
        """
        session_manager: SessionManager = self._session_manager or get_session_manager()
        try:
            session = await session_manager.get_session(session_id)
            if mis_user_id is not None and session.mis_user_id != mis_user_id:
                try:
                    await session_manager.ensure_session(
                        session_id=session_id,
                        agent_id=agent_id or self._settings.AGENT_ROUTER_DEFAULT_AGENT,
                        user_id=user_id,
                        channel="h5",
                        mis_user_id=mis_user_id,
                    )
                except Exception as exc:  # noqa: BLE001 - 刷新身份失败不阻断
                    logger.warning(
                        "A2UI run refresh mis_user_id failed (degraded)",
                        session_id=session_id,
                        error=str(exc),
                    )
        except SessionNotFoundError:
            try:
                await session_manager.ensure_session(
                    session_id=session_id,
                    agent_id=agent_id or self._settings.AGENT_ROUTER_DEFAULT_AGENT,
                    user_id=user_id,
                    channel="h5",
                    mis_user_id=mis_user_id,
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
        """持久化用户文本到会话历史（失败仅告警，不阻断）。

        若会话末条已是相同 user 正文（入站重投 / 恢复路径），跳过写入，避免
        运营侧看到同一问句连续两轮。
        """
        session_manager: SessionManager = self._session_manager or get_session_manager()
        try:
            try:
                session = await session_manager.get_session(session_id)
                messages: list[dict[str, Any]] = session.get_messages()
                if messages:
                    last: dict[str, Any] = messages[-1]
                    if (
                        last.get("role") == "user"
                        and str(last.get("content") or "").strip() == content.strip()
                    ):
                        logger.info(
                            "Skip duplicate user persist (same trailing user text)",
                            session_id=session_id,
                        )
                        return
            except SessionNotFoundError:
                pass
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
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """持久化助手文本到会话历史（失败仅告警，不阻断）。

        Args:
            session_id: 会话 ID。
            content: 助手正文。
            message_id: 预生成的 assistant 消息 UUID（评价锚点）；传 None 时由
                ``add_message`` 内部生成（无锚点场景）。
            metadata: 可选元数据（如 ``a2ui.surfaces`` 历史还原快照）。
        """
        session_manager: SessionManager = self._session_manager or get_session_manager()
        try:
            await session_manager.add_message(
                session_id=session_id,
                role="assistant",
                content=content,
                metadata=metadata,
                message_id=message_id,
            )
        except Exception as exc:  # noqa: BLE001 - 持久化失败降级
            logger.warning(
                "A2UI run persist assistant message failed (degraded)",
                session_id=session_id,
                error=str(exc),
            )

    async def _take_pending_kb_sources_fence(self, session_id: str) -> str | None:
        """取出并清除会话上的 pending kb-sources 围栏（与文本通道对齐）。

        Args:
            session_id: 平台会话 ID。

        Returns:
            围栏原文（含 kb-sources 代码围栏）；无则 ``None``。
        """
        from src.agent.mis_rag.qa_pipeline import PENDING_KB_SOURCES_FENCE_KEY

        session_manager: SessionManager = self._session_manager or get_session_manager()
        try:
            session = await session_manager.get_session(session_id)
        except SessionNotFoundError:
            return None
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "A2UI run load session for kb-sources fence failed",
                session_id=session_id,
                error=str(exc),
            )
            return None

        pending = session.state.pop(PENDING_KB_SOURCES_FENCE_KEY, None)
        if pending is None:
            return None
        try:
            await session_manager.save_session(session)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "A2UI run save session after popping kb-sources fence failed",
                session_id=session_id,
                error=str(exc),
            )
        return str(pending) if pending else None
