"""企业微信多 Bot 配置模型（T04 O1f / UI#3，端点 #48–#54）。

**wire 契约是硬约束**：前端 ``features/agent/types.ts`` 的 ``WecomBot`` 全部为
snake_case，BFF 对 ``/agent-ops/**`` 是透明透传（不做 key 转换）。任何
camelCase（如 ``wsUrl``）都会让 ``agent-wecom-page.tsx`` 的 ``BOT_COLS`` 读到
``undefined``，这是 P0 已经踩过一次的坑。因此本模块显式固定字段名：

.. code-block:: typescript

    export interface WecomBot {
      bot_id: string;
      name: string;
      enabled: boolean;
      ws_url: string;
      secret_masked: string;
      bound_agent_id?: string;
      health: 'connected' | 'disconnected' | 'unknown';
    }

    export interface WecomBotPayload {
      name: string;
      ws_url: string;
      secret?: string;          // 留空 = 不修改
      bound_agent_id?: string;
    }

三层模型职责分离：

* :class:`WecomBotRecord` —— **落盘态**，含明文 ``secret``，只在
  :mod:`src.channels.wecom_bot_store` 内部与 YAML 之间流动，**绝不出现在响应里**。
* :class:`WecomBotWire` —— **响应态**，``secret`` 被换成 ``secret_masked``，
  额外带运行时 ``health``。
* :class:`WecomBotCreateRequest` / :class:`WecomBotUpdateRequest` —— **请求态**，
  对应前端 ``WecomBotPayload``；``secret`` 留空表示「不修改」（前端
  ``agent-wecom-bot-dialog.tsx`` 明确不回显明文、不勾选「更换 Secret」时不发送）。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

#: 健康状态取值，与前端 ``WecomBot['health']`` 完全一致。
BotHealth = Literal["connected", "disconnected", "unknown"]

#: 合法健康状态集合（用于校验 Gateway 回传值，未知值一律降级为 ``unknown``）。
BOT_HEALTH_VALUES: frozenset[str] = frozenset({"connected", "disconnected", "unknown"})

#: 前端展示用的脱敏占位符。与 ``file_service.MASKED_VALUE`` 语义一致，
#: 但这里是**只读展示值**（前端从不回传它），因此固定为定长掩码更直观。
SECRET_MASK: str = "********"

#: ``secret`` 允许的最大长度（防止误粘贴超长内容撑爆 YAML）。
MAX_SECRET_LENGTH: int = 512

#: ``name`` 允许的最大长度。
MAX_NAME_LENGTH: int = 64

#: ``ws_url`` 允许的最大长度。
MAX_WS_URL_LENGTH: int = 512


def _utc_now_iso() -> str:
    """返回当前 UTC 时间的 ISO-8601 字符串（秒级精度，带 ``+00:00``）。

    Returns:
        形如 ``2025-01-01T12:00:00+00:00`` 的字符串。
    """
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def mask_secret(secret: str) -> str:
    """把明文 secret 转成展示用掩码。

    Args:
        secret: 明文 secret（可能为空）。

    Returns:
        secret 非空时返回 :data:`SECRET_MASK`，为空时返回空串
        （前端据此判断「尚未配置 Secret」）。
    """
    return SECRET_MASK if secret else ""


class WecomBotRecord(BaseModel):
    """企微 Bot 的**落盘态**记录（含明文 secret，禁止直接返回给前端）。

    对应 ``configs/channels/wecom-bots.yaml`` 中 ``bots[]`` 的一项。
    """

    bot_id: str = Field(..., description="Bot 唯一 ID（创建时后端生成，不可变更）")
    name: str = Field(default="", description="展示名称")
    enabled: bool = Field(default=True, description="是否启用（Gateway 只拉取 enabled=true）")
    ws_url: str = Field(default="", description="企微 Bot 回调 WebSocket 地址")
    secret: str = Field(default="", description="明文 secret（仅落盘，不出响应）")
    bound_agent_id: str = Field(default="", description="绑定的 Agent ID；空串表示未绑定")
    created_at: str = Field(default_factory=_utc_now_iso, description="创建时间 ISO-8601")
    updated_at: str = Field(default_factory=_utc_now_iso, description="更新时间 ISO-8601")

    @field_validator("bot_id", "name", "ws_url", "secret", "bound_agent_id", mode="before")
    @classmethod
    def _coerce_str(cls, value: Any) -> str:
        """把 ``None`` / 非字符串安全地折叠成字符串，避免 YAML 手改后炸掉。

        Args:
            value: YAML 反序列化出来的原始值。

        Returns:
            去除首尾空白的字符串；``None`` 转为空串。
        """
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()

    @field_validator("enabled", mode="before")
    @classmethod
    def _coerce_bool(cls, value: Any) -> bool:
        """把 YAML 里可能出现的 ``"true"`` / ``1`` 等折叠成 bool。

        Args:
            value: 原始值。

        Returns:
            规范化后的布尔值；``None`` 视为 ``True``（默认启用）。
        """
        if value is None:
            return True
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        return str(value).strip().lower() in ("1", "true", "yes", "on")

    def to_yaml_dict(self) -> dict[str, Any]:
        """序列化为 YAML 落盘用的字典（字段顺序稳定，便于 diff / Git 审计）。

        Returns:
            含明文 ``secret`` 的字典。
        """
        return {
            "bot_id": self.bot_id,
            "name": self.name,
            "enabled": self.enabled,
            "ws_url": self.ws_url,
            "secret": self.secret,
            "bound_agent_id": self.bound_agent_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_wire(self, health: str = "unknown") -> dict[str, Any]:
        """转成前端 ``WecomBot`` 契约（snake_case，secret 脱敏）。

        Args:
            health: 运行时健康状态；非法值自动降级为 ``unknown``。

        Returns:
            与 ``features/agent/types.ts`` 的 ``WecomBot`` 逐字段对齐的字典。
        """
        normalized_health: str = health if health in BOT_HEALTH_VALUES else "unknown"
        wire: dict[str, Any] = {
            "bot_id": self.bot_id,
            "name": self.name,
            "enabled": self.enabled,
            "ws_url": self.ws_url,
            "secret_masked": mask_secret(self.secret),
            "health": normalized_health,
        }
        # 前端 `bound_agent_id?: string`：未绑定时不下发该 key，
        # 与 dialog 里 `bound_agent_id || undefined` 的写法对称。
        if self.bound_agent_id:
            wire["bound_agent_id"] = self.bound_agent_id
        return wire


class WecomBotWire(BaseModel):
    """企微 Bot 的**响应态**模型（仅用于 OpenAPI 文档展示与类型标注）。

    实际响应由 :meth:`WecomBotRecord.to_wire` 产出字典，避免 Pydantic
    在 ``bound_agent_id`` 为 ``None`` 时仍然下发 key。
    """

    bot_id: str = Field(..., description="Bot 唯一 ID")
    name: str = Field(default="", description="展示名称")
    enabled: bool = Field(default=True, description="是否启用")
    ws_url: str = Field(default="", description="WebSocket 地址")
    secret_masked: str = Field(default="", description="脱敏后的 secret（从不返回明文）")
    bound_agent_id: str | None = Field(default=None, description="绑定的 Agent ID")
    health: BotHealth = Field(default="unknown", description="运行时健康状态")


class WecomBotCreateRequest(BaseModel):
    """创建 Bot 的请求体（对应前端 ``WecomBotPayload``，#49）。"""

    name: str = Field(..., min_length=1, max_length=MAX_NAME_LENGTH, description="展示名称")
    ws_url: str = Field(
        ..., min_length=1, max_length=MAX_WS_URL_LENGTH, description="WebSocket 地址"
    )
    secret: str = Field(default="", max_length=MAX_SECRET_LENGTH, description="明文 secret")
    bound_agent_id: str = Field(default="", description="绑定的 Agent ID，可留空")

    @field_validator("name", "ws_url", "secret", "bound_agent_id", mode="before")
    @classmethod
    def _strip(cls, value: Any) -> str:
        """去除首尾空白并把 ``None`` 折叠成空串。

        Args:
            value: 请求体原始值。

        Returns:
            规范化后的字符串。
        """
        if value is None:
            return ""
        return str(value).strip()

    @field_validator("ws_url")
    @classmethod
    def _validate_ws_url(cls, value: str) -> str:
        """校验 WebSocket 地址协议前缀。

        Args:
            value: 待校验地址。

        Returns:
            原值。

        Raises:
            ValueError: 协议不是 ``ws://`` / ``wss://`` 时抛出。
        """
        if not value.startswith(("ws://", "wss://")):
            raise ValueError("ws_url must start with ws:// or wss://")
        return value


class WecomBotUpdateRequest(BaseModel):
    """更新 Bot 的请求体（#50）。

    与创建的区别：``secret`` **留空 = 不修改**（前端不勾选「更换 Secret」时
    根本不发送该字段），因此这里用 ``None`` 与空串区分不了的场景统一按
    「不修改」处理 —— 清空 secret 需要显式传 ``secret_clear=true``。
    """

    name: str | None = Field(default=None, max_length=MAX_NAME_LENGTH, description="展示名称")
    ws_url: str | None = Field(
        default=None, max_length=MAX_WS_URL_LENGTH, description="WebSocket 地址"
    )
    secret: str | None = Field(
        default=None, max_length=MAX_SECRET_LENGTH, description="新 secret；留空/缺省 = 不修改"
    )
    bound_agent_id: str | None = Field(default=None, description="绑定的 Agent ID；空串 = 解绑")
    secret_clear: bool = Field(default=False, description="显式清空 secret")

    @field_validator("name", "ws_url", "secret", "bound_agent_id", mode="before")
    @classmethod
    def _strip_optional(cls, value: Any) -> str | None:
        """去除首尾空白，保留 ``None``（表示「字段缺省 / 不修改」）。

        Args:
            value: 请求体原始值。

        Returns:
            规范化后的字符串；输入为 ``None`` 时返回 ``None``。
        """
        if value is None:
            return None
        return str(value).strip()

    @field_validator("ws_url")
    @classmethod
    def _validate_ws_url(cls, value: str | None) -> str | None:
        """校验 WebSocket 地址协议前缀（仅在显式提供时）。

        Args:
            value: 待校验地址或 ``None``。

        Returns:
            原值。

        Raises:
            ValueError: 显式提供了非空且协议非法的地址时抛出。
        """
        if value is None or value == "":
            return value
        if not value.startswith(("ws://", "wss://")):
            raise ValueError("ws_url must start with ws:// or wss://")
        return value
