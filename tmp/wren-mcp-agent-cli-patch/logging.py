"""极简结构化日志（wren-mcp-agent 独立部署用，对齐主仓 utils.logging 形态）。

仅依赖标准库；支持 ``logger.info("msg", key=value)`` 关键字参数（兼容 agent.py
里仿 structlog 的调用方式，避免 TypeError 直接打崩进程）。
"""

from __future__ import annotations

import logging
import sys
from typing import Any


class _KwargLogger(logging.LoggerAdapter):
    """把任意 kwargs 拼进消息，避免 stdlib Logger 拒绝未知关键字。"""

    def process(self, msg: str, kwargs: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        reserved = {"exc_info", "stack_info", "stacklevel", "extra"}
        extras = {k: kwargs.pop(k) for k in list(kwargs) if k not in reserved}
        if extras:
            parts = " ".join(f"{k}={v!r}" for k, v in extras.items())
            msg = f"{msg} {parts}"
        return msg, kwargs


def get_logger(name: str) -> logging.LoggerAdapter:
    """返回统一命名的 logger（INFO 级别 + 人类可读格式）。"""
    base = logging.getLogger(name)
    if not base.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        )
        base.addHandler(handler)
        base.setLevel(logging.INFO)
        base.propagate = False
    return _KwargLogger(base, {})
