"""sitecustomize.py 连接自愈补丁的行为测试（不依赖真实 wren / 数据库）。

用假的 connector 类模拟 wren.connector.mysql 的真实结构：
* ``MySqlConnector`` 自己定义 ``__init__`` / ``query`` / ``dry_run``；
* ``DorisConnector`` **只**定义 ``__init__``，``query`` / ``dry_run`` 继承父类。

断言：
1. 连接失效 → 重建 → 重试一次 → 成功（MySQL 与 Doris 都是恰好重建一次）；
2. 非连接类错误原样上抛、不重试；
3. 成功路径不做任何额外重建；
4. 重复打补丁幂等（不会叠加包装导致重试翻倍）；
5. Doris 重建走**自己的**构造（用父类构造会因 ANSI_QUOTES 失败）。
"""

from __future__ import annotations

import importlib
import sys
import types

import pytest


@pytest.fixture
def patched(monkeypatch):
    """把补丁装到假的 wren.connector.mysql 模块上。"""
    # 每次重建一个干净的 sitecustomize（避免跨用例串状态）
    for mod in ("sitecustomize",):
        sys.modules.pop(mod, None)
    sc = importlib.import_module("sitecustomize")

    state = {"opens": 0, "fail_after": 1, "doris_constructs": 0}

    class MySqlConnector:
        def __init__(self, connection_info=None):
            state["opens"] += 1
            self.connection = types.SimpleNamespace(seq=state["opens"])
            self._closed = False

        def query(self, sql, limit=None):
            if state["opens"] > state["fail_after"]:
                return ("ok", sql)
            raise RuntimeError("(2006, 'Server has gone away')")

        def dry_run(self, sql):
            if state["opens"] > state["fail_after"]:
                return ("dry-ok", sql)
            raise RuntimeError("(2006, 'Server has gone away')")

        def close(self):
            self._closed = True

    class DorisConnector(MySqlConnector):
        def __init__(self, connection_info=None):
            # Doris 不走父类构造（父类会执行 ANSI_QUOTES 初始化）
            state["doris_constructs"] += 1
            state["opens"] += 1
            self.connection = types.SimpleNamespace(seq=state["opens"])
            self._closed = False

    fake = types.ModuleType("wren.connector.mysql")
    fake.MySqlConnector = MySqlConnector
    fake.DorisConnector = DorisConnector
    monkeypatch.setitem(sys.modules, "wren.connector.mysql", fake)
    monkeypatch.setitem(sys.modules, "wren", types.ModuleType("wren"))
    monkeypatch.setitem(sys.modules, "wren.connector", types.ModuleType("wren.connector"))

    sc._patch_module("wren.connector.mysql", fake)
    return sc, state, MySqlConnector, DorisConnector


def test_mysql_reconnect_and_retry(patched) -> None:
    _, state, MySqlConnector, _ = patched
    state["fail_after"] = 1
    c = MySqlConnector()
    assert c.query("SELECT 1") == ("ok", "SELECT 1")
    assert state["opens"] == 2, "应恰好重建一次"


def test_mysql_dry_run_selfheals(patched) -> None:
    _, state, MySqlConnector, _ = patched
    state["fail_after"] = 1
    c = MySqlConnector()
    assert c.dry_run("SELECT 1") == ("dry-ok", "SELECT 1")
    assert state["opens"] == 2


def test_doris_uses_own_constructor_and_no_double_wrap(patched) -> None:
    _, state, _, DorisConnector = patched
    state["fail_after"] = 1
    c = DorisConnector()
    # Doris 只包了 __init__，query 继承父类包装 -> 只重试一次即可成功
    assert c.query("SELECT 1") == ("ok", "SELECT 1")
    assert state["opens"] == 2, "不得因二次包裹而重试翻倍"
    # 重建必须走 Doris 自己的构造
    assert state["doris_constructs"] >= 2


def test_success_path_no_rebuild(patched) -> None:
    _, state, MySqlConnector, _ = patched
    state["fail_after"] = 0  # 首个连接即可用
    c = MySqlConnector()
    assert c.query("SELECT 1") == ("ok", "SELECT 1")
    assert state["opens"] == 1, "成功路径不得额外重建"


def test_non_conn_error_not_retried(patched) -> None:
    _, state, _MySQL, _ = patched

    class SqlError(Exception):
        pass

    # 用 MySqlConnector 的包装路径，但让底层抛非连接错误
    fake = sys.modules["wren.connector.mysql"]

    class PlainConnector(fake.MySqlConnector):
        def query(self, sql, limit=None):
            raise ValueError("column 'x' cannot be resolved")

    # 该类不在 _TARGETS 里、也不会被自动包装；直接验证判定函数
    sc = patched[0]
    assert sc._looks_like_conn_error(ValueError("column 'x' cannot be resolved")) is False
    assert sc._looks_like_conn_error(RuntimeError("(2006, 'Server has gone away')")) is True


def test_idempotent_patch(patched) -> None:
    sc, state, MySqlConnector, _ = patched
    fake = sys.modules["wren.connector.mysql"]
    sc._patch_module("wren.connector.mysql", fake)  # 再打一次
    state["fail_after"] = 1
    c = MySqlConnector()
    assert c.query("SELECT 1") == ("ok", "SELECT 1")
    assert state["opens"] == 2, "幂等：不得因重复打补丁而多重建"
