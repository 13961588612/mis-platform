"""A1–A7 黄金用例（Coordinator–Worker 调度基座 · T04 · C2）。

覆盖 design-impl.md §6 T04 验收项：

* **A1** 「差旅报销制度怎么规定」→ ``mis-rag``；
* **A2** 「查一下会员积分」→ ``crm-assistant``；MCP 不可达时如实报错、不臆造；
* **A3** 「帮我写一则放假通知」→ **不调度任何 Worker**（无委派轨迹）；
* **A4** 「从这段话抽出姓名和部门」→ ``mis-extract``；
* **A5** 「总结下面审批意见」→ ``mis-summary``；
* **A6** 新增 Worker **仅改 YAML** 即出现在 Catalog、工具 schema 与可委派链路；
* **A7** 深度闸（``depth<=1``）与 role 闸（``worker`` 不持有委派工具）**双重拒绝**。

外加 T04 的两条硬性验收：

* 懒委托语料（≥5 条）100% 被 :class:`BriefValidationError` 拦截并返回重写模板；
* ``ConfigManager`` 加载 5 个 Agent 无告警，``role`` 与委派契约解析正确。

Note:
    团队裁定 Q1/Q5：黄金用例**只断言 dispatch_trace 与结构**，不对任何 LLM
    生成文本断言，因此本文件不依赖真实模型，可在 CI 稳定运行。
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openharness.tools.base import ToolExecutionContext, ToolResult

from src.agent.config import AgentConfig, AgentRole
from src.config_manager.loader import ConfigLoader
from src.coordinator import catalog as catalog_module
from src.coordinator import sessions as sessions_module
from src.coordinator import trace as trace_module
from src.coordinator.catalog import WorkerCatalog, build_worker_catalog
from src.coordinator.trace import TRACE_STATUS_REJECTED, drain_dispatch_traces
from src.runtime import tool_registry_builder as trb
from src.runtime.events import AgentEvent, AgentEventType
from src.skills.tools import invoke_agent as invoke_agent_module
from src.skills.tools.invoke_agent import (
    DEFAULT_WHITELIST,
    InvokeAgentInput,
    InvokeAgentTool,
)

# ---------------------------------------------------------------------------
# 常量：真实配置目录（tests/ → backend/ → ai-platform/）
# ---------------------------------------------------------------------------

REPO_CONFIGS: Path = Path(__file__).resolve().parents[2] / "configs"
"""仓库内真实的 ``configs/`` 目录（黄金用例直接读线上同款 YAML）。"""

SYSTEM_PROMPT_PATH: Path = (
    REPO_CONFIGS / "agents" / "mis-copilot" / "runtime" / "prompts" / "system.md"
)
"""Coordinator 的 system prompt（调度纪律断言对象）。"""

EXPECTED_ROLES: dict[str, AgentRole] = {
    "mis-copilot": AgentRole.COORDINATOR,
    "mis-rag": AgentRole.WORKER,
    "crm-assistant": AgentRole.WORKER,
    "mis-extract": AgentRole.WORKER,
    "mis-summary": AgentRole.WORKER,
    "mis-admin-helper": AgentRole.WORKER,
    "mis-user-helper": AgentRole.WORKER,
}
"""7 个 Agent 的期望调度角色（T04 验收：role 解析正确；1.3/1.4 新增两个 helper）。"""

LAZY_DELEGATION_CORPUS: tuple[str, ...] = (
    "帮我查一下",
    "根据你的发现",
    "看看情况",
    "你看着办",
    "继续吧",
    "随便",
    "帮我查一下吧",
)
"""懒委托语料（7 条 > 验收要求的 5 条），严格模式下必须 100% 被拦截。"""

NEW_WORKER_ID: str = "mis-policy"
"""A6 用例中「仅通过 YAML 新增」的 Worker ID。"""

NEW_WORKER_HINT: str = "查询公司规章制度的生效日期与版本号，不做条款解读"
"""A6 新 Worker 的 when_to_use（必须原样出现在工具 description 中）。"""


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_runtime_state() -> Any:
    """清空 trace 缓冲、Worker 会话登记与 Catalog 单例，隔离用例。"""
    trace_module._reset_for_test()
    sessions_module._reset_for_test()
    catalog_module._reset_for_test()
    yield
    trace_module._reset_for_test()
    sessions_module._reset_for_test()
    catalog_module._reset_for_test()


def _ctx(session_id: str = "") -> ToolExecutionContext:
    """构造工具执行上下文。

    Args:
        session_id: 父会话（Coordinator 会话）ID；空串表示无父会话。

    Returns:
        :class:`ToolExecutionContext`。
    """
    metadata: dict[str, Any] = {"session_id": session_id} if session_id else {}
    return ToolExecutionContext(cwd=Path("."), metadata=metadata)


def _settings(**overrides: Any) -> MagicMock:
    """构造只声明必要配置项的 settings 替身。

    Args:
        **overrides: 需要显式覆盖的配置项。

    Returns:
        `MagicMock` 形态的 settings（未声明项由 flags 安全回落默认值）。
    """
    base: dict[str, Any] = {
        "INVOKE_AGENT_WHITELIST": sorted(DEFAULT_WHITELIST),
        "INVOKE_AGENT_MAX_DEPTH": 1,
        "INVOKE_AGENT_TIMEOUT_SECONDS": 30,
    }
    base.update(overrides)
    return MagicMock(**base)


def _session_manager(child_session_id: str) -> MagicMock:
    """构造会话管理器替身（父会话不可用 → 走身份兜底分支）。

    Args:
        child_session_id: `create_session` 返回的子会话 ID。

    Returns:
        `MagicMock` 形态的 SessionManager。
    """
    manager = MagicMock()
    manager.get_session = AsyncMock(side_effect=Exception("no parent session"))
    manager.create_session = AsyncMock(
        return_value=MagicMock(session_id=child_session_id, state={})
    )
    manager.save_session = AsyncMock()
    return manager


def _text_worker(text: str = "已依据制度条款给出答复。") -> MagicMock:
    """构造正常产出文本的 Worker 实例替身。

    Args:
        text: Worker 输出正文。

    Returns:
        `MagicMock` 形态的 agent instance。
    """

    async def _events(*_args: Any, **_kwargs: Any) -> Any:
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content=text)
        yield AgentEvent(type=AgentEventType.DONE)

    instance = MagicMock()
    instance.process_message = _events
    return instance


def _mcp_down_worker(
    tool_name: str = "crm__member_query", error: str = "connection refused"
) -> MagicMock:
    """构造 MCP 不可达的 Worker 替身（工具报错且无正文）。

    Args:
        tool_name: 失败的 MCP 工具名。
        error: 工具错误信息。

    Returns:
        `MagicMock` 形态的 agent instance。
    """

    async def _events(*_args: Any, **_kwargs: Any) -> Any:
        yield AgentEvent(type=AgentEventType.TOOL_CALL, tool_name=tool_name, args={})
        yield AgentEvent(
            type=AgentEventType.TOOL_RESULT,
            tool_name=tool_name,
            result={"error": error},
        )
        yield AgentEvent(type=AgentEventType.DONE)

    instance = MagicMock()
    instance.process_message = _events
    return instance


async def _dispatch(
    payload: InvokeAgentInput,
    *,
    session_id: str,
    instance: MagicMock | None = None,
    settings: Any | None = None,
    catalog: WorkerCatalog | None = None,
    agent_manager: MagicMock | None = None,
) -> ToolResult:
    """在全替身环境下执行一次委派（模拟 Coordinator 的一次工具调用）。

    Args:
        payload: 工具入参。
        session_id: 父会话 ID。
        instance: Worker 实例替身；`None` 时用正常文本 Worker。
        settings: 配置替身；`None` 时用 :func:`_settings`。
        catalog: 注入工具的 Worker 目录；`None` 表示无参构造（现网等价）。
        agent_manager: AgentManager 替身；`None` 时按 `instance` 现造。

    Returns:
        工具执行结果。
    """
    tool = InvokeAgentTool(catalog=catalog) if catalog is not None else InvokeAgentTool()
    config = settings or _settings()
    session_manager = _session_manager(f"child-{session_id or 'anon'}")
    manager = agent_manager or MagicMock()
    if agent_manager is None:
        manager.ensure_agent_ready = AsyncMock(return_value=instance or _text_worker())

    with (
        patch("src.agent.session.get_session_manager", return_value=session_manager),
        patch("src.agent.manager.get_agent_manager", return_value=manager),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=config),
        patch("src.config.get_settings", return_value=config),
    ):
        return await tool.execute(payload, _ctx(session_id))


async def _coordinator_turn(
    session_id: str, delegations: list[InvokeAgentInput]
) -> list[dict[str, Any]]:
    """模拟 Coordinator 的一轮回合，返回本轮产生的委派轨迹。

    Args:
        session_id: 父会话 ID。
        delegations: 本轮 LLM 决定发起的委派（空列表 = 直接回答用户）。

    Returns:
        本轮 `dispatch_trace` 条目列表（按发生顺序）。
    """
    for payload in delegations:
        await _dispatch(payload, session_id=session_id)
    return await drain_dispatch_traces(session_id)


def _brief(goal: str, question: str, expected_output: str = "") -> dict[str, Any]:
    """构造一份合格的结构化任务书。

    Args:
        goal: 完整可执行目标。
        question: 用户原始问题。
        expected_output: 期望输出契约。

    Returns:
        可直接作为 `task_brief` 入参的字典。
    """
    payload: dict[str, Any] = {
        "goal": goal,
        "purpose": "直接回复用户",
        "inputs": {"user_question": question},
        "constraints": ["无命中须如实说明", "禁止臆造业务数据"],
    }
    if expected_output:
        payload["expected_output"] = expected_output
    return payload


async def _load_configs(base_path: Path) -> tuple[list[AgentConfig], MagicMock]:
    """用真实/临时 YAML 目录加载全部 Agent 配置，并捕获加载日志。

    Args:
        base_path: `configs/` 根目录（其下须有 `agents/`）。

    Returns:
        二元组 `(configs, logger_spy)`；`logger_spy` 用于断言无告警。
    """
    fake_settings = SimpleNamespace(
        CONFIG_BASE_PATH=str(base_path), CONFIG_MODE="file_system"
    )
    logger_spy = MagicMock()
    with (
        patch("src.config_manager.loader.get_settings", return_value=fake_settings),
        patch("src.config_manager.loader.logger", logger_spy),
    ):
        loader = ConfigLoader()
        configs: list[AgentConfig] = await loader.load_all_agents()
    return configs, logger_spy


def _patch_catalog_sources(
    monkeypatch: pytest.MonkeyPatch,
    configs: list[AgentConfig],
    whitelist: list[str],
) -> None:
    """把 Catalog 的两个数据源（ConfigManager / Settings）替换为替身。

    Args:
        monkeypatch: pytest monkeypatch fixture。
        configs: `list_configs()` 返回的配置列表。
        whitelist: `INVOKE_AGENT_WHITELIST` 配置值。
    """
    fake_manager = SimpleNamespace(list_configs=lambda: list(configs))
    monkeypatch.setattr(
        "src.config_manager.manager.get_config_manager",
        lambda: fake_manager,
        raising=True,
    )
    monkeypatch.setattr(
        catalog_module,
        "get_settings",
        lambda: SimpleNamespace(INVOKE_AGENT_WHITELIST=list(whitelist)),
        raising=True,
    )


# ---------------------------------------------------------------------------
# A1 / A2 / A4 / A5：意图 → 期望 Worker
# ---------------------------------------------------------------------------

GOLDEN_DISPATCH_CASES: tuple[tuple[str, str, str, str, str], ...] = (
    (
        "A1",
        "差旅报销制度怎么规定？",
        "mis-rag",
        "rag",
        "检索差旅报销标准并给出条款依据",
    ),
    (
        "A2",
        "查一下我的会员积分还有多少",
        "crm-assistant",
        "crm",
        "查询当前用户的会员积分余额与等级",
    ),
    (
        "A4",
        "从这段话里抽出姓名和部门",
        "mis-extract",
        "extract",
        "从给定文本中抽取姓名与部门字段并输出结构化结果",
    ),
    (
        "A5",
        "总结下面这份审批意见",
        "mis-summary",
        "summary",
        "对给定的审批意见做要点归纳并给出结论",
    ),
)
"""(用例编号, 用户说法, 期望 worker_id, 期望 intent, goal)。"""


@pytest.mark.parametrize(
    ("case_id", "user_question", "worker_id", "intent", "goal"),
    GOLDEN_DISPATCH_CASES,
    ids=[case[0] for case in GOLDEN_DISPATCH_CASES],
)
async def test_golden_intent_dispatches_to_expected_worker(
    case_id: str, user_question: str, worker_id: str, intent: str, goal: str
) -> None:
    """A1/A2/A4/A5：意图落到期望 Worker，且轨迹字段齐全。"""
    session_id = f"golden-{case_id.lower()}"

    result = await _dispatch(
        InvokeAgentInput(
            agent_id=worker_id,
            content=user_question,
            intent=intent,
            task_brief=_brief(goal, user_question),
        ),
        session_id=session_id,
    )

    assert not result.is_error
    traces = await drain_dispatch_traces(session_id)
    assert len(traces) == 1
    entry = traces[0]
    assert entry["worker_id"] == worker_id
    assert entry["intent"] == intent
    assert entry["status"] == "completed"
    assert entry["tool"] == "agent__invoke"
    assert entry["brief_rejected"] is False
    assert len(entry["task_id"]) == 12
    # 信封头与轨迹同源，便于把用户可见回复反查到具体委派
    assert f"[task:{entry['task_id']}] worker={worker_id} status=completed" in result.output


async def test_a1_worker_receives_self_contained_brief() -> None:
    """A1：Worker 收到的是自包含任务书渲染文本，而非 Coordinator 的上下文。"""
    captured: dict[str, Any] = {}

    async def _events(*_args: Any, **kwargs: Any) -> Any:
        captured["content"] = kwargs["message"].content
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content="差旅标准见第 3 条。")
        yield AgentEvent(type=AgentEventType.DONE)

    instance = MagicMock()
    instance.process_message = _events

    await _dispatch(
        InvokeAgentInput(
            agent_id="mis-rag",
            content="差旅报销制度怎么规定？",
            intent="rag",
            task_brief=_brief(
                "检索差旅报销标准并给出条款依据",
                "差旅报销制度怎么规定？",
                expected_output="answer+citations",
            ),
        ),
        session_id="golden-a1-brief",
        instance=instance,
    )

    rendered = captured["content"]
    assert "## 目标\n检索差旅报销标准并给出条款依据" in rendered
    assert "## 用户原问\n差旅报销制度怎么规定？" in rendered
    assert "## 期望输出\nanswer+citations" in rendered
    assert "## 约束" in rendered


async def test_a2_crm_mcp_down_reports_failure_without_fabrication() -> None:
    """A2：CRM MCP 不可达时如实报错、不加信封头、不臆造业务数据。"""
    result = await _dispatch(
        InvokeAgentInput(
            agent_id="crm-assistant",
            content="查一下我的会员积分还有多少",
            intent="crm",
            task_brief=_brief(
                "查询当前用户的会员积分余额与等级", "查一下我的会员积分还有多少"
            ),
        ),
        session_id="golden-a2-down",
        instance=_mcp_down_worker(),
    )

    assert result.is_error
    assert result.output == (
        "委托 crm-assistant 失败：CRM 工具调用失败"
        "（请确认 mcp-api-suite / :3333 可用）：crm__member_query: connection refused"
    )
    # 失败路径不加信封头（§7.6），且不得出现任何编造的积分/会员数据
    assert not result.output.startswith("[task:")
    assert "积分" not in result.output
    assert "会员" not in result.output

    traces = await drain_dispatch_traces("golden-a2-down")
    assert traces[0]["status"] == "failed"
    assert traces[0]["worker_id"] == "crm-assistant"
    assert traces[0]["brief_rejected"] is False


async def test_a3_chitchat_produces_no_dispatch_trace() -> None:
    """A3：闲聊/文案由 Coordinator 直答，本轮不产生任何委派轨迹。"""
    traces = await _coordinator_turn("golden-a3", [])

    assert traces == []


def test_a3_tool_description_tells_llm_to_answer_chitchat_directly() -> None:
    """A3：工具自述里明确「闲聊直答、填单走 formfill」，降低误调率。"""
    description = InvokeAgentTool().description

    assert "通用闲聊、文案撰写请直接回答，不要调用本工具。" in description
    assert "填单/补全表单字段请用 formfill__execute，不要用本工具。" in description


async def test_serial_multi_step_produces_two_ordered_traces() -> None:
    """「先查制度再总结」串行两段：轨迹按发生顺序各记一条。"""
    traces = await _coordinator_turn(
        "golden-serial",
        [
            InvokeAgentInput(
                agent_id="mis-rag",
                content="检索加班调休的制度规定",
                intent="rag",
                task_brief=_brief("检索加班调休制度并给出条款依据", "加班怎么调休？"),
            ),
            InvokeAgentInput(
                agent_id="mis-summary",
                content="把上一步检索到的条款压缩成给领导汇报的三条要点",
                intent="summary",
                task_brief=_brief(
                    "对已给定的制度条款做三条要点归纳", "加班怎么调休？"
                ),
            ),
        ],
    )

    assert [entry["worker_id"] for entry in traces] == ["mis-rag", "mis-summary"]
    assert [entry["intent"] for entry in traces] == ["rag", "summary"]
    assert all(entry["status"] == "completed" for entry in traces)


# ---------------------------------------------------------------------------
# A6：新增 Worker 只改 YAML
# ---------------------------------------------------------------------------


def _write_new_worker_yaml(root: Path) -> None:
    """在临时 configs 目录中「仅用 YAML」新增一个 Worker。

    Args:
        root: 临时 `configs/` 根目录。
    """
    agent_dir = root / "agents" / NEW_WORKER_ID
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "agent.yaml").write_text(
        "agent:\n"
        f"  name: {NEW_WORKER_ID}\n"
        "  display_name: 制度速查助手\n"
        "  description: 仅通过 YAML 接入的新 Worker，用于验证零代码扩展。\n"
        '  version: "1.0.0"\n'
        "  role: worker\n",
        encoding="utf-8",
    )
    (agent_dir / "metadata.yaml").write_text(
        "metadata:\n"
        f"  name: {NEW_WORKER_ID}\n"
        "  display_name: 制度速查助手\n"
        "  enabled: true\n"
        "  capabilities:\n"
        "    - policy\n"
        f"  when_to_use: {NEW_WORKER_HINT}\n"
        "  input_contract:\n"
        "    - user_question\n"
        "  output_contract: text\n"
        "  safety_level: read_only\n",
        encoding="utf-8",
    )


async def _configs_with_new_worker(tmp_path: Path) -> list[AgentConfig]:
    """真实 4 Worker + 1 Coordinator 的基础上，再叠加 YAML 新增的 Worker。

    Args:
        tmp_path: pytest 临时目录（承载新 Worker 的 YAML）。

    Returns:
        合并后的 AgentConfig 列表。
    """
    repo_configs, _ = await _load_configs(REPO_CONFIGS)
    _write_new_worker_yaml(tmp_path)
    new_configs, logger_spy = await _load_configs(tmp_path)
    logger_spy.error.assert_not_called()
    return [*repo_configs, *new_configs]


async def test_a6_new_worker_only_needs_yaml(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A6：只写 YAML（零 Python 改动）即进入 Catalog、工具 schema 与委派链路。"""
    configs = await _configs_with_new_worker(tmp_path)
    added = next(config for config in configs if config.agent_id == NEW_WORKER_ID)
    assert added.role is AgentRole.WORKER

    whitelist = sorted({*DEFAULT_WHITELIST, NEW_WORKER_ID})
    _patch_catalog_sources(monkeypatch, configs, whitelist)
    catalog = catalog_module.refresh_worker_catalog()

    # 1) 进入 Catalog
    assert NEW_WORKER_ID in catalog.worker_ids()
    spec = catalog.get(NEW_WORKER_ID)
    assert spec is not None
    assert spec.when_to_use == NEW_WORKER_HINT
    assert spec.is_read_only() is True

    # 2) 进入工具 schema 与 description（LLM 侧选择器随之更新）
    tool = InvokeAgentTool(catalog=catalog)
    schema = tool.to_api_schema()
    assert NEW_WORKER_ID in schema["input_schema"]["properties"]["agent_id"]["enum"]
    assert NEW_WORKER_HINT in schema["description"]

    # 3) 端到端可委派：轨迹落在新 Worker 上
    result = await _dispatch(
        InvokeAgentInput(
            agent_id=NEW_WORKER_ID,
            content="查一下差旅制度的最新生效日期",
            intent="rag",
            task_brief=_brief(
                "查询差旅制度当前版本号与生效日期", "差旅制度什么时候生效的？"
            ),
        ),
        session_id="golden-a6",
        settings=_settings(INVOKE_AGENT_WHITELIST=whitelist),
        catalog=catalog,
    )

    assert not result.is_error
    traces = await drain_dispatch_traces("golden-a6")
    assert traces[0]["worker_id"] == NEW_WORKER_ID
    assert traces[0]["status"] == "completed"


async def test_a6_disabled_worker_disappears_after_refresh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A6 反向：YAML 关停（enabled=false）后刷新即从目录与 schema 中消失。"""
    configs = await _configs_with_new_worker(tmp_path)
    whitelist = sorted({*DEFAULT_WHITELIST, NEW_WORKER_ID})
    _patch_catalog_sources(monkeypatch, configs, whitelist)
    assert NEW_WORKER_ID in catalog_module.refresh_worker_catalog().worker_ids()

    added = next(config for config in configs if config.agent_id == NEW_WORKER_ID)
    assert added.metadata is not None
    added.metadata.enabled = False
    catalog = catalog_module.refresh_worker_catalog()

    assert catalog.fallback is False
    assert NEW_WORKER_ID not in catalog.worker_ids()
    # 1.3/1.4：mis-admin-helper 作为 ADMIN_HELPER 特例收录，故即便 YAML 关停 NEW_WORKER，
    # 目录仍含 mis-admin-helper + 白名单内 enabled 的 worker（mis-rag/crm-assistant）。
    assert set(catalog.worker_ids()) == {"mis-admin-helper", "mis-rag", "crm-assistant"}
    assert NEW_WORKER_ID not in InvokeAgentTool(catalog=catalog).description


# ---------------------------------------------------------------------------
# A7：深度闸 + role 闸 双重拒绝
# ---------------------------------------------------------------------------


async def test_a7_depth_gate_rejects_second_hop() -> None:
    """A7 第一道闸：Worker 内再次委派被深度闸逐字拒绝，且不产生轨迹。"""
    token = invoke_agent_module._invoke_depth.set(1)
    try:
        result = await _dispatch(
            InvokeAgentInput(
                agent_id="mis-summary",
                content="把刚才检索到的条款再总结一下并给出结论",
                intent="summary",
            ),
            session_id="golden-a7-depth",
        )
    finally:
        invoke_agent_module._invoke_depth.reset(token)

    assert result.is_error
    assert result.output == (
        "调度深度超限（depth=1，max=1）：禁止子智能体再次委托其他智能体。"
    )
    assert await drain_dispatch_traces("golden-a7-depth") == []


async def test_a7_role_gate_strips_delegate_tool_from_worker_registry() -> None:
    """A7 第二道闸：role=worker 的运行时工具集里根本没有委派工具。"""
    configs, _ = await _load_configs(REPO_CONFIGS)
    roles = {config.agent_id: config.role for config in configs}
    assert roles["mis-rag"] is AgentRole.WORKER

    registry = trb.create_platform_tool_registry(None, ["*"], roles["mis-rag"])
    names = [tool.name for tool in registry.list_tools()]

    assert "agent__invoke" not in names
    assert "agent" not in names
    assert registry.get("agent__invoke") is None


async def test_a7_coordinator_keeps_delegate_tool() -> None:
    """A7 对照组：role=coordinator 即使 YAML 漏配也一定持有 agent__invoke。"""
    configs, _ = await _load_configs(REPO_CONFIGS)
    roles = {config.agent_id: config.role for config in configs}
    assert roles["mis-copilot"] is AgentRole.COORDINATOR

    registry = trb.create_platform_tool_registry(None, ["skill"], roles["mis-copilot"])

    assert registry.get("agent__invoke") is not None


async def test_a7_delegating_to_coordinator_is_forbidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A7 补充：委派 Coordinator 自身被静态兜底 + Catalog 动态判定双重拒绝。"""
    configs, _ = await _load_configs(REPO_CONFIGS)
    _patch_catalog_sources(monkeypatch, configs, sorted(DEFAULT_WHITELIST))
    catalog = catalog_module.refresh_worker_catalog()
    assert catalog.is_coordinator("mis-copilot") is True

    result = await _dispatch(
        InvokeAgentInput(
            agent_id="mis-copilot",
            content="请你自己再处理一遍这个请求并给出结论",
        ),
        session_id="golden-a7-self",
        catalog=catalog,
    )

    assert result.is_error
    assert result.output == "禁止委托调度器自身或其他调度 Agent：mis-copilot"
    assert await drain_dispatch_traces("golden-a7-self") == []


# ---------------------------------------------------------------------------
# 懒委托语料：100% 拦截 + 返回重写模板
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("lazy_text", LAZY_DELEGATION_CORPUS)
async def test_lazy_delegation_corpus_is_always_rejected(lazy_text: str) -> None:
    """严格模式下懒委托语料 100% 被拦截，并返回可执行的重写模板。"""
    session_id = f"lazy-{abs(hash(lazy_text)) % 100000}"
    agent_manager = MagicMock()
    agent_manager.ensure_agent_ready = AsyncMock(return_value=_text_worker())

    result = await _dispatch(
        InvokeAgentInput(agent_id="mis-rag", content=lazy_text, intent="rag"),
        session_id=session_id,
        settings=_settings(TASK_BRIEF_STRICT=True),
        agent_manager=agent_manager,
    )

    assert result.is_error
    assert result.output.startswith("[任务书校验未通过] 原因：")
    assert "懒委托：只给了指代性口令，未给出完整任务目标" in result.output
    assert "请不要重复原样调用。请按下列结构补全 task_brief 后重试：" in result.output
    assert '"goal"' in result.output and "正确示例：" in result.output
    # 真正的红线：被拒绝的委派绝不允许触达 Worker
    agent_manager.ensure_agent_ready.assert_not_awaited()

    traces = await drain_dispatch_traces(session_id)
    assert traces[0]["status"] == TRACE_STATUS_REJECTED
    assert traces[0]["brief_rejected"] is True


async def test_lazy_delegation_passes_after_rewrite() -> None:
    """按重写模板补全后同一意图即可通过（拦截不是死路）。"""
    settings = _settings(TASK_BRIEF_STRICT=True)
    rejected = await _dispatch(
        InvokeAgentInput(agent_id="mis-rag", content="帮我查一下", intent="rag"),
        session_id="lazy-retry",
        settings=settings,
    )
    assert rejected.is_error

    accepted = await _dispatch(
        InvokeAgentInput(
            agent_id="mis-rag",
            content="帮我查一下",
            intent="rag",
            task_brief=_brief(
                "检索差旅报销标准并给出条款依据", "差旅报销制度怎么规定？"
            ),
        ),
        session_id="lazy-retry",
        settings=settings,
    )

    assert not accepted.is_error
    traces = await drain_dispatch_traces("lazy-retry")
    assert [entry["status"] for entry in traces] == [TRACE_STATUS_REJECTED, "completed"]


async def test_too_short_goal_is_rejected_in_strict_mode() -> None:
    """非口令但过短的目标同样拦截（自包含性判据）。"""
    result = await _dispatch(
        InvokeAgentInput(agent_id="mis-rag", content="查制度", intent="rag"),
        session_id="lazy-short",
        settings=_settings(TASK_BRIEF_STRICT=True),
    )

    assert result.is_error
    assert "目标过短" in result.output


# ---------------------------------------------------------------------------
# 配置加载：5 个 Agent、role 与委派契约
# ---------------------------------------------------------------------------


async def test_repo_configs_load_five_agents_without_warning() -> None:
    """真实 configs 目录可加载 7 个 Agent，且加载过程无告警/报错。"""
    configs, logger_spy = await _load_configs(REPO_CONFIGS)
    agent_ids = sorted(config.agent_id for config in configs)

    assert agent_ids == sorted(EXPECTED_ROLES)
    logger_spy.warning.assert_not_called()
    logger_spy.error.assert_not_called()


async def test_repo_configs_declare_expected_roles() -> None:
    """7 个 Agent 的 role 解析正确：1 个 Coordinator + 6 个 Worker。"""
    configs, _ = await _load_configs(REPO_CONFIGS)
    roles = {config.agent_id: config.role for config in configs}

    assert roles == EXPECTED_ROLES
    assert sum(1 for role in roles.values() if role is AgentRole.COORDINATOR) == 1


async def test_worker_metadata_declares_delegation_contract() -> None:
    """6 个 Worker 的委派契约齐备，且 when_to_use 互不重复。"""
    configs, _ = await _load_configs(REPO_CONFIGS)
    workers = {
        config.agent_id: config.metadata
        for config in configs
        if config.role is AgentRole.WORKER
    }

    assert set(workers) == {*DEFAULT_WHITELIST, "mis-admin-helper", "mis-user-helper"}
    hints: list[str] = []
    for agent_id, metadata in workers.items():
        assert metadata is not None, agent_id
        assert metadata.when_to_use.strip(), agent_id
        assert metadata.input_contract, agent_id
        assert metadata.output_contract.strip(), agent_id
        assert metadata.safety_level in ("read_only", "needs_hitl"), agent_id
        hints.append(metadata.when_to_use.strip())

    assert len(set(hints)) == len(hints)
    assert workers["mis-rag"].output_contract == "answer+citations"
    assert workers["crm-assistant"].safety_level == "needs_hitl"


async def test_catalog_from_repo_configs_matches_whitelist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """由真实配置构建的 Catalog = (白名单 ∩ enabled ∩ role=worker) ∪ ADMIN_HELPER，
    Coordinator 被排除；mis-admin-helper 特例收录但不在白名单。"""
    configs, _ = await _load_configs(REPO_CONFIGS)
    _patch_catalog_sources(monkeypatch, configs, sorted(DEFAULT_WHITELIST))

    catalog = build_worker_catalog()

    assert catalog.fallback is False
    # 1.3/1.4：mis-extract/mis-summary 已 enabled:false → 不出现；mis-admin-helper 特例收录；
    # 白名单内 enabled 的 worker（mis-rag/crm-assistant）正常出现。
    assert set(catalog.worker_ids()) == {"mis-admin-helper", "mis-rag", "crm-assistant"}
    assert catalog.coordinators == ["mis-copilot"]
    assert catalog.get("mis-copilot") is None
    assert catalog.get("crm-assistant").is_read_only() is False


async def test_catalog_description_covers_every_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """工具 description 覆盖全部 Worker 的 when_to_use（LLM 选择依据）。"""
    configs, _ = await _load_configs(REPO_CONFIGS)
    _patch_catalog_sources(monkeypatch, configs, sorted(DEFAULT_WHITELIST))
    catalog = build_worker_catalog()

    description = InvokeAgentTool(catalog=catalog).description

    for worker_id in catalog.worker_ids():
        spec = catalog.get(worker_id)
        assert spec is not None
        assert spec.when_to_use in description


# ---------------------------------------------------------------------------
# Coordinator 调度纪律（system prompt 五段）
# ---------------------------------------------------------------------------


def _system_prompt() -> str:
    """读取 Coordinator 的 system prompt 全文。

    Returns:
        `system.md` 文本内容。
    """
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def test_system_prompt_contains_required_sections() -> None:
    """system prompt 必含设计要求的五段调度纪律。"""
    prompt = _system_prompt()

    for heading in (
        "## 一、角色与边界",
        "## 二、意图 → Worker 固定表",
        "## 三、TaskBrief 模板",
        "## 四、禁止事项",
        "## 五、转述纪律",
    ):
        assert heading in prompt, heading


def test_system_prompt_declares_intent_table() -> None:
    """意图 → Worker 固定表覆盖 spec §5 的七类意图与对应目标。"""
    prompt = _system_prompt()

    for intent in ("rag", "crm", "extract", "summary", "formfill", "chitchat", "unknown"):
        assert f"`{intent}`" in prompt, intent
    for worker_id in sorted(DEFAULT_WHITELIST):
        assert worker_id in prompt, worker_id
    assert "formfill__execute" in prompt
    assert "mis-copilot` 自身**不可**被委派" in prompt


def test_system_prompt_bans_lazy_delegation_and_fabrication() -> None:
    """禁止事项覆盖懒委托、致谢 Worker、臆造数据、闲聊委派、越权写。"""
    prompt = _system_prompt()

    assert "**禁止懒委托**" in prompt
    assert "**禁止对 Worker 致谢或假装对话**" in prompt
    assert "**禁止臆造业务数据**" in prompt
    assert "**闲聊与文案直接答**" in prompt
    assert "**填单走 `formfill__execute`**" in prompt
    assert "**不得越权写数据**" in prompt


def test_system_prompt_defines_retelling_discipline() -> None:
    """转述纪律：信封头不复述给用户，失败如实说明并给建议。"""
    prompt = _system_prompt()

    assert "[task:xxxx] worker=mis-rag status=completed" in prompt
    assert "复述给用户" in prompt
    assert "如实说明原因" in prompt
    assert "禁止**用编造内容填补" in prompt
