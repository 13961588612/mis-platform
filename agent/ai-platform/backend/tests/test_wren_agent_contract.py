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


def test_normalize_cred_from_credential_json():
    """平台下发 WREN_IQD_CREDENTIAL_JSON → 归一为 profile 字段（路线 A 修复）。"""
    module = _load_agent_module()
    import json as _json

    cred = {
        "WREN_IQD_CREDENTIAL_JSON": _json.dumps(
            {
                "db_type": "doris",
                "host": "10.0.0.1",
                "port": 9030,
                "user": "query",
                "password": "pwd",
                "database": "adhoc",
            }
        )
    }
    out = module._normalize_cred(cred)
    assert out["host"] == "10.0.0.1"
    assert out["port"] == 9030
    assert out["user"] == "query"
    assert out["password"] == "pwd"
    assert out["database"] == "adhoc"
    assert out["db_type"] == "doris"


def test_normalize_cred_falls_back_to_wren_pg_keys():
    """无 JSON 时退回 WREN_PG_* 键。"""
    module = _load_agent_module()
    out = module._normalize_cred(
        {
            "WREN_PG_HOST": "h",
            "WREN_PG_PORT": "5432",
            "WREN_PG_USER": "u",
            "WREN_PG_PASSWORD": "p",
            "WREN_PG_DB": "d",
            "WREN_DB_TYPE": "postgres",
        }
    )
    assert out == {
        "host": "h",
        "port": "5432",
        "user": "u",
        "password": "p",
        "database": "d",
        "db_type": "postgres",
    }


def test_serve_mcp_command_includes_profile():
    """`serve mcp` 必须带 --profile（wren 0.13 用 profile 选连接；无此则落全局 active）。"""
    source = _AGENT_PY.read_text(encoding="utf-8")
    assert '"--profile"' in source
    assert "_ensure_profile" in source
    # profile 必须写占位而非明文
    assert "${IQD_DB_PASSWORD}" in source


def test_cli_lock_serializes_same_connection():
    """同一 conn_id 的 /cli 必须串行（防 LanceDB / target/mdl.json 并发竞争）。

    <p>背景（2026-09-30 排查）：自愈 force-rebuild 与 re-index 并发触发时，
    两个 ``wren memory index`` 会同时操作同一 ``.wren/memory`` LanceDB，偶发
    ``Table 'schema_items' already exists``；``memory reset`` 插进 index 中间则报
    ``was not found``。agent 侧对同 conn_id 加锁即消除该竞争。
    """
    import asyncio

    module = _load_agent_module()

    events: list[str] = []

    async def worker(tag: str, delay: float) -> None:
        async with module._get_cli_lock("c1"):
            events.append(f"{tag}:enter")
            await asyncio.sleep(delay)
            events.append(f"{tag}:exit")

    async def main() -> None:
        await asyncio.gather(worker("a", 0.05), worker("b", 0.01))

    asyncio.run(main())
    assert events in (
        ["a:enter", "a:exit", "b:enter", "b:exit"],
        ["b:enter", "b:exit", "a:enter", "a:exit"],
    ), events


def test_cli_lock_is_per_connection():
    """不同 conn_id 各有独立锁（不互相阻塞）。"""
    module = _load_agent_module()
    assert module._get_cli_lock("c1") is module._get_cli_lock("c1")
    assert module._get_cli_lock("c1") is not module._get_cli_lock("c2")
