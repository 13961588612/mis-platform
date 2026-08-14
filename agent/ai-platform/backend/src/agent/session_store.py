"""会话冷存储（PostgreSQL）—— T04 Q1 方案 B 的双写落地层。

职责边界
--------------------------------
- ``SessionManager``（``src/agent/session.py``）继续独占 **Redis 热路径**，
  Agent 运行时的读写延迟不受影响。
- 本模块只负责 **PG 冷备**：把会话与消息落库，并为运营后台
  （#27–#31）提供 Redis 做不到的分页 / 过滤 / 关键字查询。

为什么把 PG 逻辑单独拆一个模块
--------------------------------
1. ``session.py`` 已经承载了 session_id 命名规范、身份透传、HITL 挂起标记等
   多重职责，再塞进 SQL 会变成难以维护的上帝类；
2. 双写必须**永不阻断热路径**——PG 抖动时 Agent 对话不能挂。把降级逻辑
   （``_guard``）收敛在一个地方，比散落在 ``SessionManager`` 各方法里安全；
3. 路由层（会话列表 / 详情 / 消息）需要直接读 PG，不该被迫走
   ``SessionManager`` 绕一圈。

一致性模型
--------------------------------
Redis 是**权威**，PG 是**投影**。所有写入都是幂等 upsert：

- 会话：``INSERT ... ON CONFLICT (session_id) DO UPDATE``；
- 消息：``INSERT ... ON CONFLICT (id) DO NOTHING``（``Message.id`` 是创建时
  生成的稳定 uuid，重复补写不会产生重复行）。

因此即便某次 PG 写失败被吞掉，下一次 ``save_session`` 会自动把缺失的消息补齐，
最终一致。这也是 ``save_session`` 选择「补写最近 N 条」而不是「只写增量」的原因——
无状态、可自愈，不依赖任何内存里的「已同步指针」（多 worker 场景下那个指针必然失效）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Sequence

from sqlalchemy import Select, case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import Settings, get_settings
from src.db.session import db_session_context
from src.models.agent_feedback import (
    FEEDBACK_RATING_DOWN,
    FEEDBACK_RATING_UP,
    FEEDBACK_STATUS_HANDLED,
    FEEDBACK_STATUS_IGNORED,
    FEEDBACK_STATUS_PENDING,
    AgentFeedbackModel,
)
from src.models.agent_session import (
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_CLOSED,
    AgentSessionMessageModel,
    AgentSessionModel,
)
from src.utils.exceptions import FeedbackNotFoundError, FeedbackStatusIllegalError
from src.utils.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover - 仅用于类型标注，避免与 session.py 循环导入
    from src.agent.session import Message, Session

logger = get_logger("agent.session_store")

#: 允许出现在 wire 上的渠道值，与前端 ``SessionChannel`` 联合类型一一对应。
#: 运行时内部渠道（``wecom_bot`` / ``wecom_h5``）会被归一到 ``wecom``。
WIRE_CHANNELS: frozenset[str] = frozenset({"web", "wecom", "api", "unknown"})

#: 运行时渠道 → 前端 wire 渠道 的归一映射。
_CHANNEL_TO_WIRE: dict[str, str] = {
    "web": "web",
    "wecom": "wecom",
    "wecom_bot": "wecom",
    "wecom_h5": "wecom",
    "api": "api",
    "openapi": "api",
}

#: wire 渠道 → 运行时渠道集合。列表页按 ``wecom`` 过滤时要同时命中
#: ``wecom`` / ``wecom_bot`` / ``wecom_h5``（历史数据可能存的是运行时值）。
_WIRE_TO_STORED: dict[str, tuple[str, ...]] = {
    "web": ("web",),
    "wecom": ("wecom", "wecom_bot", "wecom_h5"),
    "api": ("api", "openapi"),
    "unknown": ("unknown", ""),
}


def normalize_channel(channel: str | None) -> str:
    """把运行时渠道值归一为前端认识的 ``SessionChannel``。

    前端 ``CHANNEL_LABELS`` 只认 ``web | wecom | api | unknown`` 四个值，
    传 ``wecom_bot`` 过去会渲染成空白。归一放在写入侧做，读侧就不用再兜底。

    Args:
        channel: 运行时渠道值，可能为 ``None``。

    Returns:
        四个合法 wire 渠道值之一。
    """
    if not channel:
        return "unknown"
    return _CHANNEL_TO_WIRE.get(channel.strip().lower(), "unknown")


def _utcnow() -> datetime:
    """返回带时区的当前 UTC 时间。"""
    return datetime.now(timezone.utc)


def _as_aware(value: datetime | None) -> datetime:
    """把可能是 naive 的 datetime 补上 UTC 时区。

    Redis 里反序列化出来的时间戳大多带时区，但历史数据可能是 naive 的；
    直接写进 ``TIMESTAMPTZ`` 列会被 PG 按服务器本地时区解释，造成 8 小时偏移。

    Args:
        value: 待规约的时间，可能为 ``None``。

    Returns:
        带 UTC 时区的 datetime；入参为 ``None`` 时返回当前时间。
    """
    if value is None:
        return _utcnow()
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _truncate_title(text: str, max_length: int) -> str:
    """把首条用户消息截断成会话标题。

    Args:
        text: 原始消息正文。
        max_length: 最大保留字符数。

    Returns:
        单行、去掉多余空白、超长加省略号的标题字符串。
    """
    flattened: str = " ".join(text.split())
    if len(flattened) <= max_length:
        return flattened
    return flattened[:max_length] + "…"


@dataclass
class SessionListQuery:
    """会话列表查询条件。

    字段名与前端 ``SessionQuery``（``types.ts``）保持一致，路由层可以直接透传，
    不需要中间改名。
    """

    page: int = 1
    page_size: int = 20
    agent_id: str | None = None
    channel: str | None = None
    user_id: str | None = None
    keyword: str | None = None
    time_from: datetime | None = None
    time_to: datetime | None = None
    include_deleted: bool = False

    def offset(self) -> int:
        """返回 SQL OFFSET 值。"""
        return max(self.page - 1, 0) * self.page_size


@dataclass
class SessionPage:
    """一页会话数据。"""

    items: list[dict[str, Any]] = field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20

    def to_wire(self) -> dict[str, Any]:
        """序列化为前端 ``AgentPage<Session>`` 契约。"""
        return {
            "items": self.items,
            "total": self.total,
            "page": self.page,
            "page_size": self.page_size,
        }


@dataclass
class MessagePage:
    """一页消息数据。"""

    items: list[dict[str, Any]] = field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50

    def to_wire(self) -> dict[str, Any]:
        """序列化为前端 ``AgentPage<SessionMessage>`` 契约。"""
        return {
            "items": self.items,
            "total": self.total,
            "page": self.page,
            "page_size": self.page_size,
        }


@dataclass
class FeedbackQuery:
    """会话反馈列表查询条件（CF-01）。

    字段名与前端 ``AgentFeedbackQuery``（``features/agent/types.ts``）保持一致，
    路由层可以直接透传，不需要中间改名。

    注意：``agent_feedback`` 表**不存渠道**，``channel`` 过滤需要
    LEFT JOIN ``agent_session``，由 :meth:`SessionPgStore.list_feedback` /
    :meth:`SessionPgStore.feedback_stats` 在构造语句时按需 join。
    """

    page: int = 1
    page_size: int = 20
    rating: str | None = None
    comment_only: bool = False
    agent_id: str | None = None
    channel: str | None = None
    time_from: datetime | None = None
    time_to: datetime | None = None
    keyword: str | None = None
    status: str | None = None

    def offset(self) -> int:
        """返回 SQL OFFSET 值。"""
        return max(self.page - 1, 0) * self.page_size


@dataclass
class FeedbackPage:
    """一页会话反馈数据。"""

    items: list[dict[str, Any]] = field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20

    def to_wire(self) -> dict[str, Any]:
        """序列化为前端 ``AgentPage<AgentFeedbackItem>`` 契约。"""
        return {
            "items": self.items,
            "total": self.total,
            "page": self.page,
            "page_size": self.page_size,
        }


class SessionPgStore:
    """会话 / 消息在 PostgreSQL 上的读写实现。

    写方法（``upsert_session`` / ``append_messages`` / ``mark_closed``）在
    PG 异常时**只记日志不抛异常**，保证 Agent 热路径不被冷备拖垮；
    读方法（``list_sessions`` / ``get_session`` / ``list_messages``）由运营后台
    调用，异常会正常抛出，让接口显式报错而不是静默返回空列表。
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """构造冷存储。

        Args:
            settings: 可注入的配置对象，缺省读全局单例（便于测试覆盖）。
        """
        self._settings: Settings = settings or get_settings()

    # ------------------------------------------------------------------
    # 写路径（永不抛异常，失败即降级）
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        """双写开关是否打开。"""
        return bool(getattr(self._settings, "SESSION_PG_DUAL_WRITE_ENABLED", True))

    async def upsert_session(self, session: "Session") -> bool:
        """把会话主记录写入（或更新）``agent_session``。

        标题、消息数、最后活跃时间都在这里一并刷新，因此调用方只要在改动会话后
        调一次本方法即可，不需要关心字段级差异。

        Args:
            session: 运行时会话对象（``src.agent.session.Session``）。

        Returns:
            ``True`` 表示已成功落库；``False`` 表示被开关关闭或写入失败（已降级）。
        """
        if not self.enabled:
            return False
        try:
            async with db_session_context() as db:
                await self._upsert_session_row(db, session)
                await self._insert_messages(db, session.session_id, session.messages)
            return True
        except Exception as exc:  # noqa: BLE001 - 冷备失败必须降级，不能打断对话
            logger.warning(
                "Session PG dual-write failed (degraded, Redis unaffected)",
                session_id=session.session_id,
                error=str(exc),
            )
            return False

    async def mark_closed(self, session_id: str) -> bool:
        """把会话状态标记为 ``closed``（Redis 侧已删除时调用）。

        Args:
            session_id: 会话 ID。

        Returns:
            是否成功写入。
        """
        if not self.enabled:
            return False
        try:
            async with db_session_context() as db:
                await db.execute(
                    update(AgentSessionModel)
                    .where(AgentSessionModel.session_id == session_id)
                    .values(status=SESSION_STATUS_CLOSED, updated_at=_utcnow())
                )
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Mark session closed in PG failed (degraded)",
                session_id=session_id,
                error=str(exc),
            )
            return False

    # ------------------------------------------------------------------
    # 读路径 / 运营写路径（异常向上抛，让接口显式失败）
    # ------------------------------------------------------------------

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        """按 ID 读取单个会话（跳过已软删除的）。

        Args:
            session_id: 会话 ID。

        Returns:
            前端 ``Session`` 契约的 dict；不存在或已删除时返回 ``None``。
        """
        async with db_session_context() as db:
            row: AgentSessionModel | None = await db.scalar(
                select(AgentSessionModel).where(
                    AgentSessionModel.session_id == session_id,
                    AgentSessionModel.deleted_at.is_(None),
                )
            )
            return row.to_wire() if row is not None else None

    async def list_sessions(self, query: SessionListQuery) -> SessionPage:
        """按条件分页查询会话列表。

        Args:
            query: 过滤 + 分页条件。

        Returns:
            一页会话数据（``items`` 已是 wire 形状）。
        """
        async with db_session_context() as db:
            conditions = self._build_conditions(query)

            count_stmt = select(func.count()).select_from(AgentSessionModel)
            for cond in conditions:
                count_stmt = count_stmt.where(cond)
            total: int = int(await db.scalar(count_stmt) or 0)

            list_stmt: Select[Any] = select(AgentSessionModel)
            for cond in conditions:
                list_stmt = list_stmt.where(cond)
            list_stmt = (
                list_stmt.order_by(AgentSessionModel.updated_at.desc())
                .offset(query.offset())
                .limit(query.page_size)
            )
            rows: Sequence[AgentSessionModel] = (await db.scalars(list_stmt)).all()

            return SessionPage(
                items=[row.to_wire() for row in rows],
                total=total,
                page=query.page,
                page_size=query.page_size,
            )

    async def list_messages(
        self,
        session_id: str,
        page: int = 1,
        page_size: int = 50,
    ) -> MessagePage:
        """按会话分页读取消息（时间正序）。

        Args:
            session_id: 会话 ID。
            page: 页码，从 1 开始。
            page_size: 每页条数。

        Returns:
            一页消息数据（``items`` 已是 wire 形状）。
        """
        async with db_session_context() as db:
            total: int = int(
                await db.scalar(
                    select(func.count())
                    .select_from(AgentSessionMessageModel)
                    .where(AgentSessionMessageModel.session_id == session_id)
                )
                or 0
            )
            rows: Sequence[AgentSessionMessageModel] = (
                await db.scalars(
                    select(AgentSessionMessageModel)
                    .where(AgentSessionMessageModel.session_id == session_id)
                    .order_by(
                        AgentSessionMessageModel.timestamp.asc(),
                        AgentSessionMessageModel.seq.asc(),
                    )
                    .offset(max(page - 1, 0) * page_size)
                    .limit(page_size)
                )
            ).all()
            return MessagePage(
                items=[row.to_wire() for row in rows],
                total=total,
                page=page,
                page_size=page_size,
            )

    async def update_message_metadata(
        self,
        message_id: str,
        metadata: dict[str, Any],
    ) -> bool:
        """覆盖一条已落库消息的 ``metadata``（点赞/吐槽写入）。

        ``_insert_messages`` 是 ``ON CONFLICT DO NOTHING``，事后改 metadata
        不会被补写覆盖，必须显式 UPDATE。失败只降级，不抛。

        Args:
            message_id: 消息主键（与运行时 ``Message.id`` 相同）。
            metadata: 完整 metadata（调用方负责 merge，本方法整列替换）。

        Returns:
            是否命中并更新了一行。
        """
        if not self.enabled:
            return False
        try:
            async with db_session_context() as db:
                result = await db.execute(
                    update(AgentSessionMessageModel)
                    .where(AgentSessionMessageModel.id == message_id)
                    .values(metadata_=dict(metadata or {}))
                )
                return int(result.rowcount or 0) > 0
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Update message metadata in PG failed (degraded)",
                message_id=message_id,
                error=str(exc),
            )
            return False

    # ------------------------------------------------------------------
    # 会话反馈运营（CF-01 / CF-03 / CF-05）—— ``agent_feedback`` 独立表
    # ------------------------------------------------------------------

    async def upsert_feedback(
        self,
        *,
        session_id: str,
        message_id: str,
        agent_id: str,
        user_id: str | None,
        rating: str,
        comment: str | None,
    ) -> bool:
        """把一条反馈写入（或覆盖）``agent_feedback``（幂等 upsert，CF-03）。

        用户对同一消息反复点赞/吐槽时，按 UNIQUE(session_id, message_id) 覆盖写，
        **保留**既有处理状态（pending/handled/ignored），只更新评价与时间——
        与 PRD Q-C1「统计按最新值」一致。失败只降级不抛（与 ``update_message_metadata``
        同款热路径保护）。

        Args:
            session_id: 归属会话 ID。
            message_id: 被评价的助手消息 UUID。
            agent_id: 冗余存储的 Agent ID。
            user_id: 冗余存储的用户 ID（可空）。
            rating: ``up`` / ``down``。
            comment: 吐槽说明；点赞可空。

        Returns:
            ``True`` 表示已成功落库；``False`` 表示开关关闭或写入失败（已降级）。
        """
        if not self.enabled:
            return False
        try:
            async with db_session_context() as db:
                table = AgentFeedbackModel.__table__
                stmt = pg_insert(table).values(
                    session_id=session_id,
                    message_id=message_id,
                    agent_id=agent_id or "",
                    user_id=(user_id or "").strip() or None,
                    rating=rating,
                    comment=(comment or "").strip() or None,
                    status=FEEDBACK_STATUS_PENDING,
                    created_at=_utcnow(),
                    updated_at=_utcnow(),
                )
                excluded = stmt.excluded
                stmt = stmt.on_conflict_do_update(
                    index_elements=[table.c.session_id, table.c.message_id],
                    set_={
                        table.c.rating: excluded.rating,
                        table.c.comment: excluded.comment,
                        table.c.updated_at: excluded.updated_at,
                    },
                )
                await db.execute(stmt)
            return True
        except Exception as exc:  # noqa: BLE001 - 冷备失败必须降级，不能打断热路径
            logger.warning(
                "Agent feedback upsert failed (degraded, Redis unaffected)",
                session_id=session_id,
                message_id=message_id,
                error=str(exc),
            )
            return False

    async def list_feedback(self, query: FeedbackQuery) -> FeedbackPage:
        """按条件分页查询会话反馈列表（CF-01，运营读侧权威在 PG）。

        ``channel`` 过滤与 ``agent_name``/``user_name`` 展示字段需要 LEFT JOIN
        ``agent_session``；``answer_brief`` 按 message_id 批量读
        ``agent_session_message.content`` 截断填充（≤60 字）。

        **默认排序**：吐槽且带说明的排最前（运营最需要优先跟进），其余按创建时间
        倒序——与设计 §3.4「默认吐槽+comment 非空优先」一致。

        Args:
            query: 过滤 + 分页条件。

        Returns:
            一页反馈数据（``items`` 已是 wire 形状）。
        """
        async with db_session_context() as db:
            conditions: list[Any] = self._build_feedback_conditions(query)
            need_join: bool = bool(query.channel)

            count_stmt = select(func.count()).select_from(AgentFeedbackModel)
            if need_join:
                count_stmt = count_stmt.join(
                    AgentSessionModel,
                    AgentSessionModel.session_id == AgentFeedbackModel.session_id,
                )
            for cond in conditions:
                count_stmt = count_stmt.where(cond)
            total: int = int(await db.scalar(count_stmt) or 0)

            list_stmt: Select[Any] = select(AgentFeedbackModel)
            if need_join:
                list_stmt = list_stmt.join(
                    AgentSessionModel,
                    AgentSessionModel.session_id == AgentFeedbackModel.session_id,
                )
            for cond in conditions:
                list_stmt = list_stmt.where(cond)
            list_stmt = (
                list_stmt.order_by(
                    case(
                        (
                            (AgentFeedbackModel.rating == FEEDBACK_RATING_DOWN)
                            & AgentFeedbackModel.comment.isnot(None)
                            & (AgentFeedbackModel.comment != ""),
                            0,
                        ),
                        else_=1,
                    ).asc(),
                    AgentFeedbackModel.created_at.desc(),
                )
                .offset(query.offset())
                .limit(query.page_size)
            )
            rows: Sequence[AgentFeedbackModel] = (await db.scalars(list_stmt)).all()

            # 批量补 agent_name / user_name（来自 agent_session，feedback 表不冗余这两列）
            sessions: dict[str, dict[str, Any]] = {}
            session_ids: list[str] = list({row.session_id for row in rows})
            if session_ids:
                session_rows: Sequence[AgentSessionModel] = (
                    await db.scalars(
                        select(AgentSessionModel).where(
                            AgentSessionModel.session_id.in_(session_ids)
                        )
                    )
                ).all()
                sessions = {row.session_id: row.to_wire() for row in session_rows}

            # 批量读消息正文 → answer_brief（截断 ≤60 字）
            answer_briefs: dict[str, str] = {}
            message_ids: list[str] = [
                row.message_id for row in rows if row.message_id
            ]
            if message_ids:
                message_rows: Sequence[AgentSessionMessageModel] = (
                    await db.scalars(
                        select(AgentSessionMessageModel).where(
                            AgentSessionMessageModel.id.in_(message_ids)
                        )
                    )
                ).all()
                for msg_row in message_rows:
                    answer_briefs[msg_row.id] = _truncate_title(
                        msg_row.content or "", 60
                    )

            items: list[dict[str, Any]] = []
            for row in rows:
                item: dict[str, Any] = row.to_wire(
                    answer_brief=answer_briefs.get(row.message_id)
                )
                session_wire: dict[str, Any] | None = sessions.get(row.session_id)
                item["agent_name"] = (
                    session_wire.get("agent_name") if session_wire else None
                )
                item["user_name"] = (
                    session_wire.get("user_name") if session_wire else None
                )
                items.append(item)

            return FeedbackPage(
                items=items,
                total=total,
                page=query.page,
                page_size=query.page_size,
            )

    async def mark_feedback_processed(
        self,
        feedback_id: int,
        status: str,
        handler_id: str | None,
        handler_name: str | None,
        note: str | None,
    ) -> dict[str, Any]:
        """把单条反馈标记为 handled / ignored（CF-03，单向终态）。

        Args:
            feedback_id: 反馈行主键。
            status: 目标状态（handled / ignored）。
            handler_id: 操作人 MIS userId（字符串化，可空）。
            handler_name: 操作人展示名（可空）。
            note: 处理备注（可空）。

        Returns:
            更新后的反馈行 wire dict。

        Raises:
            FeedbackNotFoundError: 反馈不存在（code 2006）。
            FeedbackStatusIllegalError: 已处于另一个终态不可回退，或 status 非法。
        """
        normalized_status: str = (status or "").strip().lower()
        if normalized_status not in (FEEDBACK_STATUS_HANDLED, FEEDBACK_STATUS_IGNORED):
            raise FeedbackStatusIllegalError(
                "pending", normalized_status or "<empty>"
            )

        async with db_session_context() as db:
            row: AgentFeedbackModel | None = await db.scalar(
                select(AgentFeedbackModel).where(
                    AgentFeedbackModel.id == feedback_id
                )
            )
            if row is None:
                raise FeedbackNotFoundError(feedback_id)

            current: str = row.status or FEEDBACK_STATUS_PENDING
            if current in (FEEDBACK_STATUS_HANDLED, FEEDBACK_STATUS_IGNORED):
                # 已处于终态：目标相同 → 幂等成功；目标不同 → 不可回退。
                if current == normalized_status:
                    return row.to_wire()
                raise FeedbackStatusIllegalError(current, normalized_status)

            now: datetime = _utcnow()
            await db.execute(
                update(AgentFeedbackModel)
                .where(AgentFeedbackModel.id == feedback_id)
                .values(
                    status=normalized_status,
                    handler_id=handler_id or None,
                    handler_name=handler_name or None,
                    note=(note or "").strip() or None,
                    processed_at=now,
                    updated_at=now,
                )
            )
            await db.refresh(row)
            return row.to_wire()

    async def batch_mark_feedback_processed(
        self,
        feedback_ids: Sequence[int],
        status: str,
        handler_id: str | None,
        handler_name: str | None,
        note: str | None,
    ) -> int:
        """批量把 pending 反馈标记为 handled / ignored（CF-03）。

        只更新 ``status == pending`` 的行：终态行保持原状（不可回退），
        不存在的 ID 静默跳过。返回实际更新行数。

        Args:
            feedback_ids: 反馈行主键列表（调用方负责去重与上限校验）。
            status: 目标状态（handled / ignored）。
            handler_id: 操作人 MIS userId（字符串化，可空）。
            handler_name: 操作人展示名（可空）。
            note: 处理备注（可空）。

        Returns:
            实际更新的行数。

        Raises:
            FeedbackStatusIllegalError: status 非法。
        """
        normalized_status: str = (status or "").strip().lower()
        if normalized_status not in (FEEDBACK_STATUS_HANDLED, FEEDBACK_STATUS_IGNORED):
            raise FeedbackStatusIllegalError(
                "pending", normalized_status or "<empty>"
            )
        if not feedback_ids:
            return 0

        unique_ids: list[int] = list(dict.fromkeys(int(i) for i in feedback_ids))
        now: datetime = _utcnow()
        async with db_session_context() as db:
            result = await db.execute(
                update(AgentFeedbackModel)
                .where(
                    AgentFeedbackModel.id.in_(unique_ids),
                    AgentFeedbackModel.status == FEEDBACK_STATUS_PENDING,
                )
                .values(
                    status=normalized_status,
                    handler_id=handler_id or None,
                    handler_name=handler_name or None,
                    note=(note or "").strip() or None,
                    processed_at=now,
                    updated_at=now,
                )
            )
            return int(result.rowcount or 0)

    async def feedback_stats(
        self,
        *,
        agent_id: str | None = None,
        channel: str | None = None,
        time_from: datetime | None = None,
        time_to: datetime | None = None,
    ) -> dict[str, Any]:
        """会话反馈统计（CF-05）。

        基础计数（total/up/down/up_rate/down_rate/pending）+ 按 Agent 维度
        （``by_agent``）+ 按日趋势（``by_day``：up/down/comment 量，UTC 日期）。

        Args:
            agent_id: 按 Agent 过滤（可空）。
            channel: 按渠道过滤（可空）。
            time_from: 创建时间下界（可空）。
            time_to: 创建时间上界（可空）。

        Returns:
            前端 ``AgentFeedbackStats`` 契约的 dict。
        """
        async with db_session_context() as db:
            conditions: list[Any] = self._build_feedback_conditions(
                FeedbackQuery(
                    agent_id=agent_id,
                    channel=channel,
                    time_from=time_from,
                    time_to=time_to,
                )
            )
            need_join: bool = bool(channel)
            base = AgentFeedbackModel

            def _apply_join(stmt: Select[Any]) -> Select[Any]:
                """按需 LEFT JOIN agent_session（仅 channel 过滤时需要）。"""
                if not need_join:
                    return stmt
                return stmt.join(
                    AgentSessionModel,
                    AgentSessionModel.session_id == base.session_id,
                )

            count_stmt = _apply_join(
                select(
                    func.count().label("total"),
                    func.sum(
                        case((base.rating == FEEDBACK_RATING_UP, 1), else_=0)
                    ).label("up"),
                    func.sum(
                        case((base.rating == FEEDBACK_RATING_DOWN, 1), else_=0)
                    ).label("down"),
                    func.sum(
                        case((base.status == FEEDBACK_STATUS_PENDING, 1), else_=0)
                    ).label("pending"),
                ).select_from(base)
            )
            for cond in conditions:
                count_stmt = count_stmt.where(cond)
            count_row = (await db.execute(count_stmt)).one()

            total: int = int(count_row.total or 0)
            up: int = int(count_row.up or 0)
            down: int = int(count_row.down or 0)
            pending: int = int(count_row.pending or 0)

            # 按 Agent 维度
            agent_stmt = _apply_join(
                select(
                    base.agent_id,
                    func.count().label("total"),
                    func.sum(
                        case((base.rating == FEEDBACK_RATING_UP, 1), else_=0)
                    ).label("up"),
                    func.sum(
                        case((base.rating == FEEDBACK_RATING_DOWN, 1), else_=0)
                    ).label("down"),
                )
            )
            for cond in conditions:
                agent_stmt = agent_stmt.where(cond)
            agent_stmt = agent_stmt.group_by(base.agent_id)
            agent_rows = (await db.execute(agent_stmt)).all()

            by_agent: dict[str, dict[str, Any]] = {}
            for agent_row in agent_rows:
                agent_total: int = int(agent_row.total or 0)
                agent_up: int = int(agent_row.up or 0)
                agent_down: int = int(agent_row.down or 0)
                by_agent[str(agent_row.agent_id or "")] = {
                    "total": agent_total,
                    "up": agent_up,
                    "down": agent_down,
                    "up_rate": (
                        round(agent_up / agent_total, 4) if agent_total else 0.0
                    ),
                    "down_rate": (
                        round(agent_down / agent_total, 4) if agent_total else 0.0
                    ),
                }

            # 按日趋势（UTC 日期，避免服务器时区造成 8 小时漂移）
            day_col = func.date(func.timezone("UTC", base.created_at))
            day_stmt = _apply_join(
                select(
                    day_col.label("day"),
                    func.sum(
                        case((base.rating == FEEDBACK_RATING_UP, 1), else_=0)
                    ).label("up"),
                    func.sum(
                        case((base.rating == FEEDBACK_RATING_DOWN, 1), else_=0)
                    ).label("down"),
                    func.sum(
                        case(
                            (
                                base.comment.isnot(None)
                                & (base.comment != ""),
                                1,
                            ),
                            else_=0,
                        )
                    ).label("comment"),
                )
            )
            for cond in conditions:
                day_stmt = day_stmt.where(cond)
            day_stmt = day_stmt.group_by(day_col).order_by(day_col)
            day_rows = (await db.execute(day_stmt)).all()

            by_day: dict[str, dict[str, int]] = {}
            for day_row in day_rows:
                day_text: str = str(day_row.day or "")
                if not day_text:
                    continue
                by_day[day_text] = {
                    "up": int(day_row.up or 0),
                    "down": int(day_row.down or 0),
                    "comment": int(day_row.comment or 0),
                }

            return {
                "total": total,
                "up": up,
                "down": down,
                "up_rate": round(up / total, 4) if total else 0.0,
                "down_rate": round(down / total, 4) if total else 0.0,
                "pending": pending,
                "by_agent": by_agent,
                "by_day": by_day,
            }

    async def soft_delete(self, session_ids: Sequence[str]) -> int:
        """软删除若干会话（置 ``deleted_at``，保留消息用于审计）。

        选软删除而非物理删除的原因：运营后台的删除按钮是高危操作，
        误点后如果直接 ``DELETE`` 级联清掉消息，任何审计追溯都做不了。

        Args:
            session_ids: 待删除的会话 ID 列表。

        Returns:
            实际被标记删除的行数（已删过的不重复计数）。
        """
        if not session_ids:
            return 0
        now: datetime = _utcnow()
        async with db_session_context() as db:
            result = await db.execute(
                update(AgentSessionModel)
                .where(
                    AgentSessionModel.session_id.in_(list(session_ids)),
                    AgentSessionModel.deleted_at.is_(None),
                )
                .values(deleted_at=now, status=SESSION_STATUS_CLOSED, updated_at=now)
            )
            return int(result.rowcount or 0)

    async def purge(self, session_ids: Sequence[str]) -> int:
        """物理删除会话及其消息（外键 CASCADE）。

        仅供数据清理脚本 / 测试使用，运营后台的删除走 :meth:`soft_delete`。

        Args:
            session_ids: 待物理删除的会话 ID 列表。

        Returns:
            实际删除的会话行数。
        """
        if not session_ids:
            return 0
        async with db_session_context() as db:
            result = await db.execute(
                delete(AgentSessionModel).where(
                    AgentSessionModel.session_id.in_(list(session_ids))
                )
            )
            return int(result.rowcount or 0)

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------

    def _build_conditions(self, query: SessionListQuery) -> list[Any]:
        """把 :class:`SessionListQuery` 翻译成 SQLAlchemy 过滤条件列表。

        Args:
            query: 查询条件。

        Returns:
            可逐个 ``.where()`` 应用的条件列表（count 与 list 复用同一份，
            保证 total 与 items 永远同源，不会出现「总数 30 但翻到第 2 页没数据」）。
        """
        conditions: list[Any] = []
        if not query.include_deleted:
            conditions.append(AgentSessionModel.deleted_at.is_(None))
        if query.agent_id:
            conditions.append(AgentSessionModel.agent_id == query.agent_id)
        if query.user_id:
            conditions.append(AgentSessionModel.user_id == query.user_id)
        if query.channel:
            stored: tuple[str, ...] = _WIRE_TO_STORED.get(
                query.channel, (query.channel,)
            )
            conditions.append(AgentSessionModel.channel.in_(list(stored)))
        if query.time_from is not None:
            conditions.append(AgentSessionModel.created_at >= _as_aware(query.time_from))
        if query.time_to is not None:
            conditions.append(AgentSessionModel.created_at <= _as_aware(query.time_to))
        if query.keyword:
            pattern: str = f"%{query.keyword.strip()}%"
            conditions.append(
                AgentSessionModel.title.ilike(pattern)
                | AgentSessionModel.session_id.ilike(pattern)
                | AgentSessionModel.user_id.ilike(pattern)
            )
        return conditions

    def _build_feedback_conditions(self, query: FeedbackQuery) -> list[Any]:
        """把 :class:`FeedbackQuery` 翻译成 SQLAlchemy 过滤条件列表。

        count / list / stats 复用同一份条件，保证 total 与 items 永远同源。
        ``channel`` 条件引用 ``agent_session`` 列，调用方在构造语句时须按需
        LEFT JOIN ``agent_session``（feedback 表不存渠道）。
        """
        conditions: list[Any] = []
        if query.rating:
            conditions.append(
                AgentFeedbackModel.rating == query.rating.strip().lower()
            )
        if query.comment_only:
            conditions.append(
                AgentFeedbackModel.comment.isnot(None)
                & (AgentFeedbackModel.comment != "")
            )
        if query.agent_id:
            conditions.append(AgentFeedbackModel.agent_id == query.agent_id)
        if query.channel:
            stored: tuple[str, ...] = _WIRE_TO_STORED.get(
                query.channel, (query.channel,)
            )
            conditions.append(AgentSessionModel.channel.in_(list(stored)))
        if query.time_from is not None:
            conditions.append(
                AgentFeedbackModel.created_at >= _as_aware(query.time_from)
            )
        if query.time_to is not None:
            conditions.append(
                AgentFeedbackModel.created_at <= _as_aware(query.time_to)
            )
        if query.status:
            conditions.append(
                AgentFeedbackModel.status == query.status.strip().lower()
            )
        if query.keyword:
            pattern: str = f"%{query.keyword.strip()}%"
            conditions.append(AgentFeedbackModel.comment.ilike(pattern))
        return conditions

    async def _upsert_session_row(self, db: AsyncSession, session: "Session") -> None:
        """执行会话主记录的幂等 upsert。

        Args:
            db: 已开启的异步 DB Session。
            session: 运行时会话对象。
        """
        created_at: datetime = _as_aware(getattr(session, "created_at", None))
        updated_at: datetime = _as_aware(getattr(session, "updated_at", None))
        messages: list["Message"] = list(getattr(session, "messages", []) or [])
        title: str | None = self._derive_title(messages)

        values: dict[str, Any] = {
            "session_id": session.session_id,
            "agent_id": session.agent_id or "",
            "agent_name": getattr(session, "agent_name", None),
            "channel": normalize_channel(session.channel),
            "user_id": session.user_id or None,
            "user_name": getattr(session, "user_name", None)
            or (str(session.user_mobile) if getattr(session, "user_mobile", "") else None),
            "title": title,
            "status": SESSION_STATUS_ACTIVE,
            "message_count": len(messages),
            "runtime_type": getattr(session, "runtime_type", None),
            # 注意：本语句是针对 __table__ 构建的 Core insert，键名用**列名**
            # ``metadata``（Declarative 的 Column.key 就是列名，Python 侧的
            # ``metadata_`` 只是 ORM 属性别名，在 Core 层解析不到）。
            "metadata": self._build_metadata(session),
            "created_at": created_at,
            "updated_at": updated_at,
            "last_activity_at": updated_at,
        }

        table = AgentSessionModel.__table__
        stmt = pg_insert(table).values(**values)
        excluded = stmt.excluded
        # created_at 不参与更新：首次落库时间才是会话真实创建时间。
        # agent_name / user_name / title 用 COALESCE 保护：
        # 一旦有了值就不让后续的 NULL 把它冲掉（消息被裁剪、身份未解析都会产生 NULL）。
        stmt = stmt.on_conflict_do_update(
            index_elements=[table.c.session_id],
            set_={
                table.c.agent_id: excluded.agent_id,
                table.c.agent_name: func.coalesce(
                    excluded.agent_name, table.c.agent_name
                ),
                table.c.channel: excluded.channel,
                table.c.user_id: func.coalesce(excluded.user_id, table.c.user_id),
                table.c.user_name: func.coalesce(excluded.user_name, table.c.user_name),
                table.c.title: func.coalesce(excluded.title, table.c.title),
                table.c.status: excluded.status,
                table.c.message_count: excluded.message_count,
                table.c.runtime_type: excluded.runtime_type,
                table.c.metadata: excluded.metadata,
                table.c.updated_at: excluded.updated_at,
                table.c.last_activity_at: excluded.last_activity_at,
            },
        )
        await db.execute(stmt)

    async def _insert_messages(
        self,
        db: AsyncSession,
        session_id: str,
        messages: Sequence["Message"],
    ) -> None:
        """批量补写消息（``ON CONFLICT (id) DO NOTHING``，天然幂等）。

        Args:
            db: 已开启的异步 DB Session。
            session_id: 归属会话 ID。
            messages: 运行时消息对象列表（按时间正序）。
        """
        if not messages:
            return

        limit: int = int(getattr(self._settings, "SESSION_PG_MESSAGE_SYNC_LIMIT", 500))
        total: int = len(messages)
        start: int = max(total - limit, 0)

        rows: list[dict[str, Any]] = []
        for index in range(start, total):
            msg: "Message" = messages[index]
            msg_id: str = getattr(msg, "id", "") or ""
            if not msg_id:
                # 没有稳定 id 的消息无法保证幂等，跳过而不是造一个新 uuid ——
                # 否则每次 save_session 都会重复插入同一条消息。
                continue
            rows.append(
                {
                    "id": msg_id,
                    "session_id": session_id,
                    "role": getattr(msg, "role", "") or "unknown",
                    "content": getattr(msg, "content", "") or "",
                    # 同上：Core insert 用列名 metadata（不是 ORM 属性名 metadata_）。
                    "metadata": dict(getattr(msg, "metadata", None) or {}),
                    "timestamp": _as_aware(getattr(msg, "timestamp", None)),
                    "seq": index,
                }
            )

        if not rows:
            return

        message_table = AgentSessionMessageModel.__table__
        stmt = pg_insert(message_table).values(rows)
        stmt = stmt.on_conflict_do_nothing(index_elements=[message_table.c.id])
        await db.execute(stmt)

    def _derive_title(self, messages: Sequence["Message"]) -> str | None:
        """从首条 user 消息推导会话标题。

        Args:
            messages: 会话消息列表。

        Returns:
            截断后的标题；没有可用 user 消息时返回 ``None``
            （交由 upsert 的 COALESCE 保留旧标题）。
        """
        max_length: int = int(getattr(self._settings, "SESSION_TITLE_MAX_LENGTH", 60))
        for msg in messages:
            if getattr(msg, "role", "") != "user":
                continue
            content: str = (getattr(msg, "content", "") or "").strip()
            if content:
                return _truncate_title(content, max_length)
        return None

    def _build_metadata(self, session: "Session") -> dict[str, Any]:
        """收集需要落库的会话扩展字段。

        故意**不落** ``state``：里面可能含 HITL resume_token 等敏感中间态，
        且体积不可控；冷备只保留排障必需的身份线索。

        Args:
            session: 运行时会话对象。

        Returns:
            可直接写入 JSONB 列的字典。
        """
        metadata: dict[str, Any] = {}
        mis_user_id: Any = getattr(session, "mis_user_id", None)
        if mis_user_id is not None:
            metadata["mis_user_id"] = mis_user_id
        channel_user_id: str = getattr(session, "channel_user_id", "") or ""
        if channel_user_id:
            metadata["channel_user_id"] = channel_user_id
        raw_channel: str = getattr(session, "channel", "") or ""
        if raw_channel and normalize_channel(raw_channel) != raw_channel:
            # 归一后丢失了原始渠道信息，留一份在 metadata 里方便排障。
            metadata["raw_channel"] = raw_channel
        return metadata


# ----------------------------------------------------------------------
# 单例
# ----------------------------------------------------------------------

_session_pg_store: SessionPgStore | None = None


def get_session_pg_store() -> SessionPgStore:
    """返回单例 :class:`SessionPgStore`。"""
    global _session_pg_store
    if _session_pg_store is None:
        _session_pg_store = SessionPgStore()
    return _session_pg_store


def reset_session_pg_store() -> None:
    """重置单例（供测试隔离使用）。"""
    global _session_pg_store
    _session_pg_store = None
