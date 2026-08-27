"""config.py 方案 A 旋钮默认值测试（设计 §3.2 / deploy-iqd）。

验证 IqdMcpSettings 的默认端口段 / project 根目录 / 健康参数与方案 A 设计一致，
确保多连接每进程独立端口 + 独立 project 目录的基线配置正确。
"""

from __future__ import annotations

from src.config import IqdMcpSettings


def test_iqd_mcp_settings_defaults() -> None:
    """默认旋钮符合方案 A 设计值。"""
    s = IqdMcpSettings()  # 直构，取 env 或文档默认
    assert s.wren_mcp_port_range == "18080-18180", "多连接端口段默认 18080-18180"
    assert s.wren_projects_root == "/var/lib/mis-iqd/wren-projects", "project 根目录默认"
    assert s.wren_mcp_default_host == "127.0.0.1", "每连接进程仅本机监听"
    assert s.wren_mcp_health_interval_seconds == 30.0
    assert s.wren_mcp_health_failure_threshold == 3
    assert s.wren_mcp_dir_retention_days == 7, "目录保留 7 天"
    assert s.wren_mcp_transport == "http"


def test_iqd_mcp_settings_default_range_size() -> None:
    """默认端口段含 101 个端口（含端点）。"""
    s = IqdMcpSettings()
    low, high = s.wren_mcp_port_range.split("-")
    assert int(high) - int(low) + 1 == 101


def test_iqd_mcp_credential_knobs_default_off() -> None:
    """凭证注入相关旋钮：默认只读、不落配置库（D6 铁律）。"""
    s = IqdMcpSettings()
    assert s.wren_mcp_allow_write is False, "一期默认关闭写工具（只读兜底）"
    assert s.memory_index_enabled is True
