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
from src.adapters.wren_mcp_registry import McpEndpoint, get_process_manager
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
    """按连接解析 MCP 端点并构造客户端（方案 A 多连接）。

    进程管理器（multiconn T1，:class:`WrenMcpProcessManager`）按 ``connId`` 持有独立
    ``wren serve mcp`` 子进程；取到端点即按端点连，取不到（未拉起 / 单连接形态）则退化为
    缺省客户端（沿用 ``Settings.iqd_mcp`` 的主机/端口）。

    Args:
        connection_id: 问数连接 id；``None`` 时用缺省端点。

    Returns:
        可用的 :class:`IqdMcpClient`（尚未握手，懒连接）。
    """
    if connection_id is not None:
        try:
            endpoint: McpEndpoint | None = get_process_manager().get_endpoint(connection_id)
        except Exception as exc:  # noqa: BLE001 - 注册表不可用不应阻断缺省回退
            logger.warning("IQD discovery mcp endpoint lookup failed", error=str(exc))
            endpoint = None
        if endpoint is not None:
            return IqdMcpClient(host=endpoint.host, port=endpoint.port)
    return IqdMcpClient()


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
        """列出表字段（含主键推断）。

        语义模型名与物理表名在 WrenAI 里通常是同一套命名（model 即 table 的语义包装），
        故先按「表名 == 模型名」直查 ``describe_model``；失败再回退按表名匹配模型清单。

        Args:
            connection_id: 问数连接 id。
            schema: schema 名（用于在模型清单里消歧）。
            table: 表名。

        Returns:
            ``[{"name", "type", "comment", "is_pk_inferred", "nullable"}]``。

        Raises:
            DiscoveryValidationError: ``table`` 为空（42200）。
            DiscoveryUnavailableError: 50201。
        """
        if not table or not table.strip():
            raise DiscoveryValidationError("table 不能为空")
        table_name = table.strip()
        payload = await self._describe_model(connection_id, table_name)

        raw_fields = _as_list(payload.get("fields")) or _as_list(payload.get("columns"))
        columns: list[dict[str, Any]] = []
        for idx, field in enumerate(raw_fields):
            name = _text(field, "name", "field", "column_name")
            if not name:
                continue
            explicit_pk = _bool(field, "is_primary_key", "isPrimaryKey", "primary_key", "primaryKey")
            inferred_pk = explicit_pk if explicit_pk is not None else _infer_pk(name, table_name, idx)
            nullable = _bool(field, "nullable")
            if nullable is None:
                not_null = _bool(field, "not_null", "notNull")
                nullable = (not not_null) if not_null is not None else True
            columns.append(
                {
                    "name": name,
                    "type": _text(field, "type", "data_type", "dataType") or "text",
                    "comment": _text(field, "comment", "description"),
                    "is_pk_inferred": bool(inferred_pk),
                    "nullable": bool(nullable),
                }
            )
        logger.info(
            "IQD discovery list_columns",
            connection_id=connection_id,
            schema=schema,
            table=table_name,
            columns=len(columns),
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
                # 幂等键按 §3.3：{connId}+{sha1(source_table)}（确定性 → 重复导入天然幂等）
                "idempotency_key": self._source_table_key(int(connection_id), schema, table_name),
            }
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
