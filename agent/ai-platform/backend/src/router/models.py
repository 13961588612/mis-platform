"""路由数据模型 — RouteResult、RouteLog、UserRequest、SessionContext。"""

from __future__ import annotations
from typing import Any

from datetime import datetime, timezone

from pydantic import BaseModel, Field


class UserRequest(BaseModel):
    """用户的传入请求，需要被路由到某个 Agent。"""

    text: str = Field(..., description="用户输入文本")
    user_id: str = Field(..., description="用户标识符")
    session_id: str = Field(..., description="会话标识符")
    channel: str = Field(default="web", description="来源渠道")
    department: str = Field(default="", description="用户所属部门")
    metadata: dict[str, Any] = Field(default_factory=dict)


class SessionContext(BaseModel):
    """用于路由决策的当前会话上下文。"""

    session_id: str
    user_id: str
    channel: str
    existing_agent_id: str | None = None
    message_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RouteResult(BaseModel):
    """路由决策的结果。"""

    agent_id: str = Field(..., description="匹配的 Agent ID")
    strategy_used: str = Field(..., description="产生匹配的策略")
    confidence: float = Field(default=0.0, description="置信度分数（0-1）")
    latency_ms: int = Field(default=0, description="路由延迟（毫秒）")
    metadata: dict[str, Any] = Field(default_factory=dict)


class RouteLog(BaseModel):
    """路由决策日志条目。"""

    id: str = Field(default="")
    session_id: str
    user_id: str
    input_text: str
    matched_agent_id: str
    strategy_used: str
    confidence: float = 0.0
    latency_ms: int = 0
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # 派生路由类型：coordinator_delegate→coordinator；user_specified→specified；其余→agent_router。
    # 由 query_logs 按 strategy_used 推导，便于前端按「类型」列 / 筛选区分。
    dispatch_kind: str | None = None


class RouteLogFilter(BaseModel):
    """查询路由日志的过滤条件。"""

    session_id: str | None = None
    user_id: str | None = None
    agent_id: str | None = None
    strategy: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    limit: int = 100
    offset: int = 0
    # 路由类型过滤：agent_router | coordinator | specified；不传=全部。
    kind: str | None = None


class RouteStats(BaseModel):
    """聚合的路由统计信息。"""

    total_routes: int = 0
    by_agent: dict[str, int] = Field(default_factory=dict)
    by_strategy: dict[str, int] = Field(default_factory=dict)
    # 派生路由类型计数：coordinator / specified / agent_router（由 strategy_used 推导）。
    by_kind: dict[str, int] = Field(default_factory=dict)
    avg_latency_ms: float = 0.0
    avg_confidence: float = 0.0


class AgentScore(BaseModel):
    """来自语义搜索的 Agent 候选及其相似度分数。"""

    agent_id: str
    score: float
    description: str = ""
    tags: list[str] = Field(default_factory=list)
