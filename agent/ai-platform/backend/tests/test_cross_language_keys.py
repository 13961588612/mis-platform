"""跨语言 Redis 键一致性断言（T1/T3 共享知识 §7，设计硬约束）。

Gateway(TS) 与 Agent Core(Py) 共用同一 Redis 实例、同一前缀 `aip:`，以下键必须
逐字节一致：
  - aip:bot:{botId}:owner
  - aip:session:{sessionId}:bot
  - aip:stream:gw:{gatewayId}:events
  - aip:stream:gw:pending:events

验证策略（无需真实 Redis）：
  1. Py 侧键函数产出与预期字面量逐字节相等；
  2. 解析 TS 源码中对应键函数的模板字面量，归一化后与 Py 侧同一格式逐字节相等。
两端引用同一规范字面量 ⇒ 跨语言一致。
"""

from __future__ import annotations

import pathlib
import re

import pytest

from src.cluster import core_ownership as co
from src.cluster.session_lock import session_lock_key
from src.queue import redis_stream as rs

GATEWAY_SRC = (
    pathlib.Path(__file__).resolve().parents[2] / "gateway" / "src"
)


def _read(rel: str) -> str:
    return (GATEWAY_SRC / rel).read_text(encoding="utf-8")


def _extract_ts_template(ts_source: str, fn_name: str) -> str:
    """从 TS 源码抽取键函数的模板字面量，归一化为 ``{var}`` 形式。

    支持 ``function fn(`` 与 ``static fn(`` 两种声明；匹配首个 ``return `...`;``。
    """
    pattern = (
        rf"(?:function|static)\s+{fn_name}\s*\([^)]*\).*?return\s*`(.*?)`\s*;"
    )
    m = re.search(pattern, ts_source, re.S)
    assert m, f"未能在 TS 源码中找到 {fn_name} 的键模板"
    tpl = m.group(1)
    tpl = tpl.replace("${REDIS_KEY_PREFIX}", "aip:")
    tpl = re.sub(r"\$\{(\w+)\}", r"{\1}", tpl)
    return tpl


# ---------------------------------------------------------------------------
# 1) Py 侧键函数产出与预期字面量逐字节相等
# ---------------------------------------------------------------------------


def test_py_key_functions_match_expected_literals():
    assert rs._session_bot_key("S1") == "aip:session:S1:bot"
    assert rs._bot_owner_key("B1") == "aip:bot:B1:owner"
    assert rs.StreamKeys.gateway_outbound("gwX") == "aip:stream:gw:gwX:events"
    assert rs.PENDING_OUTBOUND_STREAM == "aip:stream:gw:pending:events"
    assert (
        rs.StreamProducer.get_outbound_stream_key("gwX") == "aip:stream:gw:gwX:events"
    )


# ---------------------------------------------------------------------------
# 2) TS 源码模板与 Py 同一格式逐字节相等（跨语言一致性核心）
# ---------------------------------------------------------------------------


def test_ts_ownership_keys_consistent_with_py():
    ownership = _read("cluster/ownership.ts")

    ts_session = _extract_ts_template(ownership, "sessionBotKey")
    assert ts_session == "aip:session:{sessionId}:bot"
    assert rs._session_bot_key("{sessionId}") == "aip:session:{sessionId}:bot"

    ts_botowner = _extract_ts_template(ownership, "botOwnerKey")
    assert ts_botowner == "aip:bot:{botId}:owner"
    assert rs._bot_owner_key("{botId}") == "aip:bot:{botId}:owner"


def test_ts_redis_stream_keys_consistent_with_py():
    redis_ts = _read("queue/redisStream.ts")

    ts_out = _extract_ts_template(redis_ts, "getOutboundStreamKey")
    assert ts_out == "aip:stream:gw:{gatewayId}:events"
    assert (
        rs.StreamProducer.get_outbound_stream_key("{gatewayId}")
        == "aip:stream:gw:{gatewayId}:events"
    )

    ts_pend = _extract_ts_template(redis_ts, "getPendingOutboundStreamKey")
    assert ts_pend == "aip:stream:gw:pending:events"
    assert rs.PENDING_OUTBOUND_STREAM == "aip:stream:gw:pending:events"


# ---------------------------------------------------------------------------
# 3) T7 H5/wecom-h5 粘滞键 `aip:session:{sid}:gateway`（TS 写 / Py 读，跨语言一致）
# ---------------------------------------------------------------------------


def test_py_session_gateway_key_literal():
    assert rs._session_gateway_key("S1") == "aip:session:S1:gateway"


def test_ts_session_gateway_key_consistent_with_py():
    ownership = _read("cluster/ownership.ts")
    ts_gw = _extract_ts_template(ownership, "sessionGatewayKey")
    # 设计硬约束：TS 写 / Py 读同一键，须逐字节一致。
    assert ts_gw == "aip:session:{sessionId}:gateway"
    assert rs._session_gateway_key("{sessionId}") == "aip:session:{sessionId}:gateway"


# ---------------------------------------------------------------------------
# 4) T8/T9 多 Core 键字面量（Py Core 侧写入，与共享知识 §7 逐字节对齐）
# ---------------------------------------------------------------------------


def test_py_agent_and_session_lock_keys_literals():
    assert co.agent_owner_key("A1") == "aip:agent:A1:owner"
    assert co.agent_prev_owner_key("A1") == "aip:agent:A1:prev_owner"
    assert co.agent_registry_key() == "aip:agent:registry"
    assert co.cores_members_key() == "aip:cores:members"
    assert co.core_alive_key("c1") == "aip:core:c1:alive"
    assert session_lock_key("S1") == "aip:session:S1:lock"
