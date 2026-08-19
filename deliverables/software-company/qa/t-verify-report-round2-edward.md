# T-VERIFY Round 2 验收报告（组织人事域增量 V47 — 回归修复验证）

> 验收人：严过关（Edward / software-qa-engineer）｜日期：2026-08-16
> 性质：独立验收（实跑后端编译 + 核心回归 + 全量回归 + 前端 typecheck），非盲信工程师 summary
> 环境：`deliverables/software-company/qa/mvn-run.sh`（JDK17 + classworlds Launcher）；BFF 零 @SpringBootTest 仅 Mockito；前端 `npm run typecheck`

---

## 1. 门禁结果

| 项目 | 命令 | 结果 |
|---|---|---|
| 后端编译 | `mvn-run.sh -o -pl mis-common,mis-org,mis-admin-bff -am test-compile` | **BUILD SUCCESS（MVN_EXIT=0）**；9 模块全过，BFF 测试类编译通过（32 测试源文件，`BffApiRegistryDiffSurveyTest` 含内） |
| 前端 `mis-admin-web` | `npm run typecheck`（tsc --noEmit, strict+noUnusedLocals） | **PASS · 0 错误（TSC_EXIT=0）** |

> V49 迁移识别：文件已就位 `mis-migrator/.../db/migration/V49__org_dept_staffing_and_posttype_tree_api.sql`，命名 `V{ver}__{desc}.sql` 符合 Flyway classpath 扫描规则；幂等守卫 `WHERE NOT EXISTS(... id ...)` + `(module_id, code)` + `(http_method, path_pattern)` 三重守卫齐备（已读 SQL 核对）。本轮编译未含 mis-migrator 模块运行（DB 依赖），识别性以文件规范 + 守卫正确性确认。

---

## 2. 核心回归：BffApiRegistryDiffSurveyTest（mis-admin-bff）

命令：`mvn-run.sh -o -pl mis-admin-bff test -Dtest=BffApiRegistryDiffSurveyTest`

**结果：`Tests run: 1, Failures: 1, Errors: 0, Skipped: 0`（MVN_EXIT=1）**

⚠️ 注意：**仍红灯，但失败位置已从 Round 1 的「断言 291（dispositions）」转移到「断言 300（agent-ops 精确集合）」**。

| 断言 | 位置 | Round 1 | Round 2 | 结论 |
|---|---|---|---|---|
| 断言① 非 KB 未登记域须有处置结论（dispositions） | L291→**L292** | **FAIL**（agent-ops, depts） | **PASS** | ✅ **Round 1 失败已闭环** |
| 断言④ 非 KB 未登记须恰好 = 3 个 agent-ops 动作变量端点 | L299→**L300** | 未达（被 L291 提前中止） | **FAIL** | ❌ 暴露**潜在（被掩盖）的 agent-ops 注册缺口** |

失败信息（实际 `nonKbUnregistered` 仅含 agent-ops 域，已无 depts/post-types）：
```
[GET /api/v1/agent-ops/sessions/{id}/timing,
 POST /api/v1/agent-ops/agents/{id}/{action},
 POST /api/v1/agent-ops/channels/wecom/bots/{botId}/{action},
 POST /api/v1/agent-ops/mcp/servers/{name}/{action},
 POST /api/v1/agent-ops/sessions/timing/batch,
 POST /api/v1/agent-ops/skills/builder/chat,
 POST /api/v1/agent-ops/skills/parse]
expected: <[POST .../agents/{id}/{action}, POST .../bots/{botId}/{action}, POST .../mcp/servers/{name}/{action}]>
```
**关键判读**：失败集中里**只有 agent-ops 端点，无 depts、无 post-types** → 证明 Round 2 的 V49 迁移 + fixture 补登 + `PostController` 注册三项修复完全生效（depts/{id}/staffing、post-types/tree 及 post-types CRUD 均已被注册表覆盖）。

---

## 3. 全量回归（真实 Maven 运行）

命令：`mvn-run.sh -o -pl mis-org,mis-admin-bff -am test`

**结果：`Tests run: 288, Failures: 1, Errors: 0, Skipped: 0`（MVN_EXIT=1）**

- 与 Round 1（288 例 1 FAIL）**计数完全一致，无新增红灯** → Round 2 修复**未引入任何新回归**。
- 唯一失败仍为 `BffApiRegistryDiffSurveyTest`（同 Round 1 那一个测试，仅断言位移）。其余 287 例全过。
- mis-org 模块 SUCCESS；mis-admin-bff 仅该测试 FAILURE。
- Bug 专项后端用例（PostServiceListFilterTest 17 例、OrgWebClientStaffingAndPostQueryTest 10 例等）均在 287 通过项中 → E.1/E.4/E.5/E.6/E.7/E.8 及后端树/防环/is_leaf 逻辑**未被回归破坏**。

---

## 4. 残留失败根因分析（路由依据）

`nonKbUnregistered` 中 7 个 agent-ops 端点，与 `REGISTERED_FIXTURE`（sys_api 镜像）逐项比对：

| 端点 | 是否在 sys_api 迁移登记 | 判定 |
|---|---|---|
| POST /api/v1/agent-ops/agents/{id}/{action} | 是（拆行登记，{action} 变量） | 预期内「已覆盖」 |
| POST /api/v1/agent-ops/channels/wecom/bots/{botId}/{action} | 是（同上） | 预期内 |
| POST /api/v1/agent-ops/mcp/servers/{name}/{action} | 是（同上） | 预期内 |
| **POST /api/v1/agent-ops/skills/builder/chat** | **是（V46 sys_api 92158）** | **fixture 漏镜像（测试侧陈旧）** |
| **GET /api/v1/agent-ops/sessions/{id}/timing** | **否（全迁移无此 path）** | **真实注册缺口** |
| **POST /api/v1/agent-ops/sessions/timing/batch** | **否** | **真实注册缺口** |
| **POST /api/v1/agent-ops/skills/parse** | **否** | **真实注册缺口** |

佐证（git）：`AgentOpsController.java` 不在 V47 工作区未提交改动中（`git status` 无输出），这 4 个端点由更早的已提交提交（`d3624fb` 智能体运营控制台技能与会话能力增强 / `63a291c` 技能定义增强）引入 —— **属 pre-existing（被 Round 1 掩盖），非 Round 2 引入的回归**。

> Round 1 为何没暴露？Round 1 测试在 L291（depts 域缺处置结论）即断言失败并**提前中止**，根本没跑到 L300 的集合精确比对，故这 4 个 agent-ops 缺口被遮蔽。Round 2 修掉 depts 后，测试顺利越过 L292，在 L300 才把该潜在缺口亮出。

---

## 5. 智能路由判定

| 判定项 | 结论 |
|---|---|
| 测试代码是否有 Bug（需 QA 自修） | **否** —— `BffApiRegistryDiffSurveyTest` 是 SEC-02 安全差集盘点硬门槛，正确执行「所有 /api/v1 端点须登记或给出处置结论」；断言本身无误。**不得为通过而弱化 L300 断言或改 fixture 掩盖**（与 Round 1 验收报告 §4 同口径）。 |
| 源码/注册表是否有 Bug（需反馈 Engineer） | **是** —— 3 个 agent-ops 端点（`sessions/{id}/timing`、`sessions/timing/batch`、`skills/parse`）在 `sys_api` 注册表**漏登**；另 1 个（`skills/builder/chat`，V46 已登记）fixture 未镜像（陈旧）。属安全注册缺口，须补迁移 + 同步 fixture。 |
| 路由决策 | **Engineer（寇豆码）** |
| 是否 Round 2 新回归 | **否** —— 计数与 Round 1 同为 288/1，缺口为被掩盖的存量问题。 |

**转派 Engineer 的具体项：**
1. 源文件 `backend/mis-admin-bff/src/main/java/com/mis/adminbff/controller/AgentOpsController.java` 导出这 4 个端点（已确认）。
2. **新迁移（顺延 V50，因 V49 已占）** 补登 3 个真实缺口端点（列顺序/类型对齐 V40/V46，`NOT EXISTS` 幂等守卫）：
   - `GET /api/v1/agent-ops/sessions/{id}/timing`
   - `POST /api/v1/agent-ops/sessions/timing/batch`
   - `POST /api/v1/agent-ops/skills/parse`
3. **同步 `BffApiRegistryDiffSurveyTest.REGISTERED_FIXTURE`**：补登上述 3 行 + `POST /api/v1/agent-ops/skills/builder/chat`（镜像 V46 既有 92158），使 fixture 与 sys_api 一致。*注：此前轮次该 fixture 由 Engineer 维护，请延续该模式。*
4. **不要**修改 L300 的 `assertEquals` 精确集合断言（保留 SEC-02 回归门禁）。

---

## 6. 总览

- 后端编译：**BUILD SUCCESS（9 模块，BFF 测试类编译通过）**
- 前端 typecheck：**PASS（0 错误）**
- 核心回归 `BffApiRegistryDiffSurveyTest`：**1 run / 1 FAIL（断言位移：L292 已 PASS，L300 FAIL）**
- 全量回归：**288 run / 1 FAIL（与 Round 1 一致，无新红）**
- Round 1 失败（depts/post-types）闭环：**是 ✅**
- 新回归引入：**无 ✅**
- V49 幂等性：守卫齐备 ✅｜Bug 专项（E.1–E.8 后端）未被破坏 ✅
- 路由：**Engineer（寇豆码）**
- **已知遗留数：1**（BffApiRegistryDiffSurveyTest 仍红；根因 = pre-existing agent-ops 注册缺口：3 漏登 + 1 fixture 陈旧；非 Round 2 回归）
