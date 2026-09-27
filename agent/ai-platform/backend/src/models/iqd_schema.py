"""问数（mis-iqd）三端同构 DTO（Pydantic，wire 一律 snake_case）。

本模块是「Python / BFF(Java) / 前端」三端 DTO 契约的 **Python 侧源头**
（architecture §4.3 / §7.6）：字段名与语义严格对齐 ``backend/mis-admin-bff/
dto/iqd/*.java`` 与前端 ``features/agent/iqd/types.ts``，禁止凭设计文档臆造字段。

仅 DTO、无 ORM —— 问数配置已落 ``mis_platform.iqd_*``（Java mis-iqd 管理），
本模块只承载**问数请求/响应/引用/计划步骤**的 wire 形态。

安全约束（view 分支）：
- ``view=admin`` 才带 ``sql`` / ``sql_dialect`` / ``plan[].sql``；
- ``view=user`` 由 :class:`~src.agent.mis_iqd.projector.ResponseProjector._strip_sql`
  服务端**删键**（不是置空），本模块不在此做默认剔除（投影是可见性，审计留全量）。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ===== 常量（与架构 §4.3 / §7.3 对齐）=====

VIEW_USER: Literal["user"] = "user"
VIEW_ADMIN: Literal["admin"] = "admin"
ViewMode = Literal["user", "admin"]

PLAN_STATUS_RUNNING = "running"
PLAN_STATUS_DONE = "done"
PLAN_STATUS_SKIPPED = "skipped"
PLAN_STATUS_FAILED = "failed"
PlanStatus = Literal["running", "done", "skipped", "failed"]

RESULT_STATUS_SUCCEEDED = "succeeded"
RESULT_STATUS_FAILED = "failed"
RESULT_STATUS_PARTIAL = "partial"
RESULT_STATUS_UNSUPPORTED = "unsupported"
ResultStatus = Literal["succeeded", "failed", "partial", "unsupported"]

#: 结果集硬上限（architecture §7.9）：1000 行 / 50 列
ROW_LIMIT = 1000
COLUMN_LIMIT = 50


# ===== 请求 =====


class AskRequest(BaseModel):
    """用户端/后台问数请求体（POST /api/v1/iqd/ask-stream）。"""

    model_config = ConfigDict(extra="ignore")

    question: str = Field(..., min_length=1, description="用户原始问题（不改写语义）")
    session_id: str | None = Field(default=None, description="MIS 会话 ID（多轮上下文）")
    thread_id: str | None = Field(default=None, description="WrenAI 侧线程（追问）")
    connection_id: int | None = Field(default=None, description="缺省取 enabled 连接")
    view: ViewMode = Field(default="user", description="建议值；服务端按权限码最终裁定")
    simulate_role_code: str | None = Field(
        default=None, description="仅后台测试页，需 iqd:test:use"
    )
    scope_hint: list[str] = Field(
        default_factory=list, description="后台测试页限定表集合（item_key）"
    )


# ===== 响应片段 =====


class ColumnMeta(BaseModel):
    """结果集列元信息（data.columns）。"""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(default="", description="列名")
    item_key: str = Field(default="", description="语义键（表键/字段键/mdl 键）")
    data_type: str = Field(default="", description="数据类型")
    display_name: str = Field(default="", description="展示名")
    masked: bool = Field(default=False, description="是否已脱敏")


class ResultData(BaseModel):
    """问数结果集（data）。"""

    model_config = ConfigDict(extra="ignore")

    columns: list[ColumnMeta] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    row_count: int = Field(default=0)
    truncated: bool = Field(default=False, description="超出 1000 行/50 列上限时置 true")


class Citation(BaseModel):
    """引用来源（citations[]）。"""

    model_config = ConfigDict(extra="ignore")

    kind: Literal["table", "column", "model", "metric", "dimension", "knowledge"] = Field(
        default="table", description="引用种类"
    )
    item_key: str = Field(default="", description="跨表 JOIN 键（大小写敏感）")
    display_name: str = Field(default="", description="展示名")
    description: str | None = Field(default=None)
    snippet: str | None = Field(default=None, description="知识片段正文")
    source_ref: str | None = Field(default=None, description="如 iqd_knowledge:uuid")


class PlanStep(BaseModel):
    """执行计划步骤（plan[]）。"""

    model_config = ConfigDict(extra="ignore")

    seq: int = Field(default=0)
    code: str = Field(default="", description="阶段码：scope_check/understanding/...")
    label: str = Field(default="", description="中文步骤名")
    detail: str | None = Field(default=None)
    sql: str | None = Field(default=None, description="仅 view=admin 保留；user 删键")
    status: PlanStatus = Field(default="running")
    duration_ms: int = Field(default=0)


class ScopeResolutionPayload(BaseModel):
    """范围裁定结果（scope）。"""

    model_config = ConfigDict(extra="ignore")

    decision: Literal["allow", "deny", "partial"] = Field(default="allow")
    allowed_item_keys: list[str] = Field(default_factory=list)
    denied_item_keys: list[str] = Field(default_factory=list)
    reason: str | None = Field(default=None)
    subject_summary: str = Field(default="", description="如 role:SALES_MANAGER")


class AskResponse(BaseModel):
    """问数响应（data 段；SSE result 帧即此完整体）。"""

    model_config = ConfigDict(extra="ignore")

    query_id: str = Field(default="")
    thread_id: str | None = Field(default=None)
    agent_id: str = Field(default="mis-iqd", description="回答智能体标识（展示型元数据，路由归属）")
    status: ResultStatus = Field(default="succeeded")
    answer_summary: str = Field(default="")
    sql: str | None = Field(default=None, description="view=admin 才有；user 删键")
    sql_dialect: str | None = Field(default=None)
    data: ResultData = Field(default_factory=ResultData)
    citations: list[Citation] = Field(default_factory=list)
    plan: list[PlanStep] = Field(default_factory=list)
    scope: ScopeResolutionPayload = Field(default_factory=ScopeResolutionPayload)
    masked_columns: list[str] = Field(default_factory=list)
    latency_ms: int = Field(default=0)
    error_code: str | None = Field(default=None)
    error_message: str | None = Field(default=None)
    nl2sql_debug: dict[str, Any] | None = Field(
        default=None,
        description="admin 视图：NL→SQL 的 LLM 入参/出参（user 投影时删除）",
    )

    def to_wire(self) -> dict[str, Any]:
        """序列化为 wire snake_case 字典（保持字段原样，不做 key 转换）。"""
        return self.model_dump(mode="json", by_alias=True, exclude_none=False)


# ===== 连接配置 =====


class ConnectionConfig(BaseModel):
    """连接配置（GET/PUT /config，密钥恒回 ******）。"""

    model_config = ConfigDict(extra="ignore")

    id: int | None = Field(default=None)
    name: str = Field(default="", description="profile 名/连接标识")
    base_url: str | None = Field(default=None)
    auth_type: str = Field(default="none", description="api_key | bearer | none")
    secret_ref: str | None = Field(default=None)
    project_id: str | None = Field(default=None)
    default_connector: str | None = Field(default=None)
    timeout_seconds: int = Field(default=60)
    language: str = Field(default="zh-CN")
    status: str = Field(default="inactive", description="active | inactive | error")
    last_health_at: str | None = Field(default=None)
    last_health_msg: str | None = Field(default=None)
    enabled: bool = Field(default=True)


class ConnectionConfigSave(BaseModel):
    """保存连接配置请求（PUT /config）。"""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(default="", min_length=1)
    base_url: str | None = Field(default=None)
    auth_type: str = Field(default="none")
    secret_ref: str | None = Field(default=None, description="提交非空才更新；空=保留原值")
    project_id: str | None = Field(default=None)
    default_connector: str | None = Field(default=None)
    timeout_seconds: int = Field(default=60, ge=1, le=600)
    language: str = Field(default="zh-CN")
    enabled: bool = Field(default=True)


# ===== 行级范围（W2，v1.9 维度注册表驱动）=====


class RowScopeDimensionInstance(BaseModel):
    """行级范围单维度实例（``row_scope`` 单维度对象或 ``dimensions`` 数组元素）。

    引用维度注册表 ``iqd_row_scope_dimension.dimension_code``（dept / store / ...）。
    自动模式（auto_mode=true）时无需手动参数；手动模式参数来源由注册表
    ``param_whitelist`` 约束。
    """

    model_config = ConfigDict(extra="ignore")

    dimension: str = Field(default="", description="维度码（dept / store / ...）")
    column: str | None = Field(default=None, description="业务表条件列（可空，缺省取注册表）")
    scope: str = Field(default="dept_subtree", description="范围语义：dept_subtree | self | all")
    mode: str = Field(default="auto", description="auto | manual")
    params: dict[str, Any] = Field(default_factory=dict, description="手动模板参数（白名单内）")


class RowScopeConfig(BaseModel):
    """表级行级范围配置（``IqdTableAcl.row_scope`` JSONB 语义，v1.9）。

    支持单维度对象（``dimension``）与多维度数组（``dimensions`` AND 叠加）；
    ``None`` = 全行可见（向后兼容）。
    """

    model_config = ConfigDict(extra="ignore")

    dimension: RowScopeDimensionInstance | None = Field(default=None)
    dimensions: list[RowScopeDimensionInstance] = Field(default_factory=list)


class RowScopeDimension(BaseModel):
    """行级范围维度注册表条目（mis-iqd iqd_row_scope_dimension wire 同构）。

    供 Worker 侧 scope_resolver 读取维度注册表（经 IqdConfigClient get-dimensions 缓存）。
    """

    model_config = ConfigDict(extra="ignore")

    dimension_code: str = Field(default="")
    dimension_name: str = Field(default="")
    predicate_type: str = Field(default="PATH_PREFIX", description="PATH_PREFIX | ENUM")
    column_name: str = Field(default="")
    header_name: str = Field(default="")
    param_whitelist: list[str] = Field(default_factory=list)
    dict_table: str | None = Field(default=None)
    auto_mode: bool = Field(default=True)
    enabled: bool = Field(default=True)
    sort: int = Field(default=0)
