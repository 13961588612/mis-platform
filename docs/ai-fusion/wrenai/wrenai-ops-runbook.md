# WrenAI 运营 runbook（mis-iqd 集成）

> 文档角色：mis-iqd × WrenAI 真机联调与日常运维手册。
> 状态：🔶 v0.3（三阶段结构）｜日期：2026-08-28｜语言：中文
> 关联：`deploy-iqd.md`、`wren-mcp-agent-deploy.md`、`wrenai-w0-verify-checklist.md`、`mis-iqd-mcp-deploy-incremental.md`、`TASK-20260826-001`（版本钉位）

---

## 阅读导航

| 阶段 | 何时做 | 章节 |
|------|--------|------|
| **一、软件安装与服务器配置** | 新机/新环境 Day-1 | [§1](#第一部分软件安装与服务器配置wren-机) |
| **二、手工验证（W0 / W1）** | 安装完成后、上平台前 | [§2](#第二部分手工验证w0--w1) |
| **三、跨机器部署与联调** | W0 单机通过后 | [§3](#第三部分跨机器部署与联调) |

**安全基线（v0.2 跨机器）**：ai-platform（管控面）与 wren 机（数据面）**不同机器**。`wren serve mcp` 绑 `127.0.0.1`（无鉴权）；跨机只走 `WrenMcpAgent`（9100/9101 + bearer + 源 IP 白名单）。前端/用户绝不直连 MCP。

---

## 0. 角色与边界速览

| 能力 | 平台已自动化 | 仍须运维人工 |
|---|---|---|
| MDL 构建/部署 | `context build`（Worker 编排） | 首次 bootstrap、`--force` 重建 |
| 记忆索引 | `memory index` | `memory reset` + 重新索引 |
| 问数执行 | MCP：`dry_plan` / `dry_run` / `run_sql` | — |
| MCP 多连接 | `WrenMcpAgentClient` 远程管控 | W0 单库手动验证；SSH 兜底 |
| 安装/升级 | — | `pip install wrenai`、firewalld |
| LLM/embedding | — | WrenAI 自身配置面（§1.4） |

---

# 第一部分：软件安装与服务器配置（wren 机）

> **目标**：wren 机具备 Python 3.11+、wren CLI 0.13.3、firewalld 基线。本节**不涉及** WrenMcpAgent 与平台联调（见第三部分）。

## 1.1 Python 3.11+

> ⚠️ `wrenai` 要求 **`requires_python >=3.11`**。Python &lt; 3.11 时 pip 报 `from versions: none`。

```bash
python3 --version

# RHEL / Rocky / Alma 9
sudo dnf install -y python3.11 python3.11-pip python3.11-devel

# Ubuntu 22.04
sudo apt-get update && sudo apt-get install -y software-properties-common \
  && sudo add-apt-repository -y ppa:deadsnakes/ppa && sudo apt-get update \
  && sudo apt-get install -y python3.11 python3.11-venv python3.11-dev

# 建虚拟环境
python3.11 -m venv ~/wren-venv
source ~/wren-venv/bin/activate
python -m pip install -U pip
```

## 1.2 安装 wrenai CLI

```bash
pip install 'wrenai[mcp,postgres,mysql,clickhouse,oracle]==0.13.3'
# 国内镜像：-i https://pypi.tuna.tsinghua.edu.cn/simple

wren --version          # 应 ≈ 0.13.3
which wren              # 如 ~/wren-venv/bin/wren
wren serve mcp --help
```

**版本钉位（`TASK-20260826-001`）**：
- 对接主路径：**PyPI `wrenai` 0.13.3** + `wren serve mcp`（MCP 新线）
- GitHub **`0.29.2`** = 经典 Docker 栈（`wren-ui` + `wren-ai-service`），**不兼容、勿混装**

**数据源 extra**：按业务库选用 `postgres` / `mysql` / `clickhouse` / `oracle` 等；`wrenai[all,mcp]` 可一次装连接器（`all` 不含 `mcp`）。

## 1.3 firewalld（wren 机）

> wren 机标准：**RHEL / Rocky / Alma**，使用 **firewalld**。跨机器阶段才需开 9100/9101；**W0 单机阶段可跳过**，第三部分联调前再开。

**首次安装**：

```bash
sudo dnf install -y firewalld
sudo systemctl enable --now firewalld
sudo firewall-cmd --state    # running
```

**联调前放行**（仅 ai-platform 源 IP → 9100/9101，18080–18180 **禁止对外开**）：

```bash
export AI_PLATFORM_SOURCE_IP=10.20.0.10    # ai-platform 内网/出口 IP
sudo -E bash agent/ai-platform/deploy/wrenai/scripts/open-wren-firewall.sh
```

脚本路径：`agent/ai-platform/deploy/wrenai/scripts/open-wren-firewall.sh`（撤销：`close-wren-firewall.sh`）

**手动 firewalld 等价**：

```bash
SRC=10.20.0.10
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule="rule family=\"ipv4\" source address=\"${SRC}\" port port=\"9100\" protocol=\"tcp\" accept"
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule="rule family=\"ipv4\" source address=\"${SRC}\" port port=\"9101\" protocol=\"tcp\" accept"
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule='rule family="ipv4" port port="9100" protocol="tcp" drop'
sudo firewall-cmd --permanent --zone=public \
  --add-rich-rule='rule family="ipv4" port port="9101" protocol="tcp" drop'
sudo firewall-cmd --reload
```

**端口矩阵**：

| 方向 | 端口 | 是否开 INBOUND | 说明 |
|------|------|----------------|------|
| INBOUND | **9100** | ✅（联调时） | WrenMcpAgent 控制面 |
| INBOUND | **9101** | ✅（联调时） | 数据面 MCP 反向代理 |
| LOCAL | 18080–18180 | ❌ | `wren serve mcp` 本机端口 |
| OUTBOUND | 5432/3306/… | 出站 | 业务库 |
| OUTBOUND | 443 | 出站 | LLM / embedding |

## 1.4 LLM / embedding（WrenAI 自身）

> **归属**：WrenAI 配置面（wren 机 `~/.wren/`、project `.env`、systemd 环境变量），**平台 Nacos / mis-iqd / 前端不接管**。  
> **钉位**：MCP 新线 `wrenai==0.13.3`；**勿混装**经典 Docker 栈的 `~/.wrenai/config.yaml`（见 §1.4.6）。

### 1.4.0 职责边界（先看这张表）

| 能力 | wren 机（本节） | ai-platform（第三部分 §3.4） |
|------|-----------------|------------------------------|
| **Embedding / 语义召回** | `wren memory index` → LanceDB；`get_context` / `recall_queries` | 平台 Skill/Qdrant embedding（`EMBEDDING_SERVICE_URL`），**与 wren 无关** |
| **NL→SQL 生成 LLM** | **不负责**（OSS 0.13 MCP `dry_plan` 不收自然语言） | **LLM Gateway**（`QWEN_*` / `DEEPSEEK_*`）via `mis_iqd.nl2sql.Nl2SqlGenerator` |
| **SQL 转译 / 执行** | `dry_plan(sql)`、`dry_run`、`run_sql`（**无 LLM**，纯 MDL 引擎） | — |
| **业务库凭证** | `~/.wren/profiles.yml` + project `.env`（`${VAR}`） | 仅存 `secret_ref`，经 S1 通道下发 |

mis-iqd Orchestrator 调用链（已按 Wren 0.13 校正）：`get_context` → **`nl2sql`(LLM Gateway)** → `dry_plan(sql)` 方言转译 → 行级注入 → `dry_run` → `run_sql`。  
**embedding 召回**在 wren 侧；**NL→SQL** 固定在 ai-platform（与 Coordinator 共用 Gateway）。上游 `dry_plan` 参数为 `sql`（见官方 CLI / MCP），平台 `IqdMcpClient.dry_plan` 已对齐。

---

### 1.4.1 配置文件与目录（权威路径）

#### 全局（`~/.wren/`，可用 `WREN_HOME` 覆盖）

| 路径 | 权限 | 用途 | 创建方式 |
|------|------|------|----------|
| `~/.wren/profiles.yml` | **0600** | 数据源连接 profile（`${POSTGRES_PASSWORD}` 等占位） | `wren profile add` |
| `~/.wren/config.yml` | 644 | CLI 偏好（如 `default_project`） | `wren context set-profile` / 手工 |
| `~/.wren/config.json` | 644 | 安全策略（`strict_mode` / `denied_functions`） | 手工（可选，见 §1.4.5） |
| `~/.wren/.env` | 600 推荐 | **仅 Day-1 手工 CLI 的 env 兜底**（见下方密钥策略） | 手工 |
| `~/.wren/connection_info.json` | — | 旧版连接 fallback | 旧 CLI 遗留 |

**密钥 / embedding 写哪里（二选一，勿双写）：**

| 场景 | 写哪里 |
|------|--------|
| **生产 / 已装 WrenMcpAgent** | **只写 systemd** `Environment=`（子进程继承）；**不必**再写 `~/.wren/.env` 里的 `DEEPSEEK_API_KEY` |
| **Day-1 仅手工 `wren` CLI**（尚未起 Agent） | 写当前用户 `~/.wren/.env` |

Day-1 初始化目录（在 wren 机执行）：

```bash
mkdir -p ~/.wren && chmod 700 ~/.wren
# profiles.yml / config.yml 留给 wren CLI；可选安全策略见 §1.4.5
sudo mkdir -p /var/lib/mis-iqd/wren-projects/demo /var/lib/wren/huggingface
```

#### 每连接 project（`{WREN_AGENT_PROJECTS_ROOT}/{connId}/`）

> **统一根**：正式与 W0-A 均用 `/var/lib/mis-iqd/wren-projects/`（可用 `WREN_AGENT_PROJECTS_ROOT` / `WREN_PROJECTS_ROOT` 覆盖）。  
> - W0-A 手工测：`.../demo`（目录名 `demo`，非平台 connId）  
> - 平台联调：`.../{iqd_connection.id}`（数字）  
> 勿再使用 `~/wren-projects/`。

| 路径 | 提交 Git? | 用途 |
|------|-----------|------|
| `wren_project.yml` | ✅ | project manifest（`profile` / `data_source` / `schema_version`） |
| `models/`、`relationships.yml`、`knowledge/` | ✅ | MDL + 业务规则 + NL→SQL 样本 |
| `.env` | ❌ gitignore | **连接级** `${VAR}` 解析（DB 密码等） |
| `target/mdl.json` | ❌ | `wren context build` 产物 |
| `.wren/memory/` | ❌ | LanceDB 语义索引（`wren memory index`） |

**`${VAR}` 解析顺序**（profile 与 env 注入共用）：`os.environ` → `$CWD/.env` → `{project}/.env` → `~/.wren/.env`。

跨机器时，WrenMcpAgent 拉起的 `wren serve mcp` **继承 systemd 注入的 `Environment=`**（推荐）。`~/.wren/.env` 只服务本机手工 CLI。

---

### 1.4.2 安装 memory 依赖（embedding 必做）

```bash
source ~/wren-venv/bin/activate
pip install 'wrenai[memory,mcp,postgres]==0.13.3'   # 按数据源改 extra

# 可选：预下载 embedding 模型（离线/内网）
export HF_HOME=/var/lib/wren/huggingface
mkdir -p "$HF_HOME"
# 首次 wren memory index 会自动拉取 WREN_EMBEDDING_MODEL 指定模型
```

---

### 1.4.3 Embedding 配置（wren 机）

wren 0.13.3 的 embedding **默认本地 sentence-transformers**（`wrenai[memory]` 自带），**不走 DeepSeek API**。DeepSeek V4 Pro 仅用于 **LLM 生成**（§1.4.4）。

#### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `WREN_EMBEDDING_MODEL` | | `paraphrase-multilingual-MiniLM-L12-v2` | HuggingFace 模型名；**中文推荐** `BAAI/bge-small-zh-v1.5`（768 维） |
| `WREN_MEMORY_BACKEND` | | 自动 | 强制 `lancedb`（语义）或 `grep`（无 embedding，仅字符串匹配） |
| `HF_HOME` | | `~/.cache/huggingface` | 模型缓存目录（内网建议固定到持久盘） |
| `OPENAI_API_KEY` | | — | 官方 operational 文档标注用于 memory 相关能力；**0.13.3 主路径为本地 ST 模型**，可不设 |

#### 推荐：中文 embedding（与平台 bge-small-zh 对齐）

与 DeepSeek 相同：**有 Agent 写 systemd；仅 Day-1 CLI 写 `~/.wren/.env`（勿双写）。**

```ini
# wren-mcp-agent.service（推荐，与 DEEPSEEK 同段）
Environment=WREN_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
Environment=HF_HOME=/var/lib/wren/huggingface
Environment=WREN_MEMORY_BACKEND=lancedb
```

Day-1 手工 CLI：

```bash
cat >> ~/.wren/.env <<'EOF'
WREN_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
HF_HOME=/var/lib/wren/huggingface
WREN_MEMORY_BACKEND=lancedb
EOF
chmod 600 ~/.wren/.env
```

#### 索引命令（每个 project 执行）

```bash
# W0-A：用 demo；平台联调：换成真实 connId（数字）
export WREN_PROJECT_HOME=/var/lib/mis-iqd/wren-projects/demo
# 或 cd 到 project 根目录

wren context build
wren memory index                    # 建 schema + instruction/sql 语义索引
wren memory fetch -q "本月销售额"     # 验证召回（大 schema 走 embedding）
wren memory recall -q "各渠道销售"    # 验证 NL→SQL 样本召回
```

索引落盘：`{project}/.wren/memory/`（LanceDB）。**换 embedding 模型且维度不同**须先 `wren memory reset` 再 `index`，否则会报 mixed-dimension 错误。

#### 1.4.3b 平台侧知识下发（mis-iqd「方案 A：文件即真相」，2026-09-27 实测 wren 0.13.3）

平台「知识与规则」页的物料**不再经 `context build` 的 `--sql-pairs` / `--instructions`**
（0.13.3 无这两个 option，旧代码只打 warning 跳过 → 界面「已同步」但 wren 侧一条没有），
改为按 wren 自己的两种 sink 落盘：

| 平台物料 | wren 侧 sink | 平台写法 | 生效入口 |
|---|---|---|---|
| 样本对（`iqd_sql_pair`） | `{project}/knowledge/sql/<slug>.md`（frontmatter：`nl` / `sql` / `source` / 可选 `tags`） | `wren memory store --nl … --sql … --tags source:mis-iqd`（官方明确**不要手写**该文件） | `wren memory index` 建索引 → MCP `recall_queries` / `wren memory recall` |
| 术语 / 口径 / 业务指令（`iqd_knowledge`） | `{project}/knowledge/rules/mis-iqd-platform.md`（按 kind 分 `##` 节，整份覆盖写） | 平台经 WrenMcpAgent `/cli` 的 `files` 字段落盘（跨机器）；同机则本地直写 | `wren context instructions`（**不进** memory index）→ MCP `get_instructions` |

**回填口径**：只有**真正写成功**的条目才被标 `synced`（`wren_ref_id` 仍记本次 mdl_hash）；
失败条目保持 `pending` 并在 `iqd_sync_job.build_error` 里带原因 —— 不再出现「已同步但 wren 侧没有」。

**回收（删除同步）**：`wren memory store` 的文件名由 wren 生成（中文统一落 `query-N.md`），
平台无法按 id 反查；且 `wren memory forget` 只删索引行、**保留** `knowledge/sql/*.md`。
故平台每次下发后做一次**对账回收**（WrenMcpAgent `list_path` + `delete_paths`）：

- 只处理带平台 tag（`source:mis-iqd`）的文件 —— 人工/agent 写的样本一律不碰；
- `(nl, sql)` 仍属启用集 → 保留一个（重复的删掉）；不再属于 → 删除；
- **解析不出 frontmatter 的文件一律跳过（fail-safe）**：宁可留残件，绝不误删；
- 删除源文件后**必须 `wren memory reset --force` + `wren memory index`**：`memory index` 是
  **增量**的，清不掉「已删文件对应的索引孤儿行」（实测删了 `query.md` 后 `memory check` 仍报
  `N user pair(s) indexed without markdown — stale index`）；
- 平台每次回收后自跑 `wren memory check` 自证，出现 `not indexed` / `stale index` 会写进
  `iqd_sync_job.build_error`（不静默）。

> 因此「编辑样本 / 停用 / 删除」都能收敛：旧文件被回收，不会在下次索引里复活。
>
> ⚠️ 识别「平台下发的样本文件」靠 frontmatter 里的 `source:mis-iqd` 标记；`wren memory store
> --tags source:mis-iqd` 落盘是 **YAML 列表**形态（`tags:\n- source:mis-iqd`），解析时不能按
> 平铺 `key: value` 读 —— 否则会误判成「人工写的文件」而永不回收（2026-09-28 实测踩到）。

**自检**：

```bash
wren memory check                 # 期望 knowledge/sql: N pair(s)；<=0 说明样本没下发
wren context instructions         # 应打印平台规则（knowledge/rules/ + legacy instructions.md）
wren memory list -n 20 --output json
```

> ⚠️ 跨机器写 `knowledge/rules/` 依赖 wren 机上的 **wren-mcp-agent 同步升级**（`CliRequest.files`）；
> 样本走 `memory store` 是纯 args 调用，旧版 agent 亦可。

---

### 1.4.4 LLM 配置 — DeepSeek V4 Pro（`deepseek-v4-pro`）

#### API 参数（DeepSeek 官方）

| 项 | 值 |
|----|-----|
| **model**（API 请求体） | `deepseek-v4-pro` |
| **base_url**（OpenAI 兼容） | `https://api.deepseek.com` 或 `https://api.deepseek.com/v1` |
| **鉴权** | Header `Authorization: Bearer ${DEEPSEEK_API_KEY}` |
| **可选** | `"thinking": {"type": "enabled"}`、`reasoning_effort: high`（复杂 SQL 生成） |

> 勿用展示名 `DeepSeek-V4-Pro` 或 `deepseek-v4` 作为 model 字段；官方 ID 为 **`deepseek-v4-pro`**。

#### Step 1：写入 wren 机密钥

> **生产只写 systemd，不必再写 `~/.wren/.env`。**  
> Day-1 尚未装 Agent、只跑手工 `wren` 时，才用下面的 `.env` 分支。

**推荐（WrenMcpAgent / 生产）** — 子进程继承：

```ini
# /etc/systemd/system/wren-mcp-agent.service
[Service]
Environment=DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
# 若 wren/LiteLLM 读 OpenAI 兼容变量（W0 核实后按需开启）：
Environment=OPENAI_API_BASE=https://api.deepseek.com/v1
Environment=OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
# embedding 一并写在此处（见 §1.4.3），勿与 ~/.wren/.env 双写
```

改完后：`sudo systemctl daemon-reload && sudo systemctl restart wren-mcp-agent`

**仅 Day-1 手工 CLI（无 Agent）**：

```bash
mkdir -p ~/.wren && chmod 700 ~/.wren
cat > ~/.wren/.env <<'EOF'
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
EOF
chmod 600 ~/.wren/.env
```

#### Step 2：验证 DeepSeek 连通

```bash
curl -s https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "回复 OK"}],
    "stream": false
  }'
```

预期：HTTP 200，`choices[0].message.content` 含有效回复。

#### Step 3：与 wren MCP 联调（W0 必做）

平台问数：**NL→SQL 在 ai-platform LLM Gateway**；MCP **`dry_plan` 仅收 `sql` 做方言转译**（与 Wren 0.13 官方一致）。在 wren 机启动 MCP 后探测：

```bash
cd /var/lib/mis-iqd/wren-projects/demo
wren serve mcp --transport http --host 127.0.0.1 --port 18080 &
# 用 MCP 客户端调 dry_plan(sql=...) / 列出 tools 签名
# ai-platform：确认 QWEN_API_KEY 或 DEEPSEEK_API_KEY 已配，health 中 llm_gateway.initialized=true
```

**通过标准**：

- [ ] 工具清单含 `dry_plan`，参数为 **`sql`**（方言转译）
- [ ] `dry_plan(sql=…)` 返回含 `sql` 字段（或等价转译结果）
- [ ] ai-platform **LLM Gateway** 可用（`/api/v1/admin/health` → `llm_gateway.initialized`）
- [ ]（可选）wren 进程若仍配 embedding/memory，env 可见模型相关变量；**不再要求** wren 侧 NL→SQL LLM key

#### 语言偏好（与平台一致）

Orchestrator 传 `language=zh-CN`（ai-platform `WREN_LANGUAGE`，默认 zh-CN）。wren 机无需单独配置文件，由 MCP 工具参数带入。

---

### 1.4.5 安全策略（可选，`~/.wren/config.json`）

与 LLM 无关，但生产建议开启：

```json
{
  "strict_mode": true,
  "denied_functions": ["pg_read_file", "dblink", "lo_import"]
}
```

| 键 | 默认 | 说明 |
|----|------|------|
| `strict_mode` | `false` | `true` 时查询表必须在 MDL 中声明 |
| `denied_functions` | `[]` | 禁止的危险 SQL 函数名 |

---

### 1.4.6 勿混用：经典 Docker 栈配置（`~/.wrenai/`）

GitHub **0.29.2 / wren-ai-service** 使用另一套配置，**与 MCP 新线 0.13.3 不兼容**：

| 经典栈文件 | 用途 |
|------------|------|
| `~/.wrenai/config.yaml` | `litellm_llm` + `litellm_embedder` + pipeline pipes |
| `~/.wrenai/.env` | `DEEPSEEK_API_KEY` 等 |

经典 DeepSeek 示例（**仅供对照，MCP 新线不要复制此文件**）：

```yaml
# ~/.wrenai/config.yaml — 经典 wren-ai-service，勿与 wrenai 0.13.3 MCP 同机混装
type: llm
provider: litellm_llm
models:
  - api_base: https://api.deepseek.com/v1
    model: deepseek/deepseek-v4-pro    # LiteLLM 命名；经典栈用 deepseek/ 前缀
    alias: default
    timeout: 120
    kwargs:
      temperature: 0
      n: 1
type: embedder
provider: litellm_embedder
models:
  - model: text-embedding-3-large      # 经典栈常用 OpenAI embedding，非 DeepSeek
    alias: default
    api_base: https://api.openai.com/v1
```

MCP 新线 embedding 见 §1.4.3（本地 `WREN_EMBEDDING_MODEL`），LLM 见 §1.4.4（`DEEPSEEK_API_KEY` + W0 核实 MCP 工具面）。

---

### 1.4.7 第一部分 LLM/embedding 检查清单

- [ ] `pip install 'wrenai[memory,mcp,...]'` 已完成
- [ ] **生产**：systemd 已注入 `DEEPSEEK_API_KEY` + embedding env；**或 Day-1 CLI**：`~/.wren/.env`（600）二选一
- [ ] `WREN_EMBEDDING_MODEL` 已设（中文推荐 `BAAI/bge-small-zh-v1.5`）
- [ ] `HF_HOME` 持久目录可写，首次 `wren memory index` 成功
- [ ] DeepSeek curl 探活 `deepseek-v4-pro` 返回 200
- [ ] WrenMcpAgent systemd 已注入 LLM/embedding env（第三部分联调前）
- [ ] W0：`dry_plan(sql=…)` 转译可用；ai-platform `nl2sql` 经 LLM Gateway 生成 SQL（§2.1.3）
- [ ] 磁盘无经典栈 `~/.wrenai/config.yaml` 混装

## 1.5 服务器基线检查（第一部分完成标准）

- [ ] Python ≥ 3.11，venv 已建
- [ ] `wren --version` = 0.13.3
- [ ] `wren serve mcp --help` 正常
- [ ] firewalld 已安装并 running（联调前再执行放行脚本）
- [ ] 持久目录预留：`/var/lib/mis-iqd/wren-projects`、`/var/lib/wren/huggingface`（embedding 缓存）
- [ ] wren CLI 绝对路径已记录（如 `/root/wren-venv/bin/wren`），供 ai-platform `WREN_CLI_BIN` / wren 机 `WREN_AGENT_WREN_CLI_BIN` 使用
- [ ] §1.4 LLM/embedding 检查清单全部勾选

---

# 第二部分：手工验证（W0 / W1）

> **W0** = WrenAI / wren 机 / Agent 真机验证（CLI + 跨机器）。  
> **W1** = 平台打通验证（mis-iqd + BFF + ai-platform + 前端问数，**不依赖**跨机器 agent 亦可先测 Plan A 本地模式）。

## 2.1 W0-A：单机 wren CLI 验证（必做，Day-1）

> 验证 wren 工具链本身可用。**不启动 WrenMcpAgent**，手工 bootstrap 一个 demo project。

### 2.1.1 bootstrap

```bash
sudo mkdir -p /var/lib/mis-iqd/wren-projects/demo
cd /var/lib/mis-iqd/wren-projects/demo
wren context init
# 编辑 wren_project.yml + models/（可先最小占位）
wren context validate
wren context build
wren profile add demo --interactive    # 或 --from-file dev.yml
wren context set-profile demo
wren memory index
```

### 2.1.2 手工启动 MCP（仅本机 127.0.0.1）

```bash
cd /var/lib/mis-iqd/wren-projects/demo
wren serve mcp --transport http --host 127.0.0.1 --port 8080
# 或：WREN_PROJECT_HOME=/var/lib/mis-iqd/wren-projects/demo wren serve mcp --transport http --host 127.0.0.1 --port 8080
```

> 🔴 **禁止** `--host 0.0.0.0`；MCP 无 bearer 鉴权，必须 keep-local。

### 2.1.3 W0-A 核对清单

- [ ] `wren context build` 生成 `target/mdl.json`
- [ ] `wren serve mcp` 可起，工具面可探测（`get_context` / `recall_queries` / `dry_plan`）
- [ ] **`dry_plan` 接受 `sql` 并完成方言转译**；**NL→SQL 走 ai-platform LLM Gateway**（§1.4.4 Step 3）
- [ ] DeepSeek `deepseek-v4-pro` curl 探活通过（§1.4.4 Step 2）
- [ ] `wren memory index` + `memory fetch` 语义召回正常（§1.4.3）
- [ ] `wren context build --force` 行为实测（自愈按钮依赖）
- [ ] `wren memory reset` + `wren memory index` 实测
- [ ] `wren context validate` 实测

---

## 2.2 W0-B：跨机器 Agent 验证（第三部分部署完成后）

> **逐项执行表**（含步骤/预期/排查）：[`wrenai-w0-verify-checklist.md`](wrenai-w0-verify-checklist.md)

| 编号 | 验证点 |
|------|--------|
| W0-1 | 自服务「启用 → agent 远程 bootstrap」 |
| W0-2 | 凭证链 S1 跨机器下发不落盘 |
| W0-3 | 按 connId 路由 agent 数据面（无串台） |
| W0-4 | 端口段 18080–18180 分配/回收 |
| W0-5 | 崩溃自动重启 + 详情页重启按钮 |
| W0-6 | SSH 兜底 bootstrap |
| W0-7 | firewalld 仅放行 ai-platform 源 IP |
| W0-8 | 多连接进程生命周期隔离 |
| W0-9 | V85 迁移 + mcp_host/agent_handle 回流 |

全部 ✅ 后进入生产联调节奏。

---

## 2.3 W1：平台打通验证（mis-iqd + BFF + Worker）

> 对应 `tasks.md` **T-W1-02 / baseline B2**。可在 **本地 Plan A**（ai-platform 与 wren 同机、`WREN_AGENT_ENDPOINT` 为空）先测，再切跨机器。

### 2.3.1 前置

- [ ] Flyway V71+ 已执行（`iqd_*` 表）
- [ ] mis-iqd（8109）、mis-admin-bff（8081）、ai-platform Worker 已起
- [ ] V69+ API 权限种子已执行（deny-unmapped 不 40300）
- [ ] mis-iqd Agent（`mis-iqd`）已注册到 Coordinator 白名单

### 2.3.2 W1 验收步骤

| # | 步骤 | 通过标准 |
|---|------|----------|
| 1 | 管理台「连接配置」保存 | 密钥 API 恒回 `******`；连通自检有结果 |
| 2 | `/iqd/data-query` 自然语言问数 | SSE 返回答案 + citations + plan；**抓包无 WrenAI 直连** |
| 3 | 双闸门 | 无 `ai:chat:use` → 40300；空范围 → 45204 且无数据 |
| 4 | view=user | 响应无 SQL 键；前端 citation/plan 组件无 sql prop |
| 5 | 黄金用例 | 「本月各渠道销售额」类用例通过 |
| 6 | 审计 | `/iqd/traces` 可回查 ask 日志 |

### 2.3.3 W1 快速 curl 示例

```bash
# 连接配置（需 MIS JWT）
curl -s http://localhost:5174/api/v1/iqd/config -H "Authorization: Bearer <JWT>"

# 问数（非流式）
curl -s -X POST http://localhost:5174/api/v1/iqd/ask \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"question":"本月销售额","connection_id":900001}'
```

---

# 第三部分：跨机器部署与联调

> **目标**：ai-platform 经 `WrenMcpAgent` 远程管控 wren 机上的 N 个 `wren serve mcp` 进程。

## 3.1 部署拓扑

```
管理后台 → BFF → ai-platform（WrenMcpAgentClient + IqdMcpClient）
                    │ bearer + 内网
                    ▼
              wren 机 WrenMcpAgent（systemd）
                    ├─ :9100 控制面 ensure/start/stop/...
                    ├─ :9101 数据面 /mcp/{conn_id}
                    └─ 127.0.0.1:18080+  wren serve mcp × N
```

---

## 3.2 WrenMcpAgent 是什么、如何部署启动

**WrenMcpAgent** 是 wren 机上的 **Python 常驻服务**（非 ai-platform 组件）：

| 项目 | 说明 |
|------|------|
| 代码 | `agent/ai-platform/deploy/wrenai/wren-mcp-agent/agent.py` |
| 职责 | 按连接拉起/停止 `wren serve mcp`、端口分配、崩溃自愈、bearer 反向代理、凭证 env 注入 |
| 端口 | 控制面 **9100**、数据面 **9101** |

### 3.2.1 部署（wren 机）

```bash
# 1. 目录（不单独建 wrenagent；systemd 默认以 root 运行，见 unit 注释）
sudo mkdir -p /opt/wren-mcp-agent /var/lib/mis-iqd/wren-projects

# 2. 拷贝部署物（从仓库）
sudo cp -r agent/ai-platform/deploy/wrenai/wren-mcp-agent/* /opt/wren-mcp-agent/

# 3. Python 依赖
cd /opt/wren-mcp-agent
sudo python3.11 -m venv .venv
sudo .venv/bin/pip install -r requirements.txt

# 4. 配置（systemd EnvironmentFile 加载；见 §3.4）
sudo cp .env.example .env
# 编辑 WREN_AGENT_TOKEN、WREN_AGENT_PUBLIC_HOST、WREN_AGENT_WREN_CLI_BIN 等
sudo chmod 600 .env

# 5. systemd（unit 含 EnvironmentFile=-/opt/wren-mcp-agent/.env）
sudo cp wren-mcp-agent.service /etc/systemd/system/
# 若改用普通部署账号：编辑 unit 的 User=/Group=，并 chown 目录与 ~/.wren
sudo systemctl daemon-reload
sudo systemctl enable --now wren-mcp-agent
sudo systemctl status wren-mcp-agent
journalctl -u wren-mcp-agent -f
```

### 3.2.2 启动后验证

```bash
# wren 机本机
curl -sf http://127.0.0.1:9100/internal/v1/wren-mcp/health \
  -H "Authorization: Bearer ${WREN_AGENT_TOKEN}"

ss -ltnp | grep -E ':(9100|9101)\b'

# ai-platform 机（跨机）
curl -sf -H "Authorization: Bearer ${WREN_AGENT_TOKEN}" \
  "http://<WREN_HOST>:9100/internal/v1/wren-mcp/health"
```

详细排障见 [`wren-mcp-agent-deploy.md`](wren-mcp-agent-deploy.md)。

---

## 3.3 本地调试模式（Plan A 回退）

> 当 **`WREN_AGENT_ENDPOINT` 为空** 时，ai-platform 在**本机**用 subprocess 拉起 `wren serve mcp`（不经过远程 agent）。适合开发机 wren 与 Worker 同机。

| 场景 | 配置 |
|------|------|
| 跨机器生产 | `WREN_AGENT_ENDPOINT=http://<wren-ip>:9100`（非空） |
| 本地调试 | `WREN_AGENT_ENDPOINT=`（空或不设） |
| 本地 MCP | `WREN_MCP_HOST=127.0.0.1`；多连接用 `WREN_MCP_PORT_RANGE`；单连接回退可用 `WREN_MCP_PORT`（建议 `18080`，避开本机 gateway `:8080`） |
| wren 路径 | `WREN_CLI_BIN=/path/to/wren`（写在 `backend/.env`） |
| project 根 | `WREN_PROJECTS_ROOT=./data/wren-projects`（本机路径） |

**本地最小 `.env`（ai-platform `backend/.env` 片段）**：

```bash
WREN_CLI_BIN=/root/wren-venv/bin/wren
WREN_MCP_HOST=127.0.0.1
WREN_MCP_PORT=18080
WREN_MCP_PORT_RANGE=18080-18180
WREN_PROJECTS_ROOT=/var/lib/mis-iqd/wren-projects
# WREN_AGENT_ENDPOINT=          # 留空 = Plan A
# WREN_AGENT_TOKEN=
```

**本地 Java 栈**（参考 `docs/devops/local-dev.md`）：

| 服务 | 端口 |
|------|------|
| mis-gateway | 8080 |
| mis-admin-bff | 8081 |
| mis-iqd | 8109 |
| ai-platform Worker | 8000 |
| 前端 | 5174 |

---

## 3.4 配置项清单

### 3.4.1 wren 机 — WrenMcpAgent（`.env` / systemd）

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `WREN_AGENT_TOKEN` | ✅ | — | 与 ai-platform 一致 |
| `WREN_AGENT_PUBLIC_HOST` | ✅ | — | wren 机**内网 IP**（ai-platform 可达） |
| `WREN_AGENT_CONTROL_PORT` | | 9100 | 控制面 |
| `WREN_AGENT_MCP_PORT` | | 9101 | 数据面 |
| `WREN_AGENT_BIND_HOST` | | 0.0.0.0 | 监听地址 |
| `WREN_AGENT_WREN_PORT_RANGE` | | 18080-18180 | 本机 wren 进程端口段 |
| `WREN_AGENT_PROJECTS_ROOT` | | /var/lib/mis-iqd/wren-projects | project 持久卷 |
| `WREN_AGENT_MAX_CONNECTIONS` | | 10 | 单 wren 机连接上限 |
| `WREN_AGENT_WREN_CLI_BIN` | ✅ | `/root/wren-venv/bin/wren` | wren **绝对路径**（勿只写 `wren`） |

示例：[`agent/ai-platform/deploy/wrenai/wren-mcp-agent/.env.example`](../../../agent/ai-platform/deploy/wrenai/wren-mcp-agent/.env.example)

### 3.4.2 ai-platform — `IqdMcpSettings`（**环境变量 / `backend/.env`，不使用 Nacos**）

> 代码：`agent/ai-platform/backend/src/config.py` → `IqdMcpSettings`（`env_prefix=WREN_`）  
> **配置入口**：`agent/ai-platform/backend/.env` 或进程/容器环境变量。  
> ai-platform 是 Python 服务，**不读** `deploy/nacos-config/*/ai-platform.yaml`（仓库亦无此文件）。Nacos 仅用于 Java 服务（如 §3.4.3 BFF）。

| 环境变量 | 跨机器 | 本地 Plan A | 说明 |
|----------|--------|-------------|------|
| `WREN_AGENT_ENDPOINT` | ✅ 必填 | **留空** | 如 `http://10.20.0.20:9100` |
| `WREN_AGENT_TOKEN` | ✅ | 可选 | bearer，与 wren 机一致 |
| `WREN_CLI_BIN` | ✅ | ✅ | wren 绝对路径（跨机器时管理面/本地兜底仍可能用到） |
| `WREN_MCP_PORT_RANGE` | | ✅ | 本地多连接端口段，默认 `18080-18180` |
| `WREN_PROJECTS_ROOT` | | ✅ | 本地 project 根 |
| `WREN_MCP_HOST` | | ✅ | 默认 `127.0.0.1` |
| `WREN_MCP_PORT` | | ✅ | 单连接回退端口；同机有 gateway 时建议 `18080`（勿与 gateway `:8080` 冲突） |
| `WREN_MCP_TRANSPORT` | | | `http` |
| `WREN_MCP_ALLOW_WRITE` | | | `false` |
| `WREN_BUILD_TIMEOUT_SECONDS` | | | context build 超时 |
| `WREN_MEMORY_INDEX_ENABLED` | | | `true` |
| `WREN_SELF_HEAL_FORCE_BUILD_ARGS` | | | 如 `["--force"]`，W0 实测后填 |
| `WREN_SELF_HEAL_MEMORY_RESET_ARGS` | | | 默认 `["--force"]`（非 TTY 无确认会 `Aborted`） |

**跨机器示例**（写入 `agent/ai-platform/backend/.env`）：

```bash
WREN_AGENT_ENDPOINT=http://10.20.0.20:9100
WREN_AGENT_TOKEN=<与 wren 机 WREN_AGENT_TOKEN 一致>
WREN_CLI_BIN=/root/wren-venv/bin/wren
```

**本地 Plan A 示例**见 §3.3。改完后重启 ai-platform Worker 生效。

### 3.4.3 BFF — `mis.iqd.*`（`mis-admin-bff`）

> 代码：`backend/mis-admin-bff/src/main/resources/application.yml`  
> Nacos：`deploy/nacos-config/*/mis-admin-bff.yaml`

| 键 | 默认 | 说明 |
|----|------|------|
| `mis.iqd.base-url` | `http://127.0.0.1:8109` | mis-iqd 地址 |
| `mis.iqd.timeout-ms` | 5000 | 管理面超时 |
| `mis.iqd.sse-enabled` | true | 问数 SSE |
| `mis.iqd.ask-timeout-ms` | 180000 | 问数全链路超时 |
| `mis.iqd.ask-permission` | `ai:chat:use` | 问数权限码 |
| `mis.iqd.agent-id` | `mis-iqd` | Worker agentId |
| `mis.iqd.mdl-writeback-enabled` | true | MDL 写回默认开 |

### 3.4.4 mis-iqd 连接级字段（DB，非 Nacos）

| 字段 | 说明 |
|------|------|
| `secret_ref` | 凭证引用（API 恒 `******`） |
| `mdl_writeback_enabled` | 连接级 MDL 写回闸门 |
| `mcp_status` / `mcp_host` / `agent_handle` | agent 回写（V85+；VO 不暴露 host/handle） |

---

## 3.5 自服务端到端流（联调主路径）

1. 管理台填连接（含凭证）→ BFF → mis-iqd 存 `secretRef`
2. 用户点「启用 / 创建项目」→ BFF `/iqd/mcp/enable` → ai-platform `ensure_connection`
3. ai-platform → wren 机 agent `ensure`（bootstrap + 启 wren 进程）
4. 凭证经管控通道下发 → 注入 wren env（不落盘）
5. 回写 `mcp_status` / `mcp_host` / `agent_handle`
6. 问数：`IqdMcpClient.for_connection(connId)` → agent `:9101/mcp/{conn_id}` → wren 进程

---

## 3.6 凭证策略 S1（摘要）

```
mis-iqd 仅存 secret_ref → ai-platform 解 ref → bearer 通道 → wren agent → wren 进程 env
```

- wren 机不接 Vault；磁盘无明文；临时 profile `chmod 600` 用即删。

---

## 3.7 数据库迁移顺序

| 版本 | 内容 | 顺序 |
|------|------|------|
| V71+ | `iqd_*` 基础表 | mis-iqd 启动前 |
| V81+ | enhance/sync API 权限 | BFF deny-unmapped 前 |
| V85 | `mcp_host` / `agent_handle` | **跨机器 enable 前** |

---

## 3.8 平台已自动化（日常无需 CLI）

- **物料同步**：`trigger_build_index` → context build + memory index + 回填 `wren_ref_id`
- **模型写回**：`trigger_model_build` → 派生 MDL → build + index
- **问数**：orchestrator + `IqdMcpClient.for_connection`
- **漂移**：`get_current_mdl_hash`。**口径（2026-09-28 改）**：`mdl_hash` = 部署产物
  `target/mdl.json` 的**内容哈希** `sha256[:16]` —— 写侧由平台部署时计算，读侧对 wren 机上现存
  文件现算，两边同算法可比；此前是 `wqd-{时间}-{随机}` 兜底值，与 wren 侧任何值都不可比，
  漂移检测形同虚设。memory index 失败不阻断 build（Q6）

---

## 3.9 运维自愈三按钮

| 动作 | 平台按钮 | CLI 兜底 |
|---|---|---|
| 强制重建 | force-rebuild | `wren context build --force` |
| 重新索引 | re-index | `wren memory reset` + `memory index` |
| 模型校验 | validate | `wren context validate` |

详见 `mis-iqd-selfheal-prd.md`。

---

## 3.10 故障恢复速查

| 现象 | 处置 |
|------|------|
| MDL 漂移 | `wren get mdl` 比对 → force-rebuild |
| MCP 不可达 | 先 `ensure` 连接；查 agent health / firewalld |
| agent 401/403 | 对齐 `WREN_AGENT_TOKEN`；查源 IP 放行 |
| `mcp_host` 空 | 未配 `WREN_AGENT_ENDPOINT` 或未 enable |
| 进程崩溃 | agent reconcile 自动重启；或详情页「重启」 |
| 版本混装 | 见 `TASK-20260826-001`，勿用 0.29.2 经典栈 |

**日志**：
- wren 机：`journalctl -u wren-mcp-agent -f`
- ai-platform：`agent.mis_iqd.mcp_lifecycle` / `adapters.wren_mcp_agent_client`

---

## 附录 A：相关文档索引

| 文档 | 用途 |
|------|------|
| [`wren-mcp-agent-deploy.md`](wren-mcp-agent-deploy.md) | Agent 部署全文 |
| [`wrenai-w0-verify-checklist.md`](wrenai-w0-verify-checklist.md) | W0-B 逐项验证表 |
| [`mis-iqd-mcp-deploy-incremental.md`](mis-iqd-mcp-deploy-incremental.md) | v0.2 跨机器设计决策 |
| [`baseline-execution.md`](baseline-execution.md) | W1–W4 批次验收 |
| [`deploy-iqd.md`](deploy-iqd.md) | 规划速查 |
