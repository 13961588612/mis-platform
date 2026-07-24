"""MIS 身份信任 — RS256 JWT 验签（阶段1 认证对齐）。

MIS 使用 RSA 公钥（RS256）签发 JWT，平台复用同一公钥完成验签，
将 MIS 声明映射为内部使用的 :class:`MisTokenPayload`，再由
``identity/models.build_user_context_from_mis`` 转换为平台 ``UserContext``。

平台自有 H5 / 企微 Bot 仍走原有的 HS256 链路（``identity/token.py``），
本模块仅在 ``get_current_user`` 识别 ``alg == "RS256"`` 时被调用，互不影响。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import jwt

from src.config import Settings


class MisTokenError(Exception):
    """当 MIS JWT 无效、过期或验签失败时抛出。"""


@dataclass
class MisTokenPayload:
    """MIS JWT 解析后的声明（仅包含平台适配层所需字段）。"""

    user_id: int = 0
    tenant_id: int | None = None
    app_id: int | None = None
    employee_id: int | None = None
    username: str = ""
    roles: list[str] = field(default_factory=list)
    perm_version: str | None = None
    iss: str | None = None  # MIS JWT iss（T3）；签发方为 "mis-platform"


def _normalize_pem(raw: str) -> str:
    """去除注释行（以 ``#`` 开头）与空行，兼容带说明的占位公钥文件。"""
    lines = [
        line for line in raw.splitlines() if line.strip() and not line.strip().startswith("#")
    ]
    return "\n".join(lines)


class MisTokenVerifier:
    """使用 MIS RSA 公钥验签 RS256 JWT 并解析声明。"""

    def __init__(self, settings: Settings) -> None:
        """从配置加载并缓存 MIS 公钥（避免每次请求读盘）。"""
        self._settings = settings
        self._public_key: str = _normalize_pem(self._load_key(settings))

    @staticmethod
    def _load_key(settings: Settings) -> str:
        """按优先级加载公钥：内联 PEM > 文件路径。"""
        if settings.MIS_JWT_PUBLIC_KEY_PEM:
            return settings.MIS_JWT_PUBLIC_KEY_PEM
        if settings.MIS_JWT_PUBLIC_KEY_PATH:
            try:
                with open(settings.MIS_JWT_PUBLIC_KEY_PATH, "r", encoding="utf-8") as f:
                    return f.read()
            except OSError as exc:
                raise MisTokenError(
                    "无法读取 MIS_JWT_PUBLIC_KEY_PATH="
                    f"{settings.MIS_JWT_PUBLIC_KEY_PATH}: {exc}"
                ) from exc
        raise MisTokenError(
            "MIS_JWT 公钥未配置：请设置 MIS_JWT_PUBLIC_KEY_PEM 或 MIS_JWT_PUBLIC_KEY_PATH"
        )

    def verify(self, token: str) -> MisTokenPayload:
        """验签 RS256 JWT 并返回 :class:`MisTokenPayload`。

        Raises:
            MisTokenError: 验签失败、过期或 ``iss`` 不匹配时。
        """
        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                self._public_key,
                algorithms=[self._settings.MIS_JWT_ALGORITHM],
                options={"verify_iss": False},
            )
        except jwt.ExpiredSignatureError as exc:
            raise MisTokenError("MIS token has expired") from exc
        except jwt.InvalidTokenError as exc:
            raise MisTokenError(f"Invalid MIS token: {exc}") from exc

        # iss 校验（T3）：软 / 强两种模式。
        expected_iss: str = self._settings.MIS_JWT_ISSUER
        token_iss = claims.get("iss")
        payload_iss = token_iss if token_iss is not None else None

        if self._settings.MIS_JWT_VERIFY_ISS and expected_iss:
            # 强校验：iss 必须存在且等于 MIS_JWT_ISSUER（启用前需 T1 已上线，否则旧 token 无 iss 会被拒）
            if payload_iss is None or payload_iss != expected_iss:
                raise MisTokenError(
                    f"Invalid MIS token iss: expected {expected_iss}, got {payload_iss}"
                )
        elif expected_iss and payload_iss is not None and payload_iss != expected_iss:
            # 软比对（默认，向后兼容）：仅当 token 携带 iss 且不符时拒，未携带则不校验
            raise MisTokenError(
                f"Invalid MIS token iss: expected {expected_iss}, got {payload_iss}"
            )

        return MisTokenPayload(
            user_id=int(claims.get("sub", 0) or 0),
            tenant_id=claims.get("tenantId"),
            app_id=claims.get("appId"),
            employee_id=claims.get("employeeId"),
            username=claims.get("username", "") or "",
            roles=list(claims.get("roles", []) or []),
            perm_version=claims.get("permVersion"),
            iss=payload_iss,
        )
