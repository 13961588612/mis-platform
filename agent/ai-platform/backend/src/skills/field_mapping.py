"""docType → 字段映射配置（T04）。

供 formfill_apply 在 apply 时确定「单据字段 → 业务字段」的映射，
例如采购订单（purchase-order）的 reference 字段。P0 仅内置 purchase-order 参考实现，
后续可按需扩展其它单据类型的可写字段白名单。
"""
from __future__ import annotations
from typing import Any

# docType → 字段映射表。
# - fields:        该单据的全部业务字段及中文标签。
# - writable_fields: apply 时允许写回 BFF 的字段白名单（避免越权写入其它字段）。
_FIELDMAP: dict[str, dict[str, Any]] = {
    "purchase-order": {
        "doc_type": "purchase-order",
        "description": "采购订单",
        "fields": {
            "supplier": {"label": "供应商", "required": True},
            "reference": {"label": "采购订单号", "required": True},
            "amount": {"label": "金额", "required": False},
        },
        "writable_fields": ["supplier", "reference", "amount"],
    },
}

DEFAULT_DOC_TYPE = "purchase-order"


def get_doc_field_mapping(doc_type: str | None) -> dict[str, Any]:
    """获取指定单据类型的字段映射；未配置时回退默认单据。

    Args:
        doc_type: 单据类型标识。

    Returns:
        字段映射字典（可能为空）。
    """
    if not doc_type:
        return _FIELDMAP.get(DEFAULT_DOC_TYPE, {})
    return _FIELDMAP.get(doc_type, _FIELDMAP.get(DEFAULT_DOC_TYPE, {}))


def is_writable_field(doc_type: str | None, field: str) -> bool:
    """判断字段是否在该单据的可写白名单内（防越权写回）。"""
    mapping = get_doc_field_mapping(doc_type)
    writable = mapping.get("writable_fields") or []
    return field in writable
