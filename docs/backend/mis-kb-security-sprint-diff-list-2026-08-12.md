# MIS 技术债安全专项 SEC-02：全平台 BFF 端点 vs sys_api 差集清单

- **作者**：寇豆码（软件工程师）
- **日期**：2026-08-12
- **上游**：`docs/backend/mis-kb-security-sprint-design-2026-08-12.md` §5.2（盘点方法）、`deliverables/software-company/kb-security-sprint-prd-2026-08-12.md` SEC-02
- **依据**：`BffApiRegistryDiffSurveyTest`（`backend/mis-admin-bff/src/test/java/com/mis/adminbff/audit/BffApiRegistryDiffSurveyTest.java`）运行时导出（2026-08-12 实跑，3 例全绿）
- **交付性质**：SEC-02 差集盘点的**可执行清单**——非 KB 域未登记端点逐项标注处置结论，**不得静默放行**（Q2 前置硬门槛，主理人评审通过后 T2 才可开工）

---

## 1. 盘点方法（运行时导出为主，静态扫描为辅）

| 项 | 说明 |
|---|---|
| 主方法 | JUnit 测试用 `StaticApplicationContext` 注册 mis-admin-bff 全部 **19 个 Controller**，`RequestMappingHandlerMapping.afterPropertiesSet()` 运行时导出全量 `(method, path)`（含类级前缀拼接、方法条件解析），与全仓迁移（V2~V33）写入 `sys_api` 的注册表 fixture（195 行，随代码固化）做差集 |
| 归一化口径 | 注册表 `{id:[0-9]+}` → Spring 导出 `{id}`，`{var:regex}` → `{var}` 后逐字比较；动作变量 `{action:start\|pause\|...}` 任一候选字面路径已登记即视为覆盖（Controller 一个映射表达多动作、注册表按动作拆行）；Spring 尾段通配 `{*file}` 按「已登记路径以通配前缀开头」判定覆盖 |
| 静态交叉验证 | grep 全仓 `@*Mapping` + 类级前缀拼接（设计 §5.2 辅助路径），防运行时导出漏 Controller（R7） |
| 导出规模 | BFF 导出端点总数（含 `/internal`）**190**；`/api/v1/**` **189**；注册表 fixture **195** 行 |
| 局限 | fixture 从迁移 grep 生成，后续新增迁移登记行需同步追加 fixture（测试类注释已说明）；不查运行时 DB |

## 2. 盘点结论总览

| 域 | 导出端点 | 已登记 | 未登记 | 处置 |
|---|---|---|---|---|
| kb | 70 | 70（V17~V31 42 去重基线 + V32 28 新登记） | **0** | ✅ 差集清零（SEC-03/04，V32） |
| ai | 8 | 8（V6 6 + V33 2 authOnly） | **0** | ✅ 已收敛（V33 补 skill/execute\|apply，U1 裁决） |
| agent-ops | 61 | 58（V19/V20/V28/V29）+ 3 动作变量端点视为已覆盖 | **0** | ✅ 已收敛（动作变量已按拆行登记覆盖） |
| modules | 10 | 0 | **10** | ⚠️ 待运营评估（二期统一登记） |
| roles（菜单绑定） | 2 | 0 | **2** | ⚠️ 待运营评估（二期统一登记） |
| apps | 1 | 0 | **1** | ⚠️ 待运营评估（二期统一登记） |
| employees | 1 | 0 | **1** | ⚠️ 待运营评估（二期统一登记） |
| 其余（IAM/ORG/DEPT/MENU/DICT/DASHBOARD/LOG/AUTH） | — | 全量 | 0 | ✅ 已收敛（V2 seed 等） |

> **净结论**：KB 域与 AI 域差集已在 V32/V33 清零；非 KB 未登记共 **17 项**（5 域），全部标注「待运营评估 / 建议补登」，本期**只盘点不改造**（Q4 裁决）。

## 3. KB 域差集（V32 补登 28 端点，SEC-03/04）

运行时导出 KB 域 70 端点全部命中注册表（42 去重基线 + 28 新登记），差集为 0。V32 净新增登记恰为 READ-01~24 + WRITE-01~04（28 条，逐字对照设计 §1.7 登记表），由 `KbControllerRegistryCoverageTest`（70 条逐条断言 method+path+权限码）锁定。

| 编号 | 方法 | 路径 | 权限码 | menu_id | 状态 |
|---|---|---|---|---|---|
| READ-01 | GET | `/api/v1/kb/categories` | `kb:category:list` | 91032 | ✅ V32 |
| READ-02 | GET | `/api/v1/kb/libraries` | `kb:library:list` | 91033 | ✅ V32 |
| READ-03 | GET | `/api/v1/kb/libraries/{id:[0-9]+}` | `kb:library:list` | 91033 | ✅ V32 |
| READ-04 | GET | `/api/v1/kb/libraries/{id:[0-9]+}/detail` | `kb:library:list` | 91033 | ✅ V32 |
| READ-05 | GET | `/api/v1/kb/libraries/{id:[0-9]+}/engine/settings` | `kb:library:edit` | 91044 | ✅ V32（Q6） |
| READ-06 | GET | `/api/v1/kb/libraries/{libraryId:[0-9]+}/documents` | `kb:document:list` | 91034 | ✅ V32 |
| READ-07 | GET | `/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}` | `kb:document:list` | 91034 | ✅ V32 |
| READ-08 | GET | `/api/v1/kb/libraries/{libraryId:[0-9]+}/acls` | `kb:acl:list` | 91035 | ✅ V32 |
| READ-09 | GET | `/api/v1/kb/qa/sessions/mine` | `kb:qa:ask` | 91036 | ✅ V32 |
| READ-10 | GET | `/api/v1/kb/qa/sessions/{sessionId}` | `kb:qa:ask` | 91036 | ✅ V32 |
| READ-11 | GET | `/api/v1/kb/qa/sessions/{sessionId}/feedback` | `kb:qa:ask` | 91036 | ✅ V32 |
| READ-12 | GET | `/api/v1/kb/operations/qa/sessions` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-13 | GET | `/api/v1/kb/operations/qa/sessions/{sessionId}` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-14 | GET | `/api/v1/kb/operations/qa/sessions-all` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-15 | GET | `/api/v1/kb/operations/qa/feedback` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-16 | GET | `/api/v1/kb/operations/stats` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-17 | GET | `/api/v1/kb/operations/qa/export` | `kb:operation:list` | 91037 | ✅ V32（Q8） |
| READ-18 | GET | `/api/v1/kb/operations/qa/tickets` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-19 | GET | `/api/v1/kb/operations/qa/tickets/{ticketId}` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-20 | GET | `/api/v1/kb/operations/qa/tickets/by-session/{sessionId}` | `kb:operation:list` | 91037 | ✅ V32 |
| READ-21 | GET | `/api/v1/kb/subjects/search` | `kb:acl:list` | 91035 | ✅ V32（Q5） |
| READ-22 | GET | `/api/v1/kb/engine/health` | `kb:engine:view` | 91038 | ✅ V32 |
| READ-23 | GET | `/api/v1/kb/engine/capabilities` | `kb:engine:view` | 91038 | ✅ V32（文档纠偏） |
| READ-24 | GET | `/api/v1/kb/engine/models` | `kb:engine:view` | 91038 | ✅ V32 |
| WRITE-01 | DELETE | `/api/v1/kb/libraries/{id:[0-9]+}` | `kb:library:delete` | 91045 | ✅ V32 |
| WRITE-02 | POST | `/api/v1/kb/qa/feedback` | `kb:qa:feedback` | 91051 | ✅ V32 |
| WRITE-03 | POST | `/api/v1/kb/operations/qa/tickets` | `kb:qa:ask` | 91036 | ✅ V32 |
| WRITE-04 | PATCH | `/api/v1/kb/operations/qa/tickets/{ticketId}` | `kb:operation:list` | 91037 | ✅ V32 |

## 4. AI 域差集（V33 authOnly 2 端点，U1 裁决）

| 方法 | 路径 | 域 | 是否已登记 | 影响评估（fail-closed 后） | 建议动作 | 处置结论（主理人） |
|---|---|---|---|---|---|---|
| POST | `/api/v1/ai/skill/execute` | ai | V33 已登记（authOnly，permission=NULL 挂 92200） | 反向信任端点；未登记时 fail-closed 下 PEP 直接 403，链路断裂 | **authOnly 登记**（登录即可调，技能级判权由 `SkillPermissionChecker` 兜底） | ✅ **U1 已裁决：本期 V33 登记** |
| POST | `/api/v1/ai/skill/apply` | ai | V33 已登记（authOnly，permission=NULL 挂 92200） | 同上 | 同上 | ✅ **U1 已裁决：本期 V33 登记** |

> 说明：V21 刻意不做 URL 级权限码（真实判权粒度在 body `skill_id` → `ai:skill:{id}:run`）；authOnly 由 `ApiService.registry()` 以「permission 为空」原生派生（`ApiService.java:38`），零新机制（设计 §1.3 Q3）。

## 5. 非 KB 域未登记端点（17 项，本期只盘点不改造，Q4）

> 以下逐项为**可执行清单**——每项均有处置结论；主理人评审通过后 T2 才可开工（Q2 前置硬门槛）。
> 默认处置：**待运营评估（列二期统一登记）**；fail-closed 推广后这些端点在 test/integration/本地将 403（配置翻转风险 R2，误杀回滚 = Nacos 一处改回 `false`）。

| 方法 | 路径 | Controller 来源 | 域 | 是否已登记 | 影响评估（fail-closed 后） | 建议动作 | 处置结论（主理人） |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/modules` | ModuleController | modules | 否 | 模块列表 403 | 建议补登（管理台基础读） | ⏳ 待运营评估（二期） |
| GET | `/api/v1/modules/{id}` | ModuleController | modules | 否 | 模块详情 403 | 建议补登 | ⏳ 待运营评估（二期） |
| POST | `/api/v1/modules` | ModuleController | modules | 否 | 新建模块 403 | 建议补登 | ⏳ 待运营评估（二期） |
| PUT | `/api/v1/modules/{id}` | ModuleController | modules | 否 | 编辑模块 403 | 建议补登 | ⏳ 待运营评估（二期） |
| DELETE | `/api/v1/modules/{id}` | ModuleController | modules | 否 | 删除模块 403 | 建议补登 | ⏳ 待运营评估（二期） |
| GET | `/api/v1/modules/{moduleId}/apis` | ModuleController | modules | 否 | 模块 API 列表 403 | 建议补登 | ⏳ 待运营评估（二期） |
| POST | `/api/v1/modules/{moduleId}/apis` | ModuleController | modules | 否 | 绑定模块 API 403 | 建议补登 | ⏳ 待运营评估（二期） |
| PUT | `/api/v1/modules/apis/{apiId}` | ModuleController | modules | 否 | 改模块 API 403 | 建议补登 | ⏳ 待运营评估（二期） |
| DELETE | `/api/v1/modules/apis/{apiId}` | ModuleController | modules | 否 | 解绑模块 API 403 | 建议补登 | ⏳ 待运营评估（二期） |
| GET | `/api/v1/modules/{moduleId}/bindings` | ModuleController | modules | 否 | 模块绑定列表 403 | 建议补登 | ⏳ 待运营评估（二期） |
| GET | `/api/v1/roles/{id}/menus` | RoleController | roles | 否 | 角色-菜单绑定读 403 | 建议补登 | ⏳ 待运营评估（二期） |
| PUT | `/api/v1/roles/{id}/menus` | RoleController | roles | 否 | 角色-菜单绑定写 403 | 建议补登 | ⏳ 待运营评估（二期） |
| GET | `/api/v1/apps` | AppController | apps | 否 | 应用列表 403 | 建议补登 | ⏳ 待运营评估（二期） |
| GET | `/api/v1/employees` | EmployeeController | employees | 否 | 员工列表 403 | 建议补登 | ⏳ 待运营评估（二期） |
| POST | `/api/v1/agent-ops/agents/{id}/{action}` | AgentOpsController | agent-ops | 否（动作变量；已按拆行登记 start/pause/resume/stop） | 其余动作 403 | 若新增动作需同步登记 | ⏳ 待运营评估（二期，动作扩展时登记） |
| POST | `/api/v1/agent-ops/channels/wecom/bots/{botId}/{action}` | AgentOpsChannelController | agent-ops | 否（动作变量；已按拆行登记 enable/disable） | 其余动作 403 | 若新增动作需同步登记 | ⏳ 待运营评估（二期，动作扩展时登记） |
| POST | `/api/v1/agent-ops/mcp/servers/{name}/{action}` | AgentOpsController | agent-ops | 否（动作变量；已按拆行登记 connect/disconnect/discover/call） | 其余动作 403 | 若新增动作需同步登记 | ⏳ 待运营评估（二期，动作扩展时登记） |

> **agent-ops 动作变量说明**：`{action:start|pause|resume|stop}` 是 Controller 单映射多动作，注册表已按动作拆行（V19/V20/V28/V29），运行时 AntPathMatcher 均能命中；盘点工具按「任一候选字面路径已登记即视为覆盖」判定，故上述 3 行实为**已覆盖**，仅当未来新增动作值时才需补登记（R5 口径）。

## 6. 主理人评审记录（留白，评审后回填）

| 日期 | 评审人 | 结论 | 影响 |
|---|---|---|---|
|  |  |  |  |

## 7. 交叉验证与验收对应

- **SEC-02 验收①（差集清单方法/路径/Controller/影响评估/建议动作）**：本文 §5 表逐项满足。
- **SEC-02 验收②（非 KB 域逐项处置结论）**：本文 §5「处置结论」列全部非空；`BffApiRegistryDiffSurveyTest` 断言 4（非 KB 未登记端点所属域全部在 `DISPOSITIONS` 中）绿灯。
- **导出方法说明**：§1 表；QA 可用块① `KbControllerOperLogCoverageTest` 先例复核导出手法（R7）。
- **对照设计 §5.2**：盘点以运行时导出为主（主）、grep 静态扫描为辅（交叉验证）；非 KB 域逐项标注处置结论，符合 Q2「不得静默放行」。
