"""企微用户身份绑定服务 —— ``wecom-user-binding-design.md`` §9 的运行时实现。

目标：把 ``corp_id + wecom_user_id`` 稳定解析成 **MIS userId（int）**，写入
``Session.mis_user_id`` 供 ACL fail-closed 判权。

两层策略：

.. code-block:: text

    第一层：本地绑定表命中（主链路）
        corp_id + wecom_user_id → mis_user_id
    第二层：首次自动手机号匹配（兜底）
        mobile（入站或 user/get）
        → BFF user-by-phone(tenantId, phone) → exact-one → 落绑定

不变量
------

1. 手机号只在**没有绑定时**用一次，绑定后不再查手机号接口。
2. 自动绑定必须 exact-one；0 个 / 多个 → fail-closed，且不落绑定。
3. 人工绑定（``manual``）优先级最高，不会被 ``auto_phone`` 覆盖。
4. ``disabled`` 的绑定不自动重生。
5. 任何异常 → 返回 ``None``，**绝不抛异常**打断消息接收，但必然 fail-closed。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.channels.wecom_binding_errors import WecomPhoneLookup
from src.models.wecom_binding import (
    BIND_SOURCE_AUTO_PHONE,
    BIND_SOURCE_MANUAL,
    BIND_STATUS_ACTIVE,
    BIND_STATUS_DISABLED,
    WecomIdentityBinding,
)

logger = structlog.get_logger(__name__)


def phone_hash(phone: str) -> str:
    """对手机号做加盐 SHA-256（**禁止落明文**）。"""
    from src.config import get_settings

    if not phone:
        return ""
    salt = str(get_settings().WECOM_PHONE_HASH_SALT or "")
    return hashlib.sha256(f"{salt}:{phone}".encode("utf-8")).hexdigest()


def mask_phone(phone: str) -> str:
    """生成展示用掩码，形如 ``138****0000``（位数不足返回空串）。"""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) < 7:
        return ""
    return f"{digits[:3]}****{digits[-4:]}"


@dataclass
class WecomIdentityInput:
    """解析入参。"""

    corp_id: str
    tenant_id: int | None
    wecom_user_id: str
    user_mobile: str = ""
    bind_mode: str = "auto_phone"


class WecomUserBindingService:
    """企微身份 → MIS 用户的绑定解析 + 绑定表读写。"""

    def __init__(
        self,
        *,
        phone_lookup: WecomPhoneLookup | None = None,
        contacts: Any | None = None,
        corp_store: Any | None = None,
    ) -> None:
        """初始化。

        Args:
            phone_lookup: BFF ``user-by-phone`` 查询实现。
            contacts: :class:`~src.channels.wecom_contacts_client.WecomContactsClient`。
            corp_store: :class:`~src.channels.wecom_corp_store.WecomCorpStore`。
        """
        from src.channels.wecom_contacts_client import WecomContactsClient
        from src.channels.wecom_corp_store import get_wecom_corp_store
        from src.identity.wecom_phone_lookup import BffWecomPhoneLookup

        self._phone_lookup: WecomPhoneLookup = phone_lookup or BffWecomPhoneLookup()
        self._contacts = contacts or WecomContactsClient()
        self._corp_store = corp_store or get_wecom_corp_store()

    # ------------------------------------------------------------------ 解析

    async def resolve(self, db: AsyncSession, input: WecomIdentityInput) -> int | None:
        """解析 MIS userId；无法唯一解析时返回 ``None``。"""
        corp_id = (input.corp_id or "").strip()
        wecom_user_id = (input.wecom_user_id or "").strip()
        if not corp_id or not wecom_user_id:
            return None

        tenant_id = input.tenant_id
        bind_mode = (input.bind_mode or "auto_phone").strip().lower()
        # corp 配置优先：以 corp 上的 tenant / bind_mode 为准。
        corp = self._corp_store.get(corp_id)
        if corp is not None:
            tenant_id = corp.tenant_id
            bind_mode = corp.user_bind_mode

        # 1) 本地绑定表命中。
        binding = await self._get_binding(db, corp_id, wecom_user_id)
        if binding is not None:
            if binding.status == BIND_STATUS_ACTIVE:
                return int(binding.mis_user_id)
            # disabled：不自动重生。
            return None

        # 2) 首次兜底：仅 auto_phone 且租户已知时才尝试手机号匹配。
        if bind_mode != "auto_phone" or tenant_id is None:
            return None

        phone = (input.user_mobile or "").strip()
        if not phone:
            phone = await self._contacts.get_user_mobile(corp_id, wecom_user_id)
        if not phone:
            return None

        lookup = await self._phone_lookup.lookup(tenant_id, phone)
        if not lookup.matched or lookup.user_id is None:
            logger.info(
                "Wecom binding auto-phone not matched",
                corp_id=corp_id,
                wecom_user_id=wecom_user_id,
                reason=lookup.reason,
            )
            return None

        # 同一 corp 下该 mis_user 已绑另一个 wecom_user_id → 拒绝自动绑定。
        existing_mis = await self._get_binding_by_mis(db, corp_id, int(lookup.user_id))
        if existing_mis is not None and existing_mis.wecom_user_id != wecom_user_id:
            logger.warning(
                "Wecom binding conflict: mis_user already bound in corp",
                corp_id=corp_id,
                mis_user_id=lookup.user_id,
                bound_wecom_user_id=existing_mis.wecom_user_id,
                incoming_wecom_user_id=wecom_user_id,
            )
            return None

        await self._create_binding(
            db,
            corp_id=corp_id,
            wecom_user_id=wecom_user_id,
            tenant_id=int(tenant_id),
            mis_user_id=int(lookup.user_id),
            source=BIND_SOURCE_AUTO_PHONE,
            phone=phone,
        )
        return int(lookup.user_id)

    # ------------------------------------------------------------------ 运营台

    async def list_bindings(
        self,
        db: AsyncSession,
        *,
        corp_id: str = "",
        tenant_id: int | None = None,
        status: str = "",
        keyword: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[WecomIdentityBinding], int]:
        """分页查询绑定列表；返回 ``(rows, total)``。

        关键字同时匹配 ``wecom_user_id`` 与 ``mis_user_id``（手机号只存哈希，
        不参与模糊匹配）。
        """
        conditions: list[Any] = []
        if corp_id:
            conditions.append(WecomIdentityBinding.corp_id == corp_id)
        if tenant_id is not None:
            conditions.append(WecomIdentityBinding.tenant_id == int(tenant_id))
        if status:
            conditions.append(WecomIdentityBinding.status == status)
        kw = (keyword or "").strip()
        if kw:
            like = f"%{kw}%"
            matchers = [WecomIdentityBinding.wecom_user_id.ilike(like)]
            if kw.isdigit():
                matchers.append(WecomIdentityBinding.mis_user_id == int(kw))
            conditions.append(matchers[0] if len(matchers) == 1 else matchers[0] | matchers[1])

        count_stmt = select(func.count()).select_from(WecomIdentityBinding)
        rows_stmt = select(WecomIdentityBinding)
        if conditions:
            count_stmt = count_stmt.where(*conditions)
            rows_stmt = rows_stmt.where(*conditions)
        rows_stmt = (
            rows_stmt.order_by(WecomIdentityBinding.updated_at.desc())
            .limit(max(1, min(int(limit), 500)))
            .offset(max(0, int(offset)))
        )
        total = int((await db.execute(count_stmt)).scalar_one())
        result = await db.execute(rows_stmt)
        return list(result.scalars().all()), total

    async def unbind(
        self, db: AsyncSession, *, corp_id: str, wecom_user_id: str
    ) -> bool:
        """解绑：把记录置为 ``disabled``（保留审计痕迹，不物理删除）。

        置为 disabled 后不会自动重生 —— 需要重新绑定必须由管理员显式操作。
        """
        binding = await self._get_binding(db, corp_id.strip(), wecom_user_id.strip())
        if binding is None:
            return False
        binding.status = BIND_STATUS_DISABLED
        await db.flush()
        logger.info(
            "Wecom identity unbound",
            corp_id=corp_id,
            wecom_user_id=wecom_user_id,
            mis_user_id=binding.mis_user_id,
        )
        return True

    async def verify(
        self, db: AsyncSession, *, corp_id: str, wecom_user_id: str
    ) -> WecomIdentityBinding | None:
        """校验绑定：刷新 ``last_verified_at``（人工触发的“仍然有效”确认）。

        只对已存在的绑定生效；不存在返回 ``None``。
        """
        from src.models.wecom_binding import utcnow

        binding = await self._get_binding(db, corp_id.strip(), wecom_user_id.strip())
        if binding is None:
            return None
        binding.last_verified_at = utcnow()
        await db.flush()
        return binding

    async def backfill_from_entries(
        self,
        db: AsyncSession,
        *,
        corp_id: str,
        tenant_id: int,
        entries: list[tuple[str, str]],
    ) -> dict[str, int]:
        """P5 组织架构同步回填：按 ``(wecom_user_id, phone)`` 批量发现未绑定用户。

        与首次入站自动绑定的规则完全一致：**只对未绑定用户、手机号 exact-one**
        才落 ``sync`` 绑定；绝不覆盖 ``manual`` / ``disabled``，也不为 0 个 / 多个
        命中建立绑定（不越权）。

        Args:
            db: 异步 session。
            corp_id: 企微企业 ID。
            tenant_id: 对应 MIS 租户。
            entries: ``[(wecom_user_id, phone), ...]``（来自通讯录同步）。

        Returns:
            计数：``{"bound", "skipped", "conflict", "unmatched"}``。
        """
        from src.models.wecom_binding import BIND_SOURCE_SYNC

        result = {"bound": 0, "skipped": 0, "conflict": 0, "unmatched": 0}
        corp = self._corp_store.get(corp_id)
        if corp is not None and corp.user_bind_mode == "disabled":
            result["skipped"] = len(entries)
            return result
        for wecom_user_id, phone in entries:
            uid = (wecom_user_id or "").strip()
            if not uid:
                result["skipped"] += 1
                continue
            existing = await self._get_binding(db, corp_id, uid)
            if existing is not None:
                result["skipped"] += 1
                continue
            if not phone:
                result["unmatched"] += 1
                continue
            lookup = await self._phone_lookup.lookup(tenant_id, phone)
            if not lookup.matched or lookup.user_id is None:
                result["unmatched"] += 1
                continue
            existing_mis = await self._get_binding_by_mis(db, corp_id, int(lookup.user_id))
            if existing_mis is not None and existing_mis.wecom_user_id != uid:
                result["conflict"] += 1
                continue
            await self._create_binding(
                db,
                corp_id=corp_id,
                wecom_user_id=uid,
                tenant_id=tenant_id,
                mis_user_id=int(lookup.user_id),
                source=BIND_SOURCE_SYNC,
                phone=phone,
            )
            result["bound"] += 1
        return result

    async def manual_bind(
        self,
        db: AsyncSession,
        *,
        corp_id: str,
        wecom_user_id: str,
        tenant_id: int,
        mis_user_id: int,
        phone: str = "",
    ) -> WecomIdentityBinding:
        """人工绑定（``manual``）：优先级最高，可覆盖既有 ``auto_phone``。"""
        existing = await self._get_binding(db, corp_id, wecom_user_id)
        if existing is not None:
            existing.tenant_id = tenant_id
            existing.mis_user_id = mis_user_id
            existing.bind_source = BIND_SOURCE_MANUAL
            existing.status = BIND_STATUS_ACTIVE
            if phone:
                existing.phone_hash = phone_hash(phone)
                existing.phone_masked = mask_phone(phone)
            await db.flush()
            return existing
        return await self._create_binding(
            db,
            corp_id=corp_id,
            wecom_user_id=wecom_user_id,
            tenant_id=tenant_id,
            mis_user_id=mis_user_id,
            source=BIND_SOURCE_MANUAL,
            phone=phone,
        )

    # ------------------------------------------------------------------ 内部

    async def _get_binding(
        self, db: AsyncSession, corp_id: str, wecom_user_id: str
    ) -> WecomIdentityBinding | None:
        result = await db.execute(
            select(WecomIdentityBinding).where(
                WecomIdentityBinding.corp_id == corp_id,
                WecomIdentityBinding.wecom_user_id == wecom_user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _get_binding_by_mis(
        self, db: AsyncSession, corp_id: str, mis_user_id: int
    ) -> WecomIdentityBinding | None:
        result = await db.execute(
            select(WecomIdentityBinding).where(
                WecomIdentityBinding.corp_id == corp_id,
                WecomIdentityBinding.mis_user_id == mis_user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _create_binding(
        self,
        db: AsyncSession,
        *,
        corp_id: str,
        wecom_user_id: str,
        tenant_id: int,
        mis_user_id: int,
        source: str,
        phone: str = "",
    ) -> WecomIdentityBinding:
        from src.models.wecom_binding import utcnow

        binding = WecomIdentityBinding(
            corp_id=corp_id,
            wecom_user_id=wecom_user_id,
            tenant_id=tenant_id,
            mis_user_id=mis_user_id,
            bind_source=source,
            status=BIND_STATUS_ACTIVE,
            phone_hash=phone_hash(phone) if phone else None,
            phone_masked=mask_phone(phone) if phone else None,
            last_verified_at=utcnow(),
        )
        db.add(binding)
        await db.flush()
        logger.info(
            "Wecom identity bound",
            corp_id=corp_id,
            wecom_user_id=wecom_user_id,
            mis_user_id=mis_user_id,
            source=source,
        )
        return binding
