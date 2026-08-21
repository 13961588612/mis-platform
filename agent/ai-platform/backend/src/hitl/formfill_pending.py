"""FormFillPendingStore — 表单填充 HITL 挂起任务存储（T05，Redis 后端）。

Phase 1 改造：原进程内 dict（每副本独立、故障接管即丢失）改为 Redis 持久化。
``resume_formfill`` 在接管副本经 ``get_formfill_pending_store()`` 取记录时，
只要共享同一 Redis 即可跨副本续跑（方案 C + 软亲和的开关）。

- 记录以 JSON（``FormFillPendingRecord.model_dump_json``）存储，键为
  ``aip:hitl:formfill:{resume_token}``，TTL = 记录自身的 ``timeout_seconds``
  （默认 30 分钟，与源码 ``DEFAULT_TTL_SECONDS`` 对齐）。
- 公共方法签名（create / get / get_by_session / update_status / delete /
  cleanup_expired）与单例 ``get_formfill_pending_store()`` 完全不变，
  调用方 ``formfill_execute.resume_formfill`` 零改动。
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

logger = get_logger("hitl.formfill_pending")

# 挂起任务默认 TTL（P0：30 分钟）
DEFAULT_TTL_SECONDS = 30 * 60

# Redis 键前缀（遵循项目 aip: 约定）
KEY_PREFIX = "aip:hitl:formfill:"


class FormFillStatus(str, Enum):
    """表单填充挂起任务生命周期状态。"""

    PENDING = "pending"      # 等待用户选择候选实体
    CONFIRMED = "confirmed"  # 已确认（成功 apply）
    CANCELLED = "cancelled"  # 用户取消 / 转手动输入
    APPLIED = "applied"      # 已成功写回 BFF
    EXPIRED = "expired"      # 超时 / 写回失败


class FormFillPendingRecord(BaseModel):
    """表单填充挂起任务记录。"""

    resume_token: str = Field(default="", description="HITL 恢复令牌（与 conversationId 绑定）")
    session_id: str = Field(default="", description="会话 ID")
    agent_id: str = Field(default="", description="Agent ID")
    skill_id: str = Field(default="", description="MIS FormFill Skill ID")
    user_id: str = Field(default="", description="用户 ID")
    field: str = Field(default="", description="待填充字段名")
    doc_type: str = Field(default="", description="目标单据类型")
    doc_id: str = Field(default="", description="目标单据 ID")
    candidates: list[dict[str, Any]] = Field(
        default_factory=list, description="候选实体列表"
    )
    original_value: str = Field(default="", description="原值 / 当前值")
    prompt: str = Field(default="", description="向用户展示的选择提示")
    status: FormFillStatus = Field(default=FormFillStatus.PENDING, description="状态")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: datetime | None = None
    timeout_seconds: int = Field(default=DEFAULT_TTL_SECONDS, description="超时秒数")

    def is_expired(self) -> bool:
        """检查任务是否已超 TTL。"""
        if self.status != FormFillStatus.PENDING:
            return False
        expiry = self.created_at + timedelta(seconds=self.timeout_seconds)
        return datetime.now(timezone.utc) > expiry


class FormFillPendingStore:
    """基于 Redis 的表单填充挂起任务存储（复用 ApprovalStore 模式）。

    所有记录持久化到共享 Redis，因此副本 A 写入、副本 B 可读，支持故障接管
    时 ``resume_formfill`` 跨副本续跑。进程内 ``asyncio.Lock`` 仅用于单进程内
    读写串行化，跨副本一致性由 Redis 保证。
    """

    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS, redis: "Any | None" = None) -> None:
        """
        初始化存储与并发锁。

        Args:
            ttl_seconds: 默认挂起任务 TTL（秒）。
            redis: 可选的 ``redis.asyncio.Redis`` 实例（测试注入 fakeredis）。
                为 None 时惰性复用进程内共享客户端（``src.hitl._redis``）。
        """
        self._ttl = ttl_seconds
        self._redis = redis
        self._lock = asyncio_lock()

    async def _r(self) -> "Any":
        if self._redis is None:
            self._redis = await get_hitl_redis()
        return self._redis

    @staticmethod
    def _key(resume_token: str) -> str:
        return f"{KEY_PREFIX}{resume_token}"

    async def create(
        self,
        *,
        resume_token: str,
        session_id: str,
        agent_id: str,
        skill_id: str,
        user_id: str,
        field: str,
        doc_type: str,
        doc_id: str,
        candidates: list[dict[str, Any]],
        original_value: str = "",
        prompt: str = "",
        timeout_seconds: int | None = None,
    ) -> FormFillPendingRecord:
        """登记一条挂起的表单填充任务。"""
        effective_ttl = timeout_seconds or self._ttl
        record = FormFillPendingRecord(
            resume_token=resume_token or f"ff-{uuid4().hex[:16]}",
            session_id=session_id,
            agent_id=agent_id,
            skill_id=skill_id,
            user_id=user_id,
            field=field,
            doc_type=doc_type,
            doc_id=doc_id,
            candidates=candidates,
            original_value=original_value,
            prompt=prompt,
            status=FormFillStatus.PENDING,
            timeout_seconds=effective_ttl,
        )
        redis = await self._r()
        async with self._lock:
            await redis.set(
                self._key(record.resume_token),
                record.model_dump_json(),
                ex=record.timeout_seconds,
            )
        logger.info(
            "FormFill pending created",
            resume_token=record.resume_token,
            session_id=session_id,
            skill_id=skill_id,
            field=field,
        )
        return record

    async def get(self, resume_token: str) -> FormFillPendingRecord | None:
        """按 resume_token 获取记录；若已超 TTL 则就地标记为 EXPIRED 后返回。"""
        redis = await self._r()
        raw = await redis.get(self._key(resume_token))
        if raw is None:
            return None
        record = FormFillPendingRecord.model_validate_json(raw)
        if record.is_expired() and record.status == FormFillStatus.PENDING:
            record.status = FormFillStatus.EXPIRED
            record.resolved_at = datetime.now(timezone.utc)
            await redis.set(
                self._key(resume_token),
                record.model_dump_json(),
                ex=record.timeout_seconds,
            )
            logger.info("FormFill pending expired", resume_token=resume_token)
        return record

    async def get_by_session(self, session_id: str) -> FormFillPendingRecord | None:
        """取某会话最新的一条待处理挂起任务。"""
        records = await self._scan_all()
        pending = [
            r
            for r in records
            if r.session_id == session_id and r.status == FormFillStatus.PENDING
        ]
        if not pending:
            return None
        pending.sort(key=lambda r: r.created_at, reverse=True)
        return pending[0]

    async def update_status(
        self, resume_token: str, status: FormFillStatus
    ) -> FormFillPendingRecord | None:
        """更新任务状态。"""
        redis = await self._r()
        async with self._lock:
            raw = await redis.get(self._key(resume_token))
            if raw is None:
                return None
            record = FormFillPendingRecord.model_validate_json(raw)
            if record.status != FormFillStatus.PENDING:
                logger.warning(
                    "FormFill pending already resolved",
                    resume_token=resume_token,
                    current_status=record.status.value,
                    new_status=status.value,
                )
                return record
            record.status = status
            record.resolved_at = datetime.now(timezone.utc)
            await redis.set(
                self._key(resume_token),
                record.model_dump_json(),
                ex=record.timeout_seconds,
            )
            logger.info(
                "FormFill pending status updated",
                resume_token=resume_token,
                status=status.value,
            )
            return record

    async def delete(self, resume_token: str) -> bool:
        """删除一条记录。"""
        redis = await self._r()
        removed = await redis.delete(self._key(resume_token))
        if removed:
            logger.info("FormFill pending deleted", resume_token=resume_token)
        return bool(removed)

    async def cleanup_expired(self) -> int:
        """将过期的待处理任务标记为 expired，返回标记数量。"""
        redis = await self._r()
        timed_out = 0
        for record in await self._scan_all():
            if record.is_expired():
                record.status = FormFillStatus.EXPIRED
                record.resolved_at = datetime.now(timezone.utc)
                await redis.set(
                    self._key(record.resume_token),
                    record.model_dump_json(),
                    ex=record.timeout_seconds,
                )
                timed_out += 1
                logger.info(
                    "FormFill pending timed out", resume_token=record.resume_token
                )
        return timed_out

    async def _scan_all(self) -> list[FormFillPendingRecord]:
        """扫描本 store 命名空间下的全部挂起记录（Redis 键空间遍历）。"""
        redis = await self._r()
        keys: list[str] = [k async for k in redis.scan_iter(match=f"{KEY_PREFIX}*")]
        if not keys:
            return []
        raws = await redis.mget(*keys)
        records: list[FormFillPendingRecord] = []
        for raw in raws:
            if raw is None:
                continue
            try:
                records.append(FormFillPendingRecord.model_validate_json(raw))
            except Exception:  # noqa: BLE001 - 保护统计类接口不被坏数据击垮
                logger.warning("Skipping unparseable formfill record", raw=str(raw)[:200])
        return records


def asyncio_lock():
    """创建 asyncio.Lock（延迟导入以提高可测试性）。"""
    import asyncio

    return asyncio.Lock()


# ===== 单例 =====
# 表单填充的 execute（Agent 工具）与 resume（入站 worker）处于同一后端进程，
# 但分属不同调用点。必须共享同一份存储实例，否则 resume 时按 resume_token
# 取不到 execute 阶段登记的挂起任务。
#
# Phase 1 后底层为 Redis（跨副本共享），此处单例仅保证进程内复用同一客户端
# 句柄；若注入 fakeredis（测试）则单例也走 fakeredis，确保跨用例隔离时重置。

_formfill_pending_store: "FormFillPendingStore | None" = None


def get_formfill_pending_store(redis: "Any | None" = None) -> FormFillPendingStore:
    """获取 FormFillPendingStore 单例（无参调用保持向后兼容）。"""
    global _formfill_pending_store
    if _formfill_pending_store is None:
        _formfill_pending_store = FormFillPendingStore(redis=redis)
    return _formfill_pending_store


def reset_formfill_pending_store() -> None:
    """清空单例（测试隔离用）。"""
    global _formfill_pending_store
    _formfill_pending_store = None
