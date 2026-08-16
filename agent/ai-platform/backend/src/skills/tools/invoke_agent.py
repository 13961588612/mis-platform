"""agent__invoke — 调度智能体委托调用其他 Agent（Copilot 调度器）。

仅应由 ``mis-copilot`` 暴露。白名单目标：mis-extract / mis-summary / mis-rag / crm-assistant。
深度限制 depth<=1，禁止递归调度与自调用。

本模块是 Coordinator–Worker 调度基座的**薄编排层**（design-impl.md §1.2）：
治理校验（白名单 / 深度 / 超时 / 熔断）留在这里，业务语义（TaskBrief、
结果信封 task_notification、dispatch_trace、Worker Catalog、子会话续聊）
全部下沉到 ``src/coordinator``。

向后兼容红线（design-impl.md §7.5）：

* ``agent__invoke`` 工具名永久保留，``InvokeAgentTool()`` 无参构造行为等价现网；
* ``InvokeAgentInput`` / ``InvokeAgentTool`` / ``_invoke_depth`` / ``resolve_whitelist``
  / ``DEFAULT_WHITELIST`` / ``FORBIDDEN_TARGETS`` / ``get_invoke_depth`` 不改名、不移位；
* ``get_session_manager`` / ``get_agent_manager`` 保持函数内懒导入（保证可被 patch）；
* 错误文案逐字保留，失败路径不加信封头。
"""

from __future__ import annotations

import asyncio
import contextlib
from contextvars import ContextVar, Token
from time import perf_counter
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

from src.config import get_settings
from src.coordinator.brief import TaskBrief, TaskBriefBuilder
from src.coordinator.flags import bool_flag, int_flag
from src.coordinator.notification import (
    TaskNotification,
    TaskStatus,
    TaskUsage,
)
from src.coordinator.trace import (
    QA_SUB_STAGES_CV,
    TRACE_STATUS_REJECTED,
    DispatchTraceEntry,
    push_dispatch_trace,
)
from src.runtime.events import AgentEventType
from src.utils.exceptions import AgentNotFoundError, AgentNotRunningError
from src.utils.logging import get_logger

logger = get_logger("skills.invoke_agent")

# 协程内调度深度（防止子 Agent 再 invoke）
_invoke_depth: ContextVar[int] = ContextVar("invoke_agent_depth", default=0)


def _coerce_mis_user_id(value: Any) -> int | None:
    """把 identity 第五键 ``misUserId`` 规约为 ``int | None``（T03 S9）。

    Args:
        value: identity 字典中的原始值（多为字符串）。

    Returns:
        正整数或 ``None``（非法/空值一律 ``None``，下游 fail-closed）。
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed: int = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None

DEFAULT_WHITELIST: frozenset[str] = frozenset(
    {
        "mis-extract",
        "mis-summary",
        "mis-rag",
        "crm-assistant",
    }
)

# 禁止被委托的调度器自身
FORBIDDEN_TARGETS: frozenset[str] = frozenset({"mis-copilot"})

#: 委派工具的规范名与可选别名（双名过渡，见 §1.1 D5 / §8 Q7）
DELEGATE_TOOL_NAME: str = "agent__invoke"
DELEGATE_TOOL_ALIAS: str = "agent"

#: worker_id → 默认意图（Coordinator 未自报 intent 时用于 dispatch_trace）
_WORKER_INTENT_HINTS: dict[str, str] = {
    "mis-rag": "rag",
    "crm-assistant": "crm",
    "mis-extract": "extract",
    "mis-summary": "summary",
}

#: 静态回退描述（Catalog 未注入时沿用现网文案，逐字不变）
_STATIC_DESCRIPTION: str = (
    "将任务委托给专用智能体并返回其结果。"
    "当用户需要：表单字段抽取 → mis-extract；审批/文本摘要 → mis-summary；"
    "制度/知识检索 → mis-rag；会员/积分/客户画像/CRM 查询 → crm-assistant。"
    "通用闲聊、文案撰写请直接回答，不要调用本工具。"
    "填单/补全表单字段请用 formfill__execute，不要用本工具。"
)


def get_invoke_depth() -> int:
    """当前协程的 invoke 深度（0 = 顶层 Copilot 工具调用）。"""
    return _invoke_depth.get()


def resolve_whitelist(configured: list[str] | None) -> frozenset[str]:
    """解析配置白名单；空配置回退默认。"""
    if configured:
        return frozenset(a.strip() for a in configured if a and a.strip())
    return DEFAULT_WHITELIST


class InvokeAgentInput(BaseModel):
    """agent__invoke 工具入参。"""

    agent_id: str = Field(
        ...,
        description=(
            "要委托的目标智能体 ID。"
            "允许：mis-extract（字段抽取）、mis-summary（摘要）、"
            "mis-rag（知识检索）、crm-assistant（会员/积分/CRM）。"
        ),
    )
    content: str = Field(
        ...,
        description="交给子智能体的用户任务原文（可含必要上下文，勿臆造业务数据）。",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="透传给子智能体的元数据（如 page_context / capability）。",
    )
    # ↓ 以下为 Coordinator–Worker 基座新增字段，全部可选且带默认值，
    #   既有 3 字段的定义与 description 一字未改（design-impl.md §7.5）。
    task_brief: dict[str, Any] | None = Field(
        default=None,
        description=(
            "结构化任务书（推荐）：{goal, purpose, inputs:{user_question,"
            " page_context_slice, attachments_text}, constraints, expected_output}。"
        ),
    )
    intent: str = Field(
        default="",
        description="Coordinator 自报意图（rag/crm/extract/summary/formfill/chitchat），仅用于可观测。",
    )
    mode: Literal["spawn", "continue", "stop"] = Field(
        default="spawn",
        description="spawn=新开子会话（默认）；continue=复用已有子会话续聊；stop=停止该 Worker。",
    )


class InvokeAgentTool(BaseTool):
    """将当前对话任务委托给白名单内的专用智能体，并返回其文本结果。"""

    name = "agent__invoke"
    description = _STATIC_DESCRIPTION
    input_model = InvokeAgentInput

    def __init__(
        self,
        *,
        tool_name: str | None = None,
        catalog: Any | None = None,
    ) -> None:
        """可选注入工具名（双名过渡）与 Catalog（动态 schema）。

        无参构造（``InvokeAgentTool()``）行为与现网完全一致 → 既有测试不受影响：
        此时不读取 Catalog、不做 Worker 契约补齐，`name` / `description` /
        `input_model` 全部沿用类属性。

        Args:
            tool_name: 覆盖工具名（仅用于注册 ``agent`` 别名）；`None` 保持 ``agent__invoke``。
            catalog: :class:`src.coordinator.catalog.WorkerCatalog` 实例；
                注入后按 Catalog 渲染 description 并把 `agent_id` 收窄为 `Literal`。
        """
        self._catalog: Any | None = catalog
        self._builder: TaskBriefBuilder = TaskBriefBuilder()
        # 实例属性覆盖类属性（BaseTool 只读 self.name/description/input_model）
        self.name = tool_name or type(self).name
        if catalog is not None:
            self.description = catalog.render_tool_description(base=_STATIC_DESCRIPTION)
            self.input_model = catalog.build_input_model(InvokeAgentInput)

    def is_read_only(self, arguments: BaseModel) -> bool:
        """委派一律按「非只读」处理。

        即便目标 Worker 的 `safety_level` 为 `read_only`，其内部仍可能触发
        MCP 写操作；保持 `False` 与现网权限语义完全一致，不因本次改造放宽
        OpenHarness `PermissionChecker` 的自动放行范围（纵深防御）。

        Args:
            arguments: 工具入参（未使用）。

        Returns:
            恒为 `False`。
        """
        del arguments
        return False

    async def execute(
        self, arguments: InvokeAgentInput, context: ToolExecutionContext
    ) -> ToolResult:
        """编排：治理校验 → Brief 构建校验 → 执行 Worker → 信封 → 记 trace。

        Args:
            arguments: 工具入参。
            context: OpenHarness 工具执行上下文（携带 session_id / identity）。

        Returns:
            成功时 `output` 为 `TaskNotification.to_tool_output()`（首行信封头 +
            空行 + Worker 正文）；失败时 `is_error=True` 且 `output` 为逐字保留的
            现网错误文案或 Brief 重写模板。
        """
        settings = get_settings()
        whitelist = resolve_whitelist(settings.INVOKE_AGENT_WHITELIST)
        max_depth = max(1, int(settings.INVOKE_AGENT_MAX_DEPTH or 1))
        timeout_s = max(5, int(settings.INVOKE_AGENT_TIMEOUT_SECONDS or 120))

        agent_id = (arguments.agent_id or "").strip()
        content = (arguments.content or "").strip()
        structured_brief = (
            arguments.task_brief if isinstance(arguments.task_brief, dict) else None
        )
        if not agent_id:
            return ToolResult(output="agent_id 不能为空", is_error=True)
        if not content and not structured_brief:
            return ToolResult(output="content 不能为空", is_error=True)

        depth = get_invoke_depth()
        if depth >= max_depth:
            return ToolResult(
                output=(
                    f"调度深度超限（depth={depth}，max={max_depth}）："
                    "禁止子智能体再次委托其他智能体。"
                ),
                is_error=True,
            )

        if self._is_forbidden_target(agent_id):
            return ToolResult(
                output=f"禁止委托调度器自身或其他调度 Agent：{agent_id}",
                is_error=True,
            )

        # 1.3 硬约束·闸②（belt-and-suspenders）：mis-admin-helper 作为后台操作员专属
        # Agent，copilot 全链路恒定不可达。即便被误配进白名单 / scoped catalog，
        # 这里也显式拒绝，绝不委派（与运行时 L249 白名单判定形成双保险）。
        # 懒导入：常量从 catalog 延迟导入，避免模块被 import 时即触发 catalog
        # 副作用 / 循环依赖（design §8 T03 懒导入红线）。
        from src.coordinator.catalog import ADMIN_HELPER_AGENT_IDS

        if agent_id in ADMIN_HELPER_AGENT_IDS:
            return ToolResult(
                output=f"目标智能体 {agent_id} 不可经调度链接触达（后台操作员专属，硬约束）",
                is_error=True,
            )
        if agent_id not in whitelist:
            allowed = ", ".join(sorted(whitelist))
            return ToolResult(
                output=f"目标智能体不在白名单：{agent_id}。允许：{allowed}",
                is_error=True,
            )

        meta = context.metadata or {}
        identity = meta.get("identity") if isinstance(meta.get("identity"), dict) else {}
        parent_session_id = str(meta.get("session_id") or "")

        # ===== 计时与任务 ID：治理校验通过后开始（design-impl.md §7.2）=====
        started_at = perf_counter()
        task_id = uuid4().hex[:12]
        intent = (arguments.intent or "").strip() or _WORKER_INTENT_HINTS.get(
            agent_id, "unknown"
        )
        worker_spec = self._get_worker_spec(agent_id)

        # ===== mode="stop"：停止已绑定的 Worker 子会话（C5）=====
        if arguments.mode == "stop":
            return await self._handle_stop(
                parent_session_id=parent_session_id,
                worker_id=agent_id,
                task_id=task_id,
                intent=intent,
                started_at=started_at,
            )

        # ===== TaskBrief 构建与校验 =====
        strict = bool_flag(settings, "TASK_BRIEF_STRICT", False)
        brief, brief_error = self._builder.build(
            task_brief=structured_brief,
            content=content,
            metadata=dict(arguments.metadata or {}),
            identity={str(k): str(v) for k, v in (identity or {}).items() if v},
            worker_spec=worker_spec,
            strict=strict,
        )
        if brief_error is not None:
            await self._record_trace(
                parent_session_id,
                DispatchTraceEntry(
                    intent=intent,
                    worker_id=agent_id,
                    tool=self.name,
                    status=TRACE_STATUS_REJECTED,
                    latency_ms=_elapsed_ms(started_at),
                    task_id=task_id,
                    brief_rejected=True,
                ),
            )
            return ToolResult(output=brief_error.to_tool_output(), is_error=True)

        assert brief is not None  # noqa: S101 - build() 契约：brief/error 必有其一

        # ===== 熔断：会话内连续失败短路（C5）=====
        failure_threshold = int_flag(
            settings, "INVOKE_AGENT_FAILURE_THRESHOLD", 3, minimum=0
        )
        if failure_threshold > 0 and parent_session_id:
            from src.coordinator.sessions import is_circuit_open

            if await is_circuit_open(parent_session_id, agent_id):
                return await self._finish(
                    parent_session_id=parent_session_id,
                    notification=TaskNotification.from_worker_result(
                        task_id=task_id,
                        worker_id=agent_id,
                        result=(
                            f"目标智能体 {agent_id} 近期连续失败，已在本次会话内临时熔断，"
                            "请稍后重试或改用其他方式。"
                        ),
                        status=TaskStatus.FAILED,
                        error_code="WORKER_CIRCUIT_OPEN",
                        latency_ms=_elapsed_ms(started_at),
                    ),
                    intent=intent,
                    started_at=started_at,
                    is_error=True,
                )

        # ===== 身份解析（既有顺序不变：identity → parent session → 兜底）=====
        # 懒导入，避免 tool_registry_builder ↔ agent.manager 循环依赖
        from src.agent.session import get_session_manager

        session_manager = get_session_manager()
        parent = None
        if parent_session_id:
            try:
                parent = await session_manager.get_session(parent_session_id)
            except Exception:
                parent = None

        user_id = (
            (identity.get("userId") or "").strip()
            or (parent.user_id if parent else "")
            or "mis-user"
        )
        channel = (
            (identity.get("channel") or "").strip()
            or (parent.channel if parent else "")
            or "mis_bff"
        )
        user_mobile = (
            (identity.get("userMobile") or "").strip()
            or (getattr(parent, "user_mobile", "") if parent else "")
        )
        channel_user_id = (
            (identity.get("channelUserId") or "").strip()
            or (getattr(parent, "channel_user_id", "") if parent else "")
            or user_id
        )
        # T03 S9：MIS userId 只从 identity 第五键 / 父会话继承。
        # ⚠ 绝不用 userId / channelUserId 回退 —— 那是企微 userid / employeeId。
        mis_user_id: int | None = _coerce_mis_user_id(
            identity.get("misUserId")
        ) or (getattr(parent, "mis_user_id", None) if parent else None)

        child_meta: dict[str, Any] = dict(arguments.metadata or {})
        child_meta.setdefault("source", "mis-copilot-delegate")
        child_meta["delegated_from"] = "mis-copilot"
        if parent_session_id:
            child_meta["parent_session_id"] = parent_session_id

        # ===== 续聊锚点（C5）：命中则复用子会话，未命中静默降级 spawn =====
        reuse_session_id = await self._resolve_continue_session(
            settings=settings,
            mode=arguments.mode,
            parent_session_id=parent_session_id,
            worker_id=agent_id,
        )

        # 深度必须在并发闸口之前 set：asyncio 子任务拷贝 Context，兄弟任务互不污染
        token: Token[int] = _invoke_depth.set(depth + 1)
        run_result: _WorkerRunResult | None = None
        failure: tuple[str, str, TaskStatus] | None = None
        try:
            try:
                async with _dispatch_gate(settings, worker_spec):
                    run_result = await asyncio.wait_for(
                        self._spawn_worker(
                            parent_session_id=parent_session_id,
                            agent_id=agent_id,
                            brief=brief,
                            child_meta=child_meta,
                            user_id=user_id,
                            channel=channel,
                            user_mobile=user_mobile,
                            channel_user_id=channel_user_id,
                            mis_user_id=mis_user_id,
                            reuse_session_id=reuse_session_id,
                        ),
                        timeout=timeout_s,
                    )
            except TimeoutError:
                failure = (
                    f"子智能体 {agent_id} 调用超时（>{timeout_s}s）",
                    "WORKER_TIMEOUT",
                    TaskStatus.TIMEOUT,
                )
            except asyncio.CancelledError:
                failure = (
                    f"子智能体 {agent_id} 已被停止",
                    "WORKER_KILLED",
                    TaskStatus.KILLED,
                )
            except AgentNotFoundError:
                failure = (
                    f"目标智能体不存在或未加载：{agent_id}",
                    "WORKER_UNAVAILABLE",
                    TaskStatus.FAILED,
                )
            except AgentNotRunningError:
                failure = (
                    f"目标智能体未运行：{agent_id}",
                    "WORKER_UNAVAILABLE",
                    TaskStatus.FAILED,
                )
            except Exception as exc:
                logger.warning(
                    "invoke_agent failed",
                    agent_id=agent_id,
                    error=str(exc),
                    exc_type=exc.__class__.__name__,
                )
                failure = (
                    f"委托 {agent_id} 失败：{exc}",
                    "WORKER_TOOL_ERROR",
                    TaskStatus.FAILED,
                )
        finally:
            _invoke_depth.reset(token)

        if failure is not None:
            message, error_code, status = failure
            await self._record_failure(
                parent_session_id, agent_id, threshold=failure_threshold
            )
            return await self._finish(
                parent_session_id=parent_session_id,
                notification=TaskNotification.from_worker_result(
                    task_id=task_id,
                    worker_id=agent_id,
                    result=message,
                    status=status,
                    error_code=error_code,
                    latency_ms=_elapsed_ms(started_at),
                ),
                intent=intent,
                started_at=started_at,
                is_error=True,
            )

        assert run_result is not None  # noqa: S101 - 无异常时必有结果
        await self._record_success(parent_session_id, agent_id)
        latency_ms = _elapsed_ms(started_at)
        notification = TaskNotification.from_worker_result(
            task_id=task_id,
            worker_id=agent_id,
            result=run_result.text,
            status=TaskStatus.COMPLETED,
            usage=TaskUsage(
                tokens=run_result.tokens,
                tool_uses=run_result.tool_uses,
                duration_ms=latency_ms,
            ),
            latency_ms=latency_ms,
            worker_session_id=run_result.child_session_id,
        )
        return await self._finish(
            parent_session_id=parent_session_id,
            notification=notification,
            intent=intent,
            started_at=started_at,
            is_error=False,
            sub_stages=run_result.sub_stages,
        )

    # ===== 内部编排 helper =====

    def _get_worker_spec(self, agent_id: str) -> Any | None:
        """从 Catalog 取目标 Worker 契约（未注入 Catalog 时返回 None）。

        Args:
            agent_id: 目标 Worker ID。

        Returns:
            `WorkerSpec` 或 `None`。
        """
        if self._catalog is None:
            return None
        try:
            return self._catalog.get(agent_id)
        except Exception as exc:  # noqa: BLE001 - Catalog 异常不应阻断委派
            logger.warning("worker catalog lookup failed", agent_id=agent_id, error=str(exc))
            return None

    def _is_forbidden_target(self, agent_id: str) -> bool:
        """判断目标是否禁止被委派（静态兜底 + role=coordinator 动态判定）。

        Args:
            agent_id: 目标 Agent ID。

        Returns:
            禁止委派返回 True。
        """
        if agent_id in FORBIDDEN_TARGETS:
            return True
        if self._catalog is None:
            return False
        try:
            return bool(self._catalog.is_coordinator(agent_id))
        except Exception:  # noqa: BLE001 - 判定失败按不禁止处理，静态兜底已覆盖
            return False

    async def _resolve_continue_session(
        self,
        *,
        settings: Any,
        mode: str,
        parent_session_id: str,
        worker_id: str,
    ) -> str | None:
        """解析 `mode="continue"` 的续聊锚点；未命中静默降级为 spawn。

        Args:
            settings: 配置对象。
            mode: 入参 mode。
            parent_session_id: 父会话 ID。
            worker_id: Worker Agent ID。

        Returns:
            可复用的子会话 ID；不续聊时返回 `None`。
        """
        if mode != "continue" or not parent_session_id:
            return None
        if not bool_flag(settings, "INVOKE_AGENT_CONTINUE_ENABLED", False):
            logger.info(
                "continue mode disabled, falling back to spawn", worker_id=worker_id
            )
            return None
        from src.coordinator.sessions import get_worker_session_registry

        child_session_id = await get_worker_session_registry().get_or_none(
            parent_session_id, worker_id
        )
        if not child_session_id:
            logger.info("continue mode missed, falling back to spawn", worker_id=worker_id)
        return child_session_id

    async def _handle_stop(
        self,
        *,
        parent_session_id: str,
        worker_id: str,
        task_id: str,
        intent: str,
        started_at: float,
    ) -> ToolResult:
        """处理 `mode="stop"`：取消运行中任务 + 解绑子会话 + 返回 KILLED 信封。

        Args:
            parent_session_id: 父会话 ID。
            worker_id: Worker Agent ID。
            task_id: 本次委派 ID。
            intent: 意图标签。
            started_at: 计时起点。

        Returns:
            `KILLED` 状态的工具结果。
        """
        from src.coordinator.sessions import (
            cancel_running_task,
            get_worker_session_registry,
        )

        registry = get_worker_session_registry()
        active = await registry.list_active(parent_session_id)
        child_session_id = active.get(worker_id, "")
        cancelled = cancel_running_task(parent_session_id, worker_id)
        await registry.unbind(parent_session_id, worker_id)

        message = (
            f"已停止子智能体 {worker_id} 的当前任务。"
            if cancelled or child_session_id
            else f"子智能体 {worker_id} 当前没有进行中的任务。"
        )
        return await self._finish(
            parent_session_id=parent_session_id,
            notification=TaskNotification.from_worker_result(
                task_id=task_id,
                worker_id=worker_id,
                result=message,
                status=TaskStatus.KILLED,
                error_code="WORKER_KILLED",
                latency_ms=_elapsed_ms(started_at),
                worker_session_id=child_session_id,
            ),
            intent=intent,
            started_at=started_at,
            is_error=False,
        )

    async def _spawn_worker(
        self,
        *,
        parent_session_id: str,
        agent_id: str,
        brief: TaskBrief,
        child_meta: dict[str, Any],
        user_id: str,
        channel: str,
        user_mobile: str,
        channel_user_id: str,
        mis_user_id: int | None = None,
        reuse_session_id: str | None,
    ) -> "_WorkerRunResult":
        """在可取消的 asyncio Task 中执行 Worker，并登记以支持 `mode="stop"`。

        Args:
            parent_session_id: 父会话 ID。
            agent_id: Worker Agent ID。
            brief: 已校验的任务书。
            child_meta: 透传给子会话的元数据。
            user_id: 用户 ID。
            channel: 渠道。
            user_mobile: 用户手机号。
            channel_user_id: 渠道侧用户 ID。
            mis_user_id: MIS userId（T03 S9）；子会话继承父身份，使子 Agent
                的 E1–E5 判权与父会话同源。
            reuse_session_id: 续聊复用的子会话 ID；`None` 表示新建。

        Returns:
            Worker 执行结果（含 worker 内部子阶段细分，若可得）。
        """
        # T02/T04：跨 asyncio.Task 边界共享 worker 细分计时的 dict 载体。
        # 父上下文 set 空 dict；ensure_future 拷贝上下文只复制引用，
        # 子任务（worker 内 qa_pipeline）对其 update 的变异对父任务可见。
        sub_stages_acc: dict[str, int] = {}
        cv_token = QA_SUB_STAGES_CV.set(sub_stages_acc)
        try:
            coro = _run_child_agent(
                agent_id=agent_id,
                content=brief.render(),
                metadata=child_meta,
                user_id=user_id,
                channel=channel,
                user_mobile=user_mobile,
                channel_user_id=channel_user_id,
                mis_user_id=mis_user_id,
                reuse_session_id=reuse_session_id,
            )
            if not parent_session_id:
                result = await coro
            else:
                from src.coordinator.sessions import (
                    get_worker_session_registry,
                    register_running_task,
                    unregister_running_task,
                )

                task: asyncio.Task[_WorkerRunResult] = asyncio.ensure_future(coro)
                register_running_task(parent_session_id, agent_id, task)
                try:
                    result = await task
                finally:
                    unregister_running_task(parent_session_id, agent_id)
                if result.child_session_id:
                    await get_worker_session_registry().bind(
                        parent_session_id, agent_id, result.child_session_id
                    )
            # 把共享 dict 中的 worker 细分计时回填到结果（空则 None，不可得）
            result.sub_stages = sub_stages_acc if sub_stages_acc else None
            return result
        finally:
            QA_SUB_STAGES_CV.reset(cv_token)

    async def _record_trace(
        self, parent_session_id: str, entry: DispatchTraceEntry
    ) -> None:
        """按开关把一条委派轨迹推入缓冲。

        Args:
            parent_session_id: 父会话 ID。
            entry: 轨迹条目。
        """
        if not bool_flag(get_settings(), "DISPATCH_TRACE_ENABLED", True):
            return
        await push_dispatch_trace(parent_session_id, entry)

    async def _finish(
        self,
        *,
        parent_session_id: str,
        notification: TaskNotification,
        intent: str,
        started_at: float,
        is_error: bool,
        sub_stages: dict[str, int] | None = None,
    ) -> ToolResult:
        """记录 trace 并渲染最终 ToolResult。

        Args:
            parent_session_id: 父会话 ID。
            notification: 结果信封。
            intent: 意图标签。
            started_at: 计时起点。
            is_error: 是否作为错误结果返回给 LLM。
            sub_stages: worker 内部子阶段细分（透传进 ``DispatchTraceEntry.sub_stages``）；
                ``None`` 表示不可得（降级红线：不影响主链路）。

        Returns:
            工具结果。
        """
        await self._record_trace(
            parent_session_id,
            DispatchTraceEntry(
                intent=intent,
                worker_id=notification.worker_id,
                tool=self.name,
                status=notification.status.value,
                latency_ms=notification.latency_ms or _elapsed_ms(started_at),
                task_id=notification.task_id,
                brief_rejected=False,
                sub_stages=sub_stages,
            ),
        )
        return ToolResult(output=notification.to_tool_output(), is_error=is_error)

    @staticmethod
    async def _record_failure(
        parent_session_id: str, worker_id: str, *, threshold: int
    ) -> None:
        """累加 Worker 失败计数（熔断输入）。

        Args:
            parent_session_id: 父会话 ID。
            worker_id: Worker Agent ID。
            threshold: 熔断阈值。
        """
        if threshold <= 0 or not parent_session_id:
            return
        from src.coordinator.sessions import record_failure

        with contextlib.suppress(Exception):
            await record_failure(parent_session_id, worker_id, threshold=threshold)

    @staticmethod
    async def _record_success(parent_session_id: str, worker_id: str) -> None:
        """清空 Worker 失败计数。

        Args:
            parent_session_id: 父会话 ID。
            worker_id: Worker Agent ID。
        """
        if not parent_session_id:
            return
        from src.coordinator.sessions import record_success

        with contextlib.suppress(Exception):
            await record_success(parent_session_id, worker_id)


def _elapsed_ms(started_at: float) -> int:
    """计算自 ``started_at`` 起的耗时（毫秒）。

    Args:
        started_at: `perf_counter()` 起点。

    Returns:
        毫秒整数（非负）。
    """
    return max(0, int((perf_counter() - started_at) * 1000))


@contextlib.asynccontextmanager
async def _dispatch_gate(settings: Any, worker_spec: Any | None):
    """并发闸口：并行上限信号量 + 写类 Worker 串行锁（C5）。

    Args:
        settings: 配置对象。
        worker_spec: 目标 Worker 契约；`None` 时按只读处理。

    Yields:
        `None`；退出时自动释放全部闸口。
    """
    from src.coordinator.sessions import (
        SAFETY_LEVEL_READ_ONLY,
        get_parallel_semaphore,
        get_serial_lock,
    )

    limit = int_flag(settings, "INVOKE_AGENT_MAX_PARALLEL", 1, minimum=1)
    safety_level = getattr(worker_spec, "safety_level", SAFETY_LEVEL_READ_ONLY)
    async with contextlib.AsyncExitStack() as stack:
        # 固定获取顺序（信号量 → 串行锁），避免交叉等待
        await stack.enter_async_context(get_parallel_semaphore(limit))
        if safety_level != SAFETY_LEVEL_READ_ONLY:
            await stack.enter_async_context(get_serial_lock())
        yield


class _WorkerRunResult:
    """`_run_child_agent()` 的结构化返回值。

    Attributes:
        text: Worker 汇总文本（含 ``[工具告警]`` 后缀，与改造前逐字节一致）。
        child_session_id: 子会话 ID（C5 续聊锚点）。
        tokens: Worker 侧 token 总量（取自 DONE 事件，缺失为 0）。
        tool_uses: Worker 侧工具调用次数（TOOL_CALL 计数）。
        sub_stages: worker 内部子阶段细分（``DispatchTraceEntry.sub_stages`` 透传载体）；
            ``None`` 表示 worker 未回传（不可得，降级红线：绝不阻断主链路）。
    """

    __slots__ = ("text", "child_session_id", "tokens", "tool_uses", "sub_stages")

    def __init__(
        self,
        *,
        text: str,
        child_session_id: str = "",
        tokens: int = 0,
        tool_uses: int = 0,
        sub_stages: dict[str, int] | None = None,
    ) -> None:
        self.text = text
        self.child_session_id = child_session_id
        self.tokens = tokens
        self.tool_uses = tool_uses
        self.sub_stages = sub_stages


async def _run_child_agent(
    *,
    agent_id: str,
    content: str,
    metadata: dict[str, Any],
    user_id: str,
    channel: str,
    user_mobile: str,
    channel_user_id: str,
    mis_user_id: int | None = None,
    reuse_session_id: str | None = None,
) -> _WorkerRunResult:
    """创建（或复用）子会话、跑完子 Agent，返回汇总文本与用量。

    Args:
        agent_id: Worker Agent ID。
        content: 交付 Worker 的自包含提示文本（`TaskBrief.render()`）。
        metadata: 透传元数据。
        user_id: 用户 ID。
        channel: 渠道。
        user_mobile: 用户手机号。
        channel_user_id: 渠道侧用户 ID。
        mis_user_id: MIS userId（T03 S9）；写入子会话供下游 E1–E5 判权。
        reuse_session_id: 续聊复用的子会话 ID；`None` 或载入失败时新建。

    Returns:
        :class:`_WorkerRunResult`。

    Raises:
        RuntimeError: Worker 运行时报错，或无正文且工具全部失败。
    """
    from src.agent.manager import get_agent_manager
    from src.agent.session import Message, get_session_manager

    session_manager = get_session_manager()
    agent_manager = get_agent_manager()

    child_session = None
    if reuse_session_id:
        try:
            child_session = await session_manager.get_session(reuse_session_id)
        except Exception as exc:  # noqa: BLE001 - 续聊失败静默降级为 spawn
            logger.info(
                "continue session unavailable, spawning new one",
                agent_id=agent_id,
                child_session_id=reuse_session_id,
                error=str(exc),
            )
            child_session = None

    if child_session is None:
        child_session = await session_manager.create_session(
            agent_id=agent_id,
            user_id=user_id,
            channel=channel,
            mis_user_id=mis_user_id,
        )
    child_session.user_mobile = user_mobile or ""
    child_session.channel_user_id = channel_user_id or user_id
    # 续聊复用的子会话可能是 mis_user_id 补齐之前建的，这里按父身份刷新；
    # 父身份缺失（None）时保留子会话既有值，不清空、不回退 user_id。
    if mis_user_id is not None:
        child_session.mis_user_id = mis_user_id
    # 标记委托会话，便于排障
    child_session.state["delegated_from"] = "mis-copilot"
    child_session.state["parent_hint"] = metadata.get("parent_session_id")
    await session_manager.save_session(child_session)

    instance = await agent_manager.ensure_agent_ready(agent_id)

    response_parts: list[str] = []
    tool_errors: list[str] = []
    runtime_error: str | None = None
    tool_uses: int = 0
    tokens: int = 0

    async for event in instance.process_message(
        session=child_session,
        message=Message(role="user", content=content, metadata=metadata),
    ):
        if event.type == AgentEventType.TEXT_DELTA and event.content:
            response_parts.append(event.content)
        elif event.type == AgentEventType.TOOL_CALL:
            tool_uses += 1
        elif event.type == AgentEventType.TOOL_RESULT and event.result:
            err: Any | None = event.result.get("error")
            if err:
                tool_errors.append(f"{event.tool_name}: {err}")
        elif event.type == AgentEventType.ERROR:
            runtime_error = event.message or "Agent runtime error"
        elif event.type == AgentEventType.DONE and event.token_usage is not None:
            tokens = int(getattr(event.token_usage, "total", 0) or 0)

    text = "".join(response_parts).strip()
    child_session_id = str(getattr(child_session, "session_id", "") or "")

    if runtime_error:
        raise RuntimeError(runtime_error)

    if not text and tool_errors:
        # 典型：crm-assistant MCP 未连接时工具失败且无正文
        hint = "；".join(tool_errors)
        if agent_id == "crm-assistant":
            raise RuntimeError(
                f"CRM 工具调用失败（请确认 mcp-api-suite / :3333 可用）：{hint}"
            )
        raise RuntimeError(f"子智能体工具失败：{hint}")

    if not text:
        return _WorkerRunResult(
            text=f"（{agent_id} 未返回文本内容）",
            child_session_id=child_session_id,
            tokens=tokens,
            tool_uses=tool_uses,
        )

    if tool_errors:
        return _WorkerRunResult(
            text=f"{text}\n\n[工具告警] " + "；".join(tool_errors),
            child_session_id=child_session_id,
            tokens=tokens,
            tool_uses=tool_uses,
        )

    logger.info(
        "invoke_agent completed",
        agent_id=agent_id,
        child_session_id=child_session_id,
        response_chars=len(text),
    )
    return _WorkerRunResult(
        text=text,
        child_session_id=child_session_id,
        tokens=tokens,
        tool_uses=tool_uses,
    )
