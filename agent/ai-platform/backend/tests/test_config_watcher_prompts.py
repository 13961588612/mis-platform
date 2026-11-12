"""ConfigWatcher 监控 prompts 等文件并记录变更内容。"""

from __future__ import annotations

from pathlib import Path

from src.config_manager.watcher import ConfigWatcher


def test_watcher_detects_system_md_change(tmp_path: Path, monkeypatch) -> None:
    """仅改 system.md 也应触发 updated，并带上最新正文。"""
    agents = tmp_path / "agents" / "mis-copilot"
    prompts = agents / "runtime" / "prompts"
    prompts.mkdir(parents=True)
    (agents / "agent.yaml").write_text("agent:\n  id: mis-copilot\n", encoding="utf-8")
    system_md = prompts / "system.md"
    system_md.write_text("# old\n", encoding="utf-8")

    watcher = ConfigWatcher()
    monkeypatch.setattr(watcher, "_base_path", str(tmp_path))
    monkeypatch.setattr(watcher, "_mode", "file_system")

    events: list[tuple[str, str]] = []
    watcher.on_change(lambda agent_id, change_type: events.append((agent_id, change_type)))

    watcher._file_mtimes = watcher._collect_file_mtimes()
    assert any(k.endswith("runtime/prompts/system.md") for k in watcher._file_mtimes)

    system_md.write_text("## 【最高优先级强制规则】\n1. 不编造\n", encoding="utf-8")
    watcher._check_file_changes()

    assert ("mis-copilot", "updated") in events
    assert any(
        k.endswith("runtime/prompts/system.md") for k in watcher._file_mtimes
    )


def test_watcher_tracks_prompt_and_runtime_yaml(tmp_path: Path, monkeypatch) -> None:
    """快照应包含 agent.yaml / runtime.yaml / system.md。"""
    agents = tmp_path / "agents" / "mis-copilot"
    (agents / "runtime" / "prompts").mkdir(parents=True)
    (agents / "agent.yaml").write_text("x: 1\n", encoding="utf-8")
    (agents / "runtime" / "runtime.yaml").write_text("runtime: {}\n", encoding="utf-8")
    (agents / "runtime" / "prompts" / "system.md").write_text("hi\n", encoding="utf-8")

    watcher = ConfigWatcher()
    monkeypatch.setattr(watcher, "_base_path", str(tmp_path))
    mtimes = watcher._collect_file_mtimes()
    keys = set(mtimes)
    assert "mis-copilot/agent.yaml" in keys
    assert "mis-copilot/runtime/runtime.yaml" in keys
    assert "mis-copilot/runtime/prompts/system.md" in keys
