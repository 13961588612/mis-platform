"""agent 侧连接自愈注入的测试（不启动 uvicorn / 不连数据库）。

直接以 AST 方式提取 ``agent.py`` 中与自愈注入相关的两个纯函数
（``_conn_selfheal_dir`` / ``_with_conn_selfheal``）来验证，避免 import agent.py
触发 uvicorn 启动。

断言：
1. 注入把补丁目录放到 PYTHONPATH **最前**（优先加载）；
2. 原有 PYTHONPATH 被保留（不丢用户配置）；
3. ``env=None`` 时基于 os.environ 复制并注入（不影响父进程 os.environ）；
4. 开关关闭时不注入；
5. 目录不存在时不注入（并保留原 env）。
"""

from __future__ import annotations

import ast
import os
import shutil
import tempfile
import uuid
import textwrap
from pathlib import Path
from types import SimpleNamespace

import pytest


def _tmpdir() -> Path:
    """自建临时目录（本机系统 Temp 的 pytest tmp_path 存在权限问题）。"""
    base = Path(tempfile.gettempdir()) / f"selfheal-{uuid.uuid4().hex}"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError:
        base = Path.cwd() / f"selfheal-{uuid.uuid4().hex}"
        base.mkdir(parents=True, exist_ok=True)
    return base

AGENT_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agent.py")


def _load_functions():
    """从 agent.py 抽出两个纯函数（连同其依赖的 _settings / os / logger 占位）。"""
    src = open(AGENT_PY, encoding="utf-8").read()
    tree = ast.parse(src)

    wanted = {"_conn_selfheal_dir", "_with_conn_selfheal"}
    funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
    assert len(funcs) == 2, f"expected 2 funcs, got {[f.name for f in funcs]}"

    # 定义 _settings 占位；logger 用 SimpleNamespace 兜住 warning 调用
    prelude = (
        "import os\n"
        "_settings = None\n"
        "class _L:\n"
        "    def warning(self, *a, **k):\n"
        "        pass\n"
        "logger = _L()\n"
    )
    module_src = prelude + "\n\n".join(ast.unparse(f) for f in funcs)

    namespace: dict = {"__file__": os.path.abspath(AGENT_PY)}
    exec(compile(module_src, AGENT_PY, "exec"), namespace)
    return namespace


def test_inject_puts_patch_dir_first() -> None:
    tmp_path = _tmpdir()
    ns = _load_functions()
    patch_dir = tmp_path / "conn_selfheal"
    patch_dir.mkdir()
    ns["_settings"] = SimpleNamespace(conn_selfheal=True, conn_selfheal_dir=str(patch_dir))

    out = ns["_with_conn_selfheal"]({"PYTHONPATH": "/existing/path"})
    parts = out["PYTHONPATH"].split(os.pathsep)
    assert parts[0] == str(patch_dir), "补丁目录必须在最前"
    assert "/existing/path" in parts, "原有 PYTHONPATH 必须保留"
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_inject_from_none_env_does_not_mutate_os_environ(monkeypatch) -> None:
    tmp_path = _tmpdir()
    ns = _load_functions()
    patch_dir = tmp_path / "conn_selfheal"
    patch_dir.mkdir()
    ns["_settings"] = SimpleNamespace(conn_selfheal=True, conn_selfheal_dir=str(patch_dir))
    monkeypatch.setenv("PYTHONPATH", "/keep/me")

    out = ns["_with_conn_selfheal"](None)
    assert str(patch_dir) in out["PYTHONPATH"].split(os.pathsep)
    assert "/keep/me" in out["PYTHONPATH"].split(os.pathsep)
    # 父进程 os.environ 不得被改动
    assert os.environ["PYTHONPATH"] == "/keep/me"
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_inject_disabled_by_flag() -> None:
    tmp_path = _tmpdir()
    ns = _load_functions()
    patch_dir = tmp_path / "conn_selfheal"
    patch_dir.mkdir()
    ns["_settings"] = SimpleNamespace(conn_selfheal=False, conn_selfheal_dir=str(patch_dir))
    original = {"PYTHONPATH": "/x"}
    assert ns["_with_conn_selfheal"](original) == original
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_inject_noop_when_dir_missing() -> None:
    tmp_path = _tmpdir()
    ns = _load_functions()
    missing = tmp_path / "nope"
    ns["_settings"] = SimpleNamespace(conn_selfheal=True, conn_selfheal_dir=str(missing))
    original = {"PYTHONPATH": "/x"}
    out = ns["_with_conn_selfheal"](original)
    assert out == original, "目录不存在时不得注入"
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_default_dir_is_sibling_conn_selfheal() -> None:
    ns = _load_functions()
    ns["_settings"] = SimpleNamespace(conn_selfheal=True, conn_selfheal_dir="")
    got = ns["_conn_selfheal_dir"]()
    assert got.endswith(os.path.join("wren-mcp-agent", "conn_selfheal"))
