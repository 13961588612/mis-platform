"""本地聊天附件存储（无需公网 URL；Agent 侧直接读盘）。

目录布局：``{UPLOAD_DIR}/{file_id[:2]}/{file_id}{ext}``，旁路 ``.meta.json``。
"""

from __future__ import annotations

import json
import mimetypes
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from src.config import get_settings

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+")

ALLOWED_MIME_PREFIXES = ("image/",)
ALLOWED_MIME_EXACT = frozenset(
    {
        "application/pdf",
        "text/plain",
        "text/csv",
        "application/json",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
)


@dataclass
class StoredFileMeta:
    file_id: str
    original_name: str
    mime_type: str
    size: int
    relative_path: str
    created_at: str
    uploader_id: str


def _upload_root() -> Path:
    settings = get_settings()
    root = Path(settings.UPLOAD_DIR)
    if not root.is_absolute():
        root = Path.cwd() / root
    root.mkdir(parents=True, exist_ok=True)
    return root


def is_allowed_mime(mime_type: str) -> bool:
    mt = (mime_type or "").split(";")[0].strip().lower()
    if not mt:
        return False
    if mt in ALLOWED_MIME_EXACT:
        return True
    return any(mt.startswith(p) for p in ALLOWED_MIME_PREFIXES)


def is_image_mime(mime_type: str) -> bool:
    return (mime_type or "").split(";")[0].strip().lower().startswith("image/")


def sanitize_filename(name: str) -> str:
    base = Path(name or "file").name
    cleaned = _SAFE_NAME.sub("_", base).strip("._") or "file"
    return cleaned[:180]


def _paths_for(file_id: str, ext: str) -> tuple[Path, Path]:
    root = _upload_root()
    sub = root / file_id[:2]
    sub.mkdir(parents=True, exist_ok=True)
    data_path = sub / f"{file_id}{ext}"
    meta_path = sub / f"{file_id}.meta.json"
    return data_path, meta_path


def save_upload(
    *,
    data: bytes,
    original_name: str,
    mime_type: str,
    uploader_id: str,
) -> StoredFileMeta:
    settings = get_settings()
    if len(data) > settings.UPLOAD_MAX_BYTES:
        raise ValueError(f"文件超过大小限制（最大 {settings.UPLOAD_MAX_BYTES} 字节）")
    guessed = mime_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    if not is_allowed_mime(guessed):
        raise ValueError(f"不支持的文件类型: {guessed}")

    file_id = uuid.uuid4().hex
    safe_name = sanitize_filename(original_name)
    ext = Path(safe_name).suffix.lower()
    if len(ext) > 16:
        ext = ""
    data_path, meta_path = _paths_for(file_id, ext)
    data_path.write_bytes(data)

    meta = StoredFileMeta(
        file_id=file_id,
        original_name=safe_name,
        mime_type=guessed,
        size=len(data),
        relative_path=str(data_path.relative_to(_upload_root())).replace("\\", "/"),
        created_at=datetime.now(timezone.utc).isoformat(),
        uploader_id=uploader_id,
    )
    meta_path.write_text(json.dumps(asdict(meta), ensure_ascii=False), encoding="utf-8")
    return meta


def load_meta(file_id: str) -> StoredFileMeta | None:
    if not re.fullmatch(r"[0-9a-f]{32}", file_id or ""):
        return None
    root = _upload_root()
    meta_path = root / file_id[:2] / f"{file_id}.meta.json"
    if not meta_path.is_file():
        return None
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        return StoredFileMeta(**raw)
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def resolve_data_path(meta: StoredFileMeta) -> Path | None:
    path = _upload_root() / meta.relative_path
    if not path.is_file():
        return None
    return path


def read_file_bytes(file_id: str) -> tuple[StoredFileMeta, bytes] | None:
    meta = load_meta(file_id)
    if meta is None:
        return None
    path = resolve_data_path(meta)
    if path is None:
        return None
    return meta, path.read_bytes()
