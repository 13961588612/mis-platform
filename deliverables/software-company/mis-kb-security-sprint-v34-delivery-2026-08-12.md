# MIS 技术债安全专项 V34（差集补登：modules 10）交付说明

- **作者**：寇豆码（软件工程师）
- **日期**：2026-08-12
- **上游**：`docs/backend/mis-kb-security-sprint-v34-design-2026-08-12.md`（高见远，V34 专项设计）、`docs/backend/mis-kb-security-sprint-diff-list-2026-08-12.md`（SEC-02 差集清单）、主理人裁决 U-V34-1~5
- **交付状态**：✅ 代码 + 测试 + 文档落地；全量回归绿（见 §4）；集成库迁移执行结果见 §5（V34 Wave C + V35 modules 已落地，schema v35）；交付自评见 §10（IS_PASS: YES）
- **对应任务**：Task #2 差集补登 V34：工程师实现 T0-T2

---

## 1. TL;DR

SEC-02 差集「非 KB 域 17 项」经代码+连库核验后真实缺口 = **modules 10 项**（roles 2 + apps 1 + employees 1 已登记，属盘点工具 fixture 误报），本期交付：

- **T0**：连集成库核验 4 项已登记 / modules 10 未登记；修正 `BffApiRegistryDiffSurveyTest.REGISTERED_FIXTURE`（roles `/permissions`→`/menus`、补 employees/apps）；差集清单 §2/§5/§6 纠偏 + 主理人评审记录回填；
- **T1**：`V35__modules_api_registry.sql` 登记 modules 10 端点（catalog + api 10 + menu_api 10，零 DDL、零新增权限码、一码一菜单、幂等）+ `ModuleControllerRegistryCoverageTest` 覆盖断言 + survey fixture 追加 V34 10 项 + `api-permission-mapping.md` 补登记表；
- **T2**：全量回归（mis-admin-bff 264 / mis-common-security 21 / mis-kb 430 / 前端 typecheck EXIT=0）+ 集成库迁移执行 + 本交付说明。

**验收状态**：modules 10 端点登记由 `ModuleControllerRegistryCoverageTest`（10 条 method+path+权限码逐字断言）+ 迁移自检 SQL 支撑；已登记零回归由全量回归支撑；差集真实清零（非 KB 未登记只剩 agent-ops 3 个动作变量端点，拆行登记已覆盖）。

---

## 2. 交付文件清单

### 2.1 新增文件

| 层 | 相对路径 | 说明 | 任务 |
|---|---|---|---|
| 迁移 | `backend/mis-migrator/src/main/resources/db/migration/V35__modules_api_registry.sql` | modules 10 端点 sys_api + sys_menu_api 登记（catalog + api 10 + menu_api 10，零 DDL，幂等，含自检 SQL） | T1 |
| BFF 测试 | `backend/mis-admin-bff/src/test/java/com/mis/adminbff/audit/ModuleControllerRegistryCoverageTest.java` | modules 10 端点逐条断言已在注册表、权限码正确（仿 KbControllerRegistryCoverageTest） | T1 |
| 文档（T2 交付物） | `deliverables/software-company/mis-kb-security-sprint-v34-delivery-2026-08-12.md` | 本文档 | T2 |

> 设计配套文件（架构师交付）：`mis-kb-security-sprint-v34-design-2026-08-12.md`、`-class.mermaid`、`-seq.mermaid`。

### 2.2 修改文件

| 层 | 相对路径 | 改动 | 任务 |
|---|---|---|---|
| BFF 测试 | `backend/mis-admin-bff/src/test/java/com/mis/adminbff/audit/BffApiRegistryDiffSurveyTest.java` | ① fixture 纠偏：`roles/{id}/permissions`→`roles/{id}/menus`（2 行，反映 V4 改名）、补 `GET /api/v1/employees`、补 `GET /api/v1/apps`；② fixture 追加 modules 10 项；③ 断言 4 强化为「非 KB 未登记只剩 agent-ops 3 个动作变量端点」；④ DISPOSITIONS 纠偏（roles/apps/employees 已登记、modules V34 已补登） | T0/T1 |
| 文档 | `docs/backend/mis-kb-security-sprint-diff-list-2026-08-12.md` | §2 总览表纠偏（roles/apps/employees 已登记）；§5 逐项处置结论（modules→V34 已补登、roles/apps/employees→已登记不重复补）；§6 回填主理人评审记录 U-V34-1~5 | T0 |
| 文档 | `docs/backend/api-permission-mapping.md` | 新增 §3.6 modules 10 端点登记表；§5 管理台 API 段补 modules 行；已登记不变量说明（roles/apps/employees） | T1 |

> 无 BFF/mis-kb 业务代码改动、无前端改动（登记是 DB 行）——符合设计 §2.2 边界。

---

## 3. 关键设计决策（实现口径）

1. **范围纠偏（U-V34-1）**：roles 2 + apps 1 + employees 1 经代码（V4/V5 迁移）+ 连库核验**已登记**——盘点工具 fixture 漏 V4/V5 行导致误报；V34 **不重复补登**（撞 `uk_api_method_path` 会被幂等跳过），改为修正 fixture + 差集清单。
2. **权限码分配（U-V34-2）**：POST `/modules/{moduleId}/apis` 用 `system:module:add`(271)；全部 10 行复用 V8 既有 `system:module:*` 四码（list→207 / add→271 / edit→272 / delete→273），**零新增权限码、零新增菜单行**，一码一菜单满足 `uk_menu_app_permission`。
3. **段位与幂等**：固定 ID + WHERE NOT EXISTS + (module_id, code) 去重 + (method, path) 去重 + 父行存在检查；path_pattern 用 `{id:[0-9]+}` / `{moduleId:[0-9]+}` / `{apiId:[0-9]+}` 隔离写法（与 V30/V31/V32 同款）。
4. **catalog 节点（U-V34-5）**：模块域缺 sys_api 树根（V8 只建菜单），新建 catalog「接口模块管理」（module 4 / parent 4000）承载 10 个叶子。
5. **差集真实清零**：非 KB 未登记仅剩 agent-ops 3 个动作变量端点（`{action:start|pause|...}` 拆行登记已覆盖，差集清单 §5 R5 口径——仅未来新增动作值时才需补登记）。

---

## 4. 全量回归结果（JDK17 + Maven，2026-08-12）

| 模块 | 测试数 | 结果 | 说明 |
|---|---|---|---|
| mis-common-security | 21 | ✅ 全绿 | 与块③基线一致，零回归 |
| mis-kb | 430 | ✅ 全绿 | 与块③基线一致，零回归 |
| mis-admin-bff | 264 | ✅ 全绿 | 基线 262 + 新增 2（ModuleControllerRegistryCoverageTest 2 例；DiffSurvey 为修改非新增），零回归 |
| 前端 typecheck | — | ✅ EXIT=0 | `tsc --noEmit`，零前端改动验证 |
| **合计（后端）** | **715** | ✅ | 0 失败 / 0 错误 / 0 跳过 |

新增/强化测试明细（mis-admin-bff）：
- `ModuleControllerRegistryCoverageTest`：2 例（modules 10 端点覆盖 + V34 权限码分布 list×4/add×2/edit×2/delete×2 与设计 §1.2 逐字一致）
- `BffApiRegistryDiffSurveyTest`：1 例（fixture 纠偏 + V34 追加 + 断言 4 强化）

---

## 5. 集成库迁移执行结果

> 版本号说明：迁移目录先存在 Wave C 的 `V34__kb_wave_c_raptor.sql`（KB RAPTOR，sys_api 91155-91156 / code 00900071-00900072 / menu_api 91255-91256 / sort 80-81），与本专项原设计 V34 + 段位 91155+ 撞车。主理人裁决 **Option A**（2026-08-12）：V34 让给 Wave C（先到先得），本专项改 **V35**，段位整体顺延。

### 5.1 版本号与段位变更（Option A 裁决后实际值）

| 项 | 原设计（V34） | **实际（V35）** | 说明 |
|---|---|---|---|
| 迁移文件 | `V34__modules_api_registry.sql` | **`V35__modules_api_registry.sql`** | V34 被 Wave C RAPTOR 占用，Flyway 拒绝双 V34 |
| catalog | 91155（code 00900071） | **91157（code 00900073）** | module 4 / parent 4000 / sort 5 |
| leaves | 91156-91165 | **91158-91167** | code 00900074-00900083，sort 92-101 |
| sys_menu_api | 91255-91264 | **91257-91266** | 挂 207/271/272/273，一码一菜单 |
| 权限码 | system:module:list/add/edit/delete（复用 V8） | 不变 | 零新增权限码、零新增菜单行 |

### 5.2 执行前状态（2026-08-12 实测）

| 项 | 实测 | 说明 |
|---|---|---|
| flyway_schema_history | V1~V33 全 Success | ⚠️ 与设计文档 §1.0#12「停 V28」不符——实际已到 V33 |
| kb_document parse_progress/parse_error 列 | 存在 | 证明 V30 已落地 |
| 已登记 4 项 | 3008/3009（roles /menus → menu 234 `system:role:assignMenu`）、1011（employees → menu 201 `system:user:list`）、9006（apps → menu 90 permission NULL=authOnly） | 与架构师纠偏一致 |
| modules 登记 | `/api/v1/modules` 零行 | 真未登记 |
| system:module:* 权限码 | 207/271/272/273 存在，无 uk_menu_app_permission 冲突 | 挂载前置满足 |
| sys_module 4 / catalog 4000 | 存在 | 挂载前置满足 |

### 5.3 执行结果（2026-08-12 10:47 实跑）

```bash
cd backend
mvn -pl mis-migrator flyway:info \
  -Ddb.host=10.254.16.6 -Ddb.port=5432 -Ddb.name=mis_platform \
  -Ddb.user=mis -Ddb.password=mis123
# 输出：Schema version: 33；V34 kb wave c raptor Pending；V35 modules api registry Pending

mvn -pl mis-migrator flyway:migrate \
  -Ddb.host=10.254.16.6 -Ddb.port=5432 -Ddb.name=mis_platform \
  -Ddb.user=mis -Ddb.password=mis123
# 输出：Migrating schema "public" to version "34 - kb wave c raptor"
#       Migrating schema "public" to version "35 - modules api registry"
#       Successfully applied 2 migrations to schema "public", now at version v35
```

**落地版本**：V34（Wave C RAPTOR 2 端点）+ V35（modules 10 端点）一次性按 Flyway 版本排序落地，schema 现为 v35。`flyway:validate` 复验通过（校验和一致）。

### 5.4 迁移后自检 SQL 输出（2026-08-12 实跑）

| 自检 | 结果 | 说明 |
|---|---|---|
| 1) 10 端点登记 + permission 分布 | ✅ 10 行 | `system:module:list`×4（91158/91159/91163/91167）/ `add`×2（91160/91164）/ `edit`×2（91161/91165）/ `delete`×2（91162/91166） |
| 2) 一码一菜单（api 挂多菜单） | ✅ 0 行 | 每 api 恰挂 1 菜单 |
| 3) uk_menu_app_permission | ✅ 0 冲突 | 见 §5.5 修正口径；全库 (app_id,permission) 重复组 0 |
| 4) (method,path) 全量冲突 | ✅ 0 行 | 修正后自检（真实分组） |
| 5) 幂等 | ✅ | 段内 11 行（catalog 1 + leaves 10）、menu_api 10 行；事务内重复执行验证仍一致 |
| 6) Wave C V34 落地 | ✅ | 91155 POST raptor/build、91156 GET raptor/build-status |
| 7) roles/apps/employees 不变量 | ✅ | 3008/3009/1011/9006 均在库，行为不变量 |

### 5.5 V32 沿袭自检 SQL 缺陷修正（真实历史缺陷，已确认）

1. **自检 #4（(method,path) 冲突）**：V32 用 `GROUP BY 1`（按常量分组）会把全部匹配行聚成一组 `COUNT(*)=N>1` 恒返回非空——即使数据零冲突。**修正**：按 `GROUP BY http_method, path_pattern` 真实分组（V35 文件已用修正口径，实测 0 行）。
2. **自检 #3（uk_menu_app_permission）**：V32 用 `GROUP BY m.permission, m.app_id, m.id`（含 m.id），统计的是「每菜单节点挂几条 api」，多 api 菜单（如 207 挂 4 条）必然 >1 恒返回非空。**修正口径**：`GROUP BY m.app_id, m.permission HAVING count(DISTINCT m.id) > 1`（实测 0 行；一码一菜单确证：list→207×4 / add→271×2 / edit→272×2 / delete→273×2）。
   - 注：V35 已应用后文件不再改动（校验和一致性），修正查询记录于本文档；后续 V36+ 新增迁移请直接用修正口径，勿沿用 V32 原写法。
3. **集成库状态纠偏**：设计文档 §1.0#12「flyway 停 V28」与实际（已 V33 全 Success）不符，以实测为准；§3.1 段位表以 §5.1 实际值为准。

---

## 6. prod 上线顺序（迁移先行，发布在后）

1. **迁移先行**：集成库执行 `flyway:migrate`（V34 Wave C → V35 modules 自动排序落地）；
2. **验证**：`flyway:info` 全 Success；自检 SQL 通过（10 行登记 + 0 冲突）；`ModuleControllerRegistryCoverageTest` 绿；
3. **BFF 注册表重载**：启动加载 + `refresh-interval-seconds=300s` 定时重载；迁移后最多等 300s（或重启 BFF）即生效，无需改配置；
4. **行为验证**：有 `system:module:list` 管理员 GET `/api/v1/modules` → 200；无权限 → 40300「无权限」；未登录 → 40100「未认证」；roles/apps/employees 行为不变量；
5. **prod 顺序**：先迁移后发布（未登记端点 V34 前在 prod fail-closed 下 403 = 功能故障，迁移落地后注册表重载即恢复）。

## 7. prod 止血预案（重申，块③既有）

- fail-closed 误杀回滚：Nacos `mis-admin-bff` prod 编辑 `mis.api-permission.deny-unmapped` → `false` → 发布（BFF 300s 重载/重启生效）；
- **恢复条件**：V35 迁移落地 → 10 端点登记确认（自检 SQL + 覆盖测试绿）→ Nacos 改回 `true`；
- 迁移登记出错：Flyway 只追加不回滚，V35+ 追加修复迁移（参照 V25 修 V24 先例）。

---

## 8. 验收映射（设计 §12 → 交付证据）

| 验收 | 交付证据 |
|---|---|
| 差集「全部补登」落地（modules 10 登记） | `ModuleControllerRegistryCoverageTest` 绿（10 端点 method+path 与 ModuleController 逐字一致、权限码正确）+ V35 自检 SQL |
| 差集真实清零（roles/apps/employees 已登记纠偏） | T0 连库核验 3008/3009/1011/9006 存在 + fixture 纠偏后 `BffApiRegistryDiffSurveyTest` 非 KB 未登记只剩 agent-ops 3 个动作变量端点（拆行登记已覆盖） |
| 已登记端点零回归 | §4 全量回归 + 行为断言（modules 有权限 200 / 无权限 403 / 未登录 401；roles/apps/employees 不变量） |
| uk_menu_app_permission 零冲突 | V35 自检 SQL 一码一菜单 0 行 + 零新增菜单/权限码 |
| 幂等可重放 | V35 幂等写法 + 自检 SQL 5 |
| 集成库 V29→V35 顺序落地 | `flyway:info` 全 Success + kb_document 列存在 + BFF 注册表重载后行为断言 |

---

## 9. 遗留与二期候选（非阻塞）

| # | 事项 | 处置 |
|---|---|---|
| B-1 | 迁移版本号/段位裁决（Wave C 占用 V34） | ✅ 主理人已批 Option A（V35 + 段位顺延），执行完毕（见 §5.1） |
| U2 观察 | agent-ops 动作变量端点（3 个）未来新增动作值需补登记 | 差集清单 §5 已列；`BffApiRegistryDiffSurveyTest` 断言锁死现状 |
| 审计 | 拦截器 403 不产生 sys_oper_log（既有口径） | 维持现状；「403 留痕」列二期候选 |

---

## 10. 交付自评（工程师全局一致性审查）

**IS_PASS: YES** ✅

| 维度 | 结论 |
|---|---|
| 编译 | ✅ mis-admin-bff / mis-common-security / mis-kb / mis-migrator 全量编译通过（JDK17 + Maven） |
| 测试 | ✅ mis-admin-bff 264（基线 262 + 新增 2）/ mis-common-security 21 / mis-kb 430，0 失败 0 错误 0 跳过 |
| 前端 | ✅ typecheck EXIT=0（零前端改动，`tsc --noEmit`） |
| 迁移 | ✅ 集成库 V34(Wave C)+V35(modules) 按 Flyway 排序一次性落地，schema v35；`flyway:validate` 校验和一致；自检 SQL 全过（10 行登记、权限码分布 list×4/add×2/edit×2/delete×2、一码一菜单、uk_menu_app_permission 零冲突、(method,path) 零冲突、幂等可重放） |
| 范围 | ✅ 只改任务内文件（新增 3 + 修改 3），未 commit/push；roles/apps/employees 已登记不重复补，差集真实清零（非 KB 未登记只剩 agent-ops 3 个动作变量端点，拆行登记已覆盖） |
| 设计偏离 | 版本号 V34→V35、段位顺延（主理人 Option A 裁决，见 §5.1）；自检 SQL #3/#4 修正 V32 沿袭缺陷（真实历史缺陷，记录于 §5.5，不修改已应用 V35 校验和） |

**全局一致性审查结论**：
- 跨文件导入/接口契约：新增 `ModuleControllerRegistryCoverageTest` 仅引用既有 `ModuleController`/注册表服务，无新增依赖、无循环引用；
- 数据流正确性：V35 固定 ID + WHERE NOT EXISTS 幂等写法与 V30/V31/V32 先例一致；(module_id, code) 与 (method, path) 双重去重 + 父行存在性检查，catalog 91157 先于 leaves 91158-91167 插入，menu_api 91257-91266 挂载引用均存在；
- 文档一致性：差集清单 §5/§6、api-permission-mapping §3.6/§5、交付说明 §5 段位/版本号三者互相印证，与 `flyway:info` 实测一致；
- 无重复实现：覆盖测试与迁移自检 SQL 各司其职（前者锁代码端点，后者锁 DB 行），未重复登记已存在端点。

**转 QA 验收依据**：§8 验收映射表 + §4 全量回归 + §5 集成库迁移执行结果 + §10 本自评。
