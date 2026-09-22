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
| M-G1 建连接+向导闭环（含模型物化） | E2E | ⚠️ **未验证**（依赖 WrenAI 物化，见 §3.1 红线） | **必跑** |
| M-G2 关系+Cube+问数命中 | E2E | ⚠️ **未验证**（需真问数） | **必跑** |
| M-G3 build 失败→定位→重试 | E2E | ⚠️ **未验证**（需可注入失败的真 build） | **必跑** |
| M-G4 漂移注入→详情→收敛 | E2E | ⚠️ **未验证**（需真 MDL 漂移） | 可跑 |
| M-G5 字段改描述/脱敏→问数生效 | E2E | ⚠️ **未验证**（需真问数） | 可跑 |
| M-G6 scope 行级维度徽标+谓词预览 | E2E | 🟡 **部分验证**（纯函数单测已过，见 §3.6） | 建议跑 |
| P-1 画布 200 节点 ≥55fps | 性能 | ❌ **未验证**（需浏览器） | 可跑 |
| P-2 500 节点折叠 ≤1s | 性能 | ❌ **未验证**（需浏览器） | 可跑 |
| P-3 CodeMirror chunk ≤300KB gzip | 性能 | 🟡 **部分验证**（构建产物实测，见 §4.3） | 建议复测 |
| P-4 dagre 200/500 节点 | 性能 | ❌ **未验证**（需浏览器/Node 计时） | 可跑 |
| P-5 build_mdl_from_catalog ≤10s | 性能 | ❌ **未验证**（需 WrenAI） | 可跑 |
| P-6 缓存命中画布首屏 ≤500ms | 性能 | ❌ **未验证**（需浏览器） | 可跑 |
| 门禁：前端 typecheck/vitest/build | 闸门 | ✅ **已验证** | — |
| 门禁：Java mis-iqd | 闸门 | ✅ **已验证** | — |
| 门禁：Python `-k iqd` | 闸门 | ✅ **已验证** | — |

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
     - 校验：**每连接 MCP 状态卡应显示 `mcp_status=ready`**（`GET /api/v1/iqd/connections` 核对）。
     - ✅ **注意（2026-09-22 修订：原"防两条 `enabled=true`"警告已作废）**：`iqd_connection` **可多条 `enabled=true` 并存**（原「业务上仅一条启用」约定**作废**，见 `architecture.md:882` 与 `mis-iqd-modeling-system-design.md §14.5`）。⇒ **无需**"先把旧的置 `false` 再启用新连接"；多条同时启用为**合法态**，不产生"非法态"。
       - ~~⚠️ **注意（防「两条 `enabled=true`」）**：`iqd_connection` **业务上仅一条启用**（依据 `architecture.md:882`；⚠️ `enabled` **无 DB 唯一约束**，故不是硬约束）。若库里**已有旧启用连接**，**须先将其置 `false` 再建/启用新连接**，否则产生「两条启用」非法态（接口不报错、语义违规）。作废旧连接走既有问数配置页（`PUT /api/v1/iqd/config`，单条 upsert）；**无** `PUT /iqd/connections/{id}`。~~（**以上为作废前历史原文，保留痕迹**）
       - **新口径**：主连接 = **`name='default'`**（否则 id 最小的 enabled），见 §14.5.1；**指定连接的停用/编辑**走**本期新增**的 `PUT /api/v1/iqd/connections/{id}`（§14.1 / 迁移 `V92`）。
  3. `/iqd/modeling` → 左树「表发现导入」→ 选 schema → 勾 3 张表 → 导入。
  4. `curl` 校连接与发现：`GET <AI_PLATFORM_HOST>/api/v1/iqd/discovery/schemas?connectionId=<CONN_ID>`（应 200，非 40300/502）。
  5. 双击一张表（或左树「生成模型」）→ 生成 1 个 model → 画布出现节点卡。
  6. 观察 `PublishPipelineBar` 五态。
  7. `/iqd/scope` 勾选纳入范围（**导入 ≠ 可问**，默认 `in_scope=false`）。
  8. 测试问数页对 `orders` 发 1 条自然语言问数。
- **预期**：数据源 profile 已注册（主机侧 `wren profile list` 可见、无明文）；连接创建成功（返回 `<CONN_ID>`）且该连接 **MCP 状态卡 `mcp_status=ready`**；发现返回 ≥3 表；模型节点画布可见；导入触发一次整库 build；`edit_status` 走向 `SYNCED`（`built_edit_revision` 推进）；问数返回结果。
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

- **可放行（本沙箱已证）**：跨阶段不变项 6/6；三条门禁（typecheck / vitest 34·429 / build；Java 69/69；Python `-k iqd` 110）；P-3 构建产物（部分）。
- **必须真机复验**：M-G1~M-G6 全部（M-G1 含**模型物化缺口**红线）；P-1/P-2/P-4/P-5/P-6。
- **必修项**：**F-1**（`sql-pairs/translate` 40300，P1）。
- **待确认**：F-2（agent-ops 预存冲突）、F-3。

> 复验通过后在本文逐项勾选并回填真机数据；未回填前，任何 E2E 项**不得**标记「通过」。
