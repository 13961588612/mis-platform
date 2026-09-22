"""T04d：``push_enhancements`` 按 ``related_item_keys`` 裁剪（PRD §5.2 e 点）单元测试。

钉住三处**静默失效**（错了不会报错，只会让指令「莫名其妙地不生效」或「全量误裁」）：

1. ``parse_related_item_keys`` 的容错口径：JSON 字符串 / list / None / 脏值 → 集合；
   脏值必须视作「无关联」（不裁剪），绝不静默丢弃条目。
2. ``crop_knowledge_by_context`` 的三态语义：
   - 无 ``related_item_keys``（通用）→ **恒保留**（**不误裁**是本次最关键的守卫）；
   - 有 ``related_item_keys`` → 仅与上下文**有交集**才保留；
   - 上下文缺省 → **不裁剪**（整库 build / 登记场景，向后兼容）。
3. ``push_enhancements`` 的返回计数（``knowledge_count`` = 裁剪后、
   ``knowledge_total_count`` = 裁剪前、``cropped`` 标记）。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.agent.mis_iqd.service import (
    IqdAskService,
    crop_knowledge_by_context,
    parse_related_item_keys,
)


# ================================================================ parse_related_item_keys

def test_parse_related_item_keys_none_and_empty():
    assert parse_related_item_keys(None) == set()
    assert parse_related_item_keys("") == set()
    assert parse_related_item_keys("   ") == set()


def test_parse_related_item_keys_json_string():
    assert parse_related_item_keys('["mdl:model:orders","mdl:cube:revenue"]') == {
        "mdl:model:orders",
        "mdl:cube:revenue",
    }
    # 去空白 + 忽略空项
    assert parse_related_item_keys('[" mdl:model:orders ", "", null]') == {"mdl:model:orders"}


def test_parse_related_item_keys_list_shape():
    assert parse_related_item_keys(["mdl:model:orders", "mdl:cube:revenue"]) == {
        "mdl:model:orders",
        "mdl:cube:revenue",
    }
    assert parse_related_item_keys(("a", None, "b")) == {"a", "b"}


def test_parse_related_item_keys_garbage_is_empty_failsafe():
    # 非法 JSON / 非集合类型 → 空集合（调用方据此「不裁剪」）
    assert parse_related_item_keys("not-json") == set()
    assert parse_related_item_keys('{"a":1}') == set()
    assert parse_related_item_keys(123) == set()
    assert parse_related_item_keys('"just-a-string"') == set()


# ================================================================ crop_knowledge_by_context

def _k(title: str, related) -> dict:
    return {"title": title, "related_item_keys": related}


def test_crop_no_context_returns_all_and_does_not_mutate():
    items = [_k("g", None), _k("s", '["mdl:model:orders"]')]
    out = crop_knowledge_by_context(items, None)
    assert out == items
    assert out is not items  # 返回新列表
    # 空上下文同理（等价于「未提供」）
    assert crop_knowledge_by_context(items, []) == items


def test_crop_keeps_global_entries_and_scoped_intersection_only():
    """★ 核心：无关联的通用条目恒保留；有作用域的非交集条目被裁掉。"""
    items = [
        _k("global", None),                        # 通用 → 保留
        _k("global-empty", "[]"),                  # 空关联 = 通用 → 保留
        _k("scoped-hit", '["mdl:model:orders"]'),  # 交集 → 保留
        _k("scoped-hit2", '["mdl:cube:revenue","mdl:model:orders"]'),  # 命中其一 → 保留
        _k("scoped-miss", '["mdl:cube:revenue"]'), # 无交集 → 裁剪
        _k("garbage", "not-json"),                 # 脏值 = 无关联 → 保留（不静默丢）
    ]
    out = crop_knowledge_by_context(items, ["mdl:model:orders"])
    titles = [i["title"] for i in out]
    assert titles == ["global", "global-empty", "scoped-hit", "scoped-hit2", "garbage"]
    assert "scoped-miss" not in titles, "无交集的作用域条目必须被裁掉"


def test_crop_context_with_blank_keys_is_treated_as_no_context():
    items = [_k("s", '["mdl:model:orders"]')]
    # 只有空白项的上下文 → 视为「无上下文」→ 不裁剪
    assert crop_knowledge_by_context(items, ["  ", ""]) == items


# ================================================================ push_enhancements 集成

@pytest.mark.asyncio
async def test_push_enhancements_crops_by_context_and_reports_counts():
    """提供上下文 → 裁剪 + 计数（knowledge_count=裁剪后, total=裁剪前, cropped=True）。"""
    service = IqdAskService()
    knowledge = [
        {"id": 1, "sync_status": "pending", "title": "global", "related_item_keys": None},
        {"id": 2, "sync_status": "pending", "title": "hit", "related_item_keys": '["mdl:model:orders"]'},
        {"id": 3, "sync_status": "pending", "title": "miss", "related_item_keys": '["mdl:cube:revenue"]'},
        {"id": 5, "sync_status": "synced", "title": "synced", "related_item_keys": None},
    ]
    sql_pairs = [
        {"id": 10, "sync_status": "pending", "question": "q", "wren_sql": "SELECT 1"},
        {"id": 11, "sync_status": "synced", "question": "old"},
    ]

    with patch("src.adapters.iqd_config_client.IqdConfigClient") as MockClient:
        client = MockClient.return_value
        client.get_sql_pairs = AsyncMock(return_value=sql_pairs)
        client.get_knowledge = AsyncMock(return_value=knowledge)
        result = await service.push_enhancements(1, context_item_keys=["mdl:model:orders"])

    assert result["sql_pair_count"] == 1
    assert [k["id"] for k in result["knowledge"]] == [1, 2]   # global + hit
    assert result["knowledge_count"] == 2                     # 裁剪后
    assert result["knowledge_total_count"] == 3               # 裁剪前（pending：1/2/3）
    assert result["cropped"] is True


@pytest.mark.asyncio
async def test_push_enhancements_without_context_keeps_all_pending():
    """无上下文 → 不裁剪（保持既有行为：pending 全量）。"""
    service = IqdAskService()
    knowledge = [
        {"id": 1, "sync_status": "pending", "title": "global", "related_item_keys": None},
        {"id": 2, "sync_status": "pending", "title": "hit", "related_item_keys": '["mdl:model:orders"]'},
        {"id": 3, "sync_status": "pending", "title": "miss", "related_item_keys": '["mdl:cube:revenue"]'},
    ]

    with patch("src.adapters.iqd_config_client.IqdConfigClient") as MockClient:
        client = MockClient.return_value
        client.get_sql_pairs = AsyncMock(return_value=[])
        client.get_knowledge = AsyncMock(return_value=knowledge)
        result = await service.push_enhancements(1)

    assert [k["id"] for k in result["knowledge"]] == [1, 2, 3]
    assert result["knowledge_count"] == 3
    assert result["knowledge_total_count"] == 3
    assert result["cropped"] is False


@pytest.mark.asyncio
async def test_push_enhancements_only_pending_entries():
    """既有语义守卫：sync_status ≠ pending 的条目不进待推送集。

    注：**未**断言 `enabled=0`（int）被排除。既有过滤用 `value is not False`，对 int `0`
    会判为启用；但 mis-iqd `IqdKnowledgeVO.enabled` 是 **Boolean**，wire 上恒为
    `true`/`false`，故真实链路上语义正确 —— 属**潜在脆弱点**（任何回传 int 0 的新路径都会
    静默漏过滤），非 T04d ② 范围，已在批次报告「偏离与发现」中单列。
    """
    service = IqdAskService()
    knowledge = [
        {"id": 1, "sync_status": "pending", "title": "pending", "related_item_keys": None},
        {"id": 2, "sync_status": "failed", "title": "failed", "related_item_keys": None},
        {"id": 3, "sync_status": "synced", "title": "synced", "related_item_keys": None},
    ]

    with patch("src.adapters.iqd_config_client.IqdConfigClient") as MockClient:
        client = MockClient.return_value
        client.get_sql_pairs = AsyncMock(return_value=[])
        client.get_knowledge = AsyncMock(return_value=knowledge)
        result = await service.push_enhancements(1, context_item_keys=["mdl:model:orders"])

    assert [k["id"] for k in result["knowledge"]] == [1]
    assert result["knowledge_total_count"] == 1
