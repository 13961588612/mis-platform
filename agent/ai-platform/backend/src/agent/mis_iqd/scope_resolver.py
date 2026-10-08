"""ScopeResolver — 问数数据范围裁定 + 行级注入（v1.9 / W2）。

双闸门第二闸（architecture §5.1 步骤 10/25）：
- **前置** resolve(identity, connection_id)：按身份 + 配置缓存裁定可问表集合；
  空范围 → ``deny``（45204，不返回任何数据/SQL）。
- **后置** assert_sql_within_scope(lineage, resolution)：血缘含越权表 → fail-closed
  ``45204``，丢弃结果与 SQL。
- **行级注入（W2）** inject_row_scope(sql, ...)：按维度注册表遍历（dept PATH_PREFIX /
  store ENUM 一期默认），多维度 AND 叠加，覆盖性校验按维度分别判定，任一失败 →
  ``45204``（宁拒不可漏）。

配置来源（v1.9）：``IqdConfigClient`` 调 mis-iqd ``/internal/v1/iqd/**`` + 本地缓存，
**不直连 mis_platform 库**；缓存不可得 → fail-closed ``45204``。

W2（B3）能力：
- :meth:`_load_allowed_keys` 消费 get-scope-policies（治理层）与 get-acls（授权层）求交；
- :meth:`_load_row_scope_rules` 消费 ACL 行级条件（维度实例）挂到 resolution；
- :meth:`inject_row_scope` 维度遍历注入 + :meth:`resolve_inject_strategy` 策略选择；
- :meth:`_build_authorized_predicate` 按维度策略生成谓词（dept 主路径 EXISTS 形态 /
  store 扁平 IN）。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from src.agent.mis_iqd.errors import ScopeDeniedError, WrenaiNotConfiguredError
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.scope_resolver")

#: 身份头键（与 BFF X-Mis-Roles/Depts/Stores/Orgs 对齐）
KEY_ROLES = "roles"
KEY_DEPTS = "depts"
KEY_STORES = "stores"
KEY_ORGS = "orgs"

#: 范围策略 subject_type 取值
SUBJECT_GLOBAL = "global"
SUBJECT_ROLE = "role"
SUBJECT_DEPT = "dept"
SUBJECT_USER = "user"
SUBJECT_STORE = "store"

#: 行级维度 predicate_type
PREDICATE_PATH_PREFIX = "PATH_PREFIX"
PREDICATE_ENUM = "ENUM"
PREDICATE_FAIL_CLOSED = "FAIL_CLOSED"

#: ENUM 降级阈值（architecture §4.2.2 C：≤500 可 ENUM，>500 且无层级 FAIL_CLOSED）
ENUM_LIMIT = 500

#: 业务库部门权限字典表（v1.6 定案，v1.7 A13 物化表形态）
DICT_DEPT_SCOPE = "mis_dept_scope"
#: Column-name whitelist regex (used by object-level override).
_COL_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass
class AskIdentity:
    """问数身份上下文（来自 BFF 透传头 / TaskBrief identity）。

    Attributes:
        user_id: MIS 用户 ID（**真实用户**，模拟角色时保持不变）。
        employee_id: 员工号（真实用户）。
        role_codes: 生效角色码列表（模拟角色时被覆写为 ``[simulated_role_code]``）。
        dept_ids: 部门 ID 列表。
        store_codes: 门店编码列表。
        org_ids: 组织 ID 列表。
        raw_headers: 原始 X-Mis-* 头（行级注入取值源）。
        simulated_role_code: 模拟角色码（B6 后台测试页）；``None`` 表示真实身份。
        real_role_codes: 模拟前的真实角色码（仅模拟时非空，用于不放大权限校验）。
    """

    user_id: int | None = None
    employee_id: str | None = None
    role_codes: list[str] = field(default_factory=list)
    dept_ids: list[str] = field(default_factory=list)
    store_codes: list[str] = field(default_factory=list)
    org_ids: list[str] = field(default_factory=list)
    raw_headers: dict[str, str] = field(default_factory=dict)
    simulated_role_code: str | None = None
    real_role_codes: list[str] = field(default_factory=list)
    data_scope_all: bool = False

    def is_simulated(self) -> bool:
        """是否处于模拟角色状态（B6 后台测试页）。"""
        return bool(self.simulated_role_code)

    def with_simulated_role(self, role_code: str) -> AskIdentity:
        """返回模拟角色身份副本：覆写 role_codes，**保留真实 user_id 与数据头**。

        Args:
            role_code: 要模拟的角色码（后台测试页 simulate_role_code）。

        Returns:
            新身份（原身份不变）：role_codes=[role_code]，simulated_role_code 置位，
            real_role_codes 记录模拟前的真实角色码，user_id/employee_id/dept/store/org/
            raw_headers 全部保持不变。
        """
        return AskIdentity(
            user_id=self.user_id,
            employee_id=self.employee_id,
            role_codes=[role_code] if role_code else list(self.role_codes),
            dept_ids=list(self.dept_ids),
            store_codes=list(self.store_codes),
            org_ids=list(self.org_ids),
            raw_headers=dict(self.raw_headers),
            simulated_role_code=role_code or None,
            real_role_codes=list(self.role_codes),
            # 数据范围（ALL）与模拟角色正交：模拟身份必须继承，否则
            # X-Mis-Data-Scope: all 会在模拟时被静默丢弃 → 行级注入 fail-closed。
            data_scope_all=self.data_scope_all,
        )

    def real_identity(self) -> AskIdentity:
        """返回真实身份副本（去除模拟覆写，恢复真实 role_codes）。

        Returns:
            非模拟时原样返回自身；模拟时返回 role_codes=real_role_codes、
            simulated_role_code=None 的真实身份副本。
        """
        if not self.is_simulated():
            return self
        return AskIdentity(
            user_id=self.user_id,
            employee_id=self.employee_id,
            role_codes=list(self.real_role_codes),
            dept_ids=list(self.dept_ids),
            store_codes=list(self.store_codes),
            org_ids=list(self.org_ids),
            raw_headers=dict(self.raw_headers),
            simulated_role_code=None,
            real_role_codes=[],
            data_scope_all=self.data_scope_all,
        )

    def subject_summary(self) -> str:
        """返回人类可读主体摘要（如 ``role:SALES_MANAGER``；模拟时带 simulated 标记）。"""
        if self.role_codes:
            summary = "role:" + ",".join(sorted(self.role_codes))
        elif self.dept_ids:
            summary = "dept:" + ",".join(sorted(self.dept_ids))
        else:
            summary = f"user:{self.user_id or 'unknown'}"
        if self.is_simulated():
            return f"{summary} (simulated:{self.simulated_role_code})"
        return summary

    @classmethod
    def from_headers(cls, headers: dict[str, str] | None) -> AskIdentity:
        """从 BFF 透传头构造身份（X-Mis-Roles/Depts/Stores/Orgs）。"""
        headers = headers or {}

        def _parse_list(key: str) -> list[str]:
            raw = headers.get(key, "").strip()
            if not raw:
                return []
            try:
                parsed: Any = json.loads(raw)
                if not isinstance(parsed, list):
                    return []
                out: list[str] = []
                for item in parsed:
                    if isinstance(item, dict):
                        code = item.get("code") or item.get("id")
                        if code:
                            out.append(str(code))
                    elif isinstance(item, (str, int)):
                        out.append(str(item))
                return [v for v in out if v]
            except (json.JSONDecodeError, TypeError):
                return [v for v in (p.strip() for p in raw.split(",")) if v]

        identity = cls(
            role_codes=_parse_list("X-Mis-Roles"),
            dept_ids=_parse_list("X-Mis-Depts"),
            store_codes=_parse_list("X-Mis-Stores"),
            org_ids=_parse_list("X-Mis-Orgs"),
            raw_headers={k: v for k, v in headers.items() if k and v},
        )
        # BFF 注入的显式数据范围头：``all`` → 跳过行级注入（全行可见）。
        if headers.get("X-Mis-Data-Scope", "").strip().lower() == "all":
            identity.data_scope_all = True
        # ``X-Mis-Dept-Scope`` 锚点（含 path）也回填 dept_ids，供 _subject_keys 命中
        # 部门级 scope_policy；具体 path 由 dept_scope_anchors() 从 raw_headers 消费。
        anchors = json.loads(headers.get("X-Mis-Dept-Scope") or "[]") if headers.get("X-Mis-Dept-Scope") else []
        if isinstance(anchors, list):
            anchor_ids = [
                str(a.get("id"))
                for a in anchors
                if isinstance(a, dict) and a.get("id") is not None
            ]
            if anchor_ids:
                identity.dept_ids = list(dict.fromkeys([*identity.dept_ids, *anchor_ids]))
        return identity

    def dept_scope_anchors(self) -> list[dict[str, str]]:
        """解析 ``X-Mis-Dept-Scope`` 锚点集合（含 path，Worker 零查询）。

        Returns:
            形如 ``[{"id":"A","path":"/0/1/A/","scope":"dept_subtree"}]`` 的列表。
        """
        raw = self.raw_headers.get("X-Mis-Dept-Scope", "")
        if not raw:
            return []
        try:
            parsed: Any = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []
        if not isinstance(parsed, list):
            return []
        out: list[dict[str, str]] = []
        for item in parsed:
            if isinstance(item, dict) and item.get("id"):
                out.append(
                    {
                        "id": str(item.get("id")),
                        "path": str(item.get("path") or ""),
                        "scope": str(item.get("scope") or "dept_subtree"),
                    }
                )
        return out

    def store_codes_from_header(self) -> list[str]:
        """解析 ``X-Mis-Stores`` 可见门店集合（扁平 ENUM 一期）。"""
        raw = self.raw_headers.get("X-Mis-Stores", "")
        if not raw:
            return list(self.store_codes)
        try:
            parsed: Any = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return [v.strip() for v in raw.split(",") if v.strip()]
        if not isinstance(parsed, list):
            return []
        out: list[str] = []
        for item in parsed:
            if isinstance(item, dict):
                code = item.get("id") or item.get("code")
                if code:
                    out.append(str(code))
            elif isinstance(item, (str, int)):
                out.append(str(item))
        return out


@dataclass
class IqdScopeResolution:
    """范围裁定结果。

    Attributes:
        decision: allow / deny / partial。
        allowed_item_keys: 允许问数的表/语义键集合。
        denied_item_keys: 明确拒绝的键（partial 时非空）。
        reason: 拒绝原因（用户可见但**不透露具体表名**）。
        subject_summary: 主体摘要（审计用）。
        scope_payload: 原样透传给响应的 scope 段。
        row_scope_rules: **内部字段（不参与 wire）**：item_key → 行级维度实例列表。
    """

    decision: str = "allow"
    allowed_item_keys: list[str] = field(default_factory=list)
    denied_item_keys: list[str] = field(default_factory=list)
    reason: str | None = None
    subject_summary: str = ""
    scope_payload: dict[str, Any] = field(default_factory=dict)
    row_scope_rules: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    connection_id: int | None = None

    @property
    def is_denied(self) -> bool:
        """是否整体拒绝。"""
        return self.decision == "deny"

    @property
    def is_allowed(self) -> bool:
        """是否整体放行（允许集非空）。"""
        return self.decision == "allow" and bool(self.allowed_item_keys)

    @property
    def has_row_scope(self) -> bool:
        """是否存在命中本主体的行级条件。"""
        return bool(self.row_scope_rules)

    def to_payload(self) -> dict[str, Any]:
        """构造响应 scope 段（不含内部 row_scope_rules）。"""
        return {
            "decision": self.decision,
            "allowed_item_keys": list(self.allowed_item_keys),
            "denied_item_keys": list(self.denied_item_keys),
            "reason": self.reason,
            "subject_summary": self.subject_summary,
            "connection_id": self.connection_id,
        }


@dataclass
class RowScopeInjectOutcome:
    """行级注入执行结果（审计用）。

    Attributes:
        strategy: 本次注入使用的策略（PATH_PREFIX / ENUM / FAIL_CLOSED / NONE）。
        dimensions: 实际注入的维度码列表。
        sql: 注入后的最终 SQL（无命中时与原始 SQL 相同）。
        original_sql: 注入前 SQL。
        verdict: allow / deny（deny 时 sql 保持原始但上层不得执行）。
        denied_reason: 拒绝原因（fail-closed）。
    """

    strategy: str = PREDICATE_FAIL_CLOSED
    dimensions: list[str] = field(default_factory=list)
    sql: str = ""
    original_sql: str = ""
    verdict: str = "allow"
    denied_reason: str | None = None

    def to_payload(self) -> dict[str, Any]:
        """审计 resolved_scope.row_scope 段。"""
        return {
            "verdict": self.verdict,
            "strategy": self.strategy,
            "dimensions": list(self.dimensions),
            "original_sql": self.original_sql,
        }



@dataclass
class RowScopeDimension:
    """行级维度注册表条目（mis-iqd iqd_row_scope_dimension wire 同构）。"""

    dimension_code: str = ""
    dimension_name: str = ""
    predicate_type: str = PREDICATE_PATH_PREFIX
    column_name: str = ""
    header_name: str = ""
    param_whitelist: list[str] = field(default_factory=list)
    dict_table: str | None = None
    auto_mode: bool = True
    enabled: bool = True
    sort: int = 0

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> RowScopeDimension:
        """从 wire 字典构造（容错缺省）。"""
        whitelist = raw.get("param_whitelist")
        if isinstance(whitelist, str):
            try:
                whitelist = json.loads(whitelist)
            except (json.JSONDecodeError, TypeError):
                whitelist = []
        if not isinstance(whitelist, list):
            whitelist = []
        return cls(
            dimension_code=str(raw.get("dimension_code") or ""),
            dimension_name=str(raw.get("dimension_name") or ""),
            predicate_type=str(raw.get("predicate_type") or PREDICATE_PATH_PREFIX),
            column_name=str(raw.get("column_name") or ""),
            header_name=str(raw.get("header_name") or ""),
            param_whitelist=[str(v) for v in whitelist],
            dict_table=raw.get("dict_table"),
            auto_mode=bool(raw.get("auto_mode", True)),
            enabled=bool(raw.get("enabled", True)),
            sort=int(raw.get("sort") or 0),
        )


class ScopeResolver:
    """数据范围裁定器 + 行级注入器。

    Args:
        config_client: ``IqdConfigClient`` 实例（注入便于单测 mock；缺省懒加载）。
    """

    def __init__(self, config_client: Any | None = None) -> None:
        """初始化裁定器。"""
        self._config_client: Any = config_client
        self._dimensions: list[RowScopeDimension] | None = None

    # ================================================================ 前置裁定

    async def resolve_effective(
        self,
        identity: AskIdentity,
        connection_id: int | None = None,
        *,
        scope_hint: list[str] | None = None,
    ) -> IqdScopeResolution:
        """裁定当前身份可问的表集合（含模拟角色处理）。

        与 :meth:`resolve` 的区别：当身份处于**模拟角色**状态（B6 后台测试页
        ``metadata.iqd.simulate_role_code`` 有值）时：

        1. 先按**模拟后的 role_codes** 走常规 :meth:`resolve`（模拟该角色的数据范围
           裁定，行级注入走同一路径）；
        2. **安全约束（不放大权限）**：模拟只允许降权/等权——若模拟角色范围
           ⊄ 真实用户范围，按真实用户范围**收紧**（求交）；模拟角色范围完全不在
           真实范围内时 fail-closed 拒绝（45204）。

        实现要点：``resolve`` 消费的是 ``identity.role_codes``（``_subject_keys``），
        模拟身份已把 role_codes 覆写为 ``[simulated_role_code]``，故范围裁定与行级
        注入天然走同一路径；此处再与真实身份范围求交，保证模拟角色**绝不放大**权限。

        Args:
            identity: 问数身份（可能处于模拟状态）。
            connection_id: 指定连接；缺省取 enabled 连接。
            scope_hint: 后台测试页限定表集合（与允许集求交）。

        Returns:
            :class:`IqdScopeResolution`（模拟时已按真实范围收紧）。

        Raises:
            ScopeDeniedError: 无任何可问范围（fail-closed）；模拟范围超出真实范围。
        """
        if not identity.is_simulated():
            return await self.resolve(identity, connection_id, scope_hint=scope_hint)

        # 1) 模拟身份裁定：role_codes 已被 _build_identity 覆写为 [simulated_role_code]
        sim_scope = await self.resolve(identity, connection_id, scope_hint=scope_hint)

        # 2) 真实身份裁定：用于不放大权限校验（与模拟范围求交）
        real_scope = await self.resolve(
            identity.real_identity(), connection_id, scope_hint=scope_hint
        )

        real_allowed = set(real_scope.allowed_item_keys)
        effective = [key for key in sim_scope.allowed_item_keys if key in real_allowed]
        if not effective:
            logger.warning(
                "IQD simulate role out of real scope; fail-closed",
                simulated_role=identity.simulated_role_code,
                subject=identity.subject_summary(),
            )
            raise ScopeDeniedError("模拟角色无可问数据范围（超出真实用户权限）")

        # 收紧：模拟范围 ∩ 真实范围；行级规则只保留仍可问的表
        sim_scope.allowed_item_keys = effective
        sim_scope.row_scope_rules = {
            key: rules
            for key, rules in sim_scope.row_scope_rules.items()
            if key in real_allowed
        }
        sim_scope.subject_summary = identity.subject_summary()
        logger.info(
            "IQD simulate role scope resolved (tightened)",
            simulated_role=identity.simulated_role_code,
            allowed_count=len(effective),
        )
        return sim_scope

    async def resolve(
        self,
        identity: AskIdentity,
        connection_id: int | None = None,
        *,
        scope_hint: list[str] | None = None,
    ) -> IqdScopeResolution:
        """裁定当前身份可问的表集合。

        配置缓存不可得（连接未配置 / 回源失败）→ fail-closed ``45204``。

        Args:
            identity: 问数身份。
            connection_id: 指定连接；缺省取 enabled 连接。
            scope_hint: 后台测试页限定表集合（与允许集求交）。

        Returns:
            :class:`IqdScopeResolution`。

        Raises:
            ScopeDeniedError: 无任何可问范围（fail-closed）。
        """
        allowed, row_scope_rules, resolved_connection_id = await self._load_allowed_and_row_scope(
            identity, connection_id
        )
        subject = identity.subject_summary()

        if scope_hint:
            allowed = [k for k in allowed if k in set(scope_hint)]
            row_scope_rules = {
                k: v for k, v in row_scope_rules.items() if k in set(scope_hint)
            }

        if not allowed:
            resolution = IqdScopeResolution(
                decision="deny",
                allowed_item_keys=[],
                denied_item_keys=list(scope_hint or []),
                reason="当前角色无可问数据范围",
                subject_summary=subject,
                row_scope_rules=row_scope_rules,
                connection_id=resolved_connection_id,
            )
            logger.info(
                "IQD scope denied",
                subject=subject,
                connection_id=resolved_connection_id,
                scope_hint=scope_hint,
            )
            raise ScopeDeniedError("当前角色无可问数据范围")

        resolution = IqdScopeResolution(
            decision="allow",
            allowed_item_keys=allowed,
            denied_item_keys=[],
            subject_summary=subject,
            row_scope_rules=row_scope_rules,
            connection_id=resolved_connection_id,
        )
        logger.info(
            "IQD scope allowed",
            subject=subject,
            connection_id=connection_id,
            allowed_count=len(allowed),
            row_scope_tables=len(row_scope_rules),
        )
        return resolution

    async def preview_row_scope(
        self,
        identity: AskIdentity,
        connection_id: int | None = None,
        *,
        item_key: str | None = None,
        draft_rules: list[dict[str, Any]] | None = None,
        samples: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """**按身份生成真实的行级谓词预览**（与注入同源，非前端推导）。

        <p><b>为什么需要</b>（2026-09-28）：范围页的「模拟角色 WHERE 片段预览」此前无后端
        接口，前端只能按模板拼一个示意串（恒标 `degraded`）。但谓词的真实形态由
        :meth:`_build_authorized_predicate` 决定（PATH_PREFIX 走字典表 EXISTS、ENUM 走 IN），
        前端推导必然与实际注入不一致 —— 用户看到"配对了"其实并没有。

        <p>本方法**复用同一套构造逻辑**（同一个 :meth:`_build_authorized_predicate`），
        因此预览与实际注入逐字一致。

        Args:
            identity: 问数身份（模拟角色时已由调用方覆写 role_codes）。
            connection_id: 指定连接；缺省取 enabled。
            item_key: 只看某张表（catalog item_key / 表名）；缺省返回全部命中表。
            draft_rules: 未保存的草稿规则（``[{item_key, row_scope}]``）；非空时**不查库**，
                直接按草稿规则生成预览（供范围页编辑态使用）。
            samples: 逐维度示意实参 ``{dimension: {path?, values?}}``；仅替换该维度的取值
                来源，谓词仍由 :meth:`_build_authorized_predicate` 生成（形态与真实一致）。

        Returns:
            ``{"items": [{item_key, dimensions, predicates, where, strategy, denied_reason,
            source}], "degraded": False, "note": ...}``；某表无行级规则 →
            ``predicates=[]``、``where=""``（该表全行可见）。
        """
        dimensions = await self._load_dimensions()
        dim_map: dict[str, RowScopeDimension] = {
            d.dimension_code: d for d in dimensions if d.enabled
        }

        resolution: IqdScopeResolution | None = None
        denied_reason: str | None = None
        if draft_rules is None:
            try:
                resolution = await self.resolve(identity, connection_id)
            except ScopeDeniedError as exc:
                denied_reason = str(exc)
            rules: dict[str, list[dict[str, Any]]] = (
                (resolution.row_scope_rules if resolution else {}) or {}
            )
            source = "identity"
        else:
            # 编辑态：按草稿规则预览，不查库（避免未保存即依赖落库读回）。
            rules = self._draft_rules_to_map(draft_rules)
            source = "draft"

        targets: list[str] = [item_key] if item_key else list(rules.keys())
        sample_map = samples or {}

        items: list[dict[str, Any]] = []
        for table in targets:
            table_rules = rules.get(table) or []
            predicates: list[str] = []
            applied: list[str] = []
            strategies: list[str] = []
            item_denied = denied_reason
            table_source = source
            for rule in table_rules:
                for inst in self._extract_dimensions(rule):
                    dim_code = str(inst.get("dimension") or "")
                    dim = dim_map.get(dim_code)
                    if dim is None:
                        item_denied = item_denied or f"维度未配置: {dim_code}"
                        continue
                    sample = sample_map.get(dim_code)
                    dim_identity = self._identity_with_sample(dim, identity, sample)
                    if sample and (
                        str(sample.get("path") or "").strip()
                        or any(str(v).strip() for v in (sample.get("values") or []))
                    ):
                        table_source = "draft+sample"
                    selected = await self.resolve_inject_strategy(dim, dim_identity)
                    if selected == PREDICATE_FAIL_CLOSED:
                        item_denied = item_denied or self._fail_closed_reason(
                            dim, dim_identity
                        )
                        continue
                    if selected not in strategies:
                        strategies.append(selected)
                    if dim_code not in applied:
                        applied.append(dim_code)
                    predicate = self._build_authorized_predicate(
                        dim, dim_identity, selected
                    )
                    if predicate:
                        predicates.append(predicate)
                    else:
                        item_denied = item_denied or f"缺少维度授权范围: {dim_code}"
            items.append(
                {
                    "item_key": table,
                    "dimensions": applied,
                    "predicates": predicates,
                    "where": " AND ".join(f"({p})" for p in predicates),
                    # 多维度可能各自命中不同策略，逗号列出（无则 NONE）。
                    "strategy": ", ".join(strategies) if strategies else "NONE",
                    "denied_reason": item_denied,
                    "source": table_source,
                }
            )

        return {
            "items": items,
            "degraded": False,
            "note": (
                "后端按当前身份**真实生成**的行级谓词（与注入同源，逐字一致）；"
                "模拟角色时 role_codes 已按 simulate_role_code 覆写；"
                "草稿/示意实参只替换取值来源，谓词形态仍由引擎生成。"
            ),
            "subject": identity.subject_summary(),
            "connection_id": resolution.connection_id if resolution else connection_id,
        }

    @staticmethod
    def _draft_rules_to_map(
        draft_rules: list[dict[str, Any]] | None,
    ) -> dict[str, list[dict[str, Any]]]:
        """草稿规则列表 → ``{item_key: [rule]}``（row_scope 支持 dict 或 JSON 串）。"""
        out: dict[str, list[dict[str, Any]]] = {}
        for entry in draft_rules or []:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("item_key") or "").strip()
            if not key:
                continue
            raw = entry.get("row_scope")
            rule: dict[str, Any] | None = None
            if isinstance(raw, dict):
                rule = raw
            elif isinstance(raw, str) and raw.strip():
                try:
                    parsed = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    parsed = None
                if isinstance(parsed, dict):
                    rule = parsed
            out.setdefault(key, [])
            if rule:
                out[key].append(rule)
        return out

    @staticmethod
    def _identity_with_sample(
        dimension: RowScopeDimension,
        identity: AskIdentity,
        sample: dict[str, Any] | None,
    ) -> AskIdentity:
        """按示意实参派生身份副本（仅替换该维度的取值来源，形态仍由引擎生成）。"""
        if not sample:
            return identity
        raw = dict(identity.raw_headers)
        path = str(sample.get("path") or "").strip()
        values = [str(v).strip() for v in (sample.get("values") or []) if str(v).strip()]
        if dimension.predicate_type == PREDICATE_PATH_PREFIX and path:
            anchors = identity.dept_scope_anchors()
            anchor_id = (anchors[0].get("id") if anchors else "") or "sample"
            raw["X-Mis-Dept-Scope"] = json.dumps(
                [{"id": anchor_id, "path": path, "scope": "sample"}]
            )
        elif dimension.predicate_type == PREDICATE_ENUM and values:
            if dimension.column_name == "dept_id" or dimension.dimension_code == "dept":
                raw["X-Mis-Dept-Scope"] = json.dumps([{"id": v} for v in values])
            else:
                raw["X-Mis-Stores"] = ",".join(values)
        else:
            return identity
        return AskIdentity(
            user_id=identity.user_id,
            employee_id=identity.employee_id,
            role_codes=list(identity.role_codes),
            dept_ids=list(identity.dept_ids),
            store_codes=list(identity.store_codes),
            org_ids=list(identity.org_ids),
            raw_headers=raw,
            simulated_role_code=identity.simulated_role_code,
            real_role_codes=list(identity.real_role_codes),
        )

    # ================================================================ 后置断言

    def assert_sql_within_scope(
        self,
        lineage: list[str],
        resolution: IqdScopeResolution,
        *,
        extra_allowed: list[str] | None = None,
    ) -> None:
        """后置血缘断言：SQL 涉及的表必须都在允许集内。

        Args:
            lineage: :class:`LineageExtractor` 产出的表 item_key 列表。
            resolution: 前置裁定结果。
            extra_allowed: 本轮补充放行键（如 describe 成功的 Wren 模型名）。

        Raises:
            ScopeDeniedError: 血缘含越权表（fail-closed，不透露表名）。
        """
        if not lineage:
            # 无血缘信息（如纯 SELECT 1）时按放行处理
            return
        allowed = set(resolution.allowed_item_keys)
        if extra_allowed:
            allowed.update(extra_allowed)
        allowed_shorts = {a.rsplit(".", 1)[-1].lower() for a in allowed if a}

        def _in_scope(key: str) -> bool:
            if key in allowed:
                return True
            short = key.rsplit(".", 1)[-1].lower()
            return bool(short) and short in allowed_shorts

        denied = [key for key in lineage if not _in_scope(key)]
        if denied:
            # 运维可查：不回传给用户（对外文案仍泛化），但日志需能定位越权表/模型名。
            logger.warning(
                "IQD scope assertion failed",
                denied_count=len(denied),
                denied_keys=denied[:20],
                allowed_count=len(allowed),
                subject=resolution.subject_summary,
            )
            raise ScopeDeniedError("当前角色无权查询相关数据")

    # ================================================================ 行级注入（W2）


    def _effective_column(self, dim: RowScopeDimension, inst: dict[str, Any]) -> str:
        """Resolve effective column name for a dimension instance.

        Priority: object-level ``column`` (in row_scope dimensions array) >
        dimension global ``column_name``.

        Raises:
            ScopeDeniedError: column override fails the whitelist regex.
        """
        override = str(inst.get("column") or "").strip()
        if override:
            if not _COL_NAME_RE.match(override):
                raise ScopeDeniedError(
                    f"行级覆盖列名非法（仅允许字母、数字、下划线）: {override}"
                )
            return override
        return dim.column_name

    async def inject_row_scope(
        self,
        sql: str,
        dialect: str,
        resolution: IqdScopeResolution,
        identity: AskIdentity,
    ) -> RowScopeInjectOutcome:
        """对 SQL 按命中表行级规则做维度遍历注入（多维度 AND 叠加）。

        流程：解析表引用 → 逐表取维度实例 → 每维度 ``resolve_inject_strategy``
        → ``_build_authorized_predicate`` 生成谓词 → 改写表引用为内联派生表
        （``(SELECT * FROM t WHERE P) AS alias``，保持 JOIN/LEFT/UNION/CTE 语义）
        → 任一维度失败（头缺失 / 越权 / 超阈值 / 解析失败）→ fail-closed ``45204``。

        Args:
            sql: 生成的 SQL（未注入）。
            dialect: SQL 方言。
            resolution: 前置裁定结果（含 row_scope_rules）。
            identity: 问数身份（头取值源）。

        Returns:
            :class:`RowScopeInjectOutcome`（verdict=deny 时上层不得执行）。

        Raises:
            ScopeDeniedError: 任一维度注入失败（fail-closed）。
        """
        original = (sql or "").strip()
        outcome = RowScopeInjectOutcome(
            strategy="NONE",
            sql=original,
            original_sql=original,
        )
        if not resolution.has_row_scope:
            # 空 SQL 属于上游未产出可执行语句，仍 fail-closed（不得静默放行）。
            if not original:
                raise ScopeDeniedError("待注入 SQL 为空，拒绝执行")
            # 无命中本主体的行级规则 → 表级已授权即可全行可见（行级范围是可选的叠加约束）。
            # fail-closed 仅发生在下方「命中规则但取不到维度取值」的分支，不在此处整体拒绝；
            # 否则「范围与权限」已授权但未配行级规则的表会被误判为 0 张授权表。
            if identity.data_scope_all:
                logger.info("IQD row scope: data_scope=all, skip injection")
            return outcome

        dimensions = await self._load_dimensions()
        dim_map: dict[str, RowScopeDimension] = {
            d.dimension_code: d for d in dimensions if d.enabled
        }

        # 解析表引用（sqlglot 优先，正则兜底）
        table_refs = self._parse_table_refs(original, dialect)
        if not table_refs:
            # 解析失败 / 表识别不出 → fail-closed
            logger.warning("IQD row scope inject: cannot parse tables", sql=original)
            outcome.verdict = "deny"
            outcome.denied_reason = "SQL 解析失败，无法执行行级范围校验"
            outcome.strategy = PREDICATE_FAIL_CLOSED
            return outcome

        injected = original
        applied_dimensions: list[str] = []
        strategy = "NONE"

        for table_name, alias in table_refs:
            rules = resolution.row_scope_rules.get(table_name) or resolution.row_scope_rules.get(
                alias
            )
            if not rules:
                continue
            predicates: list[str] = []
            for rule in rules:
                dimension_instances = self._extract_dimensions(rule)
                for inst in dimension_instances:
                    dim_code = str(inst.get("dimension") or "")
                    dim = dim_map.get(dim_code)
                    if dim is None:
                        logger.warning("IQD row scope unknown dimension", dimension=dim_code)
                        outcome.verdict = "deny"
                        outcome.denied_reason = "行级范围维度未配置"
                        outcome.strategy = PREDICATE_FAIL_CLOSED
                        return outcome

                    selected = await self.resolve_inject_strategy(
                        dim, identity, dialect=dialect
                    )
                    if selected == PREDICATE_FAIL_CLOSED:
                        outcome.verdict = "deny"
                        outcome.denied_reason = "当前维度数据范围过大或不可解析"
                        outcome.strategy = PREDICATE_FAIL_CLOSED
                        return outcome
                    strategy = selected
                    if dim_code not in applied_dimensions:
                        applied_dimensions.append(dim_code)

                    eff_col = self._effective_column(dim, inst)

                    # ENUM (flat dims e.g. store): translate MIS ids -> external codes via mapping.
                    enum_values: list[str] | None = None
                    if selected == PREDICATE_ENUM:
                        enum_values = await self._resolve_mapped_enum_values(
                            dim, identity, resolution.connection_id
                        )
                        if enum_values is not None and not enum_values:
                            logger.warning(
                                "IQD row scope mapping resolved empty; fail-closed",
                                dimension=dim_code,
                                connection_id=resolution.connection_id,
                            )
                            outcome.verdict = "deny"
                            outcome.denied_reason = "dimension values have no mapping"
                            outcome.strategy = PREDICATE_FAIL_CLOSED
                            return outcome

                    # P1-4：注入前检查用户 SQL 显式引用受控列值是否越权。
                    # 授权集合内幂等放行；集合外任一值 → 45204 拒绝（不静默空集）。
                    unauthorized = self._explicit_unauthorized_values(
                        original, dim, identity, selected,
                        column=eff_col, enum_values=enum_values, dialect=dialect
                    )
                    if unauthorized:
                        logger.warning(
                            "IQD row scope explicit unauthorized ref",
                            dimension=dim_code,
                            values=unauthorized,
                        )
                        outcome.verdict = "deny"
                        outcome.denied_reason = "显式引用了未授权的数据范围"
                        outcome.strategy = PREDICATE_FAIL_CLOSED
                        return outcome

                    predicate = self._build_authorized_predicate(
                        dim, identity, selected, alias=alias, column=eff_col, enum_values=enum_values
                    )
                    if not predicate:
                        outcome.verdict = "deny"
                        outcome.denied_reason = "当前身份缺少该维度授权范围"
                        outcome.strategy = PREDICATE_FAIL_CLOSED
                        return outcome
                    predicates.append(predicate)

            if not predicates:
                continue
            combined = " AND ".join(f"({p})" for p in predicates)
            injected = self._rewrite_table_ref(injected, dialect, table_name, alias, combined)
            if injected == original:
                outcome.verdict = "deny"
                outcome.denied_reason = "行级范围注入失败（表引用改写失败）"
                outcome.strategy = PREDICATE_FAIL_CLOSED
                return outcome

        if applied_dimensions:
            outcome.strategy = strategy
            outcome.dimensions = applied_dimensions
            outcome.sql = injected
            logger.info(
                "IQD row scope injected",
                strategy=strategy,
                dimensions=applied_dimensions,
            )
        return outcome

    async def _resolve_mapped_enum_values(
        self,
        dimension: RowScopeDimension,
        identity: AskIdentity,
        connection_id: int | None,
    ) -> list[str] | None:
        """? ENUM ??? MIS ???????????????????????

        ???
          - ``None``?????????? / ?????? ????? header ??????????
          - ``list``?????????? ? ??? fail-closed??
        """
        if connection_id is None:
            return None
        raw_values = self._enum_authorized_values(dimension, identity)
        if not raw_values:
            return None
        try:
            client = self._get_client()
            data = await client.resolve_dimension_values(
                int(connection_id), dimension.dimension_code, list(raw_values)
            )
        except Exception as exc:  # noqa: BLE001 - ???????????????dept ??????
            logger.warning(
                "IQD dimension value mapping unavailable; fall back to header values",
                dimension=dimension.dimension_code,
                connection_id=connection_id,
                error=str(exc),
            )
            return None
        resolved = data.get("resolved") if isinstance(data, dict) else None
        if not isinstance(resolved, list):
            return None
        return [str(v) for v in resolved if v is not None and str(v).strip()]

    async def resolve_inject_strategy(
        self,
        dimension: RowScopeDimension,
        identity: AskIdentity,
        *,
        dialect: str = "postgres",
    ) -> str:
        """按维度注册表 predicate_type 选择注入策略。

        - PATH_PREFIX：部门主路径（物化 dept_path，与规模无关，唯一主路径）。
        - ENUM：扁平可见集合 ≤ ENUM_LIMIT(500)（store 一期默认；dept 降级）。
        - FAIL_CLOSED：>500 且无层级 / 解析失败。

        Args:
            dimension: 维度注册表条目。
            identity: 问数身份。
            dialect: SQL 方言。

        Returns:
            PATH_PREFIX / ENUM / FAIL_CLOSED。
        """
        predicate_type = dimension.predicate_type
        if predicate_type == PREDICATE_PATH_PREFIX:
            anchors = identity.dept_scope_anchors()
            if not anchors:
                # 维度已配但请求无对应头 → fail-closed（不降级为全行可见）
                return PREDICATE_FAIL_CLOSED
            has_path = any(a.get("path") for a in anchors)
            if not has_path:
                # dept 无 path 时降级 ENUM（若集合 ≤ 500）
                if len(anchors) <= ENUM_LIMIT:
                    return PREDICATE_ENUM
                return PREDICATE_FAIL_CLOSED
            return PREDICATE_PATH_PREFIX

        if predicate_type == PREDICATE_ENUM:
            # P1-6：按维度取对应锚点集合——dept 用 X-Mis-Dept-Scope，store 用 X-Mis-Stores
            values = self._enum_authorized_values(dimension, identity)
            if not values:
                return PREDICATE_FAIL_CLOSED
            if len(values) > ENUM_LIMIT:
                return PREDICATE_FAIL_CLOSED
            return PREDICATE_ENUM

        return PREDICATE_FAIL_CLOSED

    def _build_authorized_predicate(
        self,
        dimension: RowScopeDimension,
        identity: AskIdentity,
        strategy: str,
        *,
        alias: str = "",
        column=None,
        enum_values=None,
    ) -> str:
        """按维度策略生成授权谓词。

        - PATH_PREFIX（dept 主路径，2a 形态）::

              EXISTS (SELECT 1 FROM mis_dept_scope rs
                      WHERE rs.dept_id = {alias}.dept_id
                        AND (rs.dept_path = '/0/1/A/' OR rs.dept_path LIKE '/0/1/A/%'))

          无字典表时回退 ENUM 形态（rs 为保留字典别名，避免与外层别名冲突）。
        - ENUM（store/dept 扁平）::

              {alias}.store_id IN ('S1','S2')

        Args:
            dimension: 维度注册表条目。
            identity: 问数身份。
            strategy: PATH_PREFIX / ENUM。
            alias: 表别名（注入谓词列引用前缀；空则用裸列名）。

        Returns:
            SQL 谓词；无授权值返回空串。
        """
        col = column or dimension.column_name
        qualifier = f"{alias}." if alias else ""
        if strategy == PREDICATE_PATH_PREFIX:
            anchors = identity.dept_scope_anchors()
            if not anchors:
                return ""
            if dimension.dict_table:
                # 字典表别名用保留字 'rs'（与用户表别名隔离），避免外层别名恰为 'd'
                # 时谓词退化为自引用（d.dept_id = d.dept_id，行级过滤失效）
                branches: list[str] = []
                for a in anchors:
                    path = a.get("path") or ""
                    if path:
                        like_path = path.rstrip("/") + "/%"
                        branches.append(
                            f"(rs.dept_path = '{path}' OR rs.dept_path LIKE '{like_path}')"
                        )
                    else:
                        branches.append(f"rs.dept_id = '{a.get('id')}'")
                if not branches:
                    return ""
                return (
                    f"EXISTS (SELECT 1 FROM {dimension.dict_table} rs "
                    f"WHERE rs.dept_id = {qualifier}{col} "
                    f"AND ({' OR '.join(branches)}))"
                )
            # 无字典表：ENUM 回退
            values = [a.get("id") for a in anchors if a.get("id")]
            if not values:
                return ""
            in_list = ", ".join(_quote(v) for v in values)
            return f"{qualifier}{col} IN ({in_list})"

        if strategy == PREDICATE_ENUM:
            # prefer mapped external codes (enum_values) when provided
            values = (
                enum_values
                if enum_values is not None
                else self._enum_authorized_values(dimension, identity)
            )
            if not values:
                return ""
            in_list = ", ".join(_quote(v) for v in values)
            return f"{qualifier}{col} IN ({in_list})"

        return ""

    @staticmethod
    def _fail_closed_reason(
        dimension: RowScopeDimension, identity: AskIdentity
    ) -> str:
        """当前维度数据范围过大或不可解析 / 缺少维度授权范围 的成因文案。"""
        if dimension.predicate_type == PREDICATE_PATH_PREFIX:
            if not identity.dept_scope_anchors():
                return f"缺少维度授权范围: {dimension.dimension_code}"
        else:
            if dimension.column_name == "dept_id" or dimension.dimension_code == "dept":
                has_values = bool(
                    [a for a in identity.dept_scope_anchors() if a.get("id")]
                )
            else:
                has_values = bool(identity.store_codes_from_header())
            if not has_values:
                return f"缺少维度授权范围: {dimension.dimension_code}"
        return f"当前维度数据范围过大或不可解析: {dimension.dimension_code}"

    def _enum_authorized_values(
        self, dimension: RowScopeDimension, identity: AskIdentity
    ) -> list[str]:
        """按维度取 ENUM 扁平授权集合（P1-6：维度来源与列一一对应）。

        - dept 维度：``X-Mis-Dept-Scope`` 锚点 id 集合；
        - store 维度：``X-Mis-Stores`` 可见门店集合；
        - 其余维度：回退 ``store_codes_from_header``（保持历史兼容）。
        """
        if dimension.column_name == "dept_id" or dimension.dimension_code == "dept":
            return [a.get("id") for a in identity.dept_scope_anchors() if a.get("id")]
        return identity.store_codes_from_header()

    def _value_within_authorized(
        self,
        value: str,
        dimension: RowScopeDimension,
        identity: AskIdentity,
        strategy: str,
    ) -> bool:
        """判断显式引用值是否在授权集合内。

        - PATH_PREFIX（dept 主路径）：命中锚点 id 或其层级子 id（前缀约定，如
          ``A`` → ``A1``/``A2``）即视为授权范围内（幂等放行；行过滤仍由派生表兜底）；
        - ENUM 及其余：仅允许授权集合内精确匹配。
        """
        authorized = self._enum_authorized_values(dimension, identity)
        if not authorized:
            return False
        if strategy == PREDICATE_PATH_PREFIX:
            return any(value == a or value.startswith(a) for a in authorized)
        return value in authorized

    def _explicit_unauthorized_values(
        self,
        sql: str,
        dimension: RowScopeDimension,
        identity: AskIdentity,
        strategy: str,
        *,
        column=None,
        enum_values=None,
        dialect: str = "postgres",
    ) -> list[str]:
        """扫描用户 SQL 显式引用受控列的取值，返回其中不在授权集合内的值。

        仅识别等值 / IN 形态（``{col} = 'v'``、``{col} IN ('v1','v2')``）；
        授权集合内幂等放行，集合外任一值由调用方以 45204 拒绝（P1-4）。
        无法解析/无受控列时保守返回空（依赖注入后派生表过滤兜底，不阻断正常查询）。

        Args:
            sql: 注入前原始 SQL。
            dimension: 维度注册表条目。
            identity: 问数身份。
            strategy: 已选注入策略（PATH_PREFIX / ENUM）。
            dialect: SQL 方言（保留参数，当前实现与方言无关）。

        Returns:
            越权引用值列表；空表示未发现显式越权引用。
        """
        col = column or dimension.column_name
        if not col or not sql:
            return []
        authorized = enum_values if enum_values is not None else self._enum_authorized_values(
            dimension, identity
        )
        if not authorized:
            return []
        values: list[str] = []

        def _looks_like_column_ref(token: str) -> bool:
            """形如 ``d.dept_id`` 的限定列引用（非字面量）跳过。"""
            if "." not in token:
                return False
            try:
                float(token)
                return False
            except ValueError:
                return True

        # 等值形态：col = 'v' / col = "v" / col = 123
        eq = re.compile(
            rf"\b{re.escape(col)}\s*=\s*(?:'([^']*)'|\"([^\"]*)\"|([A-Za-z0-9_.\-]+))",
            re.IGNORECASE,
        )
        for m in eq.finditer(sql):
            token = m.group(1) or m.group(2) or m.group(3) or ""
            if token and not _looks_like_column_ref(token):
                values.append(token)

        # IN 形态：col IN ('v1','v2') / col IN (1,2)
        inn = re.compile(rf"\b{re.escape(col)}\s+IN\s*\(([^)]*)\)", re.IGNORECASE)
        for m in inn.finditer(sql):
            inner = m.group(1)
            for tok in inner.split(","):
                tok = tok.strip().strip("'").strip('"')
                if tok and not _looks_like_column_ref(tok):
                    values.append(tok)

        return [
            v for v in values if not self._value_within_authorized(v, dimension, identity, strategy)
        ]

    # ================================================================ SQL 改写

    def _parse_table_refs(self, sql: str, dialect: str) -> list[tuple[str, str]]:
        """解析 SQL 顶层/子查询/CTE/UNION 中的表引用（去重保序）。

        Returns:
            ``[(item_key, alias), ...]``；解析失败返回空列表。
        """
        try:
            return self._parse_table_refs_sqlglot(sql, dialect)
        except Exception as exc:  # noqa: BLE001 - 解析失败降级正则
            logger.debug("sqlglot table refs failed; fallback regex", error=str(exc))
            return self._parse_table_refs_regex(sql)

    def _parse_table_refs_sqlglot(self, sql: str, dialect: str) -> list[tuple[str, str]]:
        """sqlglot 解析表引用（含 FROM / JOIN / CTE / UNION 分支）。"""
        import sqlglot

        expression = sqlglot.parse_one(sql, read=dialect or "postgres")
        refs: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for node in expression.find_all(sqlglot.exp.Table):
            # P0-3：用 catalog/db/name 重建完整表名（不含别名），避免 node.sql()
            # 返回 'pg_main.public.orders AS o' 导致与规则 key 不匹配、JOIN 表跳过注入
            name = _normalize_table(self._table_full_name(node))
            if not name:
                continue
            alias = str(node.alias or node.name or name)
            key = (name, alias)
            if key in seen:
                continue
            seen.add(key)
            refs.append(key)
        return refs

    def _parse_table_refs_regex(self, sql: str) -> list[tuple[str, str]]:
        """正则兜底：FROM/JOIN 表名 + 可选 AS 别名。"""
        pattern = re.compile(
            r"(?:from|join)\s+([A-Za-z0-9_\"`.]+(?:\.[A-Za-z0-9_\"`.]+){0,3})"
            r"(?:\s+(?:as\s+)?([A-Za-z0-9_]+))?",
            re.IGNORECASE,
        )
        refs: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for match in pattern.finditer(sql or ""):
            name = _normalize_table(match.group(1))
            if not name:
                continue
            alias = match.group(2) or name.split(".")[-1]
            key = (name, alias)
            if key in seen:
                continue
            seen.add(key)
            refs.append(key)
        return refs

    def _rewrite_table_ref(
        self,
        sql: str,
        dialect: str,
        table_name: str,
        alias: str,
        predicate: str,
    ) -> str:
        """把表引用改写为内联派生表 ``(SELECT * FROM t WHERE P) AS alias``。

        保持 JOIN/LEFT/UNION/CTE 语义；sqlglot 失败时返回原始 SQL（由调用方判 fail-closed）。
        """
        try:
            return self._rewrite_with_sqlglot(sql, dialect, table_name, alias, predicate)
        except Exception as exc:  # noqa: BLE001
            logger.debug("sqlglot rewrite failed", error=str(exc))
            return self._rewrite_with_regex(sql, table_name, alias, predicate)

    def _rewrite_with_sqlglot(
        self,
        sql: str,
        dialect: str,
        table_name: str,
        alias: str,
        predicate: str,
    ) -> str:
        """sqlglot 改写：按**表名**匹配 Table 节点，替换为派生表。

        只按完整表名（或未限定表名末段）匹配，**不用别名匹配**——否则会误命中
        注入谓词内部的字典表（如 ``mis_dept_scope d``，别名恰为 d）导致递归改写、
        谓词自引用（``d.dept_id = d.dept_id``）的严重损坏（P0-3 回归修复）。
        """
        import sqlglot
        from sqlglot import exp

        expression = sqlglot.parse_one(sql, read=dialect or "postgres")
        table_last = table_name.split(".")[-1]
        replaced = False
        for node in expression.find_all(exp.Table):
            full = _normalize_table(self._table_full_name(node))
            if full == table_name:
                matched = True
            elif not node.catalog and not node.db and str(node.name) == table_last:
                # 未限定表名（FROM orders）匹配规则键末段（pg_main.public.orders）
                matched = True
            else:
                matched = False
            if not matched:
                continue
            sub = f"(SELECT * FROM {table_name} WHERE {predicate}) AS {alias}"
            replacement = sqlglot.parse_one(sub, read=dialect or "postgres")
            node.replace(replacement)
            replaced = True
        if not replaced:
            return sql
        return expression.sql(dialect=dialect or "postgres", pretty=False)

    def _rewrite_with_regex(self, sql: str, table_name: str, alias: str, predicate: str) -> str:
        """正则兜底：仅处理 ``FROM t [AS] alias`` 顶层形态。"""
        escaped = re.escape(table_name)
        alias_part = re.escape(alias)
        # FROM t AS alias / FROM t alias / FROM t（当 alias==末段表名）
        patterns = [
            re.compile(
                rf"(from\s+{escaped}\s+(?:as\s+)?{alias_part}\b)", re.IGNORECASE
            ),
            re.compile(rf"(from\s+{escaped}\b)", re.IGNORECASE),
        ]
        replacement = f"(SELECT * FROM {table_name} WHERE {predicate}) AS {alias}"
        for pattern in patterns:
            if pattern.search(sql or ""):
                return pattern.sub(replacement, sql, count=1)
        return sql

    # ================================================================ 配置加载

    async def _load_allowed_and_row_scope(
        self, identity: AskIdentity, connection_id: int | None
    ) -> tuple[list[str], dict[str, list[dict[str, Any]]]]:
        """从配置缓存读取允许键集合与行级规则（scope_policy ∩ acl ∩ in_scope）。

        - scope_policy（治理层）：subject_type=global 或命中主体 → 表进入可问集合；
        - table_acl（授权层）：action=ask 授权 → 该主体可问；row_scope 非空 → 行级条件；
        - iqd_catalog_item.in_scope：治理勾选（与 global scope_policy 一致，防御性求交）。
        - 允许集合 = 治理集 ∩ (主体 ask 授权集)；有 ACL 行时严格求交（越权 45204）；
          无 ACL 行时按治理集放行（W1 期无 ACL 数据的空窗兼容）。

        Returns:
            ``(allowed_item_keys, row_scope_rules, resolved_connection_id)``。

        Raises:
            WrenaiNotConfiguredError: 无 enabled 连接。
            ScopeDeniedError: 配置缓存不可得（fail-closed）。
        """
        from src.adapters.iqd_config_client import IqdConfigClientError

        client = self._get_client()
        try:
            configs = await client.load_configs()
            if not configs:
                from src.agent.mis_iqd.errors import WrenaiNotConfiguredError

                raise WrenaiNotConfiguredError()
            conn = self._pick_connection(configs, connection_id)
            cid: int = int(conn.get("id"))
            policies_raw = await client.get_scope_policies(cid)
            acls_raw = await client.get_acls(cid)
            in_scope_raw = await client.get_catalog_in_scope(cid)
        except IqdConfigClientError as exc:
            logger.warning("IQD config cache unavailable; fail-closed", error=str(exc))
            raise ScopeDeniedError("当前角色无可问数据范围") from exc

        # ---- 治理层：global scope_policy ∩ catalog in_scope（两表一致，防御性求交）
        policy_keys: set[str] = set()
        subject_keys = _subject_keys(identity)
        for raw in policies_raw:
            if not isinstance(raw, dict):
                continue
            if not _is_effective(raw):
                continue
            stype = str(raw.get("subject_type") or "")
            sid = str(raw.get("subject_id") or "")
            item_key = str(raw.get("item_key") or "")
            if not item_key:
                continue
            if stype == SUBJECT_GLOBAL or (stype, sid) in subject_keys:
                if bool(raw.get("allow", True)):
                    policy_keys.add(item_key)

        in_scope_keys: set[str] = {
            str(item.get("item_key") or "")
            for item in in_scope_raw
            if isinstance(item, dict)
        }
        in_scope_keys.discard("")
        # 治理层 = 策略集 ∩ 全局 in_scope（防御性求交，防两处表示漂移）。
        # <p><b>空窗兼容</b>：`in_scope` 是「全局纳入问数范围」层，由**清单页**勾选维护；
        # 新连接若尚未做全局勾选，`in_scope_keys` 为空。此时若仍求交会把主体（角色/部门/用户）
        # 的范围模板与 ask ACL **整体清零** —— 表现为「范围页已授权、问数测试台却 0 张授权表」
        # （2026-09-30 实测：连接 1790686095967 有 81 条 role 策略 + 3 条 ask ACL，但 in_scope=0）。
        # 与下方 ACL 的“无 ACL 数据空窗”同源口径：**全局层未配置时不作为外层约束**，
        # 由主体层（范围模板 ∪ ask ACL）放行；全局层一旦配置，仍严格求交。
        governance = policy_keys & in_scope_keys if in_scope_keys else policy_keys

        # ---- 行级范围（原表级 ACL 表）：只承载 row_scope，不再参与 grant 裁定。
        # 2026-10-01 语义收敛（方案 A）：谁能问哪张表/哪个字段，只由 iqd_scope_policy
        # （范围策略）负责；iqd_table_acl 收缩为「行级范围」专用——给已在范围内的对象
        # 叠加 row_scope 行条件。故 allowed 直接取治理集，不再与 acl_ask 求交。
        row_scope_rules: dict[str, list[dict[str, Any]]] = {}
        for raw in acls_raw:
            if not isinstance(raw, dict):
                continue
            if str(raw.get("action") or "") != "ask":
                continue
            stype = str(raw.get("subject_type") or "")
            sid = str(raw.get("subject_id") or "")
            item_key = str(raw.get("item_key") or "")
            if not item_key:
                continue
            if (stype, sid) not in subject_keys and stype != SUBJECT_GLOBAL:
                continue
            row_scope = raw.get("row_scope")
            if row_scope:
                row_scope_rules.setdefault(item_key, []).append(
                    row_scope if isinstance(row_scope, dict) else {}
                )

        allowed = sorted(governance)
        # 行级规则只对「范围内」对象生效；范围外对象的 row_scope 视为死行。
        row_scope_rules = {k: v for k, v in row_scope_rules.items() if k in allowed}

        return allowed, row_scope_rules, cid

    @staticmethod
    def _pick_connection(configs: list[dict[str, Any]], connection_id: int | None) -> dict[str, Any]:
        """取连接：优先指定 id → 第一条 enabled=1 → 任意第一条（对齐 Java findPrimaryConnection）。"""
        if connection_id is not None:
            for conn in configs:
                try:
                    if int(conn.get("id")) == int(connection_id):
                        return conn
                except (TypeError, ValueError):
                    continue
        for conn in configs:
            if _as_bool(conn.get("enabled")):
                return conn
        return configs[0]

    async def _load_dimensions(self) -> list[RowScopeDimension]:
        """从配置缓存读取维度注册表（缺省回退内置种子）。"""
        if self._dimensions is not None:
            return self._dimensions
        from src.adapters.iqd_config_client import IqdConfigClientError

        client = self._get_client()
        try:
            raw_dims = await client.get_dimensions()
        except IqdConfigClientError as exc:
            logger.warning("IQD dimensions unavailable; use builtin seeds", error=str(exc))
            raw_dims = []
        dims = [RowScopeDimension.from_dict(d) for d in raw_dims if isinstance(d, dict)]
        if not dims:
            dims = _builtin_dimensions()
        self._dimensions = dims
        return dims

    def _get_client(self) -> Any:
        """懒加载 IqdConfigClient（便于单测注入 mock）。"""
        if self._config_client is None:
            from src.adapters.iqd_config_client import IqdConfigClient

            self._config_client = IqdConfigClient()
        return self._config_client

    # ================================================================ 内部

    @staticmethod
    def _table_full_name(node: Any) -> str:
        """从 sqlglot Table 节点取完整表名（catalog.db.name，不含别名）。

        与 ``node.sql()`` 不同，不会把 ``AS alias`` 并入表名，保证与
        ``ds.sch.modelName`` 形态的 item_key 精确匹配（P0-3）。
        """
        parts: list[str] = []
        for attr in ("catalog", "db", "name"):
            try:
                val = getattr(node, attr, None)
            except Exception:  # noqa: BLE001 - 容错取不到即跳过
                val = None
            if val:
                parts.append(str(val))
        return ".".join(parts)

    @staticmethod
    def _extract_dimensions(rule: dict[str, Any]) -> list[dict[str, Any]]:
        """从 row_scope 规则提取维度实例（单维度或 dimensions 数组 AND 叠加）。"""
        if isinstance(rule.get("dimensions"), list):
            return [d for d in rule["dimensions"] if isinstance(d, dict)]
        if rule.get("dimension"):
            return [dict(rule)]
        return []


# ================================================================ 工具


def _normalize_table(name: str) -> str:
    """规约表名为 item_key：去引号、去 schema 之外的默认目录。"""
    cleaned = name.strip().strip('"').strip("`")
    parts = [p.strip().strip('"').strip("`") for p in cleaned.split(".") if p.strip()]
    if not parts:
        return cleaned
    if len(parts) > 3:
        parts = parts[-3:]
    return ".".join(parts)


def _quote(value: Any) -> str:
    """SQL 字面量引号（单引号转义）。"""
    return "'" + str(value).replace("'", "''") + "'"


def _subject_keys(identity: AskIdentity) -> set[tuple[str, str]]:
    """构造身份主体键集合 (subject_type, subject_id)。"""
    keys: set[tuple[str, str]] = set()
    for role in identity.role_codes:
        keys.add((SUBJECT_ROLE, role))
    for dept in identity.dept_ids:
        keys.add((SUBJECT_DEPT, dept))
    for store in identity.store_codes:
        keys.add((SUBJECT_STORE, store))
    if identity.user_id is not None:
        keys.add((SUBJECT_USER, str(identity.user_id)))
    return keys


def _is_effective(raw: dict[str, Any]) -> bool:
    """策略/ACL 是否生效（effective 字段缺省视为 true）。"""
    eff = raw.get("effective", 1)
    if isinstance(eff, bool):
        return eff
    return eff not in (0, "0", False)


def _as_bool(value: Any) -> bool:
    """规约为布尔（1/true/yes/on 视为 True；None/缺省视为 False）。"""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _builtin_dimensions() -> list[RowScopeDimension]:
    """内置种子维度（与 V71 种子一致，配置拉取失败时的兜底）。"""
    return [
        RowScopeDimension(
            dimension_code="dept",
            dimension_name="部门",
            predicate_type=PREDICATE_PATH_PREFIX,
            column_name="dept_id",
            header_name="X-Mis-Dept-Scope",
            param_whitelist=[
                "header:X-Mis-Dept-Scope",
                "header:X-Mis-Depts",
                "header:X-Mis-Orgs",
                "user.*",
                "ctx.*",
            ],
            dict_table=DICT_DEPT_SCOPE,
            auto_mode=True,
            enabled=True,
            sort=1,
        ),
        RowScopeDimension(
            dimension_code="store",
            dimension_name="门店",
            predicate_type=PREDICATE_ENUM,
            column_name="store_id",
            header_name="X-Mis-Stores",
            param_whitelist=["header:X-Mis-Stores", "user.store_ids", "ctx.*"],
            dict_table="mis_store_scope",
            auto_mode=True,
            enabled=True,
            sort=2,
        ),
    ]
