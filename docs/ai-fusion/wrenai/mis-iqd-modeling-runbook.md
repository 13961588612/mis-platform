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
- 关注字段：`mcp_status`（期望 `ready`）/ `mcp_port` / `last_health_at` / `last_health_msg`。
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

- profile 的 `--host` 业务 PG 必须**从 wren 机可连**（防火墙 / 端口放行）——这是 profile 生效（进而 `mcp_status=ready`）的前提。
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

## 2. 服务启停

### 2.1 mis-iqd（域服务）/ BFF / ai-platform
```bash
# 依赖顺序：mis_platform(PG) → mis-iqd → mis-admin-bff → ai-platform（Worker）
# mis-iqd（示例，按实际部署替换）
systemctl restart mis-iqd
# BFF
systemctl restart mis-admin-bff
# ai-platform（含 mis_iqd Worker）；确认健康
curl -s http://<AI_PLATFORM_HOST>/internal/v1/iqd/health
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
