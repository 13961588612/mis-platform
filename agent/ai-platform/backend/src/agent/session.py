"""会话管理 — 创建、恢复、持久化。

实现 session_id 命名规范（v1.4.1）：
  web-{uuid} / wecom-bot-{uuid} / wecom-h5-{uuid}

存储模型（T04 Q1 方案 B：双写）
--------------------------------
- **Redis 是权威热存储**（TTL 24 小时）：所有运行时读写走这里，延迟不变。
- **PostgreSQL 是冷备投影**：``agent_session`` / ``agent_session_message`` 两张表，
  由 :mod:`src.agent.session_store` 负责落库，供运营后台做列表 / 详情 / 消息回溯。

改造前这个模块的 docstring 就写着「PostgreSQL 作为备份」，但代码从没写过 PG——
TTL 一过历史就没了。本次把双写真正接上，并保证：

1. **热路径零阻断**：PG 写失败只打 WARNING 并降级，绝不向上抛异常打断对话；
2. **幂等**：会话 upsert、消息 ``ON CONFLICT DO NOTHING``，重复写不产生脏数据；
3. **可关闭**：``SESSION_PG_DUAL_WRITE_ENABLED=false`` 即退回纯 Redis 行为。
"""

from __future__ import annotations
from typing import Any, Sequence

import json
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis

from src.agent.session_store import (
    FeedbackPage,
    FeedbackQuery,
    MessagePage,
    SessionListQuery,
    SessionPage,
    SessionPgStore,
    get_session_pg_store,
)
from src.config import get_settings
from src.utils.exceptions import SessionNotFoundError
from src.utils.logging import get_logger

logger = get_logger("agent.session")

# 渠道到 session_id 前缀的映射
CHANNEL_PREFIXES: dict[str, str] = {
    "web": "web-",
    "wecom_h5": "wecom-h5-",
    "wecom_bot": "wecom-bot-",
}


def _coerce_mis_user_id(value: Any) -> int | None:
    """把 Redis 反序列化出的 ``mis_user_id`` 规约为 ``int | None``（T03 S9）。

    历史会话没有该字段 → ``None``；非法值也归 ``None``（fail-closed，
    下游判权时视为无身份而非猜一个 userId）。

    Args:
        value: JSON 反序列化后的原始值。

    Returns:
        正整数或 ``None``。
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed: int = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


class Message:
    """会话中的单条消息。"""

    def __init__(
        self,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
        message_id: str | None = None,
    ) -> None:
        """构造一条会话消息。

        Args:
            role: 消息角色（如 ``user``、``assistant``）。
            content: 消息正文。
            metadata: 可选的附加元数据。
            message_id: 可选的消息 UUID；不传则自动生成。2.1 用于让计时
                按轮（turn_key=该 id）落库，前端可按 ``message.id`` 逐条映射。
        """
        self.id: str = message_id or str(uuid.uuid4())
        self.role = role
        self.content = content
        self.metadata = metadata or {}
        self.timestamp = datetime.now(timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        """将消息序列化为字典。"""
        return {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Message:
        """从字典反序列化消息。"""
        msg: Any = cls(
            role=data["role"],
            content=data["content"],
            metadata=data.get("metadata", {}),
        )
        msg.id = data.get("id", str(uuid.uuid4()))
        if data.get("timestamp"):
            msg.timestamp = datetime.fromisoformat(data["timestamp"])
        return msg


class Session:
    """表示用户与 Agent 之间的聊天会话。"""

    def __init__(
        self,
        session_id: str,
        agent_id: str,
        user_id: str,
        channel: str,
        runtime_type: str = "openharness",
        user_mobile: str = "",
        channel_user_id: str = "",
        mis_user_id: int | None = None,
        user_name: str = "",
    ) -> None:
        """构造会话对象（尚未持久化）。

        Args:
            session_id: 渠道规范化的会话 ID。
            agent_id: 绑定的 Agent ID。
            user_id: 用户 ID。
            channel: 接入渠道（web / wecom_h5 / wecom_bot 等）。
            runtime_type: 运行时类型标识。
            user_mobile: 用户手机号（可选）。
            channel_user_id: 渠道侧 userId（可选）。
            mis_user_id: MIS userId（T03 S9 第五键起点）。会话创建点解析一次、
                全链透传；``None`` 表示解析不出 → 下游 E1–E5 fail-closed 拒绝。
                **绝不**用 ``user_id`` / ``channel_user_id`` 回退填充。
            user_name: 用户展示名（运营台 Web 对话由 BFF 注入 username）。
        """
        self.session_id = session_id
        self.agent_id = agent_id
        self.user_id = user_id
        self.channel = channel
        self.runtime_type = runtime_type
        self.user_mobile = user_mobile
        self.channel_user_id = channel_user_id
        self.mis_user_id: int | None = mis_user_id
        self.user_name = user_name or ""
        self.messages: list[Message] = []
        self.state: dict[str, Any] = {}
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)

    def add_message(
        self,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
        message_id: str | None = None,
    ) -> Message:
        """向会话中添加一条消息。

        Args:
            role: 消息角色。
            content: 消息正文。
            metadata: 可选元数据。
            message_id: 可选消息 UUID（2.1：与 process_message 的 turn_key 复用，
                使计时能按该条 assistant 消息逐条映射）。
        """
        msg: Message = Message(role=role, content=content, metadata=metadata, message_id=message_id)
        self.messages.append(msg)
        self.updated_at = datetime.now(timezone.utc)
        return msg

    def get_messages(self) -> list[dict[str, Any]]:
        """以字典列表形式返回所有消息。"""
        return [msg.to_dict() for msg in self.messages]

    def find_assistant_message(
        self,
        message_id: str | None = None,
        content: str | None = None,
    ) -> Message | None:
        """定位一条助手消息，供点赞/吐槽写入 metadata。

        前端流式气泡的 id 与 Redis 里的 ``Message.id`` 不是同一套，
        所以匹配顺序是：后端 id → 正文精确匹配 → 最近一条助手消息。

        Args:
            message_id: 后端消息 UUID；H5 实时气泡通常拿不到。
            content: 助手正文，用于对齐前端那一条气泡。

        Returns:
            命中的消息；会话里还没有助手回复时返回 ``None``。
        """
        if message_id:
            for msg in self.messages:
                if msg.role == "assistant" and msg.id == message_id:
                    return msg
        needle = (content or "").strip()
        if needle:
            for msg in reversed(self.messages):
                if msg.role == "assistant" and (msg.content or "").strip() == needle:
                    return msg
        for msg in reversed(self.messages):
            if msg.role == "assistant":
                return msg
        return None

    # ===== FormFill HITL 挂起标记（T05） =====
    # session.state 持久化，随会话 24h TTL；此处额外记录 30min 过期时间，
    # 过期后 get_pending_formfill 返回 None，避免恢复已失效的 HITL 任务。

    def set_pending_formfill(self, resume_token: str, ttl_seconds: int = 1800) -> None:
        """记录当前会话挂起的表单填充任务令牌（TTL 默认 30 分钟）。"""
        from datetime import datetime, timedelta, timezone

        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
        self.state["pending_formfill"] = {
            "resume_token": resume_token,
            "expires_at": expires_at.isoformat(),
        }

    def get_pending_formfill(self) -> str | None:
        """返回有效的挂起表单填充令牌；已过期或不存在则返回 None。"""
        from datetime import datetime, timezone

        pending = self.state.get("pending_formfill")
        if not isinstance(pending, dict):
            return None
        expires_at = pending.get("expires_at")
        if expires_at:
            try:
                if datetime.fromisoformat(expires_at) < datetime.now(timezone.utc):
                    self.state.pop("pending_formfill", None)
                    return None
            except (ValueError, TypeError):
                self.state.pop("pending_formfill", None)
                return None
        return pending.get("resume_token")

    def clear_pending_formfill(self) -> None:
        """清除挂起的表单填充标记。"""
        self.state.pop("pending_formfill", None)

    def to_dict(self) -> dict[str, Any]:
        """将会话序列化为字典。"""
        return {
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "user_id": self.user_id,
            "channel": self.channel,
            "runtime_type": self.runtime_type,
            "user_mobile": self.user_mobile,
            "channel_user_id": self.channel_user_id,
            "mis_user_id": self.mis_user_id,
            "user_name": self.user_name,
            "messages": self.get_messages(),
            "state": self.state,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class SessionManager:
    """
    管理会话生命周期：创建、恢复、持久化。

    使用 Redis 作为主要存储（TTL 24 小时）以实现快速访问，
    将 PostgreSQL 作为持久化备份用于长期存储（见 :class:`SessionPgStore`）。

    双写发生在三个写入点：:meth:`create_session`、:meth:`ensure_session`、
    :meth:`save_session`。由于 :meth:`add_message` 内部调用 ``save_session``，
    消息也自动被覆盖，调用方无需改动任何现有代码。
    """

    def __init__(self, pg_store: SessionPgStore | None = None) -> None:
        """初始化会话管理器（Redis 连接懒创建）。

        Args:
            pg_store: 可注入的 PG 冷存储实现，缺省取全局单例。测试里传入
                替身即可在不连库的情况下断言双写行为。
        """
        self._redis: aioredis.Redis | None = None
        self._settings = get_settings()
        self._session_ttl = 86400  # 24 小时
        self._pg_store: SessionPgStore = pg_store or get_session_pg_store()

    @property
    def pg_store(self) -> SessionPgStore:
        """返回底层 PG 冷存储（路由层做列表 / 详情查询时直接用）。"""
        return self._pg_store

    async def _dual_write(self, session: Session) -> None:
        """把会话投影到 PG。失败只降级，不抛异常（热路径保护）。

        Args:
            session: 刚写入 Redis 的会话对象。
        """
        try:
            await self._pg_store.upsert_session(session)
        except Exception as exc:  # noqa: BLE001 - 双保险：store 内部已兜底，这里再兜一层
            logger.warning(
                "Session dual-write raised unexpectedly (degraded)",
                session_id=session.session_id,
                error=str(exc),
            )

    async def _get_redis(self) -> aioredis.Redis:
        """获取或创建 Redis 连接。"""
        if self._redis is None:
            self._redis = aioredis.from_url(
                self._settings.redis_url,
                max_connections=self._settings.REDIS_MAX_CONNECTIONS,
                decode_responses=True,
            )
        return self._redis

    def _session_key(self, session_id: str) -> str:
        """会话数据的 Redis key。"""
        return f"{self._settings.REDIS_KEY_PREFIX}session:{session_id}"

    def _agent_binding_key(self, session_id: str) -> str:
        """会话→agent 绑定的 Redis key。"""
        return f"{self._settings.REDIS_KEY_PREFIX}session:{session_id}:agent_binding"

    async def create_session(
        self,
        agent_id: str,
        user_id: str,
        channel: str,
        runtime_type: str = "openharness",
        user_mobile: str = "",
        channel_user_id: str = "",
        mis_user_id: int | None = None,
        user_name: str = "",
    ) -> Session:
        """
        使用渠道特定的 ID 命名规范创建一个新会话。

        会话 ID 格式：{channel_prefix}{uuid}
        示例：web-{uuid}、wecom-h5-{uuid}、wecom-bot-{uuid}

        Args:
            agent_id: 绑定的 Agent ID。
            user_id: 用户 ID。
            channel: 接入渠道。
            runtime_type: 运行时类型标识。
            user_mobile: 用户手机号（T03 gap 修复：此前漏传，导致 MCP 身份缺字段）。
            channel_user_id: 渠道侧 userId（同上）。
            mis_user_id: MIS userId（T03 S9 第五键）；由调用方在会话创建点解析。
            user_name: 用户展示名（运营台 Web 由 BFF 注入）。

        Returns:
            已写入 Redis 的新会话。
        """
        prefix: str = CHANNEL_PREFIXES.get(channel, f"{channel}-")
        session_id: str = f"{prefix}{uuid.uuid4()}"

        session: Session = Session(
            session_id=session_id,
            agent_id=agent_id,
            user_id=user_id,
            channel=channel,
            runtime_type=runtime_type,
            user_mobile=user_mobile,
            channel_user_id=channel_user_id,
            mis_user_id=mis_user_id,
            user_name=user_name,
        )

        # 存储到 Redis
        redis: aioredis.Redis = await self._get_redis()
        await redis.set(
            self._session_key(session_id),
            json.dumps(session.to_dict()),
            ex=self._session_ttl,
        )

        # 设置 agent 绑定
        await redis.set(
            self._agent_binding_key(session_id),
            agent_id,
            ex=self._session_ttl,
        )

        # PG 冷备：创建即落库，保证运营后台能立刻看到「进行中」的空会话，
        # 而不是等第一条消息到达才出现。
        await self._dual_write(session)

        logger.info(
            "Session created",
            session_id=session_id,
            agent_id=agent_id,
            user_id=user_id,
            channel=channel,
            mis_user_id=mis_user_id,
        )
        return session

    async def ensure_session(
        self,
        session_id: str,
        agent_id: str,
        user_id: str,
        channel: str,
        runtime_type: str = "openharness",
        user_mobile: str = "",
        channel_user_id: str = "",
        mis_user_id: int | None = None,
        user_name: str = "",
    ) -> Session:
        """按给定 session_id 获取会话；不存在则创建（Gateway 稳定会话场景）。

        Args:
            session_id: Gateway 侧稳定会话 ID。
            agent_id: 绑定的 Agent ID。
            user_id: 用户 ID。
            channel: 接入渠道。
            runtime_type: 运行时类型标识。
            user_mobile: 用户手机号。
            channel_user_id: 渠道侧 userId。
            mis_user_id: MIS userId（T03 S9）；非 ``None`` 时刷新到既有会话。
            user_name: 用户展示名；非空时刷新到既有会话。

        Returns:
            既有或新建的会话。
        """
        try:
            session: Session = await self.get_session(session_id)
            # 刷新渠道身份（每条入站消息可能更新）
            changed: bool = False
            if user_id and session.user_id != user_id:
                session.user_id = user_id
                changed = True
            if channel and session.channel != channel:
                session.channel = channel
                changed = True
            if user_mobile and session.user_mobile != user_mobile:
                session.user_mobile = user_mobile
                changed = True
            if channel_user_id and session.channel_user_id != channel_user_id:
                session.channel_user_id = channel_user_id
                changed = True
            if user_name and session.user_name != user_name:
                session.user_name = user_name
                changed = True
            # T03 S9：mis_user_id 仅在解析出真值时刷新；
            # 解析不出（None）不得把既有值清空，也不得回退 user_id。
            if mis_user_id is not None and session.mis_user_id != mis_user_id:
                session.mis_user_id = mis_user_id
                changed = True
            if changed:
                await self.save_session(session)
            return session
        except SessionNotFoundError:
            pass

        session = Session(
            session_id=session_id,
            agent_id=agent_id,
            user_id=user_id,
            channel=channel,
            runtime_type=runtime_type,
            user_mobile=user_mobile,
            channel_user_id=channel_user_id,
            mis_user_id=mis_user_id,
            user_name=user_name,
        )
        redis: aioredis.Redis = await self._get_redis()
        await redis.set(
            self._session_key(session_id),
            json.dumps(session.to_dict()),
            ex=self._session_ttl,
        )
        await redis.set(
            self._agent_binding_key(session_id),
            agent_id,
            ex=self._session_ttl,
        )
        await self._dual_write(session)
        logger.info(
            "Session ensured (created)",
            session_id=session_id,
            agent_id=agent_id,
            user_id=user_id,
            channel=channel,
        )
        return session

    async def get_session(self, session_id: str) -> Session:
        """按 ID 从 Redis 中获取会话。"""
        redis: aioredis.Redis = await self._get_redis()
        data: str | None = await redis.get(self._session_key(session_id))

        if data is None:
            raise SessionNotFoundError(session_id)

        session_data: Any = json.loads(data)
        session: Session = Session(
            session_id=session_data["session_id"],
            agent_id=session_data["agent_id"],
            user_id=session_data["user_id"],
            channel=session_data["channel"],
            runtime_type=session_data.get("runtime_type", "openharness"),
            user_mobile=session_data.get("user_mobile", "") or "",
            channel_user_id=session_data.get("channel_user_id", "") or "",
            mis_user_id=_coerce_mis_user_id(session_data.get("mis_user_id")),
            user_name=session_data.get("user_name", "") or "",
        )
        session.messages = [
            Message.from_dict(msg) for msg in session_data.get("messages", [])
        ]
        session.state = session_data.get("state", {})
        session.created_at = datetime.fromisoformat(session_data["created_at"])
        session.updated_at = datetime.fromisoformat(session_data["updated_at"])
        return session

    async def save_session(self, session: Session) -> None:
        """将会话持久化到 Redis，并投影一份到 PG（双写）。

        这是全平台最高频的会话写入点（``add_message`` / inbound_worker /
        formfill / coordinator 全部经由此处），所以双写挂在这里能覆盖所有
        新增消息，不需要逐个改调用方。

        Args:
            session: 待持久化的会话对象。
        """
        redis: aioredis.Redis = await self._get_redis()
        session.updated_at = datetime.now(timezone.utc)
        await redis.set(
            self._session_key(session.session_id),
            json.dumps(session.to_dict()),
            ex=self._session_ttl,
        )
        await self._dual_write(session)

    async def get_agent_binding(self, session_id: str) -> str | None:
        """获取会话绑定的 agent ID（用于会话亲和路由）。"""
        redis: aioredis.Redis = await self._get_redis()
        return await redis.get(self._agent_binding_key(session_id))

    async def set_agent_binding(self, session_id: str, agent_id: str) -> None:
        """将会话绑定到一个 agent（用于会话亲和路由）。"""
        redis: aioredis.Redis = await self._get_redis()
        await redis.set(
            self._agent_binding_key(session_id),
            agent_id,
            ex=self._session_ttl,
        )

    async def close_session(self, session_id: str) -> None:
        """关闭一个会话：从 Redis 移除，并把 PG 里的状态标成 ``closed``。

        注意 PG 侧**不删数据**——关闭只是结束热会话，历史消息要留给运营后台回溯。
        真正的「删除」是 :meth:`delete_sessions`（软删除）。

        Args:
            session_id: 会话 ID。
        """
        redis: aioredis.Redis = await self._get_redis()
        await redis.delete(self._session_key(session_id))
        await redis.delete(self._agent_binding_key(session_id))
        try:
            await self._pg_store.mark_closed(session_id)
        except Exception as exc:  # noqa: BLE001 - 关闭失败不应让接口报错
            logger.warning(
                "Mark session closed in PG raised unexpectedly (degraded)",
                session_id=session_id,
                error=str(exc),
            )
        logger.info("Session closed", session_id=session_id)

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
        message_id: str | None = None,
    ) -> Message:
        """向现有会话添加一条消息并持久化（Redis + PG 双写）。

        Args:
            session_id: 会话 ID。
            role: 消息角色。
            content: 消息正文。
            metadata: 可选元数据。
            message_id: 可选消息 UUID（2.1：与 process_message 的 turn_key 复用，
                使计时能按该条 assistant 消息逐条映射）。

        Returns:
            新创建的消息对象。
        """
        session: Session = await self.get_session(session_id)
        msg: Message = session.add_message(role, content, metadata, message_id)
        await self.save_session(session)
        return msg

    async def set_message_feedback(
        self,
        session_id: str,
        rating: str,
        comment: str | None = None,
        message_id: str | None = None,
        content: str | None = None,
    ) -> dict[str, Any]:
        """给一条助手消息写入点赞/吐槽，Redis 权威、PG 尽力同步 metadata。

        Args:
            session_id: 会话 ID。
            rating: ``up`` 或 ``down``。
            comment: 吐槽正文；点赞可空。
            message_id: 后端消息 UUID（可选）。
            content: 助手正文，用于对齐前端气泡（可选）。

        Returns:
            写入后的 ``feedback`` 字典（含 ``message_id``）。

        Raises:
            SessionNotFoundError: 会话不存在。
            ValueError: 还没有助手消息可评价。
        """
        session: Session = await self.get_session(session_id)
        target = session.find_assistant_message(message_id=message_id, content=content)
        if target is None:
            raise ValueError("还没有可评价的回答")
        payload: dict[str, Any] = {
            "rating": rating,
            "comment": (comment or "").strip() or None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        meta = dict(target.metadata or {})
        meta["feedback"] = payload
        target.metadata = meta
        session.updated_at = datetime.now(timezone.utc)
        await self.save_session(session)
        try:
            await self._pg_store.update_message_metadata(target.id, meta)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Message feedback PG metadata update failed (degraded)",
                session_id=session_id,
                message_id=target.id,
                error=str(exc),
            )
        # CF-03：同步 upsert agent_feedback 独立表（运营读侧权威；尽力而为）。
        # 用户覆盖写（up→down）时按 UNIQUE(session_id, message_id) 更新最新值，
        # 处理状态保留——与 PRD Q-C1「统计按最新值」一致。
        try:
            await self._pg_store.upsert_feedback(
                session_id=session_id,
                message_id=target.id,
                agent_id=session.agent_id,
                user_id=session.user_id
                or (str(session.mis_user_id) if session.mis_user_id else None),
                rating=rating,
                comment=(comment or "").strip() or None,
            )
        except Exception as exc:  # noqa: BLE001 - 双保险：store 内部已兜底，这里再兜一层
            logger.warning(
                "Agent feedback table upsert raised unexpectedly (degraded)",
                session_id=session_id,
                message_id=target.id,
                error=str(exc),
            )
        return {"message_id": target.id, **payload}

    # ==================================================================
    # 运营后台读路径（T04 #27–#31）：一律走 PG，Redis 无分页 / 过滤能力
    # ==================================================================

    async def list_sessions(self, query: SessionListQuery) -> SessionPage:
        """分页查询会话列表（PG）。

        Args:
            query: 过滤 + 分页条件。

        Returns:
            一页会话数据。
        """
        return await self._pg_store.list_sessions(query)

    async def get_session_record(self, session_id: str) -> dict[str, Any] | None:
        """读取会话详情，PG 优先、Redis 兜底。

        PG 优先的原因：只有 PG 有 ``title`` / ``message_count`` / ``agent_name``
        这些列表页字段。但会话刚创建、双写尚未落地（或 PG 降级）时 PG 会查不到，
        此时回落到 Redis 现场拼一份，保证「刚建的会话点不开详情」不会发生。

        Args:
            session_id: 会话 ID。

        Returns:
            前端 ``Session`` 契约的 dict；两边都没有则返回 ``None``。
        """
        record: dict[str, Any] | None = None
        try:
            record = await self._pg_store.get_session(session_id)
        except Exception as exc:  # noqa: BLE001 - PG 不可用时仍要能看详情
            logger.warning(
                "Read session from PG failed, falling back to Redis",
                session_id=session_id,
                error=str(exc),
            )
        if record is not None:
            return record

        try:
            session: Session = await self.get_session(session_id)
        except SessionNotFoundError:
            return None
        return self._session_to_wire(session)

    async def list_session_messages(
        self,
        session_id: str,
        page: int = 1,
        page_size: int = 50,
    ) -> MessagePage:
        """分页读取会话消息，PG 优先、Redis 兜底。

        Args:
            session_id: 会话 ID。
            page: 页码，从 1 开始。
            page_size: 每页条数。

        Returns:
            一页消息数据。
        """
        try:
            page_result: MessagePage = await self._pg_store.list_messages(
                session_id, page=page, page_size=page_size
            )
            if page_result.total > 0:
                return page_result
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Read messages from PG failed, falling back to Redis",
                session_id=session_id,
                error=str(exc),
            )

        # PG 里一条都没有：可能是双写尚未落地的新会话，用 Redis 现场分页。
        try:
            session: Session = await self.get_session(session_id)
        except SessionNotFoundError:
            return MessagePage(items=[], total=0, page=page, page_size=page_size)

        all_messages: list[dict[str, Any]] = [
            {
                "id": msg.id,
                "session_id": session_id,
                "role": msg.role,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat(),
                "metadata": msg.metadata or {},
            }
            for msg in session.messages
        ]
        start: int = max(page - 1, 0) * page_size
        return MessagePage(
            items=all_messages[start : start + page_size],
            total=len(all_messages),
            page=page,
            page_size=page_size,
        )

    async def delete_sessions(self, session_ids: Sequence[str]) -> int:
        """删除若干会话：PG 软删除 + Redis 热数据清理。

        Args:
            session_ids: 待删除的会话 ID 列表。

        Returns:
            PG 侧实际被标记删除的行数。
        """
        if not session_ids:
            return 0

        redis: aioredis.Redis = await self._get_redis()
        for session_id in session_ids:
            await redis.delete(self._session_key(session_id))
            await redis.delete(self._agent_binding_key(session_id))

        deleted: int = await self._pg_store.soft_delete(list(session_ids))
        logger.info(
            "Sessions deleted",
            requested=len(session_ids),
            soft_deleted=deleted,
        )
        return deleted

    # ==================================================================
    # 会话反馈运营（CF-01 / CF-03 / CF-05）：全部委托 PG 独立表
    # ==================================================================

    async def list_feedback(self, query: FeedbackQuery) -> FeedbackPage:
        """分页查询会话反馈列表（CF-01）。

        Args:
            query: 过滤 + 分页条件。

        Returns:
            一页反馈数据（``items`` 已是 wire 形状，含 answer_brief）。
        """
        return await self._pg_store.list_feedback(query)

    async def feedback_stats(
        self,
        *,
        agent_id: str | None = None,
        channel: str | None = None,
        time_from: datetime | None = None,
        time_to: datetime | None = None,
    ) -> dict[str, Any]:
        """会话反馈统计（CF-05）。

        Args:
            agent_id: 按 Agent 过滤（可空）。
            channel: 按渠道过滤（可空）。
            time_from: 创建时间下界（可空）。
            time_to: 创建时间上界（可空）。

        Returns:
            前端 ``AgentFeedbackStats`` 契约的 dict。
        """
        return await self._pg_store.feedback_stats(
            agent_id=agent_id,
            channel=channel,
            time_from=time_from,
            time_to=time_to,
        )

    async def process_feedback(
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
            FeedbackNotFoundError: 反馈不存在。
            FeedbackStatusIllegalError: 已处于另一个终态不可回退。
        """
        return await self._pg_store.mark_feedback_processed(
            feedback_id, status, handler_id, handler_name, note
        )

    async def batch_process_feedback(
        self,
        feedback_ids: Sequence[int],
        status: str,
        handler_id: str | None,
        handler_name: str | None,
        note: str | None,
    ) -> int:
        """批量把 pending 反馈标记为 handled / ignored（CF-03）。

        Args:
            feedback_ids: 反馈行主键列表（调用方负责去重与上限校验）。
            status: 目标状态（handled / ignored）。
            handler_id: 操作人 MIS userId（字符串化，可空）。
            handler_name: 操作人展示名（可空）。
            note: 处理备注（可空）。

        Returns:
            实际更新的行数。
        """
        return await self._pg_store.batch_mark_feedback_processed(
            feedback_ids, status, handler_id, handler_name, note
        )

    @staticmethod
    def _session_to_wire(session: Session) -> dict[str, Any]:
        """把 Redis 里的运行时会话拼成前端 ``Session`` 契约（兜底路径用）。

        Args:
            session: 运行时会话对象。

        Returns:
            与 PG 的 ``AgentSessionModel.to_wire()`` 字段完全一致的 dict——
            两条路径必须同形，否则前端会因为缺字段而崩。
        """
        from src.agent.session_store import normalize_channel

        title: str | None = None
        for msg in session.messages:
            if msg.role == "user" and (msg.content or "").strip():
                flattened: str = " ".join(msg.content.split())
                title = flattened[:60] + ("…" if len(flattened) > 60 else "")
                break

        return {
            "session_id": session.session_id,
            "agent_id": session.agent_id,
            "agent_name": None,
            "channel": normalize_channel(session.channel),
            "user_id": session.user_id or None,
            "user_name": (session.user_name or None)
            or (session.user_mobile or None),
            "title": title,
            "status": "active",
            "runtime_type": session.runtime_type or None,
            "message_count": len(session.messages),
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
        }


# Singleton instance
_session_manager: SessionManager | None = None


def get_session_manager() -> SessionManager:
    """返回单例 SessionManager 实例。"""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
    return _session_manager
