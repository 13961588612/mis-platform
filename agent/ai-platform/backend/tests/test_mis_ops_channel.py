"""MIS 能力口运营渠道解析。"""

from __future__ import annotations

from src.agent.session_store import resolve_mis_ops_channel


def test_iqd_and_rag_map_to_ops_channels() -> None:
    assert resolve_mis_ops_channel("mis-iqd", "mis_bff") == "iqd_test"
    assert resolve_mis_ops_channel("mis-rag", "mis_bff") == "kb_test"


def test_other_agent_falls_back_to_api_when_mis_bff() -> None:
    assert resolve_mis_ops_channel("crm-assistant", "mis_bff") == "api"
    assert resolve_mis_ops_channel("crm-assistant", "unknown") == "api"


def test_preserves_explicit_non_bff_channel() -> None:
    assert resolve_mis_ops_channel("crm-assistant", "web") == "web"
