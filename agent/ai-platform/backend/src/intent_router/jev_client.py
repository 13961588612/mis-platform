"""通义意图检测（JEV / tongyi-intent-detect-v3）客户端。

使用独立 ``INTENT_DETECT_API_KEY`` / ``INTENT_DETECT_ENDPOINT`` / ``INTENT_DETECT_MODEL``，
与主对话 ``QWEN_API_KEY`` 分离。
"""

from __future__ import annotations

import json
from time import perf_counter
from typing import Any

import httpx

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("intent_router.jev")


def _elapsed_ms(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


async def classify_intent_label(
    *,
    user_text: str,
    labels: dict[str, str],
    model_name: str | None = None,
    endpoint: str | None = None,
    timeout_ms: int | None = None,
    conversation_context: str | None = None,
) -> tuple[str | None, int, str]:
    """Intent-only：从标签表中选一个标签 id。

    Args:
        user_text: 用户本轮原文（无上下文时的兜底）。
        labels: ``{label_id: description}``。
        model_name: 覆盖 ``INTENT_DETECT_MODEL``。
        endpoint: 覆盖 ``INTENT_DETECT_ENDPOINT``。
        timeout_ms: 覆盖 ``INTENT_DETECT_TIMEOUT_MS``。
        conversation_context: 已拼好的「上文 + 本轮」；非空时优先作为 user content。

    Returns:
        ``(label_id|None, latency_ms, detail)``。
    """
    settings = get_settings()
    api_key = (settings.INTENT_DETECT_API_KEY or "").strip()
    if not api_key or api_key.startswith("your-"):
        return None, 0, "INTENT_DETECT_API_KEY not configured"

    if not labels:
        return None, 0, "empty labels"

    model = (model_name or settings.INTENT_DETECT_MODEL or "").strip()
    if not model:
        return None, 0, "INTENT_DETECT_MODEL empty"

    base = (endpoint or settings.INTENT_DETECT_ENDPOINT or "").rstrip("/")
    if not base:
        return None, 0, "INTENT_DETECT_ENDPOINT empty"

    timeout_s = max(0.2, (timeout_ms or settings.INTENT_DETECT_TIMEOUT_MS) / 1000.0)
    labels_json = json.dumps(labels, ensure_ascii=False)
    system_prompt = (
        "You are Qwen, created by Alibaba Cloud. You are a helpful assistant.\n"
        "You should choose one tag from the tag list:\n"
        f"{labels_json}\n"
        "Use the conversation context when the latest user turn is short or refers "
        "to prior turns (e.g. follow-ups like「那溧阳呢」).\n"
        "Just reply with the chosen tag."
    )
    user_content = (conversation_context or "").strip() or (user_text or "")
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0,
        "max_tokens": 16,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    t0 = perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:  # noqa: BLE001 - 预路由失败可回退
        ms = _elapsed_ms(t0)
        logger.warning("JEV classify failed", error=str(exc), latency_ms=ms)
        return None, ms, f"jev_error:{exc}"

    ms = _elapsed_ms(t0)
    content = ""
    try:
        content = str(body["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return None, ms, "jev_bad_response"

    # 单标签或首行；去掉引号/空白
    tag = content.splitlines()[0].strip().strip("\"'`")
    if tag in labels:
        return tag, ms, "ok"
    # 容忍模型多返回说明时取第一个已知标签子串
    for key in labels:
        if key and key in tag:
            return key, ms, "ok_partial"
    logger.info("JEV label not in map", raw=content[:80], latency_ms=ms)
    return None, ms, f"unknown_label:{tag[:40]}"
