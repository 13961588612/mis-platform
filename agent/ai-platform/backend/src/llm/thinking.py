"""LLM thinking / 推理链开关（Qwen 等通过 ``extra_body.enable_thinking``）。"""

from __future__ import annotations

from typing import Any


def llm_request_extra_for_thinking(
    *,
    enable_thinking: bool | None,
    model: str = "",
) -> dict[str, Any]:
    """按 Agent/调用方开关组装 ``LLMRequest.extra``。

    ``enable_thinking=False`` 时关闭思考链（对齐问数 NL2SQL）；
    ``True`` / ``None`` 不传参，沿用网关/模型默认（当前 qwen3.8-flash 默认开）。

    Args:
        enable_thinking: Agent ``model.enable_thinking``；``None`` 表示未配置。
        model: 模型名；非 qwen 时不注入（避免无关 provider 拒参）。

    Returns:
        可直接赋给 ``LLMRequest.extra`` 的 dict（可能为空）。
    """
    if enable_thinking is not False:
        return {}
    if "qwen" not in (model or "").lower():
        return {}
    return {"extra_body": {"enable_thinking": False}}


def resolve_agent_enable_thinking(config: Any) -> bool | None:
    """从 ``AgentConfig`` 读取 thinking 开关。

    优先 ``model.enable_thinking``；其次 ``runtime.params.enableThinking`` /
    ``enable_thinking``（兼容 camelCase）。未配置返回 ``None``。
    """
    if config is None:
        return None
    model = getattr(config, "model", None)
    if model is not None:
        raw = getattr(model, "enable_thinking", None)
        if isinstance(raw, bool):
            return raw
    runtime = getattr(config, "runtime", None)
    params = getattr(runtime, "params", None) if runtime is not None else None
    if isinstance(params, dict):
        for key in ("enableThinking", "enable_thinking"):
            if key in params:
                val = params.get(key)
                if isinstance(val, bool):
                    return val
                if isinstance(val, str) and val.strip().lower() in {"true", "false", "1", "0"}:
                    return val.strip().lower() in {"true", "1"}
    return None
