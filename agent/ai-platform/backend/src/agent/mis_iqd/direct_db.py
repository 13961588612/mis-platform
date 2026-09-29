"""业务库直连表发现（路线 A，2026-09-29）。

背景
----
wren 0.13 的 ``--sql`` 强制走 MDL 重写，查 ``information_schema`` 报
``[INVALID_SQL] Serde JSON error: missing field type``；MCP ``run_sql`` 查
``information_schema`` 也会被 MDL 字段白名单拒绝。故「全库表发现」（发现**尚未
模型化**的物理表）在 wren 链路上不可行，必须**直连业务库**读 ``information_schema``。

本模块经路线 A 的凭证链路拿到业务库坐标 + 明文密码后，建一条**只读**短连接：
* MySQL 协议（StarRocks / Doris / MySQL）：``pymysql``；
* PostgreSQL：``asyncpg``。

安全边界
--------
* 明文密码仅在本模块内**瞬态**存在（来自 :class:`CredentialVault`），不落日志、不回传；
* 仅执行 ``information_schema`` 只读查询，不做任何写操作；
* 连接用完即关（``finally``）。

降级
----
若连接坐标缺失 / 驱动缺失 / 连接失败，抛 :class:`DirectDbUnavailableError`，
由 discovery service 决定回退到 wren MCP（只含已建模表）还是 fail-closed。
"""

from __future__ import annotations

from typing import Any

from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.direct_db")

#: MySQL 协议家族（含 StarRocks / Doris）。
_MYSQL_TYPES = {"mysql", "starrocks", "doris", "mariadb"}
#: PostgreSQL 家族。
_PG_TYPES = {"postgres", "postgresql", "pg"}

#: 系统库过滤（不要在表发现里展示）。
_SYSTEM_SCHEMAS = {
    "information_schema",
    "mysql",
    "sys",
    "performance_schema",
    "_statistics_",
    "pg_catalog",
    "pg_toast",
}


class DirectDbUnavailableError(RuntimeError):
    """直连业务库不可用（坐标缺失 / 驱动缺失 / 连接失败）。"""


def _is_mysql(db_type: str) -> bool:
    return db_type.strip().lower() in _MYSQL_TYPES


def _is_postgres(db_type: str) -> bool:
    return db_type.strip().lower() in _PG_TYPES


class DirectDbDiscovery:
    """业务库直连表发现（只读）。

    用法::

        d = DirectDbDiscovery(db_type="starrocks", host=..., port=9030,
                              user="query", password="...", database="adhoc")
        schemas = await d.list_schemas()
        tables = await d.list_tables(schema="adhoc")
        columns = await d.list_columns(schema="adhoc", table="sale_ord")
    """

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
            raise DirectDbUnavailableError("业务库坐标不完整（host/user 缺失）")
        self._db_type = (db_type or "").strip().lower()
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._database = database
        self._timeout = connect_timeout

    # ------------------------------------------------------------ 公共能力

    async def list_schemas(self) -> list[str]:
        """列出可见 schema（过滤系统库）。"""
        if _is_mysql(self._db_type):
            rows = await self._mysql_query(
                "SELECT schema_name FROM information_schema.schemata", ()
            )
            names = [str(r[0]) for r in rows]
        elif _is_postgres(self._db_type):
            rows = await self._pg_query(
                "SELECT schema_name FROM information_schema.schemata", ()
            )
            names = [str(r[0]) for r in rows]
        else:
            raise DirectDbUnavailableError(f"不支持的 db_type: {self._db_type!r}")
        return sorted(n for n in names if n and n.lower() not in _SYSTEM_SCHEMAS)

    async def list_tables(
        self, schema: str | None = None, keyword: str | None = None
    ) -> list[dict[str, Any]]:
        """列出某 schema 下的物理表（``{name, comment, row_count_estimate}``）。"""
        target = schema or self._database
        if _is_mysql(self._db_type):
            sql = (
                "SELECT table_name, table_comment, table_rows "
                "FROM information_schema.tables WHERE table_schema = %s"
            )
            rows = await self._mysql_query(sql, (target,))
            out = [
                {
                    "name": str(r[0]),
                    "comment": (str(r[1]) if r[1] is not None else None),
                    "row_count_estimate": (int(r[2]) if r[2] is not None else None),
                }
                for r in rows
            ]
        elif _is_postgres(self._db_type):
            sql = (
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = %s ORDER BY table_name"
            )
            rows = await self._pg_query(sql, (target,))
            out = [{"name": str(r[0]), "comment": None, "row_count_estimate": None} for r in rows]
        else:
            raise DirectDbUnavailableError(f"不支持的 db_type: {self._db_type!r}")

        if keyword and keyword.strip():
            needle = keyword.strip().lower()
            out = [t for t in out if needle in t["name"].lower()]
        out.sort(key=lambda t: t["name"])
        return out

    async def list_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        """列出表字段（``{name, type, comment, is_primary_key, nullable}``）。"""
        if _is_mysql(self._db_type):
            sql = (
                "SELECT column_name, data_type, column_type, column_comment, "
                "is_nullable, column_key, character_maximum_length "
                "FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s "
                "ORDER BY ordinal_position"
            )
            rows = await self._mysql_query(sql, (schema, table))
            out: list[dict[str, Any]] = []
            for r in rows:
                data_type = str(r[1]) if r[1] is not None else "text"
                column_type = str(r[2]) if r[2] is not None else ""
                char_max = int(r[6]) if r[6] is not None else None
                out.append(
                    {
                        "name": str(r[0]),
                        "type": _normalize_mysql_type(data_type, column_type, char_max),
                        "comment": (str(r[3]) if r[3] else None),
                        "is_primary_key": str(r[5] or "").upper() == "PRI",
                        "is_pk_inferred": str(r[5] or "").upper() == "PRI",
                        "nullable": str(r[4] or "").upper() in ("YES", "Y", "TRUE", "1"),
                    }
                )
            return out
        if _is_postgres(self._db_type):
            sql = (
                "SELECT c.column_name, c.data_type, c.is_nullable, c.character_maximum_length, "
                "(pk.column_name IS NOT NULL) AS is_pk "
                "FROM information_schema.columns c "
                "LEFT JOIN ("
                "  SELECT kcu.column_name FROM information_schema.table_constraints tc "
                "  JOIN information_schema.key_column_usage kcu "
                "    ON tc.constraint_name = kcu.constraint_name "
                "  WHERE tc.constraint_type = 'PRIMARY KEY' "
                "    AND tc.table_schema = %s AND tc.table_name = %s"
                ") pk ON pk.column_name = c.column_name "
                "WHERE c.table_schema = %s AND c.table_name = %s "
                "ORDER BY c.ordinal_position"
            )
            rows = await self._pg_query(sql, (schema, table, schema, table))
            return [
                {
                    "name": str(r[0]),
                    "type": str(r[1]) if r[1] else "text",
                    "comment": None,
                    "is_primary_key": bool(r[4]),
                    "is_pk_inferred": bool(r[4]),
                    "nullable": str(r[2] or "").upper() in ("YES", "Y", "TRUE", "1"),
                }
                for r in rows
            ]
        raise DirectDbUnavailableError(f"不支持的 db_type: {self._db_type!r}")

    # ------------------------------------------------------------ 底层驱动

    async def _mysql_query(self, sql: str, params: tuple) -> list[tuple]:
        """MySQL 协议只读查询（pymysql 在 executor 里跑，避免阻塞事件循环）。"""
        import asyncio

        def _run() -> list[tuple]:
            try:
                import pymysql
            except ImportError as exc:  # pragma: no cover - 依赖缺失
                raise DirectDbUnavailableError(
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
                cursorclass=pymysql.cursors.Cursor,
            )
            try:
                with conn.cursor() as cur:
                    cur.execute(sql, params)
                    return list(cur.fetchall())
            finally:
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass

        try:
            return await asyncio.to_thread(_run)
        except DirectDbUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise DirectDbUnavailableError(f"直连业务库(MySQL协议)失败: {exc}") from exc

    async def _pg_query(self, sql: str, params: tuple) -> list[tuple]:
        """PostgreSQL 只读查询（asyncpg）。"""
        try:
            import asyncpg
        except ImportError as exc:  # pragma: no cover
            raise DirectDbUnavailableError("缺少 asyncpg 依赖，无法直连 PostgreSQL") from exc
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
            raise DirectDbUnavailableError(f"直连业务库(PostgreSQL)失败: {exc}") from exc
        try:
            rows = await conn.fetch(sql, *params)
            return [tuple(r.values()) for r in rows]
        finally:
            try:
                await conn.close()
            except Exception:  # noqa: BLE001
                pass


def _normalize_mysql_type(data_type: str, column_type: str, char_max: int | None) -> str:
    """归一 MySQL/StarRocks 列类型（STRRING 大长度纠为 STRING）。"""
    low = (data_type or "").strip().lower()
    if low in ("varchar", "char") and char_max in (65533, 65535):
        return "STRING"
    if low in ("int", "integer", "bigint", "smallint", "tinyint", "boolean", "bool"):
        return low.upper()
    if low in ("double", "float", "real"):
        return "DOUBLE" if low in ("double", "real") else "FLOAT"
    if low in ("date", "datetime", "timestamp"):
        return low.upper()
    if column_type:
        return column_type
    return data_type or "text"
