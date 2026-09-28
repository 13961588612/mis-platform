"""WrenMcpAgentClient — ai-platform 侧远程管控 SDK（方案 A 跨机器落地，v0.2）。

wren 机常驻 :class:`WrenMcpAgent`（见 ``deploy/wrenai/wren-mcp-agent/agent.py``），
本模块是 ai-platform 控制面对其的**远程控制客户端**：

- 鉴权：仅 bearer-token + 内网网络隔离（决策 ②⑥：去 mTLS，无双向证书）；
- 通道：控制面（ensure/start/stop/restart/status/health）+ 数据面（MCP 反向代理
  由 agent 按 connId 路由到本机 127.0.0.1:{local_port}）；
- 凭证：``ensure`` 经控制面把连接凭证（env 映射）**一次性**推给 agent，agent 注入
  wren 子进程 env（不落盘）；wren 机不接 Vault（决策 ③ S1）。

对应设计 §6 注册表 schema：connId → {wren_host, control_endpoint, mcp_endpoint,
agent_handle, status, secret_ref}。ai-platform 仅持有引用，凭证明文绝不落库/落前端/落日志。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("adapters.wren_mcp_agent_client")


class WrenMcpAgentClientError(RuntimeError):
    """WrenMcpAgent 远程控制调用异常（网络失败 / 鉴权失败 / 业务错误）。"""


@dataclass
class WrenMcpAgentEnsureResult:
    """``ensure`` 返回（agent 就绪后的部署快照；对应注册表 schema）。"""

    conn_id: str
    control_endpoint: str
    mcp_endpoint: str
    agent_handle: str
    wren_host: str
    status: str
    project_home: str = ""
    secret_ref: str = ""


@dataclass
class WrenMcpAgentStatus:
    """``status`` 返回（agent 侧单连接健康快照）。"""

    conn_id: str
    status: str
    wren_host: str = ""
    mcp_endpoint: str = ""
    agent_handle: str = ""
    project_home: str = ""
    local_pid: int | None = None
    last_health_at: float = 0.0
    last_health_msg: str = ""


class WrenMcpAgentClient:
    """wren 机 WrenMcpAgent 远程控制客户端（bearer + 内网，无 mTLS）。

    控制面基址取 ``WREN_AGENT_ENDPOINT``（如 ``http://wren-mcp-agent:9100``），
    缺省从 :class:`~src.config.IqdMcpSettings` 读取；为空表示未启用跨机器部署
    （走本地 Plan A 子进程模型）。
    """

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        token: str | None = None,
        timeout: float | None = None,
    ) -> None:
        """初始化客户端。

        Args:
            endpoint: 控制面基址（缺省取 ``WREN_AGENT_ENDPOINT``）。
            token: bearer token（缺省取 ``WREN_AGENT_TOKEN``）。
            timeout: 单次调用超时（缺省取 ``WREN_MCP_TIMEOUT_SECONDS``）。
        """
        settings = get_settings()
        wren = settings.iqd_mcp
        base = (endpoint or wren.wren_agent_endpoint or "").rstrip("/")
        self._endpoint: str = base
        self._token: str = token if token is not None else wren.wren_agent_token
        self._timeout: float = (
            timeout if timeout is not None else wren.wren_mcp_timeout_seconds
        )

    # ================================================================ 开关

    @property
    def enabled(self) -> bool:
        """是否启用跨机器远程管控（控制面基址已配置即视为启用）。"""
        return bool(self._endpoint)

    # ================================================================ 内部

    def _headers(self) -> dict[str, str]:
        """控制面鉴权头（bearer；无 token 时不带，由 agent 据内网放行）。"""
        headers: dict[str, str] = {"Accept": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _url(self, path: str) -> str:
        return f"{self._endpoint}/internal/v1/wren-mcp{path}"

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self._endpoint:
            raise WrenMcpAgentClientError("WrenMcpAgent 控制面未配置（WREN_AGENT_ENDPOINT 为空）")
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    self._url(path), json=payload, headers=self._headers()
                )
        except httpx.TimeoutException as exc:
            raise WrenMcpAgentClientError(f"WrenMcpAgent 调用超时: {path}") from exc
        except httpx.HTTPError as exc:
            raise WrenMcpAgentClientError(f"WrenMcpAgent 不可达: {path} -> {exc}") from exc
        if resp.status_code in (401, 403):
            raise WrenMcpAgentClientError(f"WrenMcpAgent 鉴权失败 {resp.status_code}: {path}")
        if resp.status_code >= 400:
            raise WrenMcpAgentClientError(
                f"WrenMcpAgent HTTP {resp.status_code}: {path} -> {resp.text[:300]}"
            )
        try:
            body: Any = resp.json()
        except ValueError as exc:
            raise WrenMcpAgentClientError(
                f"WrenMcpAgent 响应非 JSON (status={resp.status_code}): {resp.text[:500]}"
            ) from exc
        if isinstance(body, dict) and "code" in body and body.get("code", 0) != 0:
            raise WrenMcpAgentClientError(
                f"WrenMcpAgent 业务错误 code={body.get('code')} message={body.get('message')}"
            )
        return body.get("data", body) if isinstance(body, dict) else body

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self._endpoint:
            raise WrenMcpAgentClientError("WrenMcpAgent 控制面未配置（WREN_AGENT_ENDPOINT 为空）")
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    self._url(path), params=params or {}, headers=self._headers()
                )
        except httpx.HTTPError as exc:
            raise WrenMcpAgentClientError(f"WrenMcpAgent 不可达: {path} -> {exc}") from exc
        if resp.status_code in (401, 403):
            raise WrenMcpAgentClientError(f"WrenMcpAgent 鉴权失败 {resp.status_code}: {path}")
        try:
            body = resp.json()
        except ValueError as exc:
            raise WrenMcpAgentClientError(
                f"WrenMcpAgent 响应非 JSON: {resp.text[:500]}"
            ) from exc
        return body.get("data", body) if isinstance(body, dict) else body

    # ================================================================ 控制面

    async def ensure(
        self,
        conn_id: int | str,
        *,
        project_home: str,
        credential: dict[str, str] | None = None,
        desired_state: str = "running",
        name: str = "",
        secret_ref: str = "",
    ) -> WrenMcpAgentEnsureResult:
        """确保连接部署到位（声明式 reconcile）。

        agent 据 desired_state 拉起/维持本机 ``wren serve mcp`` 进程，分配端口段、
        注入凭证 env、回传数据面 ``mcp_endpoint`` 与控制面 ``control_endpoint`` /
        ``agent_handle``。凭证经控制面一次性推送（S1：明文不落 wren 机盘）。

        Args:
            conn_id: 问数连接 id。
            project_home: wren project 目录（wren 机本地绝对路径）。
            credential: 凭证 env 映射（明文；仅经 bearer+内网通道推送，注入子进程 env）。
            desired_state: ``running``（默认）/ ``stopped``。
            name: profile 名（日志/标识）。
            secret_ref: mis-iqd 侧凭证引用（仅登记，不回明文）。

        Returns:
            :class:`WrenMcpAgentEnsureResult`。
        """
        data = await self._post(
            "/ensure",
            {
                "conn_id": str(conn_id),
                "project_home": project_home,
                "desired_state": desired_state,
                "name": name or f"iqd-conn-{conn_id}",
                "credential": credential or {},
                "secret_ref": secret_ref or "",
            },
        )
        return WrenMcpAgentEnsureResult(
            conn_id=str(conn_id),
            control_endpoint=str(data.get("control_endpoint", "")),
            mcp_endpoint=str(data.get("mcp_endpoint", "")),
            agent_handle=str(data.get("agent_handle", "")),
            wren_host=str(data.get("wren_host", "")),
            status=str(data.get("status", "running")),
            project_home=str(data.get("project_home", project_home)),
            secret_ref=str(data.get("secret_ref", secret_ref or "")),
        )

    async def start(
        self, conn_id: int | str, *, credential: dict[str, str] | None = None
    ) -> WrenMcpAgentEnsureResult:
        """显式拉起（desired_state=running）。"""
        return await self.ensure(conn_id, credential=credential, desired_state="running")

    async def stop(self, conn_id: int | str) -> dict[str, Any]:
        """停止连接（desired_state=stopped）。"""
        return await self._post("/stop", {"conn_id": str(conn_id)})

    async def restart(
        self, conn_id: int | str, *, credential: dict[str, str] | None = None
    ) -> WrenMcpAgentEnsureResult:
        """重启连接（复用端口 + 重注凭证）。"""
        data = await self._post(
            "/restart", {"conn_id": str(conn_id), "credential": credential or {}}
        )
        return WrenMcpAgentEnsureResult(
            conn_id=str(conn_id),
            control_endpoint=str(data.get("control_endpoint", "")),
            mcp_endpoint=str(data.get("mcp_endpoint", "")),
            agent_handle=str(data.get("agent_handle", "")),
            wren_host=str(data.get("wren_host", "")),
            status=str(data.get("status", "running")),
            project_home=str(data.get("project_home", "")),
            secret_ref=str(data.get("secret_ref", "")),
        )

    async def status(self, conn_id: int | str) -> WrenMcpAgentStatus:
        """取单连接健康快照（agent 侧）。"""
        data = await self._get("/status", params={"conn_id": str(conn_id)})
        return WrenMcpAgentStatus(
            conn_id=str(conn_id),
            status=str(data.get("status", "unknown")),
            wren_host=str(data.get("wren_host", "")),
            mcp_endpoint=str(data.get("mcp_endpoint", "")),
            agent_handle=str(data.get("agent_handle", "")),
            project_home=str(data.get("project_home", "")),
            local_pid=data.get("local_pid"),
            last_health_at=float(data.get("last_health_at", 0) or 0),
            last_health_msg=str(data.get("last_health_msg", "")),
        )

    async def health(self) -> dict[str, Any]:
        """agent 整体健康（控制面存活 + 部署计数）。"""
        return await self._get("/health")

    async def run_cli(
        self,
        conn_id: int | str,
        args: list[str],
        *,
        mdl_manifest: str | None = None,
        files: list[dict[str, str]] | None = None,
        delete_paths: list[str] | None = None,
        list_path: str | None = None,
        list_prefix: str | None = None,
        timeout: float | None = None,
        raise_on_error: bool = True,
    ) -> dict[str, Any]:
        """在 wren 机执行 ``wren`` CLI（跨机器管理面：context build / memory index）。

        Args:
            conn_id: 问数连接 id。
            args: 子命令参数（不含二进制名，如 ``["context", "build", "--allow-write"]``）。
            mdl_manifest: 可选派生 MDL 的 ``manifest.json`` 全文；agent 落临时目录并追加 ``--mdl``。
            files: 可选 project 内文本文件 ``[{"path": "knowledge/rules/x.md", "content": "..."}]``；
                agent 在 ``project_home`` 下安全落盘（``path`` 越界即拒）。样本对不走上这条路
                —— 它们由 ``wren memory store`` 写 ``knowledge/sql/*.md``。
            delete_paths: 可选要删除的 project 内相对文件（平台回收自己下发的内容）。
            list_path / list_prefix: 可选列出该目录下的文件（含正文），供平台做状态对账。
            timeout: 单次超时秒数（缺省 ``build_timeout_seconds``）。
            raise_on_error: ``True``（默认）时 ``exit_code != 0`` 抛错；``False`` 时原样返回
                stdout/stderr（供 ``context validate`` 等「警告也可能非零退出」的只读动作）。

        Returns:
            ``{command, exit_code, stdout, stderr, project_home}``。

        Raises:
            WrenMcpAgentClientError: 网络/鉴权/agent 基础设施失败；或
                ``raise_on_error`` 且 ``exit_code != 0``。
        """
        settings = get_settings()
        wait = (
            timeout
            if timeout is not None
            else float(settings.iqd_mcp.build_timeout_seconds or 120.0)
        )
        prev_timeout = self._timeout
        self._timeout = max(prev_timeout, wait + 15.0)
        try:
            data = await self._post(
                "/cli",
                {
                    "conn_id": str(conn_id),
                    "args": list(args),
                    "mdl_manifest": mdl_manifest,
                    "files": files,
                    "delete_paths": delete_paths,
                    "list_path": list_path,
                    "list_prefix": list_prefix,
                    "timeout_seconds": wait,
                },
            )
        finally:
            self._timeout = prev_timeout
        if not isinstance(data, dict):
            raise WrenMcpAgentClientError(f"WrenMcpAgent /cli 响应异常: {data!r}")
        exit_code = int(data.get("exit_code") or 0)
        if exit_code != 0 and raise_on_error:
            stderr = str(data.get("stderr") or "")
            stdout = str(data.get("stdout") or "")
            command = str(data.get("command") or " ".join(args))
            raise WrenMcpAgentClientError(
                f"wren CLI 失败 exit={exit_code}: {command}\n"
                f"stdout: {stdout[:2000]}\nstderr: {stderr[:2000]}"
            )
        return data
