"""MaskingEngine — 全平台 WrenAI 结果的唯一脱敏出口（v1.9 / B3，architecture §7.5）。

规则来源（优先级从高到低，§7.5）：
1. ``iqd_catalog_item.mask_rule``（字段级显式指定）
2. ``iqd_catalog_item.sensitive_level=high`` → 按 ``data_type`` 兜底规则
3. ``iqd_mask_rule``（match_type: column_name → regex → semantic_tag 依次匹配，priority 小者优先）

内置规则（对齐 03-security §9.3）：
- ``phone``  138****0000        保留前 3 后 4
- ``idcard`` 110***********1234 保留前 3 后 4
- ``email``  a***@example.com   保留首字符与域名
- ``amount`` ****               完全遮蔽（薪资类）
- ``full``   ****               完全遮蔽

调用点约束（orchestrator masking 阶段，W2 已接线）：
- 必须在 ResponseProjector 之前调用（脱敏是数据事实，投影是可见性）
- 审计写**脱敏后** rows 摘要（不落明文），保留 masked_columns 明细
- 后台 view=admin 同样脱敏 —— 「能看 SQL」≠「能看明文敏感数据」
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from src.models.iqd_schema import ColumnMeta
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.masking")

#: 完全遮蔽占位符
FULL_MASK = "****"

#: 高敏感字段 data_type → 兜底脱敏规则（sensitive_level=high 且无显式 mask_rule 时）
_DATA_TYPE_DEFAULT_RULE: dict[str, str] = {
    "phone": "phone",
    "mobile": "phone",
    "tel": "phone",
    "idcard": "idcard",
    "id_card": "idcard",
    "email": "email",
    "money": "amount",
    "amount": "amount",
    "decimal": "amount",
    "numeric": "amount",
}

#: 列名关键词 → 兜底脱敏规则（sensitive_level=high 且 data_type 未命中时按列名兜底）
_COLUMN_NAME_DEFAULT_RULE: dict[str, str] = {
    "phone": "phone",
    "mobile": "phone",
    "tel": "phone",
    "idcard": "idcard",
    "id_card": "idcard",
    "email": "email",
    "salary": "amount",
    "amount": "amount",
    "price": "amount",
}

#: 手机号正则（11 位数字，可含 +86/空格/连字符前缀）
_PHONE_RE = re.compile(r"^(?:\+?86[- ]?)?1[3-9]\d{9}$")

#: 身份证正则（18 位，末位可为 X）
_IDCARD_RE = re.compile(r"^\d{17}[\dXx]$")


@dataclass
class MaskRule:
    """一条脱敏规则（来自 iqd_mask_rule / catalog 字段级）。"""

    name: str = ""
    match_type: str = "column_name"  # column_name | regex | semantic_tag
    pattern: str = ""
    rule: str = "full"  # phone | idcard | email | amount | full | custom
    replacement: str | None = None
    priority: int = 0
    enabled: bool = True


@dataclass
class MaskOutcome:
    """脱敏结果（orchestrator 消费形态）。

    Attributes:
        columns: 脱敏后的列元信息（masked 标记已置位）。
        rows: 脱敏后的数据行（未命中的 cell 原样保留）。
        masked_columns: 被脱敏的列名列表（供审计 masked_columns 明细）。
    """

    columns: list[ColumnMeta] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    masked_columns: list[str] = field(default_factory=list)


class MaskingEngine:
    """结果脱敏引擎（唯一出口）。

    Args:
        config_client: ``IqdConfigClient`` 实例（可注入 mock；缺省懒加载）。
    """

    def __init__(self, config_client: Any | None = None) -> None:
        """初始化脱敏引擎。"""
        self._config_client: Any = config_client

    async def apply(
        self,
        columns: list[ColumnMeta],
        rows: list[list[Any]],
        *,
        connection_id: int | None = None,
        catalog_items: list[dict[str, Any]] | None = None,
        mask_rules: list[dict[str, Any]] | None = None,
    ) -> MaskOutcome:
        """对结果列/行脱敏（规则加载失败/无规则时原样返回，不阻断主链路）。

        Args:
            columns: 结果列元信息（name/item_key/data_type）。
            rows: 结果行（与 columns 顺序对应）。
            connection_id: 连接 id（规则按连接分桶）。
            catalog_items: 清单元数据（item_key/mask_rule/sensitive_level/data_type）；
                缺省经配置客户端读取。
            mask_rules: 脱敏规则列表；缺省经配置客户端读取。

        Returns:
            :class:`MaskOutcome`。
        """
        if not columns:
            return MaskOutcome(columns=columns, rows=rows, masked_columns=[])

        if catalog_items is None:
            catalog_items = await self._load_catalog_items(connection_id)
        if mask_rules is None:
            mask_rules = await self._load_mask_rules()

        rules = self._compile_rules(mask_rules)
        catalog_by_key = self._index_catalog(catalog_items)

        mask_fns: list[MaskRule | None] = []
        new_columns: list[ColumnMeta] = []
        for col in columns:
            col_meta = catalog_by_key.get(col.item_key or col.name)
            rule = self._resolve_rule(col, col_meta, rules)
            mask_fns.append(rule)
            new_columns.append(
                ColumnMeta(
                    name=col.name,
                    item_key=col.item_key,
                    data_type=col.data_type,
                    display_name=col.display_name,
                    masked=rule is not None or col.masked,
                )
            )

        masked_names = [
            col.name or col.item_key or ""
            for col, rule in zip(columns, mask_fns)
            if rule is not None
        ]

        new_rows: list[list[Any]] = []
        for row in rows:
            new_row: list[Any] = []
            for idx, value in enumerate(row):
                rule = mask_fns[idx] if idx < len(mask_fns) else None
                new_row.append(self._mask_value(value, rule) if rule is not None else value)
            new_rows.append(new_row)

        outcome = MaskOutcome(
            columns=new_columns,
            rows=new_rows,
            masked_columns=[name for name in masked_names if name],
        )
        if outcome.masked_columns:
            logger.info("IQD masking applied", masked_columns=outcome.masked_columns)
        return outcome

    # ================================================================ 规则解析

    def _compile_rules(self, raw_rules: list[dict[str, Any]] | None) -> list[MaskRule]:
        """把 wire 规则字典编译为有序规则（enabled 且按 priority 升序）。"""
        if not raw_rules:
            return []
        compiled: list[MaskRule] = []
        for raw in raw_rules:
            if not isinstance(raw, dict):
                continue
            enabled = raw.get("enabled")
            if enabled is not None and not _as_bool(enabled):
                continue
            compiled.append(
                MaskRule(
                    name=str(raw.get("name") or ""),
                    match_type=str(raw.get("match_type") or "column_name"),
                    pattern=str(raw.get("pattern") or ""),
                    rule=str(raw.get("rule") or "full"),
                    replacement=raw.get("replacement") if isinstance(raw.get("replacement"), str) else None,
                    priority=int(raw.get("priority") or 0),
                    enabled=True,
                )
            )
        compiled.sort(key=lambda r: r.priority)
        return compiled

    def _index_catalog(self, catalog_items: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
        """按 item_key 索引清单元数据。"""
        index: dict[str, dict[str, Any]] = {}
        for item in catalog_items or []:
            if isinstance(item, dict):
                key = str(item.get("item_key") or item.get("name") or "")
                if key:
                    index[key] = item
        return index

    def _resolve_rule(
        self,
        col: ColumnMeta,
        col_meta: dict[str, Any] | None,
        rules: list[MaskRule],
    ) -> MaskRule | None:
        """按优先级为单列解析脱敏规则（返回 None = 不脱敏）。"""
        col_name = (col.name or "").lower()
        col_key = (col.item_key or "").lower()

        # 1. catalog 显式 mask_rule
        if col_meta:
            explicit = col_meta.get("mask_rule")
            if explicit:
                for r in rules:
                    if r.name == explicit:
                        return r
                # 显式规则名未注册：退化为 full（fail-closed，不静默放行明文）
                return MaskRule(name=str(explicit), rule="full")

        # 2. catalog sensitive_level=high → data_type / 列名兜底
        if col_meta:
            level = str(col_meta.get("sensitive_level") or "none")
            if level == "high":
                rule_name = _DATA_TYPE_DEFAULT_RULE.get((col.data_type or "").lower())
                if not rule_name:
                    for keyword, candidate in _COLUMN_NAME_DEFAULT_RULE.items():
                        if keyword in col_name or keyword in col_key:
                            rule_name = candidate
                            break
                return MaskRule(name="", rule=rule_name or "full")

        # 3. iqd_mask_rule（column_name → semantic_tag，priority 小者优先；regex 逐值判定）
        for r in rules:
            if r.match_type == "column_name" and _match_column_name(r.pattern, col_name, col_key):
                return r
        for r in rules:
            if r.match_type == "semantic_tag" and _match_column_name(r.pattern, col_name, col_key):
                return r
        for r in rules:
            if r.match_type == "regex":
                return r  # 列级无法判定，交给 _mask_value 逐值命中
        return None

    # ================================================================ 值脱敏

    def _mask_value(self, value: Any, rule: MaskRule) -> Any:
        """对单个 cell 值脱敏（非字符串值先转字符串；regex 规则在此按值命中）。"""
        if value is None:
            return value
        if rule.match_type == "regex":
            try:
                if not re.search(rule.pattern or "", str(value)):
                    return value  # 未命中该行值：保持原样
            except re.error:
                return value
        return self._apply_builtin(str(value), rule.rule, rule.replacement)

    def _apply_builtin(self, text: str, rule: str, replacement: str | None) -> str:
        """应用内置脱敏算法。"""
        if not text:
            return text
        if rule == "phone":
            digits = re.sub(r"[^\d]", "", text)
            if _PHONE_RE.match(digits) and len(digits) == 11:
                return digits[:3] + "****" + digits[-4:]
            return FULL_MASK
        if rule == "idcard":
            digits = text.strip().upper()
            if _IDCARD_RE.match(digits) and len(digits) == 18:
                return digits[:3] + "***********" + digits[-4:]
            return FULL_MASK
        if rule == "email":
            at = text.find("@")
            if at > 0:
                domain = text[at:]
                return text[0] + "***" + domain
            return FULL_MASK
        if rule == "amount":
            return FULL_MASK
        if rule == "custom":
            return replacement if replacement else FULL_MASK
        return FULL_MASK  # full / 未知规则一律完全遮蔽

    # ================================================================ 配置加载

    async def _load_catalog_items(self, connection_id: int | None) -> list[dict[str, Any]]:
        """加载清单元数据（失败降级为空，不阻断）。"""
        try:
            client = self._get_config_client()
            return await client.get_catalog_items(connection_id)
        except Exception as exc:  # noqa: BLE001 - 规则加载失败不阻断主链路
            logger.warning("IQD masking catalog load skipped", error=str(exc))
            return []

    async def _load_mask_rules(self) -> list[dict[str, Any]]:
        """加载脱敏规则（失败降级为空，不阻断）。"""
        try:
            client = self._get_config_client()
            return await client.get_mask_rules()
        except Exception as exc:  # noqa: BLE001 - 规则加载失败不阻断主链路
            logger.warning("IQD masking rules load skipped", error=str(exc))
            return []

    def _get_config_client(self) -> Any:
        """懒加载 IqdConfigClient（便于单测注入 mock）。"""
        if self._config_client is None:
            from src.adapters.iqd_config_client import IqdConfigClient

            self._config_client = IqdConfigClient()
        return self._config_client


# ================================================================ 工具


def _as_bool(value: Any) -> bool:
    """规约为布尔（1/true/yes/on 视为 True）。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _match_column_name(pattern: str, col_name: str, col_key: str) -> bool:
    """列名/列键匹配（子串大小写不敏感；空 pattern 不命中）。"""
    if not pattern:
        return False
    return pattern.lower() in col_name or pattern.lower() in col_key
