"""WrenMcpAgent 请求体契约自检（跨仓库边界的那条线）。

<p><b>为什么值得钉</b>：2026-09-28 实测踩过 —— ``api_cli`` 里用了 ``req.list_prefix``，
但 ``CliRequest`` 模型没定义该字段 → Pydantic 丢弃入参 → 访问属性时
``AttributeError`` → 线上表现是 ``list_path`` **一律 HTTP 500**，且旧代码只回裸
``Internal Server Error``（没有消息），排查花了三轮部署才定位。

<p>本用例把「**代码用到的 ``req.*`` 字段必须都在模型里声明**」变成一条断言：
以后给 agent 加字段只加一半，本地就会红。
"""

from __future__ import annotations

import importlib.util
import pathlib
import re
import sys

_AGENT_PY = (
    pathlib.Path(__file__).resolve().parents[2]
    / "deploy"
    / "wrenai"
    / "wren-mcp-agent"
    / "agent.py"
)


def _load_agent_module():
    """按路径加载 wren 机上的 agent.py（它不是本包的一部分）。"""
    sys.path.insert(0, str(_AGENT_PY.parent))
    spec = importlib.util.spec_from_file_location("wren_mcp_agent_under_test", _AGENT_PY)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # 必须先登记进 sys.modules：agent.py 用了 dataclasses/pydantic，它们在实际建类时
    # 会回查 `sys.modules[cls.__module__]`（不登记会报 'NoneType' object has no attribute '__dict__'）。
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_request_fields_used_are_declared():
    """``api_cli`` 里 ``req.<field>`` 用到的字段必须都在 ``CliRequest`` 里声明。

    <p>只扫 ``api_cli`` 函数体：其余端点（ensure/start/stop/restart…）用的是各自的请求模型，
    不归 ``CliRequest`` 管。
    """
    module = _load_agent_module()
    source = _AGENT_PY.read_text(encoding="utf-8")
    start = source.index("async def api_cli(")
    rest = source[start:]
    end = rest.find("\n@app.")
    body = rest if end == -1 else rest[:end]
    used = set(re.findall(r"req\.(\w+)", body))
    declared = set(module.CliRequest.model_fields)
    missing = sorted(used - declared)
    assert not missing, f"api_cli 用到但 CliRequest 未声明: {missing}"


def test_file_op_fields_declared():
    """文件操作三件套（写/删/列）与列目录前缀过滤必须在模型里。"""
    module = _load_agent_module()
    declared = set(module.CliRequest.model_fields)
    assert {"files", "delete_paths", "list_path", "list_prefix"} <= declared


def test_mdl_manifest_and_args_still_declared():
    """既有字段不能被误删（跨机器 MDL 部署与 CLI 执行都依赖）。"""
    module = _load_agent_module()
    declared = set(module.CliRequest.model_fields)
    assert {"conn_id", "args", "mdl_manifest", "timeout_seconds"} <= declared
