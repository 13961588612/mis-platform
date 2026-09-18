# WrenMcpAgent 跨机器部署 Runbook（方案 A 落地版 v0.2）

> 关联设计：`mis-iqd-mcp-deploy-incremental.md`（v0.2 锁定）。
> 部署物：`agent/ai-platform/deploy/wrenai/wren-mcp-agent/`
> 控制面：`POST/GET /internal/v1/wren-mcp/{ensure,start,stop,restart,status,heartbeat,health}`（端口 9100）
> 数据面：`/mcp/{conn_id}` 反向代理（端口 9101）

---

## 0. 总体架构

- **ai-platform 机**（控制面 + 问数客户端）：持有 `WrenMcpAgentClient`（bearer + 内网，去 mTLS）。
- **wren 机**（单台，决策 ⑧）：常驻 `WrenMcpAgent`（systemd 托管，持久卷），每连接一个
  `wren serve mcp` 进程（绑定本机 `127.0.0.1:{local_port}`），由 agent 反向代理按 connId 路由。
- 凭证（决策 ③ S1）：mis-iqd 仅存 `secret_ref` → ai-platform 经 `CredentialVault` 解析 →
  **一次性**经控制面（bearer + 内网）推送 → agent 注入 wren 子进程 env（不落盘）→ **wren 机不接 Vault**。

```
admin 浏览器
  └─ BFF /iqd/mcp/enable
       └─ ai-platform /api/v1/iqd/mcp/ensure   (IqdMcpLifecycleService.ensure_connection)
            └─ WrenMcpAgentClient.ensure(bearer)  ──内网──▶  wren 机 WrenMcpAgent
                                                          └─ wren serve mcp (127.0.0.1:port)
            ← 回传 mcp_endpoint / agent_handle / status
            └─ 写回 mis-iqd iqd_connection.mcp_host / agent_handle / mcp_status
问数：orchestrator → IqdMcpClient.for_connection → agent 数据面 /mcp/{conn_id} → wren 进程
```

---

## 1. 前置条件

- wren 机：Linux（systemd）、Python 3.11+、wren CLI 在 `PATH`（`wren serve mcp` 可用）。
- 持久卷：`/var/lib/mis-iqd/wren-projects`（每连接 `project_home = {root}/{connId}`，决策 ④）。
- 网络：ai-platform → wren 机 **仅放行源 IP**（防火墙白名单，决策 ⑤）；wren 机 `127.0.0.1` 的
  wren 进程端口**不对外暴露**。
- 凭证源：ai-platform 侧 `CredentialVault` 已登记各连接 `secret_ref`（mis-iqd 存引用，不存明文）。

---

## 2. wren 机安装（systemd）

### 2.1 放置部署物

```bash
# 在 wren 机（不单独建 wrenagent；systemd 默认以 root 运行）
sudo mkdir -p /opt/wren-mcp-agent /var/lib/mis-iqd/wren-projects
sudo cp -r deploy/wrenai/wren-mcp-agent/* /opt/wren-mcp-agent/
cd /opt/wren-mcp-agent
sudo python3 -m venv .venv
sudo .venv/bin/pip install -r requirements.txt
```

### 2.2 环境变量（主路径：`.env` + systemd `EnvironmentFile`）

单元通过 `EnvironmentFile=-/opt/wren-mcp-agent/.env` 加载配置（**须写在** `Environment=` **之后**，同名键以 `.env` 为准）。安装时：

```bash
cd /opt/wren-mcp-agent
sudo cp .env.example .env
sudo chmod 600 .env
# 编辑 TOKEN / PUBLIC_HOST / WREN_CLI_BIN 等
```

最小配置（见 `deploy/wrenai/wren-mcp-agent/.env.example`）：

| 变量 | 说明 | 缺省 |
|------|------|------|
| `WREN_AGENT_TOKEN` | 控制面/数据面共享 bearer token（内网隔离兜底，决策 ②） | 空（内网已隔离则放行） |
| `WREN_AGENT_CONTROL_PORT` | 控制面端口 | 9100 |
| `WREN_AGENT_MCP_PORT` | 数据面反向代理端口 | 9101 |
| `WREN_AGENT_BIND_HOST` | 监听地址（数据面须被 ai-platform 内网直达） | 0.0.0.0 |
| `WREN_AGENT_PUBLIC_HOST` | **ai-platform 可达地址**（回执 `control_endpoint`/`mcp_endpoint` 用此地址；跨机器数据面可达性，决策 ①⑧）。wren 机多网卡/容器化时**必须**显式设为 ai-platform 可路由到的 IP 或服务名；缺省取 `WREN_AGENT_BIND_HOST`（=0.0.0.0，不可达，须覆盖） | 空（缺省取 `WREN_AGENT_BIND_HOST`） |
| `WREN_AGENT_WREN_CLI_BIN` | wren CLI **绝对路径**（systemd PATH 通常不含 `~/wren-venv/bin`） | `/root/wren-venv/bin/wren`（见 `.env.example`） |
| `WREN_AGENT_WREN_PORT_RANGE` | 本机端口段（按连接分配/回收） | 18080-18180 |
| `WREN_AGENT_PROJECTS_ROOT` | wren project 根目录 | /var/lib/mis-iqd/wren-projects |
| `WREN_AGENT_MAX_CONNECTIONS` | 并发连接上限（决策 ⑦ ≤10） | 10 |

> **安全**：`WREN_AGENT_TOKEN` 必须非空且高强度；systemd 单元 `UMask=0077` 收紧
> 临时文件权限（见 `wren-mcp-agent.service`）。`.env` 建议 `chmod 600`。

### 2.3 注册 systemd 单元

```bash
sudo cp /opt/wren-mcp-agent/wren-mcp-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wren-mcp-agent
sudo systemctl status wren-mcp-agent
```

单元要点（`wren-mcp-agent.service`）：

- 默认**不设** `User=`（以 root 跑）；可选改为普通部署账号（须与目录 / `~/.wren` 属主一致）。`UMask=0077`、`Restart=always`（崩溃自愈由 agent 进程 + systemd 双层兜底）。
- 主配置：`EnvironmentFile=-/opt/wren-mcp-agent/.env`；单元内 `Environment=` 仅作缺省兜底。

### 2.4 防火墙（firewalld，仅放行 ai-platform 源 IP，决策 ⑤）

> 完整端口矩阵与验证见 **`wrenai-ops-runbook.md` §1.3（firewalld）与 §3.2（Agent 部署）**。wren 机使用 **firewalld**（RHEL/Rocky/Alma 系）。

```bash
# 前置
sudo dnf install -y firewalld && sudo systemctl enable --now firewalld

# 推荐：仓库脚本（wren 机 root）
export AI_PLATFORM_SOURCE_IP=10.20.0.10   # ai-platform 内网/出口 IP
sudo -E bash /opt/wren-mcp-agent/scripts/open-wren-firewall.sh
# 脚本源：agent/ai-platform/deploy/wrenai/scripts/open-wren-firewall.sh
```

**手动 firewalld**（与脚本等价）：

```bash
SRC=10.20.0.10   # ai-platform 出口 IP
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule="rule family=\"ipv4\" source address=\"${SRC}\" port port=\"9100\" protocol=\"tcp\" accept"
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule="rule family=\"ipv4\" source address=\"${SRC}\" port port=\"9101\" protocol=\"tcp\" accept"
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule='rule family="ipv4" port port="9100" protocol="tcp" drop'
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule='rule family="ipv4" port port="9101" protocol="tcp" drop'
sudo firewall-cmd --reload
# wren 进程本地端口段 18080-18180 仅 127.0.0.1：无需 firewalld 对外开
```

---

## 3. ai-platform 侧配置

在 ai-platform 环境变量/配置中设置（读取自 `IqdMcpSettings`）：

| 变量 | 说明 |
|------|------|
| `WREN_AGENT_ENDPOINT` | wren 机控制面基址，如 `http://10.20.0.20:9100`。**非空即启用跨机器部署**（否则退回本地 Plan A）。 |
| `WREN_AGENT_TOKEN` | 与 wren 机 `WREN_AGENT_TOKEN` 一致（bearer 鉴权）。 |
| `WREN_AGENT_CONTROL_PORT` / `WREN_AGENT_MCP_PORT` | 端口（仅元数据，实际取 agent 回传的 endpoint）。 |
| `WREN_AGENT_WREN_PORT_RANGE` | 仅本地 Plan A 兜底用。 |
| `WREN_AGENT_PROJECTS_ROOT` | ai-platform 侧 project 根（远程模式 project 目录在 wren 机，此处仅元数据）。 |

> **路由判定**：`WrenMcpAgentClient.enabled == (WREN_AGENT_ENDPOINT 非空)`。
> - 启用：所有 `enable`/`start` 经 agent 远程拉起；orchestrator 按 connId 经数据面反向代理问数。
> - 未启用（测试/单机）：退回本地 Plan A 子进程模型（测试继续 pin 本地启动器，行为不变）。

---

## 4. 凭证注入（S1，不落盘）

流程已固化，运维无需手动物理操作：

1. admin 在连接表单填写凭证 → BFF → mis-iqd 仅存 `secret_ref`（**不存明文**）。
2. admin 点击「启用/创建项目」→ BFF `/iqd/mcp/enable` → ai-platform `ensure_connection`。
3. ai-platform `IqdConfigCredentialResolver` 经 mis-iqd 取 `secret_ref` →
   `CredentialVault.resolve_by_ref` 解析明文 → 映射 wren env（`WREN_PG_*` + `WREN_IQD_CREDENTIAL_JSON`）。
4. 明文 env **仅经控制面（bearer + 内网）一次性推送**到 wren 机（**不写库/不写前端/不写日志**）。
5. wren 机 agent `_build_env`：凭据写入临时文件（`chmod 600`）即用即删，注入 wren 子进程 env。
   **wren 机不接 Vault**（决策 ③）。

> 巡检铁律：任何时刻在 wren 机磁盘上 `grep -R "WREN_PG_PASSWORD"` 于 project 目录应无命中
> （仅内存 env + 已删除的临时文件）。

---

## 5. 启停 / 重启 / 重建注册表

### 5.1 业务启停（经平台）

| 动作 | BFF | ai-platform | wren agent |
|------|-----|-------------|------------|
| 启用/创建项目 | `POST /iqd/mcp/enable` | `ensure` | `ensure(running)` |
| 启动 | `POST /iqd/mcp/start` | `start_connection` | （远程走 ensure） |
| 停止 | `POST /iqd/mcp/stop` | `stop` | `ensure(stopped)` / `stop` |
| 重启 | `POST /iqd/mcp/restart` | `restart` | `restart`（复用端口 + 重注凭证） |

### 5.2 wren 机进程/agent 维护

```bash
# 重启 agent（systemd 自动拉起所有连接进程，因 agent 内存保留 desired_state）
sudo systemctl restart wren-mcp-agent

# 重建 single-connection 部署（重新拉起 wren 进程 + 重注凭证）
curl -X POST http://127.0.0.1:9100/internal/v1/wren-mcp/restart \
  -H "Authorization: Bearer $WREN_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conn_id":"1","credential":{}}'   # credential 由 ai-platform 侧重新推送更佳

# 重建整个注册表（agent 进程丢失/迁移后）
# 在 ai-platform 侧触发 bulk ensure：重启 ai-platform Worker 的 IQD MCP supervisor，
# 或逐连接调用 BFF /iqd/mcp/enable。ai-platform 会重新 ensure 并回写 mis-iqd 注册表。
```

> **重建注册表标准动作**：wren 机 agent 重启后内存注册表清空 → 由 ai-platform 侧
> `IqdMcpLifecycleService.ensure_connection` / `bootstrap.bulk_start_enabled_iqd_mcp`
> 重新 `ensure` 全部启用连接，回写 `iqd_connection.mcp_host/agent_handle/mcp_status`。
> 无需人工登机重建。

### 5.3 状态核对

```bash
# agent 整体健康
curl http://127.0.0.1:9100/internal/v1/wren-mcp/health \
  -H "Authorization: Bearer $WREN_AGENT_TOKEN"

# 单连接状态
curl "http://127.0.0.1:9100/internal/v1/wren-mcp/status?conn_id=1" \
  -H "Authorization: Bearer $WREN_AGENT_TOKEN"

# ai-platform 侧跨机器注册表（Worker 内存）
curl "http://ai-platform/internal/v1/iqd/mcp/status?connection_id=1" \
  -H "Authorization: Bearer <mis-jwt>"

# mis-iqd 持久化（前端轮询来源）
SELECT id, mcp_status, mcp_port, mcp_host, agent_handle FROM iqd_connection;
```

---

## 6. 自服务排障（Troubleshooting）

| 现象 | 可能原因 | 处置 |
|------|----------|------|
| `ensure` 返回 401/403 | `WREN_AGENT_TOKEN` 两端不一致 / 内网 IP 未放行 | 对齐 token；检查防火墙源 IP（决策 ⑤） |
| `ensure` 超时 / 不可达 | wren 机 agent 未起 / 端口被防火墙 DROP | `systemctl status wren-mcp-agent`；`firewall-cmd --list-rich-rules` |
| `MDL 尚未构建` | `target/mdl.json` 缺失（未执行语义模型同步/自愈 build） | 先执行同步/自愈 force-rebuild，再 enable |
| 问数打到死端口 / 串台 | 远程部署未就绪却问数 | orchestrator 自动降级 mock（REQ-P0-1）；先 ensure 该连接 |
| `mcp_status=crashed` | wren 进程崩溃 | agent 自愈重启（决策 ①）；若持续，查 wren CLI / 凭证 env |
| `mcp_host` 为空 | 仍走本地 Plan A（未配 `WREN_AGENT_ENDPOINT`） | 配置 `WREN_AGENT_ENDPOINT` 后重新 enable |
| 凭证不生效 | secret_ref 未解析 / wren profile 占位名不匹配 | 查 ai-platform `CredentialVault`；确认 `WREN_PG_*` 占位与 profile 模板一致 |
| 端口段用尽 | 连接数 > `WREN_AGENT_MAX_CONNECTIONS`（>10，决策 ⑦） | 收敛连接数；调大端口段（决策 ⑦ 上限 10） |

### 6.1 日志

- wren 机：`journalctl -u wren-mcp-agent -f`
- ai-platform：`agent.mis_iqd.mcp_lifecycle` / `adapters.wren_mcp_agent_client` / `adapters.wren_mcp_registry`

### 6.2 回滚（SSH fallback，决策 ⑨）

若 agent 通道不可达，可临时将 ai-platform `WREN_AGENT_ENDPOINT` 置空 → 退回本地 Plan A
子进程模型（需 ai-platform 机本地有 wren CLI + 凭证 env 注入能力）。恢复后重新配置
`WREN_AGENT_ENDPOINT` 并逐连接 `enable`。

---

## 7. 升级 / 迁移 wren 机

1. 新 wren 机按 §2 安装并 `enable` agent；防火墙先放行 ai-platform 源 IP。
2. ai-platform 改 `WREN_AGENT_ENDPOINT` 指向新机 → 逐连接 `enable`（重新 ensure，回写新 `mcp_host`）。
3. 旧机停 agent：`sudo systemctl stop wren-mcp-agent`，回收防火墙规则。
4. 因 `mcp_host/agent_handle` 持久化在 mis-iqd，前端/可观测自动指向新机，无需手工改 DB。
