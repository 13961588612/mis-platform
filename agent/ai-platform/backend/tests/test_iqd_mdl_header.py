"""MDL top-level header normalization tests (2026-09-30).

Real wren 0.13 ``dry-plan`` reads ``target/mdl.json`` and enforces top-level shapes:
``catalog`` MUST be a string; ``dataSource`` MUST be a controlled enum string or absent.
The old platform placeholder wrote both as maps, which made every dry-plan fail with
``Serde JSON error: invalid type: map, expected a string``.
"""

from __future__ import annotations

from src.agent.mis_iqd.service import (
    _normalize_mdl_header,
    _wren_datasource,
)


def test_maps_are_rewritten_to_strings() -> None:
    mdl = {
        "catalog": {"schema": "public"},
        "schema": "public",
        "dataSource": {"profile": "", "type": ""},
        "models": [{"name": "m"}],
    }
    changed = _normalize_mdl_header(mdl, datasource="doris")
    assert mdl["catalog"] == "wren"
    assert mdl["dataSource"] == "doris"
    assert "catalog" in changed and "dataSource" in changed
    assert mdl["models"] == [{"name": "m"}]  # business nodes untouched


def test_missing_catalog_is_filled() -> None:
    mdl = {"dataSource": "doris", "models": []}
    changed = _normalize_mdl_header(mdl, datasource="doris")
    assert mdl["catalog"] == "wren"
    assert "catalog" in changed
    assert mdl["schema"] == "public"
    assert "dataSource" not in changed  # already valid enum


def test_datasource_omitted_when_unknown() -> None:
    mdl = {"catalog": "wren", "schema": "public", "models": []}
    _normalize_mdl_header(mdl, datasource=None)
    # No dialect -> the key is omitted entirely (wren accepts absent dataSource).
    assert "dataSource" not in mdl


def test_datasource_map_dropped_without_dialect() -> None:
    mdl = {"catalog": "wren", "dataSource": {"profile": "x", "type": "y"}}
    _normalize_mdl_header(mdl, datasource=None)
    assert "dataSource" not in mdl
    assert mdl["catalog"] == "wren"


def test_existing_valid_enum_string_is_preserved() -> None:
    mdl = {"catalog": "wren", "schema": "public", "dataSource": "doris"}
    changed = _normalize_mdl_header(mdl, datasource="postgres")
    assert mdl["dataSource"] == "doris"
    assert "dataSource" not in changed


def test_wren_datasource_mapping() -> None:
    assert _wren_datasource("starrocks") == "doris"
    assert _wren_datasource("DORIS") == "doris"
    assert _wren_datasource("postgresql") == "postgres"
    assert _wren_datasource("mysql") == "mysql"
    assert _wren_datasource("") is None
    assert _wren_datasource("unknown_db") is None
