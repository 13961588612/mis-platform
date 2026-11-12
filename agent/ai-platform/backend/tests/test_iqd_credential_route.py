"""路线 A 凭证保险库路由 + 直连表发现单测（2026-09-29）。

覆盖：
- iqd_credentials 路由：POST 写入（含密码留空 = 保留既有）、GET 状态（只回掩码）、DELETE 停用；
- DirectDbDiscovery：list_schemas / list_tables 的类型归一 + 系统库过滤（mock pymysql）；
- discovery_service：直连优先、wren MCP 兜底。

不依赖真实业务库；pymysql 与 vault 均以替身注入。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.agent.mis_iqd.direct_db import DirectDbDiscovery, DirectDbUnavailableError
from src.api.deps import get_current_user, get_trace_id
from src.api.routes.iqd_credentials import router as cred_router


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(cred_router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": 1}
    app.dependency_overrides[get_trace_id] = lambda: "trace-x"
    return TestClient(app)


def test_store_credential_route(client: TestClient) -> None:
    """POST /api/v1/iqd/credentials 写入 vault（mock vault.upsert_by_ref + resolve）。"""
    with patch("src.api.routes.iqd_credentials.CredentialVault") as VaultCls:
        vault = VaultCls.return_value
        vault.resolve_by_ref = AsyncMock(return_value=None)
        vault.upsert_by_ref = AsyncMock(return_value="row-1")
        resp = client.post(
            "/api/v1/iqd/credentials",
            json={
                "secret_ref": "iqd-conn-1",
                "db_type": "starrocks",
                "host": "h",
                "port": 9030,
                "user": "query",
                "password": "pwd",
                "database": "adhoc",
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["has_credential"] is True
    vault.upsert_by_ref.assert_awaited_once()
    # 明文密码进入 upsert 载荷，但响应体绝不包含密码
    (_, ref, _stype, merged), _ = vault.upsert_by_ref.call_args
    assert ref == "iqd-conn-1"
    assert merged["password"] == "pwd"
    assert "pwd" not in resp.text


def test_store_credential_blank_password_keeps_existing(client: TestClient) -> None:
    """密码留空 = 保留 vault 既有密码（编辑库坐标不重输密码）。"""
    with patch("src.api.routes.iqd_credentials.CredentialVault") as VaultCls:
        vault = VaultCls.return_value
        vault.resolve_by_ref = AsyncMock(
            return_value={"host": "old", "user": "u", "password": "old-pwd", "db_type": "starrocks"}
        )
        vault.upsert_by_ref = AsyncMock(return_value="row-1")
        resp = client.post(
            "/api/v1/iqd/credentials",
            json={"secret_ref": "iqd-conn-1", "db_type": "starrocks", "host": "new", "user": "u"},
        )
    assert resp.status_code == 200
    (_, _ref, _stype, merged), _ = vault.upsert_by_ref.call_args
    assert merged["host"] == "new"
    assert merged["password"] == "old-pwd"


def test_get_credential_status_masks_user(client: TestClient) -> None:
    """GET 只回掩码账号 + 非敏感坐标，绝不回明文密码。"""
    with patch("src.api.routes.iqd_credentials.CredentialVault") as VaultCls:
        vault = VaultCls.return_value
        vault.resolve_by_ref = AsyncMock(
            return_value={
                "host": "h", "port": 9030, "user": "query", "password": "topsecret",
                "database": "adhoc", "db_type": "starrocks",
            }
        )
        resp = client.get("/api/v1/iqd/credentials/iqd-conn-1")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["has_credential"] is True
    assert data["user_masked"] == "qu***"
    assert "topsecret" not in resp.text
    assert "password" not in data


def test_direct_db_requires_host_user() -> None:
    with pytest.raises(DirectDbUnavailableError):
        DirectDbDiscovery(db_type="starrocks", host="", port=9030, user="q", password="p")


@pytest.mark.asyncio
async def test_direct_db_list_schemas_filters_system() -> None:
    d = DirectDbDiscovery(db_type="starrocks", host="h", port=9030, user="q", password="p")
    with patch.object(
        d, "_mysql_query", new=AsyncMock(
            return_value=[("adhoc",), ("information_schema",), ("mysql",), ("dwd",)]
        )
    ):
        schemas = await d.list_schemas()
    assert schemas == ["adhoc", "dwd"]


@pytest.mark.asyncio
async def test_direct_db_list_columns_normalizes_string() -> None:
    d = DirectDbDiscovery(db_type="starrocks", host="h", port=9030, user="q", password="p")
    # (column_name, data_type, column_type, comment, is_nullable, column_key, char_max)
    rows = [
        ("id", "int", "int(11)", "主键", "NO", "PRI", None),
        ("name", "varchar", "varchar(65533)", "", "YES", "", 65533),
    ]
    with patch.object(d, "_mysql_query", new=AsyncMock(return_value=rows)):
        cols = await d.list_columns("adhoc", "t")
    assert cols[0]["is_primary_key"] is True
    assert cols[0]["type"] == "INT"
    assert cols[1]["type"] == "STRING"
    assert cols[1]["nullable"] is True


@pytest.mark.asyncio
async def test_direct_db_unsupported_type_raises() -> None:
    d = DirectDbDiscovery(db_type="oracle", host="h", port=1, user="q", password="p")
    with pytest.raises(DirectDbUnavailableError):
        await d.list_schemas()


@pytest.mark.asyncio
async def test_discovery_prefers_direct_db() -> None:
    """discovery_service：直连业务库可用时优先（能发现未建模表），不回落 wren MCP。"""
    from src.agent.mis_iqd.discovery_service import IqdDiscoveryService

    svc = IqdDiscoveryService()
    direct = MagicMock()
    direct.list_tables = AsyncMock(
        return_value=[
            {"name": "sale_ord", "comment": None, "row_count_estimate": 10},
            {"name": "store", "comment": None, "row_count_estimate": 3},
            {"name": "unmodeled_tbl", "comment": None, "row_count_estimate": 1},
        ]
    )
    with patch.object(svc, "_direct_db", new=AsyncMock(return_value=direct)):
        result = await svc.list_tables(900001, "adhoc", 1, None)
    assert result["total"] == 3
    assert {t["name"] for t in result["tables"]} >= {"unmodeled_tbl"}


@pytest.mark.asyncio
async def test_discovery_falls_back_to_wren_when_direct_unavailable() -> None:
    """直连不可用 → 回落 wren MCP（只含已建模表），不抛 50201。"""
    from src.agent.mis_iqd.discovery_service import (
        DiscoveryUnavailableError,
        IqdDiscoveryService,
    )

    svc = IqdDiscoveryService()
    mcp = MagicMock()
    mcp.list_models = AsyncMock(
        return_value={
            "models": [
                {"name": "mdl:model:sale_ord", "table": "sale_ord",
                 "properties": {"schema": "adhoc"}, "refSql": "select * from adhoc.sale_ord"}
            ]
        }
    )
    svc._mcp_factory = lambda cid: mcp  # type: ignore[assignment]
    svc._assert_ready = AsyncMock()  # type: ignore[assignment]
    with patch.object(
        svc, "_direct_db", new=AsyncMock(side_effect=DiscoveryUnavailableError("no db coords"))
    ):
        result = await svc.list_tables(900001, "adhoc", 1, None)
    assert result["total"] == 1
    assert result["tables"][0]["name"] == "sale_ord"


@pytest.mark.asyncio
async def test_discovery_marks_source_direct_and_fallback() -> None:
    """表发现须标记数据来源：直连=direct_db；回落 MCP=wren_mcp（供前端提示「非全库」）。"""
    from src.agent.mis_iqd.discovery_service import (
        DiscoveryUnavailableError,
        IqdDiscoveryService,
    )

    # 直连可用 → source=direct_db
    svc = IqdDiscoveryService()
    direct = MagicMock()
    direct.list_tables = AsyncMock(
        return_value=[{"name": "t1", "comment": None, "row_count_estimate": None}]
    )
    with patch.object(svc, "_direct_db", new=AsyncMock(return_value=direct)):
        await svc.list_tables(900001, "adhoc", 1, None)
    assert svc.last_source == "direct_db"

    # 直连不可用 → 回落 mcp，source=wren_mcp
    svc2 = IqdDiscoveryService()
    mcp = MagicMock()
    mcp.list_models = AsyncMock(
        return_value={"models": [{"name": "m", "table": "t1", "properties": {"schema": "adhoc"}}]}
    )
    svc2._mcp_factory = lambda cid: mcp  # type: ignore[assignment]
    svc2._assert_ready = AsyncMock()  # type: ignore[assignment]
    with patch.object(
        svc2, "_direct_db",
        new=AsyncMock(side_effect=DiscoveryUnavailableError("no coords")),
    ):
        await svc2.list_tables(900001, "adhoc", 1, None)
    assert svc2.last_source == "wren_mcp"


@pytest.mark.asyncio
async def test_direct_db_merges_vault_coords_before_guard() -> None:
    """vault 里有 host/database 时，应合并后再判齐全（旧版顺序 bug 会误报缺坐标）。"""
    from src.agent.mis_iqd.discovery_service import IqdDiscoveryService

    svc = IqdDiscoveryService()
    config = MagicMock()
    config.get_connection_db_profile = AsyncMock(
        return_value={"db_type": "starrocks", "port": 9030, "secret_ref": "ref-1"}
    )
    svc._config_factory = lambda: config  # type: ignore[assignment]
    vault = MagicMock()
    vault.resolve_by_ref = AsyncMock(
        return_value={"host": "10.0.0.1", "user": "query", "password": "p",
                      "database": "adhoc", "db_type": "starrocks", "port": 9030}
    )
    with patch("src.agent.mis_iqd.discovery_service.CredentialVault", return_value=vault):
        d = await svc._direct_db(900001)
    assert (d._host, d._user, d._database) == ("10.0.0.1", "query", "adhoc")


# ---------------------------------------------------------------- 数据库连接配置测试端点（Tab①）

def test_db_profile_test_no_password_no_ref() -> None:
    """无密码、无 secret_ref → ok:false（不查库），提示先存密码。"""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.api.deps import get_current_user, get_trace_id
    from src.api.routes.iqd_db_profile_test import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": 1}
    app.dependency_overrides[get_trace_id] = lambda: "t"
    client = TestClient(app)
    r = client.post("/api/v1/iqd/db-profiles/test", json={"host": "h", "user": "u"})
    assert r.status_code == 200
    assert r.json()["data"]["ok"] is False


def test_db_profile_test_resolves_password_from_vault() -> None:
    """传 secret_ref → 从 vault 取明文密码交给 DirectDbDiscovery（与表发现直连同源）。"""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.api.deps import get_current_user, get_trace_id
    from src.api.routes.iqd_db_profile_test import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": 1}
    app.dependency_overrides[get_trace_id] = lambda: "t"
    client = TestClient(app)

    inst = MagicMock()
    inst.list_schemas = AsyncMock(return_value=["adhoc"])
    with patch("src.api.routes.iqd_db_profile_test.CredentialVault") as V, patch(
        "src.api.routes.iqd_db_profile_test.DirectDbDiscovery", return_value=inst
    ) as D:
        V.return_value.resolve_by_ref = AsyncMock(return_value={"password": "pwd-from-vault"})
        r = client.post(
            "/api/v1/iqd/db-profiles/test",
            json={"host": "h", "user": "u", "secret_ref": "ref-1", "database": "adhoc"},
        )
    assert r.status_code == 200
    assert r.json()["data"]["ok"] is True
    assert D.call_args.kwargs.get("password") == "pwd-from-vault"
