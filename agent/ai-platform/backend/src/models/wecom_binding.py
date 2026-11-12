"""企微身份绑定 ORM 模型 —— ``wecom_identity_bindings`` 表。

依据 ``wecom-user-binding-design.md`` §7.1。这张表是「企微身份 → MIS 用户」
的**绑定事实**来源：不能只按 ``wecom_user_id`` 建唯一键（同一 userid 在不同
企业里会碰撞），权限主体始终是 MIS 侧的 ``mis_user_id``。

关键约定
--------

* **按 corp 隔离**：唯一键是 ``(corp_id, wecom_user_id)``，而不是单独
  ``wecom_user_id``。这解决多企业 / 多 corp 下同名 userid 串绑的问题。
* **手机号只存哈希**：明文手机号只进 ``phone_hash``（加盐 SHA-256），
  展示用 ``phone_masked``。禁止在库中落明文手机号。
* **来源可追溯**：``manual`` / ``auto_phone`` / ``sync``，人工绑定优先级
  最高，不会被自动绑定覆盖。
* **状态显式**：``active`` / ``disabled``；``disabled`` 永不自动重生，
  必须由管理员显式重新启用。

落库位置在 **``ai_platform`` 库**（与 ``users`` / ``agent_session`` 同库）。
ai-platform 的 Python 进程用 ``Base.metadata.create_all`` 建表，不走 Alembic；
因此本模型必须被 ``db/session.py::init_db`` 显式 import，否则建表时会被漏掉。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

#: 绑定来源：人工绑定（优先级最高）。
BIND_SOURCE_MANUAL: str = "manual"
#: 绑定来源：首次手机号 exact-one 自动匹配。
BIND_SOURCE_AUTO_PHONE: str = "auto_phone"
#: 绑定来源：企微组织架构同步回填。
BIND_SOURCE_SYNC: str = "sync"

#: 绑定有效。
BIND_STATUS_ACTIVE: str = "active"
#: 绑定已停用（不自动重生）。
BIND_STATUS_DISABLED: str = "disabled"


class WecomIdentityBinding(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """企微身份与 MIS 用户的绑定记录（``wecom_identity_bindings``）。"""

    __tablename__ = "wecom_identity_bindings"

    corp_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    wecom_user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    mis_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    bind_source: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=BIND_STATUS_ACTIVE
    )
    phone_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    phone_masked: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # 企微侧自然唯一键：同一 corp 内一个 userid 只绑一次。
        UniqueConstraint("corp_id", "wecom_user_id", name="uk_wecom_binding_wecom"),
        # 同一 corp 内一个 MIS 用户只能绑一个企微 userid。
        UniqueConstraint("corp_id", "mis_user_id", name="uk_wecom_binding_mis"),
        Index("idx_wecom_binding_tenant_user", "tenant_id", "mis_user_id"),
        Index("idx_wecom_binding_status", "status"),
    )

    def to_dict(self) -> dict:
        """转为运营台展示用的字典（**绝不包含明文手机号**）。"""
        return {
            "id": self.id,
            "corp_id": self.corp_id,
            "wecom_user_id": self.wecom_user_id,
            "tenant_id": self.tenant_id,
            "mis_user_id": self.mis_user_id,
            "bind_source": self.bind_source,
            "status": self.status,
            "phone_masked": self.phone_masked,
            "last_verified_at": self.last_verified_at.isoformat()
            if self.last_verified_at
            else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


def utcnow() -> datetime:
    """返回带时区的 UTC 当前时间（用于 ``last_verified_at``）。"""
    return datetime.now(timezone.utc)
