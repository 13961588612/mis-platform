# WrenAI 运营 runbook（mis-iqd 集成）

> 文档角色：mis-iqd × WrenAI 真机联调与日常运维手册，把手动 CLI 步骤固化成可照做流程。
> 状态：🔶 草案（W0 实测前部分项标注「待真机核实」）｜日期：2026-08-28｜语言：中文
> 关联：`deploy-iqd.md`（规划速查）、`architecture.md §2 D6 / §4.4`、`TASK-20260826-001`（版本钉位歧义）、`mis-iqd-selfheal-prd.md`（任务2 三按钮）。
> 安全基线：MCP 仅绑 127.0.0.1、本版无 bearer-token、默认只读、凭证 server-side（D6）。前端/用户端绝不直连 MCP。

## 0. 角色与边界速览

| 能力 | 平台已自动化（代码控制，免 CLI） | 仍须运维人工（CLI / 本机） |
|---|---|---|
| MDL 构建/部署 | `context build`（`service.py` trigger_build_index / trigger_model_build） | 首次 bootstrap `context build`、`--force` 重建、`context validate` |
| 记忆索引 | `memory index`（同上编排） | `memory reset` + `memory index` 重新索引 |
| 漂移检测 | `get mdl` 哈希比对（`iqd_cli.get_current_mdl_hash`） | — |
| 问数执行 | MCP：`dry_plan` / `dry_run` / `run_sql` / `get_context`（`orchestrator.py` + `iqd_mcp_client.py`） | — |
| 安装/升级 | — | `pip install wrenai` |
| MCP 进程 | — | `wren serve mcp` 启动/守护 |
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

### 2.1 首次 bootstrap（每个业务库/project 一次）

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

### 2.2 启动 MCP server

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

> 🔴 **安全硬约束（官方明确）**：本版 `wren serve mcp --transport http` **默认绑 127.0.0.1 且不含 bearer-token 鉴权**——必须 `keep it local`，**禁止 `--host 0.0.0.0` 暴露到公网/其它网卡**。mis-iqd Worker 本就经 `127.0.0.1:8080` 本机持有 MCP client，无需 0.0.0.0。

- **端口/守护**：须与 `mis-admin-bff` 的 Nacos `ai-platform.yaml` 中 `wren.mcp-host=127.0.0.1` / `wren.mcp-port=8080` 一致。守护建议 `systemd` / `supervisor` / `nohup`，确保与 mis-iqd Worker 同机/同网络常驻。
- **安全**：默认 127.0.0.1 不可对终端用户开放；本版无 bearer-token，必须由 mis-iqd Worker 服务端本机持有 MCP client（见 `architecture.md §2 D4`）。
- 平台侧配置键（Nacos `ai-platform.yaml`，**不含凭证**）：`wren.mcp-host` / `wren.mcp-port` / `wren.mcp-transport(http)` / `wren.mcp-allow-write(false)` / `wren.cli-bin(wren)` / `wren.profile-name` / `wren.language(zh-CN)`。

### 2.3 ⚠️ 单 project 进程约束 & mis-iqd 多连接架构 gap（关键发现，待架构复核）

- **事实**：`wren serve mcp` 一个进程 = 一个 wren project = **一个业务库连接**（编译后的 MDL + 单一活跃 profile，server 启动时即绑定，运行期不切换）。HTTP 端点只服务这单一 project。
- **冲突**：当前 `mis-iqd` 设计为**多 IQD 连接（多业务库）共用单一 MCP 端点**（`iqd_mcp_client.py` 连 Nacos `wren.mcp-host:mcp-port` 单端口，调 dry_plan/dry_run/run_sql/get_context）。单一 MCP 进程无法同时服务多库——**多连接集成方案存在 gap**。
- **候选解法（待架构师高见远评估，不在此拍板）**：
  - **A. 每连接一个 MCP server 进程**（独立端口），Worker 按连接号路由到对应端点（需扩展 `iqd_mcp_client` 支持按连接选端点 + 守护多进程）。
  - **B. 问数改走 CLI**：Worker 在每个连接的 project 目录执行 `wren dry-run` / `wren run-sql`（与管理面 `iqd_cli` 一致），去掉持久 MCP server 依赖。
  - **C. 单 project 多 profile 切换**：MCP server 启动即绑定 profile，运行期切换不可行——**排除**。
- **W0 实测建议**：先用**单 project（一个 demo 业务库）**点亮 MCP server，验证问数链路闭环；多连接集成方案正式走架构复核后再调整 `mis-iqd` 集成设计。

## 3. LLM / embedding 配置

- **归属**：WrenAI 自身配置面（如环境变量/配置文件），**平台不接管**（不在 `mis-iqd`、不在 Nacos、不落前端）。
- **必填项（待真机核实具体位置）**：LLM provider / model / endpoint / api-key；embedding model / endpoint。`api-key` 属凭证，受 D6 约束不进平台/前端。
- 配置位置与字段名待 W0 实测确认（见 §8 清单），不要凭记忆写。

## 4. 新增业务库 bootstrap（须人工，含真实凭证）

> D6 铁律：`iqd_connection` 仅存 **profile 名/连接标识** + MCP 地址，**不存任何 WrenAI/业务库凭证**；凭证由 `wren profile` 注入 WrenAI 主机（server-side）。故 bootstrap 必须人工执行，平台无法代敲。

```bash
# ① 注册业务数据源连接（带真实凭证，host/port/user/password/database/connector）
wren profile add <name> --connector <type> ...   # 字段以 wren profile add --help 为准
# ② 设定当前语义上下文所用 profile
wren context set-profile <name>
# ③ 首次 MDL 构建/部署
wren context build
```

- **代码现状**：`iqd_cli.py` 的 `profile_add`(L51) 与 `context_set_profile`(L69) **已定义但全仓零调用**——这正是 bootstrap 两步，目前未接进任何编排（D6 决定保持人工）。日后的 `context build` / `memory index` 由平台自动（§5）。
- UI 回显固定 `******`，绝不显示真实凭证。

## 5. 日常自动同步说明（平台已自动化）

平台在物料变更/模型写回时自动编排，运维通常**无需**手工 `context build`：

- **一期物料同步**：`service.py::trigger_build_index`（materials 范围）→ 拉待下发物料 → `context_build`（带 sql-pairs/instructions）→ `memory_index` → 回填 `wren_ref_id`（mdl_hash）→ `report_sync_job`。
  - 代码：`agent/ai-platform/backend/src/agent/mis_iqd/service.py` L294
- **二期模型写回**：`service.py::trigger_model_build`（model 范围）→ 以 `mdl_raw`+`edited_items` 派生完整 MDL → `context_build(mdl_dir=tmp)` → `memory_index` → `report_sync_job`（edit_source=model）。
  - 代码：`service.py` L466
- **漂移检测**：`iqd_cli.get_current_mdl_hash`（包裹 `wren get mdl`）解析 mdl_hash，不可达/解析失败降级为不判定（不误伤）。代码：`iqd_cli.py` L130。
- **问数执行**：`orchestrator.py` + `iqd_mcp_client.py`（MCP 只读：`dry_plan` / `dry_run` / `run_sql` / `get_context`）。
- 失败容错：memory index 失败不阻断 build 回填，仅单独标 `index_status=failed`（Q6）。

## 6. 运维自愈三动作（按钮 / CLI 兜底）

> 任务2「三按钮」上线后优先点按钮；上线前或按钮不可用时走 CLI 兜底。**命令参数（`--force` / `memory reset` / `context validate`）以 W0 实测为准，标注「待真机核实」**。

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
  - MCP 不可达：orchestrator 降级 mock（`health` 返回 mock），问数链路降级而非裸崩。
  - 凭证问题：检查 `wren profile` 注入（D6），平台侧 `iqd_connection` 只有 profile 名。
  - 版本钉位不匹配：见 `TASK-20260826-001`，勿混装 0.29.2。

## 8. W0 真机核实清单（联调逐项勾）

来自 `deploy-iqd.md §5` + 本 runbook 新增项：

- [ ] `wren --version` 实测版本号，钉入 `agent/ai-platform/deploy/wrenai/README.md`
- [ ] 确认 `wren: v0.13.3` 与 GitHub `0.29.2` 不兼容，文档钉位已改正、勿混装（TASK-20260826-001）
- [ ] `wren serve mcp --transport http` 实际暴露工具清单（尤其 `get_context` / `recall_queries` / `list_knowledge` 是否原生引用）
- [ ] `wren context build` 跑通 MDL 构建；wren-ui 是否随包发布
- [ ] 单 project 多 connector 跨源 join 能力（决定一期是否多库可问）
- [ ] `wren context build --force` 参数与行为实测（强制重建按钮依赖）
- [ ] `wren memory reset` 子命令存在性与行为实测（重新索引按钮依赖）
- [ ] `wren context validate` 子命令存在性与输出实测（模型校验按钮依赖）
- [ ] LLM / embedding 配置具体位置与必填项确认（§3）
- [ ] 三动作经平台端点（任务2 上线后）跑通 + sync-job 状态机收敛
