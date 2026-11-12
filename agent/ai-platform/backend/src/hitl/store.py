"""ApprovalStore — 审批请求存储（Redis 后端，跨副本共享）。

Phase 1 改造：原进程内 dict（每副本独立、故障接管即丢失）改为 Redis 持久化，
使多副本故障接管时审批挂起态可在任意副本恢复（方案 C + 软亲和的开关）。

- 记录以 JSON（``ApprovalRecord.model_dump_json``）存储，键为
  ``aip:hitl:approval:{approval_id}``，TTL = 记录自身的 ``timeout_seconds``，
  保证 key 存活窗口与 ``is_expired()`` 逻辑一致。
- 公共方法签名（create / get / update_status / list_* / get_stats / delete /
  cleanup_expired）完全不变，调用方 ``ApprovalManager`` 与 push API 零改动。
- 复用项目既有的 ``redis.asyncio`` 客户端（经 ``src.hitl._redis`` 单例），
  遵循 ``aip:`` 键前缀，不新开裸连接。
"""

from __future__ import annotations
from typing import Any

from datetime import datetime, timedelta, timezone
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field

from src.utils.logging import get_logger
from src.hitl._redis import get_hitl_redis

logger = get_logger("hitl.store")

# Redis 键前缀（遵循项目 aip: 约定）
KEY_PREFIX = "aip:hitl:approval:"


class ApprovalStatus(str, Enum):
    """审批生命周期状态。"""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    TIMEOUT = "timeout"
    EXPIRED = "expired"


class ApprovalRecord(BaseModel):
    """
    HITL 审批请求记录。

    表示从 Agent 向人类用户发起的单个审批请求。
    Agent 暂停执行直到用户响应（或发生超时）。

    属性：
        approval_id: 唯一审批请求 ID
        session_id: 触发审批的 Session
        agent_id: 触发审批的 Agent
        skill_id: 需要审批的 Skill
        user_id: 需要批准的用户
        status: 当前审批状态
        detail: 审批详情（标题、描述等）
        created_at: 创建时间 ISO 时间戳
        resolved_at: 解决时间 ISO 时间戳（pending 时为 null）
        comment: 用户响应时的评论
        timeout_seconds: 超时秒数
    """

    approval_id: str = Field(default="", description="唯一审批 ID")
    session_id: str = Field(default="", description="Session ID")
    agent_id: str = Field(default="", description="Agent ID")
    skill_id: str = Field(default="", description="需要审批的 Skill ID")
    user_id: str = Field(default="", description="需要审批的用户 ID")
    status: ApprovalStatus = Field(
        default=ApprovalStatus.PENDING, description="审批状态"
    )
    detail: dict[str, Any] = Field(
        default_factory=dict, description="审批详情（标题、描述等）"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    resolved_at: datetime | None = None
    comment: str | None = None
    timeout_seconds: int = Field(default=300, description="超时秒数")

    def is_expired(self) -> bool:
        """检查此审批是否已超时。"""
        if self.status != ApprovalStatus.PENDING:
            return False
        expiry: Any = self.created_at + timedelta(seconds=self.timeout_seconds)
        return datetime.now(timezone.utc) > expiry


class ApprovalStore:
    """
    基于 Redis 的审批请求存储。

    提供异步方法用于创建、查询和更新审批记录。所有记录持久化到共享 Redis，
    因此任一副本写入、另一副本可读（跨副本故障接管可恢复挂起态）。

    进程内 ``asyncio.Lock`` 仅用于单进程内的读写串行化，保持与原内存实现的
    并发语义；跨副本的最终一致性由 Redis 本身保证。
    """

    def __init__(self, redis: "Any | None" = None) -> None:
        """
        初始化 ApprovalStore。

        Args:
            redis: 可选的 ``redis.asyncio.Redis`` 实例（测试注入 fakeredis）。
                为 None 时惰性复用进程内共享客户端（``src.hitl._redis``）。
        """
        self._redis = redis
        self._lock = asyncio_lock()

    async def _r(self) -> "Any":
        if self._redis is None:
            self._redis = await get_hitl_redis()
        return self._redis

    @staticmethod
    def _key(approval_id: str) -> str:
        return f"{KEY_PREFIX}{approval_id}"

    async def create(
        self,
        session_id: str,
        agent_id: str,
        skill_id: str,
        user_id: str,
        detail: dict[str, Any],
        timeout_seconds: int = 300,
    ) -> ApprovalRecord:
        """
        创建一个新的审批请求。

        参数：
            session_id: 触发审批的 Session ID。
            agent_id: Agent ID。
            skill_id: 需要审批的 Skill ID。
            user_id: 需要审批的用户 ID。
            detail: 审批详情字典（标题、描述等）。
            timeout_seconds: 超时秒数（默认：300 = 5 分钟）。同时作为 Redis 键 TTL。

        返回：
            创建的 ApprovalRecord。
        """
        record: ApprovalRecord = ApprovalRecord(
            approval_id=f"approval-{uuid4().hex[:16]}",
            session_id=session_id,
            agent_id=agent_id,
            skill_id=skill_id,
            user_id=user_id,
            status=ApprovalStatus.PENDING,
            detail=detail,
            timeout_seconds=timeout_seconds,
        )
        redis = await self._r()
        async with self._lock:
            await redis.set(
                self._key(record.approval_id),
                record.model_dump_json(),
                ex=record.timeout_seconds,
            )
        logger.info(
            "Approval created",
            approval_id=record.approval_id,
            session_id=session_id,
            agent_id=agent_id,
            skill_id=skill_id,
            user_id=user_id,
        )
        return record

    async def get(self, approval_id: str) -> ApprovalRecord | None:
        """按 ID 从 Redis 获取审批记录。"""
        redis = await self._r()
        raw = await redis.get(self._key(approval_id))
        if raw is None:
            return None
        return ApprovalRecord.model_validate_json(raw)

    async def update_status(
        self,
        approval_id: str,
        status: ApprovalStatus,
        comment: str | None = None,
    ) -> ApprovalRecord | None:
        """
        更新审批状态。

        参数：
            approval_id: 要更新的审批 ID。
            status: 新状态。
            comment: 可选的用户评论。

        返回：
            更新后的 ApprovalRecord，若未找到则返回 None。
        """
        redis = await self._r()
        async with self._lock:
            raw = await redis.get(self._key(approval_id))
            if raw is None:
                return None
            record: ApprovalRecord = ApprovalRecord.model_validate_json(raw)
            if record.status != ApprovalStatus.PENDING:
                logger.warning(
                    "Approval already resolved",
                    approval_id=approval_id,
                    current_status=record.status.value,
                    new_status=status.value,
                )
                return record

            record.status = status
            record.resolved_at = datetime.now(timezone.utc)
            record.comment = comment
            await redis.set(
                self._key(approval_id),
                record.model_dump_json(),
                ex=record.timeout_seconds,
            )
            logger.info(
                "Approval status updated",
                approval_id=approval_id,
                status=status.value,
                comment=comment,
            )
            return record

    async def _scan_all(self) -> list[ApprovalRecord]:
        """扫描本 store 命名空间下的全部审批记录（Redis 键空间遍历）。"""
        redis = await self._r()
        keys: list[str] = [k async for k in redis.scan_iter(match=f"{KEY_PREFIX}*")]
        if not keys:
            return []
        raws = await redis.mget(*keys)
        records: list[ApprovalRecord] = []
        for raw in raws:
            if raw is None:
                continue
            try:
                records.append(ApprovalRecord.model_validate_json(raw))
            except Exception:  # noqa: BLE001 - 保护统计类接口不被坏数据击垮
                logger.warning("Skipping unparseable approval record", raw=str(raw)[:200])
        return records

    async def list_by_user(
        self,
        user_id: str,
        status: ApprovalStatus | None = None,
    ) -> list[ApprovalRecord]:
        """列出某用户的审批，可按状态筛选。"""
        records = await self._scan_all()
        results: list[Any] = [
            record
            for record in records
            if record.user_id == user_id
            and (status is None or record.status == status)
        ]
        results.sort(key=lambda r: r.created_at, reverse=True)
        return results

    async def list_by_session(
        self,
        session_id: str,
        status: ApprovalStatus | None = None,
    ) -> list[ApprovalRecord]:
        """列出某 Session 的审批，可按状态筛选。"""
        records = await self._scan_all()
        results: list[Any] = [
            record
            for record in records
            if record.session_id == session_id
            and (status is None or record.status == status)
        ]
        results.sort(key=lambda r: r.created_at, reverse=True)
        return results

    async def list_all(
        self,
        status: ApprovalStatus | None = None,
        limit: int = 100,
    ) -> list[ApprovalRecord]:
        """列出所有审批，可按状态筛选。"""
        records = await self._scan_all()
        results: list[Any] = [
            record
            for record in records
            if status is None or record.status == status
        ]
        results.sort(key=lambda r: r.created_at, reverse=True)
        return results[:limit]

    async def list_pending(self) -> list[ApprovalRecord]:
        """列出所有待审批记录（用于超时检查）。"""
        records = await self._scan_all()
        return [
            record
            for record in records
            if record.status == ApprovalStatus.PENDING
        ]

    async def get_stats(self) -> dict[str, int]:
        """获取审批统计摘要。"""
        records = await self._scan_all()
        total: Any = len(records)
        pending: Any = sum(
            1 for r in records if r.status == ApprovalStatus.PENDING
        )
        approved: Any = sum(
            1 for r in records if r.status == ApprovalStatus.APPROVED
        )
        rejected: Any = sum(
            1 for r in records if r.status == ApprovalStatus.REJECTED
        )
        timeout: Any = sum(
            1 for r in records if r.status == ApprovalStatus.TIMEOUT
        )
        return {
            "total": total,
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "timeout": timeout,
        }

    async def delete(self, approval_id: str) -> bool:
        """删除一条审批记录。"""
        redis = await self._r()
        removed = await redis.delete(self._key(approval_id))
        if removed:
            logger.info("Approval deleted", approval_id=approval_id)
        return bool(removed)

    async def cleanup_expired(self) -> int:
        """
        将过期的待审批记录标记为超时。

        返回被标记为超时的审批数量。
        """
        redis = await self._r()
        timed_out: int = 0
        for record in await self._scan_all():
            if record.is_expired():
                record.status = ApprovalStatus.TIMEOUT
                record.resolved_at = datetime.now(timezone.utc)
                await redis.set(
                    self._key(record.approval_id),
                    record.model_dump_json(),
                    ex=record.timeout_seconds,
                )
                timed_out += 1
                logger.info(
                    "Approval timed out",
                    approval_id=record.approval_id,
                    session_id=record.session_id,
                )
        return timed_out


# ===== 辅助函数 =====


def asyncio_lock():
    """创建 asyncio.Lock（延迟导入以提高可测试性）。"""
    import asyncio

    return asyncio.Lock()
