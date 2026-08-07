"""会话运营（Agent Ops）持久化 ORM 模型：``agent_session`` / ``agent_session_message``。

背景（Q1 = 方案 B：PG 双写）
--------------------------------
``SessionManager`` 原先只把会话写进 Redis，TTL 到期或 Redis 重启后历史即丢失，
运营后台（#27–#31 会话列表 / 详情 / 消息 / 删除）无法回溯。方案 B 要求：

- **热路径不变**：Redis 仍是唯一的读写热存储，Agent 运行时链路零改动、零延迟增加。
- **冷备双写**：会话与消息同时落 PostgreSQL，重启 / 过期后仍可在运营后台查询。
- **列表走 PG**：分页、按 agent / channel / 时间范围过滤、关键字搜索全部由 PG 承担，
  Redis 不具备这些查询能力（``KEYS`` 扫描在生产环境是禁用项）。

与旧表的关系
--------------------------------
仓库里已有 ``src/models/session.py`` 的 ``SessionModel`` (``sessions``) 与
``MessageModel`` (``messages``)，但它们是**历史遗留的孤儿表**——除 Alembic 的
``Base.metadata`` 外没有任何代码引用，字段语义（``id`` 为 UUID 主键、
``session_id`` 只是唯一索引）也与前端 wire 契约不一致。为避免改动未知的历史数据，
本模块**新建**两张表，不动旧表。

wire 契约对齐（关键，勿改字段名）
--------------------------------
前端 ``frontend/mis-admin-web/src/features/agent/types.ts``：

- ``Session``：主键字段名是 ``session_id``（**不是** ``id``），另有
  ``agent_id / agent_name? / channel / user_id? / user_name? / title? /
  message_count / created_at / updated_at``。
- ``SessionMessage``：``id / session_id / role / content / timestamp / metadata?``
  （时间字段是 ``timestamp`` 而**不是** ``created_at``；扩展字段是 ``metadata``
  而**不是** ``meta``）。

因此这两张表直接以 wire 字段名建列，避免在序列化层做易错的改名映射。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base

#: 会话状态取值。``active`` = 进行中；``closed`` = 已结束（正常关闭或 TTL 过期）。
SESSION_STATUS_ACTIVE: str = "active"
SESSION_STATUS_CLOSED: str = "closed"


def _utcnow() -> datetime:
    """返回带时区信息的当前 UTC 时间。"""
    return datetime.now(timezone.utc)


class AgentSessionModel(Base):
    """运营后台可见的会话主表。

    主键刻意选用业务侧的 ``session_id``（字符串）而非自增 / UUID 代理键：

    1. 前端 wire 契约的主键字段就叫 ``session_id``，用它做 PK 可以让
       ``to_wire()`` 零映射输出；
    2. Redis 热存储的 key 也是 ``session_id``，双写时天然幂等
       （``INSERT ... ON CONFLICT (session_id) DO UPDATE``）；
    3. 消息表外键直接指向它，无需额外 join。
    """

    __tablename__ = "agent_session"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)

    agent_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    #: 冗余存储的 Agent 展示名。列表页优先展示它，避免 N+1 查 agent 配置。
    agent_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)

    #: web / wecom / api / unknown，与前端 ``SessionChannel`` 联合类型一致。
    channel: Mapped[str] = mapped_column(
        String(32), nullable=False, default="unknown", index=True
    )

    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    #: 冗余存储的用户展示名，同 ``agent_name``。
    user_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)

    #: 会话标题，通常取首条用户消息的截断文本。
    title: Mapped[str | None] = mapped_column(String(512), nullable=True, default=None)

    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=SESSION_STATUS_ACTIVE, index=True
    )

    #: 消息条数。由 ``persist_message`` 递增维护，列表页直接读，避免 count(*)。
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    #: 会话摘要（可选，留给后续自动摘要能力写入）。
    summary: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    #: 运行时类型（openharness / langgraph 等），便于排障时区分执行引擎。
    runtime_type: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)

    #: 结构化扩展字段。``metadata`` 是 Declarative 的保留属性名，
    #: 故 Python 侧用 ``metadata_``，数据库列名仍是 ``metadata``。
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        index=True,
    )
    #: 最后一次有消息写入的时间，用于空闲会话回收统计。
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    #: 软删除标记。运营后台删除只置位，不物理删数据，保留审计追溯能力。
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    __table_args__ = (
        # 列表页默认按 updated_at 倒序 + 按 agent 过滤，这是最高频的组合。
        Index("ix_agent_session_agent_updated", "agent_id", "updated_at"),
        # 「未删除 + 时间倒序」是每次列表查询的固定前缀条件。
        Index("ix_agent_session_deleted_updated", "deleted_at", "updated_at"),
    )

    def to_wire(self) -> dict:
        """序列化为前端 ``Session`` 契约要求的字典。

        ``status`` / ``runtime_type`` 是契约之外的附加字段：前端 ``Session``
        接口没有声明它们，TypeScript 侧多出的键无害，而运营排障很需要
        「这个会话还活着吗 / 跑在哪个运行时上」。

        Returns:
            与 ``frontend/.../types.ts`` 中 ``Session`` 接口逐字段对齐的 dict。
        """
        return {
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "channel": self.channel,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "title": self.title,
            "status": self.status,
            "runtime_type": self.runtime_type,
            "message_count": int(self.message_count or 0),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AgentSessionMessageModel(Base):
    """会话消息明细表。

    ``id`` 直接复用 ``SessionManager.Message.id``（``uuid4()`` 字符串），
    这样双写是幂等的：同一条消息重复落库只会命中主键冲突并被忽略。
    """

    __tablename__ = "agent_session_message"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    session_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("agent_session.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    #: user / assistant / system / tool
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    #: 同主表：Python 侧 ``metadata_``，数据库列名 ``metadata``。
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)

    #: 前端 ``SessionMessage.timestamp``。业务时间，非入库时间。
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )

    #: 会话内单调递增序号。同一毫秒内多条消息时用它保证排序稳定。
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    #: 入库时间，与业务 ``timestamp`` 区分，用于排查双写延迟。
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    __table_args__ = (
        # 消息详情页固定按 (session_id, timestamp, seq) 升序翻页。
        Index("ix_agent_session_message_session_ts", "session_id", "timestamp", "seq"),
    )

    def to_wire(self) -> dict:
        """序列化为前端 ``SessionMessage`` 契约要求的字典。

        Returns:
            含 ``id / session_id / role / content / timestamp / metadata`` 的 dict。
        """
        return {
            "id": self.id,
            "session_id": self.session_id,
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "metadata": self.metadata_ or {},
        }
