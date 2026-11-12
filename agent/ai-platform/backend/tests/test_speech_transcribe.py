"""Copilot 语音转写校验与 ASR 解析。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.speech.transcribe import audio_format_of, transcribe_audio, validate_audio, _extract_text
from src.utils.exceptions import SpeechTranscribeError


def test_validate_audio_rejects_empty() -> None:
    with pytest.raises(ValueError, match="空音频"):
        validate_audio(b"", "audio/webm", None, max_bytes=100, max_seconds=60)


def test_validate_audio_rejects_oversize() -> None:
    with pytest.raises(ValueError, match="过大"):
        validate_audio(b"x" * 11, "audio/webm", None, max_bytes=10, max_seconds=60)


def test_validate_audio_rejects_non_audio() -> None:
    with pytest.raises(ValueError, match="仅支持"):
        validate_audio(b"xx", "image/png", None, max_bytes=100, max_seconds=60)


def test_validate_audio_rejects_over_duration() -> None:
    with pytest.raises(ValueError, match="超过"):
        validate_audio(b"xx", "audio/webm", 61_000, max_bytes=100, max_seconds=60)


def test_audio_format_webm_codec_suffix() -> None:
    assert audio_format_of("audio/webm;codecs=opus", "blob") == "webm"


def test_extract_text_from_choices() -> None:
    assert _extract_text({"choices": [{"message": {"content": "  朝阳店日报  "}}]}) == "  朝阳店日报  "


@pytest.mark.asyncio
async def test_transcribe_audio_success() -> None:
    settings = MagicMock()
    settings.SPEECH_MAX_BYTES = 2_000_000
    settings.SPEECH_MAX_SECONDS = 60
    settings.SPEECH_ASR_MODEL = "qwen3-asr-flash"
    settings.SPEECH_TIMEOUT_SECONDS = 30
    settings.QWEN_API_KEY = "sk-test"
    settings.QWEN_API_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"choices": [{"message": {"content": "昨天销售"}}]}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    proxy = MagicMock()
    proxy.check_domain.return_value = True
    proxy.get_proxy_url.return_value = None

    with (
        patch("src.speech.transcribe.get_settings", return_value=settings),
        patch("src.speech.transcribe.get_proxy_manager", return_value=proxy),
        patch("src.speech.transcribe.httpx.AsyncClient", return_value=mock_client),
    ):
        out = await transcribe_audio(
            b"fake-bytes",
            content_type="audio/webm",
            filename="a.webm",
            user_id="1",
            duration_ms=1200,
        )
    assert out["text"] == "昨天销售"
    assert out["durationMs"] == 1200
    mock_client.post.assert_awaited()


@pytest.mark.asyncio
async def test_transcribe_audio_empty_text() -> None:
    settings = MagicMock()
    settings.SPEECH_MAX_BYTES = 2_000_000
    settings.SPEECH_MAX_SECONDS = 60
    settings.SPEECH_ASR_MODEL = "qwen3-asr-flash"
    settings.SPEECH_TIMEOUT_SECONDS = 30
    settings.QWEN_API_KEY = "sk-test"
    settings.QWEN_API_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"choices": [{"message": {"content": "  "}}]}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    proxy = MagicMock()
    proxy.check_domain.return_value = True
    proxy.get_proxy_url.return_value = None

    with (
        patch("src.speech.transcribe.get_settings", return_value=settings),
        patch("src.speech.transcribe.get_proxy_manager", return_value=proxy),
        patch("src.speech.transcribe.httpx.AsyncClient", return_value=mock_client),
        pytest.raises(SpeechTranscribeError, match="没有识别到文字"),
    ):
        await transcribe_audio(b"x", content_type="audio/webm", filename="a.webm", user_id="1")
