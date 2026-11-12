"""Create users and departments tables for A2UI / MIS identity resolution.

Revision ID: 005
Revises: 004
Create Date: 2026-08-24 18:00:00

补建缺失的 users / departments 表。ai-platform 后端的 UserModel 期望
ai_platform.users 存在，但历史迁移链（001 建 agent_memory / 002 用
op.add_column("users", mis_user_id) 假设 users 已存在 / 003-004 建
session/feedback）从未建过 users 表 —— 导致运行时 resolve_mis_user_id_async
报 "relation \"users\" does not exist"。

本修订幂等建表（if_not_exists=True）：
- 若 users 表已存在（例如 002 之前手工补过），整表跳过，不会重复加列；
- 若 users 表不存在，建整表（含 mis_user_id 列，与 002 目标一致）。

字段严格对齐 src/models/user.py 的 DepartmentModel / UserModel 及三个 Mixin
（UUIDPrimaryKeyMixin / TimestampMixin / SoftDeleteMixin）。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create departments and users tables (idempotent)."""
    # 1) departments（users.dept_id 外键依赖，先建）
    op.create_table(
        "departments",
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dept_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("parent_id", sa.String(64), nullable=True),
        sa.Column(
            "allowed_categories",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "denied_categories",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")
        ),
        sa.UniqueConstraint("dept_id", name="uq_departments_dept_id"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_departments_dept_id", "departments", ["dept_id"], if_not_exists=True
    )
    op.create_index(
        "ix_departments_parent_id", "departments", ["parent_id"], if_not_exists=True
    )

    # 2) users（核心补表，含 mis_user_id 列，与 002 目标一致）
    op.create_table(
        "users",
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("username", sa.String(128), nullable=False),
        sa.Column(
            "display_name", sa.String(128), nullable=False, server_default=sa.text("''")
        ),
        sa.Column("email", sa.String(256), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column(
            "department", sa.String(64), nullable=False, server_default=sa.text("''")
        ),
        sa.Column("dept_id", sa.String(64), nullable=True),
        sa.Column(
            "roles",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("wecom_user_id", sa.String(64), nullable=True),
        # MIS 侧 userId（T03 #15-a）：企微渠道身份 → MIS 权限主体绑定列。
        # nullable + 无回填：未绑定时为 NULL，resolve_mis_user_id 档 2 返回 None → fail-closed。
        sa.Column("mis_user_id", sa.BigInteger(), nullable=True),
        sa.Column("password_hash", sa.String(256), nullable=True),
        sa.Column(
            "channel",
            sa.String(32),
            nullable=False,
            server_default=sa.text("'wecom_h5'"),
        ),
        sa.Column(
            "skill_allow_list",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "skill_deny_list",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "profile",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", name="uq_users_user_id"),
        sa.UniqueConstraint("mis_user_id", name="uq_users_mis_user_id"),
        sa.ForeignKeyConstraint(
            ["dept_id"],
            ["departments.dept_id"],
            name="fk_users_dept_id",
        ),
        if_not_exists=True,
    )

    # 索引（对齐 ORM 中所有 index=True / unique=True）
    op.create_index("ix_users_user_id", "users", ["user_id"], if_not_exists=True)
    op.create_index("ix_users_username", "users", ["username"], if_not_exists=True)
    op.create_index(
        "ix_users_department", "users", ["department"], if_not_exists=True
    )
    op.create_index("ix_users_dept_id", "users", ["dept_id"], if_not_exists=True)
    op.create_index(
        "ix_users_wecom_user_id", "users", ["wecom_user_id"], if_not_exists=True
    )
    op.create_index(
        "ix_users_mis_user_id", "users", ["mis_user_id"], if_not_exists=True
    )
    op.create_index("ix_users_channel", "users", ["channel"], if_not_exists=True)
    op.create_index("ix_users_is_active", "users", ["is_active"], if_not_exists=True)


def downgrade() -> None:
    """Drop users and departments tables (reverse of upgrade)."""
    op.drop_index("ix_users_is_active", table_name="users")
    op.drop_index("ix_users_channel", table_name="users")
    op.drop_index("ix_users_mis_user_id", table_name="users")
    op.drop_index("ix_users_wecom_user_id", table_name="users")
    op.drop_index("ix_users_dept_id", table_name="users")
    op.drop_index("ix_users_department", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_user_id", table_name="users")
    op.drop_table("users")

    op.drop_index("ix_departments_parent_id", table_name="departments")
    op.drop_index("ix_departments_dept_id", table_name="departments")
    op.drop_table("departments")
