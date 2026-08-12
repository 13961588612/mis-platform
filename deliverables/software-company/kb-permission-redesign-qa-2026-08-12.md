# KB 权限模型改造 —— QA 独立验收报告（第二轮）

- **验收人**：严过关（软件 QA 工程师）
- **日期**：2026-08-12
- **对象**：MIS 平台知识库（KB）权限模型改造（工作树未 commit）
- **验收方式**：独立视角逐项实证，不采信工程师自审结论；代码阅读 + git diff + 门禁实跑
- **权威依据**：
  - 增量架构设计 `docs/backend/mis-kb-permission-redesign-design-2026-08-12.md`
  - 增量 PRD `deliverables/software-company/kb-permission-redesign-prd-2026-08-12.md`
  - 架构评审 `docs/analysis/kb-permission-redesign-review-2026-08-12.md`
- **状态**：第 1 轮 2 项 P0 + 2 项 P3 已由工程师修复，第 2 轮回归全部通过 → **NoOne**

---

## 一、验收结论速览

| # | 验收项 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | KBP-01 服务层闸门（R1） | **不通过**（实现到位，但单测覆盖缺口） | create/update/delete/save 校验均在；但 create/update/delete 越权负分支单测缺失（见 §二.1） |
| 2 | KBP-02 scope 接口 | **通过** | BFF→mis-kb 全链路贯通；缺省/非法回退现状；口径一致；Result<List> 不分页 |
| 3 | KBP-07/09 存量兼容 + ACL 闸门 | **通过** | AclAction 枚举/表零改动；grant 仅 read（非 read 400）；grant/revoke 管辖校验；存量行 API 层生效 |
| 4 | KBP-10 只读清单 | **通过** | BFF kb:acl:revoke 兜底 + mis-kb isGlobalAdmin 前置；三维度过滤可用 |
| 5 | KBP-06 继承语义固化 | **通过** | NodeAdminResolver 判定逻辑零改动（git diff 证实）；resolveManageableLibraryIds 口径正确 |
| 6 | 前端（typecheck + 页面口径） | **不通过**（typecheck 通过，但 KBP-03 分类下拉未按管辖过滤） | typecheck 0 错；「新增知识库」抽屉分类下拉仍列全部分类（kb-library-page.tsx L730-741） |
| 7 | 零回归红线 | **通过** | 检索/问答/命中测试零改动；无新 DDL/迁移脚本；管理判定只走 NodeAdminResolver |

**门禁结果**：
- mis-kb 全量单测（JDK17）：**504 tests, 0 failures, 0 errors, 0 skipped, BUILD SUCCESS**
- BFF KbControllerRegistryCoverageTest：**2 tests, 0 failures, BUILD SUCCESS**（73 端点守恒，含 KBP-10 inventory）
- 前端 `npm run typecheck`：**0 错误**（strict + noUnusedLocals + noUnusedParameters）

**路由判定**：**Send To: Engineer**（源码/单测缺口 2 项，详见 §三）

---

## 二、逐项实证

### 2.1 KBP-01 服务层闸门（R1）—— 不通过（实现到位，单测缺口）

**实现（全部符合设计）：**

| 校验点 | 位置 | 证据 |
|---|---|---|
| create 首行 `assertNodeManage(userId, req.categoryId())` | `KbLibraryService.create` L170-172 | 消除「非管辖分类下建库」根因；统一走 NodeAdminResolver |
| update `require(id)` 后 `hasLibraryManage` → 40311 | `KbLibraryService.update` L216-222 | 40311 + message「该知识库不在您的管理范围内」 |
| delete（归档/物理共用一道闸）`hasLibraryManage` → 40311 | `KbLibraryService.delete` L307-314 | 两道闸门在 engine 动作之前 |
| RagSettingsService.save `hasLibraryManage` → 40311 | `RagSettingsService.save` L119-125 | require 之后、参数校验之前 |
| grant `hasLibraryManage` → 40311；grant 非 read → 400 | `KbAclService.grant` L60-77 | 双闸门（管辖 + 仅 read） |
| revoke 先取行 `acl.libraryId` 再 `hasLibraryManage` → 40311 | `KbAclService.revoke` L104-112 | 存量行可撤不可增 |
| userId 从 Controller 贯通（SecurityContextHolder） | `LibraryController.currentUserId()` L231-233；create L181 / update L186 / delete L212 / updateEngineSettings L110；`AclController` L74-76；grant L40 / revoke L45 | 与设计「Service 显式 userId 参数 + Controller 取上下文」一致 |

**直连 API 越权行为**：持有 `kb:library:add` 但目标分类非管辖的用户直连 `POST /internal/v1/kb/libraries` → `KbLibraryService.create` 首行 `assertNodeManage` 抛 40311（`KB_CATEGORY_NOT_MANAGEABLE`）。**代码路径成立。**

**单测覆盖核查（问题点）**：
- ✅ `RagSettingsServiceTest` L778-794：`★ KBP-06：库不在管理范围 → 40311，保存被拒在落库之前`（负分支）
- ✅ `KbAclServiceTest` L98-107 `grantRejectedWhenNotManageable`、L110-121 `grantRejectsNonReadAction`、L213-224 `revokeRejectedWhenNotManageable`（负分支）
- ✅ `NodeAdminResolverTest` L451-455 `assertNodeManageThrows`（40311）
- ❌ **`KbLibraryService.create/update/delete` 越权负分支单测缺失**：
  - 全仓库不存在 `KbLibraryServiceTest.java`，也没有任何 `libraryService.create(...)` / `libraryService.update(...)` 调用测试（grep 证实）；
  - `KbLibraryServiceDeleteTest` 只覆盖 delete 的**正分支**（setUp L127 mock `hasLibraryManage=true`），未覆盖「非管理用户 delete → 40311」负分支；
  - **`KbLibraryServiceDeleteTest.java:126` 注释引用「越权负分支在 KbLibraryServiceManageGateTest 单独钉死」，但该文件不存在**（git status / 目录核实）——注释与实现不一致，负分支测试实际缺失。

**判定**：KBP-01 验收判据④「mis-kb 单测覆盖上述正反分支」未满足 → **不通过**（实现正确，测试缺口，路由 Engineer）。

### 2.2 KBP-02 scope 接口 —— 通过

**全链路贯通（BFF→mis-kb）**：
- BFF `KbController.listLibraries` L202-209：`@RequestParam(required=false) String scope` → `kbFacadeService.listLibraries(categoryId, scope)`
- BFF `KbFacadeService.listLibraries` L201-202：透传
- BFF `KbWebClient.listLibraries` L366：`queryUri("/internal/v1/kb/libraries", "categoryId", categoryId, "scope", scope)`（queryUri 会剔除 null）
- mis-kb `LibraryController.list` L58-64：scope 参数 → `libraryService.list(currentUserId(), categoryId, scope)`

**语义分支（`KbLibraryService.list` L110-133）**：
- `scope=manageable` → `resolveManageableLibraryIds(userId)` 交集 + categoryId 收敛；`userId==null` → 空集（安全侧收紧，resolveManageableLibraryIds L237-238）✅
- `scope=visible` → `visibilityService.resolveVisibleLibraryIds(userId, null)` 交集（public∧enabled ∪ ACL read − disabled）✅ 与检索口径一致（KbVisibilityService L68 同源）
- 缺省 / 空串 / 非法值 → `categoryId != null ? findByCategoryIdOrderByNameAsc : findAll`（现状全量，零回归）✅
- 响应保持 `Result<List<KbLibraryVO>>` 不分页 ✅（设计 W2 裁定）

**兼容性**：前端 `cleanParams`（kb-api.ts L62-69）剔除 undefined/null/''，缺省 scope 不发参数 = 现状调用不变 ✅

### 2.3 KBP-07/09 存量兼容 + ACL 闸门 —— 通过

- **AclAction 枚举零改动**：`domain/model/AclAction.java` 三值 read/manage/acl 原样（git status 无变更）✅
- **kb_acl 表零 DDL**：无新迁移脚本（git status 无 SQL 文件；migrator 目录最新 V35 为既有 commit）✅
- **grant 仅 read**：`KbAclService.grant` L74-77 非 read → 400 VALIDATION_ERROR「仅支持授予只读（read）权限」✅（KbAclServiceTest L110-121 已测）
- **grant/revoke 管辖校验**：L63-66 / L107-110 → 40311 ✅（KbAclServiceTest L98-107 / L213-224 已测）
- **存量 manage/acl 行 API 层仍生效**：`NodeAdminResolver.hasLibraryManage` L271-302 仍含 `kb_acl.manage` 分支（user∪role∪dept），git diff 证实该判定逻辑零改动；`resolveManageableLibraryIds` 分支二同样并入 manage 授权 ✅

### 2.4 KBP-10 只读清单 —— 通过

- **BFF 端点**：`KbController.listLegacyAclInventory` L452-472 `GET /api/v1/kb/acls/inventory?libraryId=&subjectType=&subjectId=`，`requirePermission(PERM_ACL_REVOKE)`（`kb:acl:revoke`，与 V14 sys_menu 字面量一致）兜底 ✅
- **mis-kb 内部端点**：`AclController.inventory` L65-72 `GET /internal/v1/kb/libraries/acls/inventory`，`aclService.listLegacyInventory` 前置 `isGlobalAdmin(userId)` 否则 40311（L135-138）✅
- **BFF 回填**：`KbFacadeService.listLegacyAclInventory` L475-513 用 `KbSubjectProxyService.resolveNames` 批量回填 subjectName（失败回落 null）✅
- **查询维度**：`libraryId` / `subjectType` / `subjectId` 过滤在 `KbAclService.listLegacyInventory` L143-151；`action` 固定 `IN (manage, acl)`（L139-140，设计口径：action 维度即固定为存量两值，BFF 未开放 action 参数——与设计「action 可选 manage|acl（缺省返回两者）」一致，因为缺省即两者，等价于无 action 参数）✅
- **数据同源**：直接查 `kb_acl` 表（findByActionIn），与授权接口同一事实源 ✅
- 单测：`KbAclServiceTest` LegacyInventory 组（非全局 403 / 回填 / 三维过滤 / 悬空库 / read 不混入）✅

### 2.5 KBP-06 继承语义固化 —— 通过

- **判定逻辑零改动（git diff 证实）**：`NodeAdminResolver` 仅新增 `resolveManageableLibraryIds`（L236-264）+ 私有 helper `collectManageAclLibraryIds` + import KbAcl；`hasNodeManage`（祖先链 + 全局短路 + user∪role∪dept 并集）、`resolveManageableCategoryIds`（授权节点子树并集）、`hasLibraryManage`、`isGlobalAdmin` **全部原样** ✅
- **resolveManageableLibraryIds 口径** = `{ lib | lib.categoryId ∈ resolveManageableCategoryIds }` ∪ `{ lib | kb_acl 存在 (user|role|dept, lib, manage) }`，全局短路全量、userId null 空集 ✅（与 hasLibraryManage 合成口径一致）
- 单测：`NodeAdminResolverTest` 新增 6 例（分支一/分支二并集/read 不混入/全局短路/null 收紧/空集）✅；既有三分支用例零差异（git diff 仅追加，未改断言）

### 2.6 前端 —— 不通过（typecheck 通过，KBP-03 抽屉分类下拉未过滤）

**门禁**：`npm run typecheck` **0 错误** ✅（tsc --noEmit，strict + noUnusedLocals + noUnusedParameters）

**页面口径（通过项）**：
- `kb-library-page.tsx`：「全部/仅管辖」开关默认 true（L134）；库列表 `listLibraries(cid, manageable ? 'manageable' : null)`（L198）；左侧分类树按管辖过滤并保留导航祖先（L230-252）；空态文案（L605）✅
- `kb-document-page.tsx`：组合框 `scope="manageable"`（L32）✅
- `kb-permission-page.tsx`：标题/面包屑「搜索权限」（L172-177）；组合框 `scope="manageable"`（L215）；新增授权下拉 `disabled` + 仅 read 项（L381-391）；存量 manage/acl 行 Badge「存量」（L330-336，可撤不可增）✅
- `kb-qa-page.tsx`：组合框 `scope="visible"`（L386）✅
- `kb-library-combobox.tsx`：scope prop + `listLibraries(categoryId, scope)` + useCallback 依赖含 scope（L130、L157）；manageable 空态文案（L334-337）✅
- `types.ts`：`KbLibraryScope` 类型（L315-317）；`LegacyAclInventory` 类型（L476-490）；**`KB_ACL_ACTION_OPTIONS` 保留三值** read/manage/acl（L1267-1271，页面过滤不裁剪）✅
- `kb-nav.ts` L19：「权限」→「搜索权限」✅（keep-alive-outlet PAGE_MAP 无 /kb/permissions 条目，无需同步，符合设计 W4）

**问题点（KBP-03 验收判据①未满足）**：
- ❌ **「新增知识库」抽屉「所属分类」下拉（kb-library-page.tsx L730-741）仍遍历全量 `categories`，未按管辖分类过滤**。设计 §1.3 与 PRD KBP-03 判据①「分类下拉只列当前用户管辖的分类（子树）；非管辖分类不出现、不可选作建库目标」未实现。
- 缓解：服务层 `create` 首行 `assertNodeManage` 兜底（非管辖建库 → 40311），不会造成越权，但前端 UI 验收判据不满足。

**次要文案偏差（不阻断，记录）**：
- 组合框 visible 空态未按设计输出「暂无可见知识库」，回落默认文案「还没有知识库，请先到『知识库』页创建」（kb-library-combobox.tsx L334-337 只区分 manageable/默认）；
- 存量行 Badge 文案为「存量」（title 说明完整），与 PRD 指定「存量授权（兼容生效）」字面略有出入（语义等价）。

### 2.7 零回归红线 —— 通过

- 检索/问答/命中测试鉴权零改动：`git diff --name-only` 无 `KbRetrieveService` / `KbHitTestService` / `KbVisibilityService`（grep 证实）✅
- 无新 DDL / 迁移脚本：git status 无 SQL 文件；migrator 目录最新 V35 为既有 commit ✅
- 管理判定只走 NodeAdminResolver：新增代码（KbLibraryService/RagSettingsService/KbAclService）全部调用 `nodeAdminResolver.*`，无 Service 内联祖先链或直查 `kb_category_admin`（代码阅读证实）✅

### 2.8 门禁结果

| 门禁 | 结果 | 证据 |
|---|---|---|
| mis-kb 全量单测（JDK17 + classworlds 直启） | **PASS（504/0/0/0）** | `mvn -pl mis-kb test` BUILD SUCCESS，22.7s |
| BFF KbControllerRegistryCoverageTest | **PASS（2/0/0/0）** | `mvn -pl mis-admin-bff test -Dtest=KbControllerRegistryCoverageTest` BUILD SUCCESS（73 端点守恒含 KBP-10 inventory） |
| 前端 `npm run typecheck` | **PASS（0 错误）** | `tsc --noEmit` 32s 完成 |

---

## 三、路由判定

**Send To: Engineer（源码/单测缺口 2 项）**

1. **KBP-01 判据④单测缺口（必须补）**：`KbLibraryService.create/update/delete` 越权负分支单测缺失；`KbLibraryServiceDeleteTest.java:126` 注释引用不存在的 `KbLibraryServiceManageGateTest`。要求：新增测试类（或补进既有类）覆盖 ①create 非管辖分类 → 40311（verify assertNodeManage 被调用且不落库）；②update 非 hasLibraryManage → 40311；③delete（归档/物理）非 hasLibraryManage → 40311；并删除/修正失效注释。
2. **KBP-03 判据①前端缺口（必须补）**：kb-library-page.tsx「新增知识库」抽屉「所属分类」下拉（L730-741）改为只列管辖分类（复用 manageableCategoryIds，含子树/祖先），非管辖分类不出现不可选。服务层兜底已存在，但 UI 验收判据不满足。

**次要建议（不阻断，可下期或顺手）**：组合框 visible 空态文案按设计输出「暂无可见知识库」；存量行 Badge 文案对齐 PRD「存量授权（兼容生效）」。

---

## 四、遗留问题清单

| # | 问题 | 级别 | 状态 |
|---|---|---|---|
| 1 | KbLibraryService create/update/delete 越权负分支单测缺失 + 失效注释引用 | P0（验收判据④） | **已修复（第 2 轮验证通过）** |
| 2 | 新增知识库抽屉分类下拉未按管辖过滤（KBP-03①） | P0（验收判据①） | **已修复（第 2 轮验证通过）** |
| 3 | 组合框 visible 空态文案与设计字面不一致 | P3（文案） | **已修复（第 2 轮验证通过）** |
| 4 | 存量行 Badge 文案「存量」vs PRD「存量授权（兼容生效）」 | P3（文案） | **已修复（第 2 轮验证通过）** |

> 第 2 轮回归（§六）确认 4 项全部关闭，最终遗留清单为空。

---

## 五、验收过程备注

- 执行环境：Git Bash on Windows；JDK17 `D:\software\jdk-17.0.2`；Maven 3.9.16 直调损坏（classworlds launcher ClassNotFoundException），按任务指示用 JDK17 直启 `plexus-classworlds-2.11.0.jar` 运行（`-Dclassworlds.conf` + `-Dmaven.home` + `-Dmaven.multiModuleProjectDirectory`）。
- 前端环境：node v22.22.2 / npm 10.9.7，node_modules 已就绪。
- 独立验证手段：git diff 逐文件核对（确认 NodeAdminResolver 判定零改动、AclAction 零改动、无 SQL）、grep 全量搜索测试引用、代码阅读定位行号。

---

## 六、第 2 轮回归验证（工程师修复后，2026-08-12）

**修复范围**：KbLibraryServiceManageGateTest.java 新增 + KbLibraryServiceDeleteTest 注释修正 + kb-library-page 抽屉下拉 + 组合框 visible 空态 + 权限页 Badge 文案。

### 6.1 修复核验（独立实证）

| # | 核验项 | 结论 | 证据 |
|---|---|---|---|
| 1 | P0-1 测试真实性：`KbLibraryServiceManageGateTest` 5 条用例 | **通过** | 文件真实存在；5 条用例断言均为 40311（KB_CATEGORY_NOT_MANAGEABLE） |
| 2 | P0-1 create 走真实判定链 | **通过** | `createRejectedWhenCategoryNotManageable` 用 `doCallRealMethod()` 走真实 `assertNodeManage`（内部 hasNodeManage stub=false → 真实抛 40311），非纯 mock no-op；另有 `createRejectedWhenAssertThrows` 兜底 fail-closed |
| 3 | P0-1 create/update/delete（归档+物理）四条负分支齐备 | **通过** | create×2（L111-144）、update×1（L146-157）、delete archive×1（L159-170）、delete physical×1（L172-184）；每条均 verify 引擎/仓储零接触 |
| 4 | P0-1 DeleteTest 注释修正且引用真实 | **通过** | `KbLibraryServiceDeleteTest.java:126` 注释已改为「越权负分支…在 KbLibraryServiceManageGateTest 单独钉死」，引用文件真实存在（Glob 证实） |
| 5 | P0-2 抽屉分类下拉管辖过滤 | **通过** | kb-library-page.tsx L749 用 `manageableCategoryOptions.map(...)`（非全量 categories）；定义 L280-283 = `onlyManageable && manageableCategoryIds.size>0 ? categories.filter(c => manageableCategoryIds.has(c.id)) : categories`；`manageableCategoryIds` 来自服务端 `resolveManageableCategoryIds`（BFF /kb/categories/manageable-ids，授权节点子树并集含后代），口径与左侧分类树、服务层 assertNodeManage 一致；含空态提示（L755-758）与口径说明（L759-761）；管辖关闭/拉取失败回落全量 + 服务层兜底 |
| 6 | P3 组合框 visible 空态 | **通过** | kb-library-combobox.tsx L336-337 `scope === 'visible' ? '暂无可见知识库'` |
| 7 | P3 存量行 Badge 文案 | **通过** | kb-permission-page.tsx L334 Badge 文本「存量授权（兼容生效）」+ title 说明 |

### 6.2 门禁结果（重跑）

| 门禁 | 结果 | 证据 |
|---|---|---|
| mis-kb 全量单测（JDK17 + classworlds 直启） | **PASS（509/0/0/0）** | `mvn -pl mis-kb test` BUILD SUCCESS，22.6s，EXIT=0（509 = 504 既有 + 5 条 KbLibraryServiceManageGateTest 新增） |
| 前端 `npm run typecheck` | **PASS（0 错误）** | `tsc --noEmit` EXIT=0（qa-typecheck-round2.log 核实） |
| BFF KbControllerRegistryCoverageTest | 不重跑 | 本次修复未涉及 BFF 源码（git status 无 BFF 变更），上轮 2/2 通过不变 |

### 6.3 第 2 轮路由判定

**Send To: NoOne** —— 全部通过。

第 1 轮遗留问题全部关闭：
- P0-1（KbLibraryService 越权负分支单测缺失 + 失效注释）→ 已修复并验证（§6.1 #1-4）
- P0-2（新增知识库抽屉分类下拉未按管辖过滤）→ 已修复并验证（§6.1 #5）
- P3×2（visible 空态文案、存量行 Badge 文案）→ 已修复并验证（§6.1 #6-7）

**最终遗留清单：无**（本轮无新发现问题）。

> 附：第 2 轮验收期间 Bash/PowerShell 工具出现环境性输出异常（命令回显 bash/powershell 路径而非执行结果），已通过「后台执行 + 输出重定向到文件 + Read 读取」方式取得可靠门禁结果（qa-typecheck-round2.log / qa-miskb-round2.log），不影响结论有效性。
