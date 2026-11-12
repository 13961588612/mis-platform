"""AiReportClient 直连 BFF 时须补 Gateway 身份头。"""

from __future__ import annotations

import base64
import json

from src.adapters.ai_report_client import (
    AiReportCallContext,
    AiReportClient,
    decode_mis_jwt_claims,
    gateway_identity_headers_from_claims,
)


def _fake_jwt(payload: dict) -> str:
    def seg(obj: dict | list) -> str:
        raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f"{seg({'alg': 'RS256'})}.{seg(payload)}.sig"


def test_decode_mis_jwt_claims_admin() -> None:
    token = _fake_jwt(
        {
            "sub": "1",
            "tenantId": 1,
            "appId": 1,
            "employeeId": 1,
            "username": "admin",
        }
    )
    claims = decode_mis_jwt_claims(f"Bearer {token}")
    assert claims["sub"] == "1"
    assert claims["username"] == "admin"


def test_gateway_identity_headers_from_claims() -> None:
    headers = gateway_identity_headers_from_claims(
        {
            "sub": "1",
            "tenantId": 1,
            "appId": 1,
            "employeeId": 9,
            "username": "admin",
        }
    )
    assert headers == {
        "X-User-Id": "1",
        "X-Tenant-Id": "1",
        "X-App-Id": "1",
        "X-Employee-Id": "9",
        "X-Username": "admin",
    }


def test_headers_with_jwt_include_gateway_identity(monkeypatch) -> None:
    monkeypatch.setenv("MIS_ADMIN_BFF_BASE_URL", "http://127.0.0.1:8081")
    monkeypatch.setenv("AI_PLATFORM_BFF_SHARED_SECRET", "")
    # 重新读 settings 较重；直接构造后打补丁
    client = AiReportClient(base_url="http://127.0.0.1:8081")
    client._platform_token = ""
    token = _fake_jwt(
        {
            "sub": "1",
            "tenantId": 1,
            "appId": 1,
            "employeeId": 1,
            "username": "admin",
        }
    )
    headers = client._headers(AiReportCallContext(authorization=token))
    assert headers["Authorization"].startswith("Bearer ")
    assert headers["X-User-Id"] == "1"
    assert headers["X-Tenant-Id"] == "1"
    assert headers["X-App-Id"] == "1"
    assert headers["X-Username"] == "admin"
    assert "X-Platform-Token" not in headers


def test_headers_fallback_user_id_when_claims_thin(monkeypatch) -> None:
    client = AiReportClient(base_url="http://127.0.0.1:8081")
    client._platform_token = ""
    token = _fake_jwt({"iss": "mis-platform"})
    headers = client._headers(
        AiReportCallContext(authorization=token, mis_user_id=42)
    )
    assert headers["X-User-Id"] == "42"
