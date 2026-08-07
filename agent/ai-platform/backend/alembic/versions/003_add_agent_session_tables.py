"""Add agent_session / agent_session_message for T04 session ops (Q1 = plan B).

Revision ID: 003
Revises: 002
Create Date: 2025-07-05 10:00:00

T04 #27–#31 需要「会话列表 / 详情 / 消息 / 删除」。原实现只写 Redis，
TTL 过期或 Redis 重启后运营后台查不到任何历史，且 Redis 无法做
分页 / 按 agent-channel-时间过滤（``KEYS`` 扫描在生产是禁用项）。

方案 B：Redis 热存储保持不变，另建两张 PG 冷表做双写，列表 / 详情读 PG。

建表要点：

- ``agent_session.session_id`` 直接做**字符串主键**，与前端 ``Session`` 契约
  的主键字段名一致（``session_id``，不是 ``id``），双写用
  ``INSERT ... ON CONFLICT (session_id) DO UPDATE`` 天然幂等。
- ``agent_session_message.timestamp`` 是**业务时间**（对应前端
  ``SessionMessage.timestamp``），与入库时间 ``created_at`` 分开，
  便于排查双写延迟。
- ``metadata`` 列用 JSONB（不是 JSON）：支持 GIN 索引与包含查询，
  且写入时已做二进制解析，读多场景更快。
- 外键 ``ON DELETE CASCADE``：物理清理会话时消息一并回收；但运营后台的
  删除走**软删除**（``deleted_at`` 置位），保留审计追溯，不触发级联。
- 索引按真实查询组合建：``(agent_id, updated_at)`` 覆盖「按 Agent 过滤 +
  时间倒序」，``(deleted_at, updated_at)`` 覆盖列表的固定前缀条件，
  ``(session_id, timestamp, seq)`` 覆盖消息翻页。

⚠ 仓库里已有的 ``sessions`` / ``messages`` 表是历史遗留孤儿表（无代码引用、
字段语义与 wire 契约不符），本迁移**不触碰**它们。

⚠ 本项目 Alembic 走同步驱动（``postgresql://`` + psycopg2，见
``alembic/env.py`` 使用 ``settings.postgres_dsn_sync``）；运行时 ORM 走
``postgresql+asyncpg://``。两者并存，本迁移不涉及驱动改动。

配套 ORM 见 ``src/models/agent_session.py``（F32：建表走迁移，不依赖 ``create_all``）。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SESSION_TABLE: str = "agent_session"
MESSAGE_TABLE: str = "agent_session_message"


def upgrade() -> None:
    """Create the two session-ops tables and their supporting indexes."""
    op.create_table(
        SESSION_TABLE,
        sa.Column("session_id", sa.String(length=128), nullable=False),
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("agent_name", sa.String(length=128), nullable=True),
        sa.Column(
            "channel",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("user_name", sa.String(length=128), nullable=True),
        sa.Column("title", sa.String(length=512), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column(
            "message_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("runtime_type", sa.String(length=32), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_activity_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("session_id", name="pk_agent_session"),
    )
    op.create_index("ix_agent_session_agent_id", SESSION_TABLE, ["agent_id"])
    op.create_index("ix_agent_session_channel", SESSION_TABLE, ["channel"])
    op.create_index("ix_agent_session_user_id", SESSION_TABLE, ["user_id"])
    op.create_index("ix_agent_session_status", SESSION_TABLE, ["status"])
    op.create_index("ix_agent_session_created_at", SESSION_TABLE, ["created_at"])
    op.create_index("ix_agent_session_updated_at", SESSION_TABLE, ["updated_at"])
    op.create_index(
        "ix_agent_session_agent_updated", SESSION_TABLE, ["agent_id", "updated_at"]
    )
    op.create_index(
        "ix_agent_session_deleted_updated", SESSION_TABLE, ["deleted_at", "updated_at"]
    )

    op.create_table(
        MESSAGE_TABLE,
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=128), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("seq", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_agent_session_message"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            [f"{SESSION_TABLE}.session_id"],
            name="fk_agent_session_message_session_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_agent_session_message_session_id", MESSAGE_TABLE, ["session_id"]
    )
    op.create_index("ix_agent_session_message_timestamp", MESSAGE_TABLE, ["timestamp"])
    op.create_index(
        "ix_agent_session_message_session_ts",
        MESSAGE_TABLE,
        ["session_id", "timestamp", "seq"],
    )


def downgrade() -> None:
    """Drop both session-ops tables (message table first, FK ordering)."""
    op.drop_index("ix_agent_session_message_session_ts", table_name=MESSAGE_TABLE)
    op.drop_index("ix_agent_session_message_timestamp", table_name=MESSAGE_TABLE)
    op.drop_index("ix_agent_session_message_session_id", table_name=MESSAGE_TABLE)
    op.drop_table(MESSAGE_TABLE)

    op.drop_index("ix_agent_session_deleted_updated", table_name=SESSION_TABLE)
    op.drop_index("ix_agent_session_agent_updated", table_name=SESSION_TABLE)
    op.drop_index("ix_agent_session_updated_at", table_name=SESSION_TABLE)
    op.drop_index("ix_agent_session_created_at", table_name=SESSION_TABLE)
    op.drop_index("ix_agent_session_status", table_name=SESSION_TABLE)
    op.drop_index("ix_agent_session_user_id", table_name=SESSION_TABLE)
    op.drop_index("ix_agent_session_channel", table_name=SESSION_TABLE)
    op.drop_index("ix_agent_session_agent_id", table_name=SESSION_TABLE)
    op.drop_table(SESSION_TABLE)
