"""FormFillPendingStore — 表单填充 HITL 挂起任务存储（T05）。

复用 ApprovalStore 的内存 + asyncio.Lock 模式，记录 FormFill 引擎
返回 ``hitl_required`` 时挂起的实体选择任务。任务 TTL 默认 30 分钟；
过期后视为失效，正向/反向调用均不应再使用。
"""
from __future__ import annotations
from typing import Any

from datetime import datetime, timedelta, timezone
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field

from src.utils.logging import get_logger

logger = get_logger("hitl.formfill_pending")

# 挂起任务默认 TTL（P0：30 分钟）
DEFAULT_TTL_SECONDS = 30 * 60


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
    """内存表单填充挂起任务存储（复用 ApprovalStore 模式）。"""

    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        """初始化空存储与并发锁。"""
        self._records: dict[str, FormFillPendingRecord] = {}
        self._ttl = ttl_seconds
        self._lock = asyncio_lock()

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
            timeout_seconds=timeout_seconds or self._ttl,
        )
        async with self._lock:
            self._records[record.resume_token] = record
        logger.info(
            "FormFill pending created",
            resume_token=record.resume_token,
            session_id=session_id,
            skill_id=skill_id,
            field=field,
        )
        return record

    async def get(self, resume_token: str) -> FormFillPendingRecord | None:
        """按 resume_token 获取记录。"""
        async with self._lock:
            record = self._records.get(resume_token)
            if record is not None and record.is_expired():
                record.status = FormFillStatus.EXPIRED
                record.resolved_at = datetime.now(timezone.utc)
                logger.info("FormFill pending expired", resume_token=resume_token)
            return record

    async def get_by_session(self, session_id: str) -> FormFillPendingRecord | None:
        """取某会话最新的一条待处理挂起任务。"""
        async with self._lock:
            pending = [
                r
                for r in self._records.values()
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
        async with self._lock:
            record = self._records.get(resume_token)
            if record is None:
                return None
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
            logger.info(
                "FormFill pending status updated",
                resume_token=resume_token,
                status=status.value,
            )
            return record

    async def delete(self, resume_token: str) -> bool:
        """删除一条记录。"""
        async with self._lock:
            if resume_token in self._records:
                del self._records[resume_token]
                logger.info("FormFill pending deleted", resume_token=resume_token)
                return True
            return False

    async def cleanup_expired(self) -> int:
        """将过期的待处理任务标记为 expired，返回标记数量。"""
        timed_out = 0
        async with self._lock:
            for record in self._records.values():
                if record.is_expired():
                    record.status = FormFillStatus.EXPIRED
                    record.resolved_at = datetime.now(timezone.utc)
                    timed_out += 1
                    logger.info("FormFill pending timed out", resume_token=record.resume_token)
        return timed_out


def asyncio_lock():
    """创建 asyncio.Lock（延迟导入以提高可测试性）。"""
    import asyncio

    return asyncio.Lock()


# ===== 单例 =====
# 表单填充的 execute（Agent 工具）与 resume（入站 worker）处于同一后端进程，
# 但分属不同调用点。必须共享同一份内存存储，否则 resume 时按 resume_token
# 取不到 execute 阶段登记的挂起任务（与 ApprovalManager 单例保持一致）。

_formfill_pending_store: FormFillPendingStore | None = None


def get_formfill_pending_store() -> FormFillPendingStore:
    """获取 FormFillPendingStore 进程内单例。"""
    global _formfill_pending_store
    if _formfill_pending_store is None:
        _formfill_pending_store = FormFillPendingStore()
    return _formfill_pending_store
