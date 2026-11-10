"""Copilot 语音转写：multipart 进、文字出，不进会话附件。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from src.api.deps import get_current_user
from src.api.response import error_response, success
from src.speech.transcribe import transcribe_audio
from src.utils.exceptions import SpeechTranscribeError
from src.utils.logging import get_logger

logger = get_logger("api.routes.speech")

router = APIRouter(prefix="/speech", tags=["speech"])


def _user_id(user: dict[str, Any]) -> str:
    return str(user.get("user_id") or user.get("userId") or "")


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    duration_ms: int | None = Form(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    raw = await file.read()
    try:
        data = await transcribe_audio(
            raw,
            content_type=file.content_type or "",
            filename=file.filename or "audio.webm",
            user_id=_user_id(user),
            duration_ms=duration_ms,
        )
    except ValueError as exc:
        return error_response(4001, str(exc), status.HTTP_400_BAD_REQUEST)
    except SpeechTranscribeError as exc:
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE if exc.code == 5031 else status.HTTP_400_BAD_REQUEST
        return error_response(exc.code, exc.message, http_status)
    except Exception as exc:  # noqa: BLE001 — 转写失败不得 500 泄漏栈
        logger.error("transcribe_unhandled", error=str(exc), user_id=_user_id(user))
        return error_response(4008, "语音转写失败", status.HTTP_400_BAD_REQUEST)
    return success(data=data, message="ok")
