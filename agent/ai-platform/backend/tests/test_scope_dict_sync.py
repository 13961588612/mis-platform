"""ScopeDictSyncService / DirectDbScopeWriter 单测（无真实 DB：mock config + writer）。"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.agent.mis_iqd import scope_dict_sync_service as mod
from src.agent.mis_iqd.direct_db_writer import DirectDbScopeWriter
from src.agent.mis_iqd.scope_dict_sync_service import ScopeDictSyncError, ScopeDictSyncService


class FakeConfig:
    def __init__(self, mat_rows, profile):
        self._mat = mat_rows
        self._profile = profile

    async def get_scope_dict_materialize(self, connection_id, dimension_code="dept", ctx=None):
        return {"rows": self._mat}

    async def get_connection_db_profile(self, connection_id, ctx=None):
        return self._profile


def test_store_dimension_skipped():
    svc = ScopeDictSyncService(config_client=FakeConfig([], {}))
    out = asyncio.run(svc.sync_dimension(1, "store"))
    assert out["status"] == "skipped"
    assert out["written"] == 0


def test_dept_sync_writes_rows(monkeypatch):
    rows = [
        {"external_value": "D001", "dept_path": "/0/1/A/A1/"},
        {"external_value": "D002", "dept_path": "/0/1/A/A2/"},
    ]
    profile = {
        "db_type": "postgres", "host": "h", "port": 5432,
        "database": "d", "user": "u", "secret_ref": "sr",
    }
    svc = ScopeDictSyncService(config_client=FakeConfig(rows, profile))

    writes: dict[str, Any] = {}

    class FakeWriter:
        def __init__(self, **kwargs):
            writes["kwargs"] = kwargs

        async def upsert_dept_scope(self, rws, *, clear_first=True):
            writes["rows"] = rws
            writes["clear_first"] = clear_first
            return len(rws)

    monkeypatch.setattr(mod, "DirectDbScopeWriter", FakeWriter)
    # stub CredentialVault.resolve_by_ref
    async def fake_resolve(ref):
        return {"password": "p"}

    monkeypatch.setattr(mod.CredentialVault, "resolve_by_ref", lambda self, ref: fake_resolve(ref))

    out = asyncio.run(svc.sync_dimension(7, "dept"))
    assert out["status"] == "ok"
    assert out["written"] == 2
    assert writes["clear_first"] is True
    assert writes["kwargs"]["password"] == "p"


def test_dept_sync_missing_coords_raises(monkeypatch):
    svc = ScopeDictSyncService(config_client=FakeConfig([], {"secret_ref": "sr"}))

    async def fake_resolve(ref):
        return {}

    monkeypatch.setattr(mod.CredentialVault, "resolve_by_ref", lambda self, ref: fake_resolve(ref))
    with pytest.raises(ScopeDictSyncError):
        asyncio.run(svc.sync_dimension(7, "dept"))
