"""附件 / 对象存储适配。"""

from src.storage.local_files import (
    StoredFileMeta,
    is_image_mime,
    load_meta,
    read_file_bytes,
    save_upload,
)

__all__ = [
    "StoredFileMeta",
    "is_image_mime",
    "load_meta",
    "read_file_bytes",
    "save_upload",
]
