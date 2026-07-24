"""
身份与访问管理子系统的 Pydantic 模型。

定义 UserContext（传递给 SkillRanker /
PermissionEngine 的运行时内存表示）、Role、Department、Org 以及各种请求/响应 DTO。

本文件在阶段1+2 基础上叠加「身份 enrichment」增量（路线 B：瘦 MIS JWT + BFF 注入
X-Mis-* 头；详见 docs/identity-enrichment-task-list.md）：
- UserContext 演进为多部门 / 多组织 / 多角色（全部带默认值，零回归）。
- build_user_context(mis_payload, mis_headers, resolver) 取代原单值映射；
  build_user_context_from_mis 保留为薄包装以兼容既有调用与测试。
- 仅依赖 CategoryResolver 协议类型，具体解析实现位于 permissions.py，
  本文件不得 import permissions.py（避免环依赖）。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from src.identity.mis_token import MisTokenPayload


class UserContext(BaseModel):
    """权限引擎使用的轻量级运行时用户上下文。

    这不是数据库模型 — 它是一个非规范化的投影，
    仅包含权限检查和 Skill 排序所需的字段。
    """

    user_id: str
    username: str
    display_name: str = ""

    # —— 旧字段（@deprecated，保留兼容，勿在新逻辑读取）——
    department: str = ""  # deprecated → 用 departments
    dept_id: str | None = None  # deprecated → 用 departments / primary_department_id

    # —— 新：多部门 / 多组织 / 多角色（全部带默认值，零回归）——
    departments: list[DepartmentInfo] = Field(default_factory=list)
    primary_department_id: str | None = None
    organizations: list[OrgInfo] = Field(default_factory=list)
    primary_org_id: str | None = None
    role_infos: list[RoleInfo] = Field(default_factory=list)  # 可选明细

    # —— 既有字段（不变）——
    roles: list[str] = Field(default_factory=list)  # role codes
    channel: str = "wecom_h5"
    # 此用户可以访问的 Skill 分类（角色 + 部门的并集，去重）
    allowed_categories: list[str] = Field(default_factory=list)
    # Skill 级别的覆盖
    skill_allow_list: list[str] = Field(default_factory=list)
    skill_deny_list: list[str] = Field(default_factory=list)
    # 用户是否可以批准敏感操作
    can_approve: bool = False
    profile: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# 身份 enrichment 协议与数据类（T2）
# ---------------------------------------------------------------------------
# 审批部门白名单（R2）：命中任一部门即视为可审批。由平台目录装载填充，
# 默认空集合 → can_approve 退化为 False。
APPROVAL_DEPT_IDS: set[str] = set()


@runtime_checkable
class CategoryResolver(Protocol):
    """身份分类解析协议。

    将部门 id / 角色 code / 组织 id 解析为带 ``allowed_categories`` 的明细
    （DepartmentInfo / RoleInfo / OrgInfo）。``models.py`` 仅依赖此协议类型，
    具体实现（PermissionEngineCategoryResolver）位于 ``permissions.py``，
    以避免 ``models.py`` 反向 import ``permissions.py`` 形成环依赖。
    """

    def resolve(
        self,
        dept_ids: list[str],
        role_codes: list[str],
        org_ids: list[str],
    ) -> "ResolvedIdentity":
        """根据部门 id、角色 code、组织 id 解析出多值身份明细与合并后的分类/审批权。"""
        ...


@dataclass
class ResolvedIdentity:
    """``CategoryResolver.resolve`` 的返回：已解析的多值身份明细。"""

    departments: list[DepartmentInfo] = field(default_factory=list)
    role_infos: list[RoleInfo] = field(default_factory=list)
    organizations: list[OrgInfo] = field(default_factory=list)
    allowed_categories: list[str] = field(default_factory=list)
    can_approve: bool = False


def _dedupe(items: list[str]) -> list[str]:
    """保序去重。"""
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        if it not in seen:
            seen.add(it)
            out.append(it)
    return out


def _extract_ids(raw: str | None) -> list[str]:
    """从 X-Mis-Depts / X-Mis-Orgs 头值（JSON 数组，元素为 {id} 或字符串）提取 id 列表。

    元素支持 ``{"id": "..."}`` 或裸字符串；``id`` 缺失时回退 ``code`` / ``deptId``。
    """
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        # 容错：退化为逗号分隔
        return [s.strip() for s in raw.split(",") if s.strip()]
    if not isinstance(items, list):
        return []
    ids: list[str] = []
    for it in items:
        if isinstance(it, str):
            ids.append(it)
        elif isinstance(it, dict):
            val = it.get("id") or it.get("code") or it.get("deptId")
            if val is not None:
                ids.append(str(val))
    return ids


def _extract_role_codes(raw: str | None) -> list[str]:
    """从 X-Mis-Roles 头值提取 role code 列表（code 为主键，回退 id）。"""
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return [s.strip() for s in raw.split(",") if s.strip()]
    if not isinstance(items, list):
        return []
    codes: list[str] = []
    for it in items:
        if isinstance(it, str):
            codes.append(it)
        elif isinstance(it, dict):
            val = it.get("code") or it.get("id")
            if val is not None:
                codes.append(str(val))
    return codes


def _parse_dept_entries(
    raw: str | None,
) -> list[tuple[str, str | None]]:
    """解析 X-Mis-Depts 头值 → ``(dept_id, org_id)`` 列表（T6）。

    元素支持 ``{"id": "...", "name"? , "orgId"?: "..."}`` 或裸字符串；
    ``orgId`` 优先，其次 ``org_id``，缺失则回填 ``None``，
    后续由 :func:`build_user_context` 回落到 ``primary_org_id``。
    同时兼容现有只含 ``id`` / ``name`` 的条目（org_id 为 None）。
    """
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        # 容错：退化为逗号分隔（裸字符串，无 org 信息）
        return [(s.strip(), None) for s in raw.split(",") if s.strip()]
    if not isinstance(items, list):
        return []
    entries: list[tuple[str, str | None]] = []
    for it in items:
        if isinstance(it, str):
            entries.append((it, None))
        elif isinstance(it, dict):
            val = it.get("id") or it.get("code") or it.get("deptId")
            if val is None:
                continue
            org_val = it.get("orgId") or it.get("org_id")
            org_id = str(org_val) if org_val is not None else None
            entries.append((str(val), org_id))
    return entries


def _parse_mis_headers(
    mis_headers: dict[str, str] | None,
) -> tuple[list[tuple[str, str | None]], list[str], list[str]]:
    """解析 X-Mis-* 头字典 → (dept_entries, org_ids, role_codes)。

    ``dept_entries`` 为 ``(dept_id, org_id)`` 元组列表（T6），保留条目内组织归属。
    """
    if not mis_headers:
        return [], [], []
    norm = {k.lower(): v for k, v in mis_headers.items()}
    dept_entries = _parse_dept_entries(norm.get("x-mis-depts"))
    org_ids = _extract_ids(norm.get("x-mis-orgs"))
    role_codes = _extract_role_codes(norm.get("x-mis-roles"))
    return dept_entries, org_ids, role_codes


def build_user_context(
    p: "MisTokenPayload",
    mis_headers: dict[str, str] | None = None,
    resolver: "CategoryResolver | None" = None,
) -> "UserContext":
    """MIS JWT + X-Mis-* 头 → 多值 UserContext（身份 enrichment 增量，T2/T5）。

    映射规则见设计 §1.3 + 任务列表 §3：
    - ``employeeId`` → ``user_id``；``username`` → ``username`` / ``display_name``
    - ``tenantId`` / ``appId`` / ``userId`` / ``employeeId`` / ``permVersion`` / ``iss`` → ``profile``
    - ``channel="mis_bff"``

    多值字段填充：
    - ``mis_headers=None`` 或 ``resolver=None`` → 退化为阶段1/2 行为
      （departments=[]、organizations=[]、role_infos=[]、allowed_categories=[]），
      保证既有 148 测试零改动通过。
    - 头存在且 resolver 存在 → 解析 X-Mis-Depts/Orgs/Roles 的 id/code，
      经 resolver 展开为带 allowed_categories 的 DepartmentInfo/RoleInfo/OrgInfo；
      allowed_categories = ∪(departments.allowed_categories) ∪(role_infos.allowed_categories) 去重；
      can_approve = any(role_infos.can_approve) or any(dept_id in APPROVAL_DEPT_IDS)。
    - 每个 DepartmentInfo 额外标注 org_id（T6）：条目自带 orgId 时采用，
      否则回落到 primary_org_id，表达「组织 ⊃ 部门」层级；无组织时 org_id 为 None（不崩）。

    兼容性（过渡期）：仍写回 ``dept_id = primary_department_id``、
    ``roles = role codes 列表（X-Mis-Roles 优先，缺省回落 JWT roles）``，
    供现有 PermissionEngine 单值路径继续工作。

    Args:
        p: 经 :class:`~src.identity.mis_token.MisTokenVerifier` 验签后的声明。
        mis_headers: 由 BFF 注入的 X-Mis-* 头原始值字典（可选）。
        resolver: 身份分类解析器（将 dept/role/org id 展开为分类明细）。

    Returns:
        平台权限引擎使用的多值 ``UserContext``。
    """
    dept_entries, org_ids, role_codes = _parse_mis_headers(mis_headers)
    # resolver 只消费 dept_id 列表（保持 CategoryResolver 协议不变）
    dept_ids = [entry[0] for entry in dept_entries]

    if mis_headers is not None and resolver is not None:
        resolved = resolver.resolve(dept_ids, role_codes, org_ids)
        departments = resolved.departments
        role_infos = resolved.role_infos
        organizations = resolved.organizations
        allowed_categories = _dedupe(resolved.allowed_categories)
        can_approve = resolved.can_approve
    else:
        # 退化：与阶段1/2 行为一致（多值字段全空）
        departments = []
        role_infos = []
        organizations = []
        allowed_categories = []
        can_approve = False

    # 角色 code：X-Mis-Roles 优先，缺省回落到 JWT roles（与 PermissionEngine 命名空间一致）
    effective_role_codes = role_codes if role_codes else list(p.roles or [])

    primary_department_id = departments[0].dept_id if departments else None
    primary_org_id = organizations[0].org_id if organizations else None

    # T6：为 DepartmentInfo 补 org_id 元信息，表达「组织 ⊃ 部门」层级。
    # 条目自带 orgId → 采用；否则回落到主组织 primary_org_id（无组织时为 None）。
    # departments 与 dept_entries 顺序一致（resolver 按 dept_ids 顺序构建），zip 对齐。
    for di, (_dept_id, entry_org_id) in zip(departments, dept_entries):
        di.org_id = entry_org_id if entry_org_id is not None else primary_org_id

    return UserContext(
        user_id=str(p.employee_id) if p.employee_id is not None else str(p.user_id),
        username=p.username,
        display_name=p.username,
        department="",  # deprecated：用 departments / primary_department_id
        dept_id=primary_department_id,  # 兼容 PermissionEngine 单值过渡
        departments=departments,
        primary_department_id=primary_department_id,
        organizations=organizations,
        primary_org_id=primary_org_id,
        role_infos=role_infos,
        roles=effective_role_codes,
        channel="mis_bff",  # 标识来源为 MIS 业务前端
        allowed_categories=allowed_categories,
        can_approve=can_approve,
        profile={
            "tenant_id": p.tenant_id,
            "app_id": p.app_id,
            "mis_user_id": p.user_id,
            "employee_id": p.employee_id,
            "perm_version": p.perm_version,
            "iss": p.iss,
        },
    )


def build_user_context_from_mis(p: "MisTokenPayload") -> "UserContext":
    """兼容薄包装：等价于 ``build_user_context(p, None, None)``（阶段1/2 行为）。

    保留以兼容既有调用与 148 测试；新代码请直接使用 :func:`build_user_context`。
    """
    return build_user_context(p, None, None)


class DepartmentInfo(BaseModel):
    """部门数据的 Pydantic schema。"""

    dept_id: str
    name: str
    parent_id: str | None = None
    # 部门所属组织（org_id）元信息（T6）：表达「组织 ⊃ 部门」层级。
    # 默认 None（向后兼容旧构造）；build_user_context 解析 X-Mis-Depts 时
    # 优先取条目内 orgId，否则回落到 primary_org_id。
    org_id: str | None = None
    allowed_categories: list[str] = Field(default_factory=list)
    denied_categories: list[str] = Field(default_factory=list)
    is_active: bool = True


class RoleInfo(BaseModel):
    """角色数据的 Pydantic schema。"""

    role_id: str
    name: str
    description: str = ""
    allowed_categories: list[str] = Field(default_factory=list)
    skill_allow_list: list[str] = Field(default_factory=list)
    skill_deny_list: list[str] = Field(default_factory=list)
    can_approve: bool = False
    is_active: bool = True


class OrgInfo(BaseModel):
    """组织 / 租户信息（对应 MIS tenantId）。"""

    org_id: str  # = str(tenantId)
    name: str = ""
    tenant_code: str = ""


class TokenPayload(BaseModel):
    """JWT token 载荷（声明）。"""

    user_id: str
    username: str
    department: str = ""
    roles: list[str] = Field(default_factory=list)
    channel: str = "wecom_h5"
    agent_id: str | None = None
    iss: str = "ai-platform"
    exp: int = 0
    iat: int = 0


class TokenSet(BaseModel):
    """access + refresh token 对。"""

    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int = 28800  # 8 小时（秒）


class WeComOAuthRequest(BaseModel):
    """企业微信 OAuth2 回调的请求体。"""

    code: str
    state: str = ""


class PasswordLoginRequest(BaseModel):
    """本地密码登录的请求体。"""

    username: str
    password: str


class CredentialMapping(BaseModel):
    """将平台用户映射到业务系统账号。"""

    system_type: str  # finance | retail | department_store | hr | property | crm | valuecard
    system_account: str
    credential: dict[str, Any] = Field(default_factory=dict)  # 明文，加密前
    is_active: bool = True
