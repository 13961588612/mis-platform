"""企微通讯录客户端 —— 按 corp 取成员手机号（仅用于首次绑定兜底）。

依据 ``wecom-user-binding-design.md`` §8.2 / §9.2 Step 6。这里的目标很窄：
给定 ``corp_id`` + ``wecom_user_id``，用该 corp 的应用 ``corpsecret`` 换
``access_token``，再调 ``user/get`` 取 ``mobile``。

与 ``identity/auth.py::WeComClient`` 的区别：后者用的是**全局单 corp**
``WECOM_CORP_ID`` / ``WECOM_SECRET``，多 corp 场景下会把 A 企业的凭证
套到 B 企业上。本客户端严格按 ``WecomCorpRecord`` 取对应 corp 的
access_token，且 token 按 corp 分别缓存。
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

from src.channels.wecom_corp_store import (
    WecomCorpRecord,
    WecomCorpStore,
    get_wecom_corp_store,
)

logger = structlog.get_logger(__name__)

#: 企微 API 基址。
WECOM_API_BASE: str = "https://qyapi.weixin.qq.com/cgi-bin"

#: access_token 提前刷新余量（秒）。
_TOKEN_REFRESH_MARGIN: float = 300.0


async def resolve_corp_secret(corp: WecomCorpRecord) -> str:
    """解析 corp 的 ``secret_ref``，得到 corpsecret 明文。

    解析规则（按前缀分派，**互不串用**）：

    - ``secret://...`` ⇒ 走 :class:`~src.identity.credential_vault.CredentialVault`
      按引用解密（运营台配置的密钥走这条）。**解析不到即返回空串（fail-closed）**，
      不回退全局 —— 显式引用代表「这个 corp 就该用这把密钥」，回退会让多 corp
      静默串用凭证。
    - ``env:<NAME>`` ⇒ 读环境变量 ``<NAME>``。
    - 其它非空字面量 ⇒ 视为明文 corpsecret 直接返回。
    - ``""`` ⇒ 回退全局 ``WECOM_SECRET``（单企业 MVP 兜底）。

    Returns:
        corpsecret 明文；解析不到时返回空串（调用方 fail-closed）。
    """
    import os

    ref = (corp.secret_ref or "").strip()
    if ref.startswith("secret://"):
        from src.identity.credential_vault import CredentialVault

        try:
            credential = await CredentialVault().resolve_by_ref(ref)
        except Exception as exc:  # noqa: BLE001 - vault 不可用一律 fail-closed
            logger.warning(
                "Wecom corp secret vault resolve failed", corp_id=corp.corp_id, error=str(exc)
            )
            return ""
        if not credential:
            logger.warning(
                "Wecom corp secret not found in vault", corp_id=corp.corp_id, ref=ref
            )
            return ""
        return str(credential.get("corpsecret") or "").strip()
    if ref.startswith("env:"):
        name = ref[len("env:") :].strip()
        if name:
            return str(os.environ.get(name) or "").strip()
        return ""
    if ref:
        return ref
    from src.config import get_settings

    return str(get_settings().WECOM_SECRET or "").strip()


class WecomContactsClient:
    """按 ``corp_id`` 取通讯录成员信息的轻量客户端（fail-soft）。"""

    def __init__(self, store: WecomCorpStore | None = None) -> None:
        """初始化。

        Args:
            store: corp 配置来源；``None`` 时用进程级单例。
        """
        self._store: WecomCorpStore = store or get_wecom_corp_store()
        self._token_cache: dict[str, tuple[str, float]] = {}

    async def _access_token(self, corp: WecomCorpRecord) -> str:
        """取该 corp 的 access_token（带缓存）。失败返回空串。"""
        now = time.time()
        cached = self._token_cache.get(corp.corp_id)
        if cached and now < cached[1] - _TOKEN_REFRESH_MARGIN:
            return cached[0]
        secret = await resolve_corp_secret(corp)
        if not corp.corp_id or not secret:
            logger.warning(
                "Wecom contacts token skipped: missing corp_id or corpsecret",
                corp_id=corp.corp_id,
            )
            return ""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{WECOM_API_BASE}/gettoken",
                    params={"corpid": corp.corp_id, "corpsecret": secret},
                )
                resp.raise_for_status()
                data: Any = resp.json()
        except Exception as exc:  # noqa: BLE001 - 取 token 失败一律 fail-soft
            logger.warning(
                "Wecom contacts gettoken failed", corp_id=corp.corp_id, error=str(exc)
            )
            return ""
        if data.get("errcode", 0) != 0 or not data.get("access_token"):
            logger.warning(
                "Wecom contacts gettoken rejected",
                corp_id=corp.corp_id,
                errcode=data.get("errcode"),
                errmsg=data.get("errmsg"),
            )
            return ""
        token = str(data["access_token"])
        expires_in = float(data.get("expires_in") or 7200)
        self._token_cache[corp.corp_id] = (token, now + expires_in)
        return token

    async def check_connection(self, corp_id: str) -> bool:
        """连通性 / 凭证测试：用该 corp 的 corpsecret 换一次 access_token。

        Returns:
            `True` 表示 gettoken 成功（凭证有效且企微可达）。
        """
        corp = self._store.get(corp_id)
        if corp is None:
            return False
        token = await self._access_token(corp)
        return bool(token)

    async def get_user_mobile(self, corp_id: str, wecom_user_id: str) -> str:
        """取 ``corp_id + wecom_user_id`` 对应成员的手机号。

        任何失败都返回空串（调用方据此 fail-closed），不抛异常。
        """
        if not corp_id or not wecom_user_id:
            return ""
        corp = self._store.get(corp_id)
        if corp is None:
            return ""
        token = await self._access_token(corp)
        if not token:
            return ""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{WECOM_API_BASE}/user/get",
                    params={"access_token": token, "userid": wecom_user_id},
                )
                resp.raise_for_status()
                data: Any = resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Wecom contacts user/get failed",
                corp_id=corp_id,
                wecom_user_id=wecom_user_id,
                error=str(exc),
            )
            return ""
        if data.get("errcode", 0) != 0:
            logger.warning(
                "Wecom contacts user/get rejected",
                corp_id=corp_id,
                wecom_user_id=wecom_user_id,
                errcode=data.get("errcode"),
                errmsg=data.get("errmsg"),
            )
            return ""
        return str(data.get("mobile") or "").strip()

    async def list_all_users(self, corp_id: str) -> list[tuple[str, str]]:
        """列出该 corp 下所有成员的 ``(userid, mobile)``（P5 回填用）。

        使用 ``user/list?department_id=1&fetch_child=1``：从根部门递归拉取。
        ``mobile`` 是否返回取决于应用可见范围与字段权限，拿不到时为空串
        （回填逻辑会把它计入 unmatched，不会越权绑定）。

        任何失败都返回空列表（fail-soft），不抛异常。
        """
        if not corp_id:
            return []
        corp = self._store.get(corp_id)
        if corp is None:
            return []
        token = await self._access_token(corp)
        if not token:
            return []
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{WECOM_API_BASE}/user/list",
                    params={
                        "access_token": token,
                        "department_id": 1,
                        "fetch_child": 1,
                    },
                )
                resp.raise_for_status()
                data: Any = resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Wecom contacts user/list failed", corp_id=corp_id, error=str(exc)
            )
            return []
        if data.get("errcode", 0) != 0:
            logger.warning(
                "Wecom contacts user/list rejected",
                corp_id=corp_id,
                errcode=data.get("errcode"),
                errmsg=data.get("errmsg"),
            )
            return []
        users = data.get("userlist") or []
        out: list[tuple[str, str]] = []
        for item in users:
            if not isinstance(item, dict):
                continue
            uid = str(item.get("userid") or "").strip()
            if not uid:
                continue
            out.append((uid, str(item.get("mobile") or "").strip()))
        return out
