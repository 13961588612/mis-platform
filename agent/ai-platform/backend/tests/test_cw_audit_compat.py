"""QA2 对抗性审计 — P0 兼容红线：无参构造等价、flags 安全读取、错误文案逐字。

审计目标（team-lead P0 #2 / #3）：
1. `InvokeAgentTool()` 无参构造与现网等价：`name` / `description` / `input_model`
   与**类属性**同一对象，不受 Catalog 影响；注入 catalog 后才变化。
2. `flags.py` 声称"避免 MagicMock bool 污染"——在**真实 Settings** 与
   **MagicMock** 两条路径上分别验证，并额外做一条 **flag 名拼写体检**：
   源码里所有 `bool_flag/int_flag/str_flag` 引用的配置名必须真实存在于
   `Settings`，否则会永久静默回落默认值而无人察觉。
3. 错误文案**逐字**（`==` 而非 `in`）：既有 `test_invoke_agent.py` 只做
   `assert "白名单" in output` 之类的**子串弱断言**，改文案不会被发现。
   本文件把三条对外可见文案钉死到字节。
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openharness.tools.base import ToolExecutionContext

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.config import Settings, get_settings  # noqa: E402
from src.coordinator.flags import bool_flag, int_flag, str_flag  # noqa: E402
from src.skills.tools.invoke_agent import (  # noqa: E402
    DEFAULT_WHITELIST,
    DELEGATE_TOOL_ALIAS,
    DELEGATE_TOOL_NAME,
    InvokeAgentInput,
    InvokeAgentTool,
    _invoke_depth,
    _STATIC_DESCRIPTION,
)


def _ctx(metadata: dict | None = None) -> ToolExecutionContext:
    return ToolExecutionContext(cwd=Path("."), metadata=metadata or {})


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# ===========================================================================
# P0 #2 — InvokeAgentTool() 无参构造等价
# ===========================================================================


class TestNoArgConstructEquivalence:
    def test_no_arg_tool_uses_class_attributes_verbatim(self):
        """无参构造：三项对外契约与类属性**同一对象**（不是"看起来一样"）。"""
        tool = InvokeAgentTool()
        assert tool.name == "agent__invoke" == DELEGATE_TOOL_NAME
        assert tool.description is _STATIC_DESCRIPTION, "description 不是类属性同一对象"
        assert tool.input_model is InvokeAgentInput, "input_model 被替换"
        assert tool._catalog is None

    def test_static_description_text_frozen(self):
        """静态描述逐字锁死（它进 LLM prompt，改动会直接改变模型选路行为）。"""
        assert _STATIC_DESCRIPTION == (
            "将任务委托给专用智能体并返回其结果。"
            "当用户需要：表单字段抽取 → mis-extract；审批/文本摘要 → mis-summary；"
            "制度/知识检索 → mis-rag；会员/积分/客户画像/CRM 查询 → crm-assistant。"
            "通用闲聊、文案撰写请直接回答，不要调用本工具。"
            "填单/补全表单字段请用 formfill__execute，不要用本工具。"
        )

    def test_alias_construct_only_changes_name(self):
        """双名过渡：`tool_name="agent"` 只改名字，描述/入参模型不变。"""
        tool = InvokeAgentTool(tool_name=DELEGATE_TOOL_ALIAS)
        assert tool.name == "agent"
        assert tool.description is _STATIC_DESCRIPTION
        assert tool.input_model is InvokeAgentInput

    def test_catalog_injection_changes_description_and_model(self):
        """反向用例：注入 Catalog 才允许改写（证明上面的断言不是恒真）。"""
        catalog = MagicMock()
        catalog.render_tool_description.return_value = "RENDERED"
        catalog.build_input_model.return_value = InvokeAgentInput
        tool = InvokeAgentTool(catalog=catalog)
        assert tool.description == "RENDERED"
        catalog.render_tool_description.assert_called_once_with(base=_STATIC_DESCRIPTION)

    def test_is_read_only_always_false(self):
        """委派一律非只读——放宽会让 OpenHarness 权限检查自动放行写操作。"""
        tool = InvokeAgentTool()
        assert tool.is_read_only(InvokeAgentInput(agent_id="mis-rag", content="x")) is False

    def test_public_symbols_not_renamed_or_moved(self):
        """兼容红线清单里的符号必须仍在原模块可导入。"""
        import src.skills.tools.invoke_agent as mod

        for symbol in (
            "InvokeAgentInput",
            "InvokeAgentTool",
            "_invoke_depth",
            "resolve_whitelist",
            "DEFAULT_WHITELIST",
            "FORBIDDEN_TARGETS",
            "get_invoke_depth",
        ):
            assert hasattr(mod, symbol), f"兼容红线符号缺失：{symbol}"

    def test_input_model_legacy_fields_unchanged(self):
        """既有 3 个字段的必填性/类型不得变；新增字段必须全部可选。"""
        fields = InvokeAgentInput.model_fields
        assert fields["agent_id"].is_required() is True
        assert fields["content"].is_required() is True
        assert fields["metadata"].is_required() is False
        for new_field in ("task_brief", "intent", "mode"):
            assert new_field in fields
            assert fields[new_field].is_required() is False, f"新增字段变成必填：{new_field}"
        # 只带既有 3 字段即可构造（现网调用形态）
        obj = InvokeAgentInput(agent_id="mis-rag", content="x", metadata={})
        assert obj.mode == "spawn" and obj.intent == "" and obj.task_brief is None


# ===========================================================================
# P0 #2 — flags.py 安全读取（真实 Settings + MagicMock 双路径）
# ===========================================================================


class TestFlagsSafeRead:
    def test_magicmock_does_not_turn_flags_on(self):
        """核心声明验证：未显式声明的属性在 MagicMock 上恒真，flags 必须挡住。"""
        mock = MagicMock()
        assert bool(mock.DISPATCH_TRACE_SSE_ENABLED) is True, "前置条件：裸读确实恒真"
        assert bool_flag(mock, "DISPATCH_TRACE_SSE_ENABLED", False) is False
        assert bool_flag(mock, "TASK_BRIEF_STRICT", False) is False
        assert bool_flag(mock, "DELEGATE_TOOL_ALIAS_ENABLED", False) is False
        assert bool_flag(mock, "INVOKE_AGENT_CONTINUE_ENABLED", False) is False
        assert bool_flag(mock, "DISPATCH_TRACE_ENABLED", True) is True
        assert int_flag(mock, "INVOKE_AGENT_MAX_PARALLEL", 1, minimum=1) == 1
        assert str_flag(mock, "TASK_NOTIFICATION_MODE", "text_with_header") == "text_with_header"

    def test_magicmock_with_spec_also_blocked(self):
        """`MagicMock(spec=Settings)` 同样不得污染（属性存在但仍是 Mock）。"""
        mock = MagicMock(spec=Settings)
        assert bool_flag(mock, "DISPATCH_TRACE_SSE_ENABLED", False) is False
        assert int_flag(mock, "INVOKE_AGENT_MAX_PARALLEL", 1, minimum=1) == 1

    def test_real_settings_defaults_match_documented_contract(self):
        """真实 Settings 默认值 = spec §12 契约（不是靠 flags 的 default 兜出来的）。"""
        s = Settings()
        assert s.DISPATCH_TRACE_ENABLED is True
        assert s.DISPATCH_TRACE_SSE_ENABLED is False
        # C4：前端已就绪，通道 C（dispatch.trace 事件）默认开启
        assert s.DISPATCH_TRACE_EVENT_ENABLED is True
        assert s.TASK_BRIEF_STRICT is True
        assert s.DELEGATE_TOOL_ALIAS_ENABLED is False
        assert s.INVOKE_AGENT_MAX_PARALLEL == 1
        assert s.INVOKE_AGENT_FAILURE_THRESHOLD == 3
        assert s.INVOKE_AGENT_CONTINUE_ENABLED is False
        assert s.TASK_NOTIFICATION_MODE == "text_with_header"
        assert s.INVOKE_AGENT_MAX_DEPTH == 1
        assert s.INVOKE_AGENT_TIMEOUT_SECONDS == 120
        # 1.3/1.4：白名单移除已灰度的 mis-extract/mis-summary、加入承接其能力的
        # mis-user-helper，与 DEFAULT_WHITELIST（兜底常量，仍保留旧 worker）解耦，
        # 二者不再要求相等。
        assert sorted(s.INVOKE_AGENT_WHITELIST) == [
            "crm-assistant",
            "mis-rag",
            "mis-user-helper",
        ]
        # 硬约束（R5/R8）：后台操作员专属 Agent 绝不进委派白名单
        assert "mis-admin-helper" not in s.INVOKE_AGENT_WHITELIST

    def test_real_settings_values_are_honoured_not_swallowed(self):
        """反向用例：真实值必须被读到，不能被 flags 一律吞成 default。"""
        s = Settings()
        s.DISPATCH_TRACE_SSE_ENABLED = True
        s.INVOKE_AGENT_MAX_PARALLEL = 4
        s.TASK_NOTIFICATION_MODE = "json"
        assert bool_flag(s, "DISPATCH_TRACE_SSE_ENABLED", False) is True
        assert int_flag(s, "INVOKE_AGENT_MAX_PARALLEL", 1, minimum=1) == 4
        assert str_flag(
            s, "TASK_NOTIFICATION_MODE", "text_with_header",
            allowed=("text_with_header", "json"),
        ) == "json"

    @pytest.mark.parametrize(
        "raw,expected",
        [("1", True), ("true", True), ("TRUE", True), (" on ", True), ("yes", True),
         ("0", False), ("false", False), ("off", False), ("no", False),
         ("maybe", False), ("", False), (None, False), ([], False), ({}, False)],
    )
    def test_bool_flag_string_matrix(self, raw, expected):
        """字符串/异常类型矩阵：环境变量注入场景下的解析边界。"""
        mock = MagicMock()
        mock.X = raw
        assert bool_flag(mock, "X", False) is expected

    def test_int_flag_rejects_bool_and_clamps(self):
        """int_flag 必须把 bool 当非法（True 不能变成 1），并做上下界裁剪。"""
        mock = MagicMock()
        mock.X = True
        assert int_flag(mock, "X", 7) == 7, "bool 被当成 int 读进来了"
        mock.X = -5
        assert int_flag(mock, "X", 1, minimum=1) == 1
        mock.X = 999
        assert int_flag(mock, "X", 1, minimum=1, maximum=8) == 8
        mock.X = "3"
        assert int_flag(mock, "X", 1, minimum=1) == 3
        mock.X = "abc"
        assert int_flag(mock, "X", 2, minimum=1) == 2

    def test_str_flag_rejects_out_of_allowed_set(self):
        mock = MagicMock()
        mock.X = "json"
        assert str_flag(mock, "X", "text_with_header", allowed=("text_with_header", "json")) == "json"
        mock.X = "yaml"
        assert str_flag(mock, "X", "text_with_header", allowed=("text_with_header", "json")) == "text_with_header"
        mock.X = "   "
        assert str_flag(mock, "X", "text_with_header") == "text_with_header"

    def test_every_flag_name_referenced_in_source_exists_on_settings(self):
        """**拼写体检**：flags 取不到属性时静默回落 default，拼错=功能永久失效且无告警。

        因此扫描全部源码里的 `bool_flag/int_flag/str_flag(..., "NAME", ...)`，
        逐一断言 `NAME` 是 `Settings` 的真实字段。
        """
        src_root = _BACKEND / "src"
        pattern = re.compile(r"\b(?:bool_flag|int_flag|str_flag)\s*\(", re.S)
        names: set[str] = set()
        for py in src_root.rglob("*.py"):
            text = py.read_text(encoding="utf-8")
            if not pattern.search(text):
                continue
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                fn = node.func
                fn_name = getattr(fn, "id", None) or getattr(fn, "attr", None)
                if fn_name not in {"bool_flag", "int_flag", "str_flag"}:
                    continue
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    value = node.args[1].value
                    if isinstance(value, str):
                        names.add(value)
        assert names, "未扫描到任何 flag 名，测试本身失效"
        settings_fields = set(Settings.model_fields)
        missing = sorted(n for n in names if n not in settings_fields)
        assert not missing, (
            f"以下 flag 名在 Settings 上不存在，将永久静默回落默认值：{missing}"
        )


# ===========================================================================
# P0 #3 — 错误文案逐字保留
# ===========================================================================


class TestErrorTextVerbatim:
    """既有测试仅做子串断言；此处按字节钉死三条对外可见文案。"""

    async def test_depth_overflow_text_verbatim(self):
        tool = InvokeAgentTool()
        token = _invoke_depth.set(1)
        try:
            result = await tool.execute(
                InvokeAgentInput(agent_id="mis-extract", content="抽取姓名与部门字段"),
                _ctx(),
            )
        finally:
            _invoke_depth.reset(token)
        assert result.is_error is True
        assert result.output == (
            "调度深度超限（depth=1，max=1）：禁止子智能体再次委托其他智能体。"
        ), repr(result.output)

    async def test_whitelist_reject_text_verbatim(self):
        tool = InvokeAgentTool()
        result = await tool.execute(
            InvokeAgentInput(agent_id="evil-agent", content="做点什么事情吧好吗"),
            _ctx(),
        )
        assert result.is_error is True
        assert result.output == (
            "目标智能体不在白名单：evil-agent。"
            "允许：crm-assistant, mis-rag, mis-user-helper"
        ), repr(result.output)

    async def test_forbidden_self_text_verbatim(self):
        tool = InvokeAgentTool()
        result = await tool.execute(
            InvokeAgentInput(agent_id="mis-copilot", content="帮我处理这件事情吧"),
            _ctx(),
        )
        assert result.is_error is True
        assert result.output == "禁止委托调度器自身或其他调度 Agent：mis-copilot"

    async def test_empty_arg_texts_verbatim(self):
        tool = InvokeAgentTool()
        r1 = await tool.execute(InvokeAgentInput(agent_id="   ", content="x"), _ctx())
        assert r1.output == "agent_id 不能为空"
        r2 = await tool.execute(InvokeAgentInput(agent_id="mis-rag", content="  "), _ctx())
        assert r2.output == "content 不能为空"

    async def test_timeout_text_verbatim_and_no_envelope_header(self):
        """超时文案逐字 + **失败路径不加信封头**（spec §7.1）。

        用真实 `asyncio.wait_for` 触发超时：把 `_spawn_worker` 换成一个
        永远不返回的协程，并把超时压到 5s 下限后用 mock 时钟——这里改用
        直接抛 `TimeoutError` 的 `wait_for` 打桩，保证用例秒级完成且走真实分支。
        """
        import asyncio as _asyncio

        tool = InvokeAgentTool()
        settings = Settings()
        settings.INVOKE_AGENT_TIMEOUT_SECONDS = 7
        # 默认 TASK_BRIEF_STRICT=True 会在 brief 校验阶段以 too_short 拒绝
        # （content 仅 10 字 < MIN_BRIEF_CHARS），到不了超时分支；显式关闭以
        # 进入超时路径，保留本用例"验证超时文案逐字保留"的原意。
        settings.TASK_BRIEF_STRICT = False

        async def _never(*a, **kw):
            await _asyncio.sleep(3600)

        async def _instant_timeout(coro, timeout):  # noqa: ARG001
            coro.close()
            raise TimeoutError

        with patch("src.skills.tools.invoke_agent.get_settings", return_value=settings), patch.object(
            InvokeAgentTool, "_spawn_worker", _never
        ), patch("asyncio.wait_for", _instant_timeout):
            result = await tool.execute(
                InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准的条款"),
                _ctx({"session_id": ""}),
            )

        assert result.is_error is True
        assert result.output == "子智能体 mis-rag 调用超时（>7s）", repr(result.output)
        assert "task_notification" not in result.output, "失败路径不得附加信封头"
        assert "\n" not in result.output, "失败路径输出应为单行原文"
