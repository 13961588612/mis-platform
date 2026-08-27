# WrenAI 运营 runbook（mis-iqd 集成）

> 文档角色：mis-iqd × WrenAI 真机联调与日常运维手册，把手动 CLI 步骤固化成可照做流程。
> 状态：🔶 运营 runbook（**v0.2 设计终态**：跨机器方案 A 已锁定，ai-platform 管控面 ↔ wren 机数据面分离）｜W0 真机验证项见 `wrenai-w0-verify-checklist.md`｜日期：2026-08-28｜语言：中文
> 关联：`deploy-iqd.md`（规划速查）、`architecture.md §2 D6 / §4.4`、`TASK-20260826-001`（版本钉位歧义）、`mis-iqd-selfheal-prd.md`（任务2 三按钮）、`mis-iqd-mcp-multiconn-design.md`（方案 A 多连接架构）、`mis-iqd-mcp-multiconn-prd.md`（增量 PRD）、**`mis-iqd-mcp-deploy-incremental.md`（v0.2 跨机器设计，10 项决策已锁定）**、`wren-mcp-agent-deploy.md`（wren 机 agent 专属部署）、**`wrenai-w0-verify-checklist.md`（W0 真机验证清单）**。
> 安全基线（v0.2 跨机器）：**ai-platform（管控面/查询客户端）与 wren 机（数据面 `WrenMcpAgent` + `wren serve mcp` 进程）不同机器**。`wren serve mcp` 在 **wren 机**绑 `127.0.0.1`（官方 keep-local，无鉴权、不对外暴露）；跨机访问统一经 wren 机 `WrenMcpAgent` ingress（控制面 `:9100` / 数据面 `:9101`，均 **bearer-token 鉴权 + 内网网络隔离，已免 mTLS**），防火墙仅放行 ai-platform 源 IP。凭证 server-side 不落盘（D6/S1）。**前端/用户端绝不直连 MCP/agent。**

## 0. 角色与边界速览

| 能力 | 平台已自动化（代码控制，免 CLI） | 仍须运维人工（CLI / 本机） |
|---|---|---|
| MDL 构建/部署 | `context build`（`service.py` trigger_build_index / trigger_model_build） | 首次 bootstrap `context build`、`--force` 重建、`context validate` |
| 记忆索引 | `memory index`（同上编排） | `memory reset` + `memory index` 重新索引 |
| 漂移检测 | `get mdl` 哈希比对（`iqd_cli.get_current_mdl_hash`） | — |
| 问数执行 | MCP：`dry_plan` / `dry_run` / `run_sql` / `get_context`（`orchestrator.py` + `iqd_mcp_client.py`） | — |
| 安装/升级 | — | `pip install wrenai` |
| MCP 进程（多连接，跨机器 v0.2） | `WrenMcpProcessManager` **已改远程管控客户端**，经 `WrenMcpAgentClient` 调 wren 机常驻 `WrenMcpAgent` 按连接拉起/停止/崩溃重启/端口分配（方案 A 跨机器版，端口段 `18080-18180` 位于 wren 机本机） | W0 单库手动验证/SSH 兜底：`wren serve mcp`（详见 §2.1/§2.2） |
| LLM/embedding | — | WrenAI 自身配置面 |
| 业务库接入 | — | `profile add` + `context set-profile`（真实凭证，D6） |

## 1. 前置：安装 / 升级 wrenai

> ⚠️ **Python 版本硬前置（必读，否则 `pip install` 必报 `from versions: none`）**：`wrenai` 全部版本要求 **`requires_python >=3.11`**（含钉位版 `0.13.3`）。Python < 3.11 时 pip 会报 `ERROR: No matching distribution found for wrenai[mcp] (from versions: none)`——这是 Python 太旧，不是命令错。须先装 3.11+ 再建 venv。
> 📌 **extras 说明（已核对 PyPI 0.13.3）**：wrenai 提供 18 个 extra，含 `mcp`/`postgres`/`mysql`/`clickhouse`/`oracle`/`mssql`/`bigquery`/`snowflake`/`memory` 等。`main` extra 也存在，但它是核心 CLI 本身，`pip install wrenai` 默认已带，**无需单独装**。本期须显式指定的只有 `mcp`（MCP server）+ 业务库驱动（本期为 `postgres`/`mysql`/`clickhouse`/`oracle`）。

### 有序安装步骤（在 wrenaitest 上依次执行）

**Step 0 — 确认当前 Python（< 3.11 即根因，必须升级）**
```bash
python3 --version
```

**Step 1 — 安装 Python 3.11+（按系统选一条；`python3.11` 命令不存在就得先装）**
```bash
# RHEL / Rocky / Alma 9
sudo dnf install -y python3.11 python3.11-pip python3.11-devel
# Ubuntu 22.04（默认只有 3.10，走 deadsnakes）
sudo apt-get update && sudo apt-get install -y software-properties-common \
  && sudo add-apt-repository -y ppa:deadsnakes/ppa && sudo apt-get update \
  && sudo apt-get install -y python3.11 python3.11-venv python3.11-dev
# Ubuntu 24.04（自带 3.12）
sudo apt-get update && sudo apt-get install -y python3.12 python3.12-venv python3.12-dev
# 通用兜底（免系统包管理器）：uv
curl -LsSf https://astral.sh/uv/install.sh | sh && source "$HOME/.local/bin/env" && uv python install 3.11
```
> ≥3.11 即可，3.12 / 3.13 同样满足 `requires_python`；下文以 `3.11` 为例。

**Step 2 — 用新 Python 建虚拟环境（隔离，避免污染系统 Python）**
```bash
python3.11 -m venv ~/wren-venv
source ~/wren-venv/bin/activate
```

**Step 3 — 安装 / 升级 pip**
```bash
python -m pip install -U pip
```

**Step 4 — 安装 wrenai（钉位 0.13.3；extras = mcp + postgres + mysql + clickhouse + oracle）**
```bash
# 你提到的「3.13」即版本 0.13.3（最新稳定版，钉位见 TASK-20260826-001）
pip install 'wrenai[mcp,postgres,mysql,clickhouse,oracle]==0.13.3'
# 国内超时加清华镜像：
# pip install 'wrenai[mcp,postgres,mysql,clickhouse,oracle]==0.13.3' -i https://pypi.tuna.tsinghua.edu.cn/simple
```

> 📋 **数据源 extra 速查（已核对 PyPI 0.13.3，按业务库选用）**：`postgres` · `mysql` · `clickhouse` · `oracle` · `mssql` · `bigquery` · `snowflake` · `redshift` · `trino` · `athena` · `databricks` · `spark` · `duckdb`(默认内置)。多库用逗号叠加，如 `wrenai[mcp,postgres,mysql,clickhouse,oracle]`；一次性全装用 `wrenai[all]==0.13.3`（含 `mcp` 之外所有连接器，体积大）。**⚠️ 坑：`all` 不含 `mcp`**——全装时仍需显式带 `mcp`，即 `wrenai[all,mcp]==0.13.3`，否则 `wren serve mcp` 起不来。

**Step 5 — 验证**
```bash
wren --version    # 应输出版本号（确认钉位 0.13.3）
which wren        # 应在 ~/wren-venv/bin/wren
wren serve mcp --help
```

> ⚠️ **上线必看**：`wren` 装在 `~/wren-venv`，系统 PATH 默认没有。mis-iqd Worker 调 `wren` 时须让它能找到——Nacos `ai-platform.yaml` 设 `wren.cli-bin: /root/wren-venv/bin/wren`，或启动单元里先 `source ~/wren-venv/bin/activate`。否则 Worker 报 `wren: command not found`，问数链路起不来。

- **版本钉位歧义（必读 `TASK-20260826-001`）**：本仓库对接主路径为 **`wren: v0.13.3`**（PyPI `wrenai` CLI + `wren serve mcp`，MCP 新线）。GitHub 项目标签 **`0.29.2`** 属经典 launcher（`wren-ui` + `wren-ai-service` Docker 栈），与 MCP 新线**不兼容、勿混装/同钉**。升级只升 `wrenai` PyPI 包，不要引入 0.29.2 经典资产。
- 升级后：跑一遍本 runbook §2、§4 + §8 核对清单（工具面变化）。

## 2. 启动 MCP server

> ⚠️ **前置（必读，否则必报 `no wren project found`）**：`wren serve mcp` **必须在含 `wren_project.yml` 的 wren project 目录内运行**（或通过 `WREN_PROJECT_HOME` / `--project` 指向）。它不是"裸起一个全局服务"，而是一个**进程绑定单一 project（单一业务库）**。启动前必须完成下面的 bootstrap。
> 📌 **生产环境 vs W0 手动（v0.2 跨机器）**：生产由 **wren 机常驻 `WrenMcpAgent`**（受 ai-platform 经 `WrenMcpAgentClient` 远程 `ensure`）**按每个 IQD 连接自动拉起独立 `wren serve mcp` 进程**（project 目录 `{wren_projects_root}/{connId}` 位于 **wren 机持久卷**、端口从 `wren_mcp_port_range=18080-18180` 在 **wren 机本机**分配、崩溃自动重启）。`WrenMcpProcessManager` 在 v0.2 已改为**远程管控客户端**（不再本机 subprocess）。下面 §2.1/§2.2 仅用于 **W0 真机单库手动 / SSH Day-1 bootstrap 验证**，请勿当作生产部署步骤。

### 2.1 W0 手动 bootstrap（单库验证用；生产由平台按连接自动）

```bash
# 1) 建并进入项目目录（持久化，建议按业务库命名，勿用 /tmp）
mkdir -p ~/wren-projects/demo && cd ~/wren-projects/demo

# 2) 初始化项目骨架（生成 wren_project.yml + models/ + 目录结构）
wren context init

# 3) 编辑 wren_project.yml + models/（agent 驱动生成 MDL；demo 可先放最小 model 占位）
#    wren_project.yml 关键字段：schema_version / name / catalog / schema / data_source / profile

# 4) 校验结构（无需连库）
wren context validate

# 5) 编译出 target/mdl.json（MCP server 必读此文件）
wren context build

# 6) 添加连接凭证（交互式，或 --from-file dev.yml；凭证走 ${ENV} 不落盘）
wren profile add demo --interactive
#    # 非交互：wren profile add demo --from-file ./demo-profile.yml

# 7) 把 profile 绑定进本项目（写入 wren_project.yml 的 profile 字段）
wren context set-profile demo

# 8) 索引 schema + instructions 到 .wren/memory/（schema/instruction 检索需要）
wren memory index
```

### 2.2 W0 手动启动（单库验证；生产由进程管理器自动拉起）

```bash
# 方式 A：在 project 目录内直接起（推荐，cwd 自动发现 wren_project.yml）
cd ~/wren-projects/demo
wren serve mcp --transport http --host 127.0.0.1 --port 8080

# 方式 B：不在 project 目录时，用 WREN_PROJECT_HOME 或 --project 指定
WREN_PROJECT_HOME=~/wren-projects/demo wren serve mcp --transport http --host 127.0.0.1 --port 8080
#   或：wren serve mcp --transport http --host 127.0.0.1 --port 8080 --project ~/wren-projects/demo

# 常用开关：
#   --no-connect    仅转译/模式工具，不触库（run_sql/dry_run/query_cube 禁用）——无 profile 也能起，适合先验证 MCP 能起
#   --allow-write   才开放 store_query 等写工具（本期默认不开）
```

> 🔴 **安全硬约束（官方明确，v0.2 跨机器）**：`wren serve mcp --transport http` **在 wren 机默认绑 `127.0.0.1` 且不含 bearer-token 鉴权**——必须 `keep it local`，**禁止 `--host 0.0.0.0` 暴露到公网/其它网卡**；wren 进程**仅 wren 机本机可达**，外部不可直连。跨机器问数**不**走 wren 裸端口，而是统一经 wren 机 `WrenMcpAgent` ingress（数据面 `:9101` `/mcp/{conn_id}`，**bearer-token 鉴权**）反向代理到本地 `127.0.0.1:{local_port}`。

- **端口/守护（W0 手动 / SSH 兜底）**：手动起时用固定端口（如 8080）即可，仅 wren 机本机可访问。生产由 wren 机 agent 自动从 `wren_mcp_port_range`（18080-18180）分配，无需手工指定。
- **安全（跨机鉴权）**：wren 进程本身无鉴权且绑 127.0.0.1（官方 keep-local）；**跨机访问由 `WrenMcpAgent` 提供 bearer-token 鉴权 ingress + 内网网络隔离（已免 mTLS）**，防火墙仅放行 ai-platform 源 IP。mis-iqd Worker 在 **ai-platform 机器**，经 agent 数据面跨机持有 MCP client，**绝不**直连 wren 裸端口（见 `architecture.md §2 D4` / `mis-iqd-mcp-deploy-incremental.md §4`）。
- **平台侧配置键（Nacos `ai-platform.yaml`，不含凭证）**：
  - `wren.cli-bin`：wren 可执行绝对路径（如 `/root/wren-venv/bin/wren`，见 §1 上线必看）
  - `wren.mcp-port-range`：**`18080-18180`**（方案 A 每连接进程端口段，位于 **wren 机本机**自动分配/回收）
  - `wren.projects-root`：**`/var/lib/mis-iqd/wren-projects`**（每连接 `project_home = {root}/{connId}`，**位于 wren 机持久卷**）
  - `wren.mcp-host` / `wren.mcp-port`：单连接**本地 PlanA 回退**端口（未配 `WREN_AGENT_ENDPOINT` 时使用，默认 127.0.0.1:8080）
  - `wren.mcp-transport(http)` / `wren.mcp-allow-write(false)` / `wren.profile-name` / `wren.language(zh-CN)`
  - 📌 **跨机器生产键（v0.2）**：另需 `WREN_AGENT_ENDPOINT`（wren 机控制面基址，非空即启用跨机器）/ `WREN_AGENT_TOKEN` / `WREN_AGENT_WREN_PORT_RANGE` / `WREN_AGENT_PROJECTS_ROOT` 等，详见 §2.3.2 与 `wren-mcp-agent-deploy.md`。

### 2.3 ✅ 方案 A v0.2 终态：跨机器部署（ai-platform 管控面 ↔ wren 机数据面分离）

> ⚠️ **历史同机版已废弃**：早期方案 A v0.1 曾假设「**ai-platform 进程内 `subprocess` 拉起 wren + `127.0.0.1` 本机无 bearer 访问**」。该假设已被推翻——**ai-platform 与 wren 部署在不同机器**（用户已确认）。本 §2.3 以下描述均为 v0.2 跨机器终态。

#### 2.3.1 部署拓扑（一句话）

> **管理后台（自服务）** → BFF → **ai-platform（控制面 `WrenMcpProcessManager`/`WrenMcpAgentClient` + 查询客户端 `IqdMcpClient`）** ──（**bearer-token + 内网网络隔离，免 mTLS**）──▶ **wren 机常驻 `WrenMcpAgent`**（进程 supervisor + 鉴权 ingress）→ 本地 `127.0.0.1` 上的 N 个 `wren serve mcp`（每连接一个，N≤10）。

- 事实（未变）：`wren serve mcp` 一个进程 = 一个 wren project = 一个业务库连接（编译后 MDL + 单一活跃 profile，server 启动即绑定，运行期不切换）。HTTP 端点只服务单一 project。
- 查询面 `IqdMcpClient.for_connection(connId)` **按 `connId` 路由**到 wren 机 agent 数据面 ingress（`{wren_host}:9101/mcp/{conn_id}`，带 bearer-token）；远端优先，本地 PlanA 兜底，**双路不可达显式抛错（不静默降级 mock）**。

#### 2.3.2 WrenMcpAgent 部署（wren 机）

- **运行时（决策 ④）**：wren 机 = **Linux + systemd + 持久卷**。project 目录 `/var/lib/mis-iqd/wren-projects/{connId}/`（每连接）挂持久卷，跨重启可重建；`WrenMcpAgent` 以 systemd unit 托管、开机自启（`Restart=always`）。部署物：`agent/ai-platform/deploy/wrenai/wren-mcp-agent/`（详见 `wren-mcp-agent-deploy.md`）。
- **端口（决策 ①②，免 mTLS）**：
  - **控制面 `:9100`**——`WrenMcpAgentClient` 远程管控（`ensure/start/stop/restart/status/health`），**bearer 鉴权**。
  - **数据面反代 `:9101`**——`/mcp/{conn_id}` → `127.0.0.1:{local_port}`（按 connId 路由到本地 wren 进程），**bearer 鉴权**。
  - `public_host`/`WREN_AGENT_PUBLIC_HOST`：回执 endpoint 用**可达地址**（非 bind_host `0.0.0.0`）。
- **关键参数（Nacos `ai-platform.yaml` / wren 机 `.env`，不含凭证）**：
  - `WREN_AGENT_ENDPOINT`（ai-platform 侧）：wren 机控制面基址，如 `http://10.20.0.20:9100`，**非空即启用跨机器部署**，否则退回本地 PlanA。
  - `WREN_AGENT_TOKEN`：控制面/数据面共享 bearer token（内网隔离兜底，决策 ②）。
  - `WREN_AGENT_WREN_PORT_RANGE` = `18080-18180`（wren 机本机端口段，按连接分配/回收）。
  - `WREN_AGENT_PROJECTS_ROOT` = `/var/lib/mis-iqd/wren-projects`（wren 机路径）。
  - `WREN_AGENT_MAX_CONNECTIONS` = `10`（决策 ⑦，单 wren 机 ≤10 库）。
  - `wren.cli-bin` = wren 可执行绝对路径（如 `/root/wren-venv/bin/wren`，Nacos 设 `wren.cli-bin`）。

#### 2.3.3 鉴权与防火墙（决策 ②⑤⑥：bearer + 内网隔离，已免 mTLS）

- **鉴权**：agent ingress 校验 `Authorization: Bearer <token>`；`IqdMcpClient` 注入该 token。因走内网 + 源 IP 放行，**mTLS 证书层免去**（决策 ⑥）。
- **防火墙**：仅放行 **ai-platform 源 IP ↔ wren 机 9100/9101**；其余全拒。wren 机本机 `127.0.0.1` 端口段不对外开。
- 纵深防御 = 「bearer-token 应用鉴权 + 内网网络隔离」二者组合。

#### 2.3.4 凭证策略 S1（决策 ③，完整链路，不落盘）

```
管理后台填连接(含凭证) → BFF → mis-iqd 存 secretRef（API 恒回 ******，明文不入库/不发前端）
→ 用户点「启用 / 创建项目」 → BFF → ai-platform
→ WrenMcpAgentClient.ensure(connId) [管控通道, bearer+内网]
→ wren 机 agent: iqd_cli init project + profile add + build MDL + 启 wren serve mcp（每连接一进程）
→ ai-platform 解 secretRef → 经管控通道(bearer+内网)下发 agent → 注入 wren 进程 env（不落盘）
→ agent 回报 → mis-iqd 存 mcpHost / agentHandle / mcpStatus
```

- mis-iqd 仅存 `secret_ref`，**绝不存明文/token 明文**；`IqdConnectionVO` 的 `mcpHost`/`agentHandle` getter 已加 `@JsonIgnore`，**API 不暴露**这两列。
- 明文仅在 ai-platform 解 secretRef 时短暂内存存在，经 bearer+内网通道一次性下发给 agent；wren 机 agent 注入子进程 env（`WREN_PG_*` 等），**wren 机不接 Vault**、磁盘无明文；临时 profile 文件 `chmod 600` 用即删。

#### 2.3.5 自服务「启用 / 创建项目」端到端流（首要场景）

1. 管理后台填连接表单（含凭证）→ BFF → mis-iqd 存 `secretRef`（明文不入库/不发前端）。
2. 用户点「启用 / 创建项目」→ BFF → ai-platform `IqdMcpLifecycleService.ensure_connection`。
3. ai-platform `WrenMcpAgentClient.ensure(connId)` → wren 机 agent bootstrap（`iqd_cli` init project + profile add + build + 启 `wren serve mcp`）。
4. ai-platform 解 `secretRef` → 经管控通道下发 agent → 注入 wren 进程 env。
5. agent 回报 `agent_handle`/`mcp_endpoint`/`status` → ai-platform 写回 mis-iqd `iqd_connection.mcp_host`/`agent_handle`/`mcp_status`（**决策 ⑩，Flyway V85 加两列**）。
6. 问数：`orchestrator` → `IqdMcpClient.for_connection(connId)` → agent 数据面 `/mcp/{conn_id}` → wren 进程（编排器拦截链路零改动）。

#### 2.3.6 生命周期 / 就绪门禁 / 自愈

- **生命周期（agent 负责，决策 ①）**：Worker 启动经 agent 批量 `ensure` 启用连接 + 后台 reconcile/心跳；连接 `disabled`/`deleted` → agent `stop` → 回收端口 → **保留 project 目录 7 天** → 到期清理；崩溃由 agent reconcile 自动重启（systemd + agent 双层兜底）。
- **就绪门禁**：`target/mdl.json` 存在（即 `context build` 完成）才允许该连接 MCP 进程经 agent 拉起/重启。
- **运维入口（连接详情页）**：每连接「MCP 运行态」卡展示状态徽标 + 端口 + 最近健康时间，提供启停/重启按钮（带二次确认）；运维自愈三按钮（force-rebuild / re-index / validate）按 connId 触发（见 §6）。
- **SSH 兜底（决策 ⑨，Day-1 bootstrap）**：agent 通道不可达时，仍可在 wren 机经 SSH 手动 `iqd_cli init project + profile add + build + 启 wren serve mcp` 完成首拉起；agent 上线后接管为常驻管控端点，SSH 退居兜底（非生产推荐）。

#### 2.3.7 迁移 V85（决策 ⑩，须 mis-iqd 先起跑）

- `Flyway V85__iqd_mcp_host_handle.sql`：`iqd_connection` 表加 `mcp_host` / `agent_handle` 两列（NULL→'' 默认）。
- `IqdConnection` 实体加 `mcpHost`/`agentHandle`；`IqdAdminService.reportMcpDeployment` + `IqdConnectionRepository.setMcpDeployment` + `IqdInternalController.POST /internal/v1/iqd/mcp-deploy` 回写。
- ⚠️ **顺序约束**：**mis-iqd 必须先起跑执行 V85** 再加连接/启用，否则 `mcp_host`/`agent_handle` 列不存在导致回写失败。

- **W0 实测建议**：先用**单 project（一个 demo 库）**手动点亮（§2.1/§2.2，或经 SSH 兜底）验证问数链路闭环；多连接进程管理由 agent 自动，无需手工起多进程。W0 真机逐项核查见 **`wrenai-w0-verify-checklist.md`**（§8 已指向）。

## 3. LLM / embedding 配置

- **归属**：WrenAI 自身配置面（如环境变量/配置文件），**平台不接管**（不在 `mis-iqd`、不在 Nacos、不落前端）。
- **必填项（待真机核实具体位置）**：LLM provider / model / endpoint / api-key；embedding model / endpoint。`api-key` 属凭证，受 D6 约束不进平台/前端。
- 配置位置与字段名待 W0 实测确认（见 §8 清单），不要凭记忆写。

## 4. 新增业务库 bootstrap（须人工，含真实凭证）

> 📌 **方案 A v0.2 下 project 目录位于 wren 机、由 agent 管理**：每连接 `project_home = {wren_projects_root}/{connId}`（即 **wren 机** `/var/lib/mis-iqd/wren-projects/{connId}`，挂持久卷），不再用 `~/wren-projects/demo`。连接「启用/创建项目」后，ai-platform 经 agent `ensure` 在 wren 机 bootstrap（`iqd_cli` init + `wren profile add` + `context build`）→ `context build` 完成即由 agent 拉起独立 MCP 进程（就绪门禁：build 未就绪不拉起）。

> D6 铁律（S1 强化）：`iqd_connection` 仅存 `secret_ref` + `mcp_host`/`agent_handle`/`mcp_status`，**不存任何 WrenAI/业务库明文凭证**；凭证由 ai-platform 解 `secret_ref` 后经管控通道下发 wren 机 agent，注入 wren 进程 env（server-side，明文不落盘）。自服务「启用/创建项目」已可平台代敲 bootstrap；**仅当 agent 通道不可达时**才走 SSH 人工 bootstrap（决策 ⑨）。

```bash
# ① 注册业务数据源连接（带真实凭证，host/port/user/password/database/connector）
wren profile add <name> --connector <type> ...   # 字段以 wren profile add --help 为准
# ② 设定当前语义上下文所用 profile
wren context set-profile <name>
# ③ 首次 MDL 构建/部署
wren context build
```

- **代码现状（v0.2）**：`iqd_cli.py` 的 `profile_add` 与 `context_set_profile` 现已由 wren 机 `WrenMcpAgent` 在 bootstrap 阶段经 agent 远程调用执行（自服务 `ensure` 触发），不再要求运维本地置备；`context build` / `memory index` 由平台自动（§5）。仅 agent 通道不可达时回落 SSH 人工 bootstrap（决策 ⑨）。
- UI 回显固定 `******`，绝不显示真实凭证。

## 5. 日常自动同步说明（平台已自动化）

平台在物料变更/模型写回时自动编排，运维通常**无需**手工 `context build`：

- **一期物料同步**：`service.py::trigger_build_index`（materials 范围）→ 拉待下发物料 → `context_build`（带 sql-pairs/instructions）→ `memory_index` → 回填 `wren_ref_id`（mdl_hash）→ `report_sync_job`。
  - 代码：`agent/ai-platform/backend/src/agent/mis_iqd/service.py` L294
- **二期模型写回**：`service.py::trigger_model_build`（model 范围）→ 以 `mdl_raw`+`edited_items` 派生完整 MDL → `context_build(mdl_dir=tmp)` → `memory_index` → `report_sync_job`（edit_source=model）。
  - 代码：`service.py` L466
- **漂移检测**：`iqd_cli.get_current_mdl_hash`（包裹 `wren get mdl`）解析 mdl_hash，不可达/解析失败降级为不判定（不误伤）。代码：`iqd_cli.py` L130。
- **问数执行**：`orchestrator.py` + `iqd_mcp_client.py`（MCP 只读：`dry_plan` / `dry_run` / `run_sql` / `get_context`）。**v0.2 下 `IqdMcpClient.for_connection(connId)` 按 `connection_id` 取到 wren 机 agent 数据面 ingress（`{wren_host}:9101/mcp/{conn_id}`，带 bearer-token）**（每连接独立 MCP 进程，多连接隔离）；远端优先 + 本地 PlanA 兜底，**双路不可达显式抛错（不静默降级 mock）**；MCP 进程在 `context build` 完成后才由 wren 机 agent 拉起/重启（就绪门禁）。
- 失败容错：memory index 失败不阻断 build 回填，仅单独标 `index_status=failed`（Q6）。

## 6. 运维自愈三动作（按钮 / CLI 兜底）

> 任务2「三按钮」现已改为 **per-connection（连接详情页内按 connId 触发）**：上线后优先点按钮；上线前或按钮不可用时走 CLI 兜底。**命令参数（`--force` / `memory reset` / `context validate`）以 W0 实测为准，标注「待真机核实」**。

| 动作 | 按钮（任务2 上线后） | CLI 兜底（人工） |
|---|---|---|
| **强制重建** | 「运维自愈」→ 强制重建 → 二次确认 → `force-rebuild` 端点 → 复用 sync-job 状态 + 5000ms 轮询 | `wren context build --force`（`--force` 待真机核实） |
| **重新索引** | 「运维自愈」→ 重新索引 → `re-index` 端点（memory_reset + context_build / memory_index） | `wren memory reset` 后 `wren memory index`（`memory reset` 待真机核实） |
| **模型校验** | 「运维自愈」→ 模型校验 → `validate` 端点 | `wren context validate`（待真机核实） |

- 按钮形态详见 `mis-iqd-selfheal-prd.md`（状态区复用 `CatalogSyncStatusBar`）。
- 强制重建用于 MDL 漂移（STALE_DRIFT）后收敛；重新索引用于知识/记忆变更后生效；模型校验用于上线前预检。

## 7. 故障恢复

- **MDL 漂移 / 问数异常**：先 `wren get mdl` 比对 mdl_hash，再 `wren context build --force` 强制重建收敛（或走按钮）。仍 failed 查下方日志要点。
- **记忆陈旧/损坏**：`wren memory reset` 后 `wren memory index` 重新索引。
- **上线前预检**：`wren context validate` 暴露 MDL 结构错误，修正后重试（按钮侧 REQ-8 给人可读摘要）。
- **日志排查要点**：
  - Worker 日志关键词：`wren CLI call` / `wren CLI failed`（含 exit_code、stderr 前 500 字）；`IqdCliError` 记 `build_error` / `index_error`。
  - sync-job 状态表：`build_status` / `index_status` / `build_error` / `index_error` / `build_mdl_hash`。
  - MCP 双路不可达（远端 agent 数据面 + 本地 PlanA 兜底均失败）：`IqdMcpClient.for_connection` **显式抛错**（不静默降级 mock）；须先 `ensure`/启用该连接再问数（见 §2.3.5）。
  - 单连接 MCP 进程崩溃：wren 机 agent reconcile **自动重启**（systemd 双层兜底）；也可在连接详情页点「重启」手动触发（Bug B 已修复：RUNNING 但进程已死会真正重拉，不再空操作）。
  - 凭证问题：检查 agent 经管控通道下发的 env 注入（S1）；mis-iqd 仅存 `secret_ref`，平台侧 `iqd_connection` 无明文（见 §2.3.4）。
  - 版本钉位不匹配：见 `TASK-20260826-001`，勿混装 0.29.2。

## 8. W0 真机核实清单（联调逐项勾）

> 📌 **W0 真机逐项执行表（含目的 / 前置条件 / 执行步骤 / 预期结果 / 通过标准 / 失败排查）见 `wrenai-w0-verify-checklist.md`**，本 §8 保留为速查摘要，二者配套使用。

来自 `deploy-iqd.md §5` + 本 runbook 新增项（v0.2 跨机器）：

- [ ] `wren --version` 实测版本号，钉入 `agent/ai-platform/deploy/wrenai/README.md`
- [ ] 确认 `wren: v0.13.3` 与 GitHub `0.29.2` 不兼容，文档钉位已改正、勿混装（TASK-20260826-001）
- [ ] `wren serve mcp --transport http` 实际暴露工具清单（尤其 `get_context` / `recall_queries` / `list_knowledge` 是否原生引用）
- [ ] `wren context build` 跑通 MDL 构建；wren-ui 是否随包发布
- [ ] 单 project 多 connector 跨源 join 能力（决定一期是否多库可问）
- [ ] `wren context build --force` 参数与行为实测（强制重建按钮依赖）
- [ ] `wren memory reset` 子命令存在性与行为实测（重新索引按钮依赖）
- [ ] `wren context validate` 子命令存在性与输出实测（模型校验按钮依赖）
- [ ] LLM / embedding 配置具体位置与必填项确认（§3）
- [ ] 三动作经平台端点 **per-connection**（任务2 上线后，连接详情页内按 connId 触发）跑通 + sync-job 状态机收敛
- [ ] **[W0 清单项 1]** 自服务「启用 → agent 远程 bootstrap」端到端：管理后台填连接→点启用→wren 机 agent 拉起 `wren serve mcp` 进程并回报 `mcp_status=running`
- [ ] **[W0 清单项 2]** 凭证链 S1 跨机器端到端：mis-iqd 仅存 `secret_ref`（API 恒回 `******`）→ ai-platform 解 ref → 经管控通道(bearer+内网)下发 wren 机 agent → 注入 wren 进程 env（不落盘，wren 机不接 Vault）；`IqdConnectionVO.mcpHost/agentHandle` 加 `@JsonIgnore` 前端不暴露
- [ ] **[W0 清单项 3]** 问数路由：`IqdMcpClient.for_connection(connId)` 按 `connection_id` 取到 wren 机 agent 数据面 ingress（`{wren_host}:9101/mcp/{conn_id}`，bearer），多连接无串台
- [ ] **[W0 清单项 4]** 多连接 MCP 进程（**wren 机 agent 管理**）：每连接独立 `wren serve mcp` 进程 + 端口从 wren 机本机 `18080-18180` 自动分配/回收；崩溃由 agent reconcile 自动重启；端口段耗尽显式报错；连接 `disabled` 时 agent `stop` + 回收端口 + project 目录保留 7 天
- [ ] **[W0 清单项 5]** 进程崩溃自动重启 + 详情页「重启」按钮：kill wren 进程后 agent reconcile 自动拉起；前端按钮能手动重启
- [ ] **[W0 清单项 6]** SSH 兜底 bootstrap：agent 不可达时仍能经 SSH 在 wren 机手动 bootstrap project
- [ ] **[W0 清单项 7]** 防火墙仅放行 ai-platform 源 IP：从非 ai-platform 机器访问 wren 机 9100/9101 应被拒
- [ ] **[W0 清单项 8]** 多连接进程生命周期隔离：新增/删除连接不影响其它连接进程
- [ ] **[W0 清单项 9]** V85 迁移 + 数据回流：mis-iqd 先起跑执行 V85；启用后 `mcp_host`/`agent_handle` 正确落 `iqd_connection` 表且 API 不暴露（VO 返回无此二字段）
