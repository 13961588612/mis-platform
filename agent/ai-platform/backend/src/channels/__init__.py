"""渠道（Channel）配置域。

本包承载**跨 Agent 的全局渠道配置**（与 ``configs/agents/{id}/`` 下的
Agent 私有配置区分开）。当前只有企业微信多 Bot 一个子域：

* :mod:`src.channels.models` —— 线上契约模型（``WecomBot`` 前端 wire shape）。
* :mod:`src.channels.wecom_bot_store` —— ``configs/channels/wecom-bots.yaml``
  的读写持久化（impl-plan §11 Q4 方案 A）。
"""

from __future__ import annotations

from src.channels.models import (
    BOT_HEALTH_VALUES,
    BotHealth,
    WecomBotCreateRequest,
    WecomBotRecord,
    WecomBotUpdateRequest,
    WecomBotWire,
)
from src.channels.wecom_bot_store import (
    WecomBotStore,
    get_wecom_bot_store,
    reset_wecom_bot_store,
)

__all__ = [
    "BOT_HEALTH_VALUES",
    "BotHealth",
    "WecomBotCreateRequest",
    "WecomBotRecord",
    "WecomBotStore",
    "WecomBotUpdateRequest",
    "WecomBotWire",
    "get_wecom_bot_store",
    "reset_wecom_bot_store",
]
