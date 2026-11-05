"""意图预路由配置与决策结果。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


WhenType = Literal["keyword", "regex", "jev", "always"]
#: rules=仅规则；model=仅 JEV；rules_then_model=关键词/正则先命中则直出，否则再 JEV
EngineType = Literal["rules", "model", "rules_then_model", "off"]
OnFailType = Literal["fallback_router_skill", "fallback_primary", "none"]


class IntentWhen(BaseModel):
    """单条规则的匹配条件。"""

    type: WhenType = "keyword"
    #: keyword：任一命中即可
    any: list[str] = Field(default_factory=list)
    #: keyword：全部命中才可（可选）
    all: list[str] = Field(default_factory=list)
    #: regex：任一正则命中
    patterns: list[str] = Field(default_factory=list)
    #: jev：标签 id → 描述；模型只返回一个标签
    labels: dict[str, str] = Field(default_factory=dict)
    #: jev：期望命中的标签 id
    match_label: str = ""
    case_sensitive: bool = False


class IntentThen(BaseModel):
    """匹配成功后的动作。"""

    #: Worker：下一步应 skill() 的 router skill_id
    router_skill: str = ""
    #: Coordinator（engine=model 或规则映射 Worker）：目标 worker / intent
    worker_id: str = ""
    intent: str = ""
    #: 给 JEV 的标签说明（触发语/边界）；空则回退 intent / worker_id
    description: str = ""


class IntentRule(BaseModel):
    """一条规则；按列表顺序求值，命中即停。"""

    id: str = ""
    when: IntentWhen = Field(default_factory=IntentWhen)
    then: IntentThen = Field(default_factory=IntentThen)


class IntentRouterModelRef(BaseModel):
    """JEV / 意图检测模型引用（覆盖平台 .env 默认）。"""

    name: str = ""
    #: 可选覆盖；空则用 INTENT_DETECT_ENDPOINT
    endpoint: str = ""
    timeout_ms: int = 2000
    mode: Literal["intent_only"] = "intent_only"


class IntentRouterConfig(BaseModel):
    """Agent 级意图预路由配置（``intent-router.yaml``）。"""

    enabled: bool = False
    engine: EngineType = "rules"
    model: IntentRouterModelRef = Field(default_factory=IntentRouterModelRef)
    #: 规则列表（engine=rules）；步骤 when.type=jev 时该步调用意图模型
    rules: list[IntentRule] = Field(default_factory=list)
    #: Coordinator engine=model：标签 → worker / intent
    labels: dict[str, IntentThen] = Field(default_factory=dict)
    on_fail: OnFailType = "fallback_router_skill"
    fallback_router_skill: str = ""
    #: JEV 携带最近几轮对话（一轮≈user+assistant）；0=不带上文
    max_context_turns: int = Field(default=3, ge=0, le=20)
    #: JEV 上文单条截断长度（助手长表不灌满意图模型）
    max_context_msg_chars: int = Field(default=240, ge=40, le=2000)
    #: decision-model 置信度下限；>0 且低于此值视为未命中（走 on_fail）
    min_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    #: 未命中时是否仍提示主模型自行判断（仅日志/观测语义）
    notes: str = ""


class IntentRouteDecision(BaseModel):
    """一次预路由决策结果。"""

    enabled: bool
    engine: str
    matched_rule_id: str | None = None
    router_skill: str | None = None
    worker_id: str | None = None
    intent: str | None = None
    used_jev: bool = False
    latency_ms: int = 0
    detail: str = ""
    raw: dict[str, Any] = Field(default_factory=dict)


class TemplateReportItem(BaseModel):
    """参与模板报告决策的一份报告。"""

    code: str = Field(..., min_length=1)
    title: str = ""
    description: str = ""


class TemplateReportModelRef(BaseModel):
    """决策模型引用（可覆盖平台 DECISION_MODEL_*）。"""

    name: str = ""
    endpoint: str = ""
    timeout_ms: int = 2000


class TemplateReportRouterConfig(BaseModel):
    """Agent 级模板报告预路由（``template-report-router.yaml``）。

    标签优先来自 mis-ai-template-report catalog；``reports`` 仅作本地兜底；
    ``participate_codes`` 非空时只让这些 code 参与决策。
    """

    enabled: bool = False
    min_confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    max_context_turns: int = Field(default=3, ge=0, le=20)
    max_context_msg_chars: int = Field(default=160, ge=40, le=2000)
    model: TemplateReportModelRef = Field(default_factory=TemplateReportModelRef)
    #: 参与决策的 report_code；空 = catalog（或 reports）全部参与
    participate_codes: list[str] = Field(default_factory=list)
    #: 覆盖 catalog 描述（决策 criteria 文案）
    description_overrides: dict[str, str] = Field(default_factory=dict)
    #: 本地兜底报告列表（catalog 不可用时）
    reports: list[TemplateReportItem] = Field(default_factory=list)


class TemplateReportDecision(BaseModel):
    """模板报告决策结果；``report_code`` 非空表示命中。"""

    enabled: bool
    report_code: str | None = None
    title: str | None = None
    confidence: float | None = None
    used_model: bool = False
    latency_ms: int = 0
    detail: str = ""
    raw: dict[str, Any] = Field(default_factory=dict)
