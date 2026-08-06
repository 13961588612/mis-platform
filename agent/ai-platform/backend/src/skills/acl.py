"""Skill 执行权限闸门（T03 spec §2.2）—— fail-closed **唯一判定器**。

不改造既有 ``PermissionEngine``（那是"分类可见性/排序"语义），本模块只负责一件事：
**这个端用户能不能执行这个 skill**。

判定链：``MIS userId`` → :class:`~src.identity.mis_permission_resolver.MisPermissionResolver`
→ 权限码集合 → ``ai:skill:{skill_id}:run`` 是否命中。

**四条拒绝规则（§4.2）**：

1. 无身份（解析不出 MIS userId）→ ``AI_SKILL_FORBIDDEN``
2. 权限源不可达 → ``AI_ACL_UNAVAILABLE``（**禁止 fallback 到允许**）
3. 权限码不在集合中（含集合为空）→ ``AI_SKILL_FORBIDDEN``
4. 超管豁免**默认关闭**；仅显式配置 ``MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES``
   且角色命中时才放行

**权限码格式铁律（#1 裁定·作废 ``_normalize``）**：
``f"ai:skill:{skill_id}:run"`` —— **严禁** lower / 转义 / 改写 / 非法字符转 ``-``。
点号、大写、连字符一律原样保留，与 Java ``SkillGrantVO.permissionCodeOf`` 逐字节一致。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from src.identity.mis_permission_resolver import (
    MisPermissionResolver,
    PermissionUnavailable,
)
from src.identity.mis_user_id import resolve_mis_user_id
from src.utils.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover
    from src.config import Settings
    from src.identity.models import UserContext
    from src.skills.registry import SkillRegistry

logger = get_logger("skills.acl")

__all__ = [
    "PERMISSION_CODE_TEMPLATE",
    "SkillAclDenied",
    "SkillAclGuard",
    "permission_code_of",
]

#: 权限码模板。**唯一事实源**，Java / Python / 授权页三处共用同一格式。
PERMISSION_CODE_TEMPLATE: str = "ai:skill:{skill_id}:run"

#: 语义标签（非 wire 码）：无权限。
CODE_SKILL_FORBIDDEN: str = "AI_SKILL_FORBIDDEN"
#: 语义标签（非 wire 码）：权限源不可达。
CODE_ACL_UNAVAILABLE: str = "AI_ACL_UNAVAILABLE"


def permission_code_of(skill_id: str) -> str:
    """由 skill_id 生成执行权限码（**原样拼接，零改写**）。

    Args:
        skill_id: 技能 ID，如 ``member.profile`` / ``Order-Query``。

    Returns:
        形如 ``ai:skill:member.profile:run``。
    """
    return PERMISSION_CODE_TEMPLATE.format(skill_id=skill_id)


@dataclass
class SkillAclDenied(Exception):
    """拒绝执行 —— 既是异常也是结构化错误载体。

    Attributes:
        code: ``AI_SKILL_FORBIDDEN`` | ``AI_ACL_UNAVAILABLE``（语义标签，非 wire 码）。
        skill_id: 被拒的 skill_id（E2 兜底场景可为 MCP 判别名）。
        required_permission: 需要但缺失的权限码。
        message: 面向用户的中文提示。
    """

    code: str = CODE_SKILL_FORBIDDEN
    skill_id: str = ""
    required_permission: str = ""
    message: str = ""
    #: 附加上下文（如 MCP 的 server / tool 名），进 ToolResult.metadata 便于运维定位。
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """补默认文案，并让 ``str(exc)`` 输出可读信息。"""
        if not self.message:
            if self.code == CODE_ACL_UNAVAILABLE:
                self.message = f"权限服务暂不可用，无法校验技能 {self.skill_id} 的执行权限"
            else:
                self.message = f"无权执行技能 {self.skill_id}"
        Exception.__init__(self, self.message)

    def to_payload(self) -> dict[str, Any]:
        """转为前后端统一的错误结构（§2.2 / §4.2）。

        Returns:
            ``{"code": ..., "message": ..., "data": {...}}``；与 Java 侧 ``data.code`` 同源同名。
        """
        data: dict[str, Any] = {
            "skill_id": self.skill_id,
            "required_permission": self.required_permission,
        }
        data.update(self.extra)
        return {"code": self.code, "message": self.message, "data": data}


def _read(ctx: Any, key: str, default: Any = None) -> Any:
    """从 dict 或对象上统一读取字段。"""
    if isinstance(ctx, dict):
        return ctx.get(key, default)
    return getattr(ctx, key, default)


def _read_any(ctx: Any, keys: tuple[str, ...], default: Any = None) -> Any:
    """按顺序读取第一个非空字段。"""
    for key in keys:
        value: Any = _read(ctx, key, None)
        if value not in (None, ""):
            return value
    return default


class SkillAclGuard:
    """fail-closed 判定器：判断端用户能否执行某 skill。"""

    def __init__(
        self,
        resolver: MisPermissionResolver,
        registry: "SkillRegistry | None" = None,
        settings: "Settings | None" = None,
    ) -> None:
        """构造判定器。

        Args:
            resolver: 权限码解析器（Redis + BFF）。
            registry: Skill 注册表；仅用于 E2 的 ``mcp-{server}-{tool}`` 反查，可省略。
            settings: 平台配置；省略时取全局单例。
        """
        from src.config import get_settings

        self._resolver: MisPermissionResolver = resolver
        self._registry: "SkillRegistry | None" = registry
        self._settings: "Settings" = settings or get_settings()

    # ------------------------------------------------------------------
    # 权限码
    # ------------------------------------------------------------------

    def permission_code(self, skill_id: str) -> str:
        """返回 skill 的执行权限码（原样拼接，禁 normalize）。

        Args:
            skill_id: 技能 ID。

        Returns:
            ``ai:skill:{skill_id}:run``。
        """
        return permission_code_of(skill_id)

    # ------------------------------------------------------------------
    # 身份/配置读取
    # ------------------------------------------------------------------

    def _bypass_role_codes(self) -> set[str]:
        """读取超管豁免角色码；**默认空集合 = 豁免关闭**（§4.2 规则 4）。

        兼容 spec 描述的嵌套写法 ``settings.acl.superadmin_bypass_role_codes``
        与本仓库的扁平写法 ``MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES``。
        """
        acl_ns: Any = getattr(self._settings, "acl", None)
        raw: Any = getattr(acl_ns, "superadmin_bypass_role_codes", None) if acl_ns else None
        if raw is None:
            raw = getattr(self._settings, "MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES", None)
        if not raw:
            return set()
        if isinstance(raw, str):
            return {item.strip() for item in raw.split(",") if item.strip()}
        return {str(item).strip() for item in raw if str(item).strip()}

    def _is_superadmin(self, ctx: Any) -> bool:
        """判断上下文角色是否命中超管豁免白名单。"""
        bypass: set[str] = self._bypass_role_codes()
        if not bypass:
            return False
        roles: Any = _read(ctx, "roles", None) or _read(ctx, "role_codes", None) or []
        if isinstance(roles, str):
            role_set: set[str] = {roles}
        elif isinstance(roles, (list, tuple, set)):
            role_set = {str(getattr(r, "role_id", None) or r) for r in roles}
        else:
            role_set = set()
        return bool(role_set & bypass)

    def _app_id(self, ctx: Any) -> str:
        """取 appId：优先 ``ctx.profile["app_id"]``，再 ctx 顶层，最后配置默认值。"""
        profile: Any = _read(ctx, "profile", None)
        if isinstance(profile, dict):
            value: Any = profile.get("app_id") or profile.get("appId")
            if value not in (None, ""):
                return str(value)
        value = _read_any(ctx, ("app_id", "appId"), None)
        if value not in (None, ""):
            return str(value)
        return str(getattr(self._settings, "MIS_ACL_DEFAULT_APP_ID", "") or "")

    def _raw_jwt(self, ctx: Any) -> str | None:
        """取原始 JWT（REST 链路有；工具执行链路为 ``None`` → 走 X-Platform-Token）。"""
        value: Any = _read_any(ctx, ("raw_jwt", "rawJwt"), None)
        return str(value) if value not in (None, "") else None

    def _store_codes(self, ctx: Any, codes: set[str]) -> None:
        """把解析到的权限码写回上下文（§4.1 ``UserContext o-- MisPermissionResolver``）。"""
        if ctx is None:
            return
        try:
            if isinstance(ctx, dict):
                ctx["permission_codes"] = set(codes)
            else:
                setattr(ctx, "permission_codes", set(codes))
        except Exception:  # noqa: BLE001 - 回写失败不影响判定结论
            logger.debug("permission_codes writeback skipped (immutable ctx)")

    # ------------------------------------------------------------------
    # 判定
    # ------------------------------------------------------------------

    async def resolve_codes(self, ctx: Any) -> set[str]:
        """解析并回写权限码集合。

        Args:
            ctx: ``UserContext`` / ``get_current_user()`` 字典 / MCP identity 字典
                （后者带 ``misUserId`` 第五键）。

        Returns:
            权限码集合（可能为空集）。

        Raises:
            SkillAclDenied: 无身份（``AI_SKILL_FORBIDDEN``）或源不可达（``AI_ACL_UNAVAILABLE``）。
        """
        mis_user_id: int | None = resolve_mis_user_id(ctx, db=None)
        if mis_user_id is None:
            # 规则 1：解析不出 MIS userId ⇒ 视为无身份。
            # ⚠ 绝不回退 ctx.user_id（employeeId / 企微 userid）去查权限（#14 横向越权）。
            raise SkillAclDenied(
                code=CODE_SKILL_FORBIDDEN,
                skill_id="",
                required_permission="",
                message="未识别到有效的 MIS 用户身份，已拒绝执行",
            )

        try:
            codes: set[str] = await self._resolver.resolve(
                mis_user_id,
                self._app_id(ctx),
                self._raw_jwt(ctx),
            )
        except PermissionUnavailable as exc:
            # 规则 2：源不可达 ⇒ 拒绝，禁止 fallback 到允许。
            raise SkillAclDenied(
                code=CODE_ACL_UNAVAILABLE,
                skill_id="",
                required_permission="",
                message="权限服务暂不可用，已按最小权限原则拒绝执行",
                extra={"reason": exc.reason},
            ) from exc

        self._store_codes(ctx, codes)
        return codes

    async def assert_has_permission(
        self,
        ctx: Any,
        required_permission: str,
        *,
        skill_id: str = "",
        message: str = "",
        extra: dict[str, Any] | None = None,
    ) -> None:
        """断言上下文持有指定权限码；否则抛 :class:`SkillAclDenied`。

        Args:
            ctx: 身份上下文。
            required_permission: 需要的权限码（原样比对）。
            skill_id: 关联的 skill_id（用于错误载体）。
            message: 自定义提示；省略时用默认文案。
            extra: 附加上下文（如 MCP server / tool 名）。

        Raises:
            SkillAclDenied: 无身份 / 源不可达 / 缺码。
        """
        if not bool(getattr(self._settings, "MIS_ACL_ENABLED", True)):
            logger.warning(
                "MIS_ACL_ENABLED=False — 权限闸门已被显式关闭（仅限本地联调）",
                skill_id=skill_id,
            )
            return

        try:
            codes: set[str] = await self.resolve_codes(ctx)
        except SkillAclDenied as denied:
            # 补齐 skill 维度信息后原样上抛（保留 code 语义：FORBIDDEN / UNAVAILABLE）。
            denied.skill_id = denied.skill_id or skill_id
            denied.required_permission = denied.required_permission or required_permission
            if extra:
                denied.extra.update(extra)
            raise

        if self._is_superadmin(ctx):
            # 规则 4：显式配置的超管豁免（默认关闭）。
            logger.info("ACL bypassed by superadmin role", skill_id=skill_id)
            return

        # 规则 3：码集合为空 或 不含所需码 ⇒ 拒绝。
        if required_permission not in codes:
            raise SkillAclDenied(
                code=CODE_SKILL_FORBIDDEN,
                skill_id=skill_id,
                required_permission=required_permission,
                message=message,
                extra=dict(extra or {}),
            )

    async def assert_can_run(self, ctx: Any, skill_id: str) -> None:
        """断言端用户可执行 *skill_id*；否则抛 :class:`SkillAclDenied`。

        Args:
            ctx: ``UserContext`` / 身份字典（工具链路带 ``misUserId`` 第五键，S9）。
            skill_id: 技能 ID。

        Raises:
            SkillAclDenied: 无身份 / 源不可达 / 缺码。
        """
        required: str = self.permission_code(skill_id)
        await self.assert_has_permission(
            ctx,
            required,
            skill_id=skill_id,
            message=f"无权执行技能 {skill_id}",
        )

    def filter_runnable(self, ctx: Any, skill_ids: list[str]) -> list[str]:
        """非抛出版本：返回**已解析**权限码中带执行码的 skill_id 子集。

        供检索 / 排序阶段预过滤使用，**不替代执行期判定**
        （执行期必须走 :meth:`assert_can_run`）。

        Args:
            ctx: 身份上下文（须已由 :meth:`resolve_codes` 填充 ``permission_codes``）。
            skill_ids: 候选 skill_id 列表。

        Returns:
            有执行权限的子集；``ctx`` 无码时返回空列表（fail-closed）。
        """
        raw: Any = _read(ctx, "permission_codes", None)
        codes: set[str] = set(raw) if isinstance(raw, (set, list, tuple)) else set()
        if not codes:
            return []
        return [sid for sid in skill_ids if self.permission_code(sid) in codes]


# ---------------------------------------------------------------------------
# 单例
# ---------------------------------------------------------------------------
_guard: SkillAclGuard | None = None


def get_skill_acl_guard(registry: "SkillRegistry | None" = None) -> SkillAclGuard:
    """返回单例 :class:`SkillAclGuard`（复用 resolver 的 Redis 连接池）。

    Args:
        registry: 可选的 Skill 注册表；首次构造时注入，后续调用忽略。

    Returns:
        进程内单例守卫。
    """
    global _guard
    if _guard is None:
        from src.identity.mis_permission_resolver import get_mis_permission_resolver

        _guard = SkillAclGuard(get_mis_permission_resolver(), registry)
    return _guard


def reset_skill_acl_guard() -> None:
    """清空单例（仅供测试隔离使用）。"""
    global _guard
    _guard = None
