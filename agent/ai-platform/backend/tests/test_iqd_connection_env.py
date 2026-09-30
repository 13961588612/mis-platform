"""Connection env resolution: merge coords + wren-native datasource (2026-09-30).

Real incident: the vault ciphertext for a StarRocks connection contained only
host/user/password/database (no port). The agent then wrote ``port: ""`` into the wren
profile, and ``wren serve mcp`` / ``dry_run`` failed with
``invalid literal for int() with base 10: \'\'`` (surfaced as "SQL precheck failed").
Also, wren profile ``datasource`` must be the engine name (StarRocks -> "doris").

These tests pin the coordinate-merge + datasource-normalization behavior.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.adapters.iqd_config_client import IqdConfigClient


class _FakeClient(IqdConfigClient):
    """Override the two network calls used by get_connection_env."""

    def __init__(self, cred: dict[str, Any], profile: dict[str, Any] | None) -> None:
        super().__init__()
        self._cred = cred
        self._profile = profile

    async def _request(self, method, path, ctx=None, *, params=None, payload=None):  # type: ignore[override]
        if "connection-credentials" in path:
            return {"connection_id": 1, "secret_ref": "iqd-conn-1"}
        return {}

    async def get_connection_db_profile(self, connection_id, ctx=None):  # type: ignore[override]
        return self._profile


@pytest.mark.asyncio
async def test_missing_port_is_filled_from_db_profile(monkeypatch) -> None:
    from src.identity import credential_vault as vault_mod

    class _Vault:
        async def resolve_by_ref(self, ref: str) -> dict[str, Any]:
            # No port here -> the known real-machine shape.
            return {"host": "10.0.0.9", "user": "query", "password": "p", "database": "adhoc"}

    monkeypatch.setattr(vault_mod, "CredentialVault", _Vault)
    client = _FakeClient(
        cred={},
        profile={"db_type": "starrocks", "host": "10.0.0.9", "port": 9030,
                 "database": "adhoc", "user": "query"},
    )
    env = await client.get_connection_env(1)
    assert env["WREN_PG_PORT"] == "9030"
    # StarRocks must be normalized to the wren engine name.
    assert env["WREN_DB_TYPE"] == "doris"


@pytest.mark.asyncio
async def test_existing_credential_values_win(monkeypatch) -> None:
    from src.identity import credential_vault as vault_mod

    class _Vault:
        async def resolve_by_ref(self, ref: str) -> dict[str, Any]:
            return {"host": "1.1.1.1", "port": 1111, "user": "u", "password": "p", "database": "d"}

    monkeypatch.setattr(vault_mod, "CredentialVault", _Vault)
    client = _FakeClient(
        cred={},
        profile={"host": "9.9.9.9", "port": 9999, "database": "other", "user": "other"},
    )
    env = await client.get_connection_env(1)
    assert env["WREN_PG_PORT"] == "1111"
    assert env["WREN_PG_HOST"] == "1.1.1.1"
