"""Scope resolution semantics after the 2026-10-01 方案 A convergence.

Governance source of truth is `iqd_scope_policy` (role/global scope templates), intersected
with the global `iqd_catalog_item.in_scope` layer WHEN that layer is configured. `iqd_table_acl`
no longer participates in the grant decision at all -- it is repurposed to carry row-level
`row_scope` only (see `docs/ai-fusion/wrenai/architecture.md` and scope_resolver history).

These tests pin:
- role (subject) policies drive the allow set;
- an empty global in_scope layer does not nullify subject policies;
- a configured global in_scope layer still acts as an outer constraint;
- ACL rows do NOT shrink or grant the allowed set anymore.
"""

from __future__ import annotations

import pytest

from src.agent.mis_iqd.errors import IqdError
from src.agent.mis_iqd.scope_resolver import AskIdentity, ScopeResolver


class _FakeConfig:
    """Config client returning policies/ACLs and a configurable global in_scope layer."""

    def __init__(self, policies, acls, in_scope):
        self._policies = policies
        self._acls = acls
        self._in_scope = in_scope

    async def load_configs(self, ctx=None):
        return [{"id": 1, "name": "c", "enabled": 1}]

    async def get_scope_policies(self, connection_id, ctx=None):
        return self._policies

    async def get_acls(self, connection_id, ctx=None):
        return self._acls

    async def get_catalog_in_scope(self, connection_id, ctx=None):
        return self._in_scope

    async def get_dimensions(self, ctx=None):
        return []


def _ident():
    return AskIdentity(user_id=1, role_codes=["IT-TESTER"], dept_ids=[], store_codes=[])


def _role_policies(keys):
    return [
        {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": k, "allow": 1, "effective": 1}
        for k in keys
    ]


@pytest.mark.asyncio
async def test_role_policies_survive_empty_global_layer() -> None:
    resolver = ScopeResolver(
        config_client=_FakeConfig(
            policies=_role_policies(["t.orders", "t.customers"]),
            acls=[],
            in_scope=[],  # global layer never configured
        )
    )
    scope = await resolver.resolve(_ident(), 1)
    assert scope.decision == "allow"
    assert scope.allowed_item_keys == ["t.customers", "t.orders"]


@pytest.mark.asyncio
async def test_acl_rows_do_not_shrink_the_allow_set() -> None:
    """Option A: a role ACL for one object must NOT remove its other scope policies."""
    resolver = ScopeResolver(
        config_client=_FakeConfig(
            policies=_role_policies(["t.orders", "t.customers"]),
            acls=[{"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.orders", "action": "ask"}],
            in_scope=[],
        )
    )
    scope = await resolver.resolve(_ident(), 1)
    assert scope.allowed_item_keys == ["t.customers", "t.orders"]


@pytest.mark.asyncio
async def test_acl_row_scope_only_applies_within_scope() -> None:
    """row_scope is carried for in-scope objects; out-of-scope row_scope is dropped."""
    resolver = ScopeResolver(
        config_client=_FakeConfig(
            policies=_role_policies(["t.orders"]),
            acls=[
                {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.orders",
                 "action": "ask", "row_scope": {"dimension": "store", "scope": "store"}},
                {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.other",
                 "action": "ask", "row_scope": {"dimension": "store", "scope": "store"}},
            ],
            in_scope=[],
        )
    )
    scope = await resolver.resolve(_ident(), 1)
    assert scope.allowed_item_keys == ["t.orders"]
    assert list(scope.row_scope_rules) == ["t.orders"]


@pytest.mark.asyncio
async def test_acl_alone_cannot_grant() -> None:
    """ACL is not a grant path anymore: without a scope policy there is no allow."""
    resolver = ScopeResolver(
        config_client=_FakeConfig(
            policies=[],
            acls=[{"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.orders", "action": "ask"}],
            in_scope=[],
        )
    )
    with pytest.raises(IqdError):
        await resolver.resolve(_ident(), 1)


@pytest.mark.asyncio
async def test_no_policy_no_acl_still_denies() -> None:
    resolver = ScopeResolver(config_client=_FakeConfig(policies=[], acls=[], in_scope=[]))
    with pytest.raises(IqdError):
        await resolver.resolve(_ident(), 1)


@pytest.mark.asyncio
async def test_configured_global_layer_still_intersects() -> None:
    resolver = ScopeResolver(
        config_client=_FakeConfig(
            policies=_role_policies(["t.orders", "t.secret"]),
            acls=[],
            in_scope=[{"item_key": "t.orders"}],  # global layer configured -> outer constraint applies
        )
    )
    scope = await resolver.resolve(_ident(), 1)
    assert scope.allowed_item_keys == ["t.orders"]
