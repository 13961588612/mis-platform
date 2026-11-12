"""Agent 级 enable_thinking → LLMRequest.extra。"""

from __future__ import annotations

from src.agent.config import AgentConfig, ModelConfig, RuntimeConfig
from src.llm.thinking import llm_request_extra_for_thinking, resolve_agent_enable_thinking


def test_llm_request_extra_disables_qwen_thinking() -> None:
    assert llm_request_extra_for_thinking(
        enable_thinking=False, model="qwen3.8-flash"
    ) == {"extra_body": {"enable_thinking": False}}
    assert llm_request_extra_for_thinking(enable_thinking=True, model="qwen3.8-flash") == {}
    assert llm_request_extra_for_thinking(enable_thinking=None, model="qwen3.8-flash") == {}
    assert llm_request_extra_for_thinking(enable_thinking=False, model="deepseek-v4-flash") == {}


def test_resolve_from_model_config() -> None:
    cfg = AgentConfig(
        agent_id="spm-report",
        name="spm-report",
        model=ModelConfig(primary="qwen3.8-flash", enable_thinking=False),
    )
    assert resolve_agent_enable_thinking(cfg) is False


def test_resolve_from_runtime_params() -> None:
    cfg = AgentConfig(
        agent_id="spm-report",
        name="spm-report",
        model=ModelConfig(primary="qwen3.8-flash"),
        runtime=RuntimeConfig(params={"enableThinking": False}),
    )
    assert resolve_agent_enable_thinking(cfg) is False


def test_from_yaml_dict_parses_enable_thinking() -> None:
    cfg = AgentConfig.from_yaml_dict(
        {
            "agent": {
                "name": "spm-report",
                "model": {"primary": "qwen3.8-flash", "enable_thinking": False},
            }
        }
    )
    assert cfg.model.enable_thinking is False
