"""wren 连接自愈补丁 —— 由 wren-mcp-agent 经 PYTHONPATH 注入，不改 vendored 包。

## 为什么需要（2026-10-02 真机故障根因）

wren 0.13（含 0.13.4 / 0.15.0）的 connector **没有连接池、没有失效检测**：

* ``wren/engine.py`` 的 ``WrenEngine._get_connector()`` 懒建一次连接后**永久复用**；
* ``wren/connector/base.py::ConnectorABC`` 只有 ``query`` / ``dry_run`` / ``close``；
* 全 wheel 扫描 ``pool_pre_ping`` / ``reconnect`` / ``ping(`` —— **零命中**。

即：``wren serve mcp`` 进程生命周期内只有**一条** DB 连接。业务库任何一次断连
（重启 / 驱逐 / 网络抖动）都会把它打成死连接，之后每次 ``dry_run`` / ``run_sql``
都复用这条坏连接 → 100% 失败且**永不自愈**。

真机故障画像（与单连接假设完全吻合）：进程活着、``list_models`` / ``list_cubes`` /
``get_context`` / ``dry_plan`` 全部亚秒正常，只有碰库的 ``dry_run`` 100% 失败，
且 **0.13s 瞬回** ``[GENERIC_USER_ERROR] (2006, 'Server has gone away')
phase=SQL_DRY_RUN``，而业务库本身完全正常（直连 0.03s，``wait_timeout=28800``）。

## 本补丁做什么

给 MySQL 族（``MySqlConnector`` / ``DorisConnector``）与 ``PostgresConnector`` 加
「**失败即重连并重试一次**」：

* 只在捕获到**连接类异常**时才重建连接并重试一次；
* 其它异常原样抛出（不改 SQL 错误语义，上层照常 fail-closed）；
* 成功路径**零额外开销**（不做用前 ping）；
* 建连成功后给底层 socket 加上读写超时（``WREN_CONN_IO_TIMEOUT_SECONDS``，默认 120）。
  网络黑洞时 ``recv`` 会一直堵住，补丁等不到异常；超时后按连接错误重连一次。

## 如何注入

本文件以 ``sitecustomize.py`` 的形式经 ``PYTHONPATH`` 注入到 ``wren serve mcp``
子进程。Python 启动时会自动 import ``sitecustomize``；此处**只安装导入后钩子**，
真正打补丁推迟到 ``wren.connector.*`` 被导入时执行 —— 启动开销为零，且不会因为
wren 尚未安装依赖而报错。

## 安全与回退

* 只 monkeypatch 进程内运行期行为，不落盘、不改 site-packages；
* 幂等：重复导入不会叠加包装；
* ``WREN_CONN_SELFHEAL=0`` 可关闭，恢复 wren 原生行为。
"""

from __future__ import annotations

import importlib.abc
import importlib.machinery
import os
import socket
import sys
import threading

_ENABLED = os.environ.get("WREN_CONN_SELFHEAL", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

#: 需要打补丁的 connector 模块 → 类名列表。
_TARGETS: dict[str, tuple[str, ...]] = {
    "wren.connector.mysql": ("MySqlConnector", "DorisConnector"),
    "wren.connector.postgres": ("PostgresConnector",),
}

#: 连接类错误特征（跨驱动：MySQLdb / PyMySQL / psycopg）。
_CONN_ERROR_MARKERS: tuple[str, ...] = (
    "server has gone away",
    "gone away",
    "lost connection",
    "connection refused",
    "connection reset",
    "broken pipe",
    "can't connect",
    "not connected",
    "connection is closed",
    "connection already closed",
    "closed the connection",
    "2006",
    "2013",
    "2003",
    "eof detected",
    "consuming input failed",
    "timed out",
)


def _io_timeout_seconds() -> float:
    """读写超时秒数。``0`` 或负数表示不设置。"""
    raw = os.environ.get("WREN_CONN_IO_TIMEOUT_SECONDS", "120").strip()
    try:
        return float(raw)
    except ValueError:
        return 120.0


def _arm_socket(sock: object, seconds: float) -> bool:
    if not isinstance(sock, socket.socket):
        return False
    try:
        sock.settimeout(seconds)
    except Exception:  # noqa: BLE001
        return False
    return True


def _arm_io_timeout(dbapi_conn: object) -> None:
    """给已建立的连接加读写超时。失败静默，不影响 wren 启动。

    只改已有的 ``read_timeout`` / ``write_timeout`` 数值字段和底层 socket。
    不覆盖同名方法，也不长期改 ``socket.setdefaulttimeout``（会波及 MCP 端口）。
    """
    seconds = _io_timeout_seconds()
    if dbapi_conn is None or seconds <= 0:
        return
    for attr in ("read_timeout", "write_timeout"):
        current = getattr(dbapi_conn, attr, None)
        if current is not None and not isinstance(current, (int, float)):
            continue
        try:
            setattr(dbapi_conn, attr, seconds)
        except Exception:  # noqa: BLE001
            pass
    if _arm_socket(getattr(dbapi_conn, "_sock", None), seconds):
        return
    mysql_sock = getattr(dbapi_conn, "_socket", None)
    inner = getattr(mysql_sock, "sock", mysql_sock)
    if _arm_socket(inner, seconds):
        return
    if _arm_socket(getattr(dbapi_conn, "socket", None), seconds):
        return
    fileno = getattr(dbapi_conn, "fileno", None)
    if not callable(fileno):
        return
    try:
        fd = fileno()
    except Exception:  # noqa: BLE001
        return
    if not isinstance(fd, int) or fd < 0:
        return
    # socket(fileno=) 析构会关闭 fd；设完超时必须 detach，所有权留在驱动里。
    wrapped = socket.socket(fileno=fd)
    try:
        wrapped.settimeout(seconds)
    except Exception:  # noqa: BLE001
        pass
    finally:
        wrapped.detach()


def _looks_like_conn_error(exc: BaseException) -> bool:
    """异常文本是否命中连接类特征。"""
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(marker in text for marker in _CONN_ERROR_MARKERS)


def _iqd_rebuild_instance(conn) -> bool:  # noqa: ANN001
    """关闭坏连接并用该实例所属类自己的构造重建。成功返回 True。

    重入保护：并发请求同时发现连接坏时，只有一个真正重建，其余等锁后复用新连接。
    """
    lock = getattr(conn, "_iqd_rebuild_lock", None)
    orig_init = getattr(conn, "_iqd_orig_init", None)
    if lock is None or orig_init is None:
        return False
    with lock:
        old = getattr(conn, "connection", None)
        if old is not None:
            try:
                old.close()
            except Exception:  # noqa: BLE001 - 旧连接可能已不可用
                pass
        try:
            orig_init(conn, *conn._iqd_init_args, **conn._iqd_init_kwargs)
            conn._closed = False
            _arm_io_timeout(getattr(conn, "connection", None))
            return True
        except Exception:  # noqa: BLE001 - 重建失败按原错误上抛
            return False


def _iqd_execute_with_selfheal(conn, fn, sql, *args, **kwargs):  # noqa: ANN001
    """执行 fn；仅在连接类错误时才重建并重试一次。"""
    try:
        return fn(conn, sql, *args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        if not _looks_like_conn_error(exc):
            raise
        if _iqd_rebuild_instance(conn):
            return fn(conn, sql, *args, **kwargs)
        raise


def _wrap_connector_class(cls: type) -> None:
    """给一个 connector 类打自愈补丁（**每类只包自己定义的方法**）。

    只包 ``cls.__dict__`` 里确实存在的方法：

    * ``MySqlConnector`` 定义了 ``__init__`` / ``query`` / ``dry_run`` → 三者都包；
    * ``DorisConnector`` 只定义 ``__init__``（构造不同：不接受 ANSI_QUOTES），
      ``query`` / ``dry_run`` 继承自父类 → 只包它自己的 ``__init__``，
      避免在父类包装之上再包一层（重试翻倍）以及重建时误用父类构造。

    重建时使用**本类自己的** ``__init__``（实例构造时保存），因此 Doris 实例会走
    Doris 的构造路径。
    """
    if cls.__dict__.get("_iqd_selfheal_patched"):
        return

    own_init = cls.__dict__.get("__init__")
    own_query = cls.__dict__.get("query")
    own_dry_run = cls.__dict__.get("dry_run")

    if own_init is not None:

        def __init__(self, *args, **kwargs):  # noqa: ANN001
            own_init(self, *args, **kwargs)
            self._iqd_init_args = args
            self._iqd_init_kwargs = kwargs
            self._iqd_orig_init = own_init
            self._iqd_rebuild_lock = threading.Lock()
            _arm_io_timeout(getattr(self, "connection", None))

        cls.__init__ = __init__

    if own_query is not None:

        def query(self, sql, *args, **kwargs):  # noqa: ANN001
            return _iqd_execute_with_selfheal(self, own_query, sql, *args, **kwargs)

        cls.query = query

    if own_dry_run is not None:

        def dry_run(self, sql, *args, **kwargs):  # noqa: ANN001
            return _iqd_execute_with_selfheal(self, own_dry_run, sql, *args, **kwargs)

        cls.dry_run = dry_run

    if own_init is not None or own_query is not None or own_dry_run is not None:
        cls._iqd_selfheal_patched = True


def _patch_module(fullname: str, module) -> None:  # noqa: ANN001
    """模块导入完成后给目标类打补丁（逐类、幂等）。"""
    for cls_name in _TARGETS.get(fullname, ()):
        cls = getattr(module, cls_name, None)
        if cls is None:
            continue
        _wrap_connector_class(cls)


class _PostImportPatcher(importlib.abc.MetaPathFinder):
    """导入后钩子：目标模块 exec 完成后执行补丁。

    只安装钩子、不提前 import wren —— 启动零开销，且 wren 缺失/依赖不全时不会报错。
    """

    def find_spec(self, fullname, path=None, target=None):  # noqa: ANN001
        if fullname not in _TARGETS:
            return None
        for finder in sys.meta_path:
            if finder is self:
                continue
            find = getattr(finder, "find_spec", None)
            if find is None:
                continue
            spec = find(fullname, path, target)
            if spec is not None:
                break
        else:
            return None

        loader = spec.loader
        if loader is None or not hasattr(loader, "exec_module"):
            return spec
        if getattr(loader, "_iqd_selfheal_wrapped", False):
            return spec
        orig_exec = loader.exec_module

        def exec_module(module, _orig=orig_exec, _name=fullname):  # noqa: ANN001
            _orig(module)
            try:
                _patch_module(_name, module)
            except Exception:  # noqa: BLE001 - 补丁失败绝不影响 wren 正常启动
                pass

        try:
            loader.exec_module = exec_module  # type: ignore[method-assign]
            loader._iqd_selfheal_wrapped = True  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 - 某些 loader 不允许赋值，退回不包装
            return spec
        return spec


def _install() -> None:
    if any(isinstance(f, _PostImportPatcher) for f in sys.meta_path):
        return
    sys.meta_path.insert(0, _PostImportPatcher())


if _ENABLED:
    _install()
