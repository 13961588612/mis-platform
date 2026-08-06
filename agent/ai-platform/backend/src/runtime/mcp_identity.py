"""MCP 调用身份上下文 — 将平台用户/渠道信息注入工具参数与 HTTP Header。"""

from __future__ import annotations

from contextvars import ContextVar, Token
from typing import Any

import httpx

# 当前协程内的 MCP 请求身份（并发 gather 时各 Task 有独立 context 副本）
_mcp_identity: ContextVar[dict[str, str] | None] = ContextVar(
    "mcp_identity", default=None
)

# 写入 MCP tool arguments 的 identity 对象键名
IDENTITY_OBJECT_KEY = "identity"

# identity 对象内字段（camelCase，与 Gateway InboundMessage 对齐）
# T03 S9：追加第五键 misUserId —— E1–E5 判权的**唯一** MIS userId 来源。
IDENTITY_ARG_KEYS: tuple[str, ...] = (
    "userId",
    "userMobile",
    "channel",
    "channelUserId",
    "misUserId",
)

# HTTP Header 映射
# ⚠ T03 S9 决策：**刻意不含 misUserId** —— 它只在进程内工具链路参与判权，
# 不随 MCP HTTP 请求外泄给下游业务系统（避免把内部身份主键扩散到信任边界之外）。
IDENTITY_HEADER_MAP: dict[str, str] = {
    "userId": "X-User-Id",
    "userMobile": "X-User-Mobile",
    "channel": "X-Channel",
    "channelUserId": "X-Channel-User-Id",
}


def build_mcp_identity(
    *,
    user_id: str = "",
    user_mobile: str = "",
    channel: str = "",
    channel_user_id: str = "",
    mis_user_id: str | int | None = None,
) -> dict[str, str]:
    """构建完整身份字典（五个字段始终存在，空字符串也不省略）。

    Args:
        user_id: 平台用户 ID（企微 userid / employeeId，**不是** MIS userId）。
        user_mobile: 用户手机号。
        channel: 接入渠道。
        channel_user_id: 渠道侧 userId。
        mis_user_id: MIS userId（T03 S9 第五键）；``None`` / 空 → 空串，
            下游判权时视为无身份并 fail-closed 拒绝。

    Returns:
        含五个 camelCase 键的身份字典。
    """
    return {
        "userId": (user_id or "").strip(),
        "userMobile": (user_mobile or "").strip(),
        "channel": (channel or "").strip(),
        "channelUserId": (channel_user_id or "").strip(),
        "misUserId": ("" if mis_user_id is None else str(mis_user_id)).strip(),
    }


def identity_to_headers(identity: dict[str, str]) -> dict[str, str]:
    """将身份字典转为 HTTP Header（空值不写入 Header）。"""
    headers: dict[str, str] = {}
    for key, header_name in IDENTITY_HEADER_MAP.items():
        value: str = (identity.get(key) or "").strip()
        if value:
            headers[header_name] = value
    return headers


def merge_identity_into_args(
    payload: dict[str, Any],
    identity: dict[str, str],
) -> dict[str, Any]:
    """将身份字段注入 MCP 工具 arguments 的 ``identity`` 对象。

    结构示例::

        {
          "apiName": "...",
          "params": {...},
          "identity": {
            "userId": "...",
            "userMobile": "",
            "channel": "wecom-bot",
            "channelUserId": "..."
          }
        }

    ``userMobile`` 等字段即使为空字符串也会写入，不省略。
    """
    merged: dict[str, Any] = dict(payload)
    # 清理旧版扁平字段，避免与 identity 对象并存
    for key in IDENTITY_ARG_KEYS:
        merged.pop(key, None)
    merged[IDENTITY_OBJECT_KEY] = {
        key: (identity.get(key) or "").strip() for key in IDENTITY_ARG_KEYS
    }
    return merged


def get_mcp_identity() -> dict[str, str] | None:
    """读取当前上下文中的 MCP 身份。"""
    return _mcp_identity.get()


def set_mcp_identity(identity: dict[str, str] | None) -> Token[dict[str, str] | None]:
    """设置当前上下文的 MCP 身份，返回可 reset 的 Token。"""
    return _mcp_identity.set(identity)


def reset_mcp_identity(token: Token[dict[str, str] | None]) -> None:
    """恢复 set_mcp_identity 之前的上下文。"""
    _mcp_identity.reset(token)


def identity_from_tool_metadata(metadata: dict[str, Any] | None) -> dict[str, str]:
    """从 ToolExecutionContext.metadata / tool_metadata 提取身份。"""
    if not metadata:
        return build_mcp_identity()
    nested: Any = metadata.get(IDENTITY_OBJECT_KEY)
    if isinstance(nested, dict):
        return build_mcp_identity(
            user_id=str(nested.get("userId") or nested.get("user_id") or ""),
            user_mobile=str(nested.get("userMobile") or nested.get("user_mobile") or ""),
            channel=str(nested.get("channel") or ""),
            channel_user_id=str(
                nested.get("channelUserId") or nested.get("channel_user_id") or ""
            ),
            mis_user_id=nested.get("misUserId") or nested.get("mis_user_id") or "",
        )
    return build_mcp_identity(
        user_id=str(metadata.get("userId") or metadata.get("user_id") or ""),
        user_mobile=str(metadata.get("userMobile") or metadata.get("user_mobile") or ""),
        channel=str(metadata.get("channel") or ""),
        channel_user_id=str(
            metadata.get("channelUserId") or metadata.get("channel_user_id") or ""
        ),
        mis_user_id=metadata.get("misUserId") or metadata.get("mis_user_id") or "",
    )


class IdentityAwareAsyncClient(httpx.AsyncClient):
    """在每次 HTTP 请求上注入当前 MCP 身份 Header。"""

    async def send(
        self,
        request: httpx.Request,
        *args: Any,
        **kwargs: Any,
    ) -> httpx.Response:
        identity: dict[str, str] | None = get_mcp_identity()
        if identity:
            for header_name, value in identity_to_headers(identity).items():
                request.headers[header_name] = value
        return await super().send(request, *args, **kwargs)
