"""企微 corp 配置存储（方案 B 写路径）+ ``secret://`` 解析测试。

用 tmp_path 隔离 YAML，不碰真实 configs；vault 用替身，验证：
* create/update/delete 的原子落盘与顺序；
* 删除幂等；
* ``resolve_corp_secret`` 对 ``secret://`` 走 vault 且**不回退全局**（fail-closed）。
"""

from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any


import pytest
import yaml

from src.channels.wecom_contacts_client import resolve_corp_secret
from src.channels.wecom_corp_store import (
    WecomCorpCreateRequest,
    WecomCorpNotFoundError,
    WecomCorpStore,
    WecomCorpUpdateRequest,
    canonical_secret_ref,
)


def _tmpdir() -> Path:
    """在系统 Temp 下建一个临时目录（失败时回退到当前工作目录）。"""
    base = Path(tempfile.gettempdir())
    target = base / f"wecomstore-{uuid.uuid4().hex}"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError:
        target = Path.cwd() / f"wecomstore-{uuid.uuid4().hex}"
        target.mkdir(parents=True, exist_ok=True)
    return target


@pytest.mark.asyncio
async def test_corp_store_crud_roundtrip() -> None:
    workdir = _tmpdir()
    path = workdir / "wecom-corps.yaml"
    store = WecomCorpStore(path=path)

    created = await store.create(
        WecomCorpCreateRequest(corp_id="ww-1", tenant_id=1, name="总部")
    )
    assert created.corp_id == "ww-1"
    assert created.secret_ref == canonical_secret_ref("ww-1")
    # 落盘后重新加载可见（mtime 感知）
    reloaded = WecomCorpStore(path=path)
    assert [c.corp_id for c in reloaded.list_corps()] == ["ww-1"]

    updated = await store.update("ww-1", WecomCorpUpdateRequest(name="改名后", user_bind_mode="manual_only"))
    assert updated.name == "改名后"
    assert updated.user_bind_mode == "manual_only"

    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert raw["corps"][0]["name"] == "改名后"
    # YAML 里只有引用，没有明文 secret
    assert raw["corps"][0]["secret_ref"] == "secret://wecom/corp/ww-1"

    assert await store.delete("ww-1") is True
    assert store.list_corps() == []
    # 幂等
    assert await store.delete("ww-1") is False
    shutil.rmtree(workdir, ignore_errors=True)


@pytest.mark.asyncio
async def test_corp_store_duplicate_and_missing() -> None:
    workdir = _tmpdir()
    store = WecomCorpStore(path=workdir / "wecom-corps.yaml")
    await store.create(WecomCorpCreateRequest(corp_id="ww-1", tenant_id=1))
    from src.channels.wecom_corp_store import WecomCorpConflictError

    with pytest.raises(WecomCorpConflictError):
        await store.create(WecomCorpCreateRequest(corp_id="ww-1", tenant_id=1))
    with pytest.raises(WecomCorpNotFoundError):
        await store.update("ww-missing", WecomCorpUpdateRequest(name="x"))
    shutil.rmtree(workdir, ignore_errors=True)


class _FakeVault:
    """替身：控制 resolve_by_ref 的返回。"""

    def __init__(self, value: dict[str, Any] | None) -> None:
        self._value = value
        self.calls: list[str] = []

    async def resolve_by_ref(self, ref: str) -> dict[str, Any] | None:
        self.calls.append(ref)
        return self._value


@pytest.mark.asyncio
async def test_resolve_secret_via_vault(monkeypatch) -> None:
    from src.channels.wecom_corp_store import WecomCorpRecord

    fake = _FakeVault({"corpsecret": "from-vault"})
    monkeypatch.setattr(
        "src.identity.credential_vault.CredentialVault", lambda: fake
    )
    corp = WecomCorpRecord(
        corp_id="ww-1", tenant_id=1, secret_ref="secret://wecom/corp/ww-1"
    )
    assert await resolve_corp_secret(corp) == "from-vault"
    assert fake.calls == ["secret://wecom/corp/ww-1"]


@pytest.mark.asyncio
async def test_resolve_secret_vault_miss_fails_closed(monkeypatch) -> None:
    """显式 secret:// 引用解析不到时必须 fail-closed，**不回退全局 WECOM_SECRET**。"""
    from src.channels.wecom_corp_store import WecomCorpRecord

    fake = _FakeVault(None)
    monkeypatch.setattr("src.identity.credential_vault.CredentialVault", lambda: fake)
    monkeypatch.setattr(
        "src.config.get_settings",
        lambda: type("S", (), {"WECOM_SECRET": "global-should-not-be-used"})(),
    )
    corp = WecomCorpRecord(
        corp_id="ww-1", tenant_id=1, secret_ref="secret://wecom/corp/ww-1"
    )
    assert await resolve_corp_secret(corp) == ""


@pytest.mark.asyncio
async def test_resolve_secret_env_and_inline(monkeypatch) -> None:
    from src.channels.wecom_corp_store import WecomCorpRecord

    monkeypatch.setenv("WECOM_TEST_SECRET", "env-value")
    env_corp = WecomCorpRecord(
        corp_id="ww-1", tenant_id=1, secret_ref="env:WECOM_TEST_SECRET"
    )
    assert await resolve_corp_secret(env_corp) == "env-value"

    inline = WecomCorpRecord(corp_id="ww-1", tenant_id=1, secret_ref="inline-secret")
    assert await resolve_corp_secret(inline) == "inline-secret"


@pytest.mark.asyncio
async def test_resolve_secret_global_fallback(monkeypatch) -> None:
    from src.channels.wecom_corp_store import WecomCorpRecord

    monkeypatch.setattr(
        "src.config.get_settings",
        lambda: type("S", (), {"WECOM_SECRET": "global-secret"})(),
    )
    corp = WecomCorpRecord(corp_id="ww-1", tenant_id=1, secret_ref="")
    assert await resolve_corp_secret(corp) == "global-secret"
