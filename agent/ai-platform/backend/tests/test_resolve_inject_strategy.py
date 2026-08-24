"""resolve_inject_strategy 策略选择测试（P2-7 交付物之一）。

覆盖 dept PATH_PREFIX / 无 path 降级 ENUM / 无 path 超阈值 FAIL_CLOSED /
头缺失 FAIL_CLOSED；store ENUM / 超 500 FAIL_CLOSED / 头缺失 FAIL_CLOSED；
以及 P1-6 维度来源（dept 降级 ENUM 用 dept 锚点，store ENUM 用 X-Mis-Stores）。
"""
from __future__ import annotations

import asyncio
import json

import pytest

from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    RowScopeDimension,
    ScopeResolver,
    PREDICATE_PATH_PREFIX,
    PREDICATE_ENUM,
    PREDICATE_FAIL_CLOSED,
)


class FakeConfigClient:
    """注入用假配置客户端（get_dimensions 返回空 → 走内置种子）。"""

    async def get_dimensions(self, ctx=None):
        return []

    async def load_configs(self, ctx=None):
        return [{"id": 1, "name": "wren", "enabled": 1}]

    async def get_scope_policies(self, connection_id, ctx=None):
        return []

    async def get_acls(self, connection_id, ctx=None):
        return []

    async def get_catalog_in_scope(self, connection_id, ctx=None):
        return []

    async def get_catalog_items(self, connection_id, ctx=None):
        return []

    async def get_mask_rules(self, ctx=None):
        return []


def make_resolver() -> ScopeResolver:
    return ScopeResolver(config_client=FakeConfigClient())


def dept_dim() -> RowScopeDimension:
    return RowScopeDimension(
        dimension_code="dept",
        predicate_type=PREDICATE_PATH_PREFIX,
        column_name="dept_id",
        header_name="X-Mis-Dept-Scope",
        dict_table="mis_dept_scope",
    )


def store_dim() -> RowScopeDimension:
    return RowScopeDimension(
        dimension_code="store",
        predicate_type=PREDICATE_ENUM,
        column_name="store_id",
        header_name="X-Mis-Stores",
    )


def dept_identity(path: str | None = "/0/1/A/", n_anchors: int = 1) -> AskIdentity:
    anchors = [
        {"id": "A", "path": path, "scope": "dept_subtree"} for _ in range(n_anchors)
    ]
    return AskIdentity(
        user_id=1,
        role_codes=["SALES"],
        raw_headers={"X-Mis-Dept-Scope": json.dumps(anchors)},
    )


def store_identity(codes: list[str] | None = None) -> AskIdentity:
    codes = codes or ["S1", "S2"]
    return AskIdentity(
        user_id=1,
        role_codes=["SALES"],
        raw_headers={"X-Mis-Stores": json.dumps(codes)},
    )


def no_header_identity() -> AskIdentity:
    return AskIdentity(user_id=1, role_codes=["SALES"], raw_headers={})


# ================================================================ dept 策略


def test_dept_with_path_uses_path_prefix():
    resolver = make_resolver()
    assert (
        asyncio.run(resolver.resolve_inject_strategy(dept_dim(), dept_identity(path="/0/1/A/")))
        == PREDICATE_PATH_PREFIX
    )


def test_dept_without_path_small_downgrades_enum():
    resolver = make_resolver()
    assert (
        asyncio.run(resolver.resolve_inject_strategy(dept_dim(), dept_identity(path="")))
        == PREDICATE_ENUM
    )


def test_dept_without_path_large_fails_closed():
    resolver = make_resolver()
    identity = dept_identity(path="", n_anchors=501)
    assert (
        asyncio.run(resolver.resolve_inject_strategy(dept_dim(), identity))
        == PREDICATE_FAIL_CLOSED
    )


def test_dept_header_missing_fails_closed():
    resolver = make_resolver()
    assert (
        asyncio.run(resolver.resolve_inject_strategy(dept_dim(), no_header_identity()))
        == PREDICATE_FAIL_CLOSED
    )


def test_dept_enum_downgrade_predicate_uses_dept_anchors():
    """P1-6：dept 降级 ENUM 的谓词必须用 dept 锚点 id，不得误用门店编码。"""
    resolver = make_resolver()
    dim = dept_dim()
    identity = dept_identity(path="")
    strategy = asyncio.run(resolver.resolve_inject_strategy(dim, identity))
    assert strategy == PREDICATE_ENUM
    pred = resolver._build_authorized_predicate(dim, identity, strategy, alias="o")
    assert "o.dept_id IN ('A')" in pred
    assert "store" not in pred.lower()


# ================================================================ store 策略


def test_store_small_enum():
    resolver = make_resolver()
    assert (
        asyncio.run(resolver.resolve_inject_strategy(store_dim(), store_identity(["S1", "S2"])))
        == PREDICATE_ENUM
    )


def test_store_large_fails_closed():
    resolver = make_resolver()
    codes = [f"S{i}" for i in range(501)]
    assert (
        asyncio.run(resolver.resolve_inject_strategy(store_dim(), store_identity(codes)))
        == PREDICATE_FAIL_CLOSED
    )


def test_store_header_missing_fails_closed():
    resolver = make_resolver()
    assert (
        asyncio.run(resolver.resolve_inject_strategy(store_dim(), no_header_identity()))
        == PREDICATE_FAIL_CLOSED
    )


def test_store_enum_predicate_uses_store_codes():
    """P1-6：store ENUM 谓词用 X-Mis-Stores 门店编码。"""
    resolver = make_resolver()
    dim = store_dim()
    identity = store_identity(["S1", "S2"])
    pred = resolver._build_authorized_predicate(dim, identity, PREDICATE_ENUM, alias="o")
    assert "o.store_id IN ('S1', 'S2')" in pred


# ================================================================ 内置种子维度


def test_builtin_dimensions_are_loaded_when_config_empty():
    """配置拉取为空时回退内置种子：dept PATH_PREFIX + store ENUM。"""
    resolver = make_resolver()
    dims = asyncio.run(resolver._load_dimensions())
    codes = {d.dimension_code: d for d in dims}
    assert codes["dept"].predicate_type == PREDICATE_PATH_PREFIX
    assert codes["dept"].column_name == "dept_id"
    assert codes["store"].predicate_type == PREDICATE_ENUM
    assert codes["store"].column_name == "store_id"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
