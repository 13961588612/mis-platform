"""发布后引擎侧自检单测（2026-09-28）。

背景：``target/mdl.json`` 只是 build 产物，引擎读 YAML 工程。平台此前只看 build 退出码，
于是「发布成功但引擎侧没有 cube / 关系」可以静默存在一整轮（真实事故）。现在发布后
读回 ``context show`` 与派生 MDL 对账，差异进 ``iqd_sync_job.publish_warnings``。
"""

from __future__ import annotations

from src.agent.mis_iqd.publish_selfcheck import PublishSelfCheck


def test_consistent_returns_no_warnings() -> None:
    expected = {
        "models": [{"name": "m1"}, {"name": "m2"}],
        "cubes": [{"name": "c1"}],
        "relationships": [{"name": "r1"}],
    }
    engine = {
        "models": [{"name": "m2"}, {"name": "m1"}],  # 顺序不同不算差异
        "cubes": [{"name": "c1"}],
        "relationships": [{"name": "r1"}],
    }
    assert PublishSelfCheck.compare(expected, engine) == []


def test_missing_cube_is_reported() -> None:
    """真实事故场景：派生 MDL 有 cube，引擎侧没有 → 必须告警。"""
    expected = {"models": [{"name": "m"}], "cubes": [{"name": "sale_by_store"}]}
    engine = {"models": [{"name": "m"}], "cubes": []}
    warnings = PublishSelfCheck.compare(expected, engine)
    assert len(warnings) == 1
    assert "sale_by_store" in warnings[0]
    assert "YAML 工程" in warnings[0]


def test_missing_relationship_is_reported() -> None:
    expected = {"models": [{"name": "m"}], "relationships": [{"name": "sale_ord_store"}]}
    engine = {"models": [{"name": "m"}], "relationships": []}
    warnings = PublishSelfCheck.compare(expected, engine)
    assert any("sale_ord_store" in w for w in warnings)


def test_missing_model_is_reported() -> None:
    expected = {"models": [{"name": "m1"}, {"name": "m2"}]}
    engine = {"models": [{"name": "m1"}]}
    warnings = PublishSelfCheck.compare(expected, engine)
    assert any("m2" in w for w in warnings)


def test_unreadable_inputs_do_not_false_alarm() -> None:
    """读回失败（None / 非 dict）必须静默跳过，绝不误报。"""
    expected = {"cubes": [{"name": "c1"}]}
    assert PublishSelfCheck.compare(expected, None) == []
    assert PublishSelfCheck.compare(None, {"cubes": []}) == []
    assert PublishSelfCheck.compare({}, {}) == []
    assert PublishSelfCheck.compare("x", "y") == []


def test_long_lists_are_truncated_in_message() -> None:
    expected = {"cubes": [{"name": f"c{i}"} for i in range(8)]}
    engine = {"cubes": []}
    warnings = PublishSelfCheck.compare(expected, engine)
    assert len(warnings) == 1
    assert "8 个cube" in warnings[0]
    assert "…" in warnings[0]  # 只列前 5 个


def test_summary_counts() -> None:
    ctx = {"models": [{"name": "a"}], "cubes": [{"name": "b"}], "relationships": []}
    assert PublishSelfCheck.summary(ctx) == "引擎侧：模型 1 / cube 1 / 关系 0"
    assert PublishSelfCheck.summary(None) == "引擎上下文不可读"
