"""行级范围「按身份真实预览」单测（2026-09-28）。

<背景>
范围页的「模拟角色 WHERE 片段预览」此前**无后端接口**，前端只能按 row_scope 模板推导
示意串（恒标 degraded）。但谓词真实形态由 `ScopeResolver._build_authorized_predicate`
决定（PATH_PREFIX → 字典表 EXISTS；ENUM → IN），前端推导必然与实际注入不一致。

`ScopeResolver.preview_row_scope` **复用同一套构造逻辑**，故预览与注入逐字一致。
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from src.agent.mis_iqd.scope_resolver import (
    AskIdentity,
    IqdScopeResolution,
    RowScopeDimension,
    ScopeResolver,
)


def _dim(code: str, column: str, header: str, predicate: str, *, dict_table=None, sort=1):
    return RowScopeDimension(
        dimension_code=code,
        column_name=column,
        header_name=header,
        predicate_type=predicate,
        param_whitelist=None,
        dict_table=dict_table,
        auto_mode=None,
        enabled=True,
        sort=sort,
    )


STORE = _dim("store", "store_id", "X-Mis-Stores", "ENUM", sort=2)
DEPT_ENUM = _dim("dept", "dept_id", "X-Mis-Depts", "ENUM", sort=1)
DEPT_PATH = _dim("dept", "dept_id", "X-Mis-Dept-Scope", "PATH_PREFIX", dict_table="mis_dept_scope")


def _resolver(dims, row_scope_rules, allowed=("ads_df",)):
    r = ScopeResolver()
    resolution = IqdScopeResolution(
        decision="allow",
        allowed_item_keys=list(allowed),
        subject_summary="role:SALES",
        row_scope_rules=row_scope_rules,
        connection_id=1,
    )
    r._load_dimensions = AsyncMock(return_value=dims)  # type: ignore[assignment]
    r.resolve = AsyncMock(return_value=resolution)  # type: ignore[assignment]
    return r


def _rule(*instances):
    return {"dimensions": list(instances)}


@pytest.mark.asyncio
async def test_preview_enumerates_store_predicate_verbatim() -> None:
    """ENUM 维度：预览与注入同源 → store_id IN (...) 逐字一致。"""
    r = _resolver([STORE], {"ads_df": [_rule({"dimension": "store", "scope": "store"})]})
    identity = AskIdentity.from_headers({"X-Mis-Stores": "S1,S2"})

    data = await r.preview_row_scope(identity, 1)

    assert data["degraded"] is False
    item = data["items"][0]
    assert item["item_key"] == "ads_df"
    assert item["dimensions"] == ["store"]
    assert item["where"] == "(store_id IN ('S1', 'S2'))"
    assert item["denied_reason"] is None


@pytest.mark.asyncio
async def test_preview_multi_dimension_and_combines_with_and() -> None:
    """双维度 AND 叠加：谓词按 AND 拼接（含括号）。"""
    rules = {
        "ads_df": [
            _rule(
                {"dimension": "dept", "scope": "dept"},
                {"dimension": "store", "scope": "store"},
            )
        ]
    }
    r = _resolver([DEPT_ENUM, STORE], rules)
    # dept 维度的 ENUM 授权集合来源是 X-Mis-Dept-Scope 锚点 id（非 X-Mis-Depts），与 _enum_authorized_values 同源；写错头会让 dept 维度 fail-closed。
    anchors = [{"id": "D1"}, {"id": "D2"}]
    identity = AskIdentity.from_headers(
        {"X-Mis-Dept-Scope": json.dumps(anchors), "X-Mis-Stores": "S1"}
    )

    data = await r.preview_row_scope(identity, 1)

    item = data["items"][0]
    assert item["dimensions"] == ["dept", "store"]
    assert " AND " in item["where"]
    assert "dept_id IN ('D1', 'D2')" in item["where"]
    assert "store_id IN ('S1')" in item["where"]


@pytest.mark.asyncio
async def test_preview_path_prefix_uses_dict_table_exists() -> None:
    """PATH_PREFIX 维度：谓词是字典表 EXISTS（不是 IN）—— 前端推导不出来的形态。"""
    r = _resolver([DEPT_PATH], {"ads_df": [_rule({"dimension": "dept", "scope": "dept_subtree"})]})
    anchors = [{"id": "A", "path": "/0/1/A/", "scope": "dept_subtree"}]
    identity = AskIdentity.from_headers({"X-Mis-Dept-Scope": json.dumps(anchors)})

    data = await r.preview_row_scope(identity, 1)

    where = data["items"][0]["where"]
    assert "EXISTS (SELECT 1 FROM mis_dept_scope rs" in where
    assert "rs.dept_path = '/0/1/A/'" in where
    assert "LIKE '/0/1/A/%'" in where


@pytest.mark.asyncio
async def test_preview_missing_authorization_marks_denied_reason() -> None:
    """身份缺授权头 → 谓词为空且给出 denied_reason（不静默当“全行可见”）。"""
    r = _resolver([STORE], {"ads_df": [_rule({"dimension": "store", "scope": "store"})]})
    identity = AskIdentity.from_headers({})  # 无 X-Mis-Stores

    data = await r.preview_row_scope(identity, 1)

    item = data["items"][0]
    assert item["predicates"] == []
    assert item["where"] == ""
    assert item["denied_reason"] and "缺少维度授权范围" in item["denied_reason"]


@pytest.mark.asyncio
async def test_preview_unknown_dimension_is_reported() -> None:
    """row_scope 引用了未注册维度 → 明确报出，不静默跳过。"""
    r = _resolver([STORE], {"ads_df": [_rule({"dimension": "ghost", "scope": "x"})]})
    identity = AskIdentity.from_headers({"X-Mis-Stores": "S1"})

    data = await r.preview_row_scope(identity, 1)
    item = data["items"][0]
    assert item["denied_reason"] and "维度未配置" in item["denied_reason"]


@pytest.mark.asyncio
async def test_preview_no_row_scope_rules_means_whole_table_visible() -> None:
    """该表未配行级规则 → 空谓词、无 denied_reason（全行可见，符合 row_scope=NULL 语义）。"""
    r = _resolver([STORE], {})  # 无规则
    identity = AskIdentity.from_headers({"X-Mis-Stores": "S1"})

    data = await r.preview_row_scope(identity, 1, item_key="ads_df")
    item = data["items"][0]
    assert item["predicates"] == []
    assert item["where"] == ""
    assert item["denied_reason"] is None


@pytest.mark.asyncio
async def test_preview_draft_rules_skip_resolution() -> None:
    """草稿规则：传 draft_rules 则不查库（resolve 不被调），按草稿生成谓词。"""
    r = _resolver([STORE], {})
    identity = AskIdentity.from_headers({"X-Mis-Stores": "S1,S2"})

    data = await r.preview_row_scope(
        identity,
        1,
        draft_rules=[{"item_key": "ads_df", "row_scope": '{"dimension":"store","scope":"store"}'}],
    )

    r.resolve.assert_not_called()
    item = data["items"][0]
    assert item["source"] == "draft"
    assert item["where"] == "(store_id IN ('S1', 'S2'))"


@pytest.mark.asyncio
async def test_preview_draft_sample_values_override_source() -> None:
    """示意实参：仅替换取值来源，谓词形态仍由引擎生成。"""
    r = _resolver([DEPT_PATH], {})
    identity = AskIdentity.from_headers({})

    data = await r.preview_row_scope(
        identity,
        1,
        draft_rules=[{"item_key": "ads_df", "row_scope": '{"dimension":"dept","scope":"dept_subtree"}'}],
        samples={"dept": {"path": "/0/1/A/"}},
    )

    item = data["items"][0]
    assert item["source"] == "draft+sample"
    assert "EXISTS (SELECT 1 FROM mis_dept_scope rs" in item["where"]
    assert "rs.dept_path = '/0/1/A/'" in item["where"]


@pytest.mark.asyncio
async def test_preview_draft_unknown_dimension_reported() -> None:
    """草稿引用未注册维度 → 明确报出，不静默跳过。"""
    r = _resolver([STORE], {})
    identity = AskIdentity.from_headers({"X-Mis-Stores": "S1"})

    data = await r.preview_row_scope(
        identity,
        1,
        draft_rules=[{"item_key": "ads_df", "row_scope": '{"dimension":"ghost","scope":"x"}'}],
    )

    item = data["items"][0]
    assert item["where"] == ""
    assert item["denied_reason"] and "维度未配置" in item["denied_reason"]
