"""Add users.mis_user_id for T03 fail-closed skill ACL.

Revision ID: 002
Revises: 001
Create Date: 2025-07-04 10:00:00

T03 #15-a：企微渠道（``user_id = wecom_{wecom_user_id}``）没有 MIS userId，
需要一列把「企微身份」绑定到「MIS 权限主体」。
``resolve_mis_user_id`` 档 2 正是查这一列。

设计要点：

- **nullable**：未绑定 = NULL，解析返回 ``None`` → SkillAclGuard 直接拒绝
  （fail-closed，规则 1），不会误放行。
- **无回填**：不猜、不按手机号/工号 fuzzy match。绑定由 MIS 运营控制台显式写入。
  任何自动回填都可能把 A 的权限装到 B 头上（#14 横向越权）。
- **唯一索引**：一个 MIS userId 至多绑定一个平台用户，防止一码多绑造成
  权限码缓存 ``mis:acl:skillperm:{userId}`` 串号。NULL 在 PostgreSQL 唯一索引中
  互不冲突，故不影响大量未绑定用户。
- **BigInteger**：MIS userId 是 Java ``Long``，用 INT 会在 21 亿后溢出。

⚠ 这是 MIS 侧 userId，**不是** employeeId，也不是 ``users.user_id``。

配套 ORM 改动见 ``src/models/user.py::UserModel.mis_user_id``（F32：加列走迁移，
不依赖 ``create_all``）。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: 与 ``UserModel.mis_user_id`` 的 ``index=True, unique=True`` 生成的名字保持一致。
INDEX_NAME: str = "ix_users_mis_user_id"
TABLE_NAME: str = "users"
COLUMN_NAME: str = "mis_user_id"


def upgrade() -> None:
    """Add the nullable, uniquely-indexed ``users.mis_user_id`` column."""
    op.add_column(
        TABLE_NAME,
        sa.Column(COLUMN_NAME, sa.BigInteger(), nullable=True),
    )
    op.create_index(
        INDEX_NAME,
        TABLE_NAME,
        [COLUMN_NAME],
        unique=True,
    )


def downgrade() -> None:
    """Drop the ``users.mis_user_id`` column and its unique index."""
    op.drop_index(INDEX_NAME, table_name=TABLE_NAME)
    op.drop_column(TABLE_NAME, COLUMN_NAME)
