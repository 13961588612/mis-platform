"""用平台清单里的真实列约束 NL→SQL。

Wren ``get_context`` / ``describe_model`` 超时后，模型只能看见授权表名，
会把「城市」猜成 ``city_name``。清单里的列（如 ``dim_mall_chl_store_df.city``）
才是可执行的字段。
"""

from __future__ import annotations

from typing import Any


def _short_name(item_key: str) -> str:
    """取模型名或物理表名的末段。

    ``mdl:model:dim_mall_chl_store_df`` 与 ``pg_main.result.dim_mall_chl_store_df``
    都落到 ``dim_mall_chl_store_df``。
    """
    text = (item_key or "").strip()
    if not text:
        return ""
    if text.startswith("mdl:"):
        return text.rsplit(":", 1)[-1].strip()
    return text.rsplit(".", 1)[-1].strip()


def _column_name(item: dict[str, Any]) -> str:
    """列名优先取 item_key 末段，其次 display_name。"""
    key = str(item.get("item_key") or "")
    name = key.rsplit(".", 1)[-1].strip() if "." in key else ""
    if name:
        return name
    return str(item.get("display_name") or "").strip()


def index_catalog_columns(items: list[dict[str, Any]] | None) -> dict[str, list[str]]:
    """按表/模型短名汇总列名（保持清单顺序，去重）。

    列的 ``parent_key`` 是物理表键。模型短名与物理表短名相同，因此同一套列
    同时挂在这两种短名上。
    """
    grouped: dict[str, list[str]] = {}
    seen: dict[str, set[str]] = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("kind") or "") != "column":
            continue
        parent = _short_name(str(item.get("parent_key") or ""))
        column = _column_name(item)
        if not parent or not column:
            continue
        key = parent.lower()
        bucket = grouped.setdefault(key, [])
        known = seen.setdefault(key, set())
        if column.lower() in known:
            continue
        known.add(column.lower())
        bucket.append(column)
    return grouped


def render_catalog_schema(
    columns_by_table: dict[str, list[str]],
    model_names: list[str],
) -> str:
    """渲染给 NL→SQL 的权威列清单。没有命中的模型时返回空串。"""
    lines: list[str] = []
    for name in model_names:
        cols = columns_by_table.get((name or "").strip().lower()) or []
        if not cols:
            continue
        short = _short_name(name) or name
        lines.append(f"model: {short}")
        lines.append("  columns: " + ", ".join(cols))
    if not lines:
        return ""
    return (
        "model_schemas (catalog columns; use ONLY these names, "
        "do not invent columns such as city_name when the list has city):\n"
        + "\n".join(lines)
    )


def tables_in_sql(sql: str) -> list[str]:
    """取出 SQL 里的表名。解析失败时返回空列表。"""
    if not sql.strip():
        return []
    try:
        import sqlglot
        from sqlglot import exp
    except Exception:  # noqa: BLE001
        return []
    try:
        expression = sqlglot.parse_one(sql, read="mysql")
    except Exception:  # noqa: BLE001
        return []
    names: list[str] = []
    seen: set[str] = set()
    for table in expression.find_all(exp.Table):
        name = str(table.name or "").strip()
        low = name.lower()
        if not name or low in seen:
            continue
        seen.add(low)
        names.append(name)
    return names


def columns_for_sql(
    sql: str,
    columns_by_table: dict[str, list[str]],
) -> dict[str, list[str]]:
    """只保留这条 SQL 实际引用、且清单里有列的表。"""
    scoped: dict[str, list[str]] = {}
    for name in tables_in_sql(sql):
        cols = columns_by_table.get(name.lower())
        if cols:
            scoped[name.lower()] = cols
    return scoped


def unknown_sql_columns(sql: str, columns_by_table: dict[str, list[str]]) -> list[str]:
    """返回 SQL 里引用了、但清单中不存在的列名。清单为空时不判断。"""
    if not sql.strip() or not columns_by_table:
        return []
    try:
        import sqlglot
        from sqlglot import exp
    except Exception:  # noqa: BLE001
        return []
    try:
        expression = sqlglot.parse_one(sql, read="mysql")
    except Exception:  # noqa: BLE001
        return []

    known: set[str] = set()
    saw_table = False
    for table in expression.find_all(exp.Table):
        cols = columns_by_table.get(str(table.name or "").lower())
        if not cols:
            continue
        saw_table = True
        known.update(col.lower() for col in cols)
    if not saw_table:
        return []

    missing: list[str] = []
    seen: set[str] = set()
    for column in expression.find_all(exp.Column):
        name = str(column.name or "").strip()
        if not name or name == "*":
            continue
        low = name.lower()
        if low in known or low in seen:
            continue
        seen.add(low)
        missing.append(name)
    return missing
