"""WrenMcpAgent — wren 机常驻 supervisor + 控制面 + 数据面反向代理（方案 A 落地，v0.2）。

单台 wren 机部署一个本进程（systemd / Docker 托管，持久卷），职责：

1. **desired_state reconcile**：声明式维持每连接 ``wren serve mcp`` 进程
   （running 须存活；stopped 须终止），崩溃自动重启（自愈）。
2. **端口段分配/回收**：从 ``WREN_AGENT_WREN_PORT_RANGE`` 按连接分配，停止回收复用。
3. **控制面（bearer 鉴权，去 mTLS）**：``/internal/v1/wren-mcp/{ensure,start,
   stop,restart,status,heartbeat,cli,health}``，由 ai-platform 的 WrenMcpAgentClient 调。
   ``cli`` 用于跨机器管理面（``wren context build`` / ``memory index`` 等）。
4. **数据面反向代理**：``/mcp/{conn_id}`` 按 connId 路由到本机
   ``http://127.0.0.1:{local_port}/mcp``，入口 bearer 校验（决策 ②）。
5. **凭证 env 注入（S1）**：``ensure`` 推送的凭证明文经内网+bearer 通道到达后，
   写入临时 env 文件（chmod 600）即用即删，注入 wren 子进程 env；**绝不**持久化、
   **不**接 Vault。

依赖：fastapi + uvicorn + httpx（反向代理用）。wren CLI 须在本机 PATH。
"""

from __future__ import annotations

import asyncio
import os
import re
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, List, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from utils.logging import get_logger

logger = get_logger("wren_mcp_agent")


# ================================================================ 配置


class AgentSettings(BaseSettings):
    """WrenMcpAgent 运行配置（env 驱动，见 .env.example）。"""

    model_config = SettingsConfigDict(env_prefix="WREN_AGENT_", extra="ignore")

    control_port: int = Field(default=9100, description="控制面监听端口")
    mcp_port: int = Field(default=9101, description="数据面 MCP 反向代理端口")
    bind_host: str = Field(default="0.0.0.0", description="监听地址（数据面须可被 ai-platform 内网直达）")
    public_host: str = Field(
        default="",
        description=(
            "ai-platform 可达地址（回执 control_endpoint/mcp_endpoint 用此地址）；"
            "缺省取 bind_host。wren 机多网卡/容器化时须显式设为 ai-platform 可路由到的"
            " IP 或服务名（决策 ①⑧：跨机器数据面可达性）"
        ),
    )
    token: str = Field(default="", description="控制面/数据面共享 bearer token（内网隔离兜底）")
    wren_cli_bin: str = Field(default="wren", description="wren CLI 可执行文件")
    projects_root: str = Field(
        default="/var/lib/mis-iqd/wren-projects",
        description="wren project 根目录；每连接 project_home = {root}/{connId}",
    )
    wren_port_range: str = Field(
        default="18080-18180", description="本机端口段（按连接分配/回收）"
    )
    transport: str = Field(default="http", description="MCP transport（仅 http）")
    health_interval_seconds: float = Field(default=15.0, description="自愈健康循环间隔")
    start_timeout_seconds: float = Field(default=60.0, description="单次拉起等待 ready 超时")
    max_connections: int = Field(default=10, description="≤10 DB（决策 ⑦）：并发连接上限")


_settings = AgentSettings()


def _reachable_host() -> str:
    """ai-platform 可达地址（回执用）。

    缺省取 ``bind_host``；多网卡/容器化场景由 ``public_host`` 显式覆盖为可路由地址
    （决策 ①⑧：跨机器数据面可达性）。
    """
    return _settings.public_host or _settings.bind_host


# ================================================================ 鉴权


async def require_bearer(request: Request) -> None:
    """控制面/数据面 bearer 鉴权（决策 ②：bearer-token + 内网隔离，去 mTLS）。

    未配置 token 时（内网已隔离）放行；配置后必须 ``Authorization: Bearer <token>``
    或 ``X-Agent-Token: <token>`` 命中。
    """
    if not _settings.token:
        return
    auth = request.headers.get("Authorization", "")
    header_token = request.headers.get("X-Agent-Token", "")
    ok = False
    if auth.lower().startswith("bearer "):
        ok = auth[len("bearer "):].strip() == _settings.token
    if not ok and header_token:
        ok = header_token.strip() == _settings.token
    if not ok:
        raise UnauthorizedError()


class UnauthorizedError(Exception):
    """鉴权失败。"""


# ================================================================ 端口分配


def _parse_port_range(port_range: str) -> list[int]:
    ports: set[int] = set()
    for seg in port_range.split(","):
        seg = seg.strip()
        if not seg:
            continue
        if "-" in seg:
            low_s, high_s = seg.split("-", 1)
            low, high = int(low_s.strip()), int(high_s.strip())
            if low > high:
                raise ValueError(f"端口段非法: {seg}")
            ports.update(range(low, high + 1))
        else:
            ports.add(int(seg))
    return sorted(ports)


class PortAllocator:
    """本机端口段分配/回收（按连接）。"""

    def __init__(self, port_range: str) -> None:
        self._all = set(_parse_port_range(port_range))
        self._used: set[int] = set()
        self._lock = asyncio.Lock()

    async def allocate(self, conn_id: str) -> int:
        async with self._lock:
            for p in sorted(self._all):
                if p not in self._used:
                    self._used.add(p)
                    logger.info("agent port allocated", conn_id=conn_id, port=p)
                    return p
            raise RuntimeError(f"端口段已用尽（≤{_settings.max_connections} 连接），无法为 {conn_id} 分配")

    async def release(self, port: int) -> None:
        async with self._lock:
            self._used.discard(port)


# ================================================================ 进程管理


@dataclass
class AgentProcessEntry:
    """单连接 wren serve mcp 进程（本机）条目。"""

    conn_id: str
    project_home: str
    port: int
    status: str = "starting"
    proc: Any = None
    desired_state: str = "running"  # running | stopped
    name: str = ""
    agent_handle: str = ""
    command: list[str] = field(default_factory=list)
    credential: dict[str, str] = field(default_factory=dict)  # 仅驻内存，绝不落盘
    started_at: float = 0.0
    last_health_at: float = 0.0
    failure_count: int = 0


class WrenMcpSupervisor:
    """本机 wren serve mcp 进程 supervisor（崩溃自愈 + 端口分配）。"""

    def __init__(self) -> None:
        self._ports = PortAllocator(_settings.wren_port_range)
        self._entries: dict[str, AgentProcessEntry] = {}
        self._lock = asyncio.Lock()

    # ---- 凭证临时文件：chmod 600 即用即删（S1，不落盘） ----
    def _build_env(self, credential: dict[str, str], project_home: str) -> dict[str, str] | None:
        """把凭证明文注入子进程 env；经临时文件即用即删，避免明文常驻盘。

        Returns:
            合并后的子进程环境（{**os.environ, **credential}）；credential 为空返回
            ``None``（沿用 os.environ）。
        """
        if not credential:
            return None
        tmp_path = os.path.join(
            project_home, f".iqd-cred-{uuid.uuid4().hex[:8]}.env"
        )
        try:
            os.makedirs(project_home, exist_ok=True)
            fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    for k, v in credential.items():
                        if v is None:
                            continue
                        fh.write(f"{k}={v}\n")
            finally:
                pass
            # 读取即注入 os.environ（临时文件使命完成，立即删除）
            env = {**os.environ, **{k: str(v) for k, v in credential.items() if v is not None}}
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        return env

    async def _launcher(self, command: list[str], env: dict[str, str] | None, cwd: str) -> Any:
        return await asyncio.create_subprocess_exec(
            *command,
            env=env,
            cwd=cwd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )

    async def ensure(
        self,
        conn_id: str,
        *,
        project_home: str,
        desired_state: str = "running",
        name: str = "",
        credential: dict[str, str] | None = None,
    ) -> AgentProcessEntry:
        """声明式 ensure：running 则维持/拉起；stopped 则确保终止。"""
        async with self._lock:
            entry = self._entries.get(conn_id)
            if entry is None:
                port = await self._ports.allocate(conn_id)
                entry = AgentProcessEntry(
                    conn_id=conn_id,
                    project_home=project_home,
                    port=port,
                    name=name or f"iqd-conn-{conn_id}",
                    agent_handle=uuid.uuid4().hex,
                    desired_state=desired_state,
                    credential=credential or {},
                )
                self._entries[conn_id] = entry
            else:
                entry.desired_state = desired_state
                if credential:
                    entry.credential = credential
        if desired_state == "running":
            await self._start_locked(entry)
        else:
            await self.stop(conn_id)
        return entry

    async def _start_locked(self, entry: AgentProcessEntry) -> None:
        """拉起（或重拉）进程；调用方须已持锁或仅本协程操作该 entry。"""
        async with self._lock:
            # 已在运行且存活 → 跳过
            if (
                entry.proc is not None
                and entry.proc.returncode is None
                and entry.status == "running"
            ):
                return
            entry.status = "starting"
        project_home = entry.project_home
        os.makedirs(project_home, exist_ok=True)
        command = [
            _settings.wren_cli_bin,
            "serve", "mcp",
            "--transport", _settings.transport,
            "--host", "127.0.0.1",
            "--port", str(entry.port),
            "--project", project_home,
        ]
        entry.command = command
        env = self._build_env(entry.credential, project_home)
        try:
            proc = await self._launcher(command, env, project_home)
        except Exception as exc:  # noqa: BLE001
            async with self._lock:
                entry.status = "crashed"
            logger.error("agent start failed", conn_id=entry.conn_id, error=str(exc))
            raise
        async with self._lock:
            entry.proc = proc
            entry.status = "running"
            entry.started_at = time.time()
            entry.last_health_at = time.time()
            entry.failure_count = 0
        logger.info("agent wren serve mcp started", conn_id=entry.conn_id, port=entry.port)

    async def stop(self, conn_id: str) -> None:
        async with self._lock:
            entry = self._entries.get(conn_id)
            if entry is None:
                return
            entry.desired_state = "stopped"
            proc = entry.proc
            port = entry.port
            entry.status = "stopped"
            entry.proc = None
        if proc is not None:
            await self._terminate(proc)
        await self._ports.release(port)
        logger.info("agent wren serve mcp stopped", conn_id=conn_id, port=port)

    async def restart(self, conn_id: str) -> AgentProcessEntry | None:
        async with self._lock:
            entry = self._entries.get(conn_id)
        if entry is None:
            return None
        # 终止旧进程（保留端口），重注凭证后拉起
        async with self._lock:
            proc = entry.proc
        if proc is not None:
            await self._terminate(proc)
        await self._start_locked(entry)
        return entry

    async def _terminate(self, proc: Any) -> None:
        try:
            if proc.returncode is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=10.0)
                except (asyncio.TimeoutError, ProcessLookupError):
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=5.0)
                    except (asyncio.TimeoutError, ProcessLookupError):
                        pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("agent terminate error", error=str(exc))
        finally:
            pass

    def get(self, conn_id: str) -> AgentProcessEntry | None:
        return self._entries.get(conn_id)

    def list(self) -> list[AgentProcessEntry]:
        return list(self._entries.values())

    async def health_iteration(self) -> None:
        """单次自愈迭代：崩溃/期望 running 未存活 → 重启。"""
        snapshot = list(self._entries.values())
        for entry in snapshot:
            if entry.desired_state != "running":
                continue
            alive = entry.proc is not None and entry.proc.returncode is None
            async with self._lock:
                if not alive and entry.status == "running":
                    entry.status = "crashed"
            if not alive:
                logger.warning("agent process crashed, self-healing", conn_id=entry.conn_id, port=entry.port)
                try:
                    await self._start_locked(entry)
                except Exception as exc:  # noqa: BLE001
                    logger.error("agent self-heal failed", conn_id=entry.conn_id, error=str(exc))


supervisor = WrenMcpSupervisor()


# ================================================================ 控制面 API 模型


class EnsureRequest(BaseModel):
    conn_id: str
    project_home: str
    desired_state: str = "running"
    name: str = ""
    credential: dict[str, str] = Field(default_factory=dict)
    secret_ref: str = ""


class StopRequest(BaseModel):
    conn_id: str


class RestartRequest(BaseModel):
    conn_id: str
    credential: dict[str, str] = Field(default_factory=dict)


class ProjectFile(BaseModel):
    """project 内文本文件（``path`` 必须是 ``project_home`` 下的相对路径）。"""

    path: str
    content: str


class CliRequest(BaseModel):
    """跨机器管理面：在 wren 机本机执行 ``wren`` CLI（context build / memory index 等）。

    ai-platform 无本地 wren 时走此通道；``args`` 不含二进制名。可选 ``mdl_manifest``
    为派生 MDL 的 ``manifest.json`` 全文，agent 写临时目录后追加 ``--mdl <tmpdir>``。

    ``files``：平台生成的 project 内文本文件（相对 ``project_home``），用于下发
    ``knowledge/rules/*.md`` 这类**只能落文件、没有 CLI 写入口**的知识；写入后
    （``args`` 为空时）直接返回，不再执行 CLI。
    """

    conn_id: str
    args: List[str] = Field(default_factory=list)
    mdl_manifest: Optional[str] = None
    files: Optional[List[ProjectFile]] = None
    """平台下发的 project 内文本文件（覆盖写）。"""
    delete_paths: Optional[List[str]] = None
    """要删除的 project 内相对文件（只删文件，目录/越界一律拒绝）。"""
    list_path: Optional[str] = None
    """要列出的 project 内相对**目录**（返回其中文件与其正文，供平台做状态对账）。"""
    list_prefix: Optional[str] = None
    """列目录时的文件名前缀过滤（如 ``mis-``；缺省=不过滤）。"""
    timeout_seconds: float = 120.0


def _safe_rel_path(path: str) -> str:
    """校验并归一 project 内相对路径（越界即拒）。"""

    raw = (path or "").replace("\\", "/").strip()
    if raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise HTTPException(status_code=400, detail=f"非法 project 相对路径（不允许绝对路径）: {path!r}")
    normalized = raw.strip("/")
    segments = [seg for seg in normalized.split("/")]
    if not normalized or any(seg in ("", ".", "..") for seg in segments):
        raise HTTPException(status_code=400, detail=f"非法 project 相对路径: {path!r}")
    return normalized


def _write_project_files(project_home: str, files: List[ProjectFile]) -> List[str]:
    """把平台下发的文本文件写入 ``project_home``（含父目录），返回已写相对路径。"""

    written: List[str] = []
    for item in files:
        rel = _safe_rel_path(item.path)
        dest = os.path.join(project_home, *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(item.content)
        written.append(rel)
    return written


def _delete_project_files(project_home: str, paths: List[str]) -> List[str]:
    """删除 ``project_home`` 下的相对文件（仅文件；不存在视为已删除）。"""

    deleted: List[str] = []
    for raw in paths:
        rel = _safe_rel_path(raw)
        dest = os.path.join(project_home, *rel.split("/"))
        if os.path.isdir(dest):
            raise HTTPException(status_code=400, detail=f"拒绝删除目录: {rel!r}")
        if os.path.isfile(dest):
            os.remove(dest)
        deleted.append(rel)
    return deleted


def _list_project_files(
    project_home: str,
    rel_dir: str,
    prefix: Optional[str] = None,
    *,
    max_files: int = 500,
    max_bytes: int = 2_000_000,
) -> List[dict]:
    """列出 project 内某目录下的文件（相对路径 + 正文），供平台做下发对账。

    只读、只递归一层目录：``knowledge/sql`` 这类平的 sink 足够用；
    ``max_files`` / ``max_bytes`` 兜底防止误列大目录或把大文件读爆内存。

    <p>**不可读文件一律跳过**（权限、非 UTF-8 二进制、超大文件）—— 对账只需要文本类
    sink；为了一个二进制文件把整次下发打挂（此前表现为 HTTP 500，且日志里只有
    ``Internal Server Error``，极难定位）是不划算的。
    """

    rel = _safe_rel_path(rel_dir)
    root = os.path.join(project_home, *rel.split("/"))
    if not os.path.isdir(root):
        return []
    out: List[dict] = []
    for name in sorted(os.listdir(root)):
        if prefix and not name.startswith(prefix):
            continue
        full = os.path.join(root, name)
        if not os.path.isfile(full):
            continue
        try:
            if os.path.getsize(full) > max_bytes:
                continue
            with open(full, encoding="utf-8") as fh:
                content = fh.read()
        except (OSError, UnicodeDecodeError):
            continue
        out.append({"path": f"{rel}/{name}", "content": content})
        if len(out) >= max_files:
            break
    return out


# ================================================================ 应用


def _dep_ok() -> None:
    """鉴权依赖（FastAPI 语法糖）。"""
    return None


app = FastAPI(title="WrenMcpAgent", version="0.2.0")
# 数据面反向代理独立 app（监听 mcp_port，与 control_port 分离，决策 ② 内网隔离）
proxy_app = FastAPI(title="WrenMcpAgent-DataPlane", version="0.2.0")


@app.exception_handler(UnauthorizedError)
async def _unauthorized_handler(request: Request, exc: UnauthorizedError) -> JSONResponse:  # noqa: ARG001
    """鉴权失败 → 401（决策 ②：bearer + 内网隔离，去 mTLS）。"""
    return JSONResponse({"code": 401, "message": "unauthorized"}, status_code=401)


proxy_app.add_exception_handler(UnauthorizedError, _unauthorized_handler)


@app.on_event("startup")
async def _startup() -> None:  # pragma: no cover - 进程级
    asyncio.create_task(_health_loop())


async def _health_loop() -> None:  # pragma: no cover - 进程级
    while True:
        try:
            await supervisor.health_iteration()
        except Exception as exc:  # noqa: BLE001
            logger.warning("agent health loop error", error=str(exc))
        await asyncio.sleep(_settings.health_interval_seconds)


def _entry_view(entry: AgentProcessEntry) -> dict[str, Any]:
    alive = entry.proc is not None and entry.proc.returncode is None
    return {
        "conn_id": entry.conn_id,
        "status": entry.status,
        "wren_host": "127.0.0.1",
        "local_port": entry.port,
        "mcp_endpoint": f"http://{_reachable_host()}:{_settings.mcp_port}",
        "agent_handle": entry.agent_handle,
        "project_home": entry.project_home,
        "desired_state": entry.desired_state,
        "alive": alive,
        "pid": entry.proc.pid if entry.proc is not None else None,
        "last_health_at": entry.last_health_at,
    }


@app.post("/internal/v1/wren-mcp/ensure")
async def api_ensure(req: EnsureRequest, _: None = Depends(require_bearer)) -> JSONResponse:
    """声明式 ensure：拉起/维持连接部署，回传数据面 mcp_endpoint 与 agent_handle。"""
    entry = await supervisor.ensure(
        req.conn_id,
        project_home=req.project_home,
        desired_state=req.desired_state,
        name=req.name,
        credential=req.credential,
    )
    view = _entry_view(entry)
    return JSONResponse(
        {
            "code": 0,
            "data": {
                "conn_id": entry.conn_id,
                "control_endpoint": f"http://{_reachable_host()}:{_settings.control_port}",
                "mcp_endpoint": view["mcp_endpoint"],
                "agent_handle": entry.agent_handle,
                "wren_host": "127.0.0.1",
                "status": entry.status,
                "project_home": entry.project_home,
                "secret_ref": req.secret_ref,
            },
        }
    )


@app.post("/internal/v1/wren-mcp/start")
async def api_start(req: EnsureRequest, _: None = Depends(require_bearer)) -> JSONResponse:
    """显式拉起（desired_state=running）。"""
    req.desired_state = "running"
    return await api_ensure(req, _)


@app.post("/internal/v1/wren-mcp/stop")
async def api_stop(req: StopRequest, _: None = Depends(require_bearer)) -> JSONResponse:
    """停止连接（desired_state=stopped）。"""
    await supervisor.stop(req.conn_id)
    return JSONResponse({"code": 0, "data": {"conn_id": req.conn_id, "status": "stopped"}})


@app.post("/internal/v1/wren-mcp/restart")
async def api_restart(req: RestartRequest, _: None = Depends(require_bearer)) -> JSONResponse:
    """重启（复用端口 + 重注凭证）。"""
    entry = await supervisor.restart(req.conn_id)
    if entry is None:
        return JSONResponse({"code": 0, "data": {"conn_id": req.conn_id, "status": "stopped"}})
    view = _entry_view(entry)
    return JSONResponse(
        {
            "code": 0,
            "data": {
                "conn_id": entry.conn_id,
                "mcp_endpoint": view["mcp_endpoint"],
                "agent_handle": entry.agent_handle,
                "wren_host": _reachable_host(),
                "status": entry.status,
                "project_home": entry.project_home,
            },
        }
    )


@app.get("/internal/v1/wren-mcp/status")
async def api_status(conn_id: str, _: None = Depends(require_bearer)) -> JSONResponse:
    """单连接健康快照。"""
    entry = supervisor.get(conn_id)
    if entry is None:
        return JSONResponse(
            {"code": 0, "data": {"conn_id": conn_id, "status": "stopped", "wren_host": "127.0.0.1"}}
        )
    return JSONResponse({"code": 0, "data": _entry_view(entry)})


@app.post("/internal/v1/wren-mcp/heartbeat")
async def api_heartbeat(conn_id: str, _: None = Depends(require_bearer)) -> JSONResponse:
    """心跳保活（ai-platform reconcile/heartbeat 调用）。"""
    entry = supervisor.get(conn_id)
    if entry is not None:
        entry.last_health_at = time.time()
    return JSONResponse(
        {"code": 0, "data": {"conn_id": conn_id, "status": entry.status if entry else "stopped"}}
    )


@app.post("/internal/v1/wren-mcp/cli")
async def api_cli(req: CliRequest, _: None = Depends(require_bearer)) -> JSONResponse:
    """在 wren 机对本连接 project 执行 ``wren`` CLI（跨机器管理面写路径）。

    失败时仍 ``code=0`` + ``exit_code!=0``（与本地 IqdCli 返回形态对齐），由调用方抛错；
    仅二进制缺失 / 超时等基础设施错误用非 0 code。
    """
    entry = supervisor.get(req.conn_id)
    project_home = (
        entry.project_home
        if entry is not None and entry.project_home
        else os.path.join(_settings.projects_root, str(req.conn_id))
    )
    os.makedirs(project_home, exist_ok=True)

    args = list(req.args or [])
    mdl_tmpdir: str | None = None
    deployed_mdl = False

    # 平台下发的 project 文件操作：
    #   - files：覆盖写（knowledge/rules/*.md 等**没有 CLI 写入口**的知识）；
    #   - delete_paths / list_path：**状态对账**用（平台按 tag 回收自己下发的样本）；
    #   - 样本内容本身仍走 `wren memory store` CLI（官方写入口，不经这里落文件）。
    written_files: List[str] = []
    deleted_files: List[str] = []
    listed_files: List[dict] = []
    try:
        if req.files:
            written_files = _write_project_files(project_home, req.files)
            logger.info(
                "agent cli wrote project files",
                conn_id=req.conn_id,
                count=len(written_files),
                files=written_files,
            )
        if req.delete_paths:
            deleted_files = _delete_project_files(project_home, req.delete_paths)
            logger.info(
                "agent cli deleted project files",
                conn_id=req.conn_id,
                count=len(deleted_files),
                files=deleted_files,
            )
        if req.list_path:
            listed_files = _list_project_files(project_home, req.list_path, req.list_prefix)
            logger.info(
                "agent cli listed project files",
                conn_id=req.conn_id,
                path=req.list_path,
                count=len(listed_files),
            )
    except Exception as exc:  # noqa: BLE001 - 转成可读错误，别只留裸 500
        logger.error("agent cli project files op failed", conn_id=req.conn_id, error=str(exc))
        return JSONResponse(
            {
                "code": 50001,
                "message": f"project files op 失败: {type(exc).__name__}: {exc}",
                "data": None,
            },
            status_code=500,
        )
    # ⚠️ 判定依据是「**请求了**文件操作」，不是「产生了结果」——列表为空是最常见情况
    # （目录刚建好 / 已回收干净），若按结果判空就会继续用空 args 跑 `wren` → exit 2 → 500。
    file_op_requested = bool(req.files or req.delete_paths or req.list_path)
    if file_op_requested and not args and not req.mdl_manifest:
        return JSONResponse(
            {
                "code": 0,
                "data": {
                    "conn_id": req.conn_id,
                    "command": "project files op",
                    "exit_code": 0,
                    "stdout": "wrote " + str(len(written_files)) + ", deleted "
                    + str(len(deleted_files)) + ", listed " + str(len(listed_files)) + "\n",
                    "stderr": "",
                    "project_home": project_home,
                    "written": written_files,
                    "deleted": deleted_files,
                    "listed": listed_files,
                },
            }
        )

    if req.mdl_manifest:
        # 新版 wren context build 无 --mdl；平台派生的完整 MDL 直接落 target/mdl.json
        target_dir = os.path.join(project_home, "target")
        os.makedirs(target_dir, exist_ok=True)
        mdl_path = os.path.join(target_dir, "mdl.json")
        with open(mdl_path, "w", encoding="utf-8") as fh:
            fh.write(req.mdl_manifest)
        deployed_mdl = True
        logger.info("agent cli wrote target/mdl.json", conn_id=req.conn_id, path=mdl_path)
        # 剥掉调用方残留的 --mdl <path>
        cleaned: list[str] = []
        skip_next = False
        for token in args:
            if skip_next:
                skip_next = False
                continue
            if token == "--mdl":
                skip_next = True
                continue
            cleaned.append(token)
        args = cleaned

    # 若仅部署 manifest（args 空或只剩 context build），写完 mdl.json 即视为成功；
    # 再跑 context build 会用 YAML 工程覆盖 target/mdl.json。
    only_build = args == ["context", "build"] or args == []
    if deployed_mdl and only_build:
        return JSONResponse(
            {
                "code": 0,
                "data": {
                    "conn_id": req.conn_id,
                    "command": "deploy target/mdl.json",
                    "exit_code": 0,
                    "stdout": f"Deployed platform MDL → {os.path.join(project_home, 'target', 'mdl.json')}\n",
                    "stderr": "",
                    "project_home": project_home,
                },
            }
        )

    command = [_settings.wren_cli_bin, *args]
    logger.info(
        "agent cli exec",
        conn_id=req.conn_id,
        command=" ".join(command),
        cwd=project_home,
    )
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=project_home,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return JSONResponse(
            {
                "code": 50001,
                "message": f"wren CLI 不可用: {_settings.wren_cli_bin}",
                "data": None,
            },
            status_code=500,
        )

    timeout = max(5.0, float(req.timeout_seconds or 120.0))
    stdout_b = b""
    stderr_b = b""
    try:
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except (asyncio.TimeoutError, TimeoutError):
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await proc.wait()
            except Exception:  # noqa: BLE001
                pass
            return JSONResponse(
                {
                    "code": 50002,
                    "message": f"wren CLI 超时(>{timeout}s)",
                    "data": None,
                },
                status_code=500,
            )
    finally:
        if mdl_tmpdir:
            _rm_tree_quiet(mdl_tmpdir)

    stdout = (stdout_b or b"").decode("utf-8", errors="replace")
    stderr = (stderr_b or b"").decode("utf-8", errors="replace")
    exit_code = int(proc.returncode or 0)
    logger.info(
        "agent cli done",
        conn_id=req.conn_id,
        exit_code=exit_code,
        stdout_len=len(stdout),
    )
    return JSONResponse(
        {
            "code": 0,
            "data": {
                "conn_id": req.conn_id,
                "command": " ".join(command),
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "project_home": project_home,
            },
        }
    )


def _rm_tree_quiet(path: str) -> None:
    """尽力删除临时目录（失败仅打日志）。"""
    import shutil

    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("agent cli temp cleanup failed", path=path, error=str(exc))


@app.get("/internal/v1/wren-mcp/health")
async def api_health(_: None = Depends(require_bearer)) -> JSONResponse:
    """agent 整体健康。"""
    import sys

    entries = supervisor.list()
    running = sum(1 for e in entries if e.proc is not None and e.proc.returncode is None)
    return JSONResponse(
        {
            "code": 0,
            "data": {
                "status": "ok",
                "service": "wren-mcp-agent",
                "total": len(entries),
                "running": running,
                "control_port": _settings.control_port,
                "mcp_port": _settings.mcp_port,
                "python": sys.version.split()[0],
                "asyncio_timeout_is_builtin": hasattr(asyncio, "timeout"),
                "wren_cli_bin": _settings.wren_cli_bin,
                "cli_endpoint": True,
            },
        }
    )


# ================================================================ 数据面反向代理（按 connId 路由）


@proxy_app.api_route(
    "/mcp/{conn_id}",
    methods=["GET", "POST", "OPTIONS", "PUT", "DELETE", "PATCH", "HEAD"],
)
async def mcp_proxy(conn_id: str, request: Request, _: None = Depends(require_bearer)) -> Response:
    """MCP 数据面反向代理：/mcp/{conn_id} → http://127.0.0.1:{local_port}/mcp。"""
    entry = supervisor.get(conn_id)
    if entry is None or entry.proc is None or entry.proc.returncode is not None:
        return JSONResponse(
            {"code": 0, "data": {"error": f"连接 {conn_id} 的 wren 进程未就绪"}},
            status_code=503,
        )
    target = f"http://127.0.0.1:{entry.port}/mcp"
    body = await request.body()
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in ("host", "authorization")
    }
    async with httpx.AsyncClient(timeout=_settings.start_timeout_seconds) as client:
        upstream = await client.request(
            request.method, target, content=body, headers=headers,
            params=request.query_params,
        )
    return StreamingResponse(
        content=iter([upstream.content]),
        status_code=upstream.status_code,
        headers={
            k: v
            for k, v in upstream.headers.items()
            if k.lower() not in ("content-length", "transfer-encoding", "connection")
        },
        media_type=upstream.headers.get("content-type"),
    )


# ================================================================ 入口


def main() -> None:  # pragma: no cover
    import uvicorn

    config_control = uvicorn.Config(
        app, host=_settings.bind_host, port=_settings.control_port, log_level="info"
    )
    config_data = uvicorn.Config(
        proxy_app, host=_settings.bind_host, port=_settings.mcp_port, log_level="info"
    )
    server_control = uvicorn.Server(config_control)
    server_data = uvicorn.Server(config_data)
    loop = asyncio.get_event_loop()
    loop.create_task(server_control.serve())
    loop.run_until_complete(server_data.serve())


if __name__ == "__main__":  # pragma: no cover
    try:
        main()
    except Exception:
        import traceback

        crash_path = "/var/lib/mis-iqd/wren-projects/.logs/agent-crash.log"
        try:
            import os

            os.makedirs(os.path.dirname(crash_path), exist_ok=True)
            with open(crash_path, "w", encoding="utf-8") as fh:
                traceback.print_exc(file=fh)
        except Exception:  # noqa: BLE001
            pass
        traceback.print_exc()
        raise
