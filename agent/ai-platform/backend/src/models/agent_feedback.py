"""会话反馈运营（CF-01/CF-03/CF-05）持久化 ORM 模型：``agent_feedback``。

背景（CF-03 存储方案：独立 PG 表，运营读侧权威）
------------------------------------------------
用户提交 feedback 时，热路径仍写 Redis ``message.metadata.feedback``（权威），
PG 双写 ``agent_session_message.metadata``（尽力）+ 本表 upsert（尽力）。
运营标记处理（pending → handled/ignored）**只**写本表，可靠持久化。

wire 契约对齐（关键，勿改字段名）
--------------------------------
前端 ``frontend/mis-admin-web/src/features/agent/types.ts`` 新增的
``AgentFeedbackItem`` 与 ``AgentFeedbackStats``：

- 列表项字段：``id / session_id / message_id / agent_id / agent_name? /
  user_id / user_name? / rating / comment / status / handler_id /
  handler_name / note / processed_at / created_at / updated_at / answer_brief``
  （``answer_brief`` 由服务层按 message_id 读 ``agent_session_message.content``
  截断填充，不属于本表列）。
- 统计字段：``total / up / down / up_rate / down_rate / pending / by_agent /
  by_day``。

因此本表直接以 wire 字段名建列，避免在序列化层做易错的改名映射。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base

#: 反馈处理状态取值。``pending`` = 待处理；``handled`` = 已处理；``ignored`` = 已忽略。
#: 状态机单向终态：pending → handled / pending → ignored，不可回退（P0 不提供重开）。
FEEDBACK_STATUS_PENDING: str = "pending"
FEEDBACK_STATUS_HANDLED: str = "handled"
FEEDBACK_STATUS_IGNORED: str = "ignored"

#: 反馈评价取值。``up`` = 点赞；``down`` = 吐槽。
FEEDBACK_RATING_UP: str = "up"
FEEDBACK_RATING_DOWN: str = "down"


def _utcnow() -> datetime:
    """返回带时区信息的当前 UTC 时间。"""
    return datetime.now(timezone.utc)


class AgentFeedbackModel(Base):
    """会话反馈运营主表。

    主键用自增 BIGSERIAL（``id``），与 ``agent_session`` 用业务侧字符串主键不同：
    feedback 是运营侧独立实体，无业务侧天然主键；``session_id + message_id``
    上建唯一约束保证「同一消息覆盖写 → upsert 幂等」，统计按最新值。
    """

    __tablename__ = "agent_feedback"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    session_id: Mapped[str] = mapped_column(String(128), nullable=False)
    #: 后端消息 UUID（与 agent_session_message.id 同源）。
    message_id: Mapped[str] = mapped_column(String(64), nullable=False)

    #: 冗余存储的 Agent id。列表/统计按 agent 过滤零 join。
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: 冗余存储的用户 id（可空，匿名/系统触发时无）。
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)

    #: up / down，与 message.metadata.feedback.rating 同源。
    rating: Mapped[str] = mapped_column(String(8), nullable=False)
    #: 吐槽说明（≤500 字）。
    comment: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    #: pending / handled / ignored，单向终态。
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=FEEDBACK_STATUS_PENDING
    )
    #: 运营操作人（MIS userId 字符串化），BFF 经 X-User-Id 透传注入。
    handler_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    handler_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)
    #: 处理备注。
    note: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
    )

    __table_args__ = (
        # 用户对同一消息覆盖写 → upsert 幂等（PRD Q-C1：统计按最新值）。
        UniqueConstraint(
            "session_id", "message_id", name="uq_agent_feedback_session_message"
        ),
        # 「待处理优先 + 时间倒序」是列表页默认排序组合。
        Index("ix_agent_feedback_status_created", "status", "created_at"),
        # 按 Agent 过滤 + 时间倒序。
        Index("ix_agent_feedback_agent_created", "agent_id", "created_at"),
        # 按评价（up/down）过滤 + 时间倒序。
        Index("ix_agent_feedback_rating_created", "rating", "created_at"),
        # 会话维度下钻（查看会话 → 该会话全部反馈）。
        Index("ix_agent_feedback_session", "session_id"),
    )

    def to_wire(self, answer_brief: str | None = None) -> dict:
        """序列化为前端 ``AgentFeedbackItem`` 契约要求的字典。

        ``answer_brief`` 由服务层按 message_id 读消息内容截断后传入，
        不属于本表列，序列化时并入。

        Returns:
            与 ``frontend/.../types.ts`` 中 ``AgentFeedbackItem`` 接口逐字段对齐的 dict。
        """
        return {
            "id": int(self.id),
            "session_id": self.session_id,
            "message_id": self.message_id,
            "agent_id": self.agent_id,
            "user_id": self.user_id,
            "rating": self.rating,
            "comment": self.comment,
            "status": self.status,
            "handler_id": self.handler_id,
            "handler_name": self.handler_name,
            "note": self.note,
            "processed_at": self.processed_at.isoformat() if self.processed_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "answer_brief": answer_brief,
        }
