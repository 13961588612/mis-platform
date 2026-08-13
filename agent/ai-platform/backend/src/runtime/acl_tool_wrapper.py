"""执行前判权包装器（T03 spec §2.3）—— 覆盖 E1–E5 的 fail-closed 闸门。

**装配位置铁律**：``AclToolWrapper`` 必须包在 ``SafeToolWrapper`` **外层**::

    registry.register(AclToolWrapper(SafeToolWrapper(tool), guard, source))

先判权、再执行安全包裹 —— 被拒的调用**不进入任何副作用逻辑**（§4.1 读图要点 1）。

**五条路径**：

===== ============================== ================================================
路径   工具                            skill_id 来源
===== ============================== ================================================
E1     ``SkillTool``（name=``skill``）  ``args.skill_id`` → 回落 ``args.name``
                                          （目录名经注册表映射为正式 skill_id）
E2     ``PlatformMcpToolAdapter``      ``self._tool_info``（**原始未净化名**）三档解析
E3     ``FormFillExecuteTool``         ``args.skill_id``
E4     ``FormFillApplyTool``           ``args.skill_id``
E5     ``InvokeAgentTool``             ``"__delegate__"``（跳过，交下游 E1–E5 治理）
===== ============================== ================================================

**#16 命名铁律**：``self.name`` 是"给 LLM 看的展示名"（``mcp__member_profile__query``，
点号已被 sanitize）；``mcp-{server}-{tool}`` 是"给权限系统看的判别名"
（``mcp-member.profile-query``，点号原样）。二者**永不互推** ——
**严禁**从 ``self.name`` 反解 / ``replace`` / ``normalize`` / ``split("__")``。
取不到 ``_tool_info`` ⇒ **fail-closed 拒绝**，不退回反解。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult
from pydantic import BaseModel

from src.config import get_settings
from src.runtime.mcp_identity import identity_from_tool_metadata
from src.skills.acl import SkillAclDenied, SkillAclGuard
from src.skills.tools.invoke_agent import DELEGATE_TOOL_ALIAS, DELEGATE_TOOL_NAME
from src.utils.logging import get_logger

logger = get_logger("runtime.acl_tool_wrapper")

__all__ = ["AclToolWrapper", "DELEGATE_SENTINEL", "DENY_SENTINEL"]

#: E5 委派工具哨兵：跳过 skill 码判定，治理交给白名单 + 下游 E1–E5。
DELEGATE_SENTINEL: Literal["__delegate__"] = "__delegate__"

#: 结构异常哨兵：MCP 工具取不到 ``_tool_info`` ⇒ 无条件拒绝（fail-closed）。
DENY_SENTINEL: Literal["__deny__"] = "__deny__"

#: E1 原生 skill 工具名（OpenHarness ``SkillTool.name``）。
SKILL_TOOL_NAME: str = "skill"

#: MCP 工具展示名前缀（仅用于"是否 MCP 工具"的判别，**不用于反解 server/tool 名**）。
_MCP_DISPLAY_PREFIX: str = "mcp__"


@dataclass
class _AclRequirement:
    """一次工具调用需要满足的单条权限要求。"""

    #: 需要的权限码（原样比对，禁 normalize）。
    permission: str
    #: 关联的 skill_id 或 MCP 判别名（进错误载体，供运维定位）。
    skill_id: str
    #: 被拒时给 LLM / 用户看的提示。
    message: str
    #: 附加上下文（MCP 的 server / tool 名等）。
    extra: dict[str, Any] = field(default_factory=dict)


def _unwrap(tool: Any) -> Any:
    """穿透 ``SafeToolWrapper`` 等包装层，拿到真实工具对象。

    Args:
        tool: 可能被多层包装的工具。

    Returns:
        最内层工具实例（无 ``_inner`` 时返回自身）。
    """
    current: Any = tool
    # 包装层通常只有 1 层（SafeToolWrapper），限深防御异常自引用。
    for _ in range(8):
        inner: Any = getattr(current, "_inner", None)
        if inner is None or inner is current:
            return current
        current = inner
    return current


def _non_empty_str(value: Any) -> str:
    """把任意值规约为去空白字符串（``None`` → ``""``）。"""
    if value is None:
        return ""
    text: str = str(value).strip()
    return "" if text.lower() == "none" else text


def _canonical_skill_id(registry: Any, raw: str) -> str:
    """把 SkillTool 入参名映射成 IAM 执行码使用的正式 skill_id。

    OpenHarness 按目录名调用（``member-profile``），授权页按
    ``skill_id`` 发码（``member.profile``）。无注册表或无法唯一映射时
    原样返回 —— **绝不**把 ``.`` / ``-`` / ``_`` 互相改写。

    Args:
        registry: ``SkillRegistry`` 或测试替身；可为 ``None``。
        raw: 工具入参中的 skill 名。

    Returns:
        正式 ``skill_id``；无法映射时等于 ``raw``。
    """
    key: str = (raw or "").strip()
    if not key or registry is None:
        return key
    resolve: Any = getattr(registry, "resolve_canonical_id", None)
    if callable(resolve):
        mapped: Any = resolve(key)
        if isinstance(mapped, str) and mapped.strip():
            return mapped.strip()
    found: Any = registry.get(key) if hasattr(registry, "get") else None
    if found is not None:
        sid: Any = getattr(found, "skill_id", None)
        if isinstance(sid, str) and sid.strip():
            return sid.strip()
    return key


class AclToolWrapper(BaseTool):
    """在工具执行前做 fail-closed 判权的外层包装器。"""

    def __init__(
        self,
        inner: BaseTool,
        guard: SkillAclGuard,
        registry: Any | None = None,
    ) -> None:
        """包装内层工具，透传名称 / 描述 / 输入模型。

        Args:
            inner: 被包装的工具，**约定为 ``SafeToolWrapper`` 实例**。
            guard: fail-closed 判定器。
            registry: Skill 注册表（``SkillRegistry``）或 OpenHarness ``ToolRegistry``；
                仅 E2 用于 ``mcp-{server}-{tool}`` 反查，可省略。
        """
        self._inner: BaseTool = inner
        self._guard: SkillAclGuard = guard
        self._registry: Any | None = registry
        self._target: Any = _unwrap(inner)
        self.name = inner.name
        self.description = inner.description
        self.input_model = inner.input_model

    # ------------------------------------------------------------------
    # skill_id 解析
    # ------------------------------------------------------------------

    def _is_delegate_tool(self) -> bool:
        """判断被包装的是否为 E5 委派工具。"""
        if self.name in (DELEGATE_TOOL_NAME, DELEGATE_TOOL_ALIAS):
            return True
        return type(self._target).__name__ == "InvokeAgentTool"

    def _tool_info(self) -> Any | None:
        """取 MCP 工具元数据（**唯一事实源**，保留原始未净化名，F39）。"""
        return getattr(self._target, "_tool_info", None)

    def _looks_like_mcp_tool(self) -> bool:
        """仅按展示名前缀判断"这是不是 MCP 工具"（**不**从中反解 server/tool 名）。"""
        return str(self.name or "").startswith(_MCP_DISPLAY_PREFIX)

    def _lookup_skill_id(self, discriminant: str) -> str:
        """用 MCP 判别名反查 Skill 注册表。

        Args:
            discriminant: ``mcp-{server_name}-{tool_name}``（点号 / 大写原样）。

        Returns:
            命中的 ``skill_id``；未命中返回空串。
        """
        registry: Any = self._registry
        if registry is None:
            return ""
        getter: Any = getattr(registry, "get", None)
        if not callable(getter):
            return ""
        try:
            found: Any = getter(discriminant)
        except Exception as exc:  # noqa: BLE001 - 反查失败按未命中处理（退到兜底码）
            logger.warning(
                "MCP skill lookup failed; falling back to ai:mcp:call",
                discriminant=discriminant,
                error=str(exc),
            )
            return ""
        if found is None:
            return ""
        return _non_empty_str(getattr(found, "skill_id", None) or discriminant)

    def _mcp_requirement(self) -> "_AclRequirement | Literal['__deny__']":
        """构造 E2 的权限要求（三档解析，#5 / #16 裁定）。

        1. ``registry.get("mcp-{server}-{tool}")`` 命中 → ``ai:skill:{id}:run``；
        2. 未命中 → 兜底 ``ai:mcp:call``（V22 执行码，与运营台操作码 agent:mcp:call 解耦）；
        3. 连兜底码也不在集合 ⇒ 由 guard 拒绝（fail-closed）。

        取不到 ``_tool_info`` ⇒ 返回 :data:`DENY_SENTINEL`（**不**从 ``self.name`` 反解）。
        """
        tool_info: Any | None = self._tool_info()
        if tool_info is None:
            return DENY_SENTINEL

        server_name: str = _non_empty_str(getattr(tool_info, "server_name", None))
        tool_name: str = _non_empty_str(getattr(tool_info, "name", None))
        if not server_name or not tool_name:
            return DENY_SENTINEL

        discriminant: str = f"mcp-{server_name}-{tool_name}"
        skill_id: str = self._lookup_skill_id(discriminant)
        fallback: str = str(
            getattr(get_settings(), "MIS_ACL_MCP_FALLBACK_PERMISSION", "ai:mcp:call")
            or "ai:mcp:call"
        )
        extra: dict[str, Any] = {
            "server": server_name,
            "tool": tool_name,
            "discriminant": discriminant,
        }

        if skill_id:
            required: str = self._guard.permission_code(skill_id)
            return _AclRequirement(
                permission=required,
                skill_id=skill_id,
                # 拒绝文案必须显式带 server / tool，否则运维不知该给哪个 server 补码。
                message=(
                    f"无权调用 MCP 工具 {server_name}/{tool_name}，"
                    f"需权限码 {required} 或 {fallback}"
                ),
                extra=extra,
            )

        return _AclRequirement(
            permission=fallback,
            skill_id=discriminant,
            message=(
                f"无权调用 MCP 工具 {server_name}/{tool_name}，需权限码 {fallback}"
            ),
            extra=extra,
        )

    def _arg_skill_id(self, arguments: Any) -> str:
        """从工具入参提取 ``skill_id``（E1 / E3 / E4）。

        Args:
            arguments: Pydantic 入参模型或字典。

        Returns:
            非空 ``skill_id``；取不到返回空串。
        """
        if arguments is None:
            return ""
        if isinstance(arguments, dict):
            return _non_empty_str(arguments.get("skill_id") or arguments.get("skillId"))
        value: str = _non_empty_str(getattr(arguments, "skill_id", None))
        if value:
            return value
        return _non_empty_str(getattr(arguments, "skillId", None))

    def _resolve_requirements(
        self,
        arguments: Any,
        context: ToolExecutionContext,
    ) -> "list[_AclRequirement] | Literal['__delegate__', '__deny__']":
        """解析本次调用需要满足的权限要求集合。

        Args:
            arguments: 工具入参。
            context: OpenHarness 执行上下文（未参与解析，保留以对齐 spec 签名）。

        Returns:
            权限要求列表、:data:`DELEGATE_SENTINEL` 或 :data:`DENY_SENTINEL`。
        """
        del context  # 解析只依赖工具自身结构与入参

        # —— E5：委派工具，跳过 skill 码判定 ——
        if self._is_delegate_tool():
            return DELEGATE_SENTINEL

        # —— E2：MCP 工具，一律走 _tool_info 原始名 ——
        # 先于 args.skill_id 判断：MCP 工具的入参里也可能恰好有名为 skill_id 的业务字段，
        # 那不是平台 skill_id，不能拿来判权。
        if self._tool_info() is not None or self._looks_like_mcp_tool():
            mcp_req: Any = self._mcp_requirement()
            if mcp_req == DENY_SENTINEL:
                return DENY_SENTINEL
            return [mcp_req]

        # —— E1 / E3 / E4：入参自带 skill_id ——
        skill_id: str = self._arg_skill_id(arguments)

        # —— E1 回落：OpenHarness SkillTool 的入参字段名是 name（非 skill_id）——
        if not skill_id and self.name == SKILL_TOOL_NAME:
            if isinstance(arguments, dict):
                skill_id = _non_empty_str(arguments.get("name"))
            else:
                skill_id = _non_empty_str(getattr(arguments, "name", None))

        if skill_id:
            canonical: str = _canonical_skill_id(self._registry, skill_id)
            required: str = self._guard.permission_code(canonical)
            return [
                _AclRequirement(
                    permission=required,
                    skill_id=canonical,
                    message=f"无权执行技能 {canonical}，需权限码 {required}",
                )
            ]

        # 非 skill 承载类工具（由 allowed_tools 白名单 + PermissionChecker 治理）。
        logger.debug("No skill_id resolved for tool; ACL check skipped", tool=self.name)
        return []

    def _resolve_skill_ids(
        self,
        arguments: Any,
        context: ToolExecutionContext,
    ) -> "list[str] | Literal['__delegate__', '__deny__']":
        """spec §2.3 签名：解析本次调用涉及的 skill_id 列表。

        Args:
            arguments: 工具入参。
            context: OpenHarness 执行上下文。

        Returns:
            skill_id 列表（E2 兜底档为 ``mcp-{server}-{tool}`` 判别名）、
            :data:`DELEGATE_SENTINEL` 或 :data:`DENY_SENTINEL`。
        """
        resolved: Any = self._resolve_requirements(arguments, context)
        if isinstance(resolved, str):
            return resolved
        return [req.skill_id for req in resolved]

    # ------------------------------------------------------------------
    # 执行
    # ------------------------------------------------------------------

    async def execute(
        self,
        arguments: BaseModel,
        context: ToolExecutionContext,
    ) -> ToolResult:
        """判权通过后委托内层执行；被拒时**不调用 inner**（无副作用）。

        Args:
            arguments: 经 Pydantic 校验的工具入参。
            context: OpenHarness 执行上下文；身份取自 ``context.metadata["identity"]``。

        Returns:
            内层执行结果；被拒时为 ``is_error=True`` 且 ``metadata["acl"]`` 带结构化原因。
        """
        resolved: Any = self._resolve_requirements(arguments, context)

        if resolved == DELEGATE_SENTINEL:
            # E5：治理交给白名单 + 下游 E1–E5（子 Agent 会再经一遍本闸门）。
            return await self._inner.execute(arguments, context)

        if resolved == DENY_SENTINEL:
            denied: SkillAclDenied = SkillAclDenied(
                code="AI_SKILL_FORBIDDEN",
                skill_id=self.name,
                required_permission="",
                message=(
                    f"工具 {self.name} 缺少 MCP 元数据（_tool_info），"
                    "无法确定判权对象，已按最小权限原则拒绝执行"
                ),
            )
            logger.warning(
                "ACL denied: MCP tool without _tool_info (fail-closed, no name reverse-parse)",
                tool=self.name,
            )
            return ToolResult(
                output=denied.message,
                is_error=True,
                metadata={"acl": denied.to_payload()},
            )

        if not resolved:
            return await self._inner.execute(arguments, context)

        # 身份取自 tool_metadata（S9 五键，含 misUserId）；
        # ⚠ 绝不用 userId / userMobile 回退当 MIS userId。
        identity: dict[str, str] = identity_from_tool_metadata(context.metadata)

        for requirement in resolved:
            try:
                await self._guard.assert_has_permission(
                    identity,
                    requirement.permission,
                    skill_id=requirement.skill_id,
                    message=requirement.message,
                    extra=requirement.extra,
                )
            except SkillAclDenied as denied:
                logger.warning(
                    "ACL denied tool execution",
                    tool=self.name,
                    code=denied.code,
                    skill_id=denied.skill_id,
                    required_permission=denied.required_permission,
                )
                return ToolResult(
                    output=denied.message,
                    is_error=True,
                    metadata={"acl": denied.to_payload()},
                )

        return await self._inner.execute(arguments, context)

    def is_read_only(self, arguments: BaseModel) -> bool:
        """透传内层工具的只读判定。

        Args:
            arguments: 工具入参。

        Returns:
            内层 ``is_read_only`` 的返回值。
        """
        return self._inner.is_read_only(arguments)
