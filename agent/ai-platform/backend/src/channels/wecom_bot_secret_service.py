"""企微 Bot 密钥管理服务 —— 对齐 ``WecomCorpSecretService`` 的做法。

Bot 长连接 Secret（``aibot_subscribe`` 的鉴权密钥）**不落 YAML、不落日志、不回传前端**：
经 :class:`~src.identity.credential_vault.CredentialVault` 用 AES-256-GCM 加密存到
``ai_platform.credential_mappings``（``system_type='wecom_bot'``，
``system_account='secret://wecom/bot/<bot_id>'``）；YAML 的 ``secret_ref`` 只写规范引用。

与 corp 版的差异：bot 密钥存在**历史明文**（升级前 ``wecom-bots.yaml`` 直接写了
``secret: <明文>``）。为不使升级即失联，:meth:`resolve_secret` 对非 Vault 引用沿用
原语义（明文直用 / ``env:<NAME>`` 读环境变量）；历史明文在运营台下次保存该 Bot
时经 :meth:`set_secret` 收编进 Vault。
"""

from __future__ import annotations

import os

import structlog

from src.channels.wecom_bot_store import (
    SECRET_REF_PREFIX,
    WecomBotRecord,
    WecomBotStore,
)
from src.identity.credential_vault import CredentialVault

logger = structlog.get_logger(__name__)

#: 凭据归类，便于在 ``credential_mappings`` 里和 corp / 问数连接凭据区分。
SYSTEM_TYPE = "wecom_bot"


class WecomBotSecretService:
    """Bot 长连接 Secret 的配置 / 查询 / 删除（明文只在内存瞬时存在）。"""

    def __init__(
        self,
        *,
        vault: CredentialVault | None = None,
        bot_store: WecomBotStore | None = None,
    ) -> None:
        """初始化服务。

        Args:
            vault: 凭据保险库；缺省用默认真实实现。
            bot_store: Bot 配置存储；缺省用全局单例。
        """
        from src.channels.wecom_bot_store import get_wecom_bot_store

        self._vault: CredentialVault = vault or CredentialVault()
        self._bot_store: WecomBotStore = bot_store or get_wecom_bot_store()

    async def set_secret(self, bot_id: str, secret: str) -> None:
        """写入 / 覆盖某 Bot 的密钥（整体覆盖，不留旧值），并把 YAML 引用指向 Vault。

        Args:
            bot_id: 平台内部 Bot ID。
            secret: 明文密钥。

        Raises:
            ValueError: ``secret`` 为空。
            WecomBotNotFoundError: Bot 不存在。
        """
        value = (secret or "").strip()
        if not value:
            raise ValueError("secret 不能为空")
        ref = canonical_secret_ref(bot_id)
        from src.db.session import db_session_context

        async with db_session_context() as session:
            await self._vault.upsert_by_ref(session, ref, SYSTEM_TYPE, {"secret": value})
        # 确保 YAML 里的引用指向规范 vault 引用（首次配密钥时写回）。
        record = self._try_get_record(bot_id)
        if record is not None and record.secret_ref != ref:
            await self._bot_store.set_secret_ref(bot_id, ref)
        logger.info("Wecom bot secret stored", bot_id=bot_id)

    async def delete_secret(self, bot_id: str) -> bool:
        """软删除某 Bot 的密钥（``is_active=False``）。

        Args:
            bot_id: 平台内部 Bot ID。

        Returns:
            实际删除返回 ``True``；不存在返回 ``False``。
        """
        ref = canonical_secret_ref(bot_id)
        from src.db.session import db_session_context

        async with db_session_context() as session:
            deleted = await self._vault.delete_by_ref(session, ref)
        logger.info("Wecom bot secret deleted", bot_id=bot_id, deleted=deleted)
        return deleted

    async def resolve_secret(self, bot_id: str) -> str:
        """解析明文密钥（仅运行时内部使用，绝不回传前端）。

        引用语义：

        * ``secret://wecom/bot/<bot_id>`` ⇒ 走 Vault 解密；
        * ``env:<NAME>`` ⇒ 读该环境变量（部署侧手工管理）；
        * 其它非空字符串 ⇒ 视为明文（历史数据 / 部署侧手工写）。

        Args:
            bot_id: 平台内部 Bot ID。

        Returns:
            明文密钥；Bot 不存在 / 解析失败返回空串（调用方据此 fail-closed）。
        """
        record: WecomBotRecord | None = self._try_get_record(bot_id)
        if record is None:
            return ""
        ref = (record.secret_ref or "").strip()
        if ref.startswith("secret://"):
            # 只接受本类型的规范引用前缀：误填 corp 前缀会解出 {"corpsecret": ...}
            # 而拿不到 "secret"，静默返回空串。显式告警便于定位。
            if not ref.startswith(SECRET_REF_PREFIX):
                logger.warning(
                    "Wecom bot secret_ref has foreign vault prefix",
                    bot_id=bot_id,
                    expected_prefix=SECRET_REF_PREFIX,
                )
                return ""
            try:
                credential = await self._vault.resolve_by_ref(ref)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Wecom bot secret resolve failed", bot_id=bot_id, error=str(exc)
                )
                return ""
            if not credential:
                return ""
            return str(credential.get("secret") or "").strip()
        if ref.startswith("env:"):
            return (os.environ.get(ref[len("env:") :].strip()) or "").strip()
        # 历史明文：升级前直接写在 YAML 里的 secret。
        return ref

    def _try_get_record(self, bot_id: str) -> WecomBotRecord | None:
        """容错取记录：不存在返回 ``None`` 而非抛异常。

        ``WecomBotStore.get_record`` 找不到时抛 :class:`WecomBotNotFoundError`；
        本服务多处只需「有则处理、无则跳过」，故统一走这里。

        Args:
            bot_id: 平台内部 Bot ID。

        Returns:
            记录副本；不存在返回 ``None``。
        """
        from src.channels.wecom_bot_store import WecomBotNotFoundError

        try:
            return self._bot_store.get_record(bot_id)
        except WecomBotNotFoundError:
            return None


def canonical_secret_ref(bot_id: str) -> str:
    """返回某 Bot 的规范密钥引用（``secret://wecom/bot/<bot_id>``）。

    Args:
        bot_id: 平台内部 Bot ID。

    Returns:
        规范引用字符串。
    """
    return f"{SECRET_REF_PREFIX}{(bot_id or '').strip()}"
