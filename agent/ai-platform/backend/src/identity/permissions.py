"""
PermissionEngine — RBAC + Skill 级别覆盖 + 部门限制。

权限解析顺序（最具体的优先级最高）：
  1. **用户 skill_deny_list** → 始终拒绝
  2. **用户 skill_allow_list** → 始终允许
  3. **角色 skill_deny_list** → 拒绝
  4. **角色 skill_allow_list** → 允许
  5. **部门 denied_categories** → 拒绝
  6. **部门 allowed_categories** → 如果分类匹配则允许
  7. **角色 allowed_categories** → 如果分类匹配则允许
  8. 默认 → 拒绝（封闭模型）

结果缓存在 Redis 中（键：``user:{id}:allowed_skills``，TTL 600s）。

本文件在阶段1+2 基础上叠加「身份 enrichment」增量（T2）：提供
``PermissionEngineCategoryResolver``（实现 ``models.CategoryResolver`` 协议），
将部门 id / 角色 code / 组织 id 经进程内 PermissionEngine 目录展开为带
``allowed_categories`` 的 DepartmentInfo/RoleInfo/OrgInfo，并计算合并后的
``allowed_categories`` 与 ``can_approve``。``models.py`` 不得 import 本文件，
故仅在此处依赖 models 的类型。
"""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

import structlog

from src.identity.models import (
    APPROVAL_DEPT_IDS,
    CategoryResolver,
    DepartmentInfo,
    OrgInfo,
    ResolvedIdentity,
    RoleInfo,
)

if TYPE_CHECKING:
    from src.identity.models import UserContext
    from src.skills.models import Skill

logger = structlog.get_logger(__name__)


class PermissionEngine:
    """评估用户是否可以调用特定 Skill。"""

    def __init__(self) -> None:
        """初始化权限引擎（空角色/部门内存缓存）。"""
        # 生产环境中，角色/部门数据从数据库加载。
        # 对于内存引擎，我们期望调用方注入这些数据。
        self._role_cache: dict[str, dict] = {}
        self._dept_cache: dict[str, dict] = {}

    def set_role_data(self, role_id: str, data: dict) -> None:
        """填充内存角色查找缓存。"""
        self._role_cache[role_id] = data

    def set_dept_data(self, dept_id: str, data: dict) -> None:
        """填充内存部门查找缓存。"""
        self._dept_cache[dept_id] = data

    def check_permission(self, user: UserContext, skill: Skill) -> bool:
        """如果 *user* 被允许调用 *skill*，则返回 True。

        这是一个同步的、确定性的检查 — 无 I/O。
        """
        skill_id: Any = skill.skill_id
        skill_category: Any = skill.category

        # 1. 用户级别拒绝列表（最高优先级）
        if skill_id in user.skill_deny_list:
            return False

        # 2. 用户级别允许列表
        if skill_id in user.skill_allow_list:
            return True

        # 3. 角色级别检查
        for role_id in user.roles:
            role: dict[str, Any] = self._role_cache.get(role_id, {})
            if skill_id in role.get("skill_deny_list", []):
                return False
            if skill_id in role.get("skill_allow_list", []):
                return True

        # 4. 部门拒绝的分类
        if user.dept_id:
            dept: dict[str, Any] = self._dept_cache.get(user.dept_id, {})
            if skill_category in dept.get("denied_categories", []):
                return False

        # 5. 部门允许的分类
        if user.dept_id:
            dept: dict[str, Any] = self._dept_cache.get(user.dept_id, {})
            allowed: list[Any] = dept.get("allowed_categories", [])
            if allowed and skill_category not in allowed:
                return False

        # 6. 角色允许的分类
        for role_id in user.roles:
            role: dict[str, Any] = self._role_cache.get(role_id, {})
            allowed_cats: list[Any] = role.get("allowed_categories", [])
            if allowed_cats and skill_category in allowed_cats:
                return True

        # 7. 用户自己的 allowed_categories（预计算的并集）
        if user.allowed_categories:
            if skill_category in user.allowed_categories:
                return True
            return False

        # 8. 默认：封闭模型 — 除非显式允许，否则拒绝
        # 如果完全没有配置任何限制，则允许（开发环境的开放模型）
        has_any_restriction: Any = (
            bool(user.skill_deny_list)
            or bool(user.skill_allow_list)
            or bool(user.roles)
            or bool(user.dept_id)
            or bool(user.allowed_categories)
        )
        if not has_any_restriction:
            return True  # 无限制配置 → 允许（开发模式）

        return False

    def filter_skills(
        self, user: UserContext, skills: list[Skill]
    ) -> list[Skill]:
        """仅返回 *user* 被允许调用的 Skill。"""
        return [s for s in skills if self.check_permission(user, s)]

    def get_allowed_skills(self, user: UserContext) -> list[str]:
        """从用户的允许列表中返回 Skill ID（仅显式覆盖）。"""
        allowed: set[str] = set(user.skill_allow_list)
        for role_id in user.roles:
            role: dict[str, Any] = self._role_cache.get(role_id, {})
            allowed.update(role.get("skill_allow_list", []))
        return list(allowed)

    def compute_user_categories(self, user: UserContext) -> list[str]:
        """计算此用户可以访问的 Skill 分类集合。

        组合角色和部门的 allowed_categories。如果未配置限制，
        则返回空列表（表示所有分类）。
        """
        cats: set[str] = set()

        # 来自角色
        for role_id in user.roles:
            role: dict[str, Any] = self._role_cache.get(role_id, {})
            cats.update(role.get("allowed_categories", []))

        # 来自部门
        if user.dept_id:
            dept: dict[str, Any] = self._dept_cache.get(user.dept_id, {})
            dept_allowed: list[Any] = dept.get("allowed_categories", [])
            if dept_allowed:
                # 取交集：部门进行进一步限制
                if cats:
                    cats: Any = cats & set(dept_allowed)
                else:
                    cats: set[Any] = set(dept_allowed)
            # 移除被拒绝的
            for denied in dept.get("denied_categories", []):
                cats.discard(denied)

        return list(cats)

    def can_approve(self, user: UserContext) -> bool:
        """如果用户可以批准敏感操作，则返回 True。"""
        if user.can_approve:
            return True
        for role_id in user.roles:
            role: dict[str, Any] = self._role_cache.get(role_id, {})
            if role.get("can_approve", False):
                return True
        return False


# ---------------------------------------------------------------------------
# 身份 enrichment：CategoryResolver 实现（T2）
# ---------------------------------------------------------------------------


class PermissionEngineCategoryResolver:
    """``CategoryResolver`` 实现：基于进程内 PermissionEngine 目录解析 dept/role/org 分类。

    将 ``build_user_context`` 传入的部门 id / 角色 code / 组织 id 经
    ``PermissionEngine`` 内存目录（``set_role_data`` / ``set_dept_data`` 装载）
    展开为带 ``allowed_categories`` 的 ``DepartmentInfo`` / ``RoleInfo`` / ``OrgInfo``，
    并合并计算 ``allowed_categories``（去重）与 ``can_approve``。
    """

    def __init__(self, engine: PermissionEngine) -> None:
        self._engine = engine

    def resolve(
        self,
        dept_ids: list[str],
        role_codes: list[str],
        org_ids: list[str],
    ) -> ResolvedIdentity:
        departments: list[DepartmentInfo] = []
        for dept_id in dept_ids:
            data = self._engine._dept_cache.get(dept_id, {})
            departments.append(
                DepartmentInfo(
                    dept_id=dept_id,
                    name="",
                    allowed_categories=list(data.get("allowed_categories", []) or []),
                    denied_categories=list(data.get("denied_categories", []) or []),
                )
            )

        role_infos: list[RoleInfo] = []
        for code in role_codes:
            data = self._engine._role_cache.get(code, {})
            role_infos.append(
                RoleInfo(
                    role_id=code,
                    name="",
                    allowed_categories=list(data.get("allowed_categories", []) or []),
                    can_approve=bool(data.get("can_approve", False)),
                )
            )

        organizations: list[OrgInfo] = [OrgInfo(org_id=org_id) for org_id in org_ids]

        # allowed_categories = ∪(departments.allowed_categories) ∪(role_infos.allowed_categories)，去重
        merged: list[str] = []
        seen: set[str] = set()
        for di in departments:
            for c in di.allowed_categories:
                if c not in seen:
                    seen.add(c)
                    merged.append(c)
        for ri in role_infos:
            for c in ri.allowed_categories:
                if c not in seen:
                    seen.add(c)
                    merged.append(c)

        can_approve = any(ri.can_approve for ri in role_infos) or any(
            di.dept_id in APPROVAL_DEPT_IDS for di in departments
        )

        return ResolvedIdentity(
            departments=departments,
            role_infos=role_infos,
            organizations=organizations,
            allowed_categories=merged,
            can_approve=can_approve,
        )


# 进程内 PermissionEngine 目录单例（供目录装载器填充 role/dept 数据）
_DEFAULT_ENGINE: PermissionEngine | None = None


def get_permission_engine() -> PermissionEngine:
    """返回进程内 PermissionEngine 目录单例（供目录装载器填充 role/dept 数据）。"""
    global _DEFAULT_ENGINE
    if _DEFAULT_ENGINE is None:
        _DEFAULT_ENGINE = PermissionEngine()
    return _DEFAULT_ENGINE


def get_category_resolver() -> CategoryResolver:
    """返回基于进程内 PermissionEngine 目录的 ``CategoryResolver`` 单例（供 deps.get_current_user 使用）。"""
    return PermissionEngineCategoryResolver(get_permission_engine())
