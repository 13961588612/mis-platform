"""T04 任务2：``config_manager/file_service.py`` 全路径 + 新增异常。

覆盖 impl-plan §9.3 / §10.3 与 spec §3.4：

* 路径白名单 / 只读模式匹配（``is_whitelisted`` / ``is_readonly`` / ``resolve_path``）；
* 密钥脱敏 / 还原 / 占位符检测（``mask_secrets`` / ``restore_masked`` / ``contains_masked``）；
* 文件树列举（``list_editable_files``）；
* 读取（``read_config_file``：YAML 脱敏、纯文本不脱敏、不存在抛 ``ConfigLoadError``）；
* 写入（``write_config_file``：落盘 + 校验 + 热更新；只读拒绝、超限拒绝、
  含脱敏占位符拒绝、结构校验失败拒绝）。
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

import src.config as src_config
import src.config_manager.file_service as fs
from src.utils.exceptions import (
    ConfigFileMaskedError,
    ConfigFileTooLargeError,
    ConfigLoadError,
    ConfigPathError,
    ConfigValidationError,
)


@pytest.fixture
def config_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    """把 CONFIG_BASE_PATH 指向临时目录，隔离磁盘副作用。"""
    base = tmp_path / "configs"
    (base / "agents").mkdir(parents=True)
    settings = SimpleNamespace(
        CONFIG_MODE="file_system",
        CONFIG_BASE_PATH=str(base),
        CONFIG_WATCH_ENABLED=False,
    )
    monkeypatch.setattr(fs, "get_settings", lambda: settings)
    monkeypatch.setattr(src_config, "get_settings", lambda: settings, raising=False)
    return base


@pytest.fixture
def fake_manager(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """把 file_service 中的 ConfigManager 单例替换为 stub（reload_agent 返回非空配置）。"""
    mgr = MagicMock()
    mgr.reload_agent = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(fs, "get_config_manager", lambda: mgr)
    return mgr


# ===========================================================================
# 模式匹配
# ===========================================================================


def test_pattern_to_regex_literal() -> None:
    """字面量模式只匹配自身，不匹配子路径。"""
    import re

    rx = fs._pattern_to_regex("agent.yaml")
    assert re.match(rx, "agent.yaml")
    assert not re.match(rx, "sub/agent.yaml")


def test_pattern_to_regex_wildcard() -> None:
    """``**`` 与 ``{a,b}`` 通配：覆盖 facts 下任意层级 yaml/md。"""
    import re

    rx = fs._pattern_to_regex("memory/facts/**/*.{yaml,md}")
    assert re.match(rx, "memory/facts/a/b.yaml")
    assert re.match(rx, "memory/facts/x.md")
    assert not re.match(rx, "memory/facts/x.txt")


def test_whitelist_and_readonly_overlap() -> None:
    """identity/*.yaml 既在白名单内又是只读；agent.yaml 可写。"""
    assert fs.is_whitelisted("identity/foo.yaml")
    assert fs.is_readonly("identity/foo.yaml")
    assert fs.is_whitelisted("agent.yaml")
    assert not fs.is_readonly("agent.yaml")
    assert not fs.is_whitelisted("secret.txt")


# ===========================================================================
# 路径解析安全
# ===========================================================================


def test_resolve_path_valid(config_dir: Path) -> None:
    """合法相对路径解析为预期绝对路径。"""
    p = fs.resolve_path("a1", "memory/personality.md")
    assert p == fs.agent_dir("a1") / "memory" / "personality.md"


def test_resolve_path_rejects_absolute(config_dir: Path) -> None:
    with pytest.raises(ConfigPathError):
        fs.resolve_path("a1", "/etc/passwd")


def test_resolve_path_rejects_parent_escape(config_dir: Path) -> None:
    with pytest.raises(ConfigPathError):
        fs.resolve_path("a1", "memory/../../etc")


def test_resolve_path_rejects_non_whitelisted(config_dir: Path) -> None:
    with pytest.raises(ConfigPathError):
        fs.resolve_path("a1", "evil.txt")


def test_resolve_path_rejects_empty(config_dir: Path) -> None:
    with pytest.raises(ConfigPathError):
        fs.resolve_path("a1", "")


# ===========================================================================
# 密钥脱敏 / 还原
# ===========================================================================


def test_mask_secrets_masks_known_keys() -> None:
    data = {"db": {"password": "hunter2", "user": "admin"}, "api_key": "abc"}
    out, masked = fs.mask_secrets(data)
    assert masked is True
    assert out["db"]["password"] == fs.MASKED_VALUE
    assert out["db"]["user"] == "admin"
    assert out["api_key"] == fs.MASKED_VALUE


def test_mask_secrets_no_secret() -> None:
    data = {"name": "x", "list": [1, 2]}
    out, masked = fs.mask_secrets(data)
    assert masked is False
    assert out == data


def test_restore_masked_replaces_placeholder() -> None:
    """restore_masked 能把占位符还原为原文件的真实值。"""
    original = {"password": "real"}
    incoming = {"password": fs.MASKED_VALUE}
    assert fs.restore_masked(original, incoming) == {"password": "real"}


def test_contains_masked_detects_placeholder() -> None:
    assert fs.contains_masked({"a": fs.MASKED_VALUE})
    assert not fs.contains_masked({"a": "b"})
    assert not fs.contains_masked({"a": {"b": "c"}})


# ===========================================================================
# 文件树列举
# ===========================================================================


def test_list_editable_files_filters_whitelist(config_dir: Path) -> None:
    agent_dir = config_dir / "agents" / "a1"
    (agent_dir / "runtime").mkdir(parents=True)
    (agent_dir / "agent.yaml").write_text(
        "agent:\n  name: a1\n  display_name: A1\n", encoding="utf-8"
    )
    (agent_dir / "runtime" / "runtime.yaml").write_text(
        "runtime:\n  type: openharness\n", encoding="utf-8"
    )
    (agent_dir / "notes.txt").write_text("x", encoding="utf-8")  # 不在白名单
    (agent_dir / "identity").mkdir()
    (agent_dir / "identity" / "roles.yaml").write_text("x: 1\n", encoding="utf-8")

    files = fs.list_editable_files("a1")
    by_path = {f["path"]: f for f in files}

    assert "agent.yaml" in by_path
    assert "runtime/runtime.yaml" in by_path
    assert "notes.txt" not in by_path
    assert by_path["identity/roles.yaml"]["read_only"] is True


# ===========================================================================
# 读取
# ===========================================================================


def test_read_config_file_masks_secrets(config_dir: Path) -> None:
    agent_dir = config_dir / "agents" / "a1"
    agent_dir.mkdir()
    (agent_dir / "agent.yaml").write_text(
        "agent:\n  name: a1\n  display_name: A1\n  password: hunter2\n",
        encoding="utf-8",
    )

    result = fs.read_config_file("a1", "agent.yaml")

    assert result["masked"] is True
    assert fs.MASKED_VALUE in result["content"]
    # 读取不修改磁盘
    assert "hunter2" in (agent_dir / "agent.yaml").read_text(encoding="utf-8")


def test_read_config_file_markdown_not_masked(config_dir: Path) -> None:
    agent_dir = config_dir / "agents" / "a1"
    (agent_dir / "memory").mkdir(parents=True)
    (agent_dir / "memory" / "personality.md").write_text("hi", encoding="utf-8")

    result = fs.read_config_file("a1", "memory/personality.md")

    assert result["masked"] is False
    assert result["content"] == "hi"


def test_read_config_file_not_found(config_dir: Path) -> None:
    with pytest.raises(ConfigLoadError):
        fs.read_config_file("a1", "agent.yaml")


# ===========================================================================
# 写入
# ===========================================================================


def test_write_config_file_persists_and_reloads(
    config_dir: Path, fake_manager: MagicMock
) -> None:
    agent_dir = config_dir / "agents" / "a1"
    agent_dir.mkdir()
    content = "agent:\n  name: a1\n  display_name: A1\n  description: d\n"

    result = fs.write_config_file("a1", "agent.yaml", content)

    assert result["reloaded"] is True
    assert "name: a1" in (agent_dir / "agent.yaml").read_text(encoding="utf-8")
    fake_manager.reload_agent.assert_called_once_with("a1")


def test_write_config_file_readonly_rejected(
    config_dir: Path, fake_manager: MagicMock
) -> None:
    agent_dir = config_dir / "agents" / "a1" / "identity"
    agent_dir.mkdir(parents=True)
    (agent_dir / "roles.yaml").write_text("x: 1\n", encoding="utf-8")

    with pytest.raises(ConfigPathError):
        fs.write_config_file("a1", "identity/roles.yaml", "x: 2\n")


def test_write_config_file_too_large(
    config_dir: Path, fake_manager: MagicMock
) -> None:
    agent_dir = config_dir / "agents" / "a1"
    agent_dir.mkdir()
    big = "agent:\n  name: a1\n  display_name: A1\n" + ("#" * (fs.MAX_FILE_SIZE_BYTES + 10)) + "\n"

    with pytest.raises(ConfigFileTooLargeError):
        fs.write_config_file("a1", "agent.yaml", big)


def test_write_config_file_masked_placeholder_rejected(
    config_dir: Path, fake_manager: MagicMock
) -> None:
    agent_dir = config_dir / "agents" / "a1"
    agent_dir.mkdir()
    content = f"agent:\n  name: a1\n  display_name: A1\n  password: \"{fs.MASKED_VALUE}\"\n"

    with pytest.raises(ConfigFileMaskedError):
        fs.write_config_file("a1", "agent.yaml", content)


def test_write_config_file_invalid_top_level(
    config_dir: Path, fake_manager: MagicMock
) -> None:
    agent_dir = config_dir / "agents" / "a1"
    agent_dir.mkdir()

    with pytest.raises(ConfigValidationError):
        fs.write_config_file("a1", "agent.yaml", "just a string")


def test_write_config_file_validation_failure_missing_fields(
    config_dir: Path, fake_manager: MagicMock
) -> None:
    agent_dir = config_dir / "agents" / "a1"
    agent_dir.mkdir()

    with pytest.raises(ConfigValidationError):
        fs.write_config_file("a1", "agent.yaml", "agent:\n  name: a1\n")
