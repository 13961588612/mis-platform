"""FastAPI 依赖注入提供者。

通过 FastAPI 的 Depends() 机制向路由处理器提供核心服务的单例实例。
"""

from __future__ import annotations
from typing import Any

import jwt
from fastapi import Header, HTTPException, status

from src.agent.manager import AgentManager, get_agent_manager
from src.agent.session import SessionManager, get_session_manager
from src.config import get_settings
from src.config_manager.manager import ConfigManager, get_config_manager
from src.identity.mis_token import MisTokenError, MisTokenVerifier
from src.identity.models import TokenPayload, build_user_context
from src.identity.permissions import get_category_resolver
from src.identity.token import TokenError, TokenManager
from src.llm.gateway import LLMGateway, get_llm_gateway
from src.router.agent_router import AgentRouter, get_agent_router
from src.router.route_logger import RouteLogger, get_route_logger
from src.utils.logging import get_logger

logger = get_logger("api.deps")


def get_agent_manager_dep() -> AgentManager:
    """提供单例 AgentManager。"""
    return get_agent_manager()


def get_session_manager_dep() -> SessionManager:
    """提供单例 SessionManager。"""
    return get_session_manager()


def get_config_manager_dep() -> ConfigManager:
    """提供单例 ConfigManager。"""
    return get_config_manager()


def get_llm_gateway_dep() -> LLMGateway:
    """提供单例 LLMGateway。"""
    return get_llm_gateway()


def get_agent_router_dep() -> AgentRouter:
    """提供单例 AgentRouter。"""
    return get_agent_router()


def get_route_logger_dep() -> RouteLogger:
    """提供单例 RouteLogger。"""
    return get_route_logger()


async def get_current_user(
    authorization: str = Header(default=""),
    x_mis_depts: str = Header(default="", alias="X-Mis-Depts"),
    x_mis_orgs: str = Header(default="", alias="X-Mis-Orgs"),
    x_mis_roles: str = Header(default="", alias="X-Mis-Roles"),
) -> dict[str, Any]:
    """
    从 Authorization 头部提取并验证 JWT token。

    判别策略（阶段1 认证对齐）：以 JWT 头 ``alg`` 为主。
    - ``alg == "RS256"``：视为 MIS 下发的身份，使用 MIS RSA 公钥验签，
      并映射为平台 ``UserContext``（返回字典带 ``mis=True`` 标志）。
    - 其它（默认 HS256）：走平台自有 TokenManager 验签（原逻辑不变）。

    Returns:
        包含 user_id、name、department、role 等字段的字典；
        MIS 身份额外携带 ``mis=True``。

    Raises:
        HTTPException: token 缺失或无效时返回 401。
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token: Any = authorization[7:]  # 去掉 "Bearer " 前缀

    # 仅读取 JWT 头，不验签；用于区分 MIS(RS256) 与平台(HS256) 身份
    try:
        header: dict[str, Any] = jwt.get_unverified_header(token)
    except Exception:
        header = {}
    alg: str = header.get("alg", "")
    settings = get_settings()

    if alg == "RS256":
        # —— MIS 下发的身份（阶段1 新分支）——
        try:
            verifier: MisTokenVerifier = MisTokenVerifier(settings)
            mis_payload = verifier.verify(token)
            # 收集 BFF 注入的 X-Mis-* 头（仅在有非空值时解读；平台仅信任配合法 MIS JWT 的受信域头，见 R5）。
            # 注：直接以函数方式调用（如单测）时未传的 Header 默认是 Header 对象，此处统一规约为字符串。
            mis_headers = {
                "X-Mis-Depts": x_mis_depts if isinstance(x_mis_depts, str) else "",
                "X-Mis-Orgs": x_mis_orgs if isinstance(x_mis_orgs, str) else "",
                "X-Mis-Roles": x_mis_roles if isinstance(x_mis_roles, str) else "",
            }
            ctx = build_user_context(
                mis_payload,
                mis_headers if any(mis_headers.values()) else None,
                resolver=get_category_resolver(),
            )
            return {"mis": True, **ctx.model_dump()}
        except MisTokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid MIS token: {exc}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("MIS token validation failed", error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="MIS token validation failed",
            )

    # —— 平台自有 HS256（原逻辑不变，服务 H5 / 企微 Bot）——
    try:
        token_manager: TokenManager = TokenManager()
        payload: TokenPayload = token_manager.verify_access_token(token)
        return payload.model_dump()
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Token validation failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token validation failed",
        )


async def get_trace_id(
    x_trace_id: str = Header(default=""),
) -> str:
    """从请求头部提取 trace ID。"""
    return x_trace_id
