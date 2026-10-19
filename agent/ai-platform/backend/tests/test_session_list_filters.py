"""会话列表：updated_at 时间窗 + Worker/旁路折叠条件。"""

from __future__ import annotations

from datetime import datetime, timezone

from src.agent.session_store import SessionListQuery, SessionPgStore


def test_build_conditions_uses_updated_at() -> None:
    store = SessionPgStore()
    start = datetime(2026, 10, 19, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 10, 19, 23, 59, tzinfo=timezone.utc)
    conds = store._build_conditions(
        SessionListQuery(time_from=start, time_to=end, include_worker_sessions=True)
    )
    sql = " AND ".join(str(c) for c in conds)
    assert "updated_at" in sql
    assert "created_at" not in sql or sql.count("created_at") == 0


def test_build_conditions_hides_workers_by_default() -> None:
    store = SessionPgStore()
    default_conds = store._build_conditions(SessionListQuery())
    open_conds = store._build_conditions(SessionListQuery(include_worker_sessions=True))
    assert len(default_conds) > len(open_conds)
    joined = " ".join(str(c) for c in default_conds)
    # JSONB has_key → `metadata ? :param`；channel/agent 字面量在绑定参数里
    assert "metadata ?" in joined
    assert "NOT (" in joined
    assert "agent_session.channel =" in joined
    assert "agent_session.agent_id !=" in joined
