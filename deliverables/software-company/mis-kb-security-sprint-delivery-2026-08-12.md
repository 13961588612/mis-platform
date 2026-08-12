# MIS 技术债安全专项 交付说明（T0~T3）

- **作者**：寇豆码（软件工程师）
- **日期**：2026-08-12
- **上游**：`docs/backend/mis-kb-security-sprint-design-2026-08-12.md`（高见远，T0~T3）、`deliverables/software-company/kb-security-sprint-prd-2026-08-12.md`（许清楚，SEC-01~04）
- **交付状态**：✅ 代码 + 测试 + 迁移 + 配置 + 文档全部落地，全量回归绿（见 §4）
- **对应任务**：Task #11 技术债安全专项：工程师实现 T0-T3

---

## 1. TL;DR

技术债 11.3（`denyUnmapped` fail-open→fail-closed）与 11.2 收尾（KB 读/写端点 sys_api 登记）全量落地：

- **T0（SEC-02）**：运行时差集盘点工具 + 差集清单（非 KB 域 17 项逐项处置结论）+ `api-permission-mapping.md` 文档纠偏；
- **T1（SEC-03/04）**：`V32__kb_security_sprint.sql` 补登 28 端点（READ-01~24 + WRITE-01~04）+ 覆盖断言测试；`V33__kb_security_sprint_authonly.sql` 补登 AI 反向信任 2 端点（U1 裁决）；
- **T2（SEC-01 代码）**：`ApiPermissionProperties.denyUnmapped` 默认值 false→**true** + 行为断言测试（默认值/未登记 403/authOnly 放行/豁免/模块停用）；
- **T3（SEC-01 配置 + 回归）**：test/integration/本地三处 `deny-unmapped: true`（prod 核验保持 true）+ 全量回归绿 + 本交付说明。

**验收状态**：未登记 403 已由 2 个测试套件断言（`ApiPermissionDenyUnmappedTest` + `KbControllerFailClosedBehaviorTest`）；已登记零回归由 mis-kb 430 / mis-admin-bff 262 / mis-common-security 21 全绿支撑。

---

## 2. 交付文件清单

### 2.1 新增文件

| 层 | 相对路径 | 说明 | 任务 |
|---|---|---|---|
| 迁移 | `backend/mis-migrator/src/main/resources/db/migration/V32__kb_security_sprint.sql` | 28 端点 sys_api + sys_menu_api 登记（READ-01~24 + WRITE-01~04，零 DDL，幂等，含自检 SQL） | T1 |
| 迁移 | `backend/mis-migrator/src/main/resources/db/migration/V33__kb_security_sprint_authonly.sql` | AI 反向信任 2 端点 authOnly 登记（U1 裁决，permission=NULL 挂 92200） | T1 |
| BFF 测试 | `backend/mis-admin-bff/src/test/java/com/mis/adminbff/audit/BffApiRegistryDiffSurveyTest.java` | SEC-02 盘点工具（19 Controller 运行时导出 + 注册表 fixture 差集；4 断言） | T0 |
| BFF 测试 | `backend/mis-admin-bff/src/test/java/com/mis/adminbff/audit/KbControllerRegistryCoverageTest.java` | SEC-03/04 覆盖断言（KB 70 端点逐条权限码 + V32 28 条与设计表逐字一致） | T1 |
| BFF 测试 | `backend/mis-admin-bff/src/test/java/com/mis/adminbff/security/KbControllerFailClosedBehaviorTest.java` | BFF 侧 fail-closed 行为（未登记 40300 / 已登记零回归 / authOnly 放行） | T2 |
| 安全测试 | `backend/mis-common/mis-common-security/src/test/java/com/mis/common/security/permission/ApiPermissionDenyUnmappedTest.java` | SEC-01 验收（默认值 true / 未登记 403 / authOnly / 豁免 / 模块停用 / 逃生口） | T2 |
| 文档（T0 交付物） | `docs/backend/mis-kb-security-sprint-diff-list-2026-08-12.md` | SEC-02 差集清单（非 KB 域 17 项逐项处置结论 + KB/AI 差集清零证据） | T0 |

> 设计配套文件（架构师交付，非工程师）：`mis-kb-security-sprint-design-2026-08-12.md`、`-class.mermaid`、`-seq.mermaid`、PRD。

### 2.2 修改文件

| 层 | 相对路径 | 改动 |
|---|---|---|
| 安全 | `backend/mis-common/mis-common-security/src/main/java/com/mis/common/security/permission/ApiPermissionProperties.java` | `denyUnmapped` 默认值 false→true（SEC-01，含注释说明影响面） |
| 配置 | `backend/mis-admin-bff/src/main/resources/application.yml` | `deny-unmapped: ${MIS_API_PERMISSION_DENY_UNMAPPED:true}`（本地对齐 + 环境变量逃生口 U3） |
| 配置 | `deploy/nacos-config/test/mis-admin-bff.yaml` | `deny-unmapped: false` → `true` |
| 配置 | `deploy/nacos-config/integration/mis-admin-bff.yaml` | `deny-unmapped: false` → `true` |
| 配置 | `deploy/nacos-config/prod/mis-admin-bff.yaml` | **核验保持** `true`（未改动，已确认仍为 true） |
| 文档 | `docs/backend/api-permission-mapping.md` | ① engine/capabilities「已有」纠偏为「V32 登记」；② 新增 §3.5 28 端点登记表；③ 仅登录 API 段补 authOnly 口径（V33） |

> 无前端改动、无 mis-kb 主代码改动（登记是 DB 行，不触碰 BFF/mis-kb 业务代码）——符合设计 §2.2 边界。

---

## 3. 关键设计决策（实现口径）

1. **双路径执行（Q1）**：prod 已 fail-closed（commit 6db58b0）按既成事实；永久修复 = V32 补登先行；紧急止血预案（Nacos prod 临时 false）见 §6。
2. **默认值改动影响面（Q2）**：所有已知环境均显式配置该属性 → 默认值改动零行为变化，只影响未来未显式配置环境（安全网收紧）。
3. **authOnly 豁免（Q3/U1）**：`skill/execute|apply` 以 permission 为空登记（挂 92200）→ `ApiService.java:38` 原生派生 authOnly；真实判权由 `SkillPermissionChecker` 技能级 fail-closed 兜底；**U1 裁决 = 本期 V33 落地**（非仅列清单）。
4. **非 KB 域只盘点不改造（Q4）**：差集清单 17 项全部标注「待运营评估 / 建议补登 / 已覆盖」，主理人评审通过后 T2 才开工。
5. **权限码裁决（Q5/Q6/Q8）**：`subjects/search`→`kb:acl:list`；`engine/settings` GET→`kb:library:edit`；`qa/export`→`kb:operation:list`（挂既有菜单，零新增码）。
6. **盘点口径**：KB 域导出 70 端点与注册表（42 去重基线 + V32 28）**差集为 0**；V32 净新增恰为 28；V33 净新增恰为 2（测试断言锁死，防超卖/遗漏）。

---

## 4. 全量回归结果（JDK17 + Maven classworlds 直启，2026-08-12）

| 模块 | 测试数 | 结果 | 说明 |
|---|---|---|---|
| mis-common-security | 21 | ✅ 全绿 | 含新增 `ApiPermissionDenyUnmappedTest`（11 例：默认值/未登记 403/已登记 401·403·200/authOnly 放行·拒绝/豁免/模块停用/逃生口） |
| mis-kb | 430 | ✅ 全绿 | 与块②基线一致，零回归 |
| mis-admin-bff | 262 | ✅ 全绿 | 基线 250 + 新增 12（DiffSurvey 1 + RegistryCoverage 2 + FailClosedBehavior 9），零回归 |
| **合计** | **713** | ✅ | 0 失败 / 0 错误 / 0 跳过 |

新增测试明细（mis-admin-bff）：
- `BffApiRegistryDiffSurveyTest`：1 例（SEC-02 盘点 4 断言，实跑导出 190 端点 / 189 api/v1 / fixture 195）
- `KbControllerRegistryCoverageTest`：2 例（KB 70 端点覆盖 + V32 28 条与设计表一致）
- `KbControllerFailClosedBehaviorTest`：9 例（未登记 40300 / READ-01 零回归 / WRITE-01 删除库 / READ-05 Q6 / READ-10 / WRITE-03 / WRITE-04 / authOnly 放行 / authOnly 未登录 401）

---

## 5. SEC-01 验收断言记录（未登记 403 + 已登记零回归）

### 5.1 未登记端点 → 403（fail-closed）

| 场景 | 断言 | 测试 | 结果 |
|---|---|---|---|
| 默认值 `new ApiPermissionProperties().isDenyUnmapped()` | == true | `ApiPermissionDenyUnmappedTest.defaultIsFailClosed` | ✅ |
| 未登记路径 `GET /api/v1/kb/unmapped-endpoint` | 抛 `BusinessException` code=40300，message=「接口未授权映射」 | `ApiPermissionDenyUnmappedTest.unmappedRejectedWhenDenyUnmapped` | ✅ |
| 未登记 BFF 路径 `GET /api/v1/kb/not-registered-yet` | code=40300，message=「接口未授权映射」 | `KbControllerFailClosedBehaviorTest.unmappedEndpointRejectedWith40300` | ✅ |
| 未登记路径 + `denyUnmapped=false`（逃生口） | 放行 `true` | `ApiPermissionDenyUnmappedTest.unmappedAllowedWhenDenyUnmappedFalse` | ✅ |
| 配置逃生口 `MIS_API_PERMISSION_DENY_UNMAPPED=false` | 显式覆盖后 `isDenyUnmapped()==false` | `ApiPermissionDenyUnmappedTest.denyUnmappedCanBeExplicitlyDisabled` | ✅ |

> 完整响应体 `Result{code:40300, message:"接口未授权映射", data:null, traceId}` 由全局异常处理器组装；拦截器层断言异常码与文案（设计 §4.2 口径）。

### 5.2 已登记端点零回归（有权限 200 / 无权限 403 / 未登录 401）

| 场景 | 断言 | 测试 | 结果 |
|---|---|---|---|
| READ-01 有 `kb:category:list` | 放行 | `KbControllerFailClosedBehaviorTest.read01CategoriesZeroRegression` | ✅ |
| READ-01 无权限 | 40300 | 同上 | ✅ |
| READ-01 未登录 | 40100 | 同上 | ✅ |
| WRITE-01 有 `kb:library:delete` | 放行（200） | `write01DeleteLibrary` | ✅ |
| WRITE-01 无权限 | 40300 | 同上 | ✅ |
| READ-05 有 `kb:library:edit`（Q6） | 放行 | `read05EngineSettings` | ✅ |
| READ-05 仅 `kb:library:list` | 40300 | 同上 | ✅ |
| V33 authOnly 登录 | 放行（SkillPermissionChecker 兜底） | `authOnlySkillExecutePassesWhenLoggedIn` | ✅ |
| V33 authOnly 未登录 | 40100 | `authOnlySkillExecuteRejectsWhenNotLoggedIn` | ✅ |
| 已停用模块（moduleStatus=0） | 403「接口所属模块已停用」 | `ApiPermissionDenyUnmappedTest.moduleDisabledStillRejected` | ✅ |
| `/actuator`、`/error` 豁免 | 放行 | `exemptPathsAlwaysAllowed` | ✅ |

### 5.3 配置对齐核验（T3 验收 ①）

| 环境 | 文件 | `deny-unmapped` | 状态 |
|---|---|---|---|
| prod | `deploy/nacos-config/prod/mis-admin-bff.yaml` | `true`（核验保持） | ✅ 未改动 |
| test | `deploy/nacos-config/test/mis-admin-bff.yaml` | `true`（原 false → 翻转） | ✅ |
| integration | `deploy/nacos-config/integration/mis-admin-bff.yaml` | `true`（原 false → 翻转） | ✅ |
| 本地 | `backend/mis-admin-bff/src/main/resources/application.yml` | `${MIS_API_PERMISSION_DENY_UNMAPPED:true}`（原 false → 翻转 + 逃生口） | ✅ |

---

## 6. prod 止血预案操作步骤（Q1 ①，运维执行，非代码任务，归档备用）

> 适用：若 prod KB 未登记端点已 403（KB 读/删库不可用）且 V32 无法立即上线。**正常路径 = V32 迁移落地后注册表 300s 重载即恢复，无需止血。**

1. Nacos 控制台 → `mis-admin-bff`（prod）→ 编辑 `mis.api-permission.deny-unmapped` → `false` → 发布；
2. BFF 下一次 `refresh-interval-seconds=300s` 定时重载注册表后生效（或重启 BFF 立即生效）；
3. 验证 KB 读/删库恢复可用；
4. **恢复条件**：V32 迁移落地 → 28 端点登记确认（`KbControllerRegistryCoverageTest` 绿 / 自检 SQL 通过）→ Nacos 改回 `true` → 验证已登记端点零回归、未登记端点 403；
5. 全程记录操作时间与配置 diff，回传主理人归档。

**回滚预案**（设计 §1.6）：配置翻转后 test/integration 大面积 403 → Nacos 一处改回 `false`（秒级）；代码默认值问题 → 环境显式写 `false` 或回滚代码；迁移登记出错 → Flyway 只追加，V32+ 追加修复迁移（参照 V25 修 V24 先例）。

---

## 7. 验收映射（PRD 验收要点 → 交付证据）

| PRD 验收 | 交付证据 |
|---|---|
| SEC-01 ① 未登记 403 | §5.1（`ApiPermissionDenyUnmappedTest` + `KbControllerFailClosedBehaviorTest` 双套件断言 40300「接口未授权映射」） |
| SEC-01 ② 已登记零回归 | §5.2 + §4 全量回归（mis-kb 430 / mis-admin-bff 262 / security 21 全绿） |
| SEC-01 ③ 三套配置 true | §5.3（prod 核验 + test/integration/本地翻转，逐字核对） |
| SEC-01 ④ 默认值改 true 行为一致 | `ApiPermissionDenyUnmappedTest.defaultIsFailClosed`（`new ApiPermissionProperties()` 断言 true） |
| SEC-02 ① 差集清单 | `docs/backend/mis-kb-security-sprint-diff-list-2026-08-12.md`（方法/路径/Controller/影响评估/建议动作全列） |
| SEC-02 ② 非 KB 域逐项处置结论 | 差集清单 §5 17 项「处置结论」列全部非空 + `BffApiRegistryDiffSurveyTest` 断言 4 锁域级处置 |
| SEC-03 ① READ-01~24 全部登记 | `KbControllerRegistryCoverageTest` + V32 自检 SQL 1（28 行） |
| SEC-03 ② 权限码正确 | V32 自检 SQL permission 分布对照设计 §1.7（`kb:category:list`×1 / `kb:library:list`×3 / `kb:library:edit`×1 / `kb:document:list`×2 / `kb:acl:list`×2 / `kb:qa:ask`×4 / `kb:operation:list`×10 / `kb:engine:view`×3 / `kb:library:delete`×1 / `kb:qa:feedback`×1） |
| SEC-03 ③ uk_menu_app_permission 零冲突 | V32 自检 SQL 2/3（期望 0 行）+ 零新增菜单行 |
| SEC-03 ④ 幂等可重放 | V32 幂等写法（固定 ID + WHERE NOT EXISTS + ON CONFLICT）自检 SQL 5 |
| SEC-04 ① WRITE-01~04 全部登记 | V32 自检 SQL 1（91149-91152 4 行） |
| SEC-04 ② 权限码正确 | `kb:library:delete` / `kb:qa:feedback` / `kb:qa:ask` / `kb:operation:list`（V32 注释 + 测试断言） |
| SEC-04 ③ fail-closed 有权限 200 / 无权限 403 | §5.2 `write01DeleteLibrary`（管理员放行、无权限 403） |
| SEC-04 ④ 审计不回归 | mis-admin-bff 全量回归（262 例）含既有审计测试零回归 |

---

## 8. 遗留与二期候选（非阻塞）

| # | 事项 | 处置 |
|---|---|---|
| U2 观察 | test/integration 翻转 true 后非 KB 未登记端点将 403（modules/apps/employees/roles 等 17 项） | 差集清单已列；误杀回滚 = Nacos 一处改回 false（秒级）；灰度观察 ≥1 发布周期 |
| U4 归档 | 差集清单已放 `docs/backend/`（默认路径） | 如需随 PRD 评审归档 deliverables，可复制一份 |
| U5 审计 | 拦截器 403 不产生 sys_oper_log（既有口径，切面在 Controller 层未到达） | 维持现状；「403 留痕」列二期候选 |
| 二期 | 非 KB 域 17 端点补登记 + 全平台 fail-closed 收紧 | 差集清单逐项已标注建议动作 |
