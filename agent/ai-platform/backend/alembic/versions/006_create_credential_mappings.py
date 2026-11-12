"""Create credential_mappings table (AES-256-GCM vault, route A).

Revision ID: 006
Revises: 005
Create Date: 2026-09-29

背景（路线 A：数据库凭证入 ai_platform vault）
------------------------------------------------
问数连接的业务库凭证原先由 DBA 在 wren 机手工 ``wren profile add`` 注入，
平台侧 mis-iqd ``iqd_connection`` 只存 ``secret_ref`` 占位。这导致：

1. 平台无法管理 / 轮换业务库凭证；
2. 表发现只能看到已成模型的表（wren 0.13 MDL 白名单）；
3. ``CredentialVault`` 虽已实现，但其表 ``credential_mappings``
   **从未被任何迁移建过** —— ``resolve_by_ref`` 直接报
   ``UndefinedTableError: relation "credential_mappings" does not exist``。

本迁移补齐该表，使路线 A 的凭证解析链路
``mis-iqd secret_ref → CredentialVault.resolve_by_ref → wren env`` 真正可用。

与 ORM (``src/models/user.py:CredentialMappingModel``) 的差异说明
--------------------------------------------------------------
问数连接凭证**没有平台用户主体**，故本迁移把 ``user_id`` 建成 **可空且无外键**
（ORM 原为 ``ForeignKey("users.user_id") NOT NULL``）。同时给
``system_account``（= vault 引用 / ``secret_ref``）加**唯一索引**，
保证 ``CredentialVault.resolve_by_ref`` 的 ``scalar_one_or_none`` 语义可靠。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create credential_mappings (idempotent)."""
    op.create_table(
        "credential_mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        # 可空：问数连接凭证无平台用户主体（详见模块 docstring）
        sa.Column("user_id", sa.String(64), nullable=True),
        sa.Column("system_type", sa.String(64), nullable=False),
        sa.Column("system_account", sa.String(128), nullable=False),
        sa.Column("encrypted_credential", sa.Text(), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_credential_mappings_user_id",
        "credential_mappings",
        ["user_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_credential_mappings_system_type",
        "credential_mappings",
        ["system_type"],
        if_not_exists=True,
    )
    # vault 引用唯一：resolve_by_ref 按 system_account 单行解析
    op.create_index(
        "uq_credential_mappings_system_account",
        "credential_mappings",
        ["system_account"],
        unique=True,
        if_not_exists=True,
    )


def downgrade() -> None:
    """Drop credential_mappings (reverse of upgrade)."""
    op.drop_index(
        "uq_credential_mappings_system_account", table_name="credential_mappings"
    )
    op.drop_index("ix_credential_mappings_system_type", table_name="credential_mappings")
    op.drop_index("ix_credential_mappings_user_id", table_name="credential_mappings")
    op.drop_table("credential_mappings")
