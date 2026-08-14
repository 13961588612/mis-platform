"""Add ``agent_feedback`` table for session feedback operations (CF-01/CF-03/CF-05).

Revision ID: 004
Revises: 003
Create Date: 2026-08-13 12:00:00

背景（CF-03 存储方案：独立 PG 表，运营读侧权威）
------------------------------------------------
用户提交 feedback 时，热路径仍写 Redis ``message.metadata.feedback``（权威），
PG 双写 ``agent_session_message.metadata``（尽力）+ 本表 upsert（尽力）。
运营标记处理（pending → handled/ignored）**只**写本表，可靠持久化。

为什么不在 ``message.metadata.feedback`` 里扩展处理状态（否决备选方案 A）：

- metadata 是 Redis 权威、PG 尽力同步（degraded 时只 Redis），运营标记属
  高可信操作，挂在不保证落盘的投影上不可接受；
- 用户可重复提交覆盖写 feedback，处理状态若在同一 JSON 里，用户改评会
  连带覆盖运营标记；
- Redis TTL 过期/重启后处理状态丢失；
- 无法高效按 status 过滤/统计。

本表设计要点：

- ``UNIQUE (session_id, message_id)``：用户对同一消息覆盖写 → ``upsert``
  天然幂等，统计按最新值（PRD Q-C1 已确认）。
- ``agent_id`` / ``user_id`` 冗余存储：列表/统计按 agent 过滤零 join。
- ``rating`` 取值 up/down；``comment`` 为吐槽说明（≤500 字）。
- ``status`` 取值 pending/handled/ignored，默认 pending；单向终态。
- 索引按真实查询组合建：``(status, created_at)`` 覆盖「待处理优先」，
  ``(agent_id, created_at)`` 覆盖按 Agent 过滤，``(rating, created_at)``
  覆盖按评价过滤，``(session_id)`` 覆盖会话维度下钻。

⚠ 本项目 Alembic 走同步驱动（``postgresql://`` + psycopg2，见
``alembic/env.py``）；运行时 ORM 走 ``postgresql+asyncpg://``。两者并存，
本迁移不涉及驱动改动。

配套 ORM 见 ``src/models/agent_feedback.py``。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FEEDBACK_TABLE: str = "agent_feedback"


def upgrade() -> None:
    """Create the agent_feedback table and its supporting indexes."""
    op.create_table(
        FEEDBACK_TABLE,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("session_id", sa.String(length=128), nullable=False),
        sa.Column("message_id", sa.String(length=64), nullable=False),
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("rating", sa.String(length=8), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("handler_id", sa.String(length=64), nullable=True),
        sa.Column("handler_name", sa.String(length=128), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint("session_id", "message_id", name="uq_agent_feedback_session_message"),
        sa.PrimaryKeyConstraint("id", name="pk_agent_feedback"),
    )
    op.create_index(
        "ix_agent_feedback_status_created", FEEDBACK_TABLE, ["status", "created_at"]
    )
    op.create_index(
        "ix_agent_feedback_agent_created", FEEDBACK_TABLE, ["agent_id", "created_at"]
    )
    op.create_index(
        "ix_agent_feedback_rating_created", FEEDBACK_TABLE, ["rating", "created_at"]
    )
    op.create_index("ix_agent_feedback_session", FEEDBACK_TABLE, ["session_id"])


def downgrade() -> None:
    """Drop the agent_feedback table and its indexes."""
    op.drop_index("ix_agent_feedback_status_created", table_name=FEEDBACK_TABLE)
    op.drop_index("ix_agent_feedback_agent_created", table_name=FEEDBACK_TABLE)
    op.drop_index("ix_agent_feedback_rating_created", table_name=FEEDBACK_TABLE)
    op.drop_index("ix_agent_feedback_session", table_name=FEEDBACK_TABLE)
    op.drop_table(FEEDBACK_TABLE)
