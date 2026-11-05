"""mis-ai-template-report 运行时客户端（经 mis-admin-bff）。

对齐前端 ``/api/v1/ai-reports/{catalog,prepare-card,execute}``。

直连 BFF（``:8081``）时：``GatewayContextFilter`` **只认** ``X-User-Id`` 等
网关透传头建登录态，**不会**用 ``Authorization`` Bearer 验签。因此：

- 有端用户 JWT 时：仍带 ``Authorization``（供下游捕获），并解析 claims 写入
  ``X-User-Id`` / ``X-Tenant-Id`` / ``X-App-Id`` / ``X-Employee-Id`` / ``X-Username``
  （与 mis-gateway 转发头对齐；JWT 来自会话 genuine 上游票，不在此验签）。
- 无 JWT 时：带 ``X-Platform-Token`` + ``X-User-Id``（依赖 BFF 反代信任配置）。
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("adapters.ai_report_client")

CATALOG_PATH = "/api/v1/ai-reports/catalog"
PREPARE_CARD_PATH = "/api/v1/ai-reports/prepare-card"
EXECUTE_PATH = "/api/v1/ai-reports/execute"


class AiReportClientError(RuntimeError):
    """模板报告 API 调用失败。"""

    def __init__(self, message: str, *, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class AiReportCallContext:
    """一次调用的身份上下文。"""

    authorization: str = ""
    user_id: str = ""
    mis_user_id: int | None = None
    trace_id: str = ""
    extra_headers: dict[str, str] = field(default_factory=dict)


def _b64url_json(segment: str) -> dict[str, Any] | None:
    """解码 JWT 中间段（payload）；失败返回 None。"""
    raw = (segment or "").strip()
    if not raw:
        return None
    pad = "=" * ((4 - len(raw) % 4) % 4)
    try:
        data = base64.urlsafe_b64decode(raw + pad)
        obj = json.loads(data.decode("utf-8"))
    except Exception:  # noqa: BLE001 - 坏票时降级到 ctx 字段
        return None
    return obj if isinstance(obj, dict) else None


def decode_mis_jwt_claims(authorization: str) -> dict[str, Any]:
    """从 ``Bearer <jwt>`` / 裸 jwt 解出 claims（不验签）。"""
    token = (authorization or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    return _b64url_json(parts[1]) or {}


def gateway_identity_headers_from_claims(
    claims: dict[str, Any],
    *,
    fallback_user_id: str = "",
) -> dict[str, str]:
    """把 MIS JWT claims 映射为 Gateway 透传头（供 BFF GatewayContextFilter）。"""
    headers: dict[str, str] = {}
    uid = str(claims.get("sub") or fallback_user_id or "").strip()
    if uid:
        headers["X-User-Id"] = uid
    for claim_key, header_name in (
        ("tenantId", "X-Tenant-Id"),
        ("appId", "X-App-Id"),
        ("employeeId", "X-Employee-Id"),
    ):
        val = claims.get(claim_key)
        if val is not None and str(val).strip() != "":
            headers[header_name] = str(val).strip()
    username = claims.get("username")
    if username is not None and str(username).strip():
        headers["X-Username"] = str(username).strip()
    return headers


class AiReportClient:
    """异步客户端：catalog / prepare-card / execute。"""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        settings = get_settings()
        self._base_url = (
            base_url or settings.MIS_ADMIN_BFF_BASE_URL or ""
        ).rstrip("/")
        self._timeout = timeout
        self._platform_token = str(
            getattr(settings, "AI_PLATFORM_BFF_SHARED_SECRET", "") or ""
        ).strip()

    def _headers(self, ctx: AiReportCallContext) -> dict[str, str]:
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        auth = (ctx.authorization or "").strip()
        fallback_uid = str(ctx.mis_user_id or ctx.user_id or "").strip()
        if auth:
            if not auth.lower().startswith("bearer "):
                auth = f"Bearer {auth}"
            headers["Authorization"] = auth
            claims = decode_mis_jwt_claims(auth)
            identity = gateway_identity_headers_from_claims(
                claims, fallback_user_id=fallback_uid
            )
            if not identity.get("X-User-Id") and fallback_uid:
                identity["X-User-Id"] = fallback_uid
            if not identity.get("X-User-Id"):
                logger.warning(
                    "ai_report_client: JWT present but no X-User-Id "
                    "(claims/fallback empty); BFF will return 401"
                )
            headers.update(identity)
        elif self._platform_token:
            headers["X-Platform-Token"] = self._platform_token
            if fallback_uid:
                headers["X-User-Id"] = fallback_uid
        if ctx.trace_id:
            headers["X-Trace-Id"] = ctx.trace_id
        for key, value in (ctx.extra_headers or {}).items():
            if key and value:
                headers[str(key)] = str(value)
        # 诊断用：不打印 token 正文
        logger.info(
            "ai_report_client headers",
            has_authorization=bool(headers.get("Authorization")),
            has_x_user_id=bool(headers.get("X-User-Id")),
            has_platform_token=bool(headers.get("X-Platform-Token")),
            x_user_id=headers.get("X-User-Id") or None,
            auth_mode=(
                "jwt"
                if headers.get("Authorization")
                else ("platform_token" if headers.get("X-Platform-Token") else "none")
            ),
        )
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        ctx: AiReportCallContext,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        if not self._base_url:
            raise AiReportClientError("MIS_ADMIN_BFF_BASE_URL empty")
        url = f"{self._base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.request(
                    method,
                    url,
                    headers=self._headers(ctx),
                    json=json_body,
                )
                resp.raise_for_status()
                body = resp.json()
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            detail = ""
            try:
                detail = str(exc.response.json())
            except Exception:  # noqa: BLE001
                detail = (exc.response.text or "")[:200]
            raise AiReportClientError(
                f"HTTP {code}: {detail or exc}", code=code
            ) from exc
        except Exception as exc:  # noqa: BLE001
            raise AiReportClientError(str(exc)) from exc

        if not isinstance(body, dict):
            raise AiReportClientError("invalid response envelope")
        biz_code = body.get("code")
        if biz_code not in (0, "0", None):
            raise AiReportClientError(
                str(body.get("message") or f"biz code={biz_code}"),
                code=int(biz_code) if str(biz_code).isdigit() else None,
            )
        return body.get("data")

    async def catalog(self, ctx: AiReportCallContext) -> list[dict[str, Any]]:
        """拉取用户可见模板报告目录。"""
        data = await self._request("GET", CATALOG_PATH, ctx)
        return data if isinstance(data, list) else []

    async def prepare_card(
        self, ctx: AiReportCallContext, report_code: str
    ) -> dict[str, Any]:
        """准备参数卡（含槽位 options）。"""
        data = await self._request(
            "POST",
            PREPARE_CARD_PATH,
            ctx,
            json_body={"reportCode": report_code},
        )
        return data if isinstance(data, dict) else {}

    async def execute(
        self,
        ctx: AiReportCallContext,
        report_code: str,
        params: dict[str, str],
    ) -> dict[str, Any]:
        """执行模板报告。"""
        data = await self._request(
            "POST",
            EXECUTE_PATH,
            ctx,
            json_body={"reportCode": report_code, "params": params},
        )
        return data if isinstance(data, dict) else {}
