"""已更名 skill_id 的兼容别名（工具入参 / 报告 target_skill_id）。"""

from __future__ import annotations

from typing import Any

# 旧日报 id → 现网 sm-shop-ops-diary-report
SKILL_ID_ALIASES: dict[str, str] = {
    "sm-shop-ops-daily-report": "sm-shop-ops-diary-report",
}


def canonicalize_skill_id(raw: Any) -> Any:
    """把历史 skill_id 归一到当前正式 id；非字符串原样返回。"""
    if not isinstance(raw, str):
        return raw
    key = raw.strip()
    return SKILL_ID_ALIASES.get(key, key)
