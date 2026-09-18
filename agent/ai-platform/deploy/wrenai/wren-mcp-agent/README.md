# WrenMcpAgent

wren 机常驻 supervisor（方案 A 跨机器落地版，v0.2）。单台 wren 机部署**一个**本进程，
由 systemd / Docker 托管，挂载持久卷保存 project 目录。

## 职责

1. **desired_state reconcile**：声明式维持每连接 `wren serve mcp` 进程（running 须存活；
   stopped 须终止），崩溃自动重启（自愈）。
2. **端口段分配/回收**：从 `WREN_AGENT_WREN_PORT_RANGE` 按连接分配，停止回收复用。
3. **控制面（bearer 鉴权，去 mTLS）**：`/internal/v1/wren-mcp/{ensure,start,stop,restart,
   status,heartbeat,health}`，由 ai-platform 的 `WrenMcpAgentClient` 调。
4. **数据面反向代理**：`/mcp/{conn_id}` 按 connId 路由到本机 `http://127.0.0.1:{local_port}/mcp`，
   入口 bearer 校验（决策 ②）。监听 `WREN_AGENT_MCP_PORT`（与 控制面 `WREN_AGENT_CONTROL_PORT` 分离）。
5. **凭证 env 注入（S1）**：`ensure` 推送的凭证明文经内网+bearer 通道到达后，写入临时 env
   文件（chmod 600）即用即删，注入 wren 子进程 env；**绝不**持久化、**不**接 Vault（决策 ③）。

## 端口

| 端口 | 用途 | 鉴权 |
| --- | --- | --- |
| `WREN_AGENT_CONTROL_PORT` (9100) | 控制面（ensure/start/stop/...） | bearer |
| `WREN_AGENT_MCP_PORT` (9101) | 数据面 MCP 反向代理 `/mcp/{conn_id}` | bearer |

## 部署

### systemd（推荐，决策 ④）

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # TOKEN / PUBLIC_HOST / WREN_CLI_BIN；chmod 600
# unit 通过 EnvironmentFile=-/opt/wren-mcp-agent/.env 加载（须在 Environment= 之后）
sudo cp wren-mcp-agent.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now wren-mcp-agent
```

### Docker

```bash
docker build -t wren-mcp-agent .
docker run -d --restart=always \
  -p 9100:9100 -p 9101:9101 \
  -e WREN_AGENT_TOKEN=__CHANGE_ME__ \
  -v /var/lib/mis-iqd/wren-projects:/var/lib/mis-iqd/wren-projects \
  wren-mcp-agent
```

## 防火墙（决策 ⑤）

仅放行 **ai-platform 源 IP** 到 9100/9101；其余源一律拒绝（内网网络隔离为第一道闸，
bearer token 为第二道闸，二者并存）。

## 与 ai-platform 的配合

ai-platform 侧配置 `WREN_AGENT_ENDPOINT=http://<wren-host>:9100` 与 `WREN_AGENT_TOKEN` 即启用
跨机器管控；`WrenMcpAgentClient.ensure` 推凭证并回传 `mcp_endpoint`（数据面），orchestrator
据 `mcp_endpoint` + bearer 经反向代理问数。未配置 `WREN_AGENT_ENDPOINT` 时回退本地 Plan A
子进程模型（兼容存量测试）。

## 排障

- 进程未就绪：`GET /internal/v1/wren-mcp/status?conn_id=` 看 `status`/`alive`/`pid`。
- 凭证注入失败：检查 wren 机 `wren serve mcp` 日志；临时 env 文件即用即删，盘上不残留明文。
- 重建注册表：重启 agent 即可（进程内注册表，无持久状态；project 目录在持久卷保留）。
