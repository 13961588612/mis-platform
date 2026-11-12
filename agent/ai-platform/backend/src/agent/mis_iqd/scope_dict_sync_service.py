"""行级范围字典同步服务（2026-10-06）。

把每个启用连接的 **dept 字典物化行**（mis-iqd 默认覆盖裁剪后的
``(external_value, dept_path)``）写入业务库 ``mis_dept_scope``，供 Worker
``PATH_PREFIX`` EXISTS 谓词使用。

链路：
  mis-iqd ``/internal/v1/iqd/scope/dict-materialize``（裁剪结果）
  → 路线 A 凭证（``/connection-db-profile`` + :class:`CredentialVault`）
  → :class:`DirectDbScopeWriter` 写入业务库。

语义：
* dept：全量物化（clear_first=True）—— 每次同步以映射表为准重写；
* store：不做（store 走注入时映射，见 scope_resolver）。
"""

from __future__ import annotations

from typing import Any

from src.adapters.iqd_config_client import IqdConfigClient, IqdConfigClientError
from src.agent.mis_iqd.direct_db_writer import (
    DirectDbScopeWriter,
    DirectDbWriteUnavailableError,
)
from src.identity.credential_vault import CredentialVault
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.scope_dict_sync")


class ScopeDictSyncError(RuntimeError):
    """字典同步失败（坐标缺失 / 凭证不可解析 / 写库失败）。"""

    def __init__(self, message: str, code: int = 50201) -> None:
        super().__init__(message)
        self.code = code


class ScopeDictSyncService:
    """dept 字典同步（mis-iqd 裁剪结果 → 业务库 mis_dept_scope）。"""

    def __init__(self, config_client: IqdConfigClient | None = None) -> None:
        self._config = config_client or IqdConfigClient()

    async def _writer_for(self, connection_id: int) -> DirectDbScopeWriter:
        """按连接解析业务库坐标 + 凭证 → 直连写入客户端（路线 A）。"""
        try:
            profile = await self._config.get_connection_db_profile(int(connection_id))
        except IqdConfigClientError as exc:
            raise ScopeDictSyncError(f"读取连接业务库坐标失败: {exc}") from exc
        if not profile:
            raise ScopeDictSyncError(f"连接 {connection_id} 未返回业务库坐标（路线 A）")

        db_type = str(profile.get("db_type") or profile.get("default_connector") or "").strip()
        host = str(profile.get("host") or "").strip()
        port = profile.get("port")
        database = profile.get("database")
        user = str(profile.get("user") or "").strip()
        secret_ref = str(profile.get("secret_ref") or "").strip()

        password = ""
        if secret_ref:
            cred = await CredentialVault().resolve_by_ref(secret_ref)
            if cred:
                password = str(cred.get("password") or cred.get("pwd") or "")
                db_type = db_type or str(cred.get("db_type") or cred.get("datasource") or "")
                host = host or str(cred.get("host") or cred.get("hostname") or "")
                user = user or str(cred.get("user") or cred.get("username") or "")
                if port is None:
                    port = cred.get("port")
                if not database:
                    database = cred.get("database") or cred.get("db") or cred.get("dbname")
        if not host or not user or not database:
            raise ScopeDictSyncError(
                f"连接 {connection_id} 未配置完整的业务库连接参数（缺 host/user/database）"
            )
        try:
            return DirectDbScopeWriter(
                db_type=db_type,
                host=host,
                port=int(port) if port is not None else None,
                user=user,
                password=password,
                database=str(database) if database else None,
            )
        except DirectDbWriteUnavailableError as exc:
            raise ScopeDictSyncError(str(exc)) from exc

    async def sync_dimension(self, connection_id: int, dimension_code: str = "dept") -> dict[str, Any]:
        """同步单个维度字典到该连接业务库。

        Returns: 状态视图 ``{connection_id, dimension_code, rows, written, status}``。
        """
        if not dimension_code or dimension_code.lower() != "dept":
            # store 走注入时映射，无需物化
            return {
                "connection_id": connection_id,
                "dimension_code": dimension_code,
                "rows": 0,
                "written": 0,
                "status": "skipped",
                "message": "store 走注入时映射，无需字典同步",
            }

        try:
            mat = await self._config.get_scope_dict_materialize(int(connection_id), "dept")
        except IqdConfigClientError as exc:
            raise ScopeDictSyncError(f"读取字典裁剪结果失败: {exc}") from exc
        rows = mat.get("rows") if isinstance(mat, dict) else None
        rows = rows if isinstance(rows, list) else []

        writer = await self._writer_for(connection_id)
        try:
            written = await writer.upsert_dept_scope(rows, clear_first=True)
        except DirectDbWriteUnavailableError as exc:
            raise ScopeDictSyncError(f"写入业务库 mis_dept_scope 失败: {exc}") from exc

        logger.info(
            "IQD dept scope dict synced",
            connection_id=connection_id,
            rows=len(rows),
            written=written,
        )
        return {
            "connection_id": connection_id,
            "dimension_code": "dept",
            "rows": len(rows),
            "written": written,
            "status": "ok",
        }
