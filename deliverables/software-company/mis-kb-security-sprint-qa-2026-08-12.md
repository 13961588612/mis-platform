# MIS 技术债安全专项 QA 独立验收报告（块③ T0~T3）

- **QA**：严过关（软件 QA 工程师）
- **日期**：2026-08-12
- **验收对象**：工程师寇豆码交付「MIS 技术债安全专项」（块③，T0~T3）
- **上游**：`docs/backend/mis-kb-security-sprint-design-2026-08-12.md`（高见远）、`deliverables/software-company/kb-security-sprint-prd-2026-08-12.md`（许清楚）、`deliverables/software-company/mis-kb-security-sprint-delivery-2026-08-12.md`（寇豆码）、`docs/backend/mis-kb-security-sprint-diff-list-2026-08-12.md`（寇豆码）
- **环境**：JDK17 `D:\software\jdk-17.0.2` + Maven 3.9.16 classworlds 直启（JDK 默认 PATH 为 1.8，QA 全部测试以显式 JDK17 运行）
- **结论**：✅ **全部通过，路由判定 NoOne**（无源码 Bug、无测试 Bug）

---

## 1. 测试数字加总（QA 独立复跑，非工程师自述）

| 模块 | 工程师自述 | QA 实测（surefire XML 逐文件加总） | 结果 |
|---|---|---|---|
| mis-common-security | 21 | **21**（含新增 `ApiPermissionDenyUnmappedTest` 11 例） | ✅ |
| mis-admin-bff | 262（基线 250 + 新增 12） | **262**（67 个新鲜报告文件，已按 mtime 剔除陈旧 `KnownBlindSpots.xml` 假象） | ✅ |
| mis-kb | 430（零回归） | **430**（100 个新鲜报告文件） | ✅ |
| **合计** | **713** | **713** | ✅ 0 失败 / 0 错误 / 0 跳过 |
| 前端 `npm run typecheck` | 应零改动 EXIT=0 | **EXIT=0**（`tsc --noEmit` 通过；`git diff frontend/` 仅 `tsconfig.tsbuildinfo` 构建缓存，无源码改动） | ✅ |

新增测试明细（QA 实跑确认，与交付说明一致）：
- `BffApiRegistryDiffSurveyTest`：1 例（SEC-02 盘点，实跑导出 **190** 端点 / **189** `/api/v1` / fixture **195**，4 断言）
- `KbControllerRegistryCoverageTest`：2 例（KB 70 端点覆盖 + V32 28 条与设计 §1.7 一致）
- `KbControllerFailClosedBehaviorTest`：9 例（未登记 40300 / READ-01 零回归 / WRITE-01 / READ-05 Q6 / READ-10 / WRITE-03 / WRITE-04 / authOnly 放行 / authOnly 未登录 401）
- `ApiPermissionDenyUnmappedTest`：11 例（默认值 / 未登记 403 / 已登记 401·403·200 / authOnly 放行·拒绝 / 豁免 / 模块停用 / 逃生口）

---

## 2. 设计验收点逐项结论（读码核查）

### 2.1 V32 28 端点登记（SEC-03/04）—— ✅ 通过

- **逐条比对设计 §1.7**：V32 SQL 28 行（id 91125-91152 / code 00900041-00900068 / method / path_pattern / sort 50-77 / menu_id）与设计登记表**逐字一致**（QA 逐行比对，无偏移）。
- **段位无冲突**：V31 末位 sys_api=91124 / code=00900040 / menu_api=91224 / sort=49（V31 SQL 实测），V32 顺延 91125+/00900041+/91225+/sort 50+ 全部空闲；V33 顺延 91153-91154 / 00900069-70 / 91253-54 / sort 78-79 亦空闲。
- **uk_api_method_path 无重复**：INSERT 含 `(http_method, path_pattern)` NOT EXISTS 守卫（第 91-95 行），V30/V31 同款。
- **uk_menu_app_permission 一码一菜单**：28 行 sys_menu_api 全部挂**既有**菜单（91032-91038 页面 / 91044 编辑 / 91045 删除 / 91051 反馈），QA 在 V13/V14 迁移核实这些菜单存在且 permission 码正确；每个码在对应菜单节点只出现一次；零新增菜单行。
- **引用菜单 ID 真实存在**：91032-91038（V13 seed）、91044/91045/91051（V14 buttons）、91060 catalog（V17）——全部存在 ✅。
- **幂等写法**：固定 ID + `WHERE NOT EXISTS` + (method,path) 去重。注：V30/V31/V32 头注释均写「ON CONFLICT DO NOTHING」，实际 SQL 只用 WHERE NOT EXISTS 守卫（三版一致，既有先例）——注释措辞略宽，非 Bug。
- **自检 SQL 有效性**：迁移尾 6 条自检（28 行分布 / 一码一菜单 0 行 / uk_menu_app_permission 0 行 / 冲突回归 0 行 / 幂等回归 / 行为验收）逻辑正确、与测试断言同口径。

### 2.2 V33 authOnly（Q3/U1）—— ✅ 通过

- `V33__kb_security_sprint_authonly.sql` 登记 `POST /api/v1/ai/skill/execute|apply`（91153/91154，00900069/70，menu_api 91253/54，sort 78/79），挂 **92200** 菜单目录（V21 建，QA 核实 `permission=NULL`，不占 uk_menu_app_permission）。
- **authOnly 链路读码确认**（防「authOnly=完全放行」）：
  1. `ReverseTrustInterceptor` `@Order(HIGHEST_PRECEDENCE)` 先执行（`ReverseTrustConfiguration.java:29/53`）——缺 `X-Platform-Token` 视为普通网关调用放行到 PEP；带 token 走双因子校验；
  2. `ApiPermissionInterceptor` 命中 authOnly 规则 → 仅校验登录态（未登录 40100），URL 不做权限码比对；
  3. **Controller 层兜底**：`AiProxyController.java:272/301` 在 execute/apply 中调用 `SkillPermissionChecker.assertCanRun(httpRequest, skillId)`，按 body `skill_id` 拼 `ai:skill:{id}:run` 做技能级 fail-closed（读码确认非放行）。
- `ApiService.registry()`（`ApiService.java:34-47`）以「permission 为空 → authOnly=true」原生派生，与设计 §1.3「零新机制」一致。

### 2.3 fail-closed 行为（SEC-01）—— ✅ 通过

| 场景 | 代码证据 | 测试断言 | 结果 |
|---|---|---|---|
| 代码默认值 | `ApiPermissionProperties.java:18` `denyUnmapped = true` | `defaultIsFailClosed`（new 实例断言 true） | ✅ |
| 未登记端点 | `ApiPermissionInterceptor.java:53-58`：match empty + denyUnmapped → 抛 `BusinessException(FORBIDDEN, "接口未授权映射")`（40300） | `unmappedRejectedWhenDenyUnmapped` / `unmappedEndpointRejectedWith40300` | ✅ |
| 未登记 + denyUnmapped=false（逃生口） | 同段 `return true` 放行 | `unmappedAllowedWhenDenyUnmappedFalse` | ✅ |
| 已登记 + 未登录 | `ApiPermissionInterceptor.java:66-70` → `UNAUTHORIZED`（40100） | `registeredRejectsUnauthenticated` / READ-01 未登录 40100 | ✅ |
| 已登记 + 无权限 | 行 82-87 → `FORBIDDEN`（40300 无权限） | `registeredRejectsWithoutPermission` / WRITE-01 无权限 403 | ✅ |
| 已登记 + 有权限 | 行 82-84 放行 | `registeredAllowsWithPermission` / READ-01 放行 | ✅ |
| authOnly + 未登录 | authOnly 放行在登录校验**之后**（行 66-74） | `authOnlyRejectsWhenNotLoggedIn` / `authOnlySkillExecuteRejectsWhenNotLoggedIn`（40100） | ✅ |
| 模块停用 | 行 60-64：moduleStatus=0 → 403「接口所属模块已停用」（不受 denyUnmapped 影响） | `moduleDisabledStillRejected` | ✅ |
| 豁免 | 行 90-93：`/actuator`、`/error` 放行 | `exemptPathsAlwaysAllowed` | ✅ |

### 2.4 差集清单可信度（SEC-02）—— ✅ 可信

- **19 Controller 运行时导出 vs fixture 195 口径（差值 5 解释）**：导出 190（含 `/internal`）/ 189（`/api/v1`），fixture 195。差值是**盘点口径正常现象**：
  1. 动作变量拆行：`{action:start|pause|resume|stop}` 等 3 个 Controller 单映射在 fixture 按动作拆成 10 行（agents 4 / wecom 2 / mcp 4）而运行时导出仅 3 个模式 → fixture 多出 7 行；
  2. fixture 含个别「已登记但当前 19 Controller 未导出」的残留行（历史上 Controller 路径调整后未清理 sys_api）——与上一条相抵后净差 5/6。
  - 测试只做单向断言（导出 ⊆ 已登记覆盖 + 净增恰为 28/2），不做 fixture ⊆ 导出；`KbControllerRegistryCoverageTest` 对 KB 域做了双向 70 条锁定。差值不构成遗漏。
- **非 KB 17 项处置结论**：QA 从 surefire 报告 system-out 提取运行时 `nonKbUnregistered`，**恰为 17 项**：modules 10 / roles 2 / apps 1 / employees 1 / agent-ops 动作变量 3（已按拆行登记覆盖）——与差集清单 §5 逐项一致，处置结论列全非空。
- **KB 零差集**：KB 导出 70 端点全部命中注册表（42 去重基线 + V32 28），`kbUnregistered` 断言 `Set.of()` 绿灯；V32 净新增断言恰为 EXPECTED_KB_28。
- **AI 零差集**：8 端点（V6 6 + V33 2）全部命中，V33 净新增恰为 EXPECTED_AI_AUTHONLY_2。
- **局限（继承性）**：DiffSurvey/KbCoverage 的「注册表侧」是静态 fixture（从迁移 grep 生成随代码固化），不查运行时 DB；但 QA 已将 V32 SQL ↔ 设计 §1.7 ↔ 测试 fixture 三方交叉比对，逐字一致，登记可信。

### 2.5 配置对齐（SEC-01 ③）—— ✅ 通过

| 环境 | 文件 | deny-unmapped | 核验 |
|---|---|---|---|
| prod | `deploy/nacos-config/prod/mis-admin-bff.yaml` | `true`（值未改动，仅加一行注释） | ✅ git diff 证实 |
| test | `deploy/nacos-config/test/mis-admin-bff.yaml` | `true`（原 false → 翻转） | ✅ |
| integration | `deploy/nacos-config/integration/mis-admin-bff.yaml` | `true`（原 false → 翻转） | ✅ |
| 本地 | `backend/mis-admin-bff/src/main/resources/application.yml` | `${MIS_API_PERMISSION_DENY_UNMAPPED:true}`（翻转 + 环境变量逃生口 U3） | ✅ |
| 代码默认值 | `ApiPermissionProperties.java:18` | `true` | ✅ |
| prod 既成事实 | commit `6db58b0`（2026-08-11 15:57） | prod 已 `true` | ✅ git show 证实 |

### 2.6 文档纠偏 —— ✅ 通过

- `docs/backend/api-permission-mapping.md`：`GET /engine/capabilities`「已有」→「V32 登记（READ-23）」（含纠偏标注）；`GET /libraries`「已有」→「V32 登记（READ-02）」；新增 §3.5 28 端点登记表（与设计 §1.7 一致）；§4 仅登录 API 段补 authOnly 口径（V33 + `ApiService.java:38` 派生说明）。

---

## 3. 边界与反例验证（try to break it）

| # | 反例 | 结果 | 说明 |
|---|---|---|---|
| 1 | 逃生口：`MIS_API_PERMISSION_DENY_UNMAPPED=false` 本地放行未登记端点 | ✅ | application.yml 用标准 Spring 占位符 `${MIS_API_PERMISSION_DENY_UNMAPPED:true}`；属性级测试 `denyUnmappedCanBeExplicitlyDisabled` / `unmappedAllowedWhenDenyUnmappedFalse` 覆盖「显式 false → 放行」语义 |
| 2 | authOnly：无 token 访问 `skill/execute|apply` 仍 401 | ✅ | 拦截器 authOnly 放行位于登录判空之后（行 66-74），未登录 40100；`authOnlyRejectsWhenNotLoggedIn` / `authOnlySkillExecuteRejectsWhenNotLoggedIn` 双断言 |
| 3 | 重复执行 V32/V33 迁移（幂等） | ✅（静态验证） | 固定 ID + `WHERE NOT EXISTS` 守卫：二次执行全部跳过（0 新增/0 报错）；与 V30/V31 同款先例；自检 SQL 5 覆盖幂等回归。本环境无 PG 实例，未做真实 Flyway 重放，SQL 逻辑逐条核过 |
| 4 | 未登记端点伪装已登记路径变体（尾斜杠） | ✅ 无绕过 | `ApiPermissionRegistry.normalizePath`（行 93-95）仅剥离尾斜杠——`/kb/libraries/100/` 归一化为 `/kb/libraries/100` 命中已登记 `{id:[0-9]+}`（等同已登记路径，非越权）；未登记路径尾斜杠变体（如 `/kb/not-registered-yet/`）仍无匹配 → 403。不可借路径变形绕过 fail-closed |
| 5 | 模块停用（mis-kb 未启用时） | ✅ | 命中规则且 moduleStatus=0 → 403「接口所属模块已停用」，不受 denyUnmapped 影响；`moduleDisabledStillRejected` 断言 |
| 6 | 差集 fixture 与运行时导出不一致（差值 5） | ✅ 解释合理 | 见 §2.4：动作变量拆行 + 已登记未导出残留行相抵；KB/AI 双零差集 + 净增 28/2 断言锁死 |
| 7 | 已登记 authOnly 未登录 | ✅ 40100 | `authOnlyRejectsWhenNotLoggedIn`（mis-common-security） |
| 8 | 拦截器 403 是否误伤豁免路径 | ✅ | `/actuator/health`、`/error` 在 denyUnmapped=true 下仍放行 |

---

## 4. 智能路由判定

**路由：NoOne（全部通过）** —— 未发现源码 Bug，未发现测试代码 Bug，无需返工。

- 13 个新增/修改文件（4 测试类 + V32/V33 迁移 + 1 主代码 + 4 配置 + 文档）逐项读码核查通过；
- 713 例后端全量回归 + 前端 typecheck 全绿；
- V32/V33 迁移、fail-closed 行为、差集清单、配置对齐、文档纠偏全部符合设计与 PRD。

---

## 5. 遗留与观察项（非阻塞，建议主理人知悉）

| # | 事项 | 级别 | 说明 |
|---|---|---|---|
| 1 | 迁移头注释「ON CONFLICT DO NOTHING」与实际 SQL（WHERE NOT EXISTS）措辞不一致 | 低 | V30/V31/V32 三版同款，属历史注释惯例；行为幂等性已由 WHERE NOT EXISTS 保证，无需修改 |
| 2 | 注册表加载失败 → 空注册表 + denyUnmapped=true → 全 `/api/v1/**` 403（可用性风险放大） | 中 | `ApiPermissionRegistryLifecycle.reloadQuietly` 捕获异常仅告警（`ApiPermissionConfiguration.java:77-85`）。fail-closed 收紧前该失败=全放行，收紧后=全 403；依赖 300s 定时重载自愈。属 fail-closed 预期姿态，非本期引入缺陷，建议运维监控注册表加载日志 |
| 3 | DiffSurvey/KbCoverage 注册表侧为静态 fixture，不读运行时 DB | 低 | 继承性设计（设计 §5.2 允许路径）；后续新增迁移登记需同步追加 fixture（测试注释已说明）；QA 已三方交叉比对 V32 SQL ↔ 设计 §1.7 ↔ fixture 逐字一致 |
| 4 | test/integration 翻转 true 后非 KB 17 端点将 403 | 中 | 已在差集清单 §5 逐项列处置结论；误杀回滚 = Nacos 一处改回 false（秒级）；U2 灰度观察 ≥1 发布周期 |
| 5 | 拦截器 403 不产生 sys_oper_log（审计盲区） | 低 | 既有口径（切面在 Controller 层未到达），PRD R6 / 设计 §4.2 已记录；「403 留痕」列二期候选 |
| 6 | prod yaml 值未改仅加注释（git diff 可见） | 信息 | 与交付说明「核验保持 true（未改动）」措辞略宽，实际新增 1 行注释，值保持 true；无影响 |

---

## 6. 结论

- **SEC-01（fail-closed）**：代码默认值 true、三套配置 + 本地全 true、未登记 40300「接口未授权映射」、已登记零回归（200/403/401 三分支）——全部满足 PRD 验收①~④。
- **SEC-02（差集盘点）**：运行时导出 190/189 vs fixture 195；KB/AI 双零差集；非 KB 17 项逐项处置结论，QA 实跑输出与清单完全一致。
- **SEC-03/04（V32 补登）**：28 端点与设计 §1.7 逐字一致、段位无冲突、一码一菜单、幂等可重放；WRITE-01~04 全登记，删除知识库权限码正确。
- **Q3/U1（V33 authOnly）**：2 端点 authOnly 登记 + SkillPermissionChecker 技能级兜底链路读码确认。
- **QA 总判定**：✅ 通过，路由 **NoOne**。
