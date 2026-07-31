"""反向信任头构造（决策 3：平台侧委托调用 MIS FormFill 引擎）。

在 ai-platform 作为「下游」反向调用 mis-admin-bff 的 AI Skill 接口时，
需携带两类凭证（详见 docs/ai-skill-agent-integration-design.md §8）：

1. X-Platform-Token：平台服务凭证（共享密钥），标识「这是 ai-platform 自身发起的调用」。
2. X-Mis-Upstream-Jwt：上游 genuine MIS RS256 JWT，来自当前 agent 会话/请求上下文
   （MIS 门户用户登录态），标识「真实用户身份」。注意：该 JWT 必须是从会话中
   取到的真实上游 JWT，严禁 ai-platform 自行伪造。

此外附带 X-Tenant-Id / X-Channel / X-User-Id 等透传身份，便于 BFF 做租户与渠道路由。
"""
from __future__ import annotations
from typing import Any

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("skills.reverse_trust")

# 反向信任头命名（设计 §8，与 mis-admin-bff ReverseTrustInterceptor 对齐）
HEADER_PLATFORM_TOKEN = "X-Platform-Token"
HEADER_MIS_UPSTREAM_JWT = "X-Mis-Upstream-Jwt"
HEADER_TENANT_ID = "X-Tenant-Id"
HEADER_CHANNEL = "X-Channel"
HEADER_USER_ID = "X-User-Id"

# session.state 中保存上游 MIS JWT 的键（由入站处理环节在 MIS 门户会话中持久化）
SESSION_MIS_JWT_KEY = "mis_upstream_jwt"
SESSION_TENANT_ID_KEY = "tenant_id"

# 敏感头（日志中脱敏）
_SENSITIVE_HEADERS = {HEADER_PLATFORM_TOKEN, HEADER_MIS_UPSTREAM_JWT}


def _coerce_str(value: Any, default: str = "") -> str:
    """将任意值安全转为字符串，``None`` 转空串。"""
    if value is None:
        return default
    return str(value)


async def build_reverse_trust_headers(
    *,
    session: Any | None = None,
    identity: dict[str, Any] | None = None,
    tenant_id: str | None = None,
    channel: str | None = None,
    user_id: str | None = None,
) -> dict[str, str]:
    """构造调用 mis-admin-bff AI Skill 接口所需的反向信任头。

    Args:
        session: 当前 agent 会话（优先从中取 user_id/channel/tenant/上游 JWT）。
        identity: 工具执行上下文中的平台身份（userId/userMobile/channel/...）。
        tenant_id: 显式租户 ID（覆盖 session/identity）。
        channel: 显式渠道（覆盖 session/identity）。
        user_id: 显式用户 ID（覆盖 session/identity）。

    Returns:
        可直接传给 httpx 的请求头字典。
    """
    settings = get_settings()
    headers: dict[str, str] = {}
    identity = identity or {}

    # 1) 平台服务凭证（共享密钥）
    shared_secret: str = _coerce_str(settings.AI_PLATFORM_BFF_SHARED_SECRET)
    if shared_secret:
        headers[HEADER_PLATFORM_TOKEN] = shared_secret
    else:
        logger.warning(
            "AI_PLATFORM_BFF_SHARED_SECRET 未配置，反向信任头将缺少 X-Platform-Token"
        )

    # 2) 解析身份字段（优先级：显式 > session > identity）
    resolved_user: str = (
        user_id
        or (getattr(session, "user_id", "") or "")
        or identity.get("userId", "")
    )
    resolved_channel: str = (
        channel
        or (getattr(session, "channel", "") or "")
        or identity.get("channel", "")
    )
    resolved_tenant: str = tenant_id or ""
    if not resolved_tenant and session is not None:
        resolved_tenant = _coerce_str(
            (getattr(session, "state", None) or {}).get(SESSION_TENANT_ID_KEY, "")
        )
    if not resolved_tenant:
        resolved_tenant = _coerce_str(identity.get("tenantId", ""))

    # 3) 上游 MIS RS256 JWT：从 session.state 取 genuine 上游 JWT（严禁伪造）
    upstream_jwt: str = ""
    if session is not None:
        upstream_jwt = _coerce_str(
            (getattr(session, "state", None) or {}).get(SESSION_MIS_JWT_KEY, "")
        )
    if not upstream_jwt:
        upstream_jwt = _coerce_str(identity.get("mis_upstream_jwt", ""))

    if upstream_jwt:
        headers[HEADER_MIS_UPSTREAM_JWT] = upstream_jwt
    else:
        # 非 MIS 门户渠道（H5/企微）走 HS256 登录，无上游 MIS JWT；
        # 此时依靠 X-User-Id / X-Tenant-Id 透传身份（设计 §9.2 降级）。
        logger.debug(
            "未取到上游 MIS RS256 JWT，使用 X-User-Id/X-Tenant-Id 透传（非 MIS 门户会话）",
            user_id=resolved_user,
            channel=resolved_channel,
        )

    if resolved_tenant:
        headers[HEADER_TENANT_ID] = resolved_tenant
    if resolved_channel:
        headers[HEADER_CHANNEL] = resolved_channel
    if resolved_user:
        headers[HEADER_USER_ID] = resolved_user

    # 日志脱敏
    safe = {k: ("<redacted>" if k in _SENSITIVE_HEADERS else v) for k, v in headers.items()}
    logger.info("反向信任头已构造", headers=safe, has_mis_jwt=bool(upstream_jwt))
    return headers
