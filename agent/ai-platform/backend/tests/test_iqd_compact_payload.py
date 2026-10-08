"""compact_ask_payload_for_llm：大结果集瘦身，避免 LLM 上下文爆炸。"""

from __future__ import annotations

from src.agent.mis_iqd.projector import compact_ask_payload_for_llm


def test_compact_keeps_summary_and_truncates_rows() -> None:
    payload = {
        "query_id": "q-1",
        "status": "succeeded",
        "answer_summary": "查询返回 50 行结果。",
        "sql": "SELECT 1",
        "nl2sql_debug": {"huge": True},
        "data": {
            "row_count": 50,
            "columns": [{"name": "a"}],
            "rows": [{"a": i} for i in range(50)],
        },
        "citations": [],
        "plan": [],
    }
    out = compact_ask_payload_for_llm(payload, max_rows=20)
    assert out["status"] == "succeeded"
    assert "sql" not in out
    assert "nl2sql_debug" not in out
    assert out["data"]["row_count"] == 50
    assert out["data"]["preview_rows"] == 20
    assert out["data"]["truncated"] is True
    assert len(out["data"]["rows"]) == 20
    assert "共 50 行" in out["answer_summary"]
    # 入参不被原地修改
    assert len(payload["data"]["rows"]) == 50


def test_compact_no_truncation_when_small() -> None:
    payload = {
        "answer_summary": "ok",
        "data": {"row_count": 3, "rows": [{"a": 1}, {"a": 2}, {"a": 3}]},
    }
    out = compact_ask_payload_for_llm(payload, max_rows=20)
    assert out["data"]["truncated"] is False
    assert out["data"]["preview_rows"] == 3
    assert out["answer_summary"] == "ok"
