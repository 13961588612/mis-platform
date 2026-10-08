"""P1 回归：simulate_role_code Worker 消费链路（B6 后台测试页模拟角色）。

覆盖（T-W3-01 验收 2 / A8 边界）：
- ``_build_identity`` 从 ``metadata.iqd.simulate_role_code`` 解析并覆写 role_codes，
  保留真实 user_id 不变；无值走真实身份；
- ``AskRequest`` wire 字段 ``simulate_role_code`` 可携带；
- ``write_ask_log`` 审计载荷含 ``simulated_role_code``（无模拟为 None），user_id 不变；
- ``ScopeResolver.resolve_effective`` 模拟角色不放大权限：⊆ 原样 / ⊄ 求交 / 空交集 45204。
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    ScopeDeniedError,
    ScopeResolver,
)
from src.agent.mis_iqd.tools import _build_identity
from src.models.iqd_schema import AskRequest


# ================================================================ _build_identity


def test_build_identity_simulate_role_overrides_role_codes_keeps_user_id() -> None:
    meta = {
        "identity": {
            "userId": "u-1001",
            "misUserId": "1001",
            "X-Mis-Roles": '[{"id":"1","code":"real_a"},{"id":"2","code":"real_b"}]',
        },
        "iqd": {"simulate_role_code": "sim_role_x"},
    }
    ident = _build_identity(meta)
    assert ident.is_simulated()
    assert ident.simulated_role_code == "sim_role_x"
    assert ident.role_codes == ["sim_role_x"]
    assert ident.real_role_codes == ["real_a", "real_b"]
    assert ident.user_id == 1001  # 保留真实 user_id


def test_build_identity_no_simulate_keeps_real_identity() -> None:
    meta = {
        "identity": {
            "misUserId": "1002",
            "X-Mis-Roles": '[{"id":"3","code":"real_c"}]',
        },
        "iqd": {"view": "admin"},
    }
    ident = _build_identity(meta)
    assert not ident.is_simulated()
    assert ident.role_codes == ["real_c"]
    assert ident.simulated_role_code is None
    assert ident.user_id == 1002


def test_build_identity_top_level_iqd_simulate_role() -> None:
    meta = {"X-Mis-Roles": '[{"code":"r1"}]', "iqd": {"simulate_role_code": "sim_top"}}
    ident = _build_identity(meta)
    assert ident.is_simulated()
    assert ident.simulated_role_code == "sim_top"


# ================================================================ AskRequest wire


def test_ask_request_wire_simulate_role_code() -> None:
    req = AskRequest(question="q", simulate_role_code="sim_x")
    assert req.simulate_role_code == "sim_x"
    assert "simulate_role_code" in AskRequest.model_fields


# ================================================================ write_ask_log 审计


class _CaptureClient:
    def __init__(self) -> None:
        self.payload: dict[str, Any] = {}

    async def write_ask_log(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.payload.update(payload)
        return {"ok": True}


def _make_result() -> Any:
    from src.agent.mis_iqd.orchestrator import AskResult
    from src.models.iqd_schema import AskResponse, ResultData

    return AskResult(
        response=AskResponse(
            query_id="q-1",
            status="succeeded",
            data=ResultData(row_count=2),
            sql="SELECT 1",
        ),
        scope=IqdScopeResolution(allowed_item_keys=["a"], subject_summary="role:sim_x"),
        wren_status_trail=[],
    )


@pytest.mark.asyncio
async def test_write_ask_log_records_simulated_role_code() -> None:
    from src.agent.mis_iqd.service import IqdAskService

    client = _CaptureClient()
    svc = IqdAskService()
    svc._get_config_client = lambda: client  # type: ignore[method-assign]

    ident = AskIdentity(
        user_id=1001,
        employee_id="E1",
        role_codes=["sim_x"],
        simulated_role_code="sim_x",
        real_role_codes=["real_a"],
        raw_headers={"X-Trace-Id": "trace-1"},
    )
    await svc.write_ask_log(
        AskRequest(question="q", simulate_role_code="sim_x"), ident, _make_result(), "admin"
    )
    assert client.payload.get("simulated_role_code") == "sim_x"
    assert client.payload.get("user_id") == 1001  # 恒为真实
    assert client.payload.get("role_codes") == ["sim_x"]


@pytest.mark.asyncio
async def test_write_ask_log_no_simulate_simulated_role_code_none() -> None:
    from src.agent.mis_iqd.service import IqdAskService

    client = _CaptureClient()
    svc = IqdAskService()
    svc._get_config_client = lambda: client  # type: ignore[method-assign]

    ident = AskIdentity(user_id=2002, role_codes=["real_c"])
    await svc.write_ask_log(AskRequest(question="q"), ident, _make_result(), "user")
    assert client.payload.get("simulated_role_code") is None
    assert client.payload.get("user_id") == 2002


@pytest.mark.asyncio
async def test_ask_writes_log_when_orchestrator_raises_timeout() -> None:
    from src.agent.mis_iqd.errors import WrenaiTimeoutError
    from src.agent.mis_iqd.service import IqdAskService

    class _Orch:
        async def ask(self, *args: Any, **kwargs: Any) -> Any:
            raise WrenaiTimeoutError("本次查询超时")

    class _Resolver:
        async def resolve_effective(self, *args: Any, **kwargs: Any) -> IqdScopeResolution:
            return IqdScopeResolution(decision="allow", allowed_item_keys=["t"])

    client = _CaptureClient()
    svc = IqdAskService(orchestrator=_Orch(), scope_resolver=_Resolver())  # type: ignore[arg-type]
    svc._get_config_client = lambda: client  # type: ignore[method-assign]
    ident = AskIdentity(user_id=9, role_codes=["r"])
    with pytest.raises(WrenaiTimeoutError):
        await svc.ask(AskRequest(question="销售额"), ident)
    assert client.payload.get("status") == "failed"
    assert str(client.payload.get("error_code")) == "45203"
    assert client.payload.get("question") == "销售额"


@pytest.mark.asyncio
async def test_ask_writes_log_when_worker_cancelled() -> None:
    from src.agent.mis_iqd.service import IqdAskService

    class _Orch:
        async def ask(self, *args: Any, **kwargs: Any) -> Any:
            raise asyncio.CancelledError()

    class _Resolver:
        async def resolve_effective(self, *args: Any, **kwargs: Any) -> IqdScopeResolution:
            return IqdScopeResolution(decision="allow", allowed_item_keys=["t"])

    client = _CaptureClient()
    svc = IqdAskService(orchestrator=_Orch(), scope_resolver=_Resolver())  # type: ignore[arg-type]
    svc._get_config_client = lambda: client  # type: ignore[method-assign]
    with pytest.raises(asyncio.CancelledError):
        await svc.ask(AskRequest(question="q"), AskIdentity(user_id=1, role_codes=["r"]))
    assert client.payload.get("status") == "failed"
    assert client.payload.get("question") == "q"


# ================================================================ resolve_effective


class _FakeConfig:
    async def load_configs(self) -> list[dict[str, Any]]:
        return [{"id": 1, "name": "c", "enabled": True}]

    async def get_scope_policies(self, cid: int) -> list[dict[str, Any]]:
        return []

    async def get_acls(self, cid: int) -> list[dict[str, Any]]:
        return []

    async def get_catalog_in_scope(self, cid: int) -> list[dict[str, Any]]:
        return []

    async def get_dimensions(self) -> list[dict[str, Any]]:
        return []


class _ProbeResolver(ScopeResolver):
    def __init__(self, real_allowed: list[str], sim_allowed: list[str]) -> None:
        super().__init__(config_client=_FakeConfig())
        self.real_allowed = real_allowed
        self.sim_allowed = sim_allowed

    async def resolve(
        self,
        identity: AskIdentity,
        connection_id: int | None = None,
        *,
        scope_hint: list[str] | None = None,
    ) -> IqdScopeResolution:
        allowed = self.sim_allowed if identity.is_simulated() else self.real_allowed
        if scope_hint:
            allowed = [k for k in allowed if k in set(scope_hint)]
        if not allowed:
            raise ScopeDeniedError("当前角色无可问数据范围")
        return IqdScopeResolution(
            decision="allow",
            allowed_item_keys=allowed,
            subject_summary=identity.subject_summary(),
            connection_id=1,
        )


@pytest.mark.asyncio
async def test_resolve_effective_downgrade_keeps_sim_scope() -> None:
    resolver = _ProbeResolver(real_allowed=["a", "b", "c"], sim_allowed=["a", "b"])
    ident = AskIdentity(
        user_id=1, role_codes=["sim_x"], simulated_role_code="sim_x", real_role_codes=["real_a"]
    )
    scope = await resolver.resolve_effective(ident, None)
    assert scope.allowed_item_keys == ["a", "b"]


@pytest.mark.asyncio
async def test_resolve_effective_tightens_when_sim_exceeds_real() -> None:
    resolver = _ProbeResolver(real_allowed=["a"], sim_allowed=["a", "b", "c"])
    ident = AskIdentity(
        user_id=1, role_codes=["sim_x"], simulated_role_code="sim_x", real_role_codes=["real_a"]
    )
    scope = await resolver.resolve_effective(ident, None)
    assert scope.allowed_item_keys == ["a"]


@pytest.mark.asyncio
async def test_resolve_effective_no_overlap_fail_closed() -> None:
    resolver = _ProbeResolver(real_allowed=["a"], sim_allowed=["b", "c"])
    ident = AskIdentity(
        user_id=1, role_codes=["sim_x"], simulated_role_code="sim_x", real_role_codes=["real_a"]
    )
    with pytest.raises(ScopeDeniedError):
        await resolver.resolve_effective(ident, None)


@pytest.mark.asyncio
async def test_resolve_effective_real_identity_passthrough() -> None:
    resolver = _ProbeResolver(real_allowed=["a", "b"], sim_allowed=["x"])
    ident = AskIdentity(user_id=1, role_codes=["real_a"])
    scope = await resolver.resolve_effective(ident, None)
    assert scope.allowed_item_keys == ["a", "b"]


# ================================================================ real_identity 工具


def test_real_identity_strips_simulation() -> None:
    ident = AskIdentity(
        user_id=7,
        role_codes=["sim_x"],
        simulated_role_code="sim_x",
        real_role_codes=["real_a", "real_b"],
    )
    real = ident.real_identity()
    assert not real.is_simulated()
    assert real.role_codes == ["real_a", "real_b"]
    assert real.user_id == 7
    assert real.simulated_role_code is None
    # 非模拟时原样返回
    assert ident.real_identity() is not ident
    plain = AskIdentity(user_id=8, role_codes=["r1"])
    assert plain.real_identity() is plain
