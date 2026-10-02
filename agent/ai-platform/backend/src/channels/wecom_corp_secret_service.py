"""企微 corp 密钥管理服务（方案 B：运营台可管企业清单 + 密钥）。

密钥（corpsecret）**不落 YAML、不落日志、不回传前端**：经
:class:`~src.identity.credential_vault.CredentialVault` 用 AES-256-GCM 加密存到
``ai_platform.credential_mappings``（``system_type='wecom_corp'``，
``system_account='secret://wecom/corp/<corp_id>'``）；YAML 的 ``secret_ref``
只写规范引用。

运营台读接口只回「是否已配置 / 引用类型」，绝不回明文；更新时密码留空 = 不修改。
"""

from __future__ import annotations

from typing import Any

import structlog

from src.channels.wecom_corp_store import (
    SECRET_REF_PREFIX,
    WecomCorpRecord,
    WecomCorpStore,
    canonical_secret_ref,
)
from src.identity.credential_vault import CredentialVault

logger = structlog.get_logger(__name__)

#: 凭据归类，便于在 ``credential_mappings`` 里和问数连接凭据区分。
SYSTEM_TYPE = "wecom_corp"


class WecomCorpSecretService:
    """企业 corpsecret 的配置 / 查询 / 删除（明文只在内存瞬时存在）。"""

    def __init__(
        self,
        *,
        vault: CredentialVault | None = None,
        corp_store: WecomCorpStore | None = None,
    ) -> None:
        from src.channels.wecom_corp_store import get_wecom_corp_store

        self._vault: CredentialVault = vault or CredentialVault()
        self._corp_store: WecomCorpStore = corp_store or get_wecom_corp_store()

    async def is_configured(self, corp_id: str) -> bool:
        """判断某 corp 的密钥是否已在 Vault 配置（不解密、只判存在）。"""
        ref = canonical_secret_ref(corp_id)
        try:
            credential = await self._vault.resolve_by_ref(ref)
        except Exception as exc:  # noqa: BLE001 - 查询失败按未配置处理
            logger.warning("Wecom corp secret check failed", corp_id=corp_id, error=str(exc))
            return False
        return bool(credential and credential.get("corpsecret"))

    async def configured_map(self, corp_ids: list[str]) -> dict[str, bool]:
        """批量判断多个 corp 的密钥配置状态。"""
        result: dict[str, bool] = {}
        for corp_id in corp_ids:
            result[corp_id] = await self.is_configured(corp_id)
        return result

    async def set_secret(self, corp_id: str, corpsecret: str) -> None:
        """写入 / 覆盖某 corp 的 corpsecret（整体覆盖，不留旧值）。

        Raises:
            ValueError: ``corpsecret`` 为空。
        """
        secret = (corpsecret or "").strip()
        if not secret:
            raise ValueError("corpsecret 不能为空")
        ref = canonical_secret_ref(corp_id)
        from src.db.session import db_session_context

        async with db_session_context() as session:
            await self._vault.upsert_by_ref(
                session, ref, SYSTEM_TYPE, {"corpsecret": secret}
            )
        # 确保 YAML 里的引用指向规范 vault 引用（首次配密钥时写回）。
        record = self._corp_store.get(corp_id)
        if record is not None and record.secret_ref != ref:
            await self._corp_store.set_secret_ref(corp_id, ref)
        logger.info("Wecom corp secret stored", corp_id=corp_id)

    async def delete_secret(self, corp_id: str) -> bool:
        """软删除某 corp 的密钥（``is_active=False``）；不存在返回 ``False``。"""
        ref = canonical_secret_ref(corp_id)
        from src.db.session import db_session_context

        async with db_session_context() as session:
            deleted = await self._vault.delete_by_ref(session, ref)
        logger.info("Wecom corp secret deleted", corp_id=corp_id, deleted=deleted)
        return deleted

    async def resolve_secret(self, corp_id: str) -> str:
        """解析明文 corpsecret（仅运行时内部使用，绝不回传前端）。

        兼容部署侧 ``env:`` / 明文 / 留空引用：非 Vault 引用仍按原语义解析。
        """
        record: WecomCorpRecord | None = self._corp_store.get(corp_id)
        if record is None:
            return ""
        ref = (record.secret_ref or "").strip()
        if ref.startswith(SECRET_REF_PREFIX) or ref.startswith("secret://"):
            try:
                credential = await self._vault.resolve_by_ref(ref)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Wecom corp secret resolve failed", corp_id=corp_id, error=str(exc)
                )
                return ""
            if not credential:
                return ""
            return str(credential.get("corpsecret") or "").strip()
        # 非 Vault 引用：沿用 resolve_corp_secret 的 env/明文/全局语义。
        from src.channels.wecom_contacts_client import resolve_corp_secret

        return await resolve_corp_secret(record)


def system_account_for(corp_id: str) -> str:
    """返回企业密钥在 ``credential_mappings`` 里的 ``system_account``。"""
    return canonical_secret_ref(corp_id)
