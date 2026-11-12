"""企微企业配置（方案 B，#64–#70）路由测试。

覆盖：企业 CRUD、corpsecret 写入（明文永不回传）、连通性测试、密钥状态判定。
用 FastAPI TestClient 驱动 ``channels_router``，mock ``WecomCorpStore`` 与
``WecomCorpSecretService``，**不读写真实 configs / 不连真实企微**。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.api.routes.channels as channels_mod
from src.api.deps import get_current_user
from src.api.routes.channels import router
from src.channels.wecom_corp_store import (
    WecomCorpNotFoundError,
    WecomCorpRecord,
)


def _record(
    corp_id: str = "ww-1",
    tenant_id: int = 1,
    name: str = "集团总部",
    secret_ref: str = "secret://wecom/corp/ww-1",
    user_bind_mode: str = "auto_phone",
) -> WecomCorpRecord:
    return WecomCorpRecord(
        corp_id=corp_id,
        tenant_id=tenant_id,
        name=name,
        secret_ref=secret_ref,
        user_bind_mode=user_bind_mode,
    )


@pytest.fixture
def corp_client(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, MagicMock, MagicMock]:
    """最小 App + 替身 corp store / secret service。

    Returns:
        ``(client, corp_store, secret_service)``。
    """
    corp_store = MagicMock()
    corp_store.get = MagicMock(return_value=_record())
    corp_store.list_corps = MagicMock(return_value=[_record()])
    corp_store.list_wire = MagicMock(
        return_value=[
            {
                "corp_id": "ww-1",
                "tenant_id": 1,
                "name": "集团总部",
                "secret_ref": "secret://wecom/corp/ww-1",
                "secret_ref_kind": "vault",
                "secret_configured": True,
                "user_bind_mode": "auto_phone",
            }
        ]
    )
    corp_store.create = AsyncMock(return_value=_record(corp_id="ww-2"))
    corp_store.update = AsyncMock(return_value=_record(name="改名后"))
    corp_store.delete = AsyncMock(return_value=True)

    secret_service = MagicMock()
    secret_service.configured_map = AsyncMock(return_value={"ww-1": True})
    secret_service.set_secret = AsyncMock(return_value=None)
    secret_service.delete_secret = AsyncMock(return_value=True)

    monkeypatch.setattr(channels_mod, "get_wecom_corp_store", lambda: corp_store)
    monkeypatch.setattr(channels_mod, "WecomCorpSecretService", lambda: secret_service)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app), corp_store, secret_service


def test_list_corps_includes_secret_status_without_plaintext(
    corp_client: tuple[TestClient, MagicMock, MagicMock],
) -> None:
    client, _, _ = corp_client
    resp = client.get("/api/v1/channels/wecom/corps")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    item = body["data"][0]
    assert item["corp_id"] == "ww-1"
    assert item["secret_configured"] is True
    assert item["secret_ref_kind"] == "vault"
    # 明文 corpsecret 绝不出现在响应里
    assert "corpsecret" not in item


def test_create_corp_returns_traceable_secret_ref(
    corp_client: tuple[TestClient, MagicMock, MagicMock],
) -> None:
    client, corp_store, _ = corp_client
    resp = client.post(
        "/api/v1/channels/wecom/corps",
        json={"corp_id": "ww-2", "tenant_id": 1, "name": "新企业", "user_bind_mode": "auto_phone"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["corp_id"] == "ww-2"
    assert body["data"]["secret_ref"].startswith("secret://wecom/corp/")
    corp_store.create.assert_awaited()


def test_update_corp_passes_through(
    corp_client: tuple[TestClient, MagicMock, MagicMock],
) -> None:
    client, _, _ = corp_client
    resp = client.put("/api/v1/channels/wecom/corps/ww-1", json={"name": "改名后"})
    assert resp.status_code == 200
    assert resp.json()["data"]["name"] == "改名后"


def test_set_secret_does_not_echo_plaintext(
    corp_client: tuple[TestClient, MagicMock, MagicMock],
) -> None:
    client, _, secret_service = corp_client
    resp = client.put(
        "/api/v1/channels/wecom/corps/ww-1/secret",
        json={"corpsecret": "super-secret-value"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["secret_configured"] is True
    assert "super-secret-value" not in resp.text
    secret_service.set_secret.assert_awaited_once_with("ww-1", "super-secret-value")


def test_set_secret_404_when_corp_missing(
    corp_client: tuple[TestClient, MagicMock, MagicMock],
) -> None:
    client, corp_store, _ = corp_client
    corp_store.get = MagicMock(return_value=None)
    resp = client.put(
        "/api/v1/channels/wecom/corps/ww-missing/secret",
        json={"corpsecret": "x"},
    )
    assert resp.status_code == 404


def test_delete_secret(
    corp_client: tuple[TestClient, MagicMock, MagicMock],
) -> None:
    client, _, secret_service = corp_client
    resp = client.delete("/api/v1/channels/wecom/corps/ww-1/secret")
    assert resp.status_code == 200
    assert resp.json()["data"]["secret_deleted"] is True
    secret_service.delete_secret.assert_awaited_once_with("ww-1")


def test_delete_corp_with_secret_flag(
    corp_client: tuple[TestClient, MagicMock, MagicMock],
) -> None:
    client, corp_store, secret_service = corp_client
    resp = client.delete("/api/v1/channels/wecom/corps/ww-1?delete_secret=true")
    assert resp.status_code == 200
    assert resp.json()["data"]["deleted"] is True
    assert resp.json()["data"]["secret_deleted"] is True
    secret_service.delete_secret.assert_awaited_once_with("ww-1")


def test_test_corp_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    corp_store = MagicMock()
    corp_store.get = MagicMock(return_value=_record())
    monkeypatch.setattr(channels_mod, "get_wecom_corp_store", lambda: corp_store)

    contacts = MagicMock()
    contacts.check_connection = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "src.channels.wecom_contacts_client.WecomContactsClient", lambda: contacts
    )

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    client = TestClient(app)

    resp = client.post("/api/v1/channels/wecom/corps/ww-1/test")
    assert resp.status_code == 200
    assert resp.json()["data"]["ok"] is True
    contacts.check_connection.assert_awaited_once_with("ww-1")
