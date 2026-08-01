"""聊天附件上传 / 下载（本地存储，鉴权访问，无需公网 URL）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Header, Query, UploadFile, status
from fastapi.responses import FileResponse, Response

from src.api.deps import get_current_user
from src.api.response import error_response, success
from src.storage.local_files import load_meta, resolve_data_path, save_upload
from src.utils.logging import get_logger

logger = get_logger("api.routes.files")

router = APIRouter(prefix="/files", tags=["files"])


def _user_id(user: dict[str, Any]) -> str:
    return str(user.get("user_id") or user.get("userId") or "")


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """上传单个附件，返回 fileId（前端发消息时放入 metadata.attachments）。"""
    raw = await file.read()
    if not raw:
        return error_response(4001, "空文件", status.HTTP_400_BAD_REQUEST)
    try:
        meta = save_upload(
            data=raw,
            original_name=file.filename or "file",
            mime_type=file.content_type or "",
            uploader_id=_user_id(user),
        )
    except ValueError as exc:
        return error_response(4001, str(exc), status.HTTP_400_BAD_REQUEST)
    except OSError as exc:
        logger.error("upload failed", error=str(exc))
        return error_response(9000, "保存文件失败", status.HTTP_500_INTERNAL_SERVER_ERROR)

    return success(
        data={
            "fileId": meta.file_id,
            "file_id": meta.file_id,
            "name": meta.original_name,
            "mimeType": meta.mime_type,
            "mime_type": meta.mime_type,
            "size": meta.size,
            # 相对 API 路径；浏览器需带 JWT（query token 或 Authorization）
            "url": f"/api/v1/files/{meta.file_id}",
        },
        message="uploaded",
    )


@router.get("/{file_id}")
async def download_file(
    file_id: str,
    authorization: str = Header(default=""),
    token: str = Query(default=""),
) -> Response:
    """鉴权下载附件（内网相对路径，无需公网）。支持 ``?token=`` 供 img src。"""
    bearer = authorization
    if (not bearer.startswith("Bearer ")) and token:
        bearer = f"Bearer {token}"
    # 校验登录态；失败由 get_current_user 抛 401
    await get_current_user(authorization=bearer)

    meta = load_meta(file_id)
    if meta is None:
        return Response(status_code=status.HTTP_404_NOT_FOUND, content="not found")
    path = resolve_data_path(meta)
    if path is None:
        return Response(status_code=status.HTTP_404_NOT_FOUND, content="missing")
    return FileResponse(
        path=path,
        media_type=meta.mime_type,
        filename=meta.original_name,
        content_disposition_type="inline",
    )
