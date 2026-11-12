"""OpenHarness 运行时 — 原生 QueryEngine 集成。

使用 OpenHarness 的 ``QueryEngine`` 驱动 agent 循环，``skill`` 工具搭配
``extra_skill_dirs`` 实现渐进式 skill 发现，``McpClientManager`` 用于
MCP 工具注册。LLM 调用通过 ``GatewayApiClient`` 路由到平台的 ``LLMGateway``。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from time import perf_counter
from typing import Any

from src.agent.config import AgentConfig
from src.config import get_settings
from src.coordinator.trace import (
    dispatch_trace_enabled,
    dispatch_trace_event_enabled,
    drain_dispatch_traces,
    persist_dispatch_traces,
)
from src.llm.gateway import LLMGateway
from src.runtime.a2ui_pending import drain_a2ui_renders
from src.runtime.base import AgentRuntime
from src.runtime.events import AgentEvent, HealthStatus, TokenUsage
from src.runtime.oh_runtime_builder import (
    build_native_query_engine,
    connect_mcp_manager,
    resolve_extra_skill_dirs,
)
from src.runtime.step_timing import (
    FORMFILL_TOOL_PREFIX as _FORMFILL_TOOL_PREFIX,
    INVOKE_TOOL_NAMES as _INVOKE_TOOL_NAMES,
    elapsed_ms as _elapsed_ms,
    infer_route_kind,
    intent_from_tool_input as _intent_from_tool_input,
    log_agent_step_timing as _log_agent_step_timing,
    log_route_timing as _log_route_timing,
    skill_id_from_tool_input as _skill_id_from_tool_input,
    worker_from_tool_input as _worker_from_tool_input,
)
from src.utils.logging import get_logger

try:
    from openharness.engine.messages import (
        ConversationMessage,
        ImageBlock,
        TextBlock,
    )
    from openharness.engine.query import MaxTurnsExceeded
    from openharness.engine.query_engine import QueryEngine
    from openharness.engine.stream_events import (
        AssistantTextDelta,
        AssistantTurnComplete,
        ErrorEvent,
        ToolExecutionCompleted,
        ToolExecutionStarted,
    )
    from openharness.mcp.client import McpClientManager

    _OPENHARNESS_AVAILABLE = True
except ImportError:  # pragma: no cover
    _OPENHARNESS_AVAILABLE = False
    MaxTurnsExceeded = type("MaxTurnsExceeded", (Exception,), {})  # type: ignore[misc, assignment]
    McpClientManager = None  # type: ignore[misc, assignment]
    QueryEngine = None  # type: ignore[misc, assignment]
    ImageBlock = None  # type: ignore[misc, assignment]

logger = get_logger("runtime.openharness")

_TRACE_LOG_LIMIT = 1000

#: 触顶时给用户的说明（同时作为 Worker 正文返回，避免空丢弃后协调者连环重试）。
MAX_TURNS_USER_MESSAGE = (
    "查询步骤过多，已中止本轮（达到执行轮次上限）。"
    "请改用更具体的问法（例如明确门店号、月份与指标），"
    "不要对同一问题再次委派。"
)


def user_facing_text_for_llm_turn(
    *,
    buffered_parts: list[str],
    has_tool_uses: bool,
) -> str:
    """决定本轮 LLM 文本是否对用户可见。

    带 ``tool_uses`` 的回合里，模型常输出「I'll load the skill…」类过程旁白；
    这些不应进入 SSE / 透传正文。仅无工具的收尾回合（最终答复）才下发。
    """
    if has_tool_uses:
        return ""
    return "".join(buffered_parts)


def is_max_turns_error_message(message: str | None) -> bool:
    """错误文案是否像执行轮次触顶。"""
    msg = (message or "").lower()
    return "maximum turn" in msg or "max turns" in msg or "maxturnsexceeded" in msg


def is_max_turns_exceeded(exc: BaseException) -> bool:
    """是否为 OpenHarness 执行轮次触顶。"""
    if isinstance(exc, MaxTurnsExceeded):
        return True
    name = type(exc).__name__
    return name == "MaxTurnsExceeded" or is_max_turns_error_message(str(exc))


def remainder_text_after_live_stream(*, full_text: str, already_streamed: str) -> str:
    """终稿 turn_complete 时，若已直播过前缀则只补发后缀，避免叠字。"""
    full = full_text or ""
    streamed = already_streamed or ""
    if not full:
        return ""
    if not streamed:
        return full
    if full.startswith(streamed):
        return full[len(streamed) :]
    if streamed == full:
        return ""
    # 流式与完整文本不一致时不再整包重推（父 SSE 已有直播内容）
    return ""


def _mcp_manager_has_tools(manager: McpClientManager | None) -> bool:
    """判断 MCP 管理器是否已连接并暴露至少一个工具。"""
    if manager is None:
        return False
    return any(status.state == "connected" and status.tools for status in manager.list_statuses())


async def _ensure_native_mcp_manager(
    current: McpClientManager | None,
    agent_config: AgentConfig,
) -> McpClientManager:
    """确保拿到可用的 MCP 管理器；无工具时关闭并重连。

    OpenHarness ``connect_all`` 失败时不抛异常，只会把状态标为 failed。
    Agent 启动时若 MCP 未就绪，会缓存一个空管理器，导致后续请求永远只有
    ``skill`` 工具。此处在无已连接工具时强制重连。
    """
    if _mcp_manager_has_tools(current):
        return current  # type: ignore[return-value]

    if current is not None:
        try:
            await current.close()
        except Exception as exc:
            logger.warning("Failed to close stale MCP manager", error=str(exc))

    manager: McpClientManager = await connect_mcp_manager(agent_config)
    statuses: list[dict[str, Any]] = [
        {
            "name": status.name,
            "state": status.state,
            "detail": status.detail,
            "tools": len(status.tools),
        }
        for status in manager.list_statuses()
    ]
    logger.info(
        "MCP manager ready",
        agent_id=agent_config.agent_id,
        has_tools=_mcp_manager_has_tools(manager),
        statuses=statuses,
    )
    return manager



def _agent_trace_enabled() -> bool:
    """判断当前是否开启 Agent 执行轨迹日志。

    Returns:
        ``True`` 表示应输出 ``Agent trace`` 结构化日志。
    """
    return get_settings().AGENT_TRACE_LOG


def _clip_log_text(text: str, limit: int = _TRACE_LOG_LIMIT) -> str:
    """截断过长文本，避免轨迹日志撑爆单行。

    Args:
        text: 原始文本。
        limit: 最大保留字符数；超出时末尾追加 ``…``。

    Returns:
        去首尾空白并截断后的字符串。
    """
    cleaned: str = (text or "").strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + "…"


def _log_agent_trace(session_id: str, step: int, phase: str, **fields: Any) -> None:
    """在开启轨迹日志时写入一条 Agent 执行阶段记录。

    字符串与 JSON 序列化结果会经 ``_clip_log_text`` 截断后写入
    ``logger.info`` 的 ``Agent trace`` 事件。

    Args:
        session_id: 会话 ID。
        step: 当前执行步序号。
        phase: 阶段标识（如 ``run_start``、``tool_call``）。
        **fields: 附加字段；``None`` 值会被忽略。
    """
    if not _agent_trace_enabled():
        return
    payload: dict[str, Any] = {"session_id": session_id, "step": step, "phase": phase}
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, str):
            payload[key] = _clip_log_text(value)
        elif isinstance(value, (dict, list)):
            try:
                serialized: str = json.dumps(value, ensure_ascii=False, default=str)
                payload[key] = _clip_log_text(serialized, limit=1500)
            except (TypeError, ValueError):
                payload[key] = str(value)
        else:
            payload[key] = value
    logger.info("Agent trace", **payload)


def _attachments_from_meta(metadata: Any) -> list[dict[str, Any]]:
    if not isinstance(metadata, dict):
        return []
    raw = metadata.get("attachments")
    if not isinstance(raw, list):
        return []
    return [a for a in raw if isinstance(a, dict)]


def _user_message_with_attachments(content: str, metadata: Any) -> Any:
    """用户消息：图片附件以 ImageBlock(base64) 注入；其它附件以文本说明。"""
    import base64

    from src.storage.local_files import is_image_mime, read_file_bytes

    text = str(content or "").strip()
    attachments = _attachments_from_meta(metadata)
    if not attachments or ImageBlock is None:
        return ConversationMessage.from_user_text(text or "（空消息）")

    blocks: list[Any] = []
    file_notes: list[str] = []
    for att in attachments:
        file_id = str(att.get("fileId") or att.get("file_id") or "")
        name = str(att.get("name") or file_id or "附件")
        mime = str(att.get("mimeType") or att.get("mime_type") or "")
        if not file_id:
            file_notes.append(f"- {name}")
            continue
        loaded = read_file_bytes(file_id)
        if loaded is None:
            file_notes.append(f"- {name}（文件不可用）")
            continue
        meta, data = loaded
        mime = mime or meta.mime_type
        if is_image_mime(mime):
            # 过大图片不塞进上下文，避免撑爆 prompt
            if len(data) > 4 * 1024 * 1024:
                file_notes.append(f"- 图片 {name}（过大，未送入识图，请压缩后重试）")
                continue
            blocks.append(
                ImageBlock(
                    media_type=mime.split(";")[0].strip() or "image/png",
                    data=base64.b64encode(data).decode("ascii"),
                    source_path=meta.original_name,
                )
            )
        else:
            file_notes.append(f"- {name} ({mime or 'file'}, {meta.size} bytes)")

    note_parts: list[str] = []
    if text:
        note_parts.append(text)
    if file_notes:
        note_parts.append("用户上传的附件：\n" + "\n".join(file_notes))
    if not note_parts and blocks:
        note_parts.append("请结合用户上传的图片回答。")
    if note_parts:
        blocks.insert(0, TextBlock(text="\n\n".join(note_parts)))
    if not blocks:
        return ConversationMessage.from_user_text(text or "（空消息）")
    return ConversationMessage.from_user_content(blocks)


def _platform_messages_to_conversation(messages: list[dict[str, Any]]) -> list[Any]:
    """将平台会话消息转换为 OpenHarness 的 ConversationMessage 列表。"""
    if not _OPENHARNESS_AVAILABLE:
        return []
    result: list[ConversationMessage] = []
    for msg in messages:
        role: str = msg.get("role", "user")
        content: str = msg.get("content", "")
        metadata = msg.get("metadata")
        if role == "assistant":
            result.append(
                ConversationMessage(role="assistant", content=[TextBlock(text=str(content or ""))])
            )
        else:
            result.append(_user_message_with_attachments(str(content or ""), metadata))
    return result


# 历史助手占位：必须空内容。旧版曾用 ``[prior_assistant_answer_omitted]`` /
# 中文「已省略」句，模型会原样复述到用户气泡（多轮跟问常见）。
_HISTORY_ASSISTANT_STUB = ""

#: 若模型仍输出旧占位标记，出站前剥离/拒绝透传。
_LEGACY_HISTORY_STUB_MARKERS: tuple[str, ...] = (
    "[prior_assistant_answer_omitted]",
    "历史查询回复已省略",
    "历史助手回复已省略",
)

_STUB_ECHO_FALLBACK = (
    "本轮未能完成实时查询。请再试一次，或换个问法（需先调工具取数，不能沿用上一轮结论）。"
)

_DEFAULT_LIVE_QUERY_REMINDER = (
    "【强制】本轮涉及业务数据时必须先调用工具实时查询后再回答；"
    "禁止仅根据对话历史中的数据作答；"
    "历史助手正文已清空，禁止输出任何占位标记或「已省略」类说明当作对本轮用户的回答。"
)


def is_force_live_stub_echo(text: str) -> bool:
    """正文是否仅为 forceLiveQuery 历史占位（含旧机器标记）的复述。"""
    raw = (text or "").strip()
    if not raw:
        return False
    cleaned = raw
    for marker in _LEGACY_HISTORY_STUB_MARKERS:
        cleaned = cleaned.replace(marker, "")
    return cleaned.strip() == ""


def strip_force_live_stub_markers(text: str) -> str:
    """去掉正文中的历史占位标记（保留其余有效文字）。"""
    out = text or ""
    for marker in _LEGACY_HISTORY_STUB_MARKERS:
        out = out.replace(marker, "")
    return out


def _apply_force_live_query(
    messages: list[Any],
    *,
    turn_reminder: str = "",
) -> list[Any]:
    """问数场景：清空历史助手正文，并在本轮用户消息追加强制实时查询提醒。

    保留用户历史以便沿用 vipId 等查询条件；去掉助手历史中的业务数据，
    降低模型「口头复用上一轮结果」的概率。

    注意：assistant 占位必须为空（不要写中文说明或机器标记），否则易被复述到气泡。
    """
    if not messages or not _OPENHARNESS_AVAILABLE:
        return messages

    reminder: str = (turn_reminder or _DEFAULT_LIVE_QUERY_REMINDER).strip()
    result: list[Any] = []
    last_index: int = len(messages) - 1
    for index, msg in enumerate(messages):
        role: str = getattr(msg, "role", "") or ""
        is_last: bool = index == last_index
        if role == "assistant" and not is_last:
            result.append(
                ConversationMessage(
                    role="assistant",
                    content=[TextBlock(text=_HISTORY_ASSISTANT_STUB)],
                )
            )
            continue
        if is_last and role == "user" and reminder:
            original: str = (getattr(msg, "text", None) or "").strip()
            combined: str = f"{original}\n\n{reminder}" if original else reminder
            result.append(ConversationMessage.from_user_text(combined))
            continue
        result.append(msg)
    return result


def _append_user_turn_hint(messages: list[Any], hint: str) -> list[Any]:
    """在本轮最后一条用户消息末尾追加预路由提示（不改历史）。"""
    text = (hint or "").strip()
    if not messages or not text or not _OPENHARNESS_AVAILABLE:
        return messages
    result: list[Any] = list(messages)
    last = result[-1]
    role: str = getattr(last, "role", "") or ""
    if role != "user":
        return messages
    original: str = (getattr(last, "text", None) or "").strip()
    combined: str = f"{original}\n\n{text}" if original else text
    result[-1] = ConversationMessage.from_user_text(combined)
    return result


class OpenHarnessRuntime(AgentRuntime):
    """基于原生 OpenHarness QueryEngine 的 Agent 运行时。"""

    def __init__(self) -> None:
        """初始化 OpenHarness 运行时默认状态。

        设置运行时类型/版本、会话状态缓存、LLM 网关占位及
        默认推理参数（步数、温度、token 上限、模型名）。
        """
        self._runtime_type = "openharness"
        self._version = "1.0.0"
        self._config: AgentConfig | None = None
        self._mcp_servers: list[dict[str, Any]] = []
        self._session_states: dict[str, dict[str, Any]] = {}
        self._llm_gateway: LLMGateway | None = None
        self._max_steps = 20
        self._temperature = 0.7
        self._max_tokens = 4096
        self._system_prompt = ""
        self._model = "qwen3.7-plus"
        self._native_mcp_manager: McpClientManager | None = None
        self._initialized = False

    @property
    def runtime_type(self) -> str:
        """返回运行时类型标识。"""
        return self._runtime_type

    @property
    def version(self) -> str:
        """返回运行时版本号。"""
        return self._version

    async def initialize(self, config: Any) -> None:
        """从 Agent 配置加载推理参数、系统提示词与模型名。

        Args:
            config: ``AgentConfig`` 或兼容对象；从中读取 ``runtime.params``、
                ``system_prompt``、``model.primary`` 等字段。

        Raises:
            RuntimeError: 未安装 ``openharness`` 包时抛出。
        """
        if not _OPENHARNESS_AVAILABLE:
            raise RuntimeError(
                "OpenHarness package is not installed. "
                "Install it with: pip install openharness-ai (or uv add openharness-ai)"
            )

        self._config = config

        if hasattr(config, "runtime") and config.runtime:
            params: Any = getattr(config.runtime, "params", {}) or {}
            self._max_steps = params.get("maxSteps", 20)
            self._temperature = params.get("temperature", 0.7)
            self._max_tokens = params.get("maxTokens", 4096)

        if hasattr(config, "system_prompt") and config.system_prompt:
            self._system_prompt = config.system_prompt
        elif hasattr(config, "runtime") and config.runtime:
            prompts: Any = getattr(config.runtime, "prompts", {}) or {}
            self._system_prompt = prompts.get("system_prompt", "")

        if hasattr(config, "model") and config.model:
            self._model = getattr(config.model, "primary", self._model)

        self._initialized = True
        logger.info(
            "OpenHarness runtime initialized",
            max_steps=self._max_steps,
            temperature=self._temperature,
            max_tokens=self._max_tokens,
            model=self._model,
        )

    async def run(
        self,
        messages: list[dict[str, Any]],
        config: Any,
        session_id: str,
        *,
        user_id: str = "",
        user_mobile: str = "",
        channel: str = "",
        channel_user_id: str = "",
        mis_user_id: int | None = None,
        memory_context: str = "",
    ) -> AsyncIterator[AgentEvent]:
        """驱动原生 QueryEngine 执行一轮对话并映射为平台 AgentEvent。

        连接 MCP、构建 QueryEngine，将 OpenHarness 流式事件（文本增量、
        工具调用/结果、轮次完成、错误）转为 ``AgentEvent`` 下发；
        未配置 ``LLMGateway`` 时直接返回错误事件。

        Args:
            messages: 平台格式的会话消息列表。
            config: Agent 配置；若尚未初始化会触发 ``initialize``。
            session_id: 会话 ID，用于 MCP 连接与轨迹日志。
            user_id: 平台用户 ID（注入 MCP 参数与 Header）。
            user_mobile: 用户手机号。
            channel: 渠道类型。
            channel_user_id: 渠道侧 userId。
            mis_user_id: MIS userId（T03 S9 第 3 跳）；注入 MCP identity 第五键，
                供 ``AclToolWrapper`` 做 E1–E5 fail-closed 判权。

        Yields:
            文本增量、工具事件、错误及最终的 ``done`` 事件。
        """
        if not self._initialized:
            await self.initialize(config)

        if self._llm_gateway is None:
            yield AgentEvent.error(
                "RUNTIME_ERROR",
                "LLM Gateway is not configured. Call set_llm_gateway() before run().",
            )
            yield AgentEvent.done()
            return

        agent_config: AgentConfig = (
            config if isinstance(config, AgentConfig) else self._config  # type: ignore[assignment]
        )
        oh_messages: list[Any] = _platform_messages_to_conversation(messages)
        runtime_params: dict[str, Any] = {}
        runtime_prompts: dict[str, Any] = {}
        if isinstance(agent_config, AgentConfig) and agent_config.runtime is not None:
            runtime_params = dict(agent_config.runtime.params or {})
            runtime_prompts = dict(agent_config.runtime.prompts or {})
        force_live_query: bool = bool(
            runtime_params.get("forceLiveQuery")
            or runtime_params.get("force_live_query")
        )
        if force_live_query:
            reminder: str = str(
                runtime_prompts.get("turn_reminder")
                or runtime_prompts.get("turnReminder")
                or ""
            )
            oh_messages = _apply_force_live_query(
                oh_messages,
                turn_reminder=reminder,
            )
            logger.info(
                "Force live query enabled for this turn",
                session_id=session_id,
                history_messages=len(oh_messages),
            )

        last_user_msg: Any = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        agent_id_early: str = getattr(agent_config, "agent_id", "") or ""
        # Worker 规则引擎 → router skill；步骤可配 JEV（INTENT_DETECT_* 独立 Key）
        # 模板报告首步委派仅在 Coordinator a2ui_run；此处不短路。
        try:
            from src.intent_router.service import (
                format_router_skill_hint,
                resolve_intent_route,
            )

            user_text_for_route = (
                last_user_msg if isinstance(last_user_msg, str) else str(last_user_msg or "")
            )
            route_decision = await resolve_intent_route(
                agent_id_early,
                user_text_for_route,
                session_id=session_id or "",
            )
            if route_decision is not None and route_decision.router_skill:
                oh_messages = _append_user_turn_hint(
                    oh_messages,
                    format_router_skill_hint(route_decision.router_skill),
                )
        except Exception:  # noqa: BLE001 - 预路由失败不阻断对话
            logger.warning(
                "intent route resolve failed",
                agent_id=agent_id_early,
                exc_info=True,
            )

        skill_dirs: list[str] = resolve_extra_skill_dirs(
            agent_config, Path(get_settings().CONFIG_BASE_PATH)
        )
        _log_agent_trace(
            session_id,
            step=0,
            phase="run_start",
            user_message=last_user_msg,
            model=self._model,
            skill_dirs=skill_dirs,
            runtime="native_openharness",
        )

        total_usage: TokenUsage = TokenUsage()
        step: int = 0
        turn_t0: float = perf_counter()
        ms_to_first_text: int | None = None
        ms_to_first_tool: int | None = None
        first_tool: str | None = None
        ms_to_first_invoke: int | None = None
        invoke_intent: str | None = None
        invoke_worker: str | None = None
        ms_to_first_formfill: int | None = None
        agent_id: str = getattr(agent_config, "agent_id", "") or ""
        role_value: str = str(getattr(getattr(agent_config, "role", None), "value", "") or "")
        model_name: str = str(self._model or "")
        # Worker/Coordinator 逐步耗时：每轮 LLM、每次 skill/tool
        llm_segment_t0: float | None = None
        llm_ttft_ms: int | None = None
        llm_turn_index: int = 0
        tool_call_index: int = 0
        skill_call_index: int = 0
        sum_llm_ms: int = 0
        sum_tool_ms: int = 0
        sum_skill_ms: int = 0
        pending_tools: list[tuple[str, str | None, float]] = []
        # 供 MaxTurns soft-finish 在 except 中可读
        turn_text_parts: list[str] = []
        live_emitted_text_chars: int = 0

        def _emit_route_timing(
            *,
            dispatch_items: list[dict[str, Any]] | None = None,
        ) -> None:
            items = dispatch_items or []
            first_dispatch_latency: int | None = None
            for entry in items:
                raw_latency = entry.get("latency_ms")
                if isinstance(raw_latency, (int, float)):
                    first_dispatch_latency = int(raw_latency)
                    break
            route_kind = infer_route_kind(
                ms_to_first_invoke=ms_to_first_invoke,
                ms_to_first_formfill=ms_to_first_formfill,
                ms_to_first_tool=ms_to_first_tool,
                ms_to_first_text=ms_to_first_text,
            )
            _log_route_timing(
                agent_id=agent_id,
                role=role_value,
                session_id=session_id,
                model=model_name,
                total_ms=_elapsed_ms(turn_t0),
                ms_to_first_text=ms_to_first_text,
                ms_to_first_tool=ms_to_first_tool,
                first_tool=first_tool,
                ms_to_first_invoke=ms_to_first_invoke,
                invoke_intent=invoke_intent,
                invoke_worker=invoke_worker,
                ms_to_first_formfill=ms_to_first_formfill,
                route_kind=route_kind,
                dispatch_count=len(items),
                dispatch_worker_latency_ms=first_dispatch_latency,
                llm_turns=llm_turn_index,
                tool_calls=tool_call_index,
                skill_calls=skill_call_index,
                sum_llm_ms=sum_llm_ms,
                sum_tool_ms=sum_tool_ms,
                sum_skill_ms=sum_skill_ms,
            )

        try:
            self._native_mcp_manager = await _ensure_native_mcp_manager(
                self._native_mcp_manager,
                agent_config,
            )

            engine: QueryEngine = await build_native_query_engine(
                agent_config,
                self._llm_gateway,
                self._native_mcp_manager,
                session_id=session_id,
                user_id=user_id,
                user_mobile=user_mobile,
                channel=channel,
                channel_user_id=channel_user_id,
                mis_user_id=mis_user_id,
                memory_context=memory_context,
            )

            # 把本轮请求体 metadata（BFF ``IqdAskFacadeService.buildBody`` 注入的
            # ``metadata.iqd.{question,view,connection_id,simulate_role_code,scope_hint}``，
            # 以及未来任何 body 承载的范围信息）合并进工具的 tool_metadata。
            # 工具执行上下文 metadata 与本 dict 同源（openharness QueryContext.tool_metadata
            # → ToolExecutionContext.metadata），故 iqd__ask 的 ``_build_identity`` 才能读到
            # ``iqd.simulate_role_code``；此前该 metadata 在会话→运行时转换时被丢弃。
            try:
                _req_meta: Any = None
                for _m in reversed(messages):
                    if not isinstance(_m, dict):
                        continue
                    _candidate = _m.get("metadata")
                    if isinstance(_candidate, dict) and _candidate:
                        _req_meta = _candidate
                        break
                if _req_meta:
                    engine.tool_metadata.update(_req_meta)
            except Exception:  # noqa: BLE001 - 元数据合并失败不得阻断对话
                logger.warning("merge request metadata into tool_metadata failed", exc_info=True)

            if len(oh_messages) > 1:
                engine.load_messages(oh_messages[:-1])
                prompt: Any = oh_messages[-1]
            elif oh_messages:
                prompt: Any = oh_messages[-1]
            else:
                prompt: Any = ConversationMessage.from_user_text("")

            # 首轮 LLM 计时从真正开跑引擎算起（不含上面 MCP/引擎构建）
            llm_segment_t0 = perf_counter()
            llm_ttft_ms = None
            # forceLiveQuery：拦截把历史占位复述成「正式回复」的 delta
            live_emitted_text_chars = 0
            live_suppressed_stub = False
            # Worker：delta 级真流式（过程旁白也会下发）；Copilot 前端在 tool.step
            # start 时清空气泡旁白，仅保留工具结束后的收尾正文。
            # Coordinator：缓冲到 turn_complete，避免委派旁白泄漏。
            live_stream_enabled = role_value == "worker"
            turn_text_parts = []
            turn_live_streamed = False
            live_upstream_delta_count = 0
            live_upstream_delta_chars = 0

            async for event in engine.submit_message(prompt):
                step += 1
                if isinstance(event, AssistantTextDelta):
                    delta_text = event.text or ""
                    if force_live_query:
                        stripped = strip_force_live_stub_markers(delta_text)
                        if is_force_live_stub_echo(delta_text) or (
                            not stripped.strip() and delta_text.strip()
                        ):
                            live_suppressed_stub = True
                            logger.warning(
                                "force_live_query suppressed stub echo delta",
                                session_id=session_id,
                                agent_id=agent_id,
                            )
                            continue
                        delta_text = stripped
                        if not delta_text:
                            continue
                    turn_text_parts.append(delta_text)
                    live_upstream_delta_count += 1
                    live_upstream_delta_chars += len(delta_text)
                    if llm_segment_t0 is not None and llm_ttft_ms is None:
                        llm_ttft_ms = _elapsed_ms(llm_segment_t0)
                    _log_agent_trace(
                        session_id, step=step, phase="text_delta", assistant_text=delta_text
                    )
                    if live_stream_enabled:
                        # 真流式：立即下发；工具轮旁白由前端在 tool.step start 时替换掉
                        if ms_to_first_text is None:
                            ms_to_first_text = _elapsed_ms(turn_t0)
                        live_emitted_text_chars += len(delta_text)
                        turn_live_streamed = True
                        yield AgentEvent.text_delta(delta_text)
                elif isinstance(event, ToolExecutionStarted):
                    if turn_text_parts:
                        suppressed = "".join(turn_text_parts)
                        turn_text_parts.clear()
                        if turn_live_streamed:
                            logger.info(
                                "tool_turn_scratchpad_streamed_frontend_will_replace",
                                session_id=session_id,
                                agent_id=agent_id,
                                chars=len(suppressed),
                                preview=suppressed[:120],
                            )
                        else:
                            logger.info(
                                "suppressed tool-turn scratchpad text",
                                session_id=session_id,
                                agent_id=agent_id,
                                chars=len(suppressed),
                                preview=suppressed[:120],
                            )
                    turn_live_streamed = False
                    live_upstream_delta_count = 0
                    live_upstream_delta_chars = 0
                    tool_name = str(event.tool_name or "")
                    skill_id = _skill_id_from_tool_input(tool_name, event.tool_input)
                    pending_tools.append((tool_name, skill_id, perf_counter()))
                    if ms_to_first_tool is None:
                        ms_to_first_tool = _elapsed_ms(turn_t0)
                        first_tool = tool_name or None
                    if tool_name in _INVOKE_TOOL_NAMES and ms_to_first_invoke is None:
                        ms_to_first_invoke = _elapsed_ms(turn_t0)
                        invoke_intent = _intent_from_tool_input(event.tool_input)
                        invoke_worker = _worker_from_tool_input(event.tool_input)
                    if tool_name.startswith(_FORMFILL_TOOL_PREFIX) and ms_to_first_formfill is None:
                        ms_to_first_formfill = _elapsed_ms(turn_t0)
                    yield AgentEvent.tool_call(event.tool_name, event.tool_input)
                    _log_agent_trace(
                        session_id,
                        step=step,
                        phase="tool_call",
                        tool=event.tool_name,
                        args=event.tool_input,
                    )
                elif isinstance(event, ToolExecutionCompleted):
                    tool_name = str(event.tool_name or "")
                    tool_t0: float | None = None
                    skill_id: str | None = None
                    for i in range(len(pending_tools) - 1, -1, -1):
                        if pending_tools[i][0] == tool_name:
                            _name, skill_id, tool_t0 = pending_tools.pop(i)
                            break
                    duration_ms = _elapsed_ms(tool_t0) if tool_t0 is not None else 0
                    tool_call_index += 1
                    sum_tool_ms += duration_ms
                    if tool_name == "skill":
                        skill_call_index += 1
                        sum_skill_ms += duration_ms
                    _log_agent_step_timing(
                        agent_id=agent_id,
                        role=role_value,
                        session_id=session_id,
                        model=model_name,
                        kind="tool",
                        step=step,
                        index=tool_call_index,
                        duration_ms=duration_ms,
                        since_turn_ms=_elapsed_ms(turn_t0),
                        tool=tool_name or None,
                        skill_id=skill_id,
                        is_error=bool(event.is_error),
                    )
                    if not pending_tools:
                        # 本批工具结束，下一轮 LLM 计时起点
                        llm_segment_t0 = perf_counter()
                        llm_ttft_ms = None
                    result: dict[str, Any] = {"output": event.output}
                    if event.is_error:
                        result["error"] = event.output
                    yield AgentEvent.tool_result(event.tool_name, result)
                    _log_agent_trace(
                        session_id,
                        step=step,
                        phase="tool_result",
                        tool=event.tool_name,
                        result=result,
                        error=result.get("error"),
                    )
                elif isinstance(event, AssistantTurnComplete):
                    usage: Any = event.usage
                    turn_tokens = usage.input_tokens + usage.output_tokens
                    total_usage: TokenUsage = TokenUsage(
                        prompt=usage.input_tokens,
                        completion=usage.output_tokens,
                        total=turn_tokens,
                    )
                    has_tool_uses = bool(event.message.tool_uses)
                    finish_reason = "tool_calls" if has_tool_uses else "stop"
                    llm_turn_index += 1
                    duration_ms = (
                        _elapsed_ms(llm_segment_t0) if llm_segment_t0 is not None else 0
                    )
                    sum_llm_ms += duration_ms
                    _log_agent_step_timing(
                        agent_id=agent_id,
                        role=role_value,
                        session_id=session_id,
                        model=model_name,
                        kind="llm",
                        step=step,
                        index=llm_turn_index,
                        duration_ms=duration_ms,
                        since_turn_ms=_elapsed_ms(turn_t0),
                        finish_reason=finish_reason,
                        tokens=turn_tokens,
                        ttft_ms=llm_ttft_ms,
                    )
                    # 无工具 → 补齐未直播后缀；有工具 → 旁白已在 tool start 处理
                    buffered_delta_count = len(turn_text_parts)
                    already_streamed = "".join(turn_text_parts) if turn_live_streamed else ""
                    facing = user_facing_text_for_llm_turn(
                        buffered_parts=turn_text_parts,
                        has_tool_uses=has_tool_uses,
                    )
                    turn_text_parts.clear()
                    facing_source = "buffered_deltas"
                    if not facing and not has_tool_uses:
                        facing = str(event.message.text or "")
                        facing_source = "message_text_only"
                    to_emit = ""
                    emit_mode = "none"
                    if has_tool_uses:
                        if (event.message.text or "").strip() and not turn_live_streamed:
                            logger.info(
                                "suppressed tool-turn scratchpad text",
                                session_id=session_id,
                                agent_id=agent_id,
                                chars=len(event.message.text or ""),
                                preview=(event.message.text or "")[:120],
                            )
                    elif turn_live_streamed:
                        # 增量已直播；仅补 message.text 相对前缀的后缀
                        full = facing or str(event.message.text or "")
                        to_emit = remainder_text_after_live_stream(
                            full_text=full, already_streamed=already_streamed
                        )
                        emit_mode = "live_stream"
                        facing_source = "live_deltas"
                    elif facing:
                        to_emit = facing
                        emit_mode = "turn_complete_dump"
                    if to_emit:
                        if ms_to_first_text is None:
                            ms_to_first_text = _elapsed_ms(turn_t0)
                        live_emitted_text_chars += len(to_emit)
                        logger.info(
                            "worker_final_text_emit",
                            session_id=session_id,
                            agent_id=agent_id,
                            finish_reason=finish_reason,
                            emit_mode=emit_mode,
                            facing_chars=len(to_emit)
                            + (len(already_streamed) if emit_mode == "live_stream" else 0),
                            remainder_chars=len(to_emit) if emit_mode == "live_stream" else None,
                            facing_source=facing_source,
                            upstream_delta_count=live_upstream_delta_count,
                            upstream_delta_chars=live_upstream_delta_chars,
                            buffered_delta_count=buffered_delta_count,
                            true_token_stream_to_sse=(emit_mode == "live_stream"),
                        )
                        yield AgentEvent.text_delta(to_emit)
                    elif emit_mode == "live_stream":
                        logger.info(
                            "worker_final_text_emit",
                            session_id=session_id,
                            agent_id=agent_id,
                            finish_reason=finish_reason,
                            emit_mode="live_stream",
                            facing_chars=len(already_streamed),
                            remainder_chars=0,
                            facing_source=facing_source,
                            upstream_delta_count=live_upstream_delta_count,
                            upstream_delta_chars=live_upstream_delta_chars,
                            buffered_delta_count=buffered_delta_count,
                            true_token_stream_to_sse=True,
                        )
                    turn_live_streamed = False
                    live_upstream_delta_count = 0
                    live_upstream_delta_chars = 0
                    # 若本轮无工具，下一轮（若有）从现在重新计；有工具则等工具批结束后重置
                    if finish_reason == "stop":
                        llm_segment_t0 = perf_counter()
                        llm_ttft_ms = None
                    _log_agent_trace(
                        session_id,
                        step=step,
                        phase="llm_response",
                        assistant_text=event.message.text,
                        finish_reason=finish_reason,
                        tokens=total_usage.total,
                    )
                elif isinstance(event, ErrorEvent):
                    yield AgentEvent.error("RUNTIME_ERROR", event.message)

            # 引擎正常结束时的残余缓冲（直播路径下通常已空）
            if turn_text_parts and not turn_live_streamed:
                leftover = user_facing_text_for_llm_turn(
                    buffered_parts=list(turn_text_parts),
                    has_tool_uses=tool_call_index > 0,
                )
                turn_text_parts.clear()
                if leftover:
                    if ms_to_first_text is None:
                        ms_to_first_text = _elapsed_ms(turn_t0)
                    live_emitted_text_chars += len(leftover)
                    yield AgentEvent.text_delta(leftover)
            else:
                turn_text_parts.clear()
                turn_live_streamed = False

            # 整轮只复述了历史占位、又没调工具：换成可读提示，避免气泡只剩机器标记
            if (
                force_live_query
                and live_suppressed_stub
                and live_emitted_text_chars == 0
                and tool_call_index == 0
            ):
                logger.warning(
                    "force_live_query stub-only turn; emitting fallback",
                    session_id=session_id,
                    agent_id=agent_id,
                )
                if ms_to_first_text is None:
                    ms_to_first_text = _elapsed_ms(turn_t0)
                yield AgentEvent.text_delta(_STUB_ECHO_FALLBACK)

            # 下发本轮回填工具产生的 A2UI 渲染（entity-select 等）。
            # 工具在 agent 循环内部运行无法直接 yield AgentEvent，故经挂起缓冲，
            # 在此统一 drain 后作为 ui.render 事件下发，保证选择卡片可靠到达前端。
            a2ui_items: list[dict[str, Any]] = await drain_a2ui_renders(session_id)
            for item in a2ui_items:
                yield AgentEvent.ui_render(item["component"], item["props"])
                _log_agent_trace(
                    session_id,
                    step=step,
                    phase="a2ui_render",
                    component=item["component"],
                    props=item["props"],
                )

            # 下发本轮 Coordinator→Worker 委派轨迹（design-impl.md §4.4）。
            # 委派工具同样运行在 agent 循环内部，无法直接 yield，故复用
            # a2ui 的挂起缓冲范式，在此统一 drain 后按三通道分发：
            #   通道 A（DISPATCH_TRACE_ENABLED，默认开）：写 session.state + 结构化日志；
            #   通道 B（DISPATCH_TRACE_SSE_ENABLED，默认关）：由 SSE 路由读取本轮快照；
            #   通道 C（DISPATCH_TRACE_EVENT_ENABLED，默认开）：额外 yield dispatch.trace 事件。
            # 三通道全关时本段除一次空 drain 外无任何外部可见副作用，
            # 默认 SSE done 帧保持逐字节一致。
            dispatch_items: list[dict[str, Any]] = await drain_dispatch_traces(session_id)
            if dispatch_items:
                if dispatch_trace_enabled():
                    await persist_dispatch_traces(session_id, dispatch_items)
                    for entry in dispatch_items:
                        _log_agent_trace(
                            session_id,
                            step=step,
                            phase="dispatch",
                            intent=entry.get("intent"),
                            worker_id=entry.get("worker_id"),
                            tool=entry.get("tool"),
                            status=entry.get("status"),
                            latency_ms=entry.get("latency_ms"),
                            task_id=entry.get("task_id"),
                            brief_rejected=entry.get("brief_rejected"),
                        )
                if dispatch_trace_event_enabled():
                    yield AgentEvent.dispatch_trace(dispatch_items)

            yield AgentEvent.done(total_usage)
            _log_agent_trace(
                session_id,
                step=step,
                phase="run_complete",
                total_steps=step,
                total_tokens=total_usage.total,
            )
            _emit_route_timing(dispatch_items=dispatch_items)
            logger.info(
                "Agent run completed",
                session_id=session_id,
                steps=step,
                total_tokens=total_usage.total,
                runtime="native_openharness",
            )

        except MaxTurnsExceeded as exc:
            # 触顶：salvage 已缓冲正文；无正文则给明确说明，且不发 ERROR，
            # 避免协调者把空失败当「可重试」再连环委派。
            salvage = ""
            try:
                salvage = "".join(turn_text_parts).strip()
                turn_text_parts.clear()
            except Exception:  # noqa: BLE001
                salvage = ""
            if salvage:
                if ms_to_first_text is None:
                    ms_to_first_text = _elapsed_ms(turn_t0)
                live_emitted_text_chars += len(salvage)
                yield AgentEvent.text_delta(salvage)
            if live_emitted_text_chars <= 0:
                if ms_to_first_text is None:
                    ms_to_first_text = _elapsed_ms(turn_t0)
                live_emitted_text_chars += len(MAX_TURNS_USER_MESSAGE)
                yield AgentEvent.text_delta(MAX_TURNS_USER_MESSAGE)
            logger.warning(
                "max_turns_exceeded_soft_finish",
                session_id=session_id,
                agent_id=agent_id,
                error=str(exc),
                salvage_chars=len(salvage),
                emitted_chars=live_emitted_text_chars,
                llm_turns=llm_turn_index,
                tool_calls=tool_call_index,
            )
            try:
                _emit_route_timing(dispatch_items=[])
            except Exception:  # noqa: BLE001
                pass
            yield AgentEvent.done(total_usage)
        except Exception as exc:
            if is_max_turns_exceeded(exc):
                # 兜底：某些版本/包装下 MaxTurns 可能不是原类型
                salvage = ""
                try:
                    salvage = "".join(turn_text_parts).strip()
                    turn_text_parts.clear()
                except Exception:  # noqa: BLE001
                    salvage = ""
                if salvage:
                    if ms_to_first_text is None:
                        ms_to_first_text = _elapsed_ms(turn_t0)
                    live_emitted_text_chars += len(salvage)
                    yield AgentEvent.text_delta(salvage)
                if live_emitted_text_chars <= 0:
                    if ms_to_first_text is None:
                        ms_to_first_text = _elapsed_ms(turn_t0)
                    live_emitted_text_chars += len(MAX_TURNS_USER_MESSAGE)
                    yield AgentEvent.text_delta(MAX_TURNS_USER_MESSAGE)
                logger.warning(
                    "max_turns_exceeded_soft_finish",
                    session_id=session_id,
                    agent_id=agent_id,
                    error=str(exc),
                    salvage_chars=len(salvage),
                    emitted_chars=live_emitted_text_chars,
                    via="message_match",
                )
                try:
                    _emit_route_timing(dispatch_items=[])
                except Exception:  # noqa: BLE001
                    pass
                yield AgentEvent.done(total_usage)
            else:
                logger.error(
                    "Agent run failed",
                    session_id=session_id,
                    error=str(exc),
                    exc_info=True,
                )
                try:
                    _emit_route_timing(dispatch_items=[])
                except Exception:  # noqa: BLE001 - 观测日志失败不得掩盖原异常
                    pass
                yield AgentEvent.error("RUNTIME_ERROR", str(exc))
                yield AgentEvent.done()

    async def register_tools(self, skills: list[dict[str, Any]]) -> None:
        """空操作 — 原生 OpenHarness 通过 ``extra_skill_dirs`` 发现 skills。"""
        logger.debug("register_tools skipped (native OpenHarness)", skill_count=len(skills))

    async def register_mcp(self, server_config: dict[str, Any]) -> None:
        """记录 MCP 服务器配置，供健康检查与后续连接使用。

        Args:
            server_config: MCP 服务器描述（含 ``name`` 等字段）。
        """
        self._mcp_servers.append(server_config)
        logger.debug(
            "MCP server config recorded",
            name=server_config.get("name", "unknown"),
        )

    async def get_state(self, session_id: str) -> dict[str, Any]:
        """读取指定会话的运行时状态快照。

        Args:
            session_id: 会话 ID。

        Returns:
            已保存的状态字典；无记录时返回空 dict。
        """
        return self._session_states.get(session_id, {})

    async def set_state(self, session_id: str, state: dict[str, Any]) -> None:
        """写入指定会话的运行时状态。

        Args:
            session_id: 会话 ID。
            state: 要持久化到内存的状态字典。
        """
        self._session_states[session_id] = state

    async def health_check(self) -> HealthStatus:
        """检查运行时是否已初始化且 OpenHarness 依赖可用。

        Returns:
            含初始化状态、MCP 连接、活跃会话数等细节的 ``HealthStatus``。
        """
        return HealthStatus(
            healthy=self._initialized and _OPENHARNESS_AVAILABLE,
            details={
                "runtime_type": self._runtime_type,
                "version": self._version,
                "runtime_mode": "native_openharness",
                "openharness_available": _OPENHARNESS_AVAILABLE,
                "initialized": self._initialized,
                "native_mcp_connected": self._native_mcp_manager is not None,
                "mcp_servers": len(self._mcp_servers),
                "active_sessions": len(self._session_states),
                "llm_gateway_configured": self._llm_gateway is not None,
            },
        )

    async def shutdown(self) -> None:
        """清理会话状态、关闭原生 MCP 管理器并重置初始化标志。"""
        self._session_states.clear()
        if self._native_mcp_manager is not None:
            await self._native_mcp_manager.close()
            self._native_mcp_manager = None
        self._initialized = False
        logger.info("OpenHarness runtime shut down")

    def set_llm_gateway(self, gateway: LLMGateway) -> None:
        """注入平台 LLM 网关，供 QueryEngine 经 ``GatewayApiClient`` 调用。

        Args:
            gateway: 已配置的 ``LLMGateway`` 实例。
        """
        self._llm_gateway = gateway

    def set_native_mcp_manager(self, manager: McpClientManager) -> None:
        """注入已连接的原生 MCP 客户端管理器（测试或预热场景）。

        Args:
            manager: OpenHarness ``McpClientManager`` 实例。
        """
        self._native_mcp_manager = manager
