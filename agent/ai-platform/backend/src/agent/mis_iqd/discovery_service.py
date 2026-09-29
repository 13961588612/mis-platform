"""表发现服务（MR-02 / 系统设计 §4.1 a 点）。

建模台「表发现导入」向导的服务端能力：按**连接**读取业务库的 schema / 表 / 列元数据，
并批量导入为平台 catalog 节点。

职责与边界
----------
* 元数据读取走 **WrenAI MCP**（``list_models`` / ``describe_model`` / ``get_mdl``，
  经 :class:`src.adapters.iqd_mcp_client.IqdMcpClient`）。**不发明新协议**，
  也不自建 SQL 连接直读业务库。
* 凭证（业务库 profile）由 DBA 按 multiconn §5 流程 server-side 注入 WrenAI；
  本服务**不接触也不回传**任何凭证（边界红线 3）。
* ``import_tables`` 经平台受控写路径落库：逐表调 mis-iqd 内部端点
  ``POST /internal/v1/iqd/catalog/model/from-table``（**Worker 不直连库、不直写 MDL**，Q1 方案甲）。

关于「CLI vs MCP」的落地选择（对 system-design §4.1 的一处修正）
----------------------------------------------------------------
设计稿写的是「复用 ``wren list-models`` / ``wren describe-model`` CLI」。但这两个名字
是 ``wren serve mcp`` 暴露的 **MCP 工具**（见 ``docs/.../tasks.md`` W0 实测清单：
``… get_mdl / list_models / describe_model / get_instructions``），**并非 wren CLI 子命令**；
CLI 侧真正存在的是 ``wren get mdl`` / ``wren context show``（:class:`IqdCli` 已封装）。
因此本服务取 **MCP 工具**（:class:`IqdMcpClient` 已实现同名方法，且自带 per-connection
端点解析与错误语义），而不是去调一个不存在的 CLI 子命令。语义与设计稿**完全一致**
（同源数据、同错误码），只是落地通道不同。

离线 mock 的 fail-closed
------------------------
:class:`IqdMcpClient` 在连不上 ``wren serve mcp`` 时会自动回退 **mock 模式**（返回值固定为空）。
对问数链路那是「离线跑通管道」的优点；对**表发现**却是危险信号 —— 把空 schema/空表清单
当真实库结构展示，会让 DBA 以为「这个库就是空的」。故本服务在 mock 时**显式失败**
（``DiscoveryUnavailableError`` → 路由 50201），绝不把 mock 数据伪装成真实元数据。
"""

from __future__ import annotations

from typing import Any, Callable

from src.adapters.iqd_cli import IqdCli
from src.adapters.iqd_config_client import IqdConfigClient, IqdConfigClientError
from src.adapters.iqd_mcp_client import IqdMcpClient, IqdMcpClientError
from src.agent.mis_iqd.direct_db import DirectDbDiscovery, DirectDbUnavailableError
from src.identity.credential_vault import CredentialVault
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.discovery")

#: 表清单单页条数（设计 §3.3 只给 ``page``，未给 page_size；固定 100 避免前端分页参数漂移）。
DEFAULT_PAGE_SIZE: int = 100

#: WrenAI 缺省 schema（与 ``IqdCli.ensure_project`` 写入的 ``catalog.schema: public`` 一致）。
DEFAULT_SCHEMA: str = "public"

#: 列「主键推断」的名字启发式（WrenAI 未回显主键标记时的兜底）。
_PK_NAME_SUFFIXES: tuple[str, ...] = ("_id",)


class DiscoveryValidationError(ValueError):
    """入参校验失败（对应设计 §3.3 的 42200）。"""

    def __init__(self, message: str, code: int = 42200) -> None:
        super().__init__(message)
        self.code = code


class DiscoveryUnavailableError(RuntimeError):
    """连接不可达 / profile 未注入 / MCP 未就绪（对应设计 §3.3 的 50201）。"""

    def __init__(self, message: str, code: int = 50201) -> None:
        super().__init__(message)
        self.code = code


def _default_mcp_client(connection_id: int | None) -> IqdMcpClient:
    """按连接解析 MCP 端点并构造客户端（方案 A 多连接 / 跨机器）。

    **必须**走 :meth:`IqdMcpClient.for_connection`：远程 WrenMcpAgent 数据面是
    ``http://{host}:{mcp_port}/mcp/{connId}`` + bearer，仅用
    ``get_endpoint().host/port`` 会落到无 path/无 token 的默认 ``/mcp``，
    表发现必然 401 → mock → 50201。

    Args:
        connection_id: 问数连接 id；``None`` 时用缺省单连接端点（仅测试兜底）。

    Returns:
        可用的 :class:`IqdMcpClient`（尚未握手，懒连接）。

    Raises:
        DiscoveryUnavailableError: 连接 MCP 端点未就绪。
    """
    if connection_id is None:
        return IqdMcpClient()
    try:
        return IqdMcpClient.for_connection(connection_id)
    except IqdMcpClientError as exc:
        raise DiscoveryUnavailableError(
            f"连接 {connection_id} 的 MCP 端点未就绪：{exc}"
        ) from exc


class IqdDiscoveryService:
    """按连接表发现 + 批量导入。

    Args:
        cli: WrenAI CLI 适配器（形态统一保留，供后续 ``context show`` 类扩展；测试可注入替身）。
        mcp_factory: ``(connection_id) -> IqdMcpClient`` 工厂（测试注入替身用）。
        config_factory: ``IqdConfigClient`` 工厂（测试注入替身用）。
    """

    def __init__(
        self,
        cli: IqdCli | None = None,
        mcp_factory: Callable[[int | None], IqdMcpClient] | None = None,
        config_factory: Callable[[], IqdConfigClient] | None = None,
    ) -> None:
        self._cli: IqdCli = cli if cli is not None else IqdCli()
        self._mcp_factory: Callable[[int | None], IqdMcpClient] = mcp_factory or _default_mcp_client
        self._config_factory: Callable[[], IqdConfigClient] = config_factory or IqdConfigClient

    @property
    def cli(self) -> IqdCli:
        """WrenAI CLI 适配器。"""
        return self._cli

    # ================================================================ 表发现（只读）

    async def list_schemas(self, connection_id: int | None = None) -> list[str]:
        """列出连接下可见 schema。

        取值优先级：① ``list_models`` 载荷内的 ``schemas`` / ``groups`` 顶层字段
        → ② 各模型自身的 schema 元数据（``schema`` / ``table_schema`` / ``properties.schema``）
        → ③ 从 ``refSql`` 的 ``from <schema>.<table>`` 反解
        → ④ 兜底 ``public``（仅当确有模型时，与 wren project 的 ``catalog.schema`` 缺省一致）。

        Args:
            connection_id: 问数连接 id（用于解析 per-connection MCP 端点）。

        Returns:
            去重后的 schema 名列表（按字典序）。

        Raises:
            DiscoveryUnavailableError: profile 未注入 / MCP 未就绪 / 调用失败（50201）。
        """
        # 路线 A：优先直连业务库（能发现未建模表；wren list_models 只含已建模表）
        try:
            direct = await self._direct_db(connection_id)
            schemas = await direct.list_schemas()
            if schemas:
                logger.info(
                    "IQD discovery list_schemas (direct db)",
                    connection_id=connection_id,
                    count=len(schemas),
                )
                return schemas
        except DiscoveryUnavailableError as exc:
            logger.warning(
                "IQD discovery list_schemas direct db unavailable; fallback to wren MCP",
                connection_id=connection_id,
                error=str(exc),
            )
        except DirectDbUnavailableError as exc:
            logger.warning(
                "IQD discovery list_schemas direct db failed; fallback to wren MCP",
                connection_id=connection_id,
                error=str(exc),
            )

        payload = await self._list_models(connection_id)

        schemas: list[str] = []
        for cand in _as_list(payload.get("schemas")) + _as_list(payload.get("groups")):
            name = _schema_name(cand)
            if name:
                schemas.append(name)

        models = _as_list(payload.get("models"))
        for model in models:
            name = _schema_of(model)
            if name:
                schemas.append(name)

        if not schemas and models:
            # 兜底：确有模型但无 schema 元数据 —— 取 wren project 缺省 schema。
            schemas.append(DEFAULT_SCHEMA)
        return sorted({s for s in schemas if s})

    async def list_tables(
        self,
        connection_id: int | None = None,
        schema: str | None = None,
        page: int = 1,
        keyword: str | None = None,
    ) -> dict[str, Any]:
        """分页列出指定 schema 下的表。

        Args:
            connection_id: 问数连接 id。
            schema: schema 名；缺省取 :data:`DEFAULT_SCHEMA`。
            page: 页码（从 1 起；越界返回空页，不报错）。
            keyword: 表名关键字（大小写不敏感包含匹配）。

        Returns:
            ``{"tables": [{"name", "comment", "row_count_estimate"}], "total": int, "page": int}``。

        Raises:
            DiscoveryUnavailableError: 50201。
        """
        target_schema = (schema or DEFAULT_SCHEMA).strip()
        # 路线 A：优先直连业务库（能发现未建模表）
        try:
            direct = await self._direct_db(connection_id)
            direct_rows = await direct.list_tables(target_schema, keyword)
            if direct_rows:
                total = len(direct_rows)
                safe_page = max(1, int(page or 1))
                start = (safe_page - 1) * DEFAULT_PAGE_SIZE
                window = direct_rows[start : start + DEFAULT_PAGE_SIZE]
                logger.info(
                    "IQD discovery list_tables (direct db)",
                    connection_id=connection_id,
                    schema=target_schema,
                    total=total,
                    page=safe_page,
                )
                return {"tables": window, "total": total, "page": safe_page}
        except DiscoveryUnavailableError as exc:
            logger.warning(
                "IQD discovery list_tables direct db unavailable; fallback to wren MCP",
                connection_id=connection_id,
                error=str(exc),
            )
        except DirectDbUnavailableError as exc:
            logger.warning(
                "IQD discovery list_tables direct db failed; fallback to wren MCP",
                connection_id=connection_id,
                error=str(exc),
            )

        payload = await self._list_models(connection_id)

        rows: list[dict[str, Any]] = []
        for model in _as_list(payload.get("models")):
            model_schema = _schema_of(model) or DEFAULT_SCHEMA
            if model_schema != target_schema:
                continue
            name = _table_of(model)
            if not name:
                continue
            rows.append(
                {
                    "name": name,
                    "comment": _text(model, "comment", "description"),
                    "row_count_estimate": _int(model, "row_count", "row_count_estimate", "rowCount"),
                }
            )

        if keyword and keyword.strip():
            needle = keyword.strip().lower()
            rows = [r for r in rows if needle in str(r["name"]).lower()]
        rows.sort(key=lambda r: str(r["name"]))

        total = len(rows)
        safe_page = max(1, int(page or 1))
        start = (safe_page - 1) * DEFAULT_PAGE_SIZE
        window = rows[start : start + DEFAULT_PAGE_SIZE]
        logger.info(
            "IQD discovery list_tables",
            connection_id=connection_id,
            schema=target_schema,
            total=total,
            page=safe_page,
        )
        return {"tables": window, "total": total, "page": safe_page}

    async def list_columns(
        self,
        connection_id: int | None = None,
        schema: str | None = None,
        table: str | None = None,
    ) -> list[dict[str, Any]]:
        """列出表字段（含主键推断 + information_schema 类型纠偏）。

        语义模型名与物理表名在 WrenAI 里通常是同一套命名（model 即 table 的语义包装），
        故先按「表名 == 模型名」直查 ``describe_model``；失败再回退按表名匹配模型清单。

        StarRocks / MySQL 协议下 Wren 常把 ``STRING`` 落成 ``VARCHAR(65533)``；本方法
        再经 ``information_schema.columns``（best-effort）取 ``data_type`` /
        ``is_nullable`` / 长度，并归一化为 ``STRING`` / ``varchar(n)`` / ``DOUBLE`` 等。

        Args:
            connection_id: 问数连接 id。
            schema: schema 名（用于在模型清单里消歧 / info_schema 过滤）。
            table: 表名。

        Returns:
            ``[{"name", "type", "comment", "is_pk_inferred", "is_primary_key", "nullable"}]``。

        Raises:
            DiscoveryValidationError: ``table`` 为空（42200）。
            DiscoveryUnavailableError: 50201。
        """
        if not table or not table.strip():
            raise DiscoveryValidationError("table 不能为空")
        table_name = table.strip()
        target_schema = (schema or DEFAULT_SCHEMA).strip()
        # 路线 A：优先直连业务库（未建模表在 wren 里无模型可 describe）
        try:
            direct = await self._direct_db(connection_id)
            direct_cols = await direct.list_columns(target_schema, table_name)
            if direct_cols:
                logger.info(
                    "IQD discovery list_columns (direct db)",
                    connection_id=connection_id,
                    schema=target_schema,
                    table=table_name,
                    columns=len(direct_cols),
                )
                return direct_cols
        except DiscoveryUnavailableError as exc:
            logger.warning(
                "IQD discovery list_columns direct db unavailable; fallback to wren MCP",
                connection_id=connection_id,
                error=str(exc),
            )
        except DirectDbUnavailableError as exc:
            logger.warning(
                "IQD discovery list_columns direct db failed; fallback to wren MCP",
                connection_id=connection_id,
                error=str(exc),
            )
        client = self._mcp_factory(connection_id)
        await self._assert_ready(client, connection_id)
        try:
            payload = await client.describe_model(table_name)
        except IqdMcpClientError as exc:
            raise DiscoveryUnavailableError(f"读取表结构失败: {table_name} -> {exc}") from exc
        if not isinstance(payload, dict):
            payload = {}

        pk_names = _primary_key_names(payload)
        raw_fields = _as_list(payload.get("fields")) or _as_list(payload.get("columns"))
        meta_by_name = await self._enrich_columns_from_info_schema(
            client, target_schema, table_name
        )

        columns: list[dict[str, Any]] = []
        for idx, field in enumerate(raw_fields):
            name = _text(field, "name", "field", "column_name")
            if not name:
                continue
            explicit_pk = _bool(field, "is_primary_key", "isPrimaryKey", "primary_key", "primaryKey")
            if explicit_pk is None and name.lower() in pk_names:
                explicit_pk = True
            inferred_pk = explicit_pk if explicit_pk is not None else _infer_pk(name, table_name, idx)
            nullable = _bool(field, "nullable")
            if nullable is None:
                not_null = _bool(field, "not_null", "notNull")
                nullable = (not not_null) if not_null is not None else True

            raw_type = _text(field, "type", "data_type", "dataType")
            enriched = meta_by_name.get(name.lower())
            if enriched is not None:
                if enriched.get("type"):
                    raw_type = str(enriched["type"])
                if enriched.get("nullable") is not None:
                    nullable = bool(enriched["nullable"])

            comment = _text(field, "comment", "description")
            if enriched and enriched.get("comment"):
                comment = str(enriched["comment"]) or comment

            col_type = _normalize_data_type(
                raw_type,
                char_max=enriched.get("char_max") if enriched else None,
            )
            columns.append(
                {
                    "name": name,
                    "type": col_type,
                    "comment": comment,
                    # 双写：向导预览用 is_pk_inferred；from-table 落库认 is_primary_key
                    "is_pk_inferred": bool(inferred_pk),
                    "is_primary_key": bool(inferred_pk),
                    "nullable": bool(nullable),
                }
            )
        logger.info(
            "IQD discovery list_columns",
            connection_id=connection_id,
            schema=target_schema,
            table=table_name,
            columns=len(columns),
            enriched=len(meta_by_name),
        )
        return columns

    # ================================================================ 批量导入（写路径）

    async def import_tables(self, request: dict[str, Any]) -> dict[str, Any]:
        """批量导入表为平台 catalog 节点（`kind=table/model/column`, `source='modeling'`）。

        流程（对齐设计 §6.1 时序）：
        1. 校验入参（空清单 → 42200）；
        2. 拉 mis-iqd 既有 catalog 元数据（判「已存在」）；
        3. 逐表：``mode=create_or_skip`` 且已存在 → 计入 ``skipped``；否则取列元数据后
           调 mis-iqd ``POST /internal/v1/iqd/catalog/model/from-table``（一次事务落
           table+model+column 并 bump revision）→ 计入 ``imported``。

        Args:
            request: ``{"connection_id", "tables": [{"schema", "name"}], "mode", "in_scope"}``。

        Returns:
            ``{"imported": [item_key], "skipped": [item_key]}``。

        Raises:
            DiscoveryValidationError: 空清单 / 缺 connection_id（42200）。
            DiscoveryUnavailableError: 50201。
            IqdConfigClientError: mis-iqd 返回业务失败（40900/42200/40901 等）时透传。
        """
        connection_id = request.get("connection_id")
        if connection_id is None:
            raise DiscoveryValidationError("connection_id 不能为空")
        tables = _as_list(request.get("tables"))
        if not tables:
            raise DiscoveryValidationError("待导入表清单不能为空")
        mode = str(request.get("mode") or "create_or_skip")
        in_scope = request.get("in_scope")

        existing = await self._existing_item_keys(int(connection_id))

        imported: list[str] = []
        skipped: list[str] = []
        for item in tables:
            table_name = _text(item, "name", "table")
            if not table_name:
                continue
            schema = _text(item, "schema") or DEFAULT_SCHEMA
            model_key = f"mdl:model:{table_name}"
            if mode == "create_or_skip" and model_key in existing:
                skipped.append(model_key)
                continue

            columns = await self.list_columns(int(connection_id), schema, table_name)
            payload: dict[str, Any] = {
                "connection_id": int(connection_id),
                "source_table": {"schema": schema, "name": table_name, "columns": columns},
                "model_item_key": model_key,
            }
            if mode == "create_or_update":
                # 刷新既有列元数据：不带确定性幂等键（否则会命中首次导入结果、跳过 upsert）
                payload["refresh_columns"] = True
            else:
                # 幂等键按 §3.3：{connId}+{sha1(source_table)}（确定性 → 重复导入天然幂等）
                payload["idempotency_key"] = self._source_table_key(
                    int(connection_id), schema, table_name
                )
            if in_scope is not None:
                payload["in_scope"] = in_scope
            result = await self._create_model_from_table(payload)
            created_key = str(result.get("item_key") or model_key)
            imported.append(created_key)

        logger.info(
            "IQD discovery import_tables done",
            connection_id=connection_id,
            imported=len(imported),
            skipped=len(skipped),
        )
        return {"imported": imported, "skipped": skipped}

    # ================================================================ 内部：直连业务库（路线 A）

    async def _direct_db(self, connection_id: int | None) -> DirectDbDiscovery:
        """按连接解析业务库坐标 + 凭证 → 直连客户端（路线 A）。

        链路：mis-iqd ``/connection-db-profile`` 取非敏感坐标 + ``secret_ref``
        → :class:`CredentialVault` 取明文密码 → :class:`DirectDbDiscovery`。

        Raises:
            DiscoveryUnavailableError: 坐标缺失 / 凭据不可解析 / db_type 不支持（50201）。
        """
        if connection_id is None:
            raise DiscoveryUnavailableError("表发现直连需要 connection_id")
        client = self._config_factory()
        try:
            profile = await client.get_connection_db_profile(int(connection_id))
        except IqdConfigClientError as exc:
            raise DiscoveryUnavailableError(f"读取连接业务库坐标失败: {exc}") from exc
        if not profile:
            raise DiscoveryUnavailableError(f"连接 {connection_id} 未返回业务库坐标（路线 A）")
        db_type = str(profile.get("db_type") or profile.get("default_connector") or "").strip()
        host = str(profile.get("host") or "").strip()
        port = profile.get("port")
        database = profile.get("database")
        user = str(profile.get("user") or "").strip()
        secret_ref = str(profile.get("secret_ref") or "").strip()
        if not host or not user:
            raise DiscoveryUnavailableError(
                f"连接 {connection_id} 未配置业务库坐标（请在连接向导填写 host/user）"
            )
        password = ""
        if secret_ref:
            cred = await CredentialVault().resolve_by_ref(secret_ref)
            if cred:
                password = str(cred.get("password") or cred.get("pwd") or "")
                db_type = db_type or str(cred.get("db_type") or "")
                host = host or str(cred.get("host") or "")
                user = user or str(cred.get("user") or cred.get("username") or "")
                if port is None:
                    port = cred.get("port")
                if not database:
                    database = cred.get("database") or cred.get("db")
        if not db_type:
            db_type = "starrocks"
        return DirectDbDiscovery(
            db_type=db_type,
            host=host,
            port=int(port) if port is not None else None,
            user=user,
            password=password,
            database=str(database) if database else None,
        )

    # ================================================================ 内部：适配层调用

    async def _list_models(self, connection_id: int | None) -> dict[str, Any]:
        """调 MCP ``list_models``（mock 态显式失败，见模块 docstring）。"""
        client = self._mcp_factory(connection_id)
        await self._assert_ready(client, connection_id)
        try:
            payload = await client.list_models()
        except IqdMcpClientError as exc:
            raise DiscoveryUnavailableError(f"读取模型清单失败: {exc}") from exc
        return payload if isinstance(payload, dict) else {}

    async def _describe_model(self, connection_id: int | None, model_name: str) -> dict[str, Any]:
        """调 MCP ``describe_model``。"""
        client = self._mcp_factory(connection_id)
        await self._assert_ready(client, connection_id)
        try:
            payload = await client.describe_model(model_name)
        except IqdMcpClientError as exc:
            raise DiscoveryUnavailableError(f"读取表结构失败: {model_name} -> {exc}") from exc
        return payload if isinstance(payload, dict) else {}

    async def _enrich_columns_from_info_schema(
        self,
        client: IqdMcpClient,
        schema: str,
        table: str,
    ) -> dict[str, dict[str, Any]]:
        """经 MCP ``run_sql`` 读 ``information_schema.columns`` 纠偏类型 / 可空（best-effort）。

        Wren 对 info_schema 做 MDL 字段白名单校验：``column_comment`` / ``column_key``
        常不可用；可用字段含 ``data_type`` / ``is_nullable`` / ``character_maximum_length``。
        失败时返回空 dict，调用方继续用 describe_model 结果。

        须复用与 ``describe_model`` 同一 :class:`IqdMcpClient` 会话，避免重复握手
        触发 MCP streamable HTTP cancel-scope 竞态。
        """
        # 先按调用方 schema；落空再只按 table_name（StarRocks 常见 schema=adhoc）
        candidates = [
            (
                "SELECT column_name, data_type, is_nullable, character_maximum_length "
                "FROM information_schema.columns "
                f"WHERE table_schema = '{_sql_literal(schema)}' "
                f"AND table_name = '{_sql_literal(table)}'"
            ),
            (
                "SELECT column_name, data_type, is_nullable, character_maximum_length "
                "FROM information_schema.columns "
                f"WHERE table_name = '{_sql_literal(table)}'"
            ),
        ]
        for sql in candidates:
            try:
                raw = await client.run_sql(sql)
            except IqdMcpClientError as exc:
                logger.debug(
                    "IQD discovery info_schema enrich skipped",
                    table=table,
                    error=str(exc),
                )
                continue
            rows = _as_list(raw.get("rows") if isinstance(raw, dict) else None)
            if not rows:
                continue
            out: dict[str, dict[str, Any]] = {}
            for row in rows:
                if not isinstance(row, dict):
                    continue
                name = _text(row, "column_name", "COLUMN_NAME", "name")
                if not name:
                    continue
                data_type = _text(row, "data_type", "DATA_TYPE", "type")
                is_nullable = _text(row, "is_nullable", "IS_NULLABLE")
                char_max = _int(row, "character_maximum_length", "CHARACTER_MAXIMUM_LENGTH")
                out[name.lower()] = {
                    "type": data_type,
                    "nullable": None
                    if is_nullable is None
                    else is_nullable.upper() in ("YES", "Y", "TRUE", "1"),
                    "char_max": char_max,
                    "comment": None,
                }
            if out:
                return out
        return {}

    async def _create_model_from_table(self, payload: dict[str, Any]) -> dict[str, Any]:
        """调 mis-iqd 内部面生成模型（表发现导入的唯一写路径）。"""
        client = self._config_factory()
        try:
            return await client.create_model_from_table(payload)
        except IqdConfigClientError as exc:
            raise DiscoveryUnavailableError(f"生成模型失败: {exc}") from exc

    async def _existing_item_keys(self, connection_id: int) -> set[str]:
        """拉 mis-iqd catalog 元数据并取 item_key 集合（判「已存在」用）。"""
        client = self._config_factory()
        try:
            items = await client.get_catalog_meta(connection_id)
        except IqdConfigClientError as exc:
            raise DiscoveryUnavailableError(f"读取既有清单失败: {exc}") from exc
        keys: set[str] = set()
        for it in _as_list(items):
            key = _text(it, "item_key")
            if key:
                keys.add(key)
        return keys

    @staticmethod
    async def _assert_ready(client: IqdMcpClient, connection_id: int | None) -> None:
        """连通性自检：mock 回退即视为「未就绪」并 fail-closed。"""
        try:
            health = await client.health()
        except Exception as exc:  # noqa: BLE001 - 健康探测失败一律视为不可用
            raise DiscoveryUnavailableError(f"wren MCP 健康检查失败: {exc}") from exc
        if isinstance(health, dict) and health.get("mock") is True:
            raise DiscoveryUnavailableError(
                "wren MCP 未就绪（mock 回退）：profile 未注入或连接不可达"
                f"（connection_id={connection_id}）"
            )

    @staticmethod
    def _source_table_key(connection_id: int, schema: str, table: str) -> str:
        """§3.3 幂等键：``{connId}+{sha1(source_table)}``（确定性，重复导入天然幂等）。"""
        import hashlib

        raw = f"{schema}.{table}".encode()
        return f"{connection_id}+{hashlib.sha1(raw).hexdigest()}"


# ================================================================ 模块级解析工具（容忍多种载荷形态）

def _as_list(value: Any) -> list[Any]:
    """把任意值归一为 list（None → []；dict → [dict]；其它 → []）。"""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _text(node: Any, *keys: str) -> str | None:
    """按候选键取非空字符串（dict 优先；也接受字符串本身）。"""
    if isinstance(node, str):
        return node.strip() or None
    if not isinstance(node, dict):
        return None
    for key in keys:
        val = node.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _int(node: Any, *keys: str) -> int | None:
    """按候选键取 int（失败返回 None）。"""
    if not isinstance(node, dict):
        return None
    for key in keys:
        val = node.get(key)
        if isinstance(val, bool):
            continue
        if isinstance(val, int):
            return val
        if isinstance(val, str) and val.strip().lstrip("-").isdigit():
            return int(val.strip())
    return None


def _bool(node: Any, *keys: str) -> bool | None:
    """按候选键取 bool（同时认字符串 "true"/"1"；无命中返回 None）。"""
    if not isinstance(node, dict):
        return None
    for key in keys:
        val = node.get(key)
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            low = val.strip().lower()
            if low in ("true", "1", "yes"):
                return True
            if low in ("false", "0", "no"):
                return False
    return None


def _schema_name(node: Any) -> str | None:
    """从顶层 schemas/groups 元素取 schema 名（兼容字符串与对象）。"""
    return _text(node, "name", "schema", "schema_name")


def _schema_of(model: Any) -> str | None:
    """从模型对象取 schema（多候选键；再从 refSql 反解）。"""
    if not isinstance(model, dict):
        return None
    direct = _text(model, "schema", "table_schema", "tableSchema")
    if direct:
        return direct
    for container in ("properties", "catalog", "table_reference", "tableReference"):
        inner = model.get(container)
        if isinstance(inner, dict):
            nested = _text(inner, "schema", "table_schema")
            if nested:
                return nested
    return _schema_from_ref_sql(_text(model, "refSql", "ref_sql"))


def _schema_from_ref_sql(ref_sql: str | None) -> str | None:
    """从 ``select ... from <schema>.<table>`` 反解 schema（无 schema 限定则 None）。"""
    if not ref_sql:
        return None
    low = ref_sql.lower()
    idx = low.rfind(" from ")
    if idx < 0:
        return None
    rest = ref_sql[idx + 6 :].strip()
    for token in rest.replace("(", " ").replace(")", " ").replace(",", " ").split():
        cleaned = token.strip().strip('"').strip("`").strip(";")
        if not cleaned:
            continue
        parts = [p for p in cleaned.split(".") if p]
        if len(parts) >= 2:
            return parts[-2]
        return None
    return None


def _table_of(model: Any) -> str | None:
    """从模型对象取物理表名（``table`` / ``table_reference.table`` / ``refSql`` / 模型名）。"""
    if not isinstance(model, dict):
        return None
    direct = _text(model, "table", "table_name", "tableName")
    if direct:
        return direct
    for container in ("table_reference", "tableReference", "properties"):
        inner = model.get(container)
        if isinstance(inner, dict):
            nested = _text(inner, "table", "name", "table_name")
            if nested:
                return nested
    ref = _text(model, "refSql", "ref_sql")
    if ref:
        low = ref.lower()
        idx = low.rfind(" from ")
        if idx >= 0:
            for token in ref[idx + 6 :].strip().replace("(", " ").replace(")", " ").split():
                cleaned = token.strip().strip('"').strip("`").strip(";")
                if cleaned:
                    return cleaned.split(".")[-1]
    return _text(model, "name")


def _infer_pk(name: str, table: str, index: int) -> bool:
    """主键推断兜底：显式标记缺失时，按命名启发式判断。

    规则（任一命中即视为推断主键）：① 列名恰为 ``id``；② 列名为 ``<table 单数>_id``；
    ③ 任一以 ``_id`` 结尾的列且位于首列。全部为**启发式**，前端以「PK 推断」徽标呈现，
    最终以 WrenAI ``describe_model`` / 平台 model 编辑为准。
    """
    low = name.lower()
    if low == "id":
        return True
    table_low = table.lower()
    singular = table_low[:-1] if table_low.endswith("s") and len(table_low) > 1 else table_low
    if low in (f"{singular}_id", f"{table_low}_id"):
        return True
    return index == 0 and low.endswith(_PK_NAME_SUFFIXES)


def _primary_key_names(payload: dict[str, Any]) -> set[str]:
    """从 ``describe_model`` 顶层 ``primary_key`` 提取列名集合（大小写不敏感）。"""
    names: set[str] = set()
    raw = payload.get("primary_key") or payload.get("primaryKey") or payload.get("primary_keys")
    for item in _as_list(raw):
        if isinstance(item, str) and item.strip():
            names.add(item.strip().lower())
        elif isinstance(item, dict):
            n = _text(item, "name", "column", "column_name", "field")
            if n:
                names.add(n.lower())
    return names


def _normalize_data_type(raw: str | None, *, char_max: int | None = None) -> str:
    """归一化列类型展示：StarRocks STRING→VARCHAR(65533) 纠为 STRING。"""
    if not raw or not str(raw).strip():
        return "text"
    t = str(raw).strip()
    low = t.lower()
    max_len = char_max
    if max_len is None:
        # VARCHAR(65533) / varchar(65535)
        if low.startswith("varchar(") and low.endswith(")"):
            inner = low[8:-1]
            if inner.isdigit():
                max_len = int(inner)
    if low in ("varchar(65533)", "varchar(65535)") or max_len in (65533, 65535):
        return "STRING"
    if low == "varchar":
        return f"varchar({max_len})" if max_len else "varchar"
    if low in ("double", "float", "real"):
        return low.upper() if low == "double" else t
    if low in ("int", "integer", "bigint", "smallint", "tinyint", "boolean", "bool", "date", "datetime", "timestamp"):
        return t.upper() if low in ("int", "integer", "bigint", "smallint", "tinyint", "boolean", "date") else t
    return t


def _sql_literal(value: str) -> str:
    """极简 SQL 字符串转义（仅用于 discovery 内部构造的标识符字面量）。"""
    return value.replace("'", "''")
