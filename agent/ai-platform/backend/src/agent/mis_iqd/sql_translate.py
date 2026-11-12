"""sql_translate — 样本对方言转化（v1.10 / architecture §4.2.3）。

把用户手写的源方言 SQL（Oracle / MySQL / PostgreSQL / ClickHouse）翻成
WrenAI 能消费的方言（WrenAI / DataFusion 系），供 few-shot 样本对直接注入
WrenAI 提示（architecture §4.2.3②：样本是作为 ``sql_pairs`` 直接注入提示的）。

目标方言（A14①）：架构指出 WrenAI 在 ``trino`` / ``duckdb`` 之间，候选需由
W0 探针 3f 实测确认。**当前以模块常量 :data:`WREN_TARGET_DIALECT` 占位**，
待 W0 探针 3f 校准后仅需改此常量（及对应 sqlglot dialect 名），即 TODO 标注。
"""

from __future__ import annotations

from typing import Any

import sqlglot

# TODO(v1.10 / W0 探针 3f): 目标方言待 W0 探针 3f 实测确认。
#   架构 A14① 指出 WrenAI/DataFusion 系候选 duckdb / trino，W0 探针 3f 未实测。
#   当前默认 trino；校准后仅需改此常量（及下方 _SOURCE_DIALECT_MAP 的目标占位）。
WREN_TARGET_DIALECT = "trino"

# 源方言映射：用户所选关系库类型 → sqlglot dialect 名（均为 sqlglot 原生支持）。
_SOURCE_DIALECT_MAP: dict[str, str] = {
    "oracle": "oracle",
    "mysql": "mysql",
    "postgres": "postgres",
    "clickhouse": "clickhouse",
}

# Oracle 专有语法嗅探：sqlglot 可能无法直译或会静默改变语义，命中即给人工核对告警。
_PROPRIETARY_HINTS: list[tuple[str, str]] = [
    (
        "CONNECT BY",
        "Oracle 专有语法 CONNECT BY（层级查询）无直接等价，请手改等价 WrenAI 递归 CTE。",
    ),
    (
        "START WITH",
        "Oracle 专有语法 START WITH 无直接等价，请手改等价 WrenAI 递归 CTE。",
    ),
    (
        "ROWNUM",
        "Oracle ROWNUM 伪列无直接等价，请手改为 LIMIT / 窗口函数或 WrenAI ROW_NUMBER()。",
    ),
    (
        "NVL(",
        "Oracle NVL() 请确认已转为 COALESCE()（sqlglot 通常会自动转，请复核）。",
    ),
    (
        "SYSDATE",
        "Oracle SYSDATE 请确认已转为 CURRENT_DATE / NOW()（sqlglot 通常会自动转）。",
    ),
    (
        "DECODE(",
        "Oracle DECODE() 请确认已转为 CASE WHEN（sqlglot 通常会自动转，请复核）。",
    ),
    (
        "(+) ",
        "Oracle (+) 老式外连接语法无直接等价，请手改为标准 LEFT JOIN。",
    ),
    (
        "FROM DUAL",
        "Oracle DUAL 哑表在 WrenAI 中通常不需，请确认是否可直接去掉。",
    ),
]


def _source_dialect(db_type: str) -> str:
    """把用户所选 DB 类型解析为 sqlglot 源 dialect 名（容错缺省 postgres）。"""
    key = (db_type or "").strip().lower()
    return _SOURCE_DIALECT_MAP.get(key, key or "postgres")


def translate_sql_pair(db_type: str, native_sql: str) -> dict[str, Any]:
    """把源方言 SQL 翻成 WrenAI 方言。

    Args:
        db_type: 用户所选关系库类型（oracle / mysql / postgres / clickhouse）。
        native_sql: 用户手写的原生 SQL（源方言）。

    Returns:
        ``{"wren_sql": str, "warnings": list[str]}``。
        失败（解析/翻译异常）时 ``wren_sql`` 尽力翻译或空串，``warnings`` 写入具体
        提示，**不抛 500**（A14③：兜底与告警）。

    Note:
        多语句翻译：sqlglot.transpile 返回 list[str]，按语句合并为 ``;\\n`` 分隔的
        单字符串，便于在 wur 框内整体展示与手改。
    """
    warnings: list[str] = []
    src = _source_dialect(db_type)

    if not native_sql or not native_sql.strip():
        return {"wren_sql": "", "warnings": ["原生 SQL 为空，无法翻译"]}

    try:
        translated = sqlglot.transpile(native_sql, read=src, write=WREN_TARGET_DIALECT)
    except Exception as exc:  # noqa: BLE001 - 兜底：不抛 500，返回空 + 告警
        warnings.append(
            f"源方言（{src}）解析/翻译失败：{exc}。"
            "请检查 SQL 语法，或在 wrensql 框直接手写/手改目标方言。"
        )
        return {"wren_sql": "", "warnings": warnings}

    if not translated:
        warnings.append("翻译结果为空，请检查 SQL 是否合法（可能为不支持的专有语法）。")
        return {"wren_sql": "", "warnings": warnings}

    # 合并多语句（保留原始语句顺序），语句间以 ; 分隔。
    wren_sql = ";\n".join(s.strip() for s in translated if s and s.strip())

    # 专有语法嗅探告警（命中即提示人工核对，不阻断翻译）。
    upper = native_sql.upper()
    for needle, message in _PROPRIETARY_HINTS:
        if needle.upper() in upper:
            warnings.append(message)

    return {"wren_sql": wren_sql, "warnings": warnings}
