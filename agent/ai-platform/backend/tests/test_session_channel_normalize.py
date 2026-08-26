"""会话渠道归一：Gateway h5 → wire web。"""

from __future__ import annotations

from src.agent.session_store import normalize_channel, resolve_wire_channel


def test_h5_maps_to_web() -> None:
    assert normalize_channel("h5") == "web"
    assert normalize_channel("H5") == "web"
    assert normalize_channel("web") == "web"


def test_wecom_gateway_aliases() -> None:
    assert normalize_channel("wecom-h5") == "wecom"
    assert normalize_channel("wecom-bot") == "wecom"
    assert normalize_channel("wecom_h5") == "wecom"


def test_unknown_stays_unknown() -> None:
    assert normalize_channel("") == "unknown"
    assert normalize_channel(None) == "unknown"
    assert normalize_channel("foo") == "unknown"


def test_resolve_recovers_from_raw_channel_metadata() -> None:
    """历史双写：channel=unknown + metadata.raw_channel=h5 → 展示 web。"""
    assert (
        resolve_wire_channel("unknown", {"raw_channel": "h5", "mis_user_id": 1})
        == "web"
    )
    assert resolve_wire_channel("unknown", {}) == "unknown"
    assert resolve_wire_channel("web", {"raw_channel": "h5"}) == "web"
