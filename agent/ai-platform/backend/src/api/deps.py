"""FastAPI 依赖注入提供者。

通过 FastAPI 的 Depends() 机制向路由处理器提供核心服务的单例实例。

T03 增量：
- :func:`resolve_request_mis_user_id` —— 会话创建点的 MIS userId 解析依赖（尽力而为，
  解析不出返回 ``None``；**闸门在执行期**，不在此处 401）。
- :func:`require_ops_permission` / :func:`require_skill_run` —— 运营端点与
  直接 skill 执行路由的 fail-closed 鉴权依赖工厂。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException, status

from src.agent.manager import AgentManager, get_agent_manager
from src.agent.session import SessionManager, get_session_manager
from src.config import get_settings
from src.config_manager.manager import ConfigManager, get_config_manager
from src.identity.mis_token import MisTokenError, MisTokenVerifier
from src.identity.mis_user_id import resolve_mis_user_id_async
from src.identity.models import TokenPayload, build_user_context
from src.identity.permissions import get_category_resolver
from src.identity.token import TokenError, TokenManager
from src.llm.gateway import LLMGateway, get_llm_gateway
from src.router.agent_router import AgentRouter, get_agent_router
from src.router.route_logger import RouteLogger, get_route_logger
from src.skills.acl import (
    CODE_ACL_UNAVAILABLE,
    SkillAclDenied,
    SkillAclGuard,
    get_skill_acl_guard,
)
from src.utils.logging import get_logger

logger = get_logger("api.deps")

#: 运营端点缺码时的语义标签（Python 路由侧码，Java 侧不定义，#2 裁定）。
CODE_OPS_FORBIDDEN: str = "AI_OPS_FORBIDDEN"


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


# ===========================================================================
# T03 fail-closed 权限闸门依赖
# ===========================================================================


async def get_optional_current_user(
    authorization: str = Header(default=""),
    x_mis_depts: str = Header(default="", alias="X-Mis-Depts"),
    x_mis_orgs: str = Header(default="", alias="X-Mis-Orgs"),
    x_mis_roles: str = Header(default="", alias="X-Mis-Roles"),
) -> dict[str, Any] | None:
    """尽力解析身份；**无 token / token 无效时返回 ``None``，不抛 401**。

    专供「会话创建点解析 MIS userId」使用：会话创建本身不是 T03 的闸门位置，
    真正的 fail-closed 在工具执行期（:class:`~src.runtime.acl_tool_wrapper.AclToolWrapper`）
    与 :func:`require_skill_run`。此处若强制 401 会误伤大量非 skill 场景，
    且**并不提升安全性**（解析不出 → ``mis_user_id=None`` → 执行期照样拒绝）。

    Args:
        authorization: ``Authorization`` 头原值。
        x_mis_depts: BFF 注入的部门头。
        x_mis_orgs: BFF 注入的组织头。
        x_mis_roles: BFF 注入的角色头。

    Returns:
        身份字典（``get_current_user`` 同构）或 ``None``。
    """
    if not isinstance(authorization, str) or not authorization.startswith("Bearer "):
        return None
    try:
        return await get_current_user(
            authorization=authorization,
            x_mis_depts=x_mis_depts,
            x_mis_orgs=x_mis_orgs,
            x_mis_roles=x_mis_roles,
        )
    except HTTPException:
        return None
    except Exception as exc:  # noqa: BLE001 - 解析失败一律降级为「无身份」
        logger.warning("Optional identity resolution failed", error=str(exc))
        return None


async def resolve_request_mis_user_id(
    identity: dict[str, Any] | None = Depends(get_optional_current_user),
) -> int | None:
    """解析当前请求的 MIS userId（T03 S9 会话创建点入口）。

    - RS256（MIS JWT）→ ``profile["mis_user_id"]``（档 1）。
    - HS256（企微 JWT）→ 查 ``users.mis_user_id``（档 2，需 DB）。
    - 其它 / 无 token → ``None``（档 3，执行期 fail-closed）。

    **绝不**回退顶层 ``user_id``（employeeId / 企微 userid）。

    Args:
        identity: 尽力解析出的身份字典。

    Returns:
        MIS userId 或 ``None``。
    """
    return await resolve_mis_user_id_with_db(identity)


async def resolve_mis_user_id_with_db(
    identity: dict[str, Any] | None,
) -> int | None:
    """解析 MIS userId；仅在确需查库（档 2）时才开数据库连接。

    Args:
        identity: 身份字典 / ``UserContext`` / ``None``。

    Returns:
        MIS userId 或 ``None``。
    """
    if identity is None:
        return None

    # 先做不依赖 DB 的档 0 / 档 1 / 档 3。
    resolved: int | None = await resolve_mis_user_id_async(identity, db=None)
    if resolved is not None:
        return resolved

    # 走到这里说明可能是档 2（企微 JWT），才付出一次 DB 连接的代价。
    try:
        from src.db.session import db_session_context

        async with db_session_context() as db:
            return await resolve_mis_user_id_async(identity, db=db)
    except Exception as exc:  # noqa: BLE001 - DB 不可用不得阻断会话创建
        logger.warning(
            "MIS userId DB lookup unavailable; treating as unresolved (fail-closed later)",
            error=str(exc),
        )
        return None


async def _prepare_acl_context(
    authorization: str,
    identity: dict[str, Any],
) -> dict[str, Any]:
    """为 ACL 判定补齐上下文：``mis_user_id`` + ``raw_jwt``。

    Args:
        authorization: 原始 ``Authorization`` 头（``Bearer xxx``）。
        identity: :func:`get_current_user` 返回的身份字典。

    Returns:
        原字典（就地补字段后返回，便于路由继续使用）。
    """
    ctx: dict[str, Any] = identity
    if ctx.get("mis_user_id") is None:
        ctx["mis_user_id"] = await resolve_mis_user_id_with_db(ctx)
    token: str = authorization[7:] if authorization.startswith("Bearer ") else ""
    if token:
        ctx["raw_jwt"] = token
    return ctx


def _denied_to_http(denied: SkillAclDenied, forbidden_code: str) -> HTTPException:
    """把 :class:`SkillAclDenied` 转为 403 ``HTTPException``。

    Args:
        denied: 判定器抛出的拒绝对象。
        forbidden_code: "缺码/无身份" 场景使用的语义标签
            （``AI_SKILL_FORBIDDEN`` 或 ``AI_OPS_FORBIDDEN``）。

    Returns:
        待抛出的 ``HTTPException``（HTTP 403；#10 裁定不强求与 Java 侧状态码统一）。
    """
    payload: dict[str, Any] = denied.to_payload()
    if denied.code != CODE_ACL_UNAVAILABLE:
        payload["code"] = forbidden_code
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=payload)


def require_ops_permission(
    required: str | None = None,
) -> Callable[..., Awaitable[dict[str, Any]]]:
    """运营端点鉴权依赖工厂。

    用法::

        @router.post("/servers", dependencies=[Depends(require_ops_permission("agent:mcp:write"))])

    语义：先 :func:`get_current_user` 得身份 → 解析 MIS userId 与权限码 →
    ``required`` 不在集合中则 403 ``AI_OPS_FORBIDDEN``。
    ``required`` 省略时只做「身份 + 权限码可解析」校验，由调用方在路由内
    显式检查具体 ``agent:*`` 码。

    Args:
        required: 需要的运营权限码；``None`` 表示不校验具体码。

    Returns:
        可用于 ``Depends()`` 的异步依赖函数，返回补齐后的身份字典。
    """

    async def _dependency(
        authorization: str = Header(default=""),
        identity: dict[str, Any] = Depends(get_current_user),
    ) -> dict[str, Any]:
        """校验运营权限码，通过则返回身份上下文。"""
        ctx: dict[str, Any] = await _prepare_acl_context(authorization, identity)
        guard: SkillAclGuard = get_skill_acl_guard()
        try:
            codes: set[str] = await guard.resolve_codes(ctx)
        except SkillAclDenied as denied:
            raise _denied_to_http(denied, CODE_OPS_FORBIDDEN) from denied

        if required and required not in codes:
            denied = SkillAclDenied(
                code=CODE_OPS_FORBIDDEN,
                skill_id="",
                required_permission=required,
                message=f"缺少运营权限码 {required}，请联系管理员",
            )
            raise _denied_to_http(denied, CODE_OPS_FORBIDDEN)
        return ctx

    return _dependency


def require_skill_run(
    skill_id: str | None = None,
) -> Callable[..., Awaitable[dict[str, Any]]]:
    """直接 skill 执行路由的鉴权依赖工厂（fail-closed）。

    用法::

        @router.post("/{name}/call", dependencies=[Depends(require_skill_run())])

    ``skill_id`` 省略时退化为「身份 + 权限码可解析」校验，具体码由路由内
    根据 ``name`` / 请求体推导后调 :meth:`SkillAclGuard.assert_can_run`。

    Args:
        skill_id: 固定的技能 ID；``None`` 表示由路由内自行判定。

    Returns:
        可用于 ``Depends()`` 的异步依赖函数，返回补齐后的身份字典。
    """

    async def _dependency(
        authorization: str = Header(default=""),
        identity: dict[str, Any] = Depends(get_current_user),
    ) -> dict[str, Any]:
        """校验 skill 执行权限码，通过则返回身份上下文。"""
        ctx: dict[str, Any] = await _prepare_acl_context(authorization, identity)
        guard: SkillAclGuard = get_skill_acl_guard()
        try:
            if skill_id:
                await guard.assert_can_run(ctx, skill_id)
            else:
                await guard.resolve_codes(ctx)
        except SkillAclDenied as denied:
            raise _denied_to_http(denied, denied.code) from denied
        return ctx

    return _dependency
