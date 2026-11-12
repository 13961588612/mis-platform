"""企微 Bot 入站身份解析的 hook —— 供 ``inbound_worker`` 调用。

对应 ``wecom-user-binding-design.md`` §9：入站消息先尝试「按 Bot 配置推导
corp_id/tenant_id」的绑定解析，命中即返回 MIS userId；否则由调用方回落到
旧的 ``users.wecom_user_id`` 兼容路径。

本模块刻意做薄：只做「Bot 配置 → 绑定解析」的胶水，不持有状态。所有异常都在
这里吞掉并返回 ``None``，保证绑定解析永远不阻断入站消息接收。
"""

from __future__ import annotations

from typing import Any

import structlog

from src.channels.wecom_binding_service import (
    WecomIdentityInput,
    WecomUserBindingService,
)
from src.config import get_settings

logger = structlog.get_logger(__name__)


def _strip_wecom_prefix(value: str) -> str:
    """去掉 ``wecom_`` / ``wecom-`` 前缀，得到纯净的用户 userid。"""
    text = (value or "").strip()
    for prefix in ("wecom_", "wecom-"):
        if text.lower().startswith(prefix):
            return text[len(prefix) :]
    return text


async def resolve_wecom_bot_binding(db: Any, inbound: Any) -> int | None:
    """尝试按 Bot 配置解析入站企微用户身份。

    只在 ``channel == 'wecom-bot'`` 且能由 ``metadata.botId`` 反查到带
    ``corp_id`` 的 Bot 配置时生效；否则返回 ``None``，由调用方走旧路径。

    Args:
        db: 异步 SQLAlchemy session。
        inbound: 入站消息对象（``InboundStreamMessage``）。

    Returns:
        MIS userId；未命中或任何异常返回 ``None``。
    """
    settings = get_settings()
    if not bool(getattr(settings, "WECOM_IDENTITY_BINDING_ENABLED", True)):
        return None
    channel = str(getattr(inbound, "channel", "") or "").strip().lower()
    if channel != "wecom-bot":
        return None
    meta = getattr(inbound, "metadata", None)
    if not isinstance(meta, dict):
        return None
    bot_id = str(meta.get("botId") or "").strip()
    if not bot_id:
        return None
    from src.channels.wecom_bot_store import get_wecom_bot_store

    try:
        record = get_wecom_bot_store().get_record(bot_id)
    except Exception:  # noqa: BLE001 - 读 bot 配置失败一律回落
        return None
    if record is None or not record.corp_id:
        return None
    wecom_user_id = _strip_wecom_prefix(
        str(getattr(inbound, "channel_user_id", "") or getattr(inbound, "user_id", "") or "")
    )
    if not wecom_user_id:
        return None
    service = WecomUserBindingService()
    try:
        return await service.resolve(
            db,
            WecomIdentityInput(
                corp_id=record.corp_id,
                tenant_id=record.tenant_id,
                wecom_user_id=wecom_user_id,
                user_mobile=str(getattr(inbound, "user_mobile", "") or ""),
            ),
        )
    except Exception as exc:  # noqa: BLE001 - 绑定解析失败不阻断接收
        logger.warning("Wecom binding resolve failed", error=str(exc), bot_id=bot_id)
        return None
