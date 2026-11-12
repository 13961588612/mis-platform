"""短语音同步 ASR：校验后调通义 compatible-mode，不落聊天附件盘。"""

from __future__ import annotations

import base64
from typing import Any

import httpx

from src.config import get_settings
from src.llm.outbound_proxy import get_proxy_manager
from src.utils.exceptions import SpeechTranscribeError
from src.utils.logging import get_logger

logger = get_logger("speech.transcribe")

ALLOWED_MIME_PREFIXES: tuple[str, ...] = (
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
)

_FORMAT_BY_MIME: dict[str, str] = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
}


def _mime_base(content_type: str) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def audio_format_of(content_type: str, filename: str) -> str:
    """推断 DashScope input_audio.format。"""
    mime = _mime_base(content_type)
    if mime in _FORMAT_BY_MIME:
        return _FORMAT_BY_MIME[mime]
    name = (filename or "").lower()
    for ext in ("webm", "ogg", "mp4", "mp3", "wav"):
        if name.endswith(f".{ext}"):
            return ext
    return "webm"


def validate_audio(
    data: bytes,
    content_type: str,
    duration_ms: int | None,
    *,
    max_bytes: int,
    max_seconds: int,
) -> None:
    """校验体积、MIME、可选时长。失败抛 ValueError。"""
    if not data:
        raise ValueError("空音频")
    if len(data) > max_bytes:
        raise ValueError(f"录音过大（上限 {max_bytes // (1024 * 1024)}MB）")
    mime = _mime_base(content_type)
    if mime:
        allowed = any(mime == p or mime.startswith(p) for p in ALLOWED_MIME_PREFIXES)
        if not allowed:
            raise ValueError("仅支持音频文件" if not mime.startswith("audio/") else f"不支持的音频类型：{mime}")
    if duration_ms is not None and duration_ms > max_seconds * 1000:
        raise ValueError(f"录音超过 {max_seconds} 秒")


def _completions_url(endpoint: str) -> str:
    base = endpoint.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


async def transcribe_audio(
    data: bytes,
    *,
    content_type: str,
    filename: str,
    user_id: str,
    duration_ms: int | None = None,
) -> dict[str, Any]:
    """调用通义 ASR，返回 text 与 durationMs。不持久化音频。"""
    settings = get_settings()
    validate_audio(
        data,
        content_type,
        duration_ms,
        max_bytes=settings.SPEECH_MAX_BYTES,
        max_seconds=settings.SPEECH_MAX_SECONDS,
    )
    api_key = (settings.QWEN_API_KEY or "").strip()
    if not api_key or api_key.startswith("your-"):
        raise SpeechTranscribeError("语音转写未配置", code=5031)

    fmt = audio_format_of(content_type, filename)
    b64 = base64.b64encode(data).decode("ascii")
    url = _completions_url(settings.QWEN_API_ENDPOINT)
    proxy = get_proxy_manager()
    if not proxy.check_domain(url):
        raise SpeechTranscribeError("ASR 目标域名未在出口代理白名单", code=5031)

    payload: dict[str, Any] = {
        "model": settings.SPEECH_ASR_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": f"data:audio/{fmt};base64,{b64}",
                            "format": fmt,
                        },
                    }
                ],
            }
        ],
    }

    try:
        proxy_url = proxy.get_proxy_url()
        async with httpx.AsyncClient(proxy=proxy_url, timeout=settings.SPEECH_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.TimeoutException as exc:
        raise SpeechTranscribeError("语音转写超时") from exc
    except httpx.HTTPError as exc:
        logger.error("asr_http_error", error=str(exc), user_id=user_id)
        raise SpeechTranscribeError("语音转写服务不可达") from exc

    if response.status_code in {401, 403}:
        raise SpeechTranscribeError("语音转写鉴权失败", code=5031)
    if response.status_code >= 400:
        logger.error(
            "asr_upstream_status",
            status=response.status_code,
            user_id=user_id,
            model=settings.SPEECH_ASR_MODEL,
        )
        raise SpeechTranscribeError("语音转写失败")

    try:
        body = response.json()
    except ValueError as exc:
        raise SpeechTranscribeError("语音转写响应无法解析") from exc

    text = _extract_text(body).strip()
    logger.info(
        "asr_ok",
        user_id=user_id,
        duration_ms=duration_ms,
        model=settings.SPEECH_ASR_MODEL,
        empty=not bool(text),
        bytes=len(data),
    )
    if not text:
        raise SpeechTranscribeError("没有识别到文字，请再试一次")
    return {"text": text, "durationMs": duration_ms}


def _extract_text(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts: list[str] = []
                for item in content:
                    if isinstance(item, str):
                        parts.append(item)
                    elif isinstance(item, dict) and isinstance(item.get("text"), str):
                        parts.append(item["text"])
                return "".join(parts)
    output = body.get("output")
    if isinstance(output, dict) and isinstance(output.get("text"), str):
        return output["text"]
    return ""
