"""Qdrant point id 必须是 unsigned int / UUID，不能直接用 skill_id 字符串。"""

from __future__ import annotations

import uuid

from src.skills.indexer import skill_point_id


def test_skill_point_id_is_valid_uuid() -> None:
    pid = skill_point_id("member.profile")
    parsed = uuid.UUID(pid)
    assert str(parsed) == pid


def test_skill_point_id_is_deterministic() -> None:
    assert skill_point_id("member.profile") == skill_point_id("member.profile")
    assert skill_point_id("a") != skill_point_id("b")
