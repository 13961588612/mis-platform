"""MIS userId 解析 — E1–E5 fail-closed 的**前置身份闸门**（T03 spec §2.8 / #15-a）。

把 Python 侧「MIS RS256 JWT / 平台 HS256 JWT / 反向信任头」产出的身份对象，
解析为 **MIS userId（``int``）**，供
:meth:`src.identity.mis_permission_resolver.MisPermissionResolver.resolve`
取端用户权限码。

**语义铁律（F20 / F24 / F28，Q12 P1 验收信号）**：

1. **严禁返回顶层 ``user_id``** —— 那是 ``employeeId``（MIS RS256）或企微 ``userid``
   （HS256），都不是 MIS userId；回退它去 ``loadPermissions`` 即 #14 同款横向越权。
2. 解析不出 → 返回 ``None``，**不抛异常、不猜测**；调用方一律 fail-closed
   （``SkillAclDenied(code="AI_SKILL_FORBIDDEN")`` / ``HTTPException(403)``）。
3. 调用点在**会话创建点 / JWT 解析层**（S9 决策 3 已由 JWT 解析层前移到会话创建点），
   解析结果经 ``Session.mis_user_id`` → ``misUserId`` 第五键透传到工具层；
   **禁止在 ``skill.py`` / ``mcp.py`` 路由层临时解析**（F27）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.utils.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover - 仅供类型检查，避免运行期环依赖
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import Session as DbSession

    from src.identity.models import UserContext

logger = get_logger("identity.mis_user_id")

__all__ = ["resolve_mis_user_id", "resolve_mis_user_id_async"]

#: 企微渠道 user_id 常见前缀（``wecom_{wecom_user_id}``）。查库前需剥离。
_WECOM_USER_ID_PREFIXES: tuple[str, ...] = ("wecom_", "wecom-")

#: 判定「这是 MIS(RS256) 身份」的渠道标识（``build_user_context`` 固定写死）。
_MIS_CHANNEL: str = "mis_bff"


def _read(identity: Any, key: str, default: Any = None) -> Any:
    """从 dict 或对象上统一读取字段。

    Args:
        identity: 身份对象（``dict`` 或带属性的对象，如 ``UserContext``）。
        key: 字段名（snake_case）。
        default: 取不到时的返回值。

    Returns:
        字段值；不存在时返回 ``default``。
    """
    if isinstance(identity, dict):
        return identity.get(key, default)
    return getattr(identity, key, default)


def _read_any(identity: Any, keys: tuple[str, ...], default: Any = None) -> Any:
    """按 keys 顺序读取第一个非 None 的字段值。"""
    for key in keys:
        value: Any = _read(identity, key, None)
        if value is not None and value != "":
            return value
    return default


def _to_int(value: Any) -> int | None:
    """把权限系统用的 userId 安全转为 ``int``；非法值返回 ``None``（fail-closed）。

    Args:
        value: 原始值（``int`` / 数字字符串 / 其它）。

    Returns:
        合法正整数或 ``None``。``bool`` 视为非法（避免 ``True → 1`` 误判）。
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed: int = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _profile_of(identity: Any) -> dict[str, Any]:
    """取身份对象上的 ``profile`` 字典（缺失或类型不符时返回空字典）。"""
    profile: Any = _read(identity, "profile", None)
    return profile if isinstance(profile, dict) else {}


def _is_mis_identity(identity: Any) -> bool:
    """判定是否为 MIS（RS256）身份 —— 决定走档 1 而非档 2。

    命中任一即为 MIS 身份：

    - 显式 ``mis=True`` 标志（``api/deps.py:get_current_user`` RS256 分支返回）。
    - ``channel == "mis_bff"``（``build_user_context`` 对 MIS JWT 固定写死）。
    - ``profile`` 中带非空 ``mis_user_id``（``build_user_context`` L291 写入）。

    Args:
        identity: 身份对象。

    Returns:
        是 MIS 身份则 ``True``。
    """
    if _read(identity, "mis", False) is True:
        return True
    if str(_read(identity, "channel", "") or "") == _MIS_CHANNEL:
        return True
    return _profile_of(identity).get("mis_user_id") is not None


def _strip_wecom_prefix(raw: str) -> str:
    """剥离企微渠道 user_id 的 ``wecom_`` / ``wecom-`` 前缀。

    Args:
        raw: 形如 ``wecom_zhangsan`` 或 ``zhangsan`` 的原始值。

    Returns:
        去前缀后的企微 userid。
    """
    value: str = raw.strip()
    for prefix in _WECOM_USER_ID_PREFIXES:
        if value.lower().startswith(prefix):
            return value[len(prefix) :]
    return value


def _lookup_by_wecom_user_id(db: "DbSession", wecom_user_id: str) -> int | None:
    """按企微 userid 查 ``users.mis_user_id``（档 2）。

    Args:
        db: 同步 SQLAlchemy 会话。
        wecom_user_id: 已去前缀的企微 userid。

    Returns:
        已绑定的 MIS userId；未绑定 / 查询失败 → ``None``（fail-closed）。
    """
    # 局部 import：避免 identity 包在模块加载期反向依赖 models 包（环依赖防御）。
    from src.models.user import UserModel

    try:
        row: Any = (
            db.query(UserModel.mis_user_id)
            .filter(UserModel.wecom_user_id == wecom_user_id)
            .first()
        )
    except Exception as exc:  # noqa: BLE001 - DB 异常一律降级为「解析不出」
        logger.warning(
            "resolve_mis_user_id: users.mis_user_id lookup failed",
            wecom_user_id=wecom_user_id,
            error=str(exc),
            exc_type=exc.__class__.__name__,
        )
        return None
    if not row:
        return None
    return _to_int(row[0])


def _prepare(
    identity: "UserContext | dict[str, Any] | None",
) -> tuple[int | None, str]:
    """执行**不依赖数据库**的档 0 / 档 1 / 档 3 解析。

    Args:
        identity: 身份对象。

    Returns:
        ``(mis_user_id, wecom_user_id_to_lookup)``：

        - 已定论时返回 ``(值或 None, "")``；
        - 需要查库（档 2）时返回 ``(None, 已去前缀的企微 userid)``。
    """
    if identity is None:
        return None, ""

    # —— 档 0：已解析过的 MIS userId（snake_case 与 camelCase 两种写法都认）——
    direct: int | None = _to_int(
        _read_any(identity, ("mis_user_id", "misUserId"), None)
    )
    if direct is not None:
        return direct, ""

    # —— 档 1：RS256（MIS JWT）—— 真 MIS userId 只在 profile["mis_user_id"]
    if _is_mis_identity(identity):
        mis_uid: int | None = _to_int(_profile_of(identity).get("mis_user_id"))
        if mis_uid is None:
            logger.warning(
                "resolve_mis_user_id: MIS identity without profile.mis_user_id "
                "→ fail-closed (绝不回退顶层 user_id/employeeId)",
            )
        # 档 1 一旦成立就不再降档（MIS 身份不会同时是企微身份）。
        return mis_uid, ""

    # —— 档 2 前置：取企微 userid（顶层 user_id / channel_user_id 都是企微 userid，F28）——
    raw_wecom: Any = _read_any(identity, ("channel_user_id", "channelUserId"), None)
    if raw_wecom in (None, ""):
        raw_wecom = _read_any(identity, ("user_id", "userId"), None)
    if raw_wecom in (None, ""):
        # —— 档 3：反向信任头 / 其它 —— 非 MIS userId → 拒绝
        return None, ""

    return None, _strip_wecom_prefix(str(raw_wecom))


async def resolve_mis_user_id_async(
    identity: "UserContext | dict[str, Any] | None",
    db: "AsyncSession | None" = None,
) -> int | None:
    """:func:`resolve_mis_user_id` 的异步版本（本仓库 DB 为 ``AsyncSession``）。

    档 0 / 档 1 / 档 3 语义与同步版完全一致；仅档 2 的
    ``users.mis_user_id`` 查询改用 ``await db.execute(select(...))``。

    Args:
        identity: 身份对象。
        db: 异步 SQLAlchemy 会话；``None`` 时档 2 直接返回 ``None``。

    Returns:
        MIS userId（正整数）或 ``None``。
    """
    resolved, wecom_user_id = _prepare(identity)
    if resolved is not None or not wecom_user_id or db is None:
        return resolved

    from sqlalchemy import select

    from src.models.user import UserModel

    try:
        result: Any = await db.execute(
            select(UserModel.mis_user_id).where(
                UserModel.wecom_user_id == wecom_user_id
            )
        )
        row: Any = result.first()
    except Exception as exc:  # noqa: BLE001 - DB 异常一律降级为「解析不出」
        logger.warning(
            "resolve_mis_user_id_async: users.mis_user_id lookup failed",
            wecom_user_id=wecom_user_id,
            error=str(exc),
            exc_type=exc.__class__.__name__,
        )
        return None
    if not row:
        return None
    return _to_int(row[0])


def resolve_mis_user_id(
    identity: "UserContext | dict[str, Any] | None",
    db: "DbSession | None" = None,
) -> int | None:
    """把身份对象解析为 MIS userId（``int``）；解析不出 → ``None``。

    三档解析（#15-a，F24–F31）：

    - **档 0（已解析直取）**：身份上已带 ``mis_user_id`` / ``misUserId``
      （会话恢复、``misUserId`` 第五键回传等场景）→ 原样返回。
      这**不是**顶层 ``user_id``，不违反 F20/F24。
    - **档 1（RS256 / MIS JWT）**：真 MIS userId **只**在 ``profile["mis_user_id"]``；
      缺失 → ``None``（fail-closed），**绝不**回退顶层 ``user_id``（= employeeId）。
    - **档 2（HS256 / 企微 JWT）**：``user_id`` / ``channel_user_id`` 是企微 userid
      字符串（F28）→ 查 ``users.mis_user_id``；未绑定 → ``None``
      （#15-c 绑定流程在 T06，此处不阻塞、不放行）。
    - **档 3（反向信任头 / 其它）**：``X-User-Id`` = employeeId（F21），非 MIS userId → ``None``。

    Args:
        identity: ``UserContext``、``get_current_user()`` 返回的字典、
            或 MCP identity 字典（含 ``misUserId``）。``None`` 直接返回 ``None``。
        db: **同步** SQLAlchemy 会话；仅档 2 需要。本仓库 DB 为 ``AsyncSession``，
            异步链路请用 :func:`resolve_mis_user_id_async`。为 ``None`` 时档 2 返回 ``None``。

    Returns:
        MIS userId（正整数）或 ``None``。
    """
    resolved, wecom_user_id = _prepare(identity)
    if resolved is not None or not wecom_user_id or db is None:
        return resolved
    return _lookup_by_wecom_user_id(db, wecom_user_id)
