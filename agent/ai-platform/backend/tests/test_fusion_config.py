"""DEP-10 融合部署验证：Python 配置与 Redis 键前缀（共享基础设施）.

验证融合后 agent 后端在「共享 Redis / 共享 PG」上的关键配置与键拼接：
- config.py 声明的默认值即融合所需值：REDIS_DB=2、REDIS_KEY_PREFIX="aip:"、
  POSTGRES_DB="ai_platform"、POSTGRES_USER="aiplatform"
- 模拟 docker-compose.ai.yml 注入的环境变量时，运行时配置正确（部署层面）
- Redis 键拼接函数确实产出 aip: 前缀（stream / session / quota）

注：仓库内 agent/ai-platform/backend/.env 为本地开发覆盖文件，其 REDIS_DB=0 与
融合决策 R2（须 db 2）不一致，但容器部署由 compose 环境变量 REDIS_DB=2 覆盖，
不影响线上；该 .env 不一致项作为独立 finding 反馈给工程师（见测试报告）。
"""

from __future__ import annotations

import pytest

from src.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    """每个用例前后清空 lru_cache，避免跨用例污染。"""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_config_declared_defaults_are_fusion_values():
    """config.py 源代码声明的默认值即融合部署所需值（源码层面）。"""
    fields = Settings.model_fields
    assert fields["REDIS_DB"].default == 2, "REDIS_DB 默认值应为 2（与 MIS 共享 Redis 物理隔离）"
    assert fields["REDIS_KEY_PREFIX"].default == "aip:", "REDIS_KEY_PREFIX 默认值应为 aip:"
    assert fields["POSTGRES_DB"].default == "ai_platform", "POSTGRES_DB 默认值应为 ai_platform"
    assert fields["POSTGRES_USER"].default == "aiplatform", "POSTGRES_USER 默认值应为 aiplatform"


def test_settings_pick_up_deployment_env(monkeypatch):
    """模拟 docker-compose.ai.yml 注入的环境变量，验证运行时配置正确（部署层面）。"""
    monkeypatch.setenv("REDIS_DB", "2")
    monkeypatch.setenv("REDIS_KEY_PREFIX", "aip:")
    monkeypatch.setenv("POSTGRES_DB", "ai_platform")
    monkeypatch.setenv("POSTGRES_USER", "aiplatform")
    get_settings.cache_clear()
    s = get_settings()
    assert s.REDIS_DB == 2
    assert s.REDIS_KEY_PREFIX == "aip:"
    assert s.POSTGRES_DB == "ai_platform"
    assert s.POSTGRES_USER == "aiplatform"


def test_redis_url_reflects_db2(monkeypatch):
    """redis 连接串应带 /2（反 R2 撞库的关键验证）。"""
    monkeypatch.setenv("REDIS_DB", "2")
    get_settings.cache_clear()
    assert get_settings().redis_url.endswith("/2"), "redis_url 须以 /2 结尾（落 db 2）"


def test_redis_stream_constant_uses_aip_prefix():
    """redis_stream 模块级流键须带 aip: 前缀。"""
    from src.queue import redis_stream

    assert redis_stream.AGENT_EVENTS_STREAM == "aip:stream:agent:events"
    assert redis_stream.AGENT_EVENTS_STREAM.startswith("aip:")


def test_session_and_quota_keys_use_aip_prefix():
    """SessionManager / QuotaManager 的键拼接函数须产出 aip: 前缀。"""
    from src.agent.session import SessionManager
    from src.llm.quota_manager import QuotaManager

    sm = SessionManager()
    assert sm._session_key("s1") == "aip:session:s1"
    assert sm._agent_binding_key("s1") == "aip:session:s1:agent_binding"

    qm = QuotaManager()
    assert qm._user_key("u1").startswith("aip:quota:user:u1:")
    assert qm._dept_key("d1").startswith("aip:quota:dept:d1:")
