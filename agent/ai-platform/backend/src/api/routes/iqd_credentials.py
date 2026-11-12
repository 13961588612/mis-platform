"""问数连接凭证保险库路由（路线 A，2026-09-29）。

平台侧管理业务库连接凭证：mis-iqd ``iqd_connection`` 只存 ``secret_ref`` 引用，
明文凭证经本路由写入 ``ai_platform.credential_mappings``（AES-256-GCM 加密，
复用 :class:`CredentialVault` + :func:`encrypt_dict`）。

链路：前端连接向导 → BFF → 本路由（受 MIS RS256 保护，透传 Authorization）→ Vault。

铁律（与 D6 一致）：
* **明文永不回传、永不日志**：响应只回 ``has_credential`` 布尔与掩码账号；
* 密文只落 ``credential_mappings``，wren 侧仅在进程启动期经 env 注入（用后即忘）。

端点：
* ``POST   /api/v1/iqd/credentials``                 写入 / 更新（by ``secret_ref`` upsert）
* ``GET    /api/v1/iqd/credentials/{secret_ref}``    查询是否存在（供编辑时提示是否需重填）
* ``DELETE /api/v1/iqd/credentials/{secret_ref}``    软删除（停用）
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, Path, status
from pydantic import BaseModel, Field

from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.db.session import db_session_context
from src.identity.credential_vault import CredentialVault
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_credentials")

router = APIRouter(prefix="/iqd/credentials", tags=["iqd-credentials"])

VALIDATION_CODE = 42200
INTERNAL_CODE = 9000

#: 问数连接凭证的 system_type 归类。
SYSTEM_TYPE = "iqd_db"


class StoreCredentialRequest(BaseModel):
    """写入 / 更新连接凭据（明文仅在此请求体短暂存在，随即加密落库）。

    Attributes:
        secret_ref: 凭证引用（= mis-iqd ``iqd_connection.secret_ref``），唯一键。
        db_type: 数据库类型（如 starrocks / mysql / postgres）。
        host / port / user / password / database: 业务库连接参数。
        extra: 其它可选参数（如 charset），透传进凭证明文 JSON。
    """

    secret_ref: str = Field(..., min_length=1, description="凭证引用（唯一）")
    db_type: str = Field(default="", description="数据库类型")
    host: str = Field(default="", description="业务库 host")
    port: int | None = Field(default=None, description="业务库 port")
    user: str = Field(default="", description="业务库账号")
    password: str = Field(default="", description="业务库密码（绝不回传）")
    database: str = Field(default="", description="业务库 database / schema 名")
    extra: dict[str, Any] = Field(default_factory=dict, description="透传附加参数")


@router.post("")
async def store_credential(
    req: StoreCredentialRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """按 ``secret_ref`` 加密存储连接凭据（新增或整体覆盖）。"""
    if not req.secret_ref.strip():
        return error_response(
            code=VALIDATION_CODE,
            message="secret_ref 不能为空",
            http_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            trace_id=trace_id,
        )
    credential: dict[str, Any] = {
        "db_type": req.db_type,
        "host": req.host,
        "port": req.port,
        "user": req.user,
        "password": req.password,
        "database": req.database,
    }
    credential.update(req.extra or {})
    credential = {k: v for k, v in credential.items() if v not in (None, "")}
    if not credential and not req.password:
        return error_response(
            code=VALIDATION_CODE,
            message="凭据内容为空（至少需 host/user/password 之一）",
            http_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            trace_id=trace_id,
        )
    try:
        existing = await CredentialVault().resolve_by_ref(req.secret_ref.strip()) or {}
        # 合并语义：password 留空 = 保留既有密码（编辑库坐标时无需重输密码）。
        if req.password:
            merged_password = req.password
        else:
            merged_password = str(existing.get("password") or "")
        merged: dict[str, Any] = {**existing, **credential}
        if merged_password:
            merged["password"] = merged_password
        else:
            merged.pop("password", None)
        async with db_session_context() as session:
            row_id = await CredentialVault().upsert_by_ref(
                session, req.secret_ref.strip(), SYSTEM_TYPE, merged
            )
        return success(
            data={"secret_ref": req.secret_ref.strip(), "has_credential": True, "id": row_id},
            message="ok",
            trace_id=trace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD credential store failed", secret_ref=req.secret_ref, error=str(exc))
        return error_response(
            code=INTERNAL_CODE,
            message=f"凭据存储失败: {exc}",
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )


@router.get("/{secret_ref}")
async def get_credential_status(
    secret_ref: str = Path(..., description="凭证引用"),
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """查询某引用是否已存凭证（只回布尔 + 掩码账号，不回明文）。"""
    try:
        cred = await CredentialVault().resolve_by_ref(secret_ref)
        if not cred:
            return success(
                data={"secret_ref": secret_ref, "has_credential": False},
                message="ok",
                trace_id=trace_id,
            )
        user = str(cred.get("user") or cred.get("username") or "")
        masked = (user[:2] + "***") if len(user) > 2 else ("***" if user else "")
        return success(
            data={
                "secret_ref": secret_ref,
                "has_credential": True,
                "db_type": cred.get("db_type", ""),
                "host": cred.get("host", ""),
                "port": cred.get("port"),
                "database": cred.get("database", ""),
                "user_masked": masked,
            },
            message="ok",
            trace_id=trace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD credential status failed", secret_ref=secret_ref, error=str(exc))
        return error_response(
            code=INTERNAL_CODE,
            message=f"凭据查询失败: {exc}",
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )


@router.delete("/{secret_ref}")
async def delete_credential(
    secret_ref: str = Path(..., description="凭证引用"),
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> Any:
    """软删除（停用）某引用的连接凭据。"""
    try:
        async with db_session_context() as session:
            deleted = await CredentialVault().delete_by_ref(session, secret_ref)
        return success(
            data={"secret_ref": secret_ref, "deleted": deleted},
            message="ok",
            trace_id=trace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD credential delete failed", secret_ref=secret_ref, error=str(exc))
        return error_response(
            code=INTERNAL_CODE,
            message=f"凭据删除失败: {exc}",
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )
