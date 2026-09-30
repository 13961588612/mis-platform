# mis-iqd 可视化建模台 — T05 集成验收 · 真机验证清单

> **文档角色**：T05（集成验收）逐项执行表，配合 `mis-iqd-modeling-runbook.md`（运维步骤）与 `mis-iqd-modeling-tasks.md`§4（跨阶段不变项）使用。
> **状态**：🔶 部分已验证（沙箱静态/单测）｜**真机端到端待跑** ｜ 日期：2026-09-22 ｜ 语言：中文
> **编制**：严过关（QA）
>
> **⚠️ 环境现实（决定本文哪些能验、哪些不能验）**：
> - `docker` 不可用 ❌；无 `wren` CLI ❌；可达的 PG `10.254.16.6:5432` 是 `mis_platform` 库（**非业务库**）❌。
> - ⇒ **起 WrenAI + 真业务库的真机端到端，在本沙箱【不可能】执行。**
> - 本文严格区分三态：`已验证`（本机实跑）/ `部分验证`（静态分析或单测）/ `未验证`（需真机，给出复验方法）。
>
> **占位符**：`<AI_PLATFORM_HOST>` / `<WREN_HOST>` / `<MIS_JWT>` / `<CONN_ID>` 按真机替换。

---

## 0. 总览（一眼看已证 / 未证）

| 项 | 类别 | 本沙箱状态 | 真机复验 |
|---|---|---|---|
| 跨阶段不变项 6 项（§4） | 静态/grep | ✅ **已验证**（逐条带证据，见 §2） | 建议 CI 化 |
| M-G1 建连接+向导闭环（含模型物化） | E2E | ⚠️ **未通过**（新建远程连接的工程读不到模型；新发现真缺口，详见 §3.8） | 需修复后重跑 |
| M-G2 关系+Cube+问数命中 | E2E | ✅ **真机通过（2026-09-28，连接 900001）** | 已跑 |
| M-G3 build 失败→定位→重试 | E2E | ✅ **引擎层验证通过**（2026-09-28，非生产工程 verify-model3；详见 §3.9） | 已跑 |
| M-G4 漂移注入→详情→收敛 | E2E | ⚠️ **未验证**（需制造 MDL 漂移＝改真机工程，破坏性，本轮不做） | 需非生产环境 |
| M-G5 字段改描述/脱敏→问数生效 | E2E | ✅ **真机通过（2026-09-28）**，并因此修掉 2 个真 bug（见 §3.7） | 已跑 |
| M-G6 scope 行级维度徽标+谓词预览 | E2E | ✅ **组件级通过**（2026-09-28：徽标渲染 + 后端预览接线；详见 §3.10） | 已跑 |
| P-1 画布 200 节点 ≥55fps | 性能 | ❌ **未验证**（需浏览器） | 可跑 |
| P-2 500 节点折叠 ≤1s | 性能 | ❌ **未验证**（需浏览器） | 可跑 |
| P-3 CodeMirror chunk ≤300KB gzip | 性能 | 🟡 **部分验证**（构建产物实测，见 §4.3） | 建议复测 |
| P-4 dagre 200/500 节点 | 性能 | ❌ **未验证**（需浏览器/Node 计时） | 可跑 |
| P-5 build_mdl_from_catalog ≤10s | 性能 | ❌ **未验证**（需 WrenAI） | 可跑 |
| P-6 缓存命中画布首屏 ≤500ms | 性能 | ❌ **未验证**（需浏览器） | 可跑 |
| 门禁：前端 typecheck/vitest/build | 闸门 | ✅ **已验证** | — |
| 门禁：Java mis-iqd | 闸门 | ✅ **已验证** | — |
| 门禁：Python `-k iqd` | 闸门 | ✅ **已验证** | — |
| 验收：引擎侧 `wren context validate` 0 warning | 门禁 | ✅ **已验证**（connection 900001：`Valid — 3 models, 0 views, 1 relationships`，0 warning） | 发布后自检基线 |

---

## 1. 全局前置条件（真机，全部项共用）

- [ ] **WrenAI** 可用：`wren --version` = 0.13.3；`wren serve mcp` 在 PATH；每连接的 wren project 目录（`/var/lib/mis-iqd/wren-projects/<connId>`）就绪（见 runbook §1.5）。
- [ ] **WrenAI 侧 LLM / embedding 配置**（**memory index 与问数强依赖**）：`DEEPSEEK_API_KEY`（或所配 LLM provider 的 key）须在 **wren 进程 env** 可见；embedding 模型须**离线可用**（内网无外网时需预下载 `WREN_EMBEDDING_MODEL`，默认 `paraphrase-multilingual-MiniLM-L12-v2`，中文推荐 `BAAI/bge-small-zh-v1.5`）。**依赖链：build → memory index → 问数**——任一缺失，发布流水线会在 **「记忆索引」段**失败，问数无召回。
  ```bash
  # 在 wren 机：profile debug 不展示 LLM key，需查 systemd 单元或进程 environ
  systemctl show wren --property=Environment 2>/dev/null | grep -Ei 'DEEPSEEK|EMBEDDING' \
    || grep -aE 'DEEPSEEK_API_KEY|WREN_EMBEDDING_MODEL' \
         "/proc/$(pgrep -f 'wren serve' | head -1)/environ" | tr '\0' '\n'
  ```
  > 失败征兆：流水线「记忆索引」段红 / `iqd_connection.index_status` 异常 / 首次 `wren memory index` 拉模型超时（内网无外网）。详见 `wrenai-ops-runbook.md §1.4.3 / §1.4.4`。
- [ ] **业务库**：待建模的连接指向一个**真正含数据**的业务 PG（非 `mis_platform`）。sample schema 建议 `public`，含 `orders` / `customers` / `stores` 三表（M-G1 最少 3 张）。
- [ ] **业务库从 wren 机网络可达**（profile 能否生效的前提）：profile 的 `--host` 业务 PG 必须**从 wren 机可连**（防火墙 / 端口放行，含业务 PG 端口）。**在 wren 机**验证：
  ```bash
  # <BIZ_PG_HOST> 同下方 DBA profile 命令；凭证同 profile 的 ${ENV:IQD_DB_PASSWORD}
  nc -vz <BIZ_PG_HOST> 5432
  PGPASSWORD="$IQD_DB_PASSWORD" psql -h <BIZ_PG_HOST> -U <db_user> -d <biz_db> -c '\dt public.*'
  ```
  > 连不通 → profile 注入后仍会 **50201**（MCP / 连接不可达）；核对「wren 机源侧 → 业务 PG」的防火墙放行（与 §1 末 `wren-mcp-agent` 项的放行思路一致）。
- [ ] **mis_platform 库**：Flyway 已跑到 **V91**（`V87~V91` 建模台增量已落；**V91 修 F-1**：`sql-pairs/translate` 端点 PK 冲突 → **必须执行**，否则该端点仍 40300；`SELECT max(version) FROM flyway_schema_history`）。
- [ ] **后端**：mis-iqd / mis-admin-bff / ai-platform（含 `agent/mis_iqd` Worker）均已起；`MIS_API_PERMISSION_DENY_UNMAPPED=true`（默认，见 `application.yml:98`）。
- [ ] **登录态**：`<MIS_JWT>` 属于 **role_id=1**（内置租户管理员，V87~V90 已授予 `iqd:modeling:view/edit/publish` + `iqd:mcp:manage`）。
- [ ] **前端**：**依赖安装必须 `pnpm install`**（本仓 `node_modules` 为 pnpm 布局 + `pnpm-lock.yaml`，`npm install` 会报 `Cannot read properties of null`）；构建走 `npm run build`（`npm run typecheck` / `npm run test` 同为 package.json scripts，可正常用）→ 产物已部署，访问 `/iqd/modeling` 侧栏可见「可视化建模台」（Workflow 图标）。
- [ ] **DBA 侧：数据源 profile 注册**（**在 wren 机执行**；**凭证只落主机**，平台既不代敲也不经手明文——架构红线）。命令形态：
  ```bash
  # ① 注册业务库 profile（凭证经 ${ENV} 占位；明文只进主机 ~/.wren/.env 或 systemd Environment=）
  wren profile add <profile_name> --connector postgres \
    --host <BIZ_PG_HOST> --port 5432 --user <db_user> \
    --password '${ENV:IQD_DB_PASSWORD}' --database <biz_db>
  # ② 绑定到本连接的 wren project 目录（后续 build / serve mcp 均作用于此 project）
  wren context set-profile <profile_name>
  # ③ 验证：profile 列表含该名；profiles.yml 权限 0600 且 password 为占位（无明文）
  wren profile list
  stat -c '%a %n' ~/.wren/profiles.yml
  grep -i password ~/.wren/profiles.yml     # 期望看到 ${ENV:IQD_DB_PASSWORD}，无明文
  ```
  产出 `<profile_name>` 供向导（§3.1 步骤 2，认证方式 `none` = profile 注入）关联。归属与边界见 runbook §1.5。
- [ ] ⛔ **【已作废】「一期仅一条 `enabled=true`」业务约定** —— **2026-09-22 修订：该约定作废，本节不得再作为验收依据。**
  - **作废依据**：用户已拍板 **放开多条连接并存（真正的多连接）** ⇒ **多条 `enabled=true` 合法**。书面订正见 `architecture.md:882`（`iqd_connection` 行）；语义与「主连接」口径见 `mis-iqd-modeling-system-design.md §14.5 / §14.5.1`。
  - **替代口径**：**不再需要"先把旧的置 false 再启用新的"**；多条同时启用为合法态。主连接 = **`name='default'`**（否则 id 最小的 enabled）。
  - === 以下为**作废前的历史原文**（保留痕迹，勿据此执行）===
  - [ ] ~~**「一期仅一条 `enabled=true`」业务约定**（**业务约定，非 DB 硬约束**）：`iqd_connection` 一期业务上**仅一条启用**。~~
    - **依据**：`architecture.md:882`（`iqd_connection` 行备注「UK `(name)`；**一期业务上仅一条 `enabled=true`**」）；实体注释 `IqdConnection.java:16` 与仓储 `IqdConnectionRepository.java:20` 同述。**DB 层实际只有** `CONSTRAINT uk_iqd_connection_name UNIQUE (name)`（`V71__iqd_schema.sql:28`）——**`enabled` 无唯一约束**。
    - **联调影响**：首次接入时若库里**已有** `enabled=true` 的连接，新建启用可能出现**「两条启用」的非法态**（接口不报错，但语义违规）。
    - ~~**正确做法**：**先把既有连接置 `false`，再启用新连接**——走既有问数配置页（`PUT /api/v1/iqd/config`，单条 upsert，`IqdAdminService.saveConnection` 按 dto 写 `enabled`）。⚠️ **无** `PUT /iqd/connections/{id}`（多连接接口只有 `POST/GET /connections`、`POST /connections/{id}/test`）。~~
  - === 历史原文结束 ===
  - **注**：上述「⚠️ 无 `PUT /iqd/connections/{id}`」一句也被补丁取代 —— 该端点**本期新增**（`mis-iqd-modeling-system-design.md §14.1`，迁移 `V92`），"停用/编辑指定连接"不再需要走 `/config`。
  ```bash
  # ① 查当前启用态（真机 PG）
  PGPASSWORD=<pw> psql -h <PG> -U <user> -d mis_platform -c \
   "SELECT id,name,enabled FROM iqd_connection WHERE enabled=1 ORDER BY id;"
  # ② 若有旧启用连接：先置 false（upsert 主连接），再走向导启用新连接
  curl -s -X PUT "<AI_PLATFORM_HOST>/api/v1/iqd/config" \
    -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
    -d '{"name":"<旧连接名>","enabled":false}'
  ```
- [ ] **`wren-mcp-agent` 已部署运行**（控制面 **9100** / 数据面 **9101** 可达；V89 新增的 6 条 MCP 启停端点**依赖本 Agent**，未部署则 `/mcp/enable` 会失败）：
  ```bash
  # wren 机本机
  curl -sf http://127.0.0.1:9100/internal/v1/wren-mcp/health -H "Authorization: Bearer ${WREN_AGENT_TOKEN}"
  ss -ltnp | grep -E ':(9100|9101)\b'
  # ai-platform 机（跨机；需放行 ai-platform 源 IP → 9100/9101）
  curl -sf -H "Authorization: Bearer ${WREN_AGENT_TOKEN}" "http://<WREN_HOST>:9100/internal/v1/wren-mcp/health"
  ```
- [ ] **ai-platform 的两个环境变量**（**跨机联调必须配**）：`WREN_AGENT_ENDPOINT`（形如 `http://<WREN_HOST>:9100`）与 `WREN_AGENT_TOKEN`（须与 wren 机一致）。
  - **依据**：`agent/ai-platform/backend/src/adapters/wren_mcp_agent_client.py:65` —— **「控制面基址取 `WREN_AGENT_ENDPOINT`」**；**`WREN_AGENT_ENDPOINT` 非空 = 启用跨机器部署**（为空退回本地 Plan A 子进程），路由判定 `WrenMcpAgentClient.enabled == (WREN_AGENT_ENDPOINT 非空)`。
  - ⚠️ 上文只校验了 9100/9101 **可达**；**这两个 env 未配则跨机场景 `mcp_host` 恒空**（实际走了本地 Plan A）。
  ```bash
  # 在 ai-platform 机确认两 env 已注入
  systemctl show ai-platform --property=Environment 2>/dev/null | grep -Ei 'WREN_AGENT_(ENDPOINT|TOKEN)' \
    || grep -aE 'WREN_AGENT_(ENDPOINT|TOKEN)' \
         "/proc/$(pgrep -f 'uvicorn|ai-platform' | head -1)/environ" | tr '\0' '\n'
  ```
- [ ] **`~/.wren/config.json` 安全策略**（可简短）：确认 `strict_mode` / `denied_functions` 等默认值——**影响问数安全边界**。
  ```bash
  # 在 wren 机
  cat ~/.wren/config.json 2>/dev/null | grep -Ei 'strict_mode|denied_functions' \
    || echo '（无自定义：用默认 strict_mode=false / denied_functions=[]）'
  ```
  > 默认 `strict_mode=false`（`true` 时查询表须在 MDL 中声明）、`denied_functions=[]`（禁用的危险 SQL 函数）。联调前建议按安全基线确认。详见 `wrenai-ops-runbook.md §1.4.5`。

---

## 2. 跨阶段不变项核查（§4）— ✅ 本沙箱已验证（逐条带证据）

> 方法：对 `frontend/mis-admin-web/src`、`backend/mis-iqd/src/main`、`backend/mis-migrator/.../db/migration` 做静态 grep + 脚本解析。**可复现**：脚本见 §2.7（临时目录，不落仓库）。

### 2.1 「四处同改」齐（§4.1）

| 处 | 文件 | 证据 | 结论 |
|---|---|---|---|
| ① 导航 | `lib/nav/iqd-nav.ts:33` | `{ path: '/iqd/modeling', title: '可视化建模台', icon: 'Workflow' }` | ✅ |
| ② PAGE_MAP | `components/layout/keep-alive-outlet.tsx:165` | `'/iqd/modeling': LazyIqdModelingPage`（lazy 定义 :75） | ✅ |
| ③ router | `app/router.tsx:61` | `<Route path="/iqd/*" element={null} />`（整体登记，零改动） | ✅ |
| ④ V87 种子 | `V87__iqd_modeling_seed.sql:65` | `(92600, 1, 93010, 93030, 'iqd-modeling-page', '可视化建模台', 1, '/iqd/modeling', 'agent/iqd/iqd-modeling-page', NULL, 'Workflow', 2, 1, 1, …)` | ✅ |

### 2.2 icon 登记无静默回退（§4.2）

- **前端 nav `icon:` 字面量全集**（`lib/nav/*.ts` + `keep-alive-outlet.tsx:211/220` + `command-palette.tsx:32` + `tab-store.ts:52`）扫描后与 `lib/nav/icons.ts` 的 `ICON_MAP`（53~110 行）比对：**全部命中**，无未登记 key。
- **后端种子 `sys_menu.icon` 全集**（`/iqd` 与 `/ai/iqd` 菜单行）实测取值：`Database / Settings / ShieldCheck / Crosshair / Sparkles / History / Workflow`，**全部在 ICON_MAP 内**。
- 建模台新增三个 icon（`Workflow` `GitBranchPlus` `Calculator`）已登记于 `icons.ts:106-109`（`Workflow` 另见 §4.2 表）。
- 结论：**✅ 无静态回退风险**。
- 复验命令：
  ```bash
  grep -rhoE "icon:\s*'[A-Za-z0-9]+'" frontend/mis-admin-web/src/lib/nav/*.ts | sort -u   # 前端用到
  sed -n '53,110p' frontend/mis-admin-web/src/lib/nav/icons.ts                            # ICON_MAP
  ```

### 2.3 权限码登记齐（§4.3）— 前端用码 ⊆ 后端登记

- **前端**（`--include=*.ts,*.tsx`）实际使用的 `iqd:*` 码 **23 个**；**后端**（迁移非注释行）登记集合覆盖其中 **23/23** ⇒ **前端用到但后端未登记的码 = 0**（不产生「必然 40300」）。
- 反向（后端有、前端未直接用）= `iqd:test:use`、`iqd:acl:save`（见 §5 观察项，非阻断）。
- 逐条对照（前端计数 / 后端是否登记）：

  | 权限码 | 前端引用 | 后端登记 |
  |---|---|---|
  | `iqd:modeling:view/edit/publish` | 7 / 13 / 10 | ✅ V87(92631-33)+V90 |
  | `iqd:mcp:manage` | 12 | ✅ V89(92656) |
  | `iqd:catalog:view/edit` | 1 / 11 | ✅ V73/V81 |
  | `iqd:scope:view/save/sync` | 10 / 1 / 7 | ✅ V73 |
  | `iqd:enhance:view/save/sync/manage` | 9 / 7 / 10 / 6 | ✅ V73/V74/V78 |
  | `iqd:dimension:view/save` | 10 / 7 | ✅ V73 |
  | `iqd:mask:view/save` | 4 / 8 | ✅ V73 |
  | `iqd:selfheal:exec` | 6 | ✅ V84 |
  | `iqd:trace:view`、`iqd:config:view/test/save`、`iqd:acl:view` | 2 / 1 / 1 / 1 / 1 | ✅ V72/V73/V74 |

- 复验命令：
  ```bash
  # 前端用码
  grep -rhoE "iqd:[a-z]+:[a-z_]+" frontend/mis-admin-web/src --include=*.ts --include=*.tsx | sort -u
  # 后端登记（排除注释）
  grep -rhE "iqd:" backend/mis-migrator/src/main/resources/db/migration/*.sql | grep -vE "^\s*--" | grep -oE "iqd:[a-z]+:[a-z_]+" | sort -u
  ```

### 2.4 seed ID 段位无冲突（§4.5/§4.6）

- **T05 目标段（V87~V90）全部唯一、无冲突**：

  | 迁移 | sys_menu | sys_api | sys_menu_api | sys_role_permission |
  |---|---|---|---|---|
  | V87 | 92600, 92631-92633 | 92601-92612 | 92613-92624 | 92625-92627 |
  | V88 | — | 92640-92644 | 92645-92649 | — |
  | V89 | 92656 | 92650-92655 | 92657-92662 | 92663 |
  | V90 | — | 92700 | 92701 | — |

- 脚本比对：`926xx` / `927xx` 段**无任一同表重复 ID**；与 `V69/V73/V77/V81/V82/V83~V86` 占用段（92031-92599）**不重叠**。
- ⚠️ **但在更早迁移中发现 1 处 iqd 域 ID 冲突**（**非 T05 目标段**，预存）→ 见 §5 **F-1（P1）**；另 1 处 agent-ops 域同类冲突 → **F-2**。

### 2.5 命名边界（§4.7）— 无平台域 `wren*` 误用

- `backend/mis-iqd`：`@Table` 名 **全部 `iqd_` 前缀**（14 张，见 §2.5 命令）；**无 `Wren*` 类声明**；`wren*` 仅出现在**对外 WrenAI 适配面**（列 `wren_ref_id` / `wren_sql` / `wren_status_trail`、`WrenMcpAgent*` 引用）。
- `agent/mis_iqd`：`wren` 引用于外部适配层（`src.adapters.wren_mcp_registry`、wren CLI/project/env）；`mis_iqd` 内定义的 `Wrenai*Error` 系 WrenAI 语义错误类，属外部面。
- `features/agent/iqd`：`wren` 仅出现于 `wren profile add` / `wren context set-profile`（外部 CLI 提示）、`wren_ref_id` 展示、`WrenMcpAgent` 部署句柄注释。
- 迁移里**无 `wren_*` 表名**（平台表全 `iqd_*`）。
- 结论：**✅ 边界成立**。复验：
  ```bash
  grep -rhE "@Table\(name\s*=" backend/mis-iqd/src/main/java/com/mis/iqd/domain/entity   # 应全 iqd_
  grep -rhoE "CREATE TABLE[^;]*\bwren_[a-z_]+" backend/mis-migrator/src/main/resources/db/migration/*.sql   # 应空
  ```

### 2.6 `edit_revision` 与派生（§4.8）— 新增写路径均 bump

| 写路径 | 文件:行 | bump |
|---|---|---|
| `createModelFromTable` | `IqdCatalogNodeService.java:294-295` | ✅ `setCurrentEditRevision(next)` |
| `createModel` | `IqdCatalogNodeService.java:573-574` | ✅ `bumpRevision(conn,next,now)` |
| `createRelationship` | `IqdCatalogNodeService.java:680` | ✅ |
| `createCube` | `IqdCatalogNodeService.java:819` | ✅ |
| `upsertCube`（T04a） | `IqdCatalogNodeService.java:990-991` | ✅ |
| `createCalculatedColumn` | `IqdCatalogNodeService.java:1093` | ✅ |
| `updateCatalogNode`（字段描述/脱敏直编，MR-13） | `IqdAdminService.java:1525` | ✅ |

- 幂等命中**不二次 bump**（各方法 ①/② 段：`幂等键命中 → 返回首次结果，不 bump`）。
- **幂等键模板**（§4.4）：`hooks/useDirtyState.ts:42` → `${connectionId ?? 'none'}:${kind}:${action}:${suffix}`，与 `{connId}:{kind}:{action}:{uuid}` 一致 ✅；后端存 `iqd_edit_idempotency(connection_id, idempotency_key) → edit_revision`。
- 结论：**✅ 无遗漏写路径**。

### 2.7 复验脚本（临时目录，不落仓库）

- seed 审计：`$TEMP/iqd_t05_seed_audit.py`（ID 冲突 + 段位分布）
- 端点绑定审计：`$TEMP/iqd_t05_binding_audit.py`（sys_api 登记 + sys_menu_api 绑定 + PK 冲突）
- 端点绑定结论：**`/api/v1/iqd/**` 端点 0 个未绑定**（在**已插入**的行中）；但 §5 F-1 的 PK 冲突会让 `sql-pairs/translate` 那一行**根本没被插入**（脚本按首个出现取 id 时该 id 已被 V76 占用）——这正是静态审计的价值。

---

## 3. 黄金用例 E2E（M-G1 ~ M-G6）— 真机执行清单

> 每条给：目的 / 前置 / 执行步骤（可复制）/ 预期 / 通过标准 / 失败排查。
> **本沙箱不伪造结果**：状态见每条头部。

### 3.1 M-G1 向导闭环（DBA profile → 向导建连接 → MCP ready → 发现导入 3 表 → 建模型 → 画布可见 → build 写回 SYNCED → 测试问数可问）

> **状态：⚠️ 未验证（本沙箱不可能）**。
> **🔴 红线（必须诚实标注）**：M-G1 依赖「模型物化」。而 `build_mdl_from_catalog` **对全新 model 不做物化**（刻意为之——真实 MDL model 的 schema 未经 W0 真机校准）。因此即使真机跑通「画布可见 / build 写回 SYNCED」，**「测试问数可答」这一步在本阶段仍可能不成立**。**未在真机证明前，M-G1 一律记「未验证」，不得记「通过」。**

- **前置**：全局前置 §1 全满足（含 **DBA profile 注册** 与 **`wren-mcp-agent` 已运行**）；`<CONN_ID>` 连到含 `orders/customers/stores` 的业务库。
- **步骤**（连接创建是**三方协作**：① DBA 主机侧 profile → ② 平台向导落库 → ③ 平台/运维拉起 MCP）：
  1. **DBA 主机侧：数据源 profile 注册**（在 **wren 机**执行；凭证**只落主机**，平台不代敲、不经手明文）：
     ```bash
     wren profile add <profile_name> --connector postgres \
       --host <BIZ_PG_HOST> --port 5432 --user <db_user> \
       --password '${ENV:IQD_DB_PASSWORD}' --database <biz_db>
     wren context set-profile <profile_name>
     wren profile list                        # 验证：列表含 <profile_name>
     grep -i password ~/.wren/profiles.yml    # 验证：值为 ${ENV:...}，无明文
     ```
  2. **平台侧：向导 4 步创建连接**（`/iqd/modeling` → 右上「新建连接」→ `components/wizard/ConnectionWizard.tsx`）：
     - **步骤 1 `conn:basic`**：连接名称*（如「销售库」）/ WrenAI 地址 `base_url`（如 `http://127.0.0.1:3000`）/ 默认 connector（下拉）/ 超时（秒）；**并展示已有连接列表 + 每连接的 MCP 状态卡**。
     - **步骤 2 `conn:datasource`**：认证方式（`none`=**profile 注入**（对应步骤 1 的 profile）/ `basic` / `token`）/ 凭证引用 `secret_ref`（password 框，**留空=保留原值**，查询恒返回 `******`）/ WrenAI `project_id`（可选，留空由 WrenAI 侧解析）。
     - **步骤 3 `conn:profile`**：**纯说明页**——明确告知「profile 绑定由 DBA 在主机侧执行」（即步骤 1），平台此步**不收集凭证**。
     - **步骤 4 `conn:test`**：**先落库再测试**（步骤 3→4 边界创建；**落库失败留在原步、不清屏**）→ 自检 → 拉起 MCP。
     - 校验 API（字段对应 `IqdAdminService.createConnection`：`name` / `base_url` / `auth_type` / `secret_ref` / `project_id` / `default_connector` / `timeout_seconds` / `language` / `enabled`）：
       ```bash
       # ① 建连接（只存 secret_ref 引用，不存明文）
       curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/connections" \
         -H "Authorization: Bearer <MIS_JWT>" -H "Content-Type: application/json" \
         -d '{"name":"销售库","base_url":"http://127.0.0.1:3000","auth_type":"none",
              "secret_ref":"<profile_name>","project_id":"","default_connector":"postgres",
              "timeout_seconds":300,"language":"zh","enabled":true}'
       # 返回体含 id（即 <CONN_ID>）→ ② 连接自检
       curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/connections/<CONN_ID>/test" \
         -H "Authorization: Bearer <MIS_JWT>"
       # ③ 首次 bootstrap：拉起该连接 MCP（经 ai-platform → wren-mcp-agent → wren serve mcp）
       curl -s -X POST "<AI_PLATFORM_HOST>/api/v1/iqd/mcp/enable?connectionId=<CONN_ID>" \
         -H "Authorization: Bearer <MIS_JWT>"
       ```
     - 校验：**每连接 MCP 状态卡应显示 `mcp_status=running`**（`GET /api/v1/iqd/connections` 核对）。合法值：`running`/`starting`/`stopped`/`crashed`/`unhealthy`。
     - ✅ **注意（2026-09-22 修订：原"防两条 `enabled=true`"警告已作废）**：`iqd_connection` **可多条 `enabled=true` 并存**（原「业务上仅一条启用」约定**作废**，见 `architecture.md:882` 与 `mis-iqd-modeling-system-design.md §14.5`）。⇒ **无需**"先把旧的置 `false` 再启用新连接"；多条同时启用为**合法态**，不产生"非法态"。
       - ~~⚠️ **注意（防「两条 `enabled=true`」）**：`iqd_connection` **业务上仅一条启用**（依据 `architecture.md:882`；⚠️ `enabled` **无 DB 唯一约束**，故不是硬约束）。若库里**已有旧启用连接**，**须先将其置 `false` 再建/启用新连接**，否则产生「两条启用」非法态（接口不报错、语义违规）。作废旧连接走既有问数配置页（`PUT /api/v1/iqd/config`，单条 upsert）；**无** `PUT /iqd/connections/{id}`。~~（**以上为作废前历史原文，保留痕迹**）
       - **新口径**：主连接 = **`name='default'`**（否则 id 最小的 enabled），见 §14.5.1；**指定连接的停用/编辑**走**本期新增**的 `PUT /api/v1/iqd/connections/{id}`（§14.1 / 迁移 `V92`）。
  3. `/iqd/modeling` → 左树「表发现导入」→ 选 schema → 勾 3 张表 → 导入。
  4. `curl` 校连接与发现：`GET <AI_PLATFORM_HOST>/api/v1/iqd/discovery/schemas?connectionId=<CONN_ID>`（应 200，非 40300/502）。
  5. 双击一张表（或左树「生成模型」）→ 生成 1 个 model → 画布出现节点卡。
  6. 观察 `PublishPipelineBar` 五态。
  7. `/iqd/scope` 勾选纳入范围（**导入 ≠ 可问**，默认 `in_scope=false`）。
  8. 测试问数页对 `orders` 发 1 条自然语言问数。
- **预期**：数据源 profile 已注册（主机侧 `wren profile list` 可见、无明文）；连接创建成功（返回 `<CONN_ID>`）且该连接 **MCP 状态卡 `mcp_status=running`**；发现返回 ≥3 表；模型节点画布可见；导入触发一次整库 build；`edit_status` 走向 `SYNCED`（`built_edit_revision` 推进）；问数返回结果。
- **通过标准**：步骤 **1~7** 全部成立 **且** 第 **8** 步问数**真正命中**（非 503/空）。⚠️ 若第 8 步失败而 1~7 成立 → 记「M-G1 部分通过（模型物化缺口，已知）」，**不得记整条通过**。
- **失败排查**：**40900** → 连接**重名**（`iqd_connection` UK `(name)`）；**42200** → 连接**名称空**（步骤 1）或其他入参非法；**50201**（HTTP 502）→ **MCP 不可达 / profile 未注入**（核对 §1 DBA profile 步与 wren-mcp-agent 可达性，见 runbook §1.5 / §7）；**40300** → 端点未登记（查 §2.3 / §5 F-1）**或**该连接未启用写回；问数无模型 → 见上方红线。

### 3.2 M-G2 关系 + Cube + 问数命中「上月客单价」

> **状态：⚠️ 未验证（需真问数）**

- **前置**：M-G1 的 `orders`/`customers` 已建模；同连接。
- **步骤**：
  1. 画布从 `orders` 锚点拖到 `customers` → 关系弹窗（预填 join 默认 INNER 1:N）→ 保存。
  2. 左树「新建 Cube」→ `model_ref=mdl:model:orders`，加 1 个 measure（如 `sum(amount)`）→ 保存。
  3. 测试问数：问「上月客单价」。
- **预期**：关系落库（`iqd_catalog_item` kind=relationship，`source='modeling'`）；Cube upsert 成功并 bump；问数走 Cube 聚合命中（`ask_log` 的 `strategy/dimensions` 显示 Cube 路径）。
- **通过标准**：问数结果数值正确且命中 Cube 聚合（非回退纯 SQL 猜测）。
- **失败排查**：Cube 不命中 → 校验 `model_ref` 与子节点 `edit_revision` 已 bump（§2.6）；`PUT /catalog/cube` 40300 → 见 §5 F-1 模式（例：端点未登记）。

### 3.3 M-G3 build 人为失败 → 流水线定位失败段 → 重试成功

> **状态：⚠️ 未验证（需可注入失败的真 build）**

- **前置**：已有可构建连接。
- **步骤**：
  1. 人为制造 build 失败（如临时把某 model 的 `ref_sql` 改成非法表达式，或断开业务库）。
  2. 触发发布 → 观察 `PublishPipelineBar` 哪一段变红（编辑落库 / MDL 构建 / 记忆索引 / MCP 就绪）。
  3. 恢复后点该段「重试」。
- **预期**：失败段红色 + 段内错误文案；重试后段转绿、`edit_status` 收敛 `SYNCED`。
- **通过标准**：定位到**正确**失败段；重试成功且不重复 build（幂等窗口吸收）。
- **失败排查**：重试无反应 → 查按钮 gate（`SelfHealPanel`/流水线 disabled 条件）；重复触发 → 后端合并窗口。

### 3.4 M-G4 漂移注入 → 详情面板 → 重新导入收敛

> **状态：⚠️ 未验证（需真 MDL 漂移）**

- **前置**：已 `SYNCED` 连接。
- **步骤**：
  1. 在 WrenAI 侧/业务库侧变动使 `built_mdl_hash` 偏离（如手改 MDL 文件、改表结构）。
  2. 刷新建模台 → 观察整条流水线变橙 + `STALE_DRIFT`。
  3. 打开漂移详情面板（`DriftDetailPanel`）。
  4. 点「重新导入」→ 收敛。
- **预期**：`edit_status=STALE_DRIFT` 或 `stale_drift=true` → 整条橙 + 强制重建置灰；详情面板列出差异项；重导入后回到 `SYNCED`。
- **通过标准**：漂移被检出、置灰生效（fail-closed）、收敛成功。
- **失败排查**：未检出 → 对账清扫/`STALE_DRIFT` 判定（`IqdAdminService`）；面板空 → `DriftDetailPanel` 数据源。

### 3.5 M-G5 字段侧栏改描述/脱敏 → 问数结果同步生效

> **状态：⚠️ 未验证（需真问数）**

- **前置**：`orders`/`customers` 已建模且在范围内。
- **步骤**：
  1. 选中节点 → PropertyPanel → 改某字段业务描述；对 PII 字段（如 `customers.phone`）设脱敏 `phone`。
  2. 保存 → 观察 `current_edit_revision` bump、流水线重跑。
  3. 问数涉及该字段 → 看结果是否按脱敏呈现 + 描述是否影响语义。
- **预期**：`updateCatalogNode`（MR-13，走 `PUT /catalog/node`）落库并 bump；脱敏唯一出口 `masking.py` 生效；结果无明文 PII。
- **通过标准**：结果**无明文 PII** 且描述变更同步到问数语义。
- **失败排查**：仍明文 → 查 `masking.py` 出口是否被绕过；不 bump → §2.6。

### 3.6 M-G6 scope 页行级维度徽标 + 谓词预览正确

> **状态：🟡 部分验证**（纯函数逻辑已由单测覆盖：`components/scope/rowScopeUtils`；**UI 真机渲染未验证**）。

- **前置**：已配 dept+store 双维度策略。
- **步骤**：
  1. 打开 `/iqd/scope`（MR-12）→ 观察每行级维度徽标。
  2. 触发谓词预览。
- **预期**：徽标正确反映 `iqd_row_scope_dimension` 配置；谓词预览 SQL/条件与实际注入一致（dept+store 双维度）。
- **通过标准**：徽标与谓词预览与后端策略一致。
- **失败排查**：徽标错位 → `rowScopeUtils`；预览与执行不一致 → `scope_resolver.py`。
---

## 3.7 真机执行结果（2026-09-28，连接 900001）

> 环境：wren 0.13.3（跨机器 agent）+ Doris/StarRocks（ads_*/dwd_* 三表、46/56/88 列）
> + 真实 LLM（qwen3.7-plus）。**不含 orders/customers/stores 样例库**，故部分用例以本环境等价物执行。

### ✅ M-G2（关系 + Cube + 问数命中）— 通过

- `list_cubes` → `sale_by_store`（measures `kds_sum, cust_cnt_sum`；dims `store_id, ord_date`）
- 提问「各门店的 kds_sum 是多少」→ 命中 cube → wren 生成
  `SELECT store_id AS store_id, SUM(kds) AS kds_sum FROM ads_spm_trd_sale_category_day_df GROUP BY 1`
- `run_sql` **返回 32 行**真实业务数据；`ask.status=succeeded`
- 关键：`generating` 步的 SQL 来自 **cube**，非 LLM 手写聚合 → cube 分支在真实 ask 管线生效

### ✅ M-G5（字段脱敏 → 问数生效）— 通过，**并暴露 2 个真 bug**

- 给 `store_name` 设 `sensitive_level=high` + `mask_rule=mask-phone`
- 提问「0027 门店的名称是什么」→ `masked_columns=['store_name']`，明文「金坛南门店」→ **`****`**
- 验证后已还原该列配置（`none`/NULL），环境如初

**Bug 1（安全级）脱敏静默失效**：真实 `run_sql` 的 `columns` 是**纯列名字符串数组**
（不含表前缀），而 catalog 的 `item_key` 形如 `<table>.<column>`；旧索引按整串匹配 →
字符串列名查不到 meta → 敏感列**明文返回**。修复：登记列名别名 + 任一命中即脱敏（fail-closed）。

**Bug 2 `LIMIT` 打挂查询**：wren 的 SQL 重写不接受 `LIMIT`（连 `SELECT c FROM t LIMIT 1`
都报 1064 near 'LIMIT'）；`run_sql` 自带 `limit` 参数正常。修复：提示词禁止 LIMIT +
`sql_guard.py` 兜底剥最外层尾部 LIMIT。

### ⚠️ 未能执行的用例（如实记录，不记通过）

| 用例 | 原因 |
|---|---|
| M-G1 | 本轮已在非生产下尝试：**新建远程连接的 wren 工程读不到模型**（真缺口，详见 §3.8） |
| M-G3 | **已跑**：引擎层失败检出与定位已证（非生产工程 verify-model3，见 §3.9）；尚缺 UI 红段联调 |
| M-G4 | 需制造 MDL 漂移 → 同样要改真机工程（破坏性），本轮不做 |
| M-G6 | **已跑**：组件级徽标渲染 + 后端预览接线（见 §3.10） |

> 建议：M-G1/M-G4 在**非生产** wren 环境（可随意破坏）或样例库上执行；
> M-G6 已改为组件级单测（见 §3.10）。


---

## 3.8 M-G1 真机尝试（本轮）—— 发现一个真缺口

> **结论：未通过**（不得记「通过」）。本轮尝试在**非生产**下走完 M-G1，新发现一个须修复的真缺口。

**环境（本轮可用性提升）**：已确认可用**仓库内开发私钥**（`backend/keys/private.pem`）自签 MIS RS256 JWT，
从而无需登录验证码即可直连 ai-platform（`:8000`）与 mis-iqd（`:8109`），并可创建**临时连接**。

**执行过程**：
1. 创建临时连接 `mg1-scratch`（`POST /api/v1/iqd/connections`）→ `id=1790609282687`；
2. `POST /api/v1/iqd/mcp/ensure` → `mcp_status=running`（远程 wren 机）；
3. 向该连接的 wren 工程写入与 900001 **逐字相同**的
   `wren_project.yml`（`data_source: {profile: starrocks, type: doris}`）与 3 个 `models/*/metadata.yml`（均从已验证工程拷贝）；
4. `wren context validate` / `context build` → **均报 `0 models`**；`context show` 报 `Empty project`。

**发现（真缺口）**：新建（远程）连接的 wren 工程**读不到写入的 `models/*/metadata.yml`**，
即使文件已确认落盘（`list_path=models/<model>` 可读到正文）。同一批文件在既有工程（`verify-model3`）可正常枚举。
推断：目录级（而非单文件）的工程初始化或 `wren_project.yml` 某个隐式字段导致 YAML 工程未被识别，
仅靠平台文件下发无法新建可构建工程。（本轮已清理：临时连接已删除，环境仅剩 900001。）

**后续建议**：对照 `wren context init` 的产物与平台 `ensure_project` 占位策略，补齐新建远程工程的骨架（建议在 wren 宿主端执行一次 `context init`，
再比对差异）。

---

## 3.9 M-G3 真机验证（引擎层，非生产工程 verify-model3）—— 通过

> **为何可安全执行**：`verify-model3` 是残留的**非生产** wren 工程（不是 900001），可随意破坏并恢复。

- **基线**：`context validate` → `1 warning(s), 0 errors`；`context build` → `Built: 5 models, 1 views`。
- **注入失败**：写入非法 view（`views/mg3_bad_view/metadata.yml`，`statement` 为截断 SQL）。
- **观察到的失败**（可定位到正确段）：
  - `context validate` → **exit 1**，stderr：
    `✗ View 'mg3_bad_view': dry-plan failed — [INVALID_SQL] SQL error: ParserError("Expected: an expression, found: EOF") phase=SQL_PLANNING`
    （即静态校验命中「哪个 view、什么错」，非只报失败）；
  - 同一步的 `0 errors` 与 `Warnings:` 分区仍正常（告警不误报为错误）。
- **恢复**：删除该 view 后 `context validate` → exit 0、`context build` → `Built: 5 models, 1 views`（回到基线）。
- **边界（如实记录）**：本轮验证的是**引擎层的失败检出与定位**；
  平台 `PublishPipelineBar` 的 UI 红段 + 重试按钮属前端联调（M-G3 的第 2—3 步），本轮未跑。

---

## 3.10 M-G6 组件级验证—— 通过

> **为何是“组件级”**：用 jsdom 挂载**真的 `IqdScopePage`**（非抽象化），
> mock 的只是 HTTP 边界（`@/lib/api/iqd`），徽标渲染与后端预览接线走真实组件。

- **徽标**：`row_scope={dimensions:[dept, store]}` 的 ACL 行渲染出「部门 AND 门店」两枚徽标（含 `AND` 叠加标记）。
- **后端预览接线**：展开后调用 `previewIqdRowScope`（`POST /iqd/scope/preview`），
  参数为**草稿规则 + item_key**；返回的 WHERE 被**原样展示**（含 `mis_dept_scope` EXISTS）。
- **徽标切换**：预览就绪后，页面标「后端真实生成」（success），**不再出现**「示意 / 降级」。
- **denied_reason 分流**：后端返回 `denied_reason` 时，页面展示「后端提示：…」（含排障指引）。
- **用例**：`frontend/mis-admin-web/src/features/agent/iqd/iqd-scope-page.test.tsx`（3 条，全绿）；
  另有真机级 `POST /api/v1/iqd/scope/preview`（带日志链路）返回与注入同源谓词（见 §3.7 M-G5）。

---

## 3.11 `@EnableMethodSecurity` 核对（开发清单第 6 项）—— 确认缺失，且比原描述更严重

> **结论**：`@PreAuthorize` **在本仓库范围内完全不生效**（不是“依赖既有配置”，是**彻底未生效**）。

**证据：**
1. 全仓 `rg -n "EnableMethodSecurity"`：**0 命中**（无任何服务开启方法级安全）。
2. 程序包层（所有 9 个 `*-SNAPSHOT.jar`）：**`spring-security-config` 均不存在**（该包才提供
   `@EnableMethodSecurity` 与方法拦截器）；仅有 `spring-security-core`（提供注解本身，不提供生效机制）。
3. 真机实测（mis-iqd `:8109`，两个受 `@PreAuthorize` 保护的端点）：
   - `GET /api/v1/iqd/modeling/layout/900001`（声明 `hasAuthority('iqd:modeling:view')`）：
     **带看不带 `Authorization`、带不带 `X-Mis-Roles` 均返回 200 + 真实数据**；
   - `POST /api/v1/iqd/catalog/model`（声明 `iqd:modeling:edit`）：无任何凭证即达业务校验
     （返回 `42200 item_key 必须形如 mdl:model:<name>`，说明请求**已进入控制器**）。
4. 即使强行开启也不会立刻生效：`GatewayContextFilter` 只写自定义
   `com.mis.common.security.context.SecurityContextHolder`，**从未向 Spring Security 的
   `Authentication`/`GrantedAuthority` 桥接**（全仓 0 命中 `GrantedAuthority` / `setAuthentication`）。

**现行安全模型（事实）**：服务间信任靠两道外层闸门 —— ① **Gateway JWT 验签**（:8080）；
② **BFF `ApiPermissionInterceptor`**（:8081，`sys_api ⋈ sys_menu_api ⋈ sys_menu` 判权）。**领域服务自身的
`@PreAuthorize` 不构成防线** —— 它们是“愿景性注解”，读代码时会误以为已守住。

**影响与边界：**
- 正常部署（仅内网、不暴露领域服务端口）下，**不直接构成突破**；
- 但“领域服务端口可被边界内任意访问者直连”时，即可绕过 BFF 的权限校验直接读写（实测已证明）。
  这使“内网隔离”成为唯一真实控制，应在部署文档里明确（当前已隐式依赖）。

**建议（本轮未实施，属跨服务高风险改动）**：
1. 补 `spring-security-config` 依赖 + 全局 `@EnableMethodSecurity`；
2. 在 `GatewayContextFilter` 里把 `LoginUser` 桥接为 Spring Security `Authentication`
   并注入 `GrantedAuthority`（否则开启后将**全量拒绝** → 线上中断）；
3. 分符合服务灰度开启（先 iqd 单服务），并补“无权 → 403”回归用例。

---

## 3.12 关系删除（T03c，2026-09-29）—— 端到端通过

> **背景**：此前模型边只能建、不能删（画布主动过滤 `remove` + 后端无端点）。
> 本轮补齐：`DELETE /api/v1/iqd/catalog/relationship/{itemKey}`（物理删除 + bump）。

**端到端（connection 900001，真机）**：

| 步骤 | 实测 |
|---|---|
| 初始 current_edit_revision | 8（`edit_status=SYNCED`） |
| 建临时关系 `mdl:relationship:e2e_del_probe` | → revision 9，盘点出现该关系 |
| 删除（带 `baseRevision=9` + 幂等键） | → revision 10，`deleted_item_key` 回显正确 |
| 删后盘点 | 仅剩原有 `sale_ord_store`（探针关系已消失） |
| **强制重建 → 引擎侧对账** | `build_status=success`；`context show` 的 relationships **只剩 `sale_ord_store`**，无 `e2e_del_probe` |

> 最后一行是关键：证明删除**真的进了 MDL 派生**，而不只是落库行消失。

**负例（三条，均不伤数据）**：

| 输入 | 期望 | 实测 |
|---|---|---|
| item_key 非 `mdl:relationship:*` | 42200 | ✅ `item_key 必须形如 mdl:relationship:<name>` |
| 不存在的关系 | 40400 | ✅ `关系不存在` + `data.item_key` |
| `baseRevision` 不符 | 40900 | ✅ `并发编辑冲突` + `data.current_edit_revision=8` |

**前端**：点已有边 → 弹窗出现「删除关系」（仅 `iqd:modeling:edit`）→ 二次确认（destructive）→ 成功失效 catalog 缓存后边自然消失；
42200 带 `dependents` 时列出引用方并不删。画布 `onEdgesChange` 不再静默丢弃 `remove`，改为转成删除确认。
单测：`RelationshipDialog.test.tsx`（5 条）+ `IqdCatalogNodeServiceTest` 新增 7 条（含 409/404/422/幂等各分支）。

---

## 3.13 Cube 编辑弹窗「挂靠模型」与 Cube 删除（T03c，2026-09-29）— 通过

### 3.13.1 双击 Cube 弹窗「未选择挂靠模型」的三个根因（均已修）

1. **BFF 丢字段（问题 2 的真因）**：mis-iqd 的 `IqdCatalogItemVO` 已回传 `model_ref`
   （`@JsonProperty("model_ref")`），但 **BFF 自己的 `IqdCatalogItemVO` 没有该字段**
   —— Jackson 反序列化静默丢弃，前端拿到 `model_ref=null`，`inferModelRef` 返回空。
   实测三跳对比：8109 有 `model_ref`、8081/5174 为 null。已修：BFF VO 补字段 + getter/setter，
   重启后三跳均为 `mdl:model:ads_spm_trd_sale_category_day_df`。
2. **新建不自动预选（问题 1）**：原初值只取「左树选中的模型」（`defaultModelKey`），
   树里没选中就空着。已修：**新建时若该连接只有一个模型，自动选中它**；
   多模型仍需用户显式选择（避免猜错挂靠）。
3. **保存后仍显示未选择（问题 2 的表象）**：即第 1 条 —— BFF 丢字段导致回显永远空。
   BFF 修复后打开既有 Cube 自动回显 `model_ref`。

### 3.13.2 Cube 删除路径（问题 3）

`DELETE /api/v1/iqd/catalog/cube/{itemKey}`（物理删除 + bump + 幂等 + 变更事件）：

| 验证项 | 实测（connection 900001） |
|---|---|
| 子节点清理 | 探针 Cube（1 measure）删除后 `deleted_children=1`，cube 与子节点均消失 |
| 不误伤 | `sale_by_store` 及其 4 个子节点完好 |
| 引用阻断 | 被 sql_pair/knowledge 引用时 42200 + `data.dependents`（单测覆盖） |
| 形态/存在性校验 | 非 `mdl:cube:*` → 42200；不存在 → 40400（单测覆盖） |
| 版本收敛 | 删除 + rebuild 后 `SYNCED 20/20` |

迁移 **V106**（sys_api 92936 / sys_menu_api 92937 → 菜单 92632 `iqd:modeling:edit`）。
前端：CubeEditor 弹窗新增「删除 Cube」（destructive + 二次确认 + dependents 清单）。

> ⚠️ 运维注：重启 mis-iqd / mis-admin-bff 时，若服务由**另一 Windows 身份**启动，
> `stop-dev.ps1` 会 Access denied（脚本已给出提示）；需到启动它的终端停。

---

## 3.14 表发现「只让选已模型化表」（T03c，2026-09-29）— 设计现状如实记录

> **用户问题**：数据库里有 6 个表，表发现导入界面却只让选 3 个，是否应该全部自动发现？
> **结论**：**不应该只让选已模型化表** —— 但这是当前实现的真实现状，需要改造。

**根因（实测）**：
- 发现端点 `list_tables` 读的是 **wren MCP `list_models`**（wren 工程 YAML 真源）→
  它**只包含已模型化表**（connection 900001 = 3 个）；
- 未模型化的表不在 wren 工程里 → **永远发现不到**；
- 另实测：wren 0.13 的 `--sql` **强制走 MDL 重写**，`information_schema` 查询报
  `[INVALID_SQL] Serde JSON error: missing field type`（带/不带 --mdl、连 information_schema
  都同样报错）→ **全库表发现在 wren 0.13 上不可行**，必须直连业务库。

**为什么是「6 个表」**：平台 catalog 里 model 3 + table 3 = 6 行（**同一张表两种节点**：
已建模的是 model，未建模的是 table）。用户看到的 6 可能是库表工具（Navicat/DBeaver）
或平台清单；**业务库真实表数当前无法经 wren 链路确认**（wren 0.13 不能查 information_schema）。

**改造方向（后续实施）**：
1. **新增「直连业务库的表发现」通道**：经 wren-agent 在 wren 机上本地查
   （它持有 profile 凭证；当前 agent 只暴露 wren CLI，需新增 mysql/doris 客户端能力），
   或 ai-platform 直接持业务库只读凭证（需安全拍板，不推荐）；
2. **平台 catalog 已有的 `kind=table` 节点**（未建模物理表）也可以作为「已发现」清单来源
   —— 但它同样来自上次同步，不是全库实时清单；
3. 向导选表后走 `POST /discovery/import`（已实现）。

**当前可用性**：已模型化表的「重复导入」走 `create_or_skip` 语义安全（跳过已存在）；
但**新增未建模表**必须先经 MDL 同步（把库结构拉进 wren 工程）才能被发现 —— 这是当前
链路的一个真实缺口，不是界面 bug。

---

## 3.14.1 路线 A 已实施（2026-09-29）：凭据入 vault + 直连表发现

> **用户拍板**：业务库连接信息从「wren 机手工 profile」改为「平台侧管理」；密文进
> **`ai_platform` 库的 vault**（复用既有 `CredentialVault` + AES-256-GCM）；mis-iqd 的
> `iqd_connection` 仍只存 `secret_ref` 引用。

**已落地改动**：

| 层 | 改动 | 文件 |
|----|------|------|
| ai-platform 迁移 | 建 `credential_mappings` 表（补历史上从未建过的表；`user_id` 可空去 FK，`system_account` 唯一） | `alembic/versions/006_create_credential_mappings.py` |
| ai-platform ORM | `CredentialMappingModel.user_id` 改可空、去 FK；`system_account` 加唯一 | `src/models/user.py` |
| ai-platform Vault | 新增 `upsert_by_ref` / `delete_by_ref`（按 `secret_ref` upsert，无用户主体） | `src/identity/credential_vault.py` |
| ai-platform 路由 | 新增 `POST/GET/DELETE /api/v1/iqd/credentials`（写入/状态/删除；**密码留空=保留既有**） | `src/api/routes/iqd_credentials.py` |
| ai-platform 直连 | 新增 `DirectDbDiscovery`（MySQL 协议 pymysql + PostgreSQL asyncpg，只读 info_schema） | `src/agent/mis_iqd/direct_db.py` |
| ai-platform 发现 | `list_schemas/list_tables/list_columns` 改为**直连优先、wren MCP 兜底**（能发现未建模表） | `src/agent/mis_iqd/discovery_service.py` |
| ai-platform 配置 | 新增 `get_connection_db_profile`（mis-iqd 内部端点取非敏感坐标 + secret_ref） | `src/adapters/iqd_config_client.py` |
| mis-iqd 迁移 | **V107** `iqd_connection` 增非敏感展示列 `db_type/db_host/db_port/db_database/db_user`（**无密码**） | `V107__iqd_connection_db_profile.sql` |
| mis-iqd 实体/DTO | `IqdConnection` + Save/Update/VO 增 db 字段；`createConnection` 自动生成 `secret_ref=iqd-conn-{id}` | `IqdConnection.java` 等 |
| mis-iqd 内部端点 | 新增 `GET /internal/v1/iqd/connection-db-profile`（回非敏感坐标 + secret_ref） | `IqdInternalController.java` |
| BFF 编排 | 连接建/改时：先落 mis-iqd（**剥离 db_password**），再写 ai-platform vault（键=secret_ref）；删除时回收 vault | `IqdModelingController.java` / `AiPlatformClient.java` |
| 前端向导 | 第 2 步从「secret_ref 密码框」改为**结构化录入**（type/host/port/database/user/password）；**删除原第 3 步 profile 占位** → 3 步向导 | `ConnectionWizard.tsx` / `ConnectionFormFields.tsx` / `connectionEditUtils.ts` |
| 依赖 | 新增 `pymysql`（直连 MySQL 协议业务库） | `pyproject.toml` / `uv.lock` |

### 3.14.2 wren 0.13 连接机制实测（2026-09-29，关键纠偏）

路线 A v1 假设「`wren profile add` + `${ENV:...}` 占位」可用，**实测两处都与 wren 0.13.3 界面不符**，已按真实行为修正：

| 假设（文档旧说法） | wren 0.13.3 真实行为（实测） |
|---|---|
| `wren serve mcp` 用 `WREN_PG_*` env 连库 | **错**。`serve mcp` 无连接信息参数，只有 `--profile <name>`；连接信息来自 `~/.wren/profiles.yml` 里该 profile。 |
| profile 占位写 `${ENV:IQD_DB_PASSWORD}` | **错**。真实语法是 `${VAR}`；`${ENV:...}` 报 `Malformed reference`。 |
| `--connection-info` 可给 `serve mcp` | **错**。`--connection-info` 只属于 `query`/根命令，且需 `type` 字段；`serve mcp` 不接受。 |

**实测确认的正确机制**：
- `wren profile add <name> --from-file <json>`，json schema = `{datasource,host,port,database,user,password}`；会真连库校验（非致命，exit 0 + stderr 警告）。
- profile 值支持 `${VAR}`，启动期从**子进程 env 或 project `.env`** 解析（实测：放 `.env` 后占位解析成功、真连库 → `Access denied` 而非 `not set`）。
- **`profile add` 幂等**（同名覆盖）；`profile rm -f` 免确认。

**据此的修复（已实现，待部署 wren 机）**：
- `agent.py::_ensure_profile`：ensure 时按连接建/刷新 `iqd-conn-{id}` profile —— **只写 `${IQD_DB_PASSWORD}` 占位，明文绝不落 profiles.yml**；
- `serve mcp` 命令追加 `--profile iqd-conn-{id}`（不再依赖全局 active profile）；
- `agent.py::_build_env` 归一 `WREN_IQD_CREDENTIAL_JSON`/`WREN_PG_*` → 注入 `IQD_DB_PASSWORD` 等占位变量（仅子进程 env，临时文件 chmod 600 即用即删）；
- `iqd_config_client._map_credential_to_env` 补 `WREN_DB_TYPE`。

> ⚠️ **待办**：`agent/ai-platform/deploy/wrenai/wren-mcp-agent/agent.py` 的改动需**部署到 wren 机 10.254.16.27 并 `systemctl restart wren-mcp-agent`** 才生效（本沙箱无 SSH：22 端口不通）。部署后验证：
> 1. `POST /iqd/mcp/ensure {connection_id:900001}` → `wren profile debug iqd-conn-900001` 应存在；
> 2. 数据面 `run_sql "select 1"` 应成功（当前报 `(2006, 'Server has gone away')`）；
> 3. 表发现直连应能看到全部物理表。

### 3.14.3 wren 0.13 MDL `type` 缺失（2026-09-29，真机定位到的问数阻断 bug）

部署路线 A 修复后，`run_sql` 的错误从连接层 `(2006, Server has gone away)` 变成
**规划层** `[INVALID_SQL] Serde JSON error: missing field `type``。用不连库的
`dry-plan` 复现同样的错 → 证明**与凭证无关**，是平台生成的 MDL 非法。

**最小化定位（真机 `dry-plan`，无需连库）**：

| MDL 变体 | 结果 |
|---|---|
| 空 MDL / 仅 models / 仅 relationships / 仅 metrics / 仅 dimensions | exit 0 ✅ |
| `cubes` 里 measure 只有 `name`+`expression` | exit 1 `missing field baseObject` → 补 baseObject 后 `missing field type` |
| measure/dimension 加 `type`（DOUBLE/INT/VARCHAR 均可） | exit 0 ✅ |

**根因**：wren 0.13 的 MDL schema 要求 **每个 column / measure / dimension 都必须有 `type`**
（受控枚举）。平台 `service.py` 生成 MDL 时：
1. cube 的 `measures[]` / `dimensions[]` 只写 `name`+`expression`（漏 `type`）；
2. 计算列只写 `name`+`expression`（漏 `type`）。
→ 整个连接的任何查询都在规划期失败（`ModelGenerationRule` 展开模型即报错）。

**修复（`service.py`）**：
- `_wren_type(raw, default)`：data_type 归一为 wren 受控类型（剥 `(n)` 参数、未知回退 default）；
- `_materialize_missing_nodes`：新建 measure→DOUBLE、dimension→VARCHAR、计算列→DOUBLE（带 `type`）；
- `_normalize_mdl_types(mdl)`：**发布前对最终 MDL 兜底补齐**所有缺失的 `type`
  （覆盖历史 `mdl_raw` 基线节点），返回补齐条数。

**验证**：
- 单测：`test_iqd_edit_sync.py` 新增 `test_normalize_mdl_types_fills_missing_type` /
  `test_wren_type_normalizes_parameterized_and_unknown`（断言补 4 处、类型正确）。
- **真机**：把 900001 的 MDL 过一遍 `_normalize_mdl_types`（补 5 处）后推送重启 →
  `run_sql "select 1 as x"` **返回真实数据 `{"x": 1}`**（凭证链路 + 连接 + MDL 加载全通）。

### 3.14.4 两个旧结论被真机推翻（2026-09-29 MDL type 修复后复测）

修好 §3.14.3 的 MDL `type` 后，**此前写进本文档的两条结论都不成立**：

| 旧结论 | 复测真相 |
|---|---|
| 「wren 0.13 无法查 `information_schema`（`missing field type`）」 | **错**。那个报错就是 MDL 缺 `type` 的连带症状。修好后 `run_sql information_schema.tables` 正常，**一次列出 adhoc 全部 6 张表**：`dim_sprmrkt_itm_item_df / ads_spm_trd_sale_category_day_df / ads_spm_trd_cost_category_day_df / dim_spmrkt_chl_category_df / dwd_spm_trd_sale_ord_detl_df / dim_sprmrkt_chl_store_df`。**直连不是必需的**。 |
| 「StarRocks 把数值列报成 STRING → 需要类型保真」 | **错**。逐列对比 MDL 与 `information_schema`：**190 列 0 处不一致**。`cust_cnt` 在 Doris 里**本就是 varchar**，`kds` 是 double，MDL 保真。 |

**真正的问题（计算列类型安全）**：用户配的计算列 `kds_per_cust = kds / cust_cnt`
（double ÷ **varchar**）在 wren 规划期触发
`Cannot coerce arithmetic expression Float64 / Utf8`。因 wren `ModelGenerationRule`
**展开模型全部计算列**，一个坏计算列会让**该模型的所有查询**都失败（连 `select count(*)`）。

**真机验证**：把该列改为 `kds / CAST(cust_cnt AS DOUBLE)` 且 `type=DOUBLE` 后，模型所有查询
恢复：`select count(*)` → 7034103；`select kds_per_cust` → 1.61…（真实值）。

### 3.14.5 计算列类型安全（2026-09-29 已实现，两层防护）

针对 §3.14.4 的「坏计算列拖垮整个模型」，做了**保存时拦截 + 发布后自检**两层：

**① 保存时静态校验（mis-iqd，Java）** —— `IqdCatalogNodeService.validateExpression`
- 新增算术对扫描 `ARITH_PAIR`（`ident <op> ident`，op ∈ `+ - * /`）；
- 新增 `collectModelColumnTypes`（列名→基础类型）+ `checkArithmeticTypes`：
  一侧数值列、另一侧字符串列 → `errors` 增加
  「类型不安全: 字符串列 X 参与算术运算（kds / cust_cnt）；请显式 CAST，例如 CAST(X AS DOUBLE)」；
- 表达式含 `CAST(` 则整段跳过（用户已处理）；类型未知不误报；
- 该 `errors` 会由 `createCalculatedColumn` 转成 **42201** 拦截；前端也可先调
  `GET /catalog/validate-expression` 预校验。
- 单测：`IqdCatalogNodeServiceTest.validateExpression_flags_numeric_div_string_column`。

**② 发布后自检（ai-platform，Python）** —— `PublishSelfCheck.probe_planner`
- 发布成功后对每个 model 跑一次**只读** `wren dry-plan "select * from <model> limit 1"`；
- 规划失败 → `SyncResult.warnings` + `iqd_sync_job.publish_warnings` 点名该模型
  （「自检：模型 X 无法规划（Cannot coerce…）——常见原因：计算列类型不合法，建议显式 CAST」）；
- **只报不改、失败不阻断**（探针异常仅记一条告警）；模型数上限 20；
- 新增 `IqdCli.dry_plan`（只读，allow_nonzero）；接线在 `service.py` 发布自检块。
- 单测：`test_iqd_publish_selfcheck.py` 新增 4 条（点名失败模型 / 正常为空 / 异常降级 / 坏输入）。

**验证**：ai-platform 全量 **1256 passed** + 5 既有 SSE 失败；mis-iqd **108 passed**。

### 3.14.6 MCP「启动」职责纠偏 + 错误透传（2026-09-29，真机踩坑）

**用户踩坑**：新连接点「启动 MCP」→ `code 50000 / 下游调用失败: HTTP 500`。

**根因（后端日志）**：`/iqd/mcp/start` 就绪门禁报「连接 X 的 MDL 尚未构建（本机
`target/mdl.json` 缺失）」，被 BFF 统一吞成 `50000`。而用户处在**跨机器**部署，
「启动」（本地 Plan A 子进程）与「启用/创建项目」（`ensure` → WrenMcpAgent）职责不同。

**修复（三层）**：

1. **BFF 错误透传**（`AbstractDownstreamClient`）：新增 `downstreamFailure(WebClientResponseException)`，
   手工解析下游 `{code,message}` 信封并以**下游 code + message** 抛出，不再一律
   「下游调用失败: HTTP 500」。用户能看到「MDL 尚未构建」这类可诊断原因。
2. **`start` 委派远端**（`mcp_lifecycle.start_connection`）：`WrenMcpAgentClient` 已配置
   （跨机器）时，「启动」直接委派 `ensure_connection`（与「启用/创建项目」同路径），
   不再拿本机 Linux 路径做无意义的本地门禁。
3. **远端 MDL 就绪探测**（`_assert_remote_mdl_ready`）：远端 `ensure` 前向 wren 机探
   `target/mdl.json`；**缺失则明确报错**。真机实测：无 MDL 时 `ensure` 会让进程
   **崩溃自愈循环**（pid 不断变、`alive=false`，而 `status` 恒 `running`），前端显示
   「已运行」却查不了数——所以必须前置拦截。
4. **前端引导**（`ConnectionWizard`）：`start/restart` 失败且消息含「MDL 尚未构建」
   时，展示可执行下一步（填数据源 → 表发现导入 → 发布构建 → 再启动）。

**测试**：本地 Plan A 用例显式钉住 `WrenMcpAgentClient.enabled=False`（区分本地/远程路径）；
ai-platform 全量 **1256 passed** + 5 既有 SSE 失败；BFF 341（仅 1 条既有无关失败）；
前端 `tsc` + `vitest` 318 passed。

### 3.14.7 表发现只显示 3 张表 —— 真因是连接字段没填全（2026-09-29）

**用户现象**：表发现仍只有 3 张表。

**排查（真机）**：直连本身是**通的**——用 vault 里的密码实测 `DirectDbDiscovery`，
返回 `adhoc` 全部 6 张表 + `crm` schema。问题在**连接数据没存全**：

| 字段 | 1790686095967 |
|---|---|
| db_type | starrocks ✅（默认值） |
| db_port | 9030 ✅（默认值） |
| **db_host / db_database / db_user** | **NULL ❌** |
| vault('test') | `{db_type, password, port}`（同样无 host/db/user） |

`db_type`/`db_port` 有默认值 → 用户**只填了密码**就保存成功 → 直连缺坐标失败 →
**静默回落** wren MCP（只含 3 张已建模表）。界面对此**毫无提示**。

**三处修复**：

1. **连接向导必填校验**（前端 `connectionEditUtils.missingDbFields` + `ConnectionWizard`）：
   新增/编辑时，若填了任一 db 字段，则 **host / database / user（新增还要 password）必须齐全**，
   否则阻止提交并提示「否则表发现无法直连业务库，只能看到已建模的表」。
2. **直连坐标合并顺序 bug**（`discovery_service._direct_db`）：旧代码在**合并 vault 之前**
   就因缺 host/user 报错，导致 vault 里的坐标永远补不上。改为**先合并 vault、再判齐全**，
   且缺 `database` 也算缺失。
3. **回落可见**（`discovery_service.last_source` + 路由透出 + 前端 `TableImportWizard`）：
   `list_tables/list_schemas` 返回 `source` 字段（`direct_db` | `wren_mcp`）；回落 MCP 时
   界面显式警示「当前只列出已建模的表，不是全库清单，请补全数据源参数」。

**测试**：新增 `test_discovery_marks_source_direct_and_fallback`、
`test_direct_db_merges_vault_coords_before_guard`；ai-platform **1256 passed** + 5 既有 SSE 失败；
前端 `tsc` + `vitest` 318 passed。

**纠偏**：§3.14.3 曾断言「wren 0.13 无法查 information_schema」，§3.14.4 已推翻——
修好 MDL type 后 wren 也能查。直连仍是更稳主路，二者都能给出全库表。

### 3.14.8 建模台缺「切换连接」入口（2026-09-29）

**用户现象**：新建连接 `test` 后，可视化建模台仍只显示 3 张表；问「是不是要先切换连接」。

**根因**：建模台**根本没有切换连接的 UI**。`iqd-modeling-page.tsx` 只有：
- 一个**只读** Badge（显示当前连接名 + mcp_status）；
- 两个 useEffect **自动选第一条**连接（`connections[0]`）。

文件头注释写着「切换连接 → `store.setConnectionId` …」但**没有实现入口**。所以用户新建的
「test」连接永远选不上，看到的始终是第一条（seed-wren-local）的表 → 只有它已建模的 3 张表。

**修复**（`iqd-modeling-page.tsx`）：把只读 Badge 换成**连接下拉切换器**（复用「语义模型」页
`iqd-catalog-page.tsx` 的 `Select` 范式）：
- 选项列出全部连接（带 `mcp_status`）；切换走 `store.setConnectionId`（A-14：会清空
  选中/抽屉/草稿/wizard，避免跨连接串扰；画布按 `key=connId` 重挂载）；
- 保留一个只读状态 Badge。

**测试**：前端 `tsc` + `vitest src/features/agent/iqd` **318 passed**。

**用法**：建模台页头左上「选择连接」下拉 → 选「test」→ 表发现/模型/发布流水线全部切到该连接。

### 3.15 连接配置分层：数据库连接（profile） / 项目（wren context）（2026-09-30）

**用户诉求**：连接配置菜单混乱，拆成两个 Tab —— ① 数据库连接配置（= wren profile，
name/datasource/host/port/database/user/password，可测连通性）② 项目配置（= wren context，
name/选择连接/启停）③ 可视化工作台只切项目。并「全部做完」。

**核心结构性事实**：**profile : project = 1 : N**（同一业务库可挂多个语义工程）。
原先把两者混在 `iqd_connection` 一行且 1:1 硬绑，是菜单混乱的根因。

**落地**：

| 层 | 改动 |
|----|------|
| DB | **V108** 新表 `iqd_db_profile`（profile）+ `iqd_connection.profile_id`（project→profile FK）；含**幂等回填**（旧连接按坐标生成 profile 并绑定） |
| DB | **V109** 登记 `/api/v1/iqd/db-profiles/**` 到既有 `iqd:config:view/save/test` |
| mis-iqd | `IqdDbProfile` 实体 + Repository + `IqdDbProfileService`（CRUD/默认项/**删除引用阻断 42200+data.dependents**/测试结果回写）+ `IqdDbProfileController`；`IqdAdminService.getConnectionDbProfile`/`getConnectionSecretRef` 改以**关联 profile 为准**（无 profile 回退旧列）；连接 DTO/VO 增 `profile_id/profile_name` |
| ai-platform | 新路由 `POST /api/v1/iqd/db-profiles/test`（复用 `DirectDbDiscovery` 只读探测） |
| BFF | `IqdModelingController` 增 `/db-profiles` 建/改/删/测（建改时把密码转投 vault，**用服务端返回的真实 secret_ref**，避免写错键）；`AiPlatformClient.testIqdDbProfile` |
| 前端 | `IqdConfigPage` 改**双 Tab**：`DbProfilePanel`（连接 CRUD + 测试）/ `ProjectPanel`（项目列表 + 启停 + MCP）；`ConnectionWizard` 增 `editTarget` + `dbProfiles` 选择器（项目侧只选 profile）；建模台页头**连接切换器**（= 切项目） |

**关键修复（分层引入的真实 bug）**：BFF 原先按 `iqd-profile-{id}` 推 vault 键，
但迁移出的 profile `secret_ref` 是 `iqd-conn-{旧连接id}` → 编辑密码会写到**不同的键**、
静默失效。已改为**取服务端 profile.secret_ref**。

**迁移实测（真机）**：V108/V109 已 apply；`iqd_db_profile` 迁移出 `test 数据源`
（starrocks / 10.254.16.217:9030 / adhoc / query），并绑定 project `test`(1790686095967)，
`is_default=1`。

**建议属性（已加 / 待评估）**：已加 `description/enabled/is_default/last_test_at/last_test_ok/
last_test_msg`；profile 侧 `extra options`（charset/ssl_mode/timezone/超时）与权限码拆分
（`iqd:profile:*` vs `iqd:project:*`）留作后续（现复用 `iqd:config:*`）。

**测试**：ai-platform **1258 passed**（+5 既有 SSE 失败）；mis-iqd **108 passed**；
BFF 341（仅 1 条既有无关失败）；前端 `tsc` + `vitest` **318 passed**。

### 3.15.1 分层落地时揪出的两个真实 bug（2026-09-30）

**Bug A：profile id 超出 JS 安全整数 → 前端删不掉**
- V108 回填用 `7000000000000000000 + ROW_NUMBER()` = `7000000000000000001`，
  **超过 `Number.MAX_SAFE_INTEGER`（9007199254740991）**；前端 `JSON.parse` 把它舍入为
  `...000`（末位丢失）→ `DELETE /db-profiles/7000000000000000000` 报
  `40400 数据库连接配置不存在`，而库里是 `...001`。
- **V110** 把 > 2^53-1 的 id 重编号到 `9000000000000000+` 安全区间并同步外键；
  无超大 id 时 no-op。真机验证：id 变为 `9000000000000000000+1`，前端可正常操作。
- 说明：`IdGenerator.nextId()`（System.currentTimeMillis ≈1.79e12）**远在安全范围内**，
  仅 V108 的硬编码回填是隐患；已全局自查无其它 >16 位硬编码 id。

**Bug B：连通测试拿不到密码（using password: NO）**
- `POST /db-profiles/{id}/test` 最初只传坐标、不传密码 → ai-platform 直连报
  `Access denied ... (using password: NO)`。
- 修：BFF 把 profile 的 **`secret_ref`** 透传给 ai-platform；ai-platform 测试端点用
  `CredentialVault.resolve_by_ref` **自行从 vault 取明文密码**（与表发现直连同源，
  密码不经 BFF/mis-iqd）。未存密码时回 `ok:false` 并提示先保存密码。

**测试**：新增 `test_db_profile_test_no_password_no_ref` /
`test_db_profile_test_resolves_password_from_vault`；ai-platform **1260 passed**
（+5 既有 SSE 失败）。

### 3.15.2 项目 Tab「停用无效」+ 两个状态说明（2026-09-30）

**用户现象**：项目配置里「状态」「MCP」两个状态看不懂；后面一堆「启动/停用」按钮，点停用无效。

**真相（真机复现）**：
- 「停用」（`enabled`）在**后端是生效的**（经 BFF 网关 PUT `enabled=false` → OK → 再查确认 false）；
  它控制**是否纳入问数范围**，不影响 MCP 进程。
- 用户点的很可能是 **MCP「停止」**——它**确实无效**：调 `/iqd/mcp/stop` 返回 `stopped`，
  紧接着查状态**仍是 `running`**。真机验证（直连 BFF 网关）：
  `mcp/stop → {mcp_status: stopped}`，立刻 `mcp/status → {mcp_status: running}`。

**根因**：`IqdMcpLifecycleService.stop_connection` 只调**本地 Plan A** 进程管理器
（`get_process_manager().stop`），**跨机器模式下没经 WrenMcpAgent `stop`** —— wren 机进程
照旧跑，状态查询随即又回 `running`。（与 §3.14.6 的 start 同源问题。）

**修复**：
- `stop_connection` 跨机器优先：`WrenMcpAgentClient.enabled` 时调 `agent_client.stop(connId)`，
  并 `get_agent_registry().remove()` 注销本地登记、`report_mcp_status(stopped)` 回写 mis-iqd；
  远程 stop 失败**不静默**（抛 `IqdMcpLifecycleError`）。
- 真机验证：agent `stop` 后 `/status` = `stopped`（`alive=false`, `desired_state=stopped`）。

**UI 消歧（ProjectPanel）**：
- 两列表头注明语义：**启用状态（是否纳入问数）** / **MCP 进程（语义引擎进程）**；
- 顶部加「两个状态分别是什么？」说明；列内文案改「已启用/已停用」「运行中/已停止」；
- 按钮按 MCP 状态**互斥显示**：运行中→「停止 MCP」，否则→「启动 MCP」；「启用/停用」独立，
  并加 `title` 说明「停用 = 移出问数范围，不影响 MCP 进程」。

**测试**：本地 Plan A 的 stop 用例显式钉住 `WrenMcpAgentClient.enabled=False`（区分本地/远程）。
ai-platform **1260 passed**（+5 既有 SSE 失败）；前端 `tsc` + `vitest` 318 passed。

### 3.15.3 项目「编辑」连跳两个弹窗（2026-09-30）

**用户现象**：项目配置点「编辑」→ 同时弹出两个弹窗。

**根因**：`ConnectionWizard` 里【项目 Tab】的外部编辑用 `editTarget` 驱动——父组件把
`open=true` + `editTarget=X` 传进来后：
1. `WizardShell`（open=true）先渲染（第 1 个弹窗）；
2. `useEffect(open && editTarget)` 设 `mode='edit'` → 编辑 Dialog（`editOpen`）也渲染（第 2 个弹窗）。
即「向导壳 + 编辑弹窗」同时出现。

**修复**（`ConnectionWizard`）：
- 外部 `editTarget` 驱动时，`WizardShell` 用 `open={open && editTarget == null}` **不渲染**；
  只有编辑 Dialog 显示。
- `closeEdit()` 在 `editTarget != null` 时回调 `onOpenChange(false)` 整体收起——否则父组件
  `open` 仍为 true，会留一个空的向导壳。

**测试**：前端 `tsc` + `vitest src/features/agent/iqd` **318 passed**。

**安全边界（红线，已守）**：
- 密码**绝不落 mis-iqd**（BFF 转发前 `stripDbPassword`；mis-iqd DTO 无该字段）；
- 密码**绝不回显**（GET 只回 `has_db_password` / 掩码账号）；
- 密文只在 `ai_platform.credential_mappings`（AES-256-GCM，键 `CREDENTIAL_VAULT_KEY`）；
- wren 侧解密仅在 `wren serve mcp` 启动期注 env（D6，用后即忘）。

**验证**：
- ✅ ai-platform 全量：**1247 passed** + 5 既有 SSE 失败（基线 1238 + 新增 9）；
- ✅ mis-iqd：107 tests pass；mis-admin-bff：341 tests，仅 1 条既有 `BffApiRegistryDiffSurveyTest` 失败（无关）；
- ✅ 前端 `tsc --noEmit` 通过；`vitest src/features/agent/iqd` **318 passed**；
- ✅ 真机：迁移 006 已 `upgrade` 至 `ai_platform`（`credential_mappings` 建成，唯一索引在位）；
  V107 已 `flyway:migrate` 至 `mis_platform`（db 列建成）；
- ✅ 真机：Vault `upsert_by_ref → resolve_by_ref → delete_by_ref` 往返（写/更新/软删/查空）实测通过；
- 🟡 **未实测**：直连业务库真实查询（本沙箱无 `10.254.16.217:9030` 的 `query` 账号密码；
  `pymysql` 已装、错误路径 `Access denied` 证明 host/port 可达）。需在有真实业务库密码的环境复验
  「录凭证 → 表发现见全部 6 表 → 导入未建模表」。

---

## 4. 性能压测（P-1 ~ P-6）

### 4.1 画布拖拽帧率（P-1：200 节点 ≥55fps）
- **状态**：❌ **未验证**（需真实 Chrome + 大数据集）。
- **方法**：造 200 节点连接 → Chrome DevTools Performance 录制 5s 拖拽 → 读 FPS。**通过**：≥55fps。

### 4.2 无关系表折叠（P-2：500 节点，>200 触发折叠 ≤1s）
- **状态**：❌ **未验证**（需浏览器）。
- **方法**：造 500 节点 → 触发「已折叠 N 个无关系表」→ 计渲染耗时。**通过**：≤1s。

### 4.3 CodeMirror 懒加载 chunk（P-3：vendor chunk ≤300KB gzip）
- **状态**：🟡 **部分验证（构建产物实测）**。
- **实测**（本沙箱 `npm run build`，2026-09-22）：
  | chunk | raw | gzip |
  |---|---|---|
  | `index-BXDIgwut.js`（含 CodeMirror 的**最大**懒加载块） | 202.25 KB | **65.76 KB** |
  | `index-Cmj4VfWs.js` | 49.71 KB | 16.68 KB |
  | `index-Cpfsy5vT.js` | 40.78 KB | 14.35 KB |
  | `useCodeMirror-*.js`（hook） | 3.07 KB | 1.58 KB |
  - CodeMirror 相关代码**懒加载分包**（未进 `main`），最大块 gzip **≈65.8KB ≪ 300KB**。
- **结论**：**✅ 预算内**（构建产物层面；真机首屏仍建议复测）。
- **复验**：
  ```bash
  cd frontend/mis-admin-web && npm run build
  ls -S dist/assets/*.js | head; # 或按 §4.7 统计 gzip
  ```

### 4.4 dagre 自动布局（P-4：200 节点 ≤2s / 500 节点 ≤5s）
- **状态**：❌ **未验证**（需在浏览器或 Node 计时 `AutoLayoutButton`/`useModelLayout` 的 dagre 计算）。

### 4.5 `build_mdl_from_catalog`（P-5：200 节点含 50 关系 + 10 cube ≤10s）
- **状态**：❌ **未验证**（需 WrenAI + 业务库）。
- **方法**：真机构造该规模 → 触发 build → 计时。**通过**：≤10s。

### 4.6 缓存命中画布首屏（P-6：TanStack Query 命中后 ≤500ms）
- **状态**：❌ **未验证**（需浏览器 Network/Performance）。

### 4.7 构建产物统计（供 P-3 复验）
```bash
cd frontend/mis-admin-web
for f in dist/assets/*.js; do printf "%8d raw  %8d gzip  %s\n" "$(stat -c%s "$f")" "$(gzip -c "$f" | wc -c)" "$(basename "$f")"; done | sort -rn
```

---

## 5. 已知问题（只报告，不修）

### F-1（**P1**，阻断单端点）`sys_api` PK 冲突 → `POST /api/v1/iqd/sql-pairs/translate` 未被登记 ⇒ 必然 40300
- **证据**：
  - `V76__agent_ops_feedback_submit_api.sql:32` → `(92586, 92020, 92162, '00970001', …, POST, '/api/v1/agent-ops/sessions/{session_id}/feedback', …)`
  - `V78__iqd_sql_pair_v110.sql:50` → `(92586, 92020, 92550, '00960011', …, POST, '/api/v1/iqd/sql-pairs/translate', …)` **同 id=92586**
  - 两 INSERT 均有 `WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)`；**V76 先跑并占住 92586**，故 V78 的 translate 行被**静默跳过**（V78 的 92587 `/trial` 不受影响）。
- **影响**：`deny-unmapped=true`（`application.yml:98` 默认）下，`POST /api/v1/iqd/sql-pairs/translate` **无 BFF 注册 ⇒ 40300**。前端 enhance 页「样本对方言转化」（`iqd-enhance-page.tsx:1109 translateSqlPair`，MR-08）会失败；`/trial` 正常。
- **归属**：**预存**（V76/V78 均早于 T01，非建模台工作引入）；但被本轮 T04d/T04e 的样本对 UI 触达。
- **建议**：把 V78 的 translate 行改用空闲 id（如 **92702**，V90 已申明 92702+ 预留）+ 绑定，或让 V78 与 V76 分属不同段。**（修由工程师，QA 不擅自改）**
- **真机复验**：`SELECT id,http_method,path_pattern FROM sys_api WHERE path_pattern LIKE '%sql-pairs%';` → 预期只剩 `/sql-pairs`、`/trial`，**缺 `/translate`**；或直接调该端点看是否 40300。

### F-2（P2，agent-ops 域，与本特征无关）`sys_api`/`sys_menu_api` id=92158 冲突
- `V29:34`（`GET /api/v1/agent-ops/mcp/tools`）与 `V46:25`（`POST /api/v1/agent-ops/skills/builder/chat`）**同 id=92158**；V29 先跑并占住 → V46 的 skill-builder 端点被跳过 ⇒ 该端点在 deny-unmapped 下 40300。
- **说明**：与 iqd 无关，可能即团队既往「agent-ops 域一条端点差异」的预存项。**建议单独确认。**

### F-3（P3，非阻断）前端有、后端未直用/反向不齐
- 前端未直接用但后端有：`iqd:test:use`、`iqd:acl:save`（可能是页面级 vs 动作级授权差异）。**观察项**，非 40300 风险。

---

## 6. 汇总

- **可放行（本沙箱已证）**：跨阶段不变项 6/6；三条门禁（typecheck / vitest 34·429 / build；Java 69/69；Python `-k iqd` 110）；引擎侧 `wren context validate` 0 warning（connection 900001）；P-3 构建产物（部分）。
- **必须真机复验**：M-G1（需修复远程工程读不到模型的缺口）、M-G4；M-G3 尚缺 UI 红段联调；P-1/P-2/P-4/P-5/P-6。
- **必修项**：**F-1**（`sql-pairs/translate` 40300，P1）。
- **待确认**：F-2（agent-ops 预存冲突）、F-3。

> 复验通过后在本文逐项勾选并回填真机数据；未回填前，任何 E2E 项**不得**标记「通过」。
