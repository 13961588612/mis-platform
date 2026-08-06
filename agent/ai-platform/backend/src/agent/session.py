"""会话管理 — 创建、恢复、持久化。

实现 session_id 命名规范（v1.4.1）：
  web-{uuid} / wecom-bot-{uuid} / wecom-h5-{uuid}

会话状态存储在 Redis（主要存储，TTL 24 小时）和 PostgreSQL（备份）中。
"""

from __future__ import annotations
from typing import Any

import json
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis

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
    ) -> None:
        """构造一条会话消息。

        Args:
            role: 消息角色（如 ``user``、``assistant``）。
            content: 消息正文。
            metadata: 可选的附加元数据。
        """
        self.id: str = str(uuid.uuid4())
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
        """
        self.session_id = session_id
        self.agent_id = agent_id
        self.user_id = user_id
        self.channel = channel
        self.runtime_type = runtime_type
        self.user_mobile = user_mobile
        self.channel_user_id = channel_user_id
        self.mis_user_id: int | None = mis_user_id
        self.messages: list[Message] = []
        self.state: dict[str, Any] = {}
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)

    def add_message(
        self,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> Message:
        """向会话中添加一条消息。"""
        msg: Message = Message(role=role, content=content, metadata=metadata)
        self.messages.append(msg)
        self.updated_at = datetime.now(timezone.utc)
        return msg

    def get_messages(self) -> list[dict[str, Any]]:
        """以字典列表形式返回所有消息。"""
        return [msg.to_dict() for msg in self.messages]

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
            "messages": self.get_messages(),
            "state": self.state,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class SessionManager:
    """
    管理会话生命周期：创建、恢复、持久化。

    使用 Redis 作为主要存储（TTL 24 小时）以实现快速访问，
    将 PostgreSQL 作为持久化备份用于长期存储。
    """

    def __init__(self) -> None:
        """初始化会话管理器（Redis 连接懒创建）。"""
        self._redis: aioredis.Redis | None = None
        self._settings = get_settings()
        self._session_ttl = 86400  # 24 小时

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
        )

        # 存储到 Redis
        redis: aioredis.Redis = await self._get_redis()
        await redis.setex(
            self._session_key(session_id),
            self._session_ttl,
            json.dumps(session.to_dict()),
        )

        # 设置 agent 绑定
        await redis.setex(
            self._agent_binding_key(session_id),
            self._session_ttl,
            agent_id,
        )

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
        )
        redis: aioredis.Redis = await self._get_redis()
        await redis.setex(
            self._session_key(session_id),
            self._session_ttl,
            json.dumps(session.to_dict()),
        )
        await redis.setex(
            self._agent_binding_key(session_id),
            self._session_ttl,
            agent_id,
        )
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
        )
        session.messages = [
            Message.from_dict(msg) for msg in session_data.get("messages", [])
        ]
        session.state = session_data.get("state", {})
        session.created_at = datetime.fromisoformat(session_data["created_at"])
        session.updated_at = datetime.fromisoformat(session_data["updated_at"])
        return session

    async def save_session(self, session: Session) -> None:
        """将会话持久化到 Redis。"""
        redis: aioredis.Redis = await self._get_redis()
        session.updated_at = datetime.now(timezone.utc)
        await redis.setex(
            self._session_key(session.session_id),
            self._session_ttl,
            json.dumps(session.to_dict()),
        )

    async def get_agent_binding(self, session_id: str) -> str | None:
        """获取会话绑定的 agent ID（用于会话亲和路由）。"""
        redis: aioredis.Redis = await self._get_redis()
        return await redis.get(self._agent_binding_key(session_id))

    async def set_agent_binding(self, session_id: str, agent_id: str) -> None:
        """将会话绑定到一个 agent（用于会话亲和路由）。"""
        redis: aioredis.Redis = await self._get_redis()
        await redis.setex(
            self._agent_binding_key(session_id),
            self._session_ttl,
            agent_id,
        )

    async def close_session(self, session_id: str) -> None:
        """关闭一个会话（从 Redis 中移除）。"""
        redis: aioredis.Redis = await self._get_redis()
        await redis.delete(self._session_key(session_id))
        await redis.delete(self._agent_binding_key(session_id))
        logger.info("Session closed", session_id=session_id)

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> Message:
        """向现有会话添加一条消息并持久化。"""
        session: dict[str, Any] = await self.get_session(session_id)
        msg: Message = session.add_message(role, content, metadata)
        await self.save_session(session)
        return msg


# Singleton instance
_session_manager: SessionManager | None = None


def get_session_manager() -> SessionManager:
    """返回单例 SessionManager 实例。"""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
    return _session_manager
