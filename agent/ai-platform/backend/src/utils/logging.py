"""使用 structlog 的结构化日志配置。

提供 JSON 格式的结构化日志，支持 trace ID 关联、
敏感数据脱敏、控制台输出以及可选的文件轮转落盘。

落盘按业务拆分两个文件（默认由 ``LOG_FILE`` 推导）：
- ``*-chat.log``：实际对话相关（``/chat``、``/chat/stream``、会话消息、WS 等）
- ``*-sys.log``：系统健康检查、探针、启动关闭及其它非对话请求
"""

from __future__ import annotations

import contextvars
import logging
import re
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Literal

import structlog

from src.config import LogLevel, Settings, get_settings

LogBucket = Literal["chat", "sys"]

# 当前请求/任务的日志分桶；默认 sys（启动、后台任务、非对话请求）
_log_bucket: contextvars.ContextVar[LogBucket] = contextvars.ContextVar(
    "log_bucket",
    default="sys",
)

# 日志输出中应脱敏的字段
SENSITIVE_FIELDS = frozenset({
    "password",
    "token",
    "api_key",
    "apikey",
    "secret",
    "aes_key",
    "authorization",
    "refresh_token",
    "access_token",
    "credential",
})

# 对话相关路径（子串匹配，大小写不敏感）
_CHAT_PATH_RE = re.compile(
    r"("
    r"/chat(/|$)"  # .../chat 或 .../chat/stream
    r"|/ws/"  # websocket 对话
    r"|/sessions/.+/messages"  # 会话发消息
    r"|/builder/chat"  # skill builder 对话
    r")",
    re.IGNORECASE,
)

# 明确的系统探针/健康类路径
_SYS_PATH_RE = re.compile(
    r"("
    r"^/health$"
    r"|^/ready$"
    r"|/health(/|$)"  # */health
    r"|/docs|/redoc|/openapi"
    r")",
    re.IGNORECASE,
)


def set_log_bucket(bucket: LogBucket) -> None:
    """设置当前上下文的日志分桶（chat / sys）。"""
    _log_bucket.set(bucket)


def get_log_bucket() -> LogBucket:
    """读取当前上下文的日志分桶。"""
    return _log_bucket.get()


def classify_request_log_bucket(path: str) -> LogBucket:
    """按 HTTP 路径判定日志应写入 chat 还是 sys 文件。"""
    p = (path or "").split("?", 1)[0]
    if _SYS_PATH_RE.search(p):
        return "sys"
    if _CHAT_PATH_RE.search(p):
        return "chat"
    return "sys"


def _mask_sensitive_data(
    _logger: Any,
    _method_name: str,
    event_dict: structlog.types.EventDict,
) -> structlog.types.EventDict:
    """将敏感字段替换为 '***' 的处理器。"""
    for key in list(event_dict.keys()):
        if key.lower() in SENSITIVE_FIELDS:
            event_dict[key] = "***"
        # 检查嵌套字典
        if isinstance(event_dict[key], dict):
            for nested_key in list(event_dict[key].keys()):
                if nested_key.lower() in SENSITIVE_FIELDS:
                    event_dict[key][nested_key] = "***"
    return event_dict


def _inject_log_bucket(
    _logger: Any,
    _method_name: str,
    event_dict: structlog.types.EventDict,
) -> structlog.types.EventDict:
    """把当前分桶写入事件，便于 JSON 检索；配合 ExtraAdder 供 Filter 使用。"""
    bucket = _log_bucket.get()
    event_dict.setdefault("log_bucket", bucket)
    return event_dict


def _renderer_processors(use_json: bool) -> list[Any]:
    if use_json:
        return [structlog.processors.JSONRenderer(ensure_ascii=False)]
    return [structlog.dev.ConsoleRenderer(colors=False)]


def _resolve_log_path(log_file: str) -> Path:
    """将日志文件路径解析为绝对 ``Path``。"""
    path: Path = Path(log_file)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path


def _derive_split_log_files(base_log_file: str) -> tuple[str, str]:
    """由 ``LOG_FILE`` 推导 chat/sys 两个文件名。

    例：``logs/backend.log`` → ``logs/backend-chat.log`` + ``logs/backend-sys.log``
    """
    path = Path(base_log_file)
    chat = path.with_name(f"{path.stem}-chat{path.suffix or '.log'}")
    sys_path = path.with_name(f"{path.stem}-sys{path.suffix or '.log'}")
    return str(chat), str(sys_path)


class _LogBucketFilter(logging.Filter):
    """只放行指定分桶的日志记录。"""

    def __init__(self, bucket: LogBucket) -> None:
        super().__init__()
        self.bucket = bucket

    def filter(self, record: logging.LogRecord) -> bool:
        # 优先用 structlog 注入的字段；否则读 contextvar
        record_bucket = getattr(record, "log_bucket", None)
        if record_bucket not in ("chat", "sys"):
            record_bucket = _log_bucket.get()
        return record_bucket == self.bucket


def _has_bucket_file_handler(
    root: logging.Logger,
    log_path: Path,
    bucket: LogBucket,
) -> bool:
    target = log_path.resolve()
    for handler in root.handlers:
        if not isinstance(handler, RotatingFileHandler):
            continue
        if Path(handler.baseFilename).resolve() != target:
            continue
        for f in handler.filters:
            if isinstance(f, _LogBucketFilter) and f.bucket == bucket:
                return True
    return False


def _setup_bucket_file_handler(
    log_file: str,
    bucket: LogBucket,
    max_bytes: int,
    backup_count: int,
    use_json: bool,
) -> Path | None:
    """为指定分桶挂载轮转文件 Handler。"""
    log_path = _resolve_log_path(log_file)
    root = logging.getLogger()
    if _has_bucket_file_handler(root, log_path, bucket):
        return log_path

    log_path.parent.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.addFilter(_LogBucketFilter(bucket))
    file_handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            processor=_renderer_processors(use_json)[0],
            foreign_pre_chain=[
                structlog.stdlib.add_logger_name,
                structlog.stdlib.add_log_level,
                structlog.processors.TimeStamper(fmt="iso"),
                _inject_log_bucket,
            ],
        )
    )
    root.addHandler(file_handler)
    return log_path


def configure_logging(log_level: LogLevel | None = None, json_format: bool | None = None) -> None:
    """为应用配置 structlog，并按 chat/sys 分文件落盘。"""
    settings: Settings = get_settings()
    level: Any = log_level or settings.LOG_LEVEL
    use_json: Any = json_format if json_format is not None else (settings.LOG_FORMAT == "json")

    # 默认分桶：进程启动/后台任务走 sys
    _log_bucket.set("sys")

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        _mask_sensitive_data,
        _inject_log_bucket,
        # 将 log_bucket 等字段挂到 LogRecord，供 Handler Filter 读取
        structlog.stdlib.ExtraAdder(),
    ]

    formatter = structlog.stdlib.ProcessorFormatter(
        processor=_renderer_processors(use_json)[0],
        foreign_pre_chain=shared_processors,
    )

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(console)
    root.setLevel(getattr(logging, level.value))

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    base_log_file = (settings.LOG_FILE or "").strip()
    chat_file = (settings.LOG_FILE_CHAT or "").strip()
    sys_file = (settings.LOG_FILE_SYS or "").strip()
    if base_log_file and (not chat_file or not sys_file):
        derived_chat, derived_sys = _derive_split_log_files(base_log_file)
        chat_file = chat_file or derived_chat
        sys_file = sys_file or derived_sys

    if not chat_file and not sys_file:
        return

    max_bytes = settings.LOG_MAX_BYTES
    backup_count = settings.LOG_BACKUP_COUNT
    chat_path = (
        _setup_bucket_file_handler(chat_file, "chat", max_bytes, backup_count, use_json)
        if chat_file
        else None
    )
    sys_path = (
        _setup_bucket_file_handler(sys_file, "sys", max_bytes, backup_count, use_json)
        if sys_file
        else None
    )

    get_logger("logging").info(
        "Split file logging enabled",
        log_file_chat=str(chat_path) if chat_path else None,
        log_file_sys=str(sys_path) if sys_path else None,
        max_bytes=max_bytes,
        backup_count=backup_count,
    )


def get_logger(name: str = "ai-platform") -> structlog.stdlib.BoundLogger:
    """返回已配置的 structlog 日志器实例。"""
    return structlog.get_logger(name)


def bind_context(**kwargs: Any) -> None:
    """将键值对绑定到当前日志上下文（如 trace_id、user_id）。"""
    structlog.contextvars.bind_contextvars(**kwargs)


def clear_context() -> None:
    """清除日志上下文中的所有上下文变量。"""
    structlog.contextvars.clear_contextvars()
