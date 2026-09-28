"""IQD 行级范围「按身份真实预览」路由（2026-09-28 新增）。

补上设计稿遗留的偏差 6：范围页的「模拟角色 WHERE 片段预览」此前**无后端接口**，
前端只能按 `row_scope` 模板 + 维度注册表推导示意串（恒标 `degraded`）。但谓词真实形态
由 `ScopeResolver._build_authorized_predicate` 决定（PATH_PREFIX → 字典表 EXISTS；
ENUM → IN），前端推导与实际注入**必然不一致**。

本路由复用**同一套构造逻辑**，因此预览与真实注入逐字一致。

- ``POST /iqd/scope/preview`` body ``{connection_id?, role_code?, item_key?, headers?}``
  → ``{items:[{item_key, dimensions, predicates, where, strategy, denied_reason}],
       degraded:false, note, subject}``

身份来源：① body.headers（BFF 透传的 X-Mis-* 原始头，真实身份）；② body.role_code 非空时
按**模拟角色**覆写（与问数 `simulate_role_code` 同一路径，不放大权限由 resolve_effective
保证——预览用 `resolve` + 覆写后的身份，与问数注入同源）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, Field

from src.agent.mis_iqd.scope_resolver import AskIdentity, ScopeResolver
from src.api.deps import get_current_user, get_trace_id
from src.api.response import error_response, success
from src.utils.logging import get_logger

logger = get_logger("api.routes.iqd_scope_preview")

router = APIRouter(prefix="/iqd/scope", tags=["iqd-scope-preview"])


class ScopePreviewRequest(BaseModel):
    """行级谓词预览请求体（BFF → ai-platform）。

    Attributes:
        connection_id: 问数连接 id（缺省取 enabled）。
        role_code: 模拟角色码；非空时覆写身份 role_codes（后台测试页「换成某角色看范围」）。
        item_key: 只看某张表；缺省返回全部命中表。
        headers: BFF 透传的 X-Mis-* 头（真实身份取值源）。
    """

    connection_id: int | None = Field(default=None, description="问数连接 id（缺省取 enabled）")
    role_code: str | None = Field(default=None, description="模拟角色码（可空）")
    item_key: str | None = Field(default=None, description="只看某张表（catalog item_key / 表名）")
    headers: dict[str, str] = Field(default_factory=dict, description="X-Mis-* 原始头")
    draft_rules: list[dict[str, Any]] | None = Field(
        default=None,
        description="草稿规则 [{item_key, row_scope}]；非空时按草稿预览（不查库）",
    )
    samples: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description="逐维度示意实参 {dimension: {path?, values?}}",
    )


@router.post("/preview")
async def preview_row_scope(
    req: ScopePreviewRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    trace_id: str = Depends(get_trace_id),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    """按身份（可含模拟角色）真实生成行级谓词预览。

    Returns:
        ``{code:0, data:{items, degraded:false, note, subject, connection_id}}``。
    """
    try:
        identity = AskIdentity.from_headers(req.headers or {})
        # 模拟角色：与 tools._build_identity 同一路径（覆写 role_codes，保留真实 user_id）
        if req.role_code and req.role_code.strip():
            identity = identity.with_simulated_role(req.role_code.strip())
        resolver = ScopeResolver()
        data = await resolver.preview_row_scope(
            identity,
            req.connection_id,
            item_key=req.item_key,
            draft_rules=req.draft_rules,
            samples=req.samples,
        )
        return success(data=data, message="ok", trace_id=trace_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("IQD scope preview failed", error=str(exc))
        return error_response(
            code=9000,
            message=f"行级范围预览失败: {exc}",
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            trace_id=trace_id,
        )
