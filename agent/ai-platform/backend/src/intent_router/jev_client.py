"""意图预路由模型客户端。

两套并列配置（互不覆盖）：

- ``INTENT_DETECT_*``：通义 ``tongyi-intent-detect*``（Chat Completions）
- ``DECISION_MODEL_*``：百炼 ``decision-model*``（System One ``/systemone``）

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

_DECISION_QUESTION_ID = "intent"
_DECISION_INSTRUCTIONS = (
    "选择最匹配用户当前问题的业务意图标签，只选一个。"
    "短跟问、指代、省略主语时应结合对话上文判定。"
    "若问题涉及超市/大统华门店清单、区域有哪些店、门店或品类的销售/毛利/损耗/报表数字，"
    "必须选 spm_report，不要选 rag。"
    "仅当询问制度/规章/政策/流程条文时才选 rag。"
    "会员积分券订单选 crm；纯闲聊选 chitchat。"
)


def _elapsed_ms(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def uses_decision_systemone(model_name: str) -> bool:
    """是否走决策模型 System One 协议。

    仅 ``decision-model*`` 走 System One；其余（含 ``tongyi-intent-detect*``）走 Chat。
    """
    name = (model_name or "").strip().lower()
    return name.startswith("decision-model")


async def classify_intent_label(
    *,
    user_text: str,
    labels: dict[str, str],
    model_name: str | None = None,
    endpoint: str | None = None,
    timeout_ms: int | None = None,
    conversation_context: str | None = None,
) -> tuple[str | None, int, str]:
    """从标签表中选一个标签 id。

    Args:
        user_text: 用户本轮原文（无上下文时的兜底）。
        labels: ``{label_id: description}``。
        model_name: 覆盖配置中的模型名（yaml ``model.name``）。
        endpoint: 覆盖 endpoint。
        timeout_ms: 覆盖超时。
        conversation_context: 已拼好的「上文 + 本轮」；非空时优先作为 state / user。

    Returns:
        ``(label_id|None, latency_ms, detail)``。
    """
    settings = get_settings()
    if not labels:
        return None, 0, "empty_labels"

    requested = (model_name or "").strip()
    state = (conversation_context or "").strip() or (user_text or "")
    if not state.strip():
        return None, 0, "empty_state"

    # yaml/入参显式 decision-model* → 决策参数；
    # 未传 name 时仍用 INTENT_DETECT_MODEL（JEV 旧行为，不被 DECISION 默认名劫持）。
    if requested:
        model = requested
    else:
        model = (settings.INTENT_DETECT_MODEL or "").strip()
    if not model:
        return None, 0, "model empty"

    if uses_decision_systemone(model):
        api_key = (
            settings.DECISION_MODEL_API_KEY or settings.INTENT_DETECT_API_KEY or ""
        ).strip()
        base = (
            endpoint
            or settings.DECISION_MODEL_ENDPOINT
            or settings.INTENT_DETECT_ENDPOINT
            or ""
        ).rstrip("/")
        timeout_s = max(
            0.2,
            (
                timeout_ms
                if timeout_ms is not None
                else settings.DECISION_MODEL_TIMEOUT_MS
            )
            / 1000.0,
        )
        if not api_key or api_key.startswith("your-"):
            return None, 0, "DECISION_MODEL_API_KEY not configured"
        if not base:
            return None, 0, "DECISION_MODEL_ENDPOINT empty"
        return await _classify_via_systemone(
            api_key=api_key,
            base=base,
            model=model,
            timeout_s=timeout_s,
            state=state,
            labels=labels,
        )

    api_key = (settings.INTENT_DETECT_API_KEY or "").strip()
    if not api_key or api_key.startswith("your-"):
        return None, 0, "INTENT_DETECT_API_KEY not configured"
    base = (endpoint or settings.INTENT_DETECT_ENDPOINT or "").rstrip("/")
    if not base:
        return None, 0, "INTENT_DETECT_ENDPOINT empty"
    timeout_s = max(
        0.2,
        (timeout_ms if timeout_ms is not None else settings.INTENT_DETECT_TIMEOUT_MS)
        / 1000.0,
    )
    return await _classify_via_chat(
        api_key=api_key,
        base=base,
        model=model,
        timeout_s=timeout_s,
        state=state,
        labels=labels,
    )


async def _classify_via_systemone(
    *,
    api_key: str,
    base: str,
    model: str,
    timeout_s: float,
    state: str,
    labels: dict[str, str],
) -> tuple[str | None, int, str]:
    """百炼决策模型：``POST {base}/systemone``。"""
    url = f"{base}/systemone"
    payload: dict[str, Any] = {
        "model": model,
        "state": state,
        "questions": {
            _DECISION_QUESTION_ID: {
                "type": "choice",
                "instructions": _DECISION_INSTRUCTIONS,
                "criteria": {str(k): str(v) for k, v in labels.items()},
            }
        },
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
        logger.warning("decision-model classify failed", error=str(exc), latency_ms=ms)
        return None, ms, f"decision_error:{exc}"

    ms = _elapsed_ms(t0)
    answer = _extract_decision_answer(body)
    if answer is None:
        return None, ms, "decision_bad_response"

    tag = str(answer.get("choice") or "").strip()
    confidence = answer.get("confidence")
    conf_bit = ""
    try:
        if confidence is not None:
            conf_bit = f";confidence={float(confidence):.3f}"
    except (TypeError, ValueError):
        conf_bit = ""

    if tag in labels:
        return tag, ms, f"ok{conf_bit}"
    for key in labels:
        if key and key in tag:
            return key, ms, f"ok_partial{conf_bit}"
    logger.info(
        "decision-model label not in map",
        raw=tag[:80],
        latency_ms=ms,
        confidence=confidence,
    )
    return None, ms, f"unknown_label:{tag[:40]}{conf_bit}"


def _extract_decision_answer(body: Any) -> dict[str, Any] | None:
    """从 System One 响应取出 intent 答案对象。"""
    if not isinstance(body, dict):
        return None
    answers = body.get("answers")
    if not isinstance(answers, dict):
        return None
    answer = answers.get(_DECISION_QUESTION_ID)
    if isinstance(answer, dict):
        return answer
    if len(answers) == 1:
        only = next(iter(answers.values()))
        if isinstance(only, dict):
            return only
    return None


async def _classify_via_chat(
    *,
    api_key: str,
    base: str,
    model: str,
    timeout_s: float,
    state: str,
    labels: dict[str, str],
) -> tuple[str | None, int, str]:
    """通义意图模型：``POST {base}/chat/completions``。"""
    labels_json = json.dumps(labels, ensure_ascii=False)
    system_prompt = (
        "You are Qwen, created by Alibaba Cloud. You are a helpful assistant.\n"
        "You should choose one tag from the tag list:\n"
        f"{labels_json}\n"
        "Use the conversation context when the latest user turn is short or refers "
        "to prior turns (e.g. follow-ups like「那溧阳呢」).\n"
        "Just reply with the chosen tag."
    )
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": state},
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

    tag = content.splitlines()[0].strip().strip("\"'`")
    if tag in labels:
        return tag, ms, "ok"
    for key in labels:
        if key and key in tag:
            return key, ms, "ok_partial"
    logger.info("JEV label not in map", raw=content[:80], latency_ms=ms)
    return None, ms, f"unknown_label:{tag[:40]}"
