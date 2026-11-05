"""LLM Gateway 适配器，实现了 OpenHarness 的 SupportsStreamingMessages 接口。"""

from __future__ import annotations
from typing import Any

import json
import re
from collections.abc import AsyncIterator

from openharness.api.client import (
    ApiMessageCompleteEvent,
    ApiMessageRequest,
    ApiStreamEvent,
    ApiTextDeltaEvent,
)
from openharness.api.openai_client import _convert_messages_to_openai, _convert_tools_to_openai
from openharness.api.usage import UsageSnapshot
from openharness.engine.messages import ConversationMessage, TextBlock, ToolUseBlock

from src.llm.gateway import LLMGateway
from src.llm.models import LLMMessage, LLMRequest, LLMRole, TokenUsage
from src.utils.logging import get_logger

logger = get_logger("runtime.gateway_api_client")

#: Qwen thinking / 伪 tool XML，偶发泄漏进 content，前端 Markdown 再一切就成乱码碎片
_LEAKED_TAG_RE = re.compile(
    r"<think>[\s\S]*?</think>"
    r"|<thinking>[\s\S]*?</thinking>"
    r"|<tool_call>[\s\S]*?</tool_call>"
    r"|</?think>"
    r"|</?thinking>",
    re.IGNORECASE,
)

#: 内部哨兵：乱码被识别后写入 OH 消息，禁止当作用户可见成功正文。
_GARBAGE_SENTINEL = "[[MIS_MODEL_OUTPUT_GARBAGE]]"

#: 委派失败时对用户展示的明确重试提示（非「成功透传兜底」）。
MODEL_GARBAGE_RETRY_MESSAGE = (
    "本轮模型输出异常，未能完成查询。请重试提问；建议新开对话后再问一次。"
)

#: 兼容已发出的旧兜底文案（曾被误当成功透传）
_LEGACY_GARBAGE_FALLBACKS: tuple[str, ...] = (
    MODEL_GARBAGE_RETRY_MESSAGE,
    "本轮未能生成有效业务回复（模型输出异常）。"
    "请新开对话后再问一次；若连续失败，可缩小问题范围或稍后重试。",
    "本轮模型输出异常（疑似思考链/工具碎片泄漏）。请再试一次；"
    "若持续出现，请确认 Worker 已关闭 enable_thinking 并已重启 Agent。",
)


def sanitize_model_text(text: str) -> str:
    """剥离泄漏进正文的 thinking / tool_call 标签。"""
    return _LEAKED_TAG_RE.sub("", text or "").strip()


def is_model_garbage_payload(text: str) -> bool:
    """是否为不可对用户成功展示的模型异常正文（哨兵 / 旧兜底 / 乱码）。"""
    t = (text or "").strip()
    if not t:
        return False
    if _GARBAGE_SENTINEL in t:
        return True
    for legacy in _LEGACY_GARBAGE_FALLBACKS:
        if t == legacy or legacy in t:
            return True
    return looks_like_garbage_text(t)


def looks_like_garbage_text(text: str) -> bool:
    """粗判不可对用户展示的异常正文。

    - 无中文且符号扎堆（tool/thinking 碎片）
    - 较长正文完全无中文（业务 Worker 几乎总有中文；见 chat_15 乱码透传）
    - 模型复读网关注入的「强制行为控制」类元指令
    """
    t = (text or "").strip()
    if len(t) < 8:
        return False
    if "强制行为控制" in t and "所有任务必须遵守" in t:
        return True
    cjk = sum(1 for c in t if "\u4e00" <= c <= "\u9fff")
    alnum = sum(1 for c in t if c.isalnum())
    space = sum(1 for c in t if c.isspace())
    weird = sum(1 for c in t if c in '{}[]<>="\\|;`^~')
    digits = sum(1 for c in t if c.isdigit())
    # 业务回复几乎总有中文；完全无中文且符号扎堆 → 视为碎片/乱码
    if cjk == 0 and weird >= 3 and (alnum + space) / len(t) < 0.75:
        return True
    # 无中文 + 工具/JSON 符号，或数字循环碎片（chat_15：i1=7065…1403140）
    # 注意：不要仅凭「无中文」误伤正常英文短答
    if cjk == 0 and len(t) >= 40 and (weird >= 2 or digits / len(t) >= 0.35):
        return True
    if cjk == 0 and len(t) >= 24 and digits / len(t) >= 0.45:
        return True
    good = cjk + alnum + space
    return (good / len(t)) < 0.4


def _normalize_assistant_text(text: str) -> str:
    """净化模型正文；乱码改为内部哨兵，由委派层显式失败而非成功透传。"""
    cleaned = sanitize_model_text(text)
    if cleaned and looks_like_garbage_text(cleaned):
        logger.warning(
            "assistant text looks like garbage; marking sentinel",
            preview=cleaned[:80],
        )
        return _GARBAGE_SENTINEL
    return cleaned


def _openai_messages_to_llm(openai_messages: list[dict[str, Any]]) -> list[LLMMessage]:
    """将 OpenAI 格式的聊天消息转换为平台的 LLMMessage 列表。"""
    llm_messages: list[LLMMessage] = []
    for msg in openai_messages:
        role: str = msg.get("role", "user")
        if role == "system":
            llm_messages.append(
                LLMMessage(role=LLMRole.SYSTEM, content=msg.get("content", "") or "")
            )
            continue
        if role == "tool":
            llm_messages.append(
                LLMMessage(
                    role=LLMRole.TOOL,
                    content=msg.get("content", "") or "",
                    tool_call_id=msg.get("tool_call_id", ""),
                )
            )
            continue
        if role == "assistant":
            tool_calls: Any = msg.get("tool_calls") or []
            api_tool_calls: list[dict[str, Any]] = [
                {
                    "id": tc.get("id", ""),
                    "type": "function",
                    "function": {
                        "name": tc.get("function", {}).get("name", ""),
                        "arguments": tc.get("function", {}).get("arguments", "{}"),
                    },
                }
                for tc in tool_calls
            ]
            llm_messages.append(
                LLMMessage(
                    role=LLMRole.ASSISTANT,
                    content=msg.get("content") or "",
                    tool_calls=api_tool_calls,
                )
            )
            continue
        raw_content = msg.get("content", "")
        # 保留多模态 list（含 image_url），供 Qwen-VL 等；勿强制转 str
        if isinstance(raw_content, list):
            content: str | list[dict[str, Any]] = raw_content
        else:
            content = raw_content or ""
        llm_messages.append(LLMMessage(role=LLMRole.USER, content=content))
    return llm_messages


def _merge_tool_call_delta(
    acc: dict[int, dict[str, Any]],
    deltas: list[dict[str, Any]],
) -> None:
    """按 index 拼接流式 tool_calls（id/name 首包，arguments 追加）。"""
    for delta in deltas:
        idx = int(delta.get("index", 0) or 0)
        slot = acc.setdefault(
            idx,
            {
                "id": "",
                "type": "function",
                "function": {"name": "", "arguments": ""},
            },
        )
        if delta.get("id"):
            slot["id"] = str(delta["id"])
        if delta.get("type"):
            slot["type"] = str(delta["type"])
        fn = delta.get("function") if isinstance(delta.get("function"), dict) else {}
        name = fn.get("name")
        if name:
            slot["function"]["name"] = str(slot["function"].get("name") or "") + str(name)
        args = fn.get("arguments")
        if args is not None and args != "":
            slot["function"]["arguments"] = str(slot["function"].get("arguments") or "") + str(
                args
            )


def _tool_calls_to_content_blocks(
    tool_calls: list[dict[str, Any]],
) -> list[ToolUseBlock]:
    """将拼好的 tool_calls 转为 OpenHarness ToolUseBlock 列表。

    跳过空 ``name``：Qwen thinking+tools 偶发空名调用，若原样下发会变成
    ``Unknown tool:`` 并污染 Worker 正文（见 Copilot「工具告警」）。
    """
    blocks: list[ToolUseBlock] = []
    for tc in tool_calls:
        function: dict[str, Any] = tc.get("function", {}) if isinstance(tc, dict) else {}
        name = str(function.get("name") or "").strip()
        if not name:
            logger.warning(
                "skip tool_call with empty name",
                tool_call_id=str(tc.get("id") or "") if isinstance(tc, dict) else "",
            )
            continue
        raw_args: str = function.get("arguments", "{}")
        try:
            parsed_args: Any = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except (json.JSONDecodeError, TypeError):
            parsed_args = {}
        blocks.append(
            ToolUseBlock(
                id=tc.get("id", "") if isinstance(tc, dict) else "",
                name=name,
                input=parsed_args if isinstance(parsed_args, dict) else {},
            )
        )
    return blocks


class GatewayApiClient:
    """将 OpenHarness QueryEngine 的 LLM 调用路由通过平台的 LLMGateway 发送。"""

    def __init__(
        self,
        gateway: LLMGateway,
        *,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        session_id: str = "",
        user_id: str = "",
        dept: str = "",
        enable_thinking: bool | None = None,
        request_extra: dict[str, Any] | None = None,
    ) -> None:
        """保存 LLM 网关与推理参数，供 OpenHarness API 请求路由使用。

        Args:
            gateway: 平台 ``LLMGateway`` 实例。
            model: 默认模型名。
            temperature: 采样温度。
            max_tokens: 单次补全 token 上限。
            session_id: 会话 ID，写入 ``LLMRequest`` 供计费/追踪。
            user_id: 用户 ID。
            dept: 部门标识。
            enable_thinking: Agent 级 thinking 开关；``False`` 关闭 Qwen 思考链。
            request_extra: 额外透传给 ``LLMRequest.extra``（与 thinking 合并）。
        """
        self._gateway = gateway
        self._model = model
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._session_id = session_id
        self._user_id = user_id
        self._dept = dept
        self._enable_thinking = enable_thinking
        self._request_extra = dict(request_extra or {})

    async def stream_message(self, request: ApiMessageRequest) -> AsyncIterator[ApiStreamEvent]:
        """将 OpenHarness ``ApiMessageRequest`` 转为平台 LLM 调用并流式返回 API 事件。

        一律 ``chat_stream`` 真流式（含注册了 tools 的 Worker 终稿轮）。
        旧实现「有 tools → 非流式 chat 再按行假推」会在收齐后 ~30ms 内刷完，
        前端观感像整包弹出。流式路径已用 ``tool_call_deltas`` 拼装工具调用。

        Args:
            request: OpenHarness 消息请求（消息、系统提示、tools 等）。

        Yields:
            ``ApiTextDeltaEvent`` 与最终的 ``ApiMessageCompleteEvent``。
        """
        openai_messages: Any = _convert_messages_to_openai(request.messages, request.system_prompt)
        llm_messages: list[LLMMessage] = _openai_messages_to_llm(openai_messages)
        openai_tools: Any = _convert_tools_to_openai(request.tools) if request.tools else []
        has_tools: bool = bool(openai_tools)

        from src.llm.thinking import llm_request_extra_for_thinking

        extra: dict[str, Any] = {}
        extra.update(self._request_extra)
        extra.update(
            llm_request_extra_for_thinking(
                enable_thinking=self._enable_thinking,
                model=self._model,
            )
        )

        llm_request: LLMRequest = LLMRequest(
            messages=llm_messages,
            model=self._model,
            temperature=self._temperature,
            max_tokens=min(request.max_tokens, self._max_tokens),
            stream=True,
            tools=openai_tools,
            tool_choice="auto" if has_tools else "none",
            session_id=self._session_id,
            user_id=self._user_id,
            dept=self._dept,
            extra=extra,
        )

        total_usage: TokenUsage = TokenUsage()
        collected: str = ""
        finish_reason: str = "stop"
        tool_acc: dict[int, dict[str, Any]] = {}

        async for chunk in self._gateway.chat_stream(llm_request):
            if chunk.content:
                collected += chunk.content
                # 流式阶段先原样下发；收尾再统一净化（避免半截标签误伤）
                yield ApiTextDeltaEvent(text=chunk.content)
            if chunk.tool_call_deltas:
                _merge_tool_call_delta(tool_acc, chunk.tool_call_deltas)
            if chunk.usage is not None:
                total_usage += chunk.usage
            if chunk.finish_reason:
                finish_reason = chunk.finish_reason

        assembled_tools = [tool_acc[i] for i in sorted(tool_acc.keys())]
        tool_blocks = _tool_calls_to_content_blocks(assembled_tools)
        text = _normalize_assistant_text(collected)
        # 空名 tool_calls 全被跳过且无正文 → 记哨兵，由 invoke 显式失败（勿当成功正文）。
        if not text and not tool_blocks and assembled_tools:
            text = _GARBAGE_SENTINEL
            logger.warning(
                "all tool_calls empty-name; marking garbage sentinel",
                skipped=len(assembled_tools),
            )
        content_blocks: list[Any] = []
        if text:
            content_blocks.append(TextBlock(text=text))
        content_blocks.extend(tool_blocks)

        yield ApiMessageCompleteEvent(
            message=ConversationMessage(role="assistant", content=content_blocks),
            usage=UsageSnapshot(
                input_tokens=total_usage.prompt_tokens,
                output_tokens=total_usage.completion_tokens,
            ),
            stop_reason="tool_calls" if tool_blocks else finish_reason,
        )
