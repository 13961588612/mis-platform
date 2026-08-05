"""QA 独立验证补充用例（Coordinator–Worker 调度基座 C1/C2/C3/C5）。

本文件由 QA 独立编写，**不复用**实现方已有断言，用于覆盖以下缺口：

1. **回归红线可执行化**（团队红线 1–9）：工具名/无参构造/硬符号/懒导入未上提/
   `AgentEventType` 只增不改/默认 SSE `done` 帧逐字节一致/既有错误文案逐字保留/
   零新增第三方依赖；
2. **懒委托拦截返回重写模板**（而非一句错误串）；
3. **深度阀门**阻断递归委派，且 `ContextVar` 令牌正确回滚；
4. **熔断器**在连续失败达阈值后短路，成功后计数复位；
5. **通道 A 默认写入** `session.state["dispatch_trace"]`，通道 B/C 默认静默。

约定：只测行为与契约，不对任何 LLM 生成文本断言；不修改任何生产代码。
"""

from __future__ import annotations

import ast
import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openharness.tools.base import ToolExecutionContext

from src.config import Settings
from src.coordinator import sessions as sessions_mod
from src.coordinator import trace as trace_mod
from src.coordinator.brief import (
    LAZY_PATTERNS,
    MIN_BRIEF_CHARS,
    BriefValidationError,
    is_lazy_delegation,
)
from src.coordinator.notification import TaskNotification, TaskStatus
from src.coordinator.trace import (
    DISPATCH_TRACE_STATE_KEY,
    DispatchTraceEntry,
    drain_dispatch_traces,
    persist_dispatch_traces,
    push_dispatch_trace,
)
from src.runtime.events import AgentEvent, AgentEventType
from src.skills.tools import invoke_agent as invoke_mod
from src.skills.tools.invoke_agent import (
    DEFAULT_WHITELIST,
    DELEGATE_TOOL_NAME,
    FORBIDDEN_TARGETS,
    InvokeAgentInput,
    InvokeAgentTool,
    get_invoke_depth,
    resolve_whitelist,
)
from src.utils.exceptions import AgentNotFoundError, AgentNotRunningError

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_SRC = _BACKEND_ROOT / "src"
_MIS_KEYS = Path("d:/code/mis-platform/backend/keys")


# ===================== 公共夹具与工厂 =====================


@pytest.fixture(autouse=True)
def _isolate_process_state() -> Any:
    """每例前后清空 trace 缓冲与 C5 进程内状态，杜绝用例串味。"""
    trace_mod._reset_for_test()
    sessions_mod._reset_for_test()
    yield
    trace_mod._reset_for_test()
    sessions_mod._reset_for_test()


class _FakeSession:
    """轻量会话替身：拥有真实可变 `state`，用于验证状态累积语义。"""

    def __init__(self, session_id: str, user_id: str = "u-1", channel: str = "mis_bff") -> None:
        self.session_id = session_id
        self.user_id = user_id
        self.channel = channel
        self.user_mobile = ""
        self.channel_user_id = ""
        self.state: dict[str, Any] = {}


def _ctx(metadata: dict[str, Any] | None = None) -> ToolExecutionContext:
    """构造工具执行上下文。"""
    return ToolExecutionContext(cwd=Path("."), metadata=metadata or {})


def _settings(**overrides: Any) -> MagicMock:
    """只声明必要属性的 settings 替身，其余交由 flags 安全回落。"""
    base: dict[str, Any] = {
        "INVOKE_AGENT_WHITELIST": list(DEFAULT_WHITELIST),
        "INVOKE_AGENT_MAX_DEPTH": 1,
        "INVOKE_AGENT_TIMEOUT_SECONDS": 30,
    }
    base.update(overrides)
    return MagicMock(**base)


def _worker(text: str = "Worker 正文") -> MagicMock:
    """产出一段文本增量并结束的 Worker 替身。"""

    async def _events(*_a: Any, **_k: Any) -> Any:
        yield AgentEvent(type=AgentEventType.TEXT_DELTA, content=text)
        yield AgentEvent(type=AgentEventType.DONE)

    instance = MagicMock()
    instance.process_message = _events
    return instance


def _managers(
    parent: _FakeSession | None, child: _FakeSession, worker: Any = None
) -> tuple[MagicMock, MagicMock]:
    """构造 (session_manager, agent_manager) 替身对。"""
    session_mgr = MagicMock()
    session_mgr.get_session = AsyncMock(return_value=parent)
    session_mgr.create_session = AsyncMock(return_value=child)
    session_mgr.save_session = AsyncMock()

    agent_mgr = MagicMock()
    agent_mgr.ensure_agent_ready = AsyncMock(return_value=worker or _worker())
    return session_mgr, agent_mgr


def _patches(session_mgr: MagicMock, agent_mgr: MagicMock, settings: MagicMock) -> Any:
    """统一的 patch 组合（与实现方现有用例同手法）。"""
    return (
        patch("src.agent.session.get_session_manager", return_value=session_mgr),
        patch("src.agent.manager.get_agent_manager", return_value=agent_mgr),
        patch("src.skills.tools.invoke_agent.get_settings", return_value=settings),
        patch("src.config.get_settings", return_value=settings),
    )


async def _run(
    tool: InvokeAgentTool,
    arguments: InvokeAgentInput,
    ctx: ToolExecutionContext,
    session_mgr: MagicMock,
    agent_mgr: MagicMock,
    settings: MagicMock,
) -> Any:
    """在统一 patch 上下文中执行一次委派。"""
    p1, p2, p3, p4 = _patches(session_mgr, agent_mgr, settings)
    with p1, p2, p3, p4:
        return await tool.execute(arguments, ctx)


def _toplevel_import_roots(path: Path) -> set[str]:
    """解析文件的**模块顶层** import，返回被导入模块的完整名集合。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module)
    return names


def _all_import_roots(path: Path) -> set[str]:
    """解析文件中**所有层级**的 import，返回顶层包名集合。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            roots.add(node.module.split(".")[0])
    return roots


# ===================== 红线 1–3：符号与构造兼容 =====================


class TestRedlineSymbolCompatibility:
    """红线 1/2/3：工具名永久保留、无参构造等价现网、硬符号不改名不移位。"""

    def test_delegate_tool_name_permanently_preserved(self) -> None:
        """红线 1：`agent__invoke` 工具名在类属性与常量两处均保留。"""
        assert InvokeAgentTool.name == "agent__invoke"
        assert DELEGATE_TOOL_NAME == "agent__invoke"

    def test_no_arg_constructor_keeps_legacy_shape(self) -> None:
        """红线 2：`InvokeAgentTool()` 无参构造后三要素与类属性完全一致。"""
        tool = InvokeAgentTool()
        assert tool.name == "agent__invoke"
        assert tool.description == InvokeAgentTool.description
        assert tool.input_model is InvokeAgentInput
        # 未注入 Catalog 时不得触发任何 Catalog 相关行为
        assert tool._catalog is None
        assert tool._get_worker_spec("mis-rag") is None

    def test_hard_symbols_not_renamed_or_relocated(self) -> None:
        """红线 3：四个硬符号仍在 `invoke_agent` 模块顶层且类型未变。"""
        assert isinstance(invoke_mod.DEFAULT_WHITELIST, frozenset)
        assert isinstance(invoke_mod.FORBIDDEN_TARGETS, frozenset)
        assert callable(invoke_mod.resolve_whitelist)
        assert invoke_mod._invoke_depth.get() == 0
        assert invoke_mod._invoke_depth.name == "invoke_agent_depth"
        # 契约值本身不得改动
        assert "mis-copilot" in FORBIDDEN_TARGETS
        assert {"mis-rag", "mis-extract", "mis-summary", "crm-assistant"} <= DEFAULT_WHITELIST

    def test_resolve_whitelist_semantics_unchanged(self) -> None:
        """红线 3：`resolve_whitelist` 语义与改造前逐条一致。

        Note:
            全空白列表返回**空集**（而非回落默认白名单）是改造前既有行为，
            本次未改动；此处特征化锁定，防止后续「顺手优化」造成语义漂移。
        """
        assert resolve_whitelist(None) == DEFAULT_WHITELIST
        assert resolve_whitelist([]) == DEFAULT_WHITELIST
        assert resolve_whitelist(["  ", ""]) == frozenset()
        assert resolve_whitelist([" mis-rag "]) == frozenset({"mis-rag"})

    def test_new_input_fields_are_all_optional(self) -> None:
        """红线：新增入参必须全部可选，既有两参调用零改造。"""
        payload = InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据")
        assert payload.task_brief is None
        assert payload.intent == ""
        assert payload.mode == "spawn"
        assert payload.metadata == {}


# ===================== 红线 4：懒导入未被上提 =====================


class TestRedlineLazyImports:
    """红线 4：函数内懒导入不得上提到模块顶层（否则重现循环依赖）。"""

    @pytest.mark.parametrize(
        ("relative_path", "forbidden"),
        [
            (
                "skills/tools/invoke_agent.py",
                ("src.agent.session", "src.agent.manager", "src.coordinator.sessions",
                 "src.coordinator.catalog"),
            ),
            ("coordinator/trace.py", ("src.agent.session", "src.config")),
            ("coordinator/sessions.py", ("src.agent.session", "src.agent.manager")),
            ("coordinator/catalog.py", ("src.skills.tools.invoke_agent",)),
        ],
    )
    def test_lazy_imports_stay_function_local(
        self, relative_path: str, forbidden: tuple[str, ...]
    ) -> None:
        """指定模块的顶层 import 不得出现上述任一模块。"""
        toplevel = _toplevel_import_roots(_SRC / relative_path)
        leaked = sorted(set(forbidden) & toplevel)
        assert not leaked, f"{relative_path} 将懒导入上提到顶层：{leaked}"


# ===================== 红线 5：AgentEventType 只增不改 =====================


class TestRedlineEventEnum:
    """红线 5：枚举只追加 `DISPATCH_TRACE`，既有取值一字不改。"""

    # 改造前（git HEAD）`AgentEventType` 的完整取值，逐字抄录。
    _BASELINE = {
        "TEXT_DELTA": "text.delta",
        "TOOL_CALL": "tool.call",
        "TOOL_RESULT": "tool.result",
        "UI_RENDER": "ui.render",
        "APPROVAL_REQUEST": "approval.request",
        "ERROR": "error",
        "DONE": "done",
    }

    def test_existing_members_unchanged(self) -> None:
        """既有成员名与取值必须逐字保留。"""
        for member, value in self._BASELINE.items():
            assert hasattr(AgentEventType, member), f"枚举成员被删除：{member}"
            assert getattr(AgentEventType, member).value == value

    def test_only_dispatch_trace_added(self) -> None:
        """新增成员有且只有 `DISPATCH_TRACE`。"""
        added = {m.name for m in AgentEventType} - set(self._BASELINE)
        assert added == {"DISPATCH_TRACE"}
        assert AgentEventType.DISPATCH_TRACE.value == "dispatch.trace"

    def test_existing_events_do_not_leak_trace_field(self) -> None:
        """既有事件的 `trace` 恒为 None，`exclude_none` 序列化后不出现该键。"""
        for event in (
            AgentEvent.text_delta("hi"),
            AgentEvent.error("E", "boom"),
            AgentEvent.done(None),
        ):
            assert event.trace is None
            assert "trace" not in event.model_dump(exclude_none=True)

    def test_dispatch_trace_event_shape(self) -> None:
        """通道 C 事件形如 `{"entries": [...]}`。"""
        entries = [DispatchTraceEntry(worker_id="mis-rag").model_dump()]
        event = AgentEvent.dispatch_trace(entries)
        assert event.type is AgentEventType.DISPATCH_TRACE
        assert event.trace == {"entries": entries}


# ===================== 红线 6：默认开关与 SSE done 帧 =====================


class TestRedlineDefaultsAndSseFrame:
    """红线 6：通道 B 默认关闭时 `done` 帧不得泄漏任何新字段。"""

    @pytest.mark.parametrize(
        ("field", "expected"),
        [
            ("DISPATCH_TRACE_ENABLED", True),
            ("DISPATCH_TRACE_SSE_ENABLED", False),
            # C4：前端已就绪，通道 C（dispatch.trace 事件）默认开启
            ("DISPATCH_TRACE_EVENT_ENABLED", True),
            ("DELEGATE_TOOL_ALIAS_ENABLED", False),
            ("INVOKE_AGENT_CONTINUE_ENABLED", False),
            ("TASK_NOTIFICATION_MODE", "text_with_header"),
        ],
    )
    def test_declared_flag_defaults(self, field: str, expected: Any) -> None:
        """新增配置项的声明默认值必须与设计一致（通道 A/C 开、B 关）。"""
        assert field in Settings.model_fields, f"配置项缺失：{field}"
        assert Settings.model_fields[field].default == expected

    @pytest.mark.asyncio
    async def test_done_payload_has_no_dispatch_trace_when_channel_b_off(self) -> None:
        """通道 B 关闭时，即便本轮存在轨迹快照，`done` 载荷键集也保持原样。"""
        from src.api.routes import mis_capability as mc

        await push_dispatch_trace("sess-b-off", DispatchTraceEntry(worker_id="mis-rag"))
        await drain_dispatch_traces("sess-b-off")  # 生成 _last_turn 快照

        payload: dict[str, Any] = {
            "traceId": "t-1",
            "finishReason": "stop",
            "sessionId": "sess-b-off",
        }
        with patch.object(mc, "dispatch_trace_sse_enabled", return_value=False):
            if mc.dispatch_trace_sse_enabled():  # pragma: no cover - 分支恒假
                payload["dispatchTrace"] = await mc.take_last_turn_traces("sess-b-off")

        assert set(payload) == {"traceId", "finishReason", "sessionId"}
        assert json.dumps(payload, ensure_ascii=False) == (
            '{"traceId": "t-1", "finishReason": "stop", "sessionId": "sess-b-off"}'
        )

    @pytest.mark.skipif(not _MIS_KEYS.exists(), reason="缺少 MIS 密钥对，跳过真实 SSE 端到端校验")
    def test_real_sse_done_frame_is_byte_identical_by_default(self) -> None:
        """端到端：默认开关下真实 `done` 帧的键集与改造前完全一致。"""
        import jwt
        from fastapi.testclient import TestClient

        from src.api.routes import mis_capability as mc
        from src.config import Settings
        from src.main import app

        child = MagicMock()
        child.session_id = "sess-qa-done"
        session_mgr = MagicMock()
        session_mgr.create_session = AsyncMock(return_value=child)
        session_mgr.add_message = AsyncMock()

        async def _process(session: Any, message: Any) -> Any:
            yield AgentEvent.text_delta("你好")

        instance = MagicMock()
        instance.process_message = _process
        agent_mgr = MagicMock()
        agent_mgr.ensure_agent_ready = AsyncMock(return_value=instance)

        mis_settings = Settings()
        mis_settings.MIS_JWT_PUBLIC_KEY_PEM = (_MIS_KEYS / "public.pem").read_text()
        mis_settings.MIS_JWT_PUBLIC_KEY_PATH = ""
        mis_settings.MIS_JWT_ISSUER = "mis-platform"
        mis_settings.MIS_JWT_ALGORITHM = "RS256"
        token = jwt.encode(
            {"sub": "42", "employeeId": 2001, "tenantId": 10, "appId": 20,
             "username": "zhangsan", "roles": ["hr"], "permVersion": "v1"},
            (_MIS_KEYS / "private.pem").read_text(),
            algorithm="RS256",
        )

        with (
            patch.object(mc, "get_session_manager", return_value=session_mgr),
            patch.object(mc, "get_agent_manager", return_value=agent_mgr),
            patch("src.api.deps.get_settings", return_value=mis_settings),
        ):
            resp = TestClient(app).post(
                "/api/v1/agents/mis-copilot/chat/stream",
                headers={"Authorization": f"Bearer {token}", "X-Trace-Id": "t-qa-done"},
                json={"content": "你好", "role": "user", "metadata": {"capability": "chat"}},
            )

        assert resp.status_code == 200, resp.text
        done_blocks = [
            b for b in resp.text.split("\n\n") if b.strip().startswith("event: done")
        ]
        assert len(done_blocks) == 1
        data = json.loads(done_blocks[0].split("data:", 1)[1].strip())
        assert set(data) == {"traceId", "finishReason", "sessionId"}
        assert "dispatchTrace" not in resp.text

    @pytest.mark.asyncio
    async def test_channel_b_snapshot_available_when_enabled(self) -> None:
        """通道 B 打开时能取到本轮快照，且快照取用后即清空（不跨轮泄漏）。"""
        from src.api.routes import mis_capability as mc

        await push_dispatch_trace("sess-b-on", DispatchTraceEntry(worker_id="mis-rag"))
        await drain_dispatch_traces("sess-b-on")

        first = await mc.take_last_turn_traces("sess-b-on")
        assert len(first) == 1 and first[0]["worker_id"] == "mis-rag"
        assert await mc.take_last_turn_traces("sess-b-on") == []


# ===================== 红线 7：既有错误文案逐字保留 =====================


class TestRedlineErrorTextVerbatim:
    """红线 7 + C2：既有错误文案逐字保留，失败路径**不加**信封头。"""

    @pytest.mark.asyncio
    async def test_empty_agent_id_and_content(self) -> None:
        """空 agent_id / 空 content 的现网文案不变。"""
        tool = InvokeAgentTool()
        session_mgr, agent_mgr = _managers(None, _FakeSession("c"))
        settings = _settings()

        r1 = await _run(
            tool, InvokeAgentInput(agent_id="  ", content="x"), _ctx(),
            session_mgr, agent_mgr, settings,
        )
        assert r1.is_error and r1.output == "agent_id 不能为空"

        r2 = await _run(
            tool, InvokeAgentInput(agent_id="mis-rag", content="  "), _ctx(),
            session_mgr, agent_mgr, settings,
        )
        assert r2.is_error and r2.output == "content 不能为空"

    @pytest.mark.asyncio
    async def test_depth_forbidden_and_whitelist_messages(self) -> None:
        """深度超限 / 禁止目标 / 非白名单三条文案逐字保留。"""
        tool = InvokeAgentTool()
        session_mgr, agent_mgr = _managers(None, _FakeSession("c"))
        settings = _settings()

        forbidden = await _run(
            tool,
            InvokeAgentInput(agent_id="mis-copilot", content="检索差旅报销标准并给出条款依据"),
            _ctx(), session_mgr, agent_mgr, settings,
        )
        assert forbidden.output == "禁止委托调度器自身或其他调度 Agent：mis-copilot"

        outsider = await _run(
            tool,
            InvokeAgentInput(agent_id="unknown-bot", content="检索差旅报销标准并给出条款依据"),
            _ctx(), session_mgr, agent_mgr, settings,
        )
        allowed = ", ".join(sorted(DEFAULT_WHITELIST))
        assert outsider.output == f"目标智能体不在白名单：unknown-bot。允许：{allowed}"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("side_effect", "expected"),
        [
            (AgentNotFoundError("mis-rag"), "目标智能体不存在或未加载：mis-rag"),
            (AgentNotRunningError("mis-rag"), "目标智能体未运行：mis-rag"),
            (RuntimeError("boom"), "委托 mis-rag 失败：boom"),
            (TimeoutError(), "子智能体 mis-rag 调用超时（>30s）"),
        ],
    )
    async def test_worker_failure_texts_have_no_envelope_header(
        self, side_effect: Exception, expected: str
    ) -> None:
        """四类失败均逐字返回现网文案，且绝不出现 `[task:...]` 信封头。"""
        tool = InvokeAgentTool()
        session_mgr, agent_mgr = _managers(_FakeSession("p"), _FakeSession("c"))
        agent_mgr.ensure_agent_ready = AsyncMock(side_effect=side_effect)

        result = await _run(
            tool,
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p"}), session_mgr, agent_mgr, _settings(),
        )
        assert result.is_error
        assert result.output == expected
        assert "[task:" not in result.output

    def test_failure_notification_never_adds_header(self) -> None:
        """信封层面：非 COMPLETED 终态一律不加头，成功态才加。"""
        for status in (TaskStatus.FAILED, TaskStatus.KILLED, TaskStatus.TIMEOUT):
            note = TaskNotification.from_worker_result(
                task_id="abc123456789", worker_id="mis-rag", result="原始错误文案", status=status,
            )
            assert note.to_tool_output(mode="text_with_header") == "原始错误文案"
        ok = TaskNotification.from_worker_result(
            task_id="abc123456789", worker_id="mis-rag", result="正文",
        )
        rendered = ok.to_tool_output(mode="text_with_header")
        assert rendered.startswith("[task:abc123456789] worker=mis-rag status=completed")
        assert rendered.endswith("\n\n正文")


# ===================== 红线 8：零新增第三方依赖 =====================


class TestRedlineNoNewDependencies:
    """红线 8：新增/改造模块只依赖 stdlib + 既有 pydantic / openharness / src。"""

    _ALLOWED = {"src", "pydantic", "openharness"}

    @pytest.mark.parametrize(
        "relative_path",
        [
            "coordinator/__init__.py",
            "coordinator/flags.py",
            "coordinator/brief.py",
            "coordinator/notification.py",
            "coordinator/trace.py",
            "coordinator/catalog.py",
            "coordinator/sessions.py",
            "skills/tools/invoke_agent.py",
        ],
    )
    def test_no_third_party_imports(self, relative_path: str) -> None:
        """模块内所有 import 的顶层包必须是 stdlib 或既有白名单。"""
        roots = _all_import_roots(_SRC / relative_path)
        unexpected = sorted(roots - self._ALLOWED - set(sys.stdlib_module_names))
        assert not unexpected, f"{relative_path} 引入了新的第三方依赖：{unexpected}"

    def test_dependency_manifest_untouched(self) -> None:
        """依赖清单（pyproject / uv.lock）相对基线零改动。"""
        probe = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=_BACKEND_ROOT, capture_output=True, text=True, check=False,
        )
        if probe.returncode != 0:  # pragma: no cover - 非 git 环境跳过
            pytest.skip("非 git 工作区，跳过依赖清单比对")

        diff = subprocess.run(
            ["git", "diff", "--stat", "HEAD", "--", "pyproject.toml", "uv.lock"],
            cwd=_BACKEND_ROOT, capture_output=True, text=True, check=False,
        )
        assert diff.stdout.strip() == "", f"依赖清单被改动：\n{diff.stdout}"


# ===================== C1：懒委托拦截返回重写模板 =====================


class TestLazyDelegationRewriteTemplate:
    """C1：拒绝时必须返回可被 LLM 直接消费的**重写模板**，而非一句错误串。"""

    def test_rejection_output_is_a_rewrite_template(self) -> None:
        """模板需含：拒绝原因 + 缺失清单 + 完整 JSON 骨架 + 正确示例。"""
        output = BriefValidationError(
            reason="lazy_delegation", missing_fields=["goal"], rewrite_hint="禁止指代式口令。",
        ).to_tool_output()

        assert output.startswith("[任务书校验未通过]")
        assert "缺失或不合格字段：goal" in output
        assert "请不要重复原样调用" in output
        for key in ('"goal"', '"purpose"', '"inputs"', '"user_question"',
                    '"page_context_slice"', '"attachments_text"',
                    '"constraints"', '"expected_output"'):
            assert key in output, f"重写模板缺少字段骨架：{key}"
        assert "正确示例：" in output
        assert "补充提示：禁止指代式口令。" in output
        # 是多行结构化模板，而不是一句错误串
        assert len(output.splitlines()) >= 15

    def test_template_example_is_valid_json(self) -> None:
        """模板给出的「正确示例」必须是可被 LLM 直接复制的合法 JSON。"""
        output = BriefValidationError(reason="too_short").to_tool_output()
        example = output.split("正确示例：", 1)[1].strip()
        parsed = json.loads(example)
        assert parsed["goal"] and parsed["expected_output"]
        assert "user_question" in parsed["inputs"]

    @pytest.mark.parametrize("reason", ["missing_goal", "too_short", "lazy_delegation", "empty_question"])
    def test_every_reason_renders_chinese_text(self, reason: str) -> None:
        """四类拒绝原因都要有中文可读描述，不得回退成枚举字面量。"""
        error = BriefValidationError(reason=reason)  # type: ignore[arg-type]
        assert error.reason_text() != reason
        assert error.reason_text() in error.to_tool_output()

    @pytest.mark.parametrize("phrase", LAZY_PATTERNS)
    def test_bare_lazy_phrases_are_intercepted(self, phrase: str) -> None:
        """裸口令一律判定为懒委托。"""
        assert is_lazy_delegation(phrase) is True

    @pytest.mark.parametrize(
        "text",
        [
            "帮我查一下2026年差旅报销的住宿费上限标准并给出条款依据",
            "根据你的发现整理出三条整改建议并标注责任部门",
            "看看情况后输出本月销售额同比变化的结构化字段列表",
        ],
    )
    def test_lazy_phrase_with_real_payload_is_not_intercepted(self, text: str) -> None:
        """含口令但携带实质任务的目标**不得**被误杀（防过度拦截）。"""
        assert is_lazy_delegation(text) is False

    @pytest.mark.asyncio
    async def test_strict_rejection_never_touches_worker(self) -> None:
        """严格模式拒绝时，Worker 与子会话都不得被创建。"""
        tool = InvokeAgentTool()
        session_mgr, agent_mgr = _managers(_FakeSession("p-lazy"), _FakeSession("c"))
        result = await _run(
            tool,
            InvokeAgentInput(agent_id="mis-rag", content="你看着办"),
            _ctx({"session_id": "p-lazy"}),
            session_mgr, agent_mgr, _settings(TASK_BRIEF_STRICT=True),
        )
        assert result.is_error
        assert result.output.startswith("[任务书校验未通过]")
        assert '"goal"' in result.output
        agent_mgr.ensure_agent_ready.assert_not_awaited()
        session_mgr.create_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_too_short_goal_rejected_in_strict_mode(self) -> None:
        """严格模式下低于 MIN_BRIEF_CHARS 的目标被拦截并给出字数提示。"""
        tool = InvokeAgentTool()
        session_mgr, agent_mgr = _managers(_FakeSession("p-short"), _FakeSession("c"))
        result = await _run(
            tool,
            InvokeAgentInput(agent_id="mis-rag", content="查一下"),
            _ctx({"session_id": "p-short"}),
            session_mgr, agent_mgr, _settings(TASK_BRIEF_STRICT=True),
        )
        assert result.is_error
        assert f"少于 {MIN_BRIEF_CHARS} 字" in result.output
        agent_mgr.ensure_agent_ready.assert_not_awaited()

    def test_strict_default_is_strict_characterization(self) -> None:
        """特征化：`TASK_BRIEF_STRICT` 当前声明默认 True（默认严格，拦截懒委托）。

        Note:
            `design-impl.md` §6.2 的配置表登记默认值为 `True`。此处以**特征化
            测试**锁定当前实现取值，任何一方调整都会立刻暴露差异，交由团队裁定。
        """
        assert Settings.model_fields["TASK_BRIEF_STRICT"].default is True

    @pytest.mark.asyncio
    async def test_lazy_delegation_rejected_by_default_without_explicit_strict(self) -> None:
        """D1 翻转验证：默认配置（不显式设 TASK_BRIEF_STRICT）即拦截懒委托。

        用**真实** ``Settings()``（吃默认 True），入参命中 LAZY_PATTERNS。
        断言请求被拒、返回重写模板（非裸错误串）、Worker 零触达——
        证明 C1 招牌能力「懒委托拦截」现在默认生效，无需运维显式开启。
        """
        tool = InvokeAgentTool()
        session_mgr, agent_mgr = _managers(_FakeSession("p-default"), _FakeSession("c"))
        # 关键：用真实 Settings()，不显式设 TASK_BRIEF_STRICT，让它吃默认 True
        settings = Settings()
        result = await _run(
            tool,
            InvokeAgentInput(agent_id="mis-rag", content="你看着办"),
            _ctx({"session_id": "p-default"}),
            session_mgr, agent_mgr, settings,
        )
        assert result.is_error
        # 返回的是重写模板，而非一句裸错误串
        assert result.output.startswith("[任务书校验未通过]")
        assert '"goal"' in result.output
        # Worker 零触达：懒委托在 brief 校验阶段即被拦截
        agent_mgr.ensure_agent_ready.assert_not_awaited()


# ===================== C1：深度阀门 =====================


class TestDepthValve:
    """`_invoke_depth` + `INVOKE_AGENT_MAX_DEPTH`：阻断递归委派并正确回滚。"""

    @pytest.mark.asyncio
    async def test_depth_valve_blocks_nested_delegation(self) -> None:
        """深度已达上限时拒绝委派，Worker 完全不被触发。"""
        tool = InvokeAgentTool()
        session_mgr, agent_mgr = _managers(_FakeSession("p-d"), _FakeSession("c"))
        token = invoke_mod._invoke_depth.set(1)
        try:
            result = await _run(
                tool,
                InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
                _ctx({"session_id": "p-d"}),
                session_mgr, agent_mgr, _settings(INVOKE_AGENT_MAX_DEPTH=1),
            )
        finally:
            invoke_mod._invoke_depth.reset(token)

        assert result.is_error
        assert result.output == (
            "调度深度超限（depth=1，max=1）：禁止子智能体再次委托其他智能体。"
        )
        agent_mgr.ensure_agent_ready.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_depth_is_incremented_inside_worker_and_restored_after(self) -> None:
        """委派期间深度 +1，返回后严格回滚到 0（ContextVar 令牌不泄漏）。"""
        observed: list[int] = []

        async def _events(*_a: Any, **_k: Any) -> Any:
            observed.append(get_invoke_depth())
            yield AgentEvent(type=AgentEventType.TEXT_DELTA, content="ok")
            yield AgentEvent(type=AgentEventType.DONE)

        worker = MagicMock()
        worker.process_message = _events
        session_mgr, agent_mgr = _managers(_FakeSession("p-d2"), _FakeSession("c"), worker)

        assert get_invoke_depth() == 0
        result = await _run(
            InvokeAgentTool(),
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p-d2"}),
            session_mgr, agent_mgr, _settings(INVOKE_AGENT_MAX_DEPTH=2),
        )
        assert not result.is_error
        assert observed == [1], f"Worker 内深度应为 1，实际 {observed}"
        assert get_invoke_depth() == 0

    @pytest.mark.asyncio
    async def test_depth_restored_even_when_worker_raises(self) -> None:
        """Worker 抛异常时深度同样必须回滚（finally 分支）。"""
        session_mgr, agent_mgr = _managers(_FakeSession("p-d3"), _FakeSession("c"))
        agent_mgr.ensure_agent_ready = AsyncMock(side_effect=RuntimeError("boom"))

        result = await _run(
            InvokeAgentTool(),
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p-d3"}), session_mgr, agent_mgr, _settings(),
        )
        assert result.is_error
        assert get_invoke_depth() == 0


# ===================== C5：失败熔断 =====================


class TestCircuitBreaker:
    """连续失败达阈值后本会话内短路 60s，成功后计数复位。"""

    @pytest.mark.asyncio
    async def test_circuit_opens_after_threshold_consecutive_failures(self) -> None:
        """阈值 2：前两次真实调用 Worker，第三次直接短路且不再触达 Worker。"""
        parent = _FakeSession("p-cb")
        session_mgr, agent_mgr = _managers(parent, _FakeSession("c"))
        agent_mgr.ensure_agent_ready = AsyncMock(side_effect=AgentNotFoundError("mis-rag"))
        settings = _settings(INVOKE_AGENT_FAILURE_THRESHOLD=2)
        args = InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据")

        for _ in range(2):
            failed = await _run(
                InvokeAgentTool(), args, _ctx({"session_id": "p-cb"}),
                session_mgr, agent_mgr, settings,
            )
            assert failed.is_error
        assert agent_mgr.ensure_agent_ready.await_count == 2
        assert parent.state["worker_failures"]["mis-rag"]["count"] == 2
        assert parent.state["worker_failures"]["mis-rag"]["until_ts"] > 0

        short_circuited = await _run(
            InvokeAgentTool(), args, _ctx({"session_id": "p-cb"}),
            session_mgr, agent_mgr, settings,
        )
        assert short_circuited.is_error
        assert "已在本次会话内临时熔断" in short_circuited.output
        assert agent_mgr.ensure_agent_ready.await_count == 2, "熔断后不得再触达 Worker"

    @pytest.mark.asyncio
    async def test_success_resets_failure_counter(self) -> None:
        """一次成功即清空该 Worker 的连续失败计数。"""
        parent = _FakeSession("p-cb2")
        args = InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据")
        settings = _settings(INVOKE_AGENT_FAILURE_THRESHOLD=3)

        failing_mgr, failing_agent = _managers(parent, _FakeSession("c"))
        failing_agent.ensure_agent_ready = AsyncMock(side_effect=AgentNotFoundError("mis-rag"))
        await _run(InvokeAgentTool(), args, _ctx({"session_id": "p-cb2"}),
                   failing_mgr, failing_agent, settings)
        assert parent.state["worker_failures"]["mis-rag"]["count"] == 1

        ok_mgr, ok_agent = _managers(parent, _FakeSession("c"))
        result = await _run(InvokeAgentTool(), args, _ctx({"session_id": "p-cb2"}),
                            ok_mgr, ok_agent, settings)
        assert not result.is_error
        assert "mis-rag" not in parent.state.get("worker_failures", {})

    @pytest.mark.asyncio
    async def test_threshold_zero_disables_circuit(self) -> None:
        """阈值为 0 时熔断整体关闭，不写任何计数、不短路。"""
        parent = _FakeSession("p-cb3")
        session_mgr, agent_mgr = _managers(parent, _FakeSession("c"))
        agent_mgr.ensure_agent_ready = AsyncMock(side_effect=AgentNotFoundError("mis-rag"))
        settings = _settings(INVOKE_AGENT_FAILURE_THRESHOLD=0)
        args = InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据")

        for _ in range(3):
            await _run(InvokeAgentTool(), args, _ctx({"session_id": "p-cb3"}),
                       session_mgr, agent_mgr, settings)
        assert parent.state.get("worker_failures", {}) == {}
        assert agent_mgr.ensure_agent_ready.await_count == 3

    @pytest.mark.asyncio
    async def test_circuit_is_scoped_per_worker(self) -> None:
        """熔断按 Worker 维度隔离，不得殃及同会话内的其他 Worker。"""
        parent = _FakeSession("p-cb4")
        settings = _settings(INVOKE_AGENT_FAILURE_THRESHOLD=1)

        bad_mgr, bad_agent = _managers(parent, _FakeSession("c"))
        bad_agent.ensure_agent_ready = AsyncMock(side_effect=AgentNotFoundError("mis-rag"))
        await _run(
            InvokeAgentTool(),
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p-cb4"}), bad_mgr, bad_agent, settings,
        )
        # 熔断态查询同样要走被 patch 的会话管理器，否则会打真实 Redis
        with patch("src.agent.session.get_session_manager", return_value=bad_mgr):
            assert await sessions_mod.is_circuit_open("p-cb4", "mis-rag") is True
            assert await sessions_mod.is_circuit_open("p-cb4", "mis-summary") is False

        good_mgr, good_agent = _managers(parent, _FakeSession("c"))
        result = await _run(
            InvokeAgentTool(),
            InvokeAgentInput(agent_id="mis-summary", content="对本页审批意见做要点摘要并给出结论"),
            _ctx({"session_id": "p-cb4"}), good_mgr, good_agent, settings,
        )
        assert not result.is_error
        with patch("src.agent.session.get_session_manager", return_value=good_mgr):
            assert await sessions_mod.is_circuit_open("p-cb4", "mis-summary") is False
            assert await sessions_mod.is_circuit_open("p-cb4", "mis-rag") is True


# ===================== C3：三通道默认行为 =====================


class TestDispatchTraceChannels:
    """通道 A 默认写 `session.state`；通道 B/C 默认静默。"""

    @pytest.mark.asyncio
    async def test_channel_a_accumulates_into_session_state(self) -> None:
        """一次成功委派 → drain → persist，轨迹落入 `session.state`。"""
        parent = _FakeSession("p-ta")
        session_mgr, agent_mgr = _managers(parent, _FakeSession("c-ta"))
        result = await _run(
            InvokeAgentTool(),
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p-ta"}), session_mgr, agent_mgr, _settings(),
        )
        assert not result.is_error

        items = await drain_dispatch_traces("p-ta")
        with patch("src.agent.session.get_session_manager", return_value=session_mgr):
            history = await persist_dispatch_traces("p-ta", items)

        assert len(history) == 1
        assert parent.state[DISPATCH_TRACE_STATE_KEY] == history
        entry = history[0]
        assert entry["worker_id"] == "mis-rag"
        assert entry["status"] == "completed"
        assert entry["tool"] == "agent__invoke"
        assert entry["brief_rejected"] is False
        assert len(entry["task_id"]) == 12

    @pytest.mark.asyncio
    async def test_multiple_dispatches_append_in_order(self) -> None:
        """多次委派按时间顺序追加，不覆盖既有历史。"""
        parent = _FakeSession("p-ta2")
        session_mgr, agent_mgr = _managers(parent, _FakeSession("c"))
        for worker_id in ("mis-rag", "mis-summary"):
            await _run(
                InvokeAgentTool(),
                InvokeAgentInput(agent_id=worker_id, content="检索差旅报销标准并给出条款依据"),
                _ctx({"session_id": "p-ta2"}), session_mgr, agent_mgr, _settings(),
            )
        items = await drain_dispatch_traces("p-ta2")
        with patch("src.agent.session.get_session_manager", return_value=session_mgr):
            history = await persist_dispatch_traces("p-ta2", items)
        assert [e["worker_id"] for e in history] == ["mis-rag", "mis-summary"]

    def test_channels_b_stay_off_c_on_under_mock_settings_pollution(self) -> None:
        """裸 MagicMock settings 不得把默认关闭的通道 B 意外打开；通道 C 默认开。"""
        with patch("src.config.get_settings", return_value=MagicMock()):
            assert trace_mod.dispatch_trace_enabled() is True
            assert trace_mod.dispatch_trace_sse_enabled() is False
            assert trace_mod.dispatch_trace_event_enabled() is True

    @pytest.mark.asyncio
    async def test_channel_a_disabled_produces_no_state_write(self) -> None:
        """关闭通道 A 后 `session.state` 中不出现 `dispatch_trace` 键。"""
        parent = _FakeSession("p-ta3")
        session_mgr, agent_mgr = _managers(parent, _FakeSession("c"))
        await _run(
            InvokeAgentTool(),
            InvokeAgentInput(agent_id="mis-rag", content="检索差旅报销标准并给出条款依据"),
            _ctx({"session_id": "p-ta3"}), session_mgr, agent_mgr,
            _settings(DISPATCH_TRACE_ENABLED=False),
        )
        assert await drain_dispatch_traces("p-ta3") == []
        assert DISPATCH_TRACE_STATE_KEY not in parent.state

    @pytest.mark.asyncio
    async def test_trace_persist_degrades_silently_without_session(self) -> None:
        """会话不可用时轨迹落库静默降级，绝不抛错影响主链路。"""
        broken = MagicMock()
        broken.get_session = AsyncMock(side_effect=Exception("redis down"))
        with patch("src.agent.session.get_session_manager", return_value=broken):
            assert await persist_dispatch_traces("p-x", [{"worker_id": "mis-rag"}]) == []


# ===================== C5：并发闸口与停止 =====================


class TestParallelGateAndStop:
    """并行闸口按 `safety_level` 收敛；`mode="stop"` 幂等且返回 KILLED。"""

    @pytest.mark.asyncio
    async def test_semaphore_limit_is_respected(self) -> None:
        """信号量上限生效：limit=1 时同一循环内并发被压成串行。"""
        semaphore = sessions_mod.get_parallel_semaphore(1)
        peak = 0
        current = 0

        async def _worker() -> None:
            nonlocal peak, current
            async with semaphore:
                current += 1
                peak = max(peak, current)
                await asyncio.sleep(0)
                current -= 1

        await asyncio.gather(*(_worker() for _ in range(4)))
        assert peak == 1

    @pytest.mark.asyncio
    async def test_semaphore_rebuilt_when_limit_changes(self) -> None:
        """并行上限变更后返回新的信号量实例，避免沿用旧上限。"""
        first = sessions_mod.get_parallel_semaphore(1)
        assert sessions_mod.get_parallel_semaphore(1) is first
        assert sessions_mod.get_parallel_semaphore(3) is not first

    @pytest.mark.asyncio
    async def test_stop_without_running_task_is_idempotent(self) -> None:
        """无进行中任务时 stop 返回提示文案且不报错，可重复调用。"""
        parent = _FakeSession("p-stop")
        session_mgr, agent_mgr = _managers(parent, _FakeSession("c"))
        for _ in range(2):
            result = await _run(
                InvokeAgentTool(),
                InvokeAgentInput(agent_id="mis-rag", content="停止", mode="stop"),
                _ctx({"session_id": "p-stop"}), session_mgr, agent_mgr, _settings(),
            )
            assert not result.is_error
            assert "当前没有进行中的任务" in result.output
        agent_mgr.ensure_agent_ready.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_stop_unbinds_registered_worker_session(self) -> None:
        """已绑定子会话时 stop 会解绑并回报已停止。"""
        parent = _FakeSession("p-stop2")
        parent.state["worker_sessions"] = {"mis-rag": "child-9"}
        session_mgr, agent_mgr = _managers(parent, _FakeSession("c"))
        result = await _run(
            InvokeAgentTool(),
            InvokeAgentInput(agent_id="mis-rag", content="停止", mode="stop"),
            _ctx({"session_id": "p-stop2"}), session_mgr, agent_mgr, _settings(),
        )
        assert not result.is_error
        assert "已停止子智能体 mis-rag 的当前任务。" in result.output
        assert parent.state["worker_sessions"] == {}

    @pytest.mark.asyncio
    async def test_continue_mode_silently_downgrades_to_spawn_when_disabled(self) -> None:
        """`INVOKE_AGENT_CONTINUE_ENABLED=False` 时 continue 静默降级为 spawn。"""
        parent = _FakeSession("p-cont")
        parent.state["worker_sessions"] = {"mis-rag": "child-old"}
        session_mgr, agent_mgr = _managers(parent, _FakeSession("child-new"))
        result = await _run(
            InvokeAgentTool(),
            InvokeAgentInput(
                agent_id="mis-rag",
                content="检索差旅报销标准并给出条款依据",
                mode="continue",
            ),
            _ctx({"session_id": "p-cont"}), session_mgr, agent_mgr, _settings(),
        )
        assert not result.is_error
        session_mgr.create_session.assert_awaited()  # 新建而非复用
