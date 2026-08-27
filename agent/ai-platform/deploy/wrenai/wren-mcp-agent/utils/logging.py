"""极简结构化日志（wren-mcp-agent 独立部署用，对齐主仓 utils.logging 形态）。

仅依赖标准库，供 agent 进程内统一 ``get_logger`` 入口；生产由 systemd journald 收集。
"""

from __future__ import annotations

import logging
import sys


def get_logger(name: str) -> logging.Logger:
    """返回统一命名的 logger（INFO 级别 + 人类可读格式）。"""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger
