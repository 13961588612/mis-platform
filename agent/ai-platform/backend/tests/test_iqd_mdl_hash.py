"""``mdl_hash`` 口径单测：平台内容哈希（取代 ``wqd-{时间}-{随机}`` 兜底值）。

<p><b>为什么钉</b>：``mdl_hash`` 同时是 ①回填的 ``wren_ref_id`` ②S3 漂移检测的比对基准
（``built_mdl_hash`` vs :meth:`IqdCli.get_current_mdl_hash`）。改造前平台用的是
``_fallback_mdl_hash()`` 造的 ``wqd-{时间}-{随机}`` —— 既与内容无关，也与 wren 侧任何值不可比，
漂移检测等于没做。现在两侧统一为 ``sha256(target/mdl.json 文本)[:16]``。
"""

from __future__ import annotations

import hashlib
import json

import pytest
from unittest.mock import AsyncMock

from src.adapters.iqd_cli import IqdCli
from src.agent.mis_iqd.service import IqdAskService


def _expected_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


@pytest.mark.asyncio
async def test_context_build_returns_content_hash(tmp_path):
    """部署 MDL 时返回**内容哈希**（sha256[:16]），而不是时间戳兜底值。"""
    manifest = {"models": [{"name": "orders"}], "cubes": []}
    text = json.dumps(manifest, ensure_ascii=False, indent=2)
    (tmp_path / "manifest.json").write_text(text, encoding="utf-8")

    cli = IqdCli()
    cli._run = AsyncMock(return_value={"stdout": "", "exit_code": 0})
    out = await cli.context_build(mdl_dir=str(tmp_path))

    assert out["mdl_hash"] == _expected_hash(text)
    assert len(out["mdl_hash"]) == 16 and not out["mdl_hash"].startswith("wqd-")


@pytest.mark.asyncio
async def test_context_build_without_mdl_dir_has_no_hash(tmp_path):
    """纯 project build（无派生 MDL）不臆造 hash。"""
    cli = IqdCli()
    cli._run = AsyncMock(return_value={"stdout": "ok", "exit_code": 0})
    out = await cli.context_build()
    assert "mdl_hash" not in out


def test_resolve_mdl_hash_prefers_platform_hash():
    """优先级：平台内容哈希 > CLI stdout 解析 > 兜底值。"""
    assert IqdAskService._resolve_mdl_hash(
        {"mdl_hash": "platform1234567", "stdout": '{"mdl_hash":"from_cli"}'}
    ) == "platform1234567"
    assert IqdAskService._resolve_mdl_hash({"stdout": '{"mdl_hash":"from_cli"}'}) == "from_cli"
    fallback = IqdAskService._resolve_mdl_hash({})
    assert fallback and fallback.startswith("wqd-")


@pytest.mark.asyncio
async def test_current_mdl_hash_uses_same_algorithm():
    """漂移检测侧：对 wren 机上现存的 ``target/mdl.json`` 现算，算法与写侧一致。"""
    content = json.dumps({"models": [{"name": "orders"}], "cubes": []}, ensure_ascii=False, indent=2)
    cli = IqdCli()
    cli.list_project_files = AsyncMock(
        return_value=[{"path": "target/mdl.json", "content": content}]
    )
    got = await cli.get_current_mdl_hash(project_dir="/proj/1")
    assert got == _expected_hash(content)


@pytest.mark.asyncio
async def test_current_mdl_hash_degrades_to_none_when_unavailable():
    """取不到部署产物时降级为 None（调用方据此「不判定漂移」，不得误报）。"""
    cli = IqdCli()
    cli.list_project_files = AsyncMock(return_value=[])
    cli._run = AsyncMock(return_value={"stdout": "", "exit_code": 0})
    assert await cli.get_current_mdl_hash(project_dir="/proj/1") is None
