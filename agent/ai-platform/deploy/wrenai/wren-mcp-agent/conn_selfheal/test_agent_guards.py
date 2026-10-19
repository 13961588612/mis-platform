"""agent.py 防卡死：日志上限、孤儿 cmdline，以及启动互斥 / 端口归还。"""

from __future__ import annotations

import ast
import os
import shutil
import tempfile
import uuid
from pathlib import Path

AGENT_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agent.py")


def _load(names: set[str]) -> dict:
    src = open(AGENT_PY, encoding="utf-8").read()
    tree = ast.parse(src)
    funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {f.name for f in funcs} == names
    prelude = (
        "import os\nimport re\n"
        "_CHILD_LOG_MAX_BYTES = 8 * 1024 * 1024\n"
        "_CHILD_LOG_KEEP_BYTES = 256 * 1024\n"
        "_PORT_IN_CMD = re.compile(r'--port(?:=|\\s+)(\\d+)')\n"
    )
    namespace: dict = {}
    exec(compile(prelude + "\n\n".join(ast.unparse(f) for f in funcs), AGENT_PY, "exec"), namespace)
    return namespace


def _tmpdir() -> Path:
    base = Path(tempfile.gettempdir()) / f"wren-log-{uuid.uuid4().hex}"
    base.mkdir(parents=True, exist_ok=True)
    return base


def test_append_capped_log_keeps_tail() -> None:
    ns = _load({"_append_capped_log"})
    directory = _tmpdir()
    path = directory / "wren-mcp.log"
    try:
        ns["_append_capped_log"](str(path), b"line-a\n", max_bytes=20, keep_bytes=8)
        assert path.read_bytes() == b"line-a\n"
        ns["_append_capped_log"](str(path), b"line-bbbbbbbb\n", max_bytes=20, keep_bytes=8)
        data = path.read_bytes()
        assert data.startswith(b"[log truncated]\n")
        assert len(data) < 80
        assert b"line-a" not in data
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def test_orphan_cmdline_port_matches_only_our_wren() -> None:
    ns = _load({"_orphan_cmdline_port"})
    ports = {18080, 18081}
    match = ns["_orphan_cmdline_port"]
    assert match("/usr/bin/wren serve mcp --port 18080", ports) == 18080
    assert match("wren serve mcp --port=18081 --project /tmp", ports) == 18081
    assert match("wren serve mcp --port 19000", ports) is None
    assert match("python agent.py --port 18080", ports) is None
    assert match("wren memory index --port 18080", ports) is None


class _Proc:
    def __init__(self) -> None:
        self.returncode = None
        self.pid = 4242

    def terminate(self) -> None:
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode or 0


def test_concurrent_ensure_starts_one_process(monkeypatch) -> None:
    import asyncio

    import agent

    launches: list[int] = []

    async def fake_launcher(self, command, env, cwd):  # noqa: ANN001
        launches.append(1)
        await asyncio.sleep(0.05)
        return _Proc()

    async def ready(port, timeout):  # noqa: ANN001
        return True

    monkeypatch.setattr(agent.WrenMcpSupervisor, "_launcher", fake_launcher)
    monkeypatch.setattr(agent, "_wait_port_open", ready)
    directory = _tmpdir()

    async def _run() -> None:
        sup = agent.WrenMcpSupervisor()
        home = str(directory)
        first, second = await asyncio.gather(
            sup.ensure("c1", project_home=home, desired_state="running"),
            sup.ensure("c1", project_home=home, desired_state="running"),
        )
        assert first.status == "running"
        assert second.status == "running"
        assert len(launches) == 1

    try:
        asyncio.run(_run())
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def test_stop_keeps_port_when_process_survives(monkeypatch) -> None:
    import asyncio

    import agent

    async def stuck_kill(proc):  # noqa: ANN001
        return None

    monkeypatch.setattr(agent, "_kill_proc_tree", stuck_kill)
    directory = _tmpdir()

    async def _run() -> None:
        sup = agent.WrenMcpSupervisor()
        port = await sup._ports.allocate("c2")
        entry = agent.AgentProcessEntry(conn_id="c2", project_home=str(directory), port=port)
        entry.proc = _Proc()
        entry.status = "running"
        sup._entries["c2"] = entry
        await sup.stop("c2")
        assert entry.port_held is True
        assert port in sup._ports._used

    try:
        asyncio.run(_run())
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def test_stop_releases_port_after_exit(monkeypatch) -> None:
    import asyncio

    import agent

    async def dead_kill(proc):  # noqa: ANN001
        proc.returncode = 0

    monkeypatch.setattr(agent, "_kill_proc_tree", dead_kill)

    async def _run() -> None:
        sup = agent.WrenMcpSupervisor()
        port = await sup._ports.allocate("c3")
        entry = agent.AgentProcessEntry(conn_id="c3", project_home=".", port=port)
        entry.proc = _Proc()
        entry.status = "running"
        sup._entries["c3"] = entry
        await sup.stop("c3")
        assert entry.port_held is False
        assert port not in sup._ports._used

    asyncio.run(_run())
