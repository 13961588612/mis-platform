"""TaskBrief 自包含委派任务书：模型 / 构造器 / 校验 / page_context 脱敏。

对齐 `docs/ai-fusion/coordinator-worker/spec.md` §4.2 与实现级设计 §3.1。

Coordinator 通过 ``agent__invoke`` 委派任务时必须给出**自包含**任务书；
本模块负责：

* **双模构造**：`task_brief` 结构化入参优先，`content` 纯文本回退；
* **懒委托拦截**：命中判据时返回可被 LLM 直接消费的重写模板；
* **上下文脱敏**：`page_context` 只能经 :func:`sanitize_page_context` 产出。
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from src.utils.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover - 仅供类型检查，运行期不导入避免循环依赖
    from src.coordinator.catalog import WorkerSpec

logger = get_logger("coordinator.brief")

# ===== 校验常量（design-impl.md §3.1）=====

MIN_BRIEF_CHARS: int = 12
"""目标（goal）去空白后的最小字符数，低于此值视为「太短的懒委托」。"""

LAZY_PATTERNS: tuple[str, ...] = (
    "根据你的发现",
    "帮我查一下",
    "看看情况",
    "你看着办",
    "随便",
    "继续吧",
)
"""懒委托口令模式集：命中且剩余实词过少时判定为懒委托。"""

LAZY_RESIDUE_MIN_CHARS: int = 4
"""剔除懒委托口令后，剩余实词需达到的最小字符数。"""

# ===== page_context 脱敏常量 =====

PAGE_CONTEXT_ALLOW_KEYS: frozenset[str] = frozenset(
    {
        "pageId",
        "pageName",
        "formCode",
        "formName",
        "moduleCode",
        "selectedRowIds",
        "visibleFields",
        "currentTab",
    }
)
"""顶层白名单键：只有这些键可以进入 `page_context_slice`。"""

PAGE_CONTEXT_DENY_KEY_HINTS: tuple[str, ...] = (
    "token",
    "secret",
    "password",
    "idcard",
    "mobile",
    "phone",
    "bankcard",
    "salary",
    "authorization",
    "cookie",
)
"""敏感键提示词：键名（忽略大小写与下划线）命中即整键丢弃。"""

PAGE_CONTEXT_MAX_DEPTH: int = 4
"""嵌套结构的最大递归深度，超出后转为字符串摘要。"""

PAGE_CONTEXT_MAX_LIST_ITEMS: int = 50
"""列表值保留的最大元素个数。"""

_TRUNCATED_KEY: str = "_truncated"

# 值级掩码：身份证 → 银行卡 → 手机号（长号先掩，避免短号正则误吞）
_RE_IDCARD = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
_RE_BANKCARD = re.compile(r"(?<!\d)\d{16,19}(?!\d)")
_RE_MOBILE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_RE_NON_WORD = re.compile(r"[\s\W_]+", re.UNICODE)


def _mask_text(value: str) -> str:
    """对单个字符串做值级掩码（身份证 / 银行卡 / 手机号）。

    Args:
        value: 原始字符串。

    Returns:
        掩码后的字符串；无命中时原样返回。
    """
    masked = _RE_IDCARD.sub(lambda m: f"{m.group(0)[:6]}********{m.group(0)[-4:]}", value)
    masked = _RE_BANKCARD.sub(
        lambda m: f"{m.group(0)[:4]}{'*' * (len(m.group(0)) - 8)}{m.group(0)[-4:]}",
        masked,
    )
    masked = _RE_MOBILE.sub(lambda m: f"{m.group(0)[:3]}****{m.group(0)[-4:]}", masked)
    return masked


def _is_denied_key(key: Any) -> bool:
    """判断键名是否命中敏感提示词。

    Args:
        key: 原始键（任意类型，内部转字符串比较）。

    Returns:
        命中敏感提示词返回 True。
    """
    lowered = str(key).lower().replace("_", "").replace("-", "")
    return any(hint in lowered for hint in PAGE_CONTEXT_DENY_KEY_HINTS)


def _sanitize_value(value: Any, depth: int = 0) -> Any:
    """递归脱敏单个值：丢弃敏感子键 + 值级掩码 + 深度/长度收敛。

    Args:
        value: 任意 JSON 兼容值。
        depth: 当前递归深度。

    Returns:
        脱敏后的值。
    """
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _mask_text(value)
    if depth >= PAGE_CONTEXT_MAX_DEPTH:
        return _mask_text(str(value))
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if _is_denied_key(key):
                continue
            cleaned[str(key)] = _sanitize_value(item, depth + 1)
        return cleaned
    if isinstance(value, (list, tuple, set)):
        items = list(value)[:PAGE_CONTEXT_MAX_LIST_ITEMS]
        return [_sanitize_value(item, depth + 1) for item in items]
    return _mask_text(str(value))


def sanitize_page_context(
    raw: dict[str, Any] | None, *, max_chars: int = 1500
) -> dict[str, Any]:
    """按白名单裁剪 + 敏感键掩码 + 总长度截断，返回可安全下发的切片。

    处理顺序（design-impl.md §5·T01 要点 2）：
    白名单键裁剪 → 键名含敏感提示词则丢弃 → 值级正则掩码 → 序列化后总长截断。

    Args:
        raw: 原始页面上下文；`None` 或非 dict 时返回空字典。
        max_chars: 序列化后的最大字符数，超出部分整键丢弃并标记 ``_truncated``。

    Returns:
        脱敏后的页面上下文切片（键按字典序稳定排列）。
    """
    if not isinstance(raw, dict) or not raw:
        return {}

    # 1) 白名单裁剪 + 2) 敏感键丢弃 + 3) 值级掩码
    cleaned: dict[str, Any] = {}
    for key in sorted(raw.keys(), key=str):
        name = str(key)
        if name not in PAGE_CONTEXT_ALLOW_KEYS:
            continue
        if _is_denied_key(name):
            continue
        cleaned[name] = _sanitize_value(raw[key], 1)

    if not cleaned:
        return {}

    # 4) 总长度截断（按键整体丢弃，保证输出仍是合法 JSON 对象）
    limit = max(0, int(max_chars))
    result: dict[str, Any] = {}
    used = 2  # 预留 "{}" 两个字符
    truncated = False
    for name, value in cleaned.items():
        try:
            piece = json.dumps({name: value}, ensure_ascii=False)[1:-1]
        except (TypeError, ValueError):
            piece = f'"{name}":"<unserializable>"'
            value = "<unserializable>"
        cost = len(piece) + (1 if result else 0)
        if used + cost > limit:
            truncated = True
            continue
        result[name] = value
        used += cost

    if truncated:
        result[_TRUNCATED_KEY] = True
        logger.info(
            "page_context truncated",
            kept_keys=len(result) - 1,
            dropped_keys=len(cleaned) - (len(result) - 1),
            max_chars=limit,
        )
    return result


class TaskBriefInputs(BaseModel):
    """TaskBrief 的输入分片（对齐 spec.md §4.2）。"""

    model_config = ConfigDict(extra="ignore")

    user_question: str = Field(default="", description="用户原始问题（不改写语义）")
    page_context_slice: dict[str, Any] = Field(
        default_factory=dict, description="脱敏后的页面上下文切片，禁止整页倾倒"
    )
    attachments_text: str = Field(default="", description="附件抽取文本，可选")

    def is_empty(self) -> bool:
        """判断输入分片是否完全为空。

        Returns:
            三个字段均为空时返回 True。
        """
        return not (
            self.user_question.strip()
            or self.page_context_slice
            or self.attachments_text.strip()
        )


class TaskBrief(BaseModel):
    """自包含委派任务书（spec.md §4.2）。"""

    model_config = ConfigDict(extra="ignore")

    goal: str = Field(..., description="完整可执行目标")
    purpose: str = Field(default="", description="结果用途：直接回复用户/供填表/供下一步")
    inputs: TaskBriefInputs = Field(default_factory=TaskBriefInputs)
    constraints: list[str] = Field(default_factory=list, description="如禁止臆造、无命中须说明")
    identity: dict[str, str] = Field(
        default_factory=dict, description="userId/tenantId/channel，供 MCP 权限，不进用户可见原文"
    )
    expected_output: str = Field(default="", description="如 answer+citations / 结构化字段列表")

    def is_bare_text(self) -> bool:
        """判断是否为「纯文本回退」形态（只有 goal，其余皆空）。

        纯文本回退时 :meth:`render` 逐字返回 ``goal``，保证现网 LLM 传入的
        `content` 交付给 Worker 的内容**逐字节不变**（向后兼容红线）。

        Returns:
            仅 goal 有值时返回 True。
        """
        return (
            not self.purpose.strip()
            and self.inputs.is_empty()
            and not self.constraints
            and not self.expected_output.strip()
        )

    def render(self) -> str:
        """渲染为交付 Worker 的自包含提示文本（Markdown 分节，稳定顺序）。

        Note:
            `identity` **不进入**渲染正文（design-impl.md §7.3 硬约束），
            仅用于子会话身份透传，避免手机号等回显到 LLM 输出。

        Returns:
            Markdown 文本；纯文本回退形态下逐字返回 ``goal``。
        """
        goal = self.goal.strip()
        if self.is_bare_text():
            return goal

        sections: list[str] = [f"## 目标\n{goal}"]
        if self.purpose.strip():
            sections.append(f"## 用途\n{self.purpose.strip()}")
        if self.inputs.user_question.strip():
            sections.append(f"## 用户原问\n{self.inputs.user_question.strip()}")
        if self.inputs.page_context_slice:
            payload = json.dumps(
                self.inputs.page_context_slice, ensure_ascii=False, sort_keys=True
            )
            sections.append(f"## 页面上下文（已脱敏）\n```json\n{payload}\n```")
        if self.inputs.attachments_text.strip():
            sections.append(f"## 附件文本\n{self.inputs.attachments_text.strip()}")
        if self.constraints:
            bullets = "\n".join(f"- {c}" for c in self.constraints if str(c).strip())
            if bullets:
                sections.append(f"## 约束\n{bullets}")
        if self.expected_output.strip():
            sections.append(f"## 期望输出\n{self.expected_output.strip()}")
        return "\n\n".join(sections)


class BriefValidationError(BaseModel):
    """Brief 校验失败结果（用于生成给 LLM 的重写指引）。"""

    model_config = ConfigDict(extra="ignore")

    missing_fields: list[str] = Field(default_factory=list)
    reason: Literal["missing_goal", "too_short", "lazy_delegation", "empty_question"] = (
        "missing_goal"
    )
    rewrite_hint: str = ""

    def reason_text(self) -> str:
        """返回中文可读的拒绝原因。

        Returns:
            中文原因描述。
        """
        return _REASON_TEXT.get(self.reason, self.reason)

    def to_tool_output(self) -> str:
        """渲染为可被 LLM 直接消费的重写模板（含缺失清单 + 正确示例）。

        Returns:
            多行文本：拒绝原因 + 缺失字段 + 重写结构 + 一个正确示例。
        """
        missing = "、".join(self.missing_fields) if self.missing_fields else "goal"
        lines = [
            f"[任务书校验未通过] 原因：{self.reason_text()}",
            f"缺失或不合格字段：{missing}",
            "",
            "请不要重复原样调用。请按下列结构补全 task_brief 后重试：",
            _REWRITE_TEMPLATE,
            "",
            "正确示例：",
            _REWRITE_EXAMPLE,
        ]
        if self.rewrite_hint.strip():
            lines.extend(["", f"补充提示：{self.rewrite_hint.strip()}"])
        return "\n".join(lines)


_REASON_TEXT: dict[str, str] = {
    "missing_goal": "缺少可执行目标 goal",
    "too_short": f"目标过短（少于 {MIN_BRIEF_CHARS} 字），无法自包含执行",
    "lazy_delegation": "懒委托：只给了指代性口令，未给出完整任务目标",
    "empty_question": "既无目标 goal 也无用户原问 user_question",
}

_REWRITE_TEMPLATE: str = (
    '{\n'
    '  "goal": "<完整可执行目标：动作 + 对象 + 判定标准，不使用「你的发现」等指代>",\n'
    '  "purpose": "直接回复用户 | 供填表 | 供下一步",\n'
    '  "inputs": {\n'
    '    "user_question": "<用户原始问题原文，不改写语义>",\n'
    '    "page_context_slice": {},\n'
    '    "attachments_text": ""\n'
    '  },\n'
    '  "constraints": ["无命中须如实说明", "禁止臆造业务数据"],\n'
    '  "expected_output": "<如 answer+citations / 结构化字段列表>"\n'
    '}'
)

_REWRITE_EXAMPLE: str = (
    '{"goal": "检索差旅报销标准并给出条款依据", '
    '"purpose": "直接回复用户", '
    '"inputs": {"user_question": "差旅报销制度怎么规定？"}, '
    '"constraints": ["无命中须如实说明"], '
    '"expected_output": "answer+citations"}'
)


def _first_str(data: dict[str, Any], *keys: str) -> str:
    """从字典中按顺序取第一个非空字符串值。

    Args:
        data: 源字典。
        *keys: 候选键，按优先级排列。

    Returns:
        命中的字符串（已 strip）；均未命中时返回空串。
    """
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _first_dict(data: dict[str, Any], *keys: str) -> dict[str, Any]:
    """从字典中按顺序取第一个非空字典值。

    Args:
        data: 源字典。
        *keys: 候选键，按优先级排列。

    Returns:
        命中的字典；均未命中时返回空字典。
    """
    for key in keys:
        value = data.get(key)
        if isinstance(value, dict) and value:
            return value
    return {}


def is_lazy_delegation(text: str) -> bool:
    """判断文本是否为懒委托口令。

    判据：命中 :data:`LAZY_PATTERNS` 中任一模式，且剔除口令后的剩余实词
    少于 :data:`LAZY_RESIDUE_MIN_CHARS` 个字符。

    Args:
        text: 待判定文本。

    Returns:
        判定为懒委托时返回 True。
    """
    stripped = (text or "").strip()
    if not stripped:
        return False
    residue = stripped
    hit = False
    for pattern in LAZY_PATTERNS:
        if pattern in residue:
            hit = True
            residue = residue.replace(pattern, "")
    if not hit:
        return False
    return len(_RE_NON_WORD.sub("", residue)) < LAZY_RESIDUE_MIN_CHARS


class TaskBriefBuilder:
    """从工具入参构造 TaskBrief：结构化优先，纯文本回退。"""

    def build(
        self,
        *,
        task_brief: dict[str, Any] | None,
        content: str,
        metadata: dict[str, Any],
        identity: dict[str, str],
        worker_spec: "WorkerSpec | None" = None,
        strict: bool = True,
    ) -> tuple[TaskBrief | None, BriefValidationError | None]:
        """返回 (brief, None) 或 (None, error)；两者必有其一。

        Args:
            task_brief: LLM 传入的结构化任务书（优先）；`None` 时走纯文本回退。
            content: 兼容模式的纯文本任务描述。
            metadata: 工具入参携带的元数据（page_context / user_question 等）。
            identity: 身份信息（userId/channel/...），只进 `identity` 段。
            worker_spec: 目标 Worker 契约；用于补齐 `expected_output` 等默认值。
            strict: `True`（默认）时校验不通过即返回 error；`False` 时降级为
                只记 warning 并放行（对应 `TASK_BRIEF_STRICT=False` 灰度开关）。

        Returns:
            二元组 `(brief, error)`：成功时 `error` 为 `None`；
            严格模式下校验失败时 `brief` 为 `None`。
        """
        meta = metadata if isinstance(metadata, dict) else {}
        brief = (
            self._from_structured(task_brief, meta, worker_spec)
            if isinstance(task_brief, dict) and task_brief
            else self._parse_from_text(content, meta, worker_spec)
        )
        brief.identity = {str(k): str(v) for k, v in (identity or {}).items() if v}

        error = self._validate(brief)
        if error is None:
            return brief, None

        if strict:
            logger.info(
                "task brief rejected",
                reason=error.reason,
                missing_fields=error.missing_fields,
                worker_id=getattr(worker_spec, "agent_id", ""),
            )
            return None, error

        logger.warning(
            "task brief degraded (TASK_BRIEF_STRICT disabled)",
            reason=error.reason,
            missing_fields=error.missing_fields,
            worker_id=getattr(worker_spec, "agent_id", ""),
        )
        return brief, None

    # ===== 内部实现 =====

    def _from_structured(
        self,
        payload: dict[str, Any],
        metadata: dict[str, Any],
        worker_spec: "WorkerSpec | None",
    ) -> TaskBrief:
        """从结构化入参构造 TaskBrief（脱敏 page_context 并补默认值）。

        Args:
            payload: LLM 传入的 task_brief 字典。
            metadata: 工具元数据，用于补齐缺失的 user_question / page_context。
            worker_spec: 目标 Worker 契约。

        Returns:
            构造好的 TaskBrief（未做合法性校验）。
        """
        data = dict(payload)
        raw_inputs = data.get("inputs")
        inputs_data: dict[str, Any] = dict(raw_inputs) if isinstance(raw_inputs, dict) else {}

        user_question = _first_str(inputs_data, "user_question", "userQuestion", "question")
        if not user_question:
            user_question = _first_str(metadata, "user_question", "userQuestion", "question")

        raw_context = _first_dict(inputs_data, "page_context_slice", "pageContextSlice")
        if not raw_context:
            raw_context = _first_dict(metadata, "page_context", "pageContext")

        attachments = _first_str(inputs_data, "attachments_text", "attachmentsText")
        if not attachments:
            attachments = _first_str(metadata, "attachments_text", "attachmentsText")

        constraints_raw = data.get("constraints")
        constraints = (
            [str(c).strip() for c in constraints_raw if str(c).strip()]
            if isinstance(constraints_raw, list)
            else []
        )

        brief = TaskBrief(
            goal=str(data.get("goal") or "").strip(),
            purpose=str(data.get("purpose") or "").strip(),
            inputs=TaskBriefInputs(
                user_question=user_question,
                page_context_slice=sanitize_page_context(raw_context),
                attachments_text=attachments,
            ),
            constraints=constraints,
            expected_output=str(data.get("expected_output") or "").strip(),
        )
        return self._apply_worker_defaults(brief, worker_spec)

    def _parse_from_text(
        self,
        content: str,
        metadata: dict[str, Any],
        worker_spec: "WorkerSpec | None",
    ) -> TaskBrief:
        """纯文本回退：`content` 整体作为 goal，从 metadata 提取 user_question。

        Args:
            content: 纯文本任务描述。
            metadata: 工具元数据。
            worker_spec: 目标 Worker 契约。

        Returns:
            构造好的 TaskBrief（未做合法性校验）。
        """
        goal = (content or "").strip()
        user_question = _first_str(metadata, "user_question", "userQuestion", "question")
        raw_context = _first_dict(metadata, "page_context", "pageContext")
        attachments = _first_str(metadata, "attachments_text", "attachmentsText")

        brief = TaskBrief(
            goal=goal,
            inputs=TaskBriefInputs(
                user_question=user_question,
                page_context_slice=sanitize_page_context(raw_context),
                attachments_text=attachments,
            ),
        )
        return self._apply_worker_defaults(brief, worker_spec)

    @staticmethod
    def _apply_worker_defaults(
        brief: TaskBrief, worker_spec: "WorkerSpec | None"
    ) -> TaskBrief:
        """用 Worker 契约补齐 `expected_output`（仅在 Catalog 可用时生效）。

        Args:
            brief: 待补齐的任务书。
            worker_spec: 目标 Worker 契约；`None` 时原样返回（保证无 Catalog
                注入的既有行为逐字节不变）。

        Returns:
            补齐后的任务书。
        """
        if worker_spec is None:
            return brief
        if not brief.expected_output.strip():
            brief.expected_output = (worker_spec.output_contract or "").strip()
        return brief

    @staticmethod
    def _validate(brief: TaskBrief) -> BriefValidationError | None:
        """校验任务书是否构成一次「真委派」（design-impl.md §1.4）。

        Args:
            brief: 待校验任务书。

        Returns:
            合格时返回 `None`，否则返回 :class:`BriefValidationError`。
        """
        goal = brief.goal.strip()
        question = brief.inputs.user_question.strip()

        if not goal and not question:
            return BriefValidationError(
                reason="empty_question",
                missing_fields=["goal", "inputs.user_question"],
                rewrite_hint="至少给出用户原始问题，并据此写出完整的 goal。",
            )
        if not goal:
            return BriefValidationError(
                reason="missing_goal",
                missing_fields=["goal"],
                rewrite_hint="用一句话写清「要做什么 + 对什么对象 + 判定标准」。",
            )
        if is_lazy_delegation(goal):
            return BriefValidationError(
                reason="lazy_delegation",
                missing_fields=["goal"],
                rewrite_hint="禁止使用「帮我查一下 / 根据你的发现 / 你看着办」等指代式口令。",
            )
        if len(goal) < MIN_BRIEF_CHARS:
            return BriefValidationError(
                reason="too_short",
                missing_fields=["goal"],
                rewrite_hint=f"goal 至少 {MIN_BRIEF_CHARS} 字，需自包含、可独立执行。",
            )
        return None
