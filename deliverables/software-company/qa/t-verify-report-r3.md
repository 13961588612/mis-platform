# T-VERIFY 验收报告（组织人事域增量 V47：岗位类型多层化 + 三视图合一 + 穿透 + Bug 修复）

> 验收人：严过关（Edward / software-qa-engineer）｜日期：2026-08-16
> 性质：独立验收（实跑 typecheck + 后端编译 + 全量回归 + Bug 专项代码核对），非盲信工程师 summary
> 环境：前端唯一门禁 `npm run typecheck`；后端走 `deliverables/software-company/qa/mvn-run.sh`（JDK17 + classworlds Launcher，绕过损坏的 mvn 直调）；BFF 零 @SpringBootTest 仅 Mockito
> 注：V47 交付物为**工作区未提交改动**（git status 显示 mis-org / mis-admin-bff 多个文件 `M`，未 commit）

---

## 1. 门禁结果

| 项目 | 命令 | 结果 |
|---|---|---|
| 前端 `mis-admin-web` | `npm run typecheck`（tsc --noEmit，strict + noUnusedLocals） | **PASS · 0 错误**（EXIT_CODE=0，日志 `tsc_r3.log` 仅命令头，无 error 行） |
| 后端编译 | `mvn-run.sh -o -pl mis-common,mis-org,mis-admin-bff -am compile` | **BUILD SUCCESS**（9 模块全过：`mis-common`×5 + `mis-common-redis` + `mis-org` + `mis-admin-bff`；`mis-org` 重编 62 文件、`mis-admin-bff` 重编 253 文件，均含 V47 改动；日志 `compile_r3.log`） |

---

## 2. Bug 专项验证（逐项打开文件核对 + 逻辑推演）

### 前端（改 6 + 新 6）

| 编号 | 验收点 | 证据（文件:行 / 逻辑） | 结论 |
|---|---|---|---|
| E.6 | 组织 `<select>` 移出 Popover（根治新建岗位弹窗误关） | `dept-tree-select.tsx:119-135` 组织 `<select>` 在 `<Popover>`（L136）**之外**；Popover 内仅渲染部门树。点组织不触发 DismissableLayer 关闭 | **PASS** |
| E.1 | 三视图合一单树表（无顶部 segmented 切换） | `dept-tree-page.tsx:77-90` 列 = 部门名称/编码/对应组织/**岗位数/已任职/空缺**/排序/状态/操作；行内 `toggleStaffing`(L125) 懒加载 `fetchDeptStaffing`、行内「穿透下钻」`openPierce`(L236)→`OrgPierceDrawer`；无 segmented 控件 | **PASS** |
| E.5 | 岗位类型仅末级可选 + 防环 | `post-type-tree-select.tsx:123` `selectable = (isLeaf \|\| allowNonLeaf) && !excludedIds.has(n.id)`；非末级 `disabled`+仅可展开(L133)；`excludedIds` 以 excludeId 做 BFS 收集自身+后代(L71-95) | **PASS** |
| E.7 | 部门查询改下拉树多选，沿用 deptIds 并集语义 | `page-defs.ts:241` `/system/post` 筛选 `deptIds` 用 `type:'dept-tree-multi'`；`dept-tree-multi.tsx:14` 值 `string[]`、提交 `onChange([...value, id])` 并集；`admin-list-page.tsx:440/1082` 渲染分支 | **PASS** |
| E.8 | 岗位类型管理树表 + 上级类型防环 + 非末级禁删 | `post-type-manage-page.tsx` 树表含层级/上级/末级列(L166-240)；新增/编辑用 `PostTypeTreeSelect allowNonLeaf excludeId={editing?.id}`(L337-342)；`onDelete` 非末级 `row.isLeaf!==1` 拦截+提示(L147-152)；删除按钮 `disabled={row.node.isLeaf!==1}`(L313) | **PASS** |
| E.4 | 组织穿透改行内下钻抽屉 | `org-pierce-drawer.tsx` `Sheet` 抽屉只读浏览；`drillTo`(L95) 沿 `linkedOrgId` 下钻；`pierceVisited`(L93/99) 防循环；面包屑 `popPierceTo`(L109) | **PASS** |
| — | API/类型接线 | `types/api.ts:375` `PostTypeTreeNode` 含 `parentId/isLeaf/children`；`lib/api/post-types.ts:17` `listPostTypeTree`；`lib/api/posts.ts:83-101` `createType/updateType` 带 `parentId`；`features/system/types.ts:1` `FieldType` 含 `'dept-tree-multi'/'post-type-tree'`；`admin-list-page.tsx:454/458` `post-type-tree` 渲染分支 | **PASS** |

### 后端（mis-org 改 7 + 新 1；mis-admin-bff 改 5 + 新 1）

| 验收点 | 证据（PostService.java 等） | 结论 |
|---|---|---|
| V47 迁移幂等 | `V47__post_type_hierarchy.sql` `ADD COLUMN IF NOT EXISTS parent_id BIGINT NOT NULL DEFAULT 0` + `is_leaf SMALLINT NOT NULL DEFAULT 1`；`UPDATE ... IS NULL` 兜底 | **PASS** |
| GET /post-types/tree 返回树 | `PostService.listTypeTree`(L201) + `buildTypeTree`(L215) 按 `childrenByParent` 递归；VO `PostTypeTreeNodeVO` 字段序( id,code,name,sort,status,isLeaf,referenceCount,parentId,children ) 与构造调用(L224) 一致 | **PASS** |
| createType 挂非根父后父 isLeaf=0 | `PostService.createType`(L242) 默认 `isLeaf=1`；`parentId!=0` 时 `refreshLeaf(parentId)`(L271-273) | **PASS** |
| updateType 防自环/防挂子孙 | `updateType`(L282)：`newParentId.equals(id)` 抛「不能挂载到自身」；`isDescendant(type,newParentId,id)`(L293/L360 BFS) 拦截「挂载到自身下级」；变更后 `refreshLeaf(oldParentId)`+`refreshLeaf(newParent)` | **PASS** |
| deleteType 非末级拦截 + 引用拦截 | `deleteType`(L325)：`isLeaf==0` 抛「非末级类型不可删除」；`refs>0` 抛 409 引用拦截；删后 `refreshLeaf(oldParentId)` | **PASS** |
| is_leaf 随增删子类型自动刷新（单一真源） | `refreshLeaf`(L343)：`existsByTenantIdAndParentId` 决定 `isLeaf` 0/1；`SysPostTypeRepository`(L22/25) 派生查询存在 | **PASS** |
| BFF 树接口端到端 | `BFF PostController.listTypeTree`(`/api/v1/post-types/tree`, L78) → `OrgFacadeService.listPostTypeTree`(L232) → `OrgWebClient.listPostTypeTree`(L220，`GET /internal/v1/post-types/tree`)；`PostTypeTreeNodeVO`(BFF) 字段序与 mis-org 对齐 | **PASS** |
| 实体/请求对齐 | `SysPostType`(L32/37 `parentId/isLeaf`)；`SysPostTypeRepository.findByTenantIdAndParentId/existsByTenantIdAndParentId`；`PostTypeCreateRequest/PostTypeUpdateRequest`(mis-org + BFF) 均含 `Long parentId`；`BusinessException(int,String)` 构造器存在 | **PASS** |

---

## 3. 全量回归（真实 Maven 运行）

| 模块 | 命令 | 结果 |
|---|---|---|
| mis-org + mis-admin-bff（-am 含 mis-common 依赖） | `mvn-run.sh -o -pl mis-org,mis-admin-bff -am test` | **Tests run: 288, Failures: 1, Errors: 0, Skipped: 0 → MVN_EXIT=1** |
| 重点用例 | `PostServiceListFilterTest`（mis-org，17 例：部门并集/组织反查/交集/租户隔离） | **PASS（mis-org 模块 SUCCESS）** |
| 重点用例 | `OrgWebClientStaffingAndPostQueryTest`（mis-admin-bff，10 例：PostQuery 逗号串/FieldAlignment/DeptStaffingRoute） | **PASS（10/10，0 failures）** |

### 失败用例（1 项）

- **`com.mis.adminbff.audit.BffApiRegistryDiffSurveyTest.diffSurveyAgainstRegistry`**（SEC-02 安全差集盘点硬门槛）
  - 失败位置：`BffApiRegistryDiffSurveyTest.java:291`（`assertTrue(nonKbUnregistered.stream().allMatch(e -> DISPOSITIONS.containsKey(domainOf(e)))`）
  - 失败信息（乱码还原）：非 KB 未登记端点所属域未在差集清单给出处置结论：**agent-ops, depts** ⇒ expected `<true>` but was `<false>`
  - **根因（源码侧遗漏）**：V47 增量在 `mis-admin-bff/.../controller/DeptController.java:48` **新增** `GET /api/v1/depts/{id}/staffing`（支撑 E.1 行内岗位编制懒加载），但**未写入 `sys_api` 注册表迁移**、且 `REGISTERED_FIXTURE`（L523-784）无此行、`DISPOSITIONS` 无 `depts` 域 → 该端点落入「非 KB 未登记且无处置结论」被红灯拦截。
  - 佐证：`git diff` 显示 DeptController 工作区**新增** `+/staffing`（L21-22）；`git show HEAD:DeptController.java` 无 staffing 端点 → 该端点是 V47 未提交改动新引入，非历史遗留。

---

## 4. 智能路由判定

| 判定项 | 结论 |
|---|---|
| 测试代码是否有 Bug（需 QA 自修） | **否** —— `BffApiRegistryDiffSurveyTest` 正确执行 SEC-02 安全策略（全部 /api/v1 端点须登记或给出处置结论）；断言本身无误，不应为通过而改 fixture 掩盖。 |
| 源码是否有 Bug（需反馈 Engineer） | **是** —— V47 新增 BFF 外部端点 `GET /api/v1/depts/{id}/staffing` 缺 `sys_api` 登记（缺迁移行 + 缺 fixture + `depts` 域无处置结论）。 |
| 路由决策 | **Engineer（寇豆码）** |

**转派修复给 Engineer 的具体项：**
1. 文件 `backend/mis-admin-bff/src/main/java/com/mis/adminbff/controller/DeptController.java:48` —— `GET /api/v1/depts/{id}/staffing`（V47 新增，未登记）。
2. 修复建议（二选一，推荐①）：
   - ① 追加 V47（或新序号）迁移 `INSERT INTO sys_api (...)` 登记 `GET /api/v1/depts/{id}/staffing`（权限码如 `system:dept:staffing:view`，对齐 `system:dept:list`），并同步在 `BffApiRegistryDiffSurveyTest.REGISTERED_FIXTURE` 增加该行；
   - ② 若业务上该端点确属「仅内部/authOnly 豁免」，则应在 `DISPOSITIONS` 增加 `depts` 域处置结论（但该端点对外暴露编制数据，按安全模型应登记而非豁免，故优先①）。
3. 同源提示（本次未被该测试捕获，但同样未登记）：`GET /api/v1/post-types/tree`（V47 新增）亦缺 `sys_api` 登记；且该测试 `registerAllControllers` 未注册 `PostController`，故 `/post-types/tree` 当前「逃逸」检测——建议 Engineer 顺带登记 `post-types/tree` 并把 `PostController` 纳入测试注册清单以闭环覆盖。

---

## 5. 总览

- 前端 typecheck：**PASS（0 错误）**
- 后端编译：**BUILD SUCCESS（9 模块）**
- Bug 专项（E.1/E.4/E.5/E.6/E.7/E.8 + 后端树/防环/is_leaf）：**6/6 + 6/6 PASS（代码层核对）**
- 全量回归：**288 跑，1 FAIL（安全注册缺口，源码侧）**
- 路由：**Engineer**
- **已知遗留数：1**（未登记的 `GET /api/v1/depts/{id}/staffing`；同源 `post-types/tree` 未登记为次要观察项，待 Engineer 一并补登）

> 说明：本轮未修改任何业务/测试实现，仅实跑验证并形成本报告；日志见 `deliverables/software-company/qa/{tsc_r3.log, compile_r3.log, test_r3.log}`。按用户要求未做 commit/push。
