"""凭证解析链测试（D6 铁律：仅 env 注入、不落盘）。

覆盖：
- IqdConfigClient.get_connection_env 经 secretRef → CredentialVault.resolve_by_ref
  解析为 wren env 映射（WREN_PG_* + WREN_IQD_CREDENTIAL_JSON 整份透传）。
- _map_credential_to_env 是纯函数（不写任何文件到磁盘），凭证明文仅经 env 传递，
  绝不落盘 / 绝不写项目目录。

mock 外部 mis-iqd HTTP 与数据库，不依赖真实 vault。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.adapters.iqd_config_client import IqdConfigClient


def test_map_credential_to_env_pure_no_disk_write() -> None:
    """_map_credential_to_env 是纯映射：返回 WREN_PG_* + 整份 JSON，且不写任何文件到磁盘。"""
    cred = {
        "host": "pg", "port": 5432, "user": "u", "password": "secret-pwd", "database": "d",
    }
    with patch("builtins.open") as mock_open:
        env = IqdConfigClient._map_credential_to_env(cred)
    # 纯映射：不得触碰任何文件（D6 不落盘）
    mock_open.assert_not_called()
    assert env["WREN_PG_HOST"] == "pg"
    assert env["WREN_PG_PORT"] == "5432"
    assert env["WREN_PG_USER"] == "u"
    assert env["WREN_PG_PASSWORD"] == "secret-pwd"
    assert env["WREN_PG_DB"] == "d"
    # 整份凭证透传（供自定义 profile 模板读取任意字段）
    assert "WREN_IQD_CREDENTIAL_JSON" in env
    assert "secret-pwd" in env["WREN_IQD_CREDENTIAL_JSON"]


@pytest.mark.asyncio
async def test_get_connection_env_maps_secret_to_wren_env() -> None:
    """get_connection_env：secretRef → vault 解析 → wren env（含明文密码，仅 env 注入）。"""
    client = IqdConfigClient()
    with patch.object(
        client, "_request", new=AsyncMock(return_value={"secret_ref": "ref-1"})
    ), patch("src.identity.credential_vault.CredentialVault") as VaultCls:
        vault = VaultCls.return_value
        vault.resolve_by_ref = AsyncMock(
            return_value={"host": "h", "port": 5432, "user": "u", "password": "p", "database": "d"}
        )
        env = await client.get_connection_env(1)

    assert env["WREN_PG_PASSWORD"] == "p"
    assert "WREN_IQD_CREDENTIAL_JSON" in env
    # 解析链路调用了 vault（secretRef → vault.resolve_by_ref）
    vault.resolve_by_ref.assert_awaited_once_with("ref-1")


@pytest.mark.asyncio
async def test_get_connection_env_missing_secret_ref_raises() -> None:
    """mis-iqd 未返回 secret_ref → 显式抛 IqdConfigClientError（fail-closed，不静默放行）。"""
    from src.adapters.iqd_config_client import IqdConfigClientError

    client = IqdConfigClient()
    with patch.object(client, "_request", new=AsyncMock(return_value={"foo": "bar"})):
        with pytest.raises(IqdConfigClientError):
            await client.get_connection_env(1)
