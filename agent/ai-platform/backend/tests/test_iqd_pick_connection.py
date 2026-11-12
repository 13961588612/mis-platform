"""iqd 按项目名选连接：精确匹配，匹配不到或同名多条时不回退。"""

from __future__ import annotations

import pytest

from src.agent.mis_iqd.errors import WrenaiNotConfiguredError
from src.agent.mis_iqd.scope_resolver import ScopeResolver

CONFIGS = [
    {"id": 11, "name": "default", "enabled": 1},
    {"id": 42, "name": "bg-data", "enabled": 1},
]


def test_pick_by_project_name() -> None:
    conn = ScopeResolver._pick_connection(CONFIGS, "bg-data")
    assert conn["id"] == 42


def test_pick_by_project_name_strips_whitespace() -> None:
    conn = ScopeResolver._pick_connection(CONFIGS, "  bg-data  ")
    assert conn["id"] == 42


def test_pick_by_numeric_id_and_digit_string() -> None:
    assert ScopeResolver._pick_connection(CONFIGS, 42)["name"] == "bg-data"
    assert ScopeResolver._pick_connection(CONFIGS, "11")["name"] == "default"


def test_missing_name_does_not_fall_back() -> None:
    with pytest.raises(WrenaiNotConfiguredError, match="未找到名为 missing"):
        ScopeResolver._pick_connection(CONFIGS, "missing")


def test_duplicate_name_does_not_fall_back() -> None:
    dup = [*CONFIGS, {"id": 43, "name": "bg-data", "enabled": 1}]
    with pytest.raises(WrenaiNotConfiguredError, match="多条已启用连接"):
        ScopeResolver._pick_connection(dup, "bg-data")


def test_omitted_selector_uses_first_enabled() -> None:
    assert ScopeResolver._pick_connection(CONFIGS, None)["id"] == 11
    assert ScopeResolver._pick_connection(CONFIGS, "  ")["id"] == 11


def test_unknown_numeric_id_still_falls_back() -> None:
    assert ScopeResolver._pick_connection(CONFIGS, 999)["id"] == 11


def test_disabled_project_by_name_rejected() -> None:
    mixed = [
        *CONFIGS,
        {"id": 99, "name": "sm-data", "enabled": 0},
    ]
    with pytest.raises(WrenaiNotConfiguredError, match="已停用"):
        ScopeResolver._pick_connection(mixed, "sm-data")


def test_disabled_project_by_id_rejected() -> None:
    mixed = [
        *CONFIGS,
        {"id": 99, "name": "sm-data", "enabled": False},
    ]
    with pytest.raises(WrenaiNotConfiguredError, match="已停用"):
        ScopeResolver._pick_connection(mixed, 99)


def test_default_skips_disabled_rows() -> None:
    mixed = [
        {"id": 1, "name": "off", "enabled": 0},
        {"id": 2, "name": "on", "enabled": 1},
    ]
    assert ScopeResolver._pick_connection(mixed, None)["id"] == 2


def test_all_disabled_raises() -> None:
    with pytest.raises(WrenaiNotConfiguredError):
        ScopeResolver._pick_connection([{"id": 1, "name": "off", "enabled": 0}], None)
