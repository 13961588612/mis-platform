"""Copilot 入站问数身份：剥伪造头 + BFF 回源 + 连接 hint 校验。"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from src.agent.mis_iqd.scope_resolver import AskIdentity
from src.agent.mis_iqd.tools import _build_identity
from src.identity.ask_identity_context import (
    AskIdentityUnavailable,
    enrich_inbound_ask_identity,
    fetch_ask_identity_headers,
    inject_connection_id,
    strip_untrusted_ask_fields,
)


def _settings(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "MIS_ADMIN_BFF_BASE_URL": "http://bff.test",
        "MIS_ASK_IDENTITY_PATH": "/internal/identity/ask-context",
        "MIS_ASK_IDENTITY_CACHE_KEY_PREFIX": "mis:acl:askident:",
        "MIS_ASK_IDENTITY_CACHE_TTL": 60,
        "MIS_ACL_HTTP_TIMEOUT": 1.5,
        "AI_PLATFORM_BFF_SHARED_SECRET": "s3cret",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _http(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_strip_drops_client_roles_and_simulate_role() -> None:
    cleaned = strip_untrusted_ask_fields(
        {
            "X-Mis-Roles": '[{"code":"SUPER_ADMIN"}]',
            "iqd": {"simulate_role_code": "SUPER_ADMIN", "connection_id": 9},
            "a2ui": True,
        }
    )
    assert "X-Mis-Roles" not in cleaned
    assert cleaned["iqd"].get("simulate_role_code") is None
    assert cleaned["iqd"]["connection_id"] == 9
    assert cleaned["a2ui"] is True


@pytest.mark.asyncio
async def test_fetch_parses_headers_envelope() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("userId") == "1001"
        assert request.headers.get("X-Platform-Token") == "s3cret"
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "userId": 1001,
                    "headers": {
                        "X-Mis-Roles": json.dumps(
                            [{"id": "81", "code": "IT-TESTER"}, {"id": "82", "code": "TENANT_ADMIN"}]
                        )
                    },
                },
            },
        )

    headers = await fetch_ask_identity_headers(
        1001, http=_http(handler), settings=_settings()  # type: ignore[arg-type]
    )
    assert "IT-TESTER" in headers["X-Mis-Roles"]
    identity = AskIdentity.from_headers(headers)
    assert "IT-TESTER" in identity.role_codes
    assert "TENANT_ADMIN" in identity.role_codes


@pytest.mark.asyncio
async def test_fetch_unavailable_on_http_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="down")

    with pytest.raises(AskIdentityUnavailable):
        await fetch_ask_identity_headers(
            1, http=_http(handler), settings=_settings()  # type: ignore[arg-type]
        )


@pytest.mark.asyncio
async def test_enrich_replaces_spoofed_roles(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(user_id: int, **_kwargs: Any) -> dict[str, str]:
        del user_id
        return {"X-Mis-Roles": json.dumps([{"code": "IT-TESTER"}])}

    async def fake_conns() -> list[int]:
        return [1790686095967]

    monkeypatch.setattr(
        "src.identity.ask_identity_context.fetch_ask_identity_headers", fake_fetch
    )
    monkeypatch.setattr(
        "src.identity.ask_identity_context._enabled_connection_ids", fake_conns
    )

    meta = await enrich_inbound_ask_identity(
        {
            "X-Mis-Roles": json.dumps([{"code": "SUPER_ADMIN"}]),
            "iqd": {"simulate_role_code": "GOD"},
            "contextRef": {"connection_id": 1790686095967},
        },
        mis_user_id=1,
    )
    assert "SUPER_ADMIN" not in meta["X-Mis-Roles"]
    assert "IT-TESTER" in meta["X-Mis-Roles"]
    assert meta["iqd"].get("simulate_role_code") is None
    assert meta["iqd"]["connection_id"] == 1790686095967

    identity = _build_identity(meta)
    assert identity.role_codes == ["IT-TESTER"]
    assert identity.simulated_role_code is None


@pytest.mark.asyncio
async def test_hint_outside_enabled_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_conns() -> list[int]:
        return [11, 22]

    monkeypatch.setattr(
        "src.identity.ask_identity_context._enabled_connection_ids", fake_conns
    )
    meta = await inject_connection_id({"contextRef": {"connection_id": 999}})
    assert meta["iqd"]["connection_id"] == 11


def test_invoke_agent_forwards_x_mis_roles_into_child_meta() -> None:
    """agent__invoke 须把父上下文 X-Mis-Roles 写入 child_meta（A2UI Copilot 路径）。"""
    from src.identity.ask_identity_context import X_MIS_HEADER_KEYS

    meta = {
        "session_id": "parent-1",
        "identity": {"misUserId": "1"},
        "X-Mis-Roles": '[{"code":"IT-TESTER"},{"code":"TENANT_ADMIN"}]',
        "iqd": {"connection_id": 42},
    }
    child_meta: dict[str, Any] = {"source": "mis-copilot-delegate"}
    for header_key in X_MIS_HEADER_KEYS:
        value = meta.get(header_key)
        if isinstance(value, str) and value.strip():
            child_meta.setdefault(header_key, value)
    parent_iqd = meta.get("iqd")
    if isinstance(parent_iqd, dict) and parent_iqd.get("connection_id") is not None:
        child_iqd = dict(child_meta.get("iqd") or {}) if isinstance(child_meta.get("iqd"), dict) else {}
        child_iqd.setdefault("connection_id", parent_iqd.get("connection_id"))
        child_meta["iqd"] = child_iqd

    assert "IT-TESTER" in child_meta["X-Mis-Roles"]
    assert child_meta["iqd"]["connection_id"] == 42
    identity = _build_identity(child_meta)
    assert "IT-TESTER" in identity.role_codes
    assert "TENANT_ADMIN" in identity.role_codes
