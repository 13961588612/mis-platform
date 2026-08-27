"""WrenMcpAgent — wren 机常驻 supervisor + 控制面 + 数据面反向代理（方案 A 落地，v0.2）。

单台 wren 机部署一个本进程（systemd / Docker 托管，持久卷），职责：

1. **desired_state reconcile**：声明式维持每连接 ``wren serve mcp`` 进程
   （running 须存活；stopped 须终止），崩溃自动重启（自愈）。
2. **端口段分配/回收**：从 ``WREN_AGENT_WREN_PORT_RANGE`` 按连接分配，停止回收复用。
3. **控制面（bearer 鉴权，去 mTLS）**：``/internal/v1/wren-mcp/{ensure,start,
   stop,restart,status,heartbeat,health}``，由 ai-platform 的 WrenMcpAgentClient 调。
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
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Request, Response
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


@app.get("/internal/v1/wren-mcp/health")
async def api_health(_: None = Depends(require_bearer)) -> JSONResponse:
    """agent 整体健康。"""
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
    main()
