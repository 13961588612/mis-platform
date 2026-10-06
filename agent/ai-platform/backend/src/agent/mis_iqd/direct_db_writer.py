"""业务库直连写入（行级范围字典物化，2026-10-06）。

与 :mod:`direct_db`（只读表发现）配套：本模块把 **dept 字典物化行**
``(external_value, dept_path)`` upsert 进业务库的 ``mis_dept_scope``，
供 Worker 的 ``PATH_PREFIX`` EXISTS 谓词使用。

链路：mis-iqd ``/internal/v1/iqd/scope/dict-materialize``（返回「默认覆盖裁剪」后的行）
→ 本模块（经路线 A 凭证取明文密码）→ 目标业务库 ``INSERT ... ON CONFLICT``。

安全边界（与 direct_db 一致）：
* 明文密码仅瞬态存在（来自 :class:`CredentialVault`），不落日志、不回传；
* 目标表由调用方固定为 ``mis_dept_scope``，列 ``(dept_id, dept_path)``，不拼接用户输入；
* 连接用完即关（``finally``）。

幂等：
* 唯一键 ``(dept_id, dept_path)``（业务库侧 DDL 责任，见迁移注释）；
* ``INSERT ... ON CONFLICT (dept_id, dept_path) DO UPDATE SET dept_path = EXCLUDED.dept_path``；
* 同步为「全量覆盖」语义，调用方可选先清空（``clear_first``）。
"""

from __future__ import annotations

from typing import Any

from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.direct_db_writer")

_MYSQL_TYPES = {"mysql", "starrocks", "doris", "mariadb"}
_PG_TYPES = {"postgres", "postgresql", "pg"}

#: 目标表（固定；不拼接用户输入）。
SCOPE_TABLE = "mis_dept_scope"


class DirectDbWriteUnavailableError(RuntimeError):
    """业务库写入不可用（坐标缺失 / 驱动缺失 / 连接失败 / 执行失败）。"""


def _is_mysql(db_type: str) -> bool:
    return (db_type or "").strip().lower() in _MYSQL_TYPES


def _is_postgres(db_type: str) -> bool:
    return (db_type or "").strip().lower() in _PG_TYPES


class DirectDbScopeWriter:
    """把 dept 字典物化行写入业务库 ``mis_dept_scope``。"""

    def __init__(
        self,
        *,
        db_type: str,
        host: str,
        port: int | None,
        user: str,
        password: str,
        database: str | None = None,
        connect_timeout: int = 8,
    ) -> None:
        if not host or not user:
            raise DirectDbWriteUnavailableError("业务库坐标不完整（host/user 缺失）")
        self._db_type = (db_type or "").strip().lower()
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._database = database
        self._timeout = connect_timeout

    async def upsert_dept_scope(
        self, rows: list[dict[str, Any]], *, clear_first: bool = True
    ) -> int:
        """全量物化：可选先清空，再逐行 upsert。返回写入行数。

        Args:
            rows: ``[{"external_value": "D001", "dept_path": "/0/1/A/"}]``。
            clear_first: 是否先 ``DELETE FROM mis_dept_scope``（全量覆盖语义）。
        """
        if _is_mysql(self._db_type):
            return await self._mysql_upsert(rows, clear_first)
        if _is_postgres(self._db_type):
            return await self._pg_upsert(rows, clear_first)
        raise DirectDbWriteUnavailableError(f"不支持的 db_type: {self._db_type!r}")

    # ------------------------------------------------------------ MySQL 协议

    async def _mysql_upsert(self, rows: list[dict[str, Any]], clear_first: bool) -> int:
        import asyncio

        def _run() -> int:
            try:
                import pymysql
            except ImportError as exc:  # pragma: no cover
                raise DirectDbWriteUnavailableError(
                    "缺少 pymysql 依赖，无法直连 MySQL 协议业务库"
                ) from exc
            conn = pymysql.connect(
                host=self._host,
                port=int(self._port or 9030),
                user=self._user,
                password=self._password,
                database=self._database or None,
                connect_timeout=self._timeout,
                read_timeout=self._timeout,
                charset="utf8mb4",
                autocommit=False,
            )
            try:
                written = 0
                with conn.cursor() as cur:
                    if clear_first:
                        cur.execute(f"DELETE FROM {SCOPE_TABLE}")
                    for r in rows:
                        ext = str(r.get("external_value") or "").strip()
                        path = r.get("dept_path")
                        path = str(path) if path is not None else None
                        if not ext:
                            continue
                        cur.execute(
                            f"INSERT INTO {SCOPE_TABLE} (dept_id, dept_path) VALUES (%s, %s) "
                            "ON DUPLICATE KEY UPDATE dept_path = VALUES(dept_path)",
                            (ext, path),
                        )
                        written += 1
                conn.commit()
                return written
            except Exception:
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001
                    pass
                raise
            finally:
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass

        try:
            return await asyncio.to_thread(_run)
        except DirectDbWriteUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise DirectDbWriteUnavailableError(f"写入业务库(MySQL协议)失败: {exc}") from exc

    # ------------------------------------------------------------ PostgreSQL

    async def _pg_upsert(self, rows: list[dict[str, Any]], clear_first: bool) -> int:
        try:
            import asyncpg
        except ImportError as exc:  # pragma: no cover
            raise DirectDbWriteUnavailableError("缺少 asyncpg 依赖，无法直连 PostgreSQL") from exc
        try:
            conn = await asyncpg.connect(
                host=self._host,
                port=int(self._port or 5432),
                user=self._user,
                password=self._password,
                database=self._database or "postgres",
                timeout=self._timeout,
            )
        except Exception as exc:  # noqa: BLE001
            raise DirectDbWriteUnavailableError(f"直连业务库(PostgreSQL)失败: {exc}") from exc
        try:
            async with conn.transaction():
                if clear_first:
                    await conn.execute(f"DELETE FROM {SCOPE_TABLE}")
                payload = [
                    (str(r.get("external_value") or "").strip(),
                     str(r["dept_path"]) if r.get("dept_path") is not None else None)
                    for r in rows
                    if str(r.get("external_value") or "").strip()
                ]
                if payload:
                    await conn.executemany(
                        f"INSERT INTO {SCOPE_TABLE} (dept_id, dept_path) VALUES ($1, $2) "
                        "ON CONFLICT (dept_id, dept_path) DO UPDATE SET dept_path = EXCLUDED.dept_path",
                        payload,
                    )
            return len(payload)
        finally:
            try:
                await conn.close()
            except Exception:  # noqa: BLE001
                pass
