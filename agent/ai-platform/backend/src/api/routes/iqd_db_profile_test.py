"""数据库连接配置连通性测试路由（Tab①，2026-09-29）。

BFF → 本路由 → 直连业务库（复用 :class:`DirectDbDiscovery` 的只读探测）→ 回执
``{ok, latency_ms, message}``；BFF 再把结果回写 mis-iqd ``iqd_db_profile.last_test_*``。

为什么放 ai-platform：只有它能拿到 vault 明文密码（mis-iqd 只持 secret_ref），
直连业务库需要真实凭证。与表发现直连同源，避免两套连接实现。
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, Field

from src.agent.mis_iqd.direct_db import DirectDbDiscovery, DirectDbUnavailableError
from src.identity.credential_vault import CredentialVault
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_db_profile_test")

router = APIRouter(prefix="/iqd/db-profiles", tags=["iqd-db-profile"])

INTERNAL_CODE = 9000


class TestDbRequest(BaseModel):
    """连通性测试入参（DB 坐标 + 凭证）。

    密码优先用请求体里的（前端未保存先测用）；未传时用 ``secret_ref``
    从本地 vault 取（已保存的 profile）。二者都没有则报错。
    """

    db_type: str = Field(default="starrocks", description="数据库类型")
    host: str = Field(default="", description="业务库 host")
    port: int | None = Field(default=None, description="业务库 port")
    user: str = Field(default="", description="业务库账号")
    password: str = Field(default="", description="业务库密码（可选；绝不回传/日志）")
    database: str = Field(default="", description="业务库 database")
    secret_ref: str = Field(default="", description="vault 引用；未传 password 时据此从 vault 取密码")


@router.post("/test")
async def test_db_profile(
    req: TestDbRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """直连业务库做一次只读探测（``information_schema``），返回连通性与延迟。"""
    if not req.host or not req.user:
        return error_response(
            code=42200,
            message="host / user 不能为空",
            http_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            trace_id=trace_id,
        )
    password = req.password
    if not password and req.secret_ref:
        # 已保存的 profile：用 secret_ref 从 vault 取明文密码（与表发现直连同源）
        cred = await CredentialVault().resolve_by_ref(req.secret_ref)
        if cred:
            password = str(cred.get("password") or cred.get("pwd") or "")
    if not password:
        return success(
            data={
                "ok": False,
                "latency_ms": 0,
                "message": "未找到可用密码（请先填写并保存密码，或确认 vault 中已存该连接的凭证）",
            },
            message="ok",
            trace_id=trace_id,
        )
    started = time.monotonic()
    try:
        d = DirectDbDiscovery(
            db_type=req.db_type or "starrocks",
            host=req.host,
            port=req.port,
            user=req.user,
            password=password,
            database=req.database or None,
        )
        schemas = await d.list_schemas()
        latency = int((time.monotonic() - started) * 1000)
        return success(
            data={
                "ok": True,
                "latency_ms": latency,
                "message": f"连接成功，可见 schema: {', '.join(schemas[:10])}"
                + ("…" if len(schemas) > 10 else ""),
                "schemas": schemas,
            },
            message="ok",
            trace_id=trace_id,
        )
    except DirectDbUnavailableError as exc:
        latency = int((time.monotonic() - started) * 1000)
        logger.warning("IQD db profile test failed", host=req.host, error=str(exc))
        return success(
            data={"ok": False, "latency_ms": latency, "message": str(exc)[:500]},
            message="ok",
            trace_id=trace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD db profile test error", host=req.host, error=str(exc))
        return error_response(
            code=INTERNAL_CODE,
            message=f"连通测试异常: {exc}",
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )
