"""Scope governance when the global in_scope layer is unconfigured (2026-09-30).

Real incident: connection 1790686095967 had 81 role scope policies + 3 ask ACLs but
`iqd_catalog_item.in_scope` = 0 rows (a fresh connection whose global "??????"
layer was never set). The resolver computed `policy_keys & in_scope_keys`, which is empty,
so the question test console showed "0 ????" even though role grants existed.

Fix: the global layer is a defensive outer constraint ONLY when configured; an empty global
layer must not nullify explicit subject (role/dept/user) policies or ask ACLs (same empty-window
precedent as the ACL branch).
"""

from __future__ import annotations

import pytest

from src.agent.mis_iqd.errors import IqdError
from src.agent.mis_iqd.scope_resolver import AskIdentity, ScopeResolver


class _FakeConfig:
    """Config client returning role policies/ACLs but an EMPTY global in_scope layer."""

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


@pytest.mark.asyncio
async def test_role_grants_survive_empty_global_layer() -> None:
    resolver = ScopeResolver(
        config_client=_FakeConfig(
            policies=[
                {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.orders", "allow": 1, "effective": 1},
                {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.customers", "allow": 1, "effective": 1},
            ],
            acls=[
                {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.orders", "action": "ask"},
            ],
            in_scope=[],  # global layer never configured
        )
    )
    scope = await resolver.resolve(_ident(), 1)
    assert scope.decision == "allow"
    # governance = role policies (2); acl restricts to the 1 with ask
    assert scope.allowed_item_keys == ["t.orders"]


@pytest.mark.asyncio
async def test_no_policy_no_acl_still_denies() -> None:
    resolver = ScopeResolver(
        config_client=_FakeConfig(policies=[], acls=[], in_scope=[])
    )
    with pytest.raises(IqdError):
        await resolver.resolve(_ident(), 1)


@pytest.mark.asyncio
async def test_configured_global_layer_still_intersects() -> None:
    resolver = ScopeResolver(
        config_client=_FakeConfig(
            policies=[
                {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.orders", "allow": 1, "effective": 1},
                {"subject_type": "role", "subject_id": "IT-TESTER", "item_key": "t.secret", "allow": 1, "effective": 1},
            ],
            acls=[],
            in_scope=[{"item_key": "t.orders"}],  # global layer configured -> outer constraint applies
        )
    )
    scope = await resolver.resolve(_ident(), 1)
    assert scope.allowed_item_keys == ["t.orders"]
