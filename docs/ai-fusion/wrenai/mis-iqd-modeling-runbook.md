# mis-iqd 可视化建模台 运营 runbook

> **文档角色**：mis-iqd 可视化建模台（v1.11）日常运维与故障处置手册。配合 `mis-iqd-modeling-verify-checklist.md`（验收）与 `wrenai-ops-runbook.md`（WrenAI 基础设施）使用。
> **范围**：启停 / 迁移 / 重建 / 重导入 / 索引 / 清理 / 排障速查。
> **状态**：🔶 首版（基于静态代码与种子核实；标注「真机」处需实机核验）｜日期：2026-09-22。
> **占位符**：`<AI_PLATFORM_HOST>` / `<WREN_HOST>` / `<MIS_JWT>` / `<CONN_ID>` / `<PG>` 按真机替换。

---

## 0. 组件与边界速览

| 层 | 组件 | 职责 | 关键接口/表 |
|---|---|---|---|
| 前端 | `features/agent/iqd`（建模台 `/iqd/modeling`） | 画布/树/属性/向导/流水线；**视图**，不持真值 | TanStack Query 缓存 catalog |
| BFF | `mis-admin-bff` | 鉴权（`iqd:*`）、注册表（`deny-unmapped=true`）、透传 | `/api/v1/iqd/**` |
| 域服务 | `backend/mis-iqd` | 编辑权威闭环、MDL 派生、写回、对账 | `iqd_catalog_item` / `iqd_connection` / `iqd_model_layout` |
| Worker | `agent/mis_iqd`（ai-platform） | 表发现、MCP 生命周期、scope 解析、脱敏出口 | `/internal/v1/iqd/**`（**不登记** sys_api） |
| 数据面 | WrenAI（`wren serve mcp`，每连接一 project） | MDL 构建 / 记忆索引 / 问数执行 | wren project 目录 |

**不变量（任何操作都不得破坏）**：
1. 编辑权威闭环：一切编辑落 `iqd_catalog_item(source='modeling')` → SyncCoordinator 合并 → 整连接 `build_mdl_from_catalog` → **不直写 MDL 文件**。
2. 核心不变量：`iqd_connection.built_edit_revision == WrenAI.built_mdl_hash` 代表的模型版本；偏离 → `STALE_DRIFT` + 对账收敛。
3. fail-closed：漂移期强制重建置灰；删除被引用 cube → 422 阻断；并发 409 可重读重试。

### 0.1 本次交付的更新范围（运维/联调「一处看全」）

> 依据本特征 18 个 commit 的 `git log --name-only` 实测。**要更新的程序**如下（`wren-mcp-agent` 除外，见下结论）。

| 程序 | 路径 | 规模 | 部署动作 |
|---|---|---|---|
| Flyway 迁移 | `backend/mis-migrator` | **5 个新迁移**：V87 建模台种子 / V88 补 5 端点 / V89 `model_ref`+MCP 6 端点+`iqd:mcp:manage` / V90 Cube upsert / **V91 修 F-1** | 执行迁移（**V91 必须执行**，否则 translate 端点 40300） |
| 域服务 | `backend/mis-iqd` | 28 文件 | 重新构建部署 |
| BFF | `backend/mis-admin-bff` | 8 文件 | 重新构建部署 |
| AI 平台 | `agent/ai-platform/backend` | 7 文件（`iqd_config_client.py` / `discovery_service.py` / `service.py` / `iqd_discovery.py` / `main.py` + 2 测试） | 重新部署 |
| 前端 | `frontend/mis-admin-web` | 95 文件 + `package.json`/`pnpm-lock.yaml`（7 新依赖：`@xyflow/react`、CodeMirror 6 ×5、`@dagrejs/dagre`） | **依赖安装必须 `pnpm install`**（⚠️ 不是 `npm install`：本仓 pnpm 布局会报 `Cannot read properties of null`）；构建/测试 `npm run build` / `npm run typecheck` / `npm run test` 走 package.json scripts，可正常用 → 再部署 |
| **`wren-mcp-agent`** | `agent/ai-platform/deploy/wrenai/wren-mcp-agent/` | **零改动** | **不更新**；仅确认已部署 |

**`wren-mcp-agent` 结论：本次【不需要更新】。**
依据：本特征 18 个 commit **完全未碰** `wren-mcp-agent/`、`wren_mcp_agent_client.py`、`wren_mcp_registry.py`、`mcp_lifecycle.py` —— 控制面 `/internal/v1/wren-mcp/*`（端口 **9100**）与数据面 `/mcp/{conn_id}`（端口 **9101**）契约**未变**。
> ⚠️ 但 **V89 新增 6 条 MCP 启停端点**（BFF 面 `/api/v1/iqd/mcp/{start,stop,restart,enable,status,list}`）**依赖 wren-mcp-agent 已部署运行**——这是**部署前提**，不是代码更新。若 Agent 未跑，启停按钮点击会失败（50201）。

---

## 1. 数据库迁移（Flyway）

### 1.1 建模台相关版本序
| 版本 | 内容 |
|---|---|
| V71 | `iqd_*` 基础表 |
| V77 | 问数独立门户 sys_app（93010 / 93030 / 93040） |
| V78 | 样本对方言转化端点（**含 §6 F-1 的 id 冲突**） |
| V79 | sync_job + catalog 可编辑 |
| V80 | `iqd_edit_idempotency` / `edit_revision` |
| V81 | 目录 92500 + enhance/sync 端点 + code 0096 段 |
| V83 | `iqd_connection.mcp_status/mcp_port` |
| V84 | self-heal 三端点（92593-92595） |
| V85 | `iqd_connection.mcp_host / agent_handle` |
| **V87** | **建模台**：`iqd_model_layout` 表；sys_menu 92600 + 权限 92631-33；sys_api 92601-12；绑定 92613-24；授权 92625-27 |
| **V88** | 补登 GET /connections、layout GET/PUT/auto-layout、GET /dependencies（92640-44 / 92645-49） |
| **V89** | `iqd_catalog_item.model_ref` 列；MCP 六端点（92650-55/92657-62）；`iqd:mcp:manage`（92656/92663） |
| **V90** | `PUT /catalog/cube`（92700/92701） |
| **V91** | **修 F-1**：`sql-pairs/translate` 端点 id 冲突（重登记为空闲 id）；**必须执行**（否则该端点 40300，见 verify-checklist §5） |

### 1.2 迁移后自检
```sql
-- 版本到位（V91 修 F-1，见 §1.1）
SELECT max(version) FROM flyway_schema_history;              -- 期望 >= 91
-- 建模台注册表：期望 12(V87) + 5(V88) + 6(V89) + 1(V90) = 24 条，全部有绑定（V91 为改 id 登记，不新增计数）
SELECT COUNT(*) FROM sys_api WHERE id BETWEEN 92601 AND 92612;      -- 12
SELECT COUNT(*) FROM sys_api WHERE id BETWEEN 92640 AND 92644;      -- 5
SELECT COUNT(*) FROM sys_api WHERE id BETWEEN 92650 AND 92655;      -- 6
SELECT COUNT(*) FROM sys_api WHERE id = 92700;                      -- 1
-- 端点 ⇄ 菜单绑定（期望全部有 permission）
SELECT a.id, a.http_method, a.path_pattern, m.permission
FROM sys_api a JOIN sys_menu_api ma ON ma.api_id=a.id JOIN sys_menu m ON ma.menu_id=m.id
WHERE a.id BETWEEN 92601 AND 92701 ORDER BY a.id;
```
> ⚠️ **F-1 复验**（见 verify-checklist §5）：`SELECT path_pattern FROM sys_api WHERE path_pattern LIKE '%sql-pairs%';` —— 若**缺** `/api/v1/iqd/sql-pairs/translate`，即命中已知 id 冲突，需按 verify-checklist §5 修复。

### 1.5 首次接入：数据源 profile 与连接创建

> 建连接是**三方协作**：① **DBA（wren 主机侧）**注册 profile → ② **平台向导**落库连接记录 → ③ **平台/运维**拉起 MCP。平台**不代敲凭证、不经手明文**（架构红线）。

#### (a) DBA 主机侧：数据源 profile 注册（**在 wren 机执行**）

```bash
# ① 注册业务库 profile（凭证经 ${ENV} 占位；明文只进主机 ~/.wren/.env 或 systemd Environment=）
wren profile add <profile_name> --connector postgres \
  --host <BIZ_PG_HOST> --port 5432 --user <db_user> \
  --password '${ENV:IQD_DB_PASSWORD}' --database <biz_db>
# ② 绑定到本连接的 wren project 目录（build / serve mcp 均作用于此 project）
wren context set-profile <profile_name>
# ③ 验证
wren profile list                          # 含 <profile_name>
stat -c '%a %n' ~/.wren/profiles.yml       # 期望 600
grep -i password ~/.wren/profiles.yml      # 期望 ${ENV:IQD_DB_PASSWORD}，无明文
```
- **凭证边界**：`profiles.yml` 仅存 `host/port/user/${ENV:...}` 占位；**明文只落主机**（`.env` 0600 或 systemd `Environment=`）。平台库/前端只存 `secret_ref` **引用**。
- 产出 `<profile_name>`，供平台向导步骤 2「认证方式=none（profile 注入）」关联。

#### (b) 平台侧：向导 4 步创建连接

路径：`/iqd/modeling` → 右上「新建连接」→ `components/wizard/ConnectionWizard.tsx`。

| 步骤 | key | 填什么 |
|---|---|---|
| 1 | `conn:basic` | 连接名称*（如「销售库」）/ WrenAI 地址 `base_url`（如 `http://127.0.0.1:3000`）/ 默认 connector（下拉）/ 超时（秒）；下方展示已有连接列表 + 每连接 MCP 状态卡 |
| 2 | `conn:datasource` | 认证方式（`none`=profile 注入 / `basic` / `token`）/ 凭证引用 `secret_ref`（password 框，**留空=保留原值**，查询恒返回 `******`）/ `project_id`（可选，留空由 WrenAI 侧解析） |
| 3 | `conn:profile` | **纯说明页**：profile 绑定由 DBA 在主机侧执行（即 (a)），平台此步**不收集凭证** |
| 4 | `conn:test` | **先落库再测试**（步骤 3→4 边界创建；**落库失败留在原步、不清屏**）→ 自检 → 拉起 MCP |

#### (c) 对应 API（curl）

```bash
# ① 建连接（只存 secret_ref 引用，不存明文；字段见 IqdAdminService.createConnection）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/connections" \
  -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
  -d '{"name":"销售库","base_url":"http://127.0.0.1:3000","auth_type":"none",
       "secret_ref":"<profile_name>","project_id":"","default_connector":"postgres",
       "timeout_seconds":300,"language":"zh","enabled":true}'
# ② 连接自检（返回体含 id = <CONN_ID>）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/connections/<CONN_ID>/test" \
  -H "Authorization: Bearer <MIS_JWT>"
# ③ 首次 bootstrap：拉起该连接 MCP（经 ai-platform → wren-mcp-agent → wren serve mcp）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/mcp/enable?connectionId=<CONN_ID>" \
  -H "Authorization: Bearer <MIS_JWT>"
```
- 权限：建连接需 **`iqd:modeling:edit`**；`/mcp/enable` 需 **`iqd:mcp:manage`**（V89 绑定菜单 92656）。

#### (d) 连接状态自检

```bash
curl -s "<AI_PLATFORM_HOST>/api/v1/iqd/connections" -H "Authorization: Bearer <MIS_JWT>"
```
- 关注字段：`mcp_status`（期望 `running`）/ `mcp_port` / `last_health_at` / `last_health_msg`。
- ⚠️ `mcp_host` / `agent_handle` 后端标注 `@JsonIgnore` → **前端与 API 均看不到**（勿据此排查，需上主机看）。

#### (e) 失败排查（对照 §7 排障速查）

| 现象 | 码 | 定位 |
|---|---|---|
| 连接**重名** | **40900** | `iqd_connection` UK `(name)` → 换名或复用既有连接 |
| 连接**名称空** / 入参非法 | **42200** | 向导步骤 1 必填项（HTTP 422） |
| MCP 不可达 / profile 未注入 | **50201**（HTTP 502） | 核对 (a) profile 与 wren-mcp-agent 9100/9101 可达性；见 §7 |
| 未开写回 | **40300** | 该连接未启用写回（按连接灰度） |

#### (f) 环境变量与外部依赖

> 建连接 / 问数除「**profile + agent 可达**」外，另有三类**外部依赖**需前置就绪；缺失**不会在向导阶段报错**，而会在 **build / memory index / 问数** 段暴露。与 verify-checklist §1 对应。

**① ai-platform 侧 env（**跨机联调必须**）**

| env | 说明 |
|---|---|
| `WREN_AGENT_ENDPOINT` | wren 机控制面基址，如 `http://<WREN_HOST>:9100`。**非空 = 启用跨机器部署**（为空则退回本地 Plan A 子进程）。依据 `agent/ai-platform/backend/src/adapters/wren_mcp_agent_client.py:65`（「控制面基址取 `WREN_AGENT_ENDPOINT`」）。 |
| `WREN_AGENT_TOKEN` | bearer，须与 wren 机 `WREN_AGENT_TOKEN` **一致**。 |

> ⚠️ 两 env 未配 → 跨机场景 `mcp_host` 恒空（走了本地 Plan A）。路由判定 `WrenMcpAgentClient.enabled == (WREN_AGENT_ENDPOINT 非空)`。

**② WrenAI 侧 LLM / embedding（memory index / 问数强依赖）**

- `DEEPSEEK_API_KEY`（或所配 LLM provider 的 key）须在 **wren 进程 env** 可见。
- embedding 模型须**离线可用**：内网无外网时需预下载 `WREN_EMBEDDING_MODEL`（默认 `paraphrase-multilingual-MiniLM-L12-v2`，中文推荐 `BAAI/bge-small-zh-v1.5`）。
- **依赖链：build → memory index → 问数**——任一缺失 → 流水线 **「记忆索引」段**失败、问数无召回。详见 `wrenai-ops-runbook.md §1.4.3 / §1.4.4`。

**③ 业务库网络可达**

- profile 的 `--host` 业务 PG 必须**从 wren 机可连**（防火墙 / 端口放行）——这是 profile 生效（进而 `mcp_status=running`）的前提。
- 连不通 → 注入 profile 后仍会 **50201**。

```bash
# —— wren 机：LLM / embedding / 安全策略 / 网络 一次核验 ——
systemctl show wren --property=Environment 2>/dev/null | grep -Ei 'DEEPSEEK|EMBEDDING' || true
cat ~/.wren/config.json 2>/dev/null | grep -Ei 'strict_mode|denied_functions' || echo '(默认 strict_mode=false / denied_functions=[])'
nc -vz <BIZ_PG_HOST> 5432
# —— ai-platform 机：agent 通道 env ——
systemctl show ai-platform --property=Environment 2>/dev/null | grep -Ei 'WREN_AGENT_(ENDPOINT|TOKEN)' || true
```

> **`~/.wren/config.json` 安全策略**：`strict_mode`（`true` 时查询表须在 MDL 中声明）/ `denied_functions`（禁用的危险 SQL 函数）——**影响问数安全边界**，联调前建议确认；默认 `strict_mode=false`、`denied_functions=[]`。详见 `wrenai-ops-runbook.md §1.4.5`。

---

## 2.0 联调环境启动清单（数据库已更新后）

> **本节角色**：从「Flyway 已跑到 **V92**」出发，按**依赖顺序**把可视化建模台跑起来并开始联调。
> **与既有文档的关系**：本节 = §1.5（首次接入）＋ §2.1–2.2（启停）＋ `mis-iqd-modeling-verify-checklist.md §1`（全局前置）**串成一条可执行时间线**，并补齐 `scripts/start-integration-stack.ps1` **不含**的建模台服务。
> **状态**：🔶 **全部「待真机」**——本清单在无 docker / 无 `wren` CLI / 无业务库的沙箱内**未实跑**，命令按静态代码核实（端口 / 命令 / env 均已 grep 核对）；真机执行时如与本节不符，以现场为准并回修本文。
> **占位符**：`<PG_HOST>` `<WREN_HOST>` `<AI_PLATFORM_HOST>` `<MIS_IQD_HOST>` `<MIS_JWT>` `<CONN_ID>` `<BIZ_PG_HOST>` `<profile_name>` 按真机替换。

### ⚠️ 起点落差：`start-integration-stack.ps1` 不覆盖建模台（必读）

`scripts/start-integration-stack.ps1` 只做 5 件事（`scripts/start-integration-stack.ps1:27-77`）：

1. 起基础设施（`deploy/docker-compose.dev.yml`：postgres / redis / nacos / minio）
2. `cd backend; .\mvn.ps1 -pl mis-migrator flyway:migrate`
3. 建 Nacos 命名空间 `integration`
4. 推 Nacos 配置
5. 打包并起 **`mis-gateway` + `mis-audit`**（`-WithAuthContainer` 时再加 `mis-auth`）

**它完全不含**：`mis-iqd` / `mis-admin-bff` / `ai-platform`（含 `mis_iqd` Worker）/ 前端 / WrenAI 数据面。
⇒ **只跑它，建模台所需服务一个都没起。** 用户说的「数据库已更新」通常就是它第 2 步 `flyway:migrate` 的结果 —— 迁移到位 ≠ 服务到位，本清单正是弥合这一落差。

> 参考：`wrenai-ops-runbook.md` 与本文件 §0.1 亦明确「`wren-mcp-agent` 本次**零改动、不更新**，仅需确认已在跑」，但要意识到 **V89 起的 6 个 MCP 端点依赖它已部署**（部署前提，非代码更新）。

---

### 2.0.1 前置确认（3 项，逐条给命令 + 期望）

#### ① Flyway 版本 = 92（**最先做**）

```bash
# 容器内（dev compose 方式）
docker exec -i mis-postgres psql -U mis -d mis_platform -c \
  "SELECT max(version) AS latest, count(*) AS applied FROM flyway_schema_history;"

# 或直连业务库
PGPASSWORD=mis123 psql -h <PG_HOST> -U mis -d mis_platform -c \
  "SELECT max(version) FROM flyway_schema_history;"
```

**期望**：`92`。

| 缺哪个 | 后果 | 表现 |
|---|---|---|
| **缺 V92** | `PUT /api/v1/iqd/connections/{id}`（`sys_api` id 92800 / code 00960045）未登记 | 前端「停用 / 编辑**指定**连接」**40300**（T06 唯一的按 id 写通道） |
| **缺 V91** | `POST /api/v1/iqd/sql-pairs/translate`（id 92703）未登记（F-1：V76 与 V78 争 id 92586 致静默跳过） | 「脱敏与维度 → 样本对 → 转化」**40300** |

若 `latest < 92`：
```bash
cd backend && .\mvn.ps1 -pl mis-migrator flyway:migrate
```
迁移后按 §1.2 自检复核（补充两条新端点）：
```sql
-- 期望 1 行，permission='iqd:modeling:edit'
SELECT a.id, a.http_method, a.path_pattern, m.permission
FROM sys_api a JOIN sys_menu_api ma ON ma.api_id=a.id JOIN sys_menu m ON ma.menu_id=m.id
WHERE a.id = 92800;
-- 期望 1 行，permission='iqd:enhance:manage'
SELECT a.id, a.http_method, a.path_pattern, m.permission
FROM sys_api a JOIN sys_menu_api ma ON ma.api_id=a.id JOIN sys_menu m ON ma.menu_id=m.id
WHERE a.id = 92703;
-- 期望 0 行（(method,path) 全库无重复）
SELECT http_method, path_pattern, COUNT(*) FROM sys_api
WHERE type='api' AND status=1 GROUP BY http_method, path_pattern HAVING COUNT(*)>1;
```
> ⚠️ V91 / V92 均为 append-only + 固定 ID + `WHERE NOT EXISTS`，**可安全重跑**。若报 `Migration checksum mismatch`，说明有人改动了**已应用**的迁移文件 → 见 §7，**不要**手工改 `flyway_schema_history`。

#### ② 基础设施容器在跑

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

**期望**（`deploy/docker-compose.dev.yml:9-86`）：

| 容器 | 端口 | 期望状态 |
|---|---|---|
| `mis-postgres` | 5432 | `Up (healthy)` |
| `mis-redis` | 6379 | `Up (healthy)` |
| `mis-nacos` | 8848, 9848 | `Up (healthy)` |
| `mis-minio` | 9000, 9001 | `Up (healthy)` |

未起：
```bash
docker compose -f deploy/docker-compose.dev.yml up -d
docker exec mis-postgres pg_isready -U postgres   # 期望: accepting connections
```
Nacos 控制台：`http://localhost:8848/nacos`（`nacos` / `nacos`）。

#### ③ 网络可达性（三方链路）

```bash
# (a) 业务库 ← wren 机（profile 生效 / mcp_status=running 的前提）
nc -vz <BIZ_PG_HOST> 5432
# (b) wren 机控制面/数据面 ← ai-platform 机（否则 50201）
nc -vz <WREN_HOST> 9100 && nc -vz <WREN_HOST> 9101
# (c) mis-iqd ← BFF / ai-platform 机（内部面 8109）
curl -s -o /dev/null -w "%{http_code}\n" http://<MIS_IQD_HOST>:8109/actuator/health   # 期望 200
```

> (a) 不通 → profile 注入后连接仍 **50201**；(b) 不通 → MCP 启停/健康检查 **50201**（见 `wren-mcp-agent/README.md:51`：仅放行 ai-platform 源 IP 到 9100/9101）。

---

### 2.0.2 启动时间线（**按依赖顺序**）

> **依赖顺序**：`mis_platform(PG)` → **`mis-iqd` 先起** → `mis-admin-bff` / `ai-platform` → 前端 → 最后 WrenAI 数据面（per-connection MCP）。
> 依据 `start-dev.ps1:80`（领域服务 → BFF → Gateway）与 `wrenai-ops-runbook.md §3.7`。**mis-iqd 必须先起**：BFF 的 IQD 适配层与 ai-platform Worker 的配置回源都指向它（`:8109`）。

#### Step 1 — WrenAI 侧准备（**wren 机**，DBA 执行）

```bash
# ① 注册业务库 profile（凭证经 ${ENV} 占位；明文只落主机，平台不代敲）
wren profile add <profile_name> --connector postgres \
  --host <BIZ_PG_HOST> --port 5432 --user <db_user> \
  --password '${ENV:IQD_DB_PASSWORD}' --database <biz_db>
# ② 绑定到本连接的 wren project 目录
wren context set-profile <profile_name>
# ③ 验证
wren profile list                            # 含 <profile_name>
stat -c '%a %n' ~/.wren/profiles.yml         # 期望 600
grep -i password ~/.wren/profiles.yml        # 期望 ${ENV:IQD_DB_PASSWORD}，无明文

# ④ 确认 wren-mcp-agent 在跑（控制面 9100 / 数据面 9101）
systemctl is-active wren-mcp-agent                          # 期望 active
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9100/   # 期望非 000
ss -lntp | grep -E ':(9100|9101)\b'
```
**期望 / 失败排查**：profile 未注册 → 向导步骤 2「认证方式=none（profile 注入）」无法关联，连接自检 **50201**；`wren-mcp-agent` 未跑 → 所有 MCP 启停端点 **50201**。详见 §1.5(a)/(e)。

#### Step 2 — mis-iqd（**`:8109`**）

```bash
# 方式 A（推荐，带 .env.integration / .env 全套 env；已在跑则跳过）
cd backend && .\start-dev.ps1 mis-iqd
# 方式 B（分别开终端 / IDE 调试）
cd backend && .\mvn.ps1 spring-boot:run -pl mis-iqd
# 健康检查
curl -s http://127.0.0.1:8109/actuator/health          # 期望 {"status":"UP"}
```

- 端口权威值 `backend/mis-iqd/src/main/resources/application.yml:2`（`server.port: 8109`）；`start-dev.ps1:88` 亦为 `mis-iqd = 8109`。
- **`JPA ddl-auto: validate`**（`application.yml:25`）：表由 `V71__iqd_schema.sql` 建，实体不一致会**启动即失败** → 先确认 ① 的迁移到位。
- ⚠️ `local-dev.md §5` 的 `spring-boot:run` 示例列表**漏了 mis-iqd**，用 `start-dev.ps1 mis-iqd` 或按上式直接指定模块即可。
- **失败排查**：连不上 PG → 核对 `DB_*`；Redis 不通**不阻断启动**（B3 事件推送降级，见 `application.yml:30-36`）。

#### Step 3 — mis-admin-bff（**`:8081`**）

```bash
# 现成脚本（从任意目录运行；含完整 env，见 §2.0.3）
backend\start-bff-standalone.bat          # 构建 + 启动
backend\start-bff-standalone.bat nopkg    # 跳过构建，直接起既有 jar（联调中改代码后重启用）
# 健康检查
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/actuator/health   # 期望 200
```

**确认注册进 Nacos 且心跳正常**（否则 remote 模式网关 **503**）：
```bash
curl -s "http://<NACOS_HOST>:8848/nacos/v1/ns/instance/list?serviceName=mis-admin-bff&namespaceId=integration"
# 期望：hosts 非空，healthy=true
```
- ⚠️ **两种模式要分清**（这是最容易踩的点）：
  - **本机直连模式**（默认 `MIS_REMOTE=false`）：`mis-gateway/application.yml:22,37` 把 `/api/v1/**` **硬编码直连 `http://localhost:8081`**，且 `discovery.locator.enabled: false`（`:16-18`）⇒ **不走 Nacos 发现**，BFF 不注册也照常路由；此时 BFF 挂了报 `Connection refused` / 502。
  - **remote 集成模式**（`MIS_REMOTE=true`，即 `start-bff-standalone.bat:32` 与 `start-integration-stack.ps1` 的 `integration` 命名空间）：路由为 **`lb://mis-admin-bff`**（见该脚本 `:6-9` 注释）⇒ **BFF 必须注册进 Nacos 且 `healthy=true`**，否则网关日志 `No servers available for service: mis-admin-bff` + **503**。
- **失败排查**：见 §2.0.5「BFF 起不来 / 网关 503」。

#### Step 4 — ai-platform（**`:8000`**，含 `mis_iqd` Worker）

```bash
cd agent/ai-platform/backend
uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
# 健康检查（ai-platform 自身）
curl -s http://127.0.0.1:8000/api/v1/admin/health      # 期望 code:0，llm_gateway.initialized
# 确认 mis-iqd Worker 侧连通（**注意：该端点属于 mis-iqd**，见下）
curl -s http://<MIS_IQD_HOST>:8109/internal/v1/iqd/health
# 期望：{"code":0,...,"data":{"status":"ok","service":"mis-iqd","time":"..."}}
```

- **端口权威值 `8000`**：`agent/ai-platform/backend/.env:19`（`PORT=8000`）、`docs/devops/local-dev.md:195`、`backend/uvicorn-startup.log`（`Uvicorn running on http://0.0.0.0:8000`）三处一致。
  > 注：`agent/ai-platform/backend/CODE_READING_GUIDE.md:443` 的 `--port 8002` 是**示例**，非本环境约定值；`start-dev.ps1:69` / `.env.integration` 的 `AI_PLATFORM_BASE_URL=http://127.0.0.1:8000` 亦为 8000。
- **「含 `mis_iqd` Worker」= 进程内自动启动**：`src/agent/mis_iqd/bootstrap.py` 在 lifespan 启动阶段 ① 注入 `mcp_status` 回写回调 ② **批量拉起所有「启用」连接的 WrenAI MCP 进程**（best-effort，单连接失败不阻断）③ 启动后台健康检查循环。⇒ **起了 ai-platform 即起了 Worker，无需额外命令**。
- ⚠️ **`/internal/v1/iqd/health` 由 mis-iqd 暴露**（`IqdInternalController.java:46` `@RequestMapping("/internal/v1/iqd")` + `:68` `@GetMapping("/health")`），**不是 ai-platform** —— 它只是 ai-platform 侧 `IqdConfigClient` 的**消费目标**（`iqd_config_client.py:38`）。故 §2.1 旧写法 `curl http://<AI_PLATFORM_HOST>/internal/v1/iqd/health` 会打错主机，**请按上式打 `:8109`**。
- **失败排查**：`WREN_AGENT_ENDPOINT` 为空 → 退回本地 Plan A 子进程，跨机场景 `mcp_host` 恒空（见 §2.0.3 与 §1.5(f)）。

#### Step 5 — 前端（**`:5174`**）

```bash
cd frontend/mis-admin-web
pnpm install          # ⚠️ 必须 pnpm（本仓 node_modules 为 pnpm 布局 + pnpm-lock.yaml；npm install 报 Cannot read properties of null）
pnpm dev              # = vite（package.json:7）；访问 http://localhost:5174
```

- **端口权威值 `5174`**：`frontend/mis-admin-web/vite.config.ts`（`server.port: 5174`）与 `local-dev.md §6`（「访问 http://localhost:5174」）一致。
  > ⚠️ `local-dev.md §5` 端口表写 `mis-admin-web | 5173` **系笔误**，以 `vite.config.ts` 的 **5174** 为准（构建/测试脚本可正常用 `npm run build` / `npm run typecheck`）。
- **proxy 指向 gateway:8080（不是 BFF:8081）**：`vite.config.ts` 中 `'/api' → http://127.0.0.1:8080`；另有 `'/api/events'`、`'/api/messages'`、`'/ws' → http://127.0.0.1:3100`（AI Platform Gateway，**仅 Copilot 对话用，建模台联调非必需**）。
- 入口：登录后进入建模台路由 **`/iqd/modeling`**（`src/components/layout/keep-alive-outlet.tsx:165`）。默认账号 `admin` / `Mis@123456`。
- **失败排查**：`/api` **404** 多为 proxy 未指 gateway:8080（或 gateway 未起）；见 §2.0.5。

#### Step 6 — 建连接 + 拉起 MCP（引用 §1.5，不重复）

```bash
# ① 建连接（需权限 iqd:modeling:edit；只存 secret_ref 引用，不存明文）
curl -s -X POST "http://<AI_PLATFORM_HOST>:8000/api/v1/iqd/connections" \
  -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
  -d '{"name":"销售库","base_url":"http://127.0.0.1:3000","auth_type":"none",
       "secret_ref":"<profile_name>","project_id":"","default_connector":"postgres",
       "timeout_seconds":300,"language":"zh","enabled":true}'
# ② 连接自检（返回体含 id = <CONN_ID>）
curl -s -X POST "http://<AI_PLATFORM_HOST>:8000/api/v1/iqd/connections/<CONN_ID>/test" \
  -H "Authorization: Bearer <MIS_JWT>"
# ③ 首次 bootstrap：拉起该连接 MCP（需权限 iqd:mcp:manage）
curl -s -X POST "http://<AI_PLATFORM_HOST>:8000/api/v1/iqd/mcp/enable?connectionId=<CONN_ID>" \
  -H "Authorization: Bearer <MIS_JWT>"
# ④ 验证 MCP 就绪
curl -s "http://<AI_PLATFORM_HOST>:8000/api/v1/iqd/connections" -H "Authorization: Bearer <MIS_JWT>"
```

- **`mcp_status` 期望值 = `running`**（枚举 `src/adapters/wren_mcp_registry.py:39-47`：`running` / `starting` / `stopped` / `crashed` / `unhealthy`）。
  > ⚠️ §1.5(d) 与 verify-checklist 写的「期望 `ready`」**系笔误**；`ready` 不是合法取值，以 `running` 为准。
- 注意 `mcp_host` / `agent_handle` 后端 `@JsonIgnore` → **API/前端看不到**，需上主机看（见 §1.5(d)）。
- 后续流程（向导 4 步 / curl 序列）见 **§1.5**；MCP 状态查询与启停见 **§2.2**。

---

### 2.0.3 环境变量清单（一张表，按服务归属）

> BFF 一栏逐项取自 `backend/start-bff-standalone.bat` 实际 `set` 语句（**非凭记忆**）；其余取自各服务 `application.yml` / 后端 `.env` / `wren-mcp-agent` README。

| 变量名 | 归属服务 | 必填性 | 示例 | 不设的后果 |
|---|---|---|---|---|
| `SERVER_PORT` / `SERVER__PORT` | BFF | **必填** | `8081` | 宿主机注入的 `SERVER__PORT=20231` 经 Spring relaxed binding 覆盖 `server.port` → **BFF 启动失败**（脚本 `:25-29` 专门覆盖之） |
| `MIS_REMOTE` | BFF / 各 Java 服务 | **必填** | `true`（集成）/ `false`（本机） | 语义见 Step 3：`true` 走 Nacos 发现，`false` 走网关硬编码直连 |
| `NACOS_SERVER` | BFF | `MIS_REMOTE=true` 必填 | `10.254.16.6:8848` | remote 模式服务注册失败 → 网关 503 |
| `NACOS_NAMESPACE` | BFF | 同上 | `integration` | 注册到错误命名空间 → 网关查不到实例 |
| `NACOS_CONFIG_GROUP` | BFF | 同上 | `MIS_GROUP` | 拉不到配置中心下发配置 |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | BFF / mis-iqd | **必填** | `10.254.16.6` / `5432` / `mis_platform` / `mis` / `mis123` | 连不上业务库；mis-iqd 因 `ddl-auto=validate` **启动即失败** |
| `REDIS_HOST` / `REDIS_PORT` | BFF / mis-iqd | 必填 | `10.254.16.6` / `6379` | 缓存/事件推送不可用（mis-iqd 降级不阻断，BFF 可能超时） |
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | BFF / 各 Java 服务 | **必填** | `D:\code\mis-platform\backend\keys\private.pem` | 令牌签发/验签失败；`start-integration-stack.ps1:23` 会**直接报错退出** |
| `MIS_IQD_BASE_URL` | BFF | 建议显式 | `http://127.0.0.1:8109` | 默认即 `127.0.0.1:8109`（`mis-admin-bff/application.yml:145`）；跨机须改为 `<MIS_IQD_HOST>:8109`，否则 BFF 转发 IQD 请求失败 |
| `MIS_IQD_TIMEOUT_MS` | BFF | 可选 | `5000` | 默认 5000（`:146`） |
| `MIS_IQD_AGENT_ID` | BFF | 可选 | `mis-iqd` | 默认 `mis-iqd`（`:160`） |
| `MIS_IQD_CONFIG_BASE_URL` | **mis-iqd** | 可选 | （空 = 本服务自读配置表） | 见 `mis-iqd/application.yml:42` |
| `JAVA_TOOL_OPTIONS` | BFF / 各 Java 服务 | **强烈建议** | `-Dfile.encoding=UTF-8` | Windows GBK 解析 Nacos 含中文注释 YAML 失败（脚本 `:45-52`） |
| `PORT` | ai-platform | 必填 | `8000` | 端口漂移，前端/BFF/`AI_PLATFORM_BASE_URL` 全对不上 |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | ai-platform | 必填 | `10.254.16.6` / `5432` / `aiplatform` / `...` / `ai_platform` | ai-platform 自身库不可用（**注意与 MIS 业务库 `mis_platform` 是不同库**） |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | ai-platform | 必填 | `10.254.16.6` / `6379` / `2` | Agent Core 缓存/流不可用 |
| `WREN_AGENT_ENDPOINT` | ai-platform | **联调必填** | `http://<WREN_HOST>:9100` | 为空 → 退回本地 Plan A 子进程；跨机场景 `mcp_host` 恒空 |
| `WREN_AGENT_TOKEN` | ai-platform | **联调必填** | `<token>` | 须与 wren 机 `WREN_AGENT_TOKEN` **一致**，否则 401 |
| `MIS_ADMIN_BFF_BASE_URL` | ai-platform | 必填 | `http://127.0.0.1:8081` | 权限码回源失败 → 所有 skill/MCP 被 **fail-closed** 拒绝 |
| `AI_PLATFORM_BFF_SHARED_SECRET` | ai-platform | 必填 | `o4JW22zl...` | 与 BFF 的 `service-token` 不一致 → BFF `/internal/**` **401** |
| `MIS_ACL_ENABLED` | ai-platform | 必填 | `true` | 权限闸门失效（生产必须 `true`，禁止 `false` 绕过） |
| `MIS_KB_BASE_URL` | ai-platform | 建议 | `http://127.0.0.1:8108` | 知识库检索不可用 |
| `DEEPSEEK_API_KEY` / `QWEN_API_KEY` | ai-platform **与 wren 进程** | 视 provider | `sk-...` | ai-platform 侧 LLM 不可用；**wren 侧**缺 key → build→memory index→问数 链路在「记忆索引」段失败、问数无召回 |
| `QWEN_API_ENDPOINT` | ai-platform | 视 provider | `http://10.254.6.83:4000` | 主 provider 不可达（有 DeepSeek 兜底） |
| `WREN_EMBEDDING_MODEL` | **wren 进程** | 内网必填 | `BAAI/bge-small-zh-v1.5` | 首次 `wren memory index` 需联网拉模型，内网离线 → 记忆索引失败 |
| `WREN_AGENT_CONTROL_PORT` / `WREN_AGENT_MCP_PORT` | **wren 机** `wren-mcp-agent` | 可选 | `9100` / `9101` | 默认即 9100/9101（`wren-mcp-agent/agent.py:48-49`） |
| `VITE_*` | 前端 | 通常无需 | —— | 建模台 proxy 目标已**硬编码**在 `vite.config.ts`，不依赖 env |

> **wren 机侧 env 核验**（一次看完，来自 §1.5(f)）：
> ```bash
> systemctl show wren --property=Environment 2>/dev/null | grep -Ei 'DEEPSEEK|EMBEDDING' || true
> systemctl show wren-mcp-agent --property=Environment 2>/dev/null | grep -Ei 'WREN_AGENT_(TOKEN|CONTROL_PORT|MCP_PORT)' || true
> ```

---

### 2.0.4 冒烟清单（最小可验证集，8 条 · ~10 分钟）

> 目标：**先跑通，再谈 M-G1**。逐条通过 = 环境基本可用；任一条不过 → 查 §2.0.5。比 `mis-iqd-modeling-verify-checklist.md §3` 的 E2E 更短、更快反馈。

| # | 验证目标 | 命令 | 期望 |
|---|---|---|---|
| S1 | mis-iqd 活着 | `curl -s http://127.0.0.1:8109/actuator/health` | `{"status":"UP"}` |
| S2 | mis-iqd ← Worker 通道通 | `curl -s http://<MIS_IQD_HOST>:8109/internal/v1/iqd/health` | `code:0` + `data.status=ok` |
| S3 | BFF 活着 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/actuator/health` | `200` |
| S4 | BFF 已被网关发现（remote 模式） | `curl -s ".../instance/list?serviceName=mis-admin-bff&namespaceId=integration"` | `hosts` 非空、`healthy=true`（本机直连模式可跳过） |
| S5 | ai-platform 活着 | `curl -s http://127.0.0.1:8000/api/v1/admin/health` | `code:0`，`llm_gateway.initialized=true` |
| S6 | **能建连接** | ① 建连接 curl（§2.0.2 Step 6） | `code:0`，返回 `id`（记 `<CONN_ID>`） |
| S7 | **能拉起 MCP** | ②③ `test` + `mcp/enable`，再 GET `/connections` | `mcp_status` 变为 **`running`**（非 `ready`） |
| S8 | **能导表 + 画布见模型 + 能问数** | `discovery/tables` → `discovery/import` → 刷新 `/iqd/modeling` 画布 → 问一句数 | `imported>0`；画布出现模型节点；问数返回结果 |

> **S8 失败但 S6/S7 通过**，多半是外部依赖（LLM / embedding / 业务库可达）而不是平台代码 → 见 §1.5(f) 与 §2.0.5。

---

### 2.0.5 常见失败对照（症状 → 最可能原因 → 排查动作）

| 症状 | 最可能原因 | 排查动作 |
|---|---|---|
| **`40300`**「接口未授权映射」（`PUT /iqd/connections/{id}`） | 缺 **V92**（未登记 92800/92801） | ① 前置确认① ；② `SELECT max(version) FROM flyway_schema_history` = 92；③ 复核 id 92800 的 permission=`iqd:modeling:edit` |
| **`40300`**（`sql-pairs/translate` 转化） | 缺 **V91**（F-1：V76/V78 争 id 92586 静默跳过） | 复核 id 92703 存在且 permission=`iqd:enhance:manage`；不预期则 `flyway:migrate` |
| **`40300`**（其它端点） | 权限码与端点不匹配 / `sys_api` 与 `sys_menu_api` 只插了一张表 | 跑 §7「通用取证」SQL 对比注册表；确认登录 JWT 为 `role_id=1` 或已授予对应 `iqd:*` |
| **`40300`**（写回类） | 该连接未启用**写回**（按连接灰度） | 查 `iqd_connection` 写回开关（§1.5(e)） |
| **`50201`**（HTTP 502） | ① `wren-mcp-agent` 没起 ② profile 没注入 ③ **业务库从 wren 机不通** | ① `systemctl is-active wren-mcp-agent` + `nc -vz <WREN_HOST> 9100/9101`；② `wren profile list` / `~/.wren/profiles.yml`；③ **在 wren 机** `nc -vz <BIZ_PG_HOST> 5432` |
| **网关 `503 No servers available for service: mis-admin-bff`** | **仅 remote 模式**：BFF 未注册进 Nacos / 心跳异常 | ① S4 的 instance/list 是否 `healthy=true`；② BFF 是否 `MIS_REMOTE=true` 且 `NACOS_SERVER` 正确；③ BFF 日志有无注册异常 |
| 网关 `502 / Connection refused`（本机模式） | `MIS_REMOTE=false`，网关硬编码直连 `localhost:8081`，BFF 没起 | 启 BFF（Step 3）；`curl http://localhost:8081/actuator/health` |
| **BFF 起不来** | 宿主机注入 `SERVER__PORT=20231` 经 relaxed binding 覆盖 `server.port` | 用 `start-bff-standalone.bat`（内含 `SERVER_PORT=8081` + `SERVER__PORT=8081` 双保险，`:25-29`）；或手工 export 这两个变量 |
| **BFF 报 Nacos YAML 中文解析失败** | Windows 默认 GBK | 设 `JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8`（脚本 `:45-52` 已内置） |
| **前端 `/api` 404** | proxy 目标不是 gateway:8080（或 gateway 未起） | 核对 `vite.config.ts` 的 `'/api' → http://127.0.0.1:8080`；`curl http://localhost:8080/api/v1/auth/captcha` |
| **前端 `npm install` 崩**（`Cannot read properties of null`） | 本仓是 **pnpm** 布局 + `pnpm-lock.yaml` | 用 `pnpm install`（Step 5） |
| 前端访问 `5173` 打不开 | 端口是 **5174**（非 5173） | 改访问 `http://localhost:5174`（`vite.config.ts`） |
| ai-platform 起了但 `mcp_host` 恒空 | `WREN_AGENT_ENDPOINT` 为空 → 走本地 Plan A | 设 `WREN_AGENT_ENDPOINT` / `WREN_AGENT_TOKEN`（§2.0.3） |
| 权限码回源失败 → skill/MCP 全被拒 | `MIS_ADMIN_BFF_BASE_URL` 或 `AI_PLATFORM_BFF_SHARED_SECRET` 与 BFF 不一致 | 核对 env；BFF `/internal/**` 返回 401 即命中 |
| 流水线「记忆索引」段失败 / 问数无召回 | wren 侧缺 `DEEPSEEK_API_KEY` 或 embedding 模型离线不可用 | §1.5(f)②：`systemctl show wren --property=Environment`；预下载 `WREN_EMBEDDING_MODEL` |
| 迁移报 `checksum mismatch` | **已应用**迁移文件被人改动 | 见 §7；**不要**手工改 `flyway_schema_history` |

---

## 2. 服务启停

### 2.1 mis-iqd（域服务）/ BFF / ai-platform
```bash
# 依赖顺序：mis_platform(PG) → mis-iqd → mis-admin-bff → ai-platform（Worker）
# mis-iqd（示例，按实际部署替换）
systemctl restart mis-iqd
# BFF
systemctl restart mis-admin-bff
# ai-platform（含 mis_iqd Worker）；确认健康
curl -s http://<MIS_IQD_HOST>:8109/internal/v1/iqd/health
```
> 顺序约束：**mis-iqd 先起跑**（Flyway 落 V87~V90），再起 BFF/Worker（见 `wrenai-ops-runbook.md §3.7`）。

### 2.2 WrenAI 数据面（per-connection MCP）
```bash
# 单连接 MCP 状态
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/mcp/status?connectionId=<CONN_ID>" \
  -H "Authorization: Bearer <MIS_JWT>"
# 启停/重启（wait=true 同步等待就绪；retainDir=true 保留 project 目录）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/mcp/start?connectionId=<CONN_ID>&wait=true&retainDir=true" -H "Authorization: Bearer <MIS_JWT>"
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/mcp/restart?connectionId=<CONN_ID>&wait=true&retainDir=true" -H "Authorization: Bearer <MIS_JWT>"
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/mcp/stop?connectionId=<CONN_ID>&wait=true&retainDir=true" -H "Authorization: Bearer <MIS_JWT>"
# 启用连接项目（首次 bootstrap）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/mcp/enable?connectionId=<CONN_ID>" -H "Authorization: Bearer <MIS_JWT>"
```
> 权限：6 个 MCP 端点用 **`iqd:mcp:manage`**（程序化校验，非注解；V89 绑定菜单 92656）。凭证仅经 env 注入、不落盘。

---

## 3. 重建（强制重建 / 模型校验 / 对账）

```bash
# 1) 强制重建（整库 rebuild + memory index + 回填）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/self-heal/force-rebuild" \
  -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
  -d '{"connection_id": <CONN_ID>}'

# 2) 重新索引（仅 memory index）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/self-heal/re-index" \
  -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
  -d '{"connection_id": <CONN_ID>}'

# 3) 模型校验
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/self-heal/validate" \
  -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
  -d '{"connection_id": <CONN_ID>}'

# 4) 对账（收敛 STALE_DRIFT：以 WrenAI 实际 mdl_hash 回填 built_*）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/catalog/reconcile" \
  -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
  -d '{"connection_id": <CONN_ID>}'
```
- 权限：`iqd:selfheal:exec`（V84）。
- 观测：`iqd_sync_job.action ∈ {force_rebuild, reindex, validate, materials, model}`。
- **fail-closed 提示**：`STALE_DRIFT` 期间前端「强制重建」置灰，此为准入保护，**先 resolve 漂移再重建**（或直接走 `reconcile`）。

---

## 4. 重新导入（表发现 / 收敛漂移）

```bash
# ① 只读发现
curl -s "<AI_PLATFORM_HOST>/api/v1/iqd/discovery/schemas?connectionId=<CONN_ID>" -H "Authorization: Bearer <MIS_JWT>"
curl -s "<AI_PLATFORM_HOST>/api/v1/iqd/discovery/tables?connectionId=<CONN_ID>&schema=public&page=1" -H "Authorization: Bearer <MIS_JWT>"
curl -s "<AI_PLATFORM_HOST>/api/v1/iqd/discovery/columns?connectionId=<CONN_ID>&schema=public&table=orders" -H "Authorization: Bearer <MIS_JWT>"
# ② 批量导入（mode=create_or_skip 幂等；⚠️ 默认不传 in_scope，导入 ≠ 可问）
curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/discovery/import" \
  -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
  -d '{"connectionId": <CONN_ID>, "schema":"public", "tables":["orders","customers","stores"], "mode":"create_or_skip"}'
```
- query 参数名必须 **camelCase `connectionId`**（Worker 侧 `Query(alias=...)`；写 `connection_id` 会 422）。
- 漂移收敛「重新导入」= 清空历史 `edit_revision/wren_ref_id`（回归 WrenAI 镜像，见 `IqdAdminService` 重导入 = 新基线）→ 触发整库 build。
- **重导入后**：需去 `/iqd/scope` 勾选才纳入问数（PRD §6.3「导入 ≠ 可问」）。

---

## 5. 索引（memory index）

- 触发：`self-heal/re-index`（§3-2）或发布流水线「记忆索引」段重试。
- 首次 `wren memory index` 会拉取 `WREN_EMBEDDING_MODEL` 指定模型（离线内网需预下载，见 `wrenai-ops-runbook.md §1.4.2`）。
- 观测：`iqd_connection.index_status`；失败看 `iqd_sync_job` 的 `index_error`。

---

## 6. 清理

| 对象 | 表/资源 | 操作 |
|---|---|---|
| 孤儿 Cube measure/dimension 子节点 | `iqd_catalog_item` | `PUT /catalog/cube` 的 patch = 全量替换语义，服务端按 `item_key` 求差**自动孤儿清理**（本次未出现的既存子节点被物理删除） |
| 画布布局 | `iqd_model_layout` | 视图数据；可随时「自动布局」覆盖重建；`version` 乐观并发（`base_version` 不符 → 40900） |
| 幂等记录 | `iqd_edit_idempotency` | 保留期由既有策略；确认可安全按 `created_at` 归档清理 |
| 同步作业 | `iqd_sync_job` | 历史作业可归档；`action` 见 §3 |
| wren project 目录 | `/var/lib/mis-iqd/wren-projects/<connId>` | `stop` 时 `retainDir=true` **保留**；确认废弃连接后再手工删（默认 7 天保留策略见 `wren_mcp_registry`） |
| 漂移 | —— | 不用手工清；走 `reconcile`（§3-4）收敛 |

> ⚠️ **禁止手工直改 MDL 文件或 `edit_revision` 绕过闭环**——会破坏核心不变量，引发 `STALE_DRIFT`。

---

## 7. 排障速查

| 现象 | 码 | 定位 |
|---|---|---|
| 接口未授权映射 | **40300** | `deny-unmapped=true` 下端点未登记/未绑定 → 查 sys_api ⋈ sys_menu_api（**含 §5 F-1 的 id 冲突**） |
| 写回闸门关闭 | 40300 | 该连接未启用写回（U7/Q4 按连接灰度） |
| 乐观并发 | 40900 | `data.current_edit_revision` → 重读后重试 |
| 幂等键并发 | 40901 | 同 key 并发 → 返回首次结果 |
| 引用阻断 / 源表不存在 | 42200 | `data.dependents` |
| 字段引用不存在 | 42201 | `data.errors` |
| 连接不可达 / profile 未注入 | 50201（HTTP 502） | Worker MCP 健康检查失败，fail-closed（mock）→ 查 profile/env（runbook §1） |
| 待导入清单为空 / 参数非法 | 42200（HTTP 422） | discovery import 入参 |
| 端点未实现（历史骨架） | 50300 | `isNotImplementedError` → 呈现「建设中」（T03/T04 已基本消除） |

**通用取证**：
```bash
# BFF 注册表 vs 现场
PGPASSWORD=<pw> psql -h <PG> -U <user> -d mis_platform -c \
 "SELECT a.id,a.http_method,a.path_pattern,m.permission FROM sys_api a \
  JOIN sys_menu_api ma ON ma.api_id=a.id JOIN sys_menu m ON ma.menu_id=m.id \
  WHERE a.path_pattern LIKE '/api/v1/iqd/%' ORDER BY a.id;"
# 连接级版本不变量
PGPASSWORD=<pw> psql -h <PG> -U <user> -d mis_platform -c \
 "SELECT id,current_edit_revision,built_edit_revision,built_mdl_hash,mcp_status,index_status FROM iqd_connection WHERE id=<CONN_ID>;"
```

---

## 8. 回退

- **迁移**：V87~V90 为 append-only + 固定 ID + `WHERE NOT EXISTS`，可安全重跑；如需回退，**只删本特征新增行**（`sys_api` 92601-92701 / `sys_menu` 92600·92631-33·92656 / 绑定 / 授权）与 `iqd_model_layout`，**勿动 V71/V77 基础**。
- **功能**：前端路由 `/iqd/modeling` 可从 `iqd-nav.ts` / `PAGE_MAP` 摘除即隐藏入口（后端端点保留无害）。
- **命名**：`R-7`（tasks §5.6）命名冲突回退见 tasks.md。

> 真机执行前请对照 `mis-iqd-modeling-verify-checklist.md` 的「全局前置条件」，本 runbook 不重复。
