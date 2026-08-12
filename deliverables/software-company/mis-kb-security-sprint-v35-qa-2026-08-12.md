# MIS 技术债安全专项 V35（差集补登：modules 10）QA 独立验收报告

- **作者**：严过关（QA 工程师）
- **日期**：2026-08-12
- **验收对象**：差集补登 V35（modules 10 端点 sys_api 登记；专项代号 v34 → 实际迁移 V35，主理人 Option A 裁决）
- **验收方式**：独立连库核验（psycopg2 → 10.254.16.6:5432/mis_platform）+ 测试复跑 + 读码核查 + 边界/反例验证
- **上游依据**：交付说明 `mis-kb-security-sprint-v34-delivery-2026-08-12.md`（权威口径）、设计文档（⚠️ 段位表为旧 V34 版，已与实际 SQL 对照）、差集清单（已纠偏）、块③设计基线、V32/V33 迁移先例

---

## 0. 结论速览

| 项 | 结论 |
|---|---|
| **集成库迁移核验** | ✅ **28/28 项 PASS**（连库实测） |
| **V35 专项测试** | ✅ `ModuleControllerRegistryCoverageTest` **2/2 PASS**（独立复跑） |
| **mis-common-security** | ✅ **21/21 PASS**（独立复跑） |
| **mis-admin-bff 全量 264 / mis-kb 430 / 前端 typecheck** | ⚠️ 交付时点全绿（10:37-10:51 surefire 记录 + 交付说明）；**当前工作树因 Wave C RAPTOR 未提交 WIP 无法独立全量复跑**（详见 §2.2，非 V35 缺陷） |
| **读码核查** | ✅ V35 SQL 正确、与 Wave C V34 段位零重叠、fixture 纠偏正确、自检 #4 已修正 / **#3 未修正（已知遗留，交付说明 §5.5 已披露）**、文档用实际段位 |
| **路由判定** | **Send To: NoOne**（V35 交付自身无源码 Bug）；发现 2 项非阻塞已知遗留 + 1 项环境阻塞（Wave C WIP，需主理人协调 Wave C 收口） |

---

## 1. 集成库迁移独立核验（连库实测，本次核心）

> 连接：psycopg2 → 10.254.16.6:5432/mis_platform（mis/mis123）。**28/28 全 PASS**，明细如下。

### 1.1 flyway_schema_history

| 项 | 实测 | 结论 |
|---|---|---|
| 最新版本 | **v35**（description = modules api registry） | ✅ |
| V34 Wave C | Success（kb wave c raptor） | ✅ |
| V35 modules | Success（modules api registry） | ✅ |
| V29~V33 | 全部 Success（agent mcp tool / kb enterprise phase1 / kb wave b graphrag / kb security sprint / authonly） | ✅ |
| 失败版本 | 0 | ✅ |
| `flyway:validate` | **Successfully validated 35 migrations**（校验和一致） | ✅ |

### 1.2 sys_api 实际落库（以实际 SQL 为准，逐条核对交付说明 §5）

| id | method | path_pattern | code | sort | 权限码 | 结论 |
|---|---|---|---|---|---|---|
| 91157 (catalog) | NULL | NULL | 00900073 | 5 | — | ✅ module 4 / parent 4000 / 接口模块管理 |
| 91158 | GET | /api/v1/modules | 00900074 | 92 | system:module:list | ✅ |
| 91159 | GET | /api/v1/modules/{id:[0-9]+} | 00900075 | 93 | system:module:list | ✅ |
| 91160 | POST | /api/v1/modules | 00900076 | 94 | system:module:add | ✅ |
| 91161 | PUT | /api/v1/modules/{id:[0-9]+} | 00900077 | 95 | system:module:edit | ✅ |
| 91162 | DELETE | /api/v1/modules/{id:[0-9]+} | 00900078 | 96 | system:module:delete | ✅ |
| 91163 | GET | /api/v1/modules/{moduleId:[0-9]+}/apis | 00900079 | 97 | system:module:list | ✅ |
| 91164 | POST | /api/v1/modules/{moduleId:[0-9]+}/apis | 00900080 | 98 | system:module:add（U-V34-2） | ✅ |
| 91165 | PUT | /api/v1/modules/apis/{apiId:[0-9]+} | 00900081 | 99 | system:module:edit | ✅ |
| 91166 | DELETE | /api/v1/modules/apis/{apiId:[0-9]+} | 00900082 | 100 | system:module:delete | ✅ |
| 91167 | GET | /api/v1/modules/{moduleId:[0-9]+}/bindings | 00900083 | 101 | system:module:list | ✅ |

- 权限码分布实测：**list×4（91158/91159/91163/91167）/ add×2（91160/91164）/ edit×2（91161/91165）/ delete×2（91162/91166）** —— 与交付说明一致 ✅
- Wave C 顺带确认：91155 POST /api/v1/kb/libraries/{id}/raptor/build（00900071/sort 80）、91156 GET .../build-status（00900072/sort 81）均在库 ✅

### 1.3 sys_menu_api 91257-91266（10 行）

- 实测挂载：91257→207(91158)、91258→207(91159)、91259→271(91160)、91260→272(91161)、91261→273(91162)、91262→207(91163)、91263→271(91164)、91264→272(91165)、91265→273(91166)、91266→207(91167) ✅
- 菜单 207/271/272/273 存在且权限码 = system:module:list/add/edit/delete（status=1）✅

### 1.4 不变量（已登记 4 项未被误动）

| id | method | path | 结论 |
|---|---|---|---|
| 3008 | GET | /api/v1/roles/{id}/menus | ✅ 在库 |
| 3009 | PUT | /api/v1/roles/{id}/menus | ✅ 在库 |
| 1011 | GET | /api/v1/employees | ✅ 在库 |
| 9006 | GET | /api/v1/apps | ✅ 在库；menu 90 permission NULL → **authOnly 语义保持** |

- roles/apps/employees 无重复登记（(method,path) 重复组 0）✅

### 1.5 唯一约束 / 冲突

| 检查 | 口径 | 实测 | 结论 |
|---|---|---|---|
| (method,path) 冲突 | **修正口径** GROUP BY http_method, path_pattern | 0 行 | ✅ |
| uk_menu_app_permission | **修正口径** GROUP BY app_id, permission HAVING count(DISTINCT m.id)>1（全库） | 0 行 | ✅ |
| 一码一菜单 | GROUP BY api_id HAVING count>1 | 0 行 | ✅ |
| 段位零重叠 | V34(WaveC 91155-91156/00900071-00900072/91255-91256/sort 80-81) vs V35(91157-91167/00900073-00900083/91257-91266/sort 92-101) | 零重叠 | ✅ |
| sort 92-101 干净 | sort 90/91 实为 KB 91060/91075（非本树） | 无冲突 | ✅ |

### 1.6 幂等重放（BEGIN...ROLLBACK 事务内重放 V35 三段 INSERT，未写脏数据）

- 重放后：sys_api 91157-91167 仍 11 行、menu_api 91257-91266 仍 10 行 → **零副作用** ✅

### 1.7 未登记端点伪装（fail-closed 不变量）

- DB 侧：无 `/api/v1/modules/`（尾斜杠）、`//`、modules 其它变体登记 ✅
- BFF 侧（读码 `ApiPermissionRegistry.normalizePath`）：单尾斜杠在匹配前被剥除 → `/api/v1/modules/` 等价命中已登记规则（**走权限判权，非 403 绕过**）；未登记变体在 `denyUnmapped=true` 下仍 403「接口未授权映射」。fail-closed 不变量成立 ✅

---

## 2. 全量测试复跑（独立验证）

### 2.1 已独立完成并全绿

| 模块 | 命令（JDK17 + Maven） | 结果 |
|---|---|---|
| mis-common-security | `mvn -pl mis-common/mis-common-security test` | **21/21 PASS**（0 失败 0 错误 0 跳过）✅ |
| mis-admin-bff V35 专项 | `mvn -pl mis-admin-bff surefire:test -Dtest=ModuleControllerRegistryCoverageTest,BffApiRegistryDiffSurveyTest` | `ModuleControllerRegistryCoverageTest` **2/2 PASS** ✅；`BffApiRegistryDiffSurveyTest` 1 例见 §2.3 |
| 前端 typecheck | `cd frontend/mis-admin-web && npm run typecheck` | 交付时点 EXIT=0（零前端改动）；当前工作树 EXIT=2（Wave C WIP，见 §2.2） |

### 2.2 ⚠️ mis-admin-bff / mis-kb / 前端当前无法全量复跑（环境阻塞，非 V35 缺陷）

独立复跑过程中发现**共享工作树正处于 Wave C RAPTOR 开发中（未提交 WIP，文件 10:29~11:05 持续落盘，QA 复跑期间仍在写入）**，导致：

| # | 现象 | 根因（全部 Wave C WIP，与 V35 6 文件无关） |
|---|---|---|
| B-1 | mis-admin-bff **main 编译**失败 `KbFacadeService.java:[951,20]/[1082,38]` | Wave C 并行改 `KbEngineCapabilitiesVO`（10:57:40）/`KbFacadeService`（10:58:44）——**瞬时竞态**；落盘后重读已 11 参匹配，main 编译恢复 |
| B-2 | mis-admin-bff **test 编译**失败 `KbControllerHitTestPermissionTest.java:[60,13]` | Wave C 于 10:58:56 给 `KbHitTestRequest` 追加 `enableRaptor` 字段（13 字段），**未同步既有测试** |
| B-3 | `BffApiRegistryDiffSurveyTest` 断言 1 失败 | Wave C 于 10:59:14 给 BFF `KbController` 新增 `/api/v1/kb/libraries/{id}/raptor/build*` 2 端点，**未同步 `REGISTERED_FIXTURE`** → KB 域导出出现「未登记」误报（见 §2.3 细节） |
| B-4 | mis-kb **test 编译**失败 `RagSettingsServiceTest.java:[111,16]` | Wave C 给 `RagSettingsService` 构造器追加 `KbRaptorService` 参数，**未同步既有测试** |
| B-5 | 前端 typecheck EXIT=2 | Wave C 给前端 `types.ts` 的 `KbRagSettings` 追加 raptor 5 字段，`kb-library-detail-page.tsx`/`kb-library-page.tsx` 尚未补字段（`kb-library-detail-page.tsx` 11:05:11 仍在写） |

**结论**：交付说明记录的 264/430/typecheck EXIT=0 是 Wave C 代码落盘**之前**（10:37-10:51）的稳定态；当前工作树需 Wave C 收口（补测试构造参数、同步 survey fixture、补前端字段）后才可整体复跑。**V35 任务的 6 个文件（2 测试 + 迁移 + 3 文档）不是上述任何一项的根因。**

### 2.3 BffApiRegistryDiffSurveyTest 失败细节（Wave C fixture 缺口，非 V35）

- 独立复跑失败断言：`KB 域导出端点存在未登记项：[GET/POST /api/v1/kb/libraries/{id}/raptor/build*]`（`BffApiRegistryDiffSurveyTest.java:216`）。
- **判定**：V35 修改后的 fixture（roles /menus 纠偏 + employees/apps + V35 modules 10 项 + 断言 4 强化）本身正确，交付时点（10:51）该测试绿；现失败只因 Wave C 在 10:59 之后给 BFF `KbController` 加了 raptor 2 端点而未同步 fixture（违反该测试类自身约定「新增迁移登记端点后必须同步追加 fixture」）。属 Wave C 收口义务。

### 2.4 surefire 报告数字核对

- 交付记录：mis-admin-bff **264**（= 基线 262 + 新增 ModuleControllerRegistryCoverageTest 2；DiffSurvey 为修改非新增），10:37/10:51 两轮均 `Tests run: 264, Failures: 0`；
- 我的独立复跑：`ModuleControllerRegistryCoverageTest` 2/2 PASS（surefire XML 实测 `tests="2" errors="0" skipped="0" failures="0"`）；mis-common-security 21/21；
- 按约定过滤陈旧 `OperLogAspectSensitiveKeyTest$KnownBlindSpots.xml`（Aug 11 16:31，早于本轮）。

---

## 3. 读码核查（非仅测试通过）

| 验收点 | 结论 | 证据 |
|---|---|---|
| V35 SQL 正确性 | ✅ 10 叶子 method/path/权限码/menu_id/段位与交付说明 §5 逐条一致；path_pattern 用 `{id:[0-9]+}`/`{moduleId:[0-9]+}`/`{apiId:[0-9]+}` 隔离写法；幂等 WHERE NOT EXISTS + 固定 ID + (module_id,code)/(method,path) 双去重 + 父行存在检查（与 V30-V32 先例一致）；catalog A.1 先于 leaves A.2（leaves 有 `EXISTS(91157)` 守卫）；menu_api 引用 207/271/272/273 均存在（DB 实测） | V35 文件 + DB 28/28 |
| 与 Wave C V34 无冲突 | ✅ 两迁移文件共存、`flyway:validate` 校验和一致、段位零重叠（§1.5） | DB + validate |
| fixture 纠偏正确性 | ✅ `BffApiRegistryDiffSurveyTest`：roles 两行 `/permissions`→`/menus`（GET+PUT，V4 改名）、补 `GET /api/v1/employees`、补 `GET /api/v1/apps`、V35 10 项追加、断言 4 强化为「非 KB 未登记只剩 agent-ops 3 个动作变量端点」 | git diff + 读码 |
| 自检 SQL 修正 | ⚠️ **#4 (method,path) 已修正**（V35 文件内 GROUP BY http_method, path_pattern，实测 0 行）；**#3 (uk_menu_app_permission) 文件内未修正**（仍旧口径 GROUP BY m.permission,m.app_id,m.id，实测对该数据恒返回 4 行误报）——**已在交付说明 §5.5 如实披露**，修正查询仅记录于文档；DB 用修正口径验证全库 0 冲突 | V35 文件 + DB 演示查询 |
| 差集清单/文档 | ✅ 差集清单 §5/§6 纠偏到位（V35 已补登、roles/apps/employees 已登记不重复补）；api-permission-mapping §3.6/§5 用 V35 实际段位（91157/91158-91167/91257-91266/sort 92-101） | 读文档 |

---

## 4. 边界与反例（try to break it）

| 边界 | 方法 | 结果 |
|---|---|---|
| 迁移幂等重放 | BEGIN...ROLLBACK 事务内重放 V35 三段 INSERT | ✅ 零副作用（11/10 行不变） |
| 未登记端点伪装 | DB 查尾斜杠/变体行；读码 `normalizePath` 语义 | ✅ 无变体行；单尾斜杠归一化后仍命中登记规则（权限判权），未登记变体 denyUnmapped=true 下 403 |
| authOnly 语义 | 9006 permission NULL（menu 90） | ✅ 未误改成权限码 |
| roles/apps/employees 不重复 | (method,path) 重复组查询 | ✅ 0 组 |
| 并发/重复 migrate | flyway:validate 复验 | ✅ 35 migrations validated，校验和稳定 |
| 迁移目录两文件共存 | V34(V34__kb_wave_c_raptor.sql) + V35(V35__modules_api_registry.sql) Flyway 正常排序落地 | ✅ |
| 并行开发竞态 | 复跑捕捉 | ⚠️ 见 §2.2（环境阻塞，非 V35） |

---

## 5. 智能路由判定

**Send To: NoOne**（V35 交付自身验收通过）

- V35 迁移（modules 10 登记）连库核验 **28/28 全 PASS**；
- V35 新增专项测试 `ModuleControllerRegistryCoverageTest` **2/2 PASS**（独立复跑）；
- mis-common-security **21/21 PASS**（独立复跑）；
- 断言期望正确、实现输出正确的判定成立；无「V35 源码 Bug」可路由 Engineer；无「V35 测试断言自身错误」可路由 QA 自修；
- 当前工作树全量复跑受阻（B-1~B-5）均为 **Wave C RAPTOR 未提交 WIP**，非 V35 缺陷 → 作为环境阻塞上报主理人，请协调 Wave C 收口后再全量回归（非 V35 工程师责任）。

---

## 6. 遗留问题 / 已知事项

| # | 事项 | 类型 | 处置建议 |
|---|---|---|---|
| K-1 | V35 文件内嵌自检 #3（uk_menu_app_permission）仍为 V32 旧口径（含 m.id），对该数据恒误报非空；**修正查询仅在交付说明 §5.5** | 注释级缺陷（已披露，非阻塞） | 已应用迁移不可改（校验和）；V36+ 直接用修正口径 `GROUP BY app_id, permission HAVING count(DISTINCT m.id)>1`；运行自检以交付说明 §5.5 修正查询为准 |
| K-2 | `BffApiRegistryDiffSurveyTest.DISPOSITIONS.modules` 与 fixture 注释原写「V34/catalog 91155+api 91156-91165」旧值——**QA 复跑期间（11:01:39）已被修正为 V35/91157/91158-91167** ✅；`ModuleControllerRegistryCoverageTest` 注释/DisplayName 仍写「V34」旧值（`v34NewRegistrationsMatchDesignTable`、buildExpected 注释「catalog 91155 + api 91156-91165」） | 注释/文案漂移（不影响断言，非阻塞） | 建议顺手将 `ModuleControllerRegistryCoverageTest` 注释改为 V35/91157/91158-91167（方法名可保留，避免破坏既有引用） |
| K-3 | **工作树 Wave C RAPTOR WIP**：bff/mis-kb testCompile 失败（B-2/B-4）、survey fixture 未同步 raptor 2 端点（B-3）、前端 typecheck EXIT=2（B-5） | 环境阻塞（非 V35） | 需 Wave C 收口：①补 `KbControllerHitTestPermissionTest`/`RagSettingsServiceTest` 构造参数；②`REGISTERED_FIXTURE` 追加 Wave C V34 raptor 2 端点并同步 KB 净新增断言（28→含 raptor 的口径）；③前端补 raptor 字段；收口后重跑 264/430/typecheck |
| K-4 | 设计文档 §1.0#12「flyway 停 V28」与 §3.1 旧段位表 | 文档陈旧（非阻塞） | 架构师同步（交付说明 §5.5 已指出） |

---

## 7. 验收映射核对（交付说明 §8 → QA 证据）

| 验收 | QA 证据 | 结论 |
|---|---|---|
| modules 10 登记落地 | DB 91157-91167 逐条 + `ModuleControllerRegistryCoverageTest` 2/2 | ✅ |
| 差集真实清零（roles/apps/employees 纠偏） | DB 3008/3009/1011/9006 在库 + fixture 纠偏读码 | ✅ |
| 已登记端点零回归 | mis-common-security 21/21 + 交付 surefire 264/430 记录 + 行为不变量 | ✅（全量复跑受 Wave C WIP 阻塞，见 K-3） |
| uk_menu_app_permission 零冲突 | DB 修正口径 0 行 | ✅ |
| 幂等可重放 | 事务回滚重放零副作用 | ✅ |
| 集成库 V29→V35 顺序落地 | flyway:info 全 Success + validate 通过 | ✅ |

---

*QA 复跑时间线备注：独立验证于 2026-08-12 11:00-11:05 进行；期间 Wave C RAPTOR 代码仍在落盘（最新 mtime 11:05:11），故全量回归以交付时点 surefire 记录 + 可独立复跑的专项用例为准。*
