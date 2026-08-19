# QA 独立验证报告（部门管理 + 岗位管理 增量）

> 验证人：严过关（Yan / software-qa-engineer）｜日期：2026-08-16
> 性质：第二道质量门（独立验证，未盲信工程师 summary，逐项打开文件核对 + 实际重跑可执行检查）
> 环境注记：前端无 vitest，唯一门禁 `npm run typecheck`；后端 Maven 启动器已修复（直调 classworlds Launcher + 切 JDK17），可真实跑 JUnit。

---

## 1. 门禁结果：Typecheck

| 项目 | 命令 | 结果 |
|---|---|---|
| 前端 `mis-admin-web` | `npm run typecheck`（tsc --noEmit，strict + noUnusedLocals） | **0 错误**（NODE_MODULES_OK，退出码 0，已独立复跑确认） |

---

## 2. 测试用例清单与执行结论

### 2.1 前端核心逻辑测试（自建 harness，可真实执行）
> 环境无 vitest，采用：项目自带 tsc 编译真实源码 + 测试替身（stub）+ node(CommonJS) 运行。
> 位置：`frontend/mis-admin-web/qa-tests/`

| 测试文件 | 用例数 | 覆盖点 | 结论 |
|---|---|---|---|
| `post-query.spec.ts` | 10 | `posts.ts` toParams 数组 `map(Number).join(',')` 逗号序列化、空数组/空值跳过、单值兼容 | **10/10 PASS** |
| `filter-logic.spec.ts` | 15 | `admin-list-page.tsx` L562-567 `serverFilterSignature`（仅服务端键变化才重拉）、L769-788 `filtered`（服务端键跳过、客户端键正常过滤、multiselect 数组包含匹配） | **15/15 PASS** |

**前端合计：24/24 PASS（退出码 0，已重跑确认）。**

### 2.2 后端 mis-org 单元测试（真实 Maven 运行）
> 文件：`backend/mis-org/src/test/java/com/mis/org/service/PostServiceListFilterTest.java`

| 内部类 | 用例数 | 覆盖点 |
|---|---|---|
| `DeptFilter` | 4 | POST-02 部门多选并集 + 单 deptId 兼容 |
| `OrgFilter` | 4 | POST-03 orgIds 经 findByOrgId 反查部门 + Q7 精确匹配 |
| `IntersectionSemantics` | 3 | POST-04 deptIds ∩ orgDeptIds 交集 + 空交集返回空 |
| `LegacyFilters` | 2 | postTypeId / status 单条件 |
| `TenantIsolation` | 2 | tenantId 隔离（租户2 数据不泄露） |
| `NoConstraint` | 2 | 空集语义（空数组等同不约束） |

**mis-org 合计：17/17 PASS（BUILD SUCCESS，真实运行）。**

### 2.3 后端 mis-admin-bff 契约测试（真实 Maven 运行）
> 文件：`backend/mis-admin-bff/src/test/java/com/mis/adminbff/client/OrgWebClientStaffingAndPostQueryTest.java`
> 用 HttpServer 假 mis-org，验证 BFF→内部服务契约。

| 内部类 | 用例数 | 覆盖点 |
|---|---|---|
| `PostQuerySerialization` | 6 | `listPosts` 逗号串序列化、null/空省略、无二次编码 |
| `FieldAlignment` | 2 | 反序列化对齐 postType / isPrimary；并验证安全忽略未知字段 postTypeName / avatar |
| `DeptStaffingRoute` | 2 | `getDeptStaffing` 路径拼装 `/internal/v1/depts/77/staffing` + tenantId 注入 |

**mis-admin-bff 合计：10/10 PASS（BUILD SUCCESS，真实运行）。**

---

## 3. 验收走查（对照 PRD §8，P0/P1 共 9 项）

| 编号 | 关键验收 | 证据 | 结论 |
|---|---|---|---|
| DEPT-01 | 选组织 → 部门列表随组织变化 | `dept-tree-page.tsx` L289-315（loadTree 按 orgId）、L354 setOrgId、L355 onOrgChange 切换组织重载树；`fetchDeptTree(orgId)`→`GET /depts/tree` | **PASS** |
| DEPT-02 | 部门展示已配置岗位（名+类型），空态正确 | `dept-tree-page.tsx` L524-560 岗位标签「名·类型」+ 空态「未配置岗位」；数据来自 `sys_post where dept_id=部门` | **PASS** |
| DEPT-03 | 三指标 = `GET /depts/{id}/staffing`，缺编=岗位数−任职数 | `dept-tree-page.tsx` L524-560 渲染三指标；BFF `DeptStaffingVO`(postCount/filledCount/vacantCount)；`DeptStaffingService.staffing` vacantCount=postCount−filledCount（与 Q1/Q8 一致） | **PASS** |
| DEPT-04 | 任职明细 = 各岗位任职人 + 部门任职人员 | `dept-tree-page.tsx` L765-836 弹窗用 `posts[].holders` + `employees`；来源 `GET /depts/{id}/staffing` | **PASS** |
| DEPT-05 | 去 mock、与岗位管理实时同源 | `dept-tree-page.tsx` 无 mock 残留（仅注释提及）；数据全部取自 `fetchDeptStaffing` + `fetchDeptTree` | **PASS（静态确认+源码核对）** |
| POST-01 | 新增/编辑部门 = 树形单选，提交单值 deptId | `dept-tree-select.tsx` 单选 `onChange(node.id)` 回填单值；`page-defs.ts` form `deptId → dept-tree` | **PASS** |
| POST-02 | 部门查询 = 多选，后端支持 deptIds | `PostController` 透传 `deptIds`；`PostService.list` 部门并集；`PostServiceListFilterTest.DeptFilter` 覆盖 | **PASS** |
| POST-03 | 组织查询 = 多选，后端支持 orgIds（经 dept.org_id 反查） | `PostController` 透传 `orgIds`；`PostService.list` findByOrgId 反查 + Q7 精确匹配；`OrgFilter` 覆盖 | **PASS** |
| DEPT_POST-04 | 组织×部门组合 = 交集 | `PostService.list` deptIds ∩ orgDeptIds；`IntersectionSemantics` 覆盖（含空交集返回空） | **PASS** |

> 注：原 PRD 概览列出 DEPT-01~05、POST-01~04 共 9 项 P0/P1；其中 POST-04（组合语义）在需求池为 P1，已一并核对通过。

---

## 4. 偏差复核（工程师自报 3 处字段偏差）

| # | 架构图描述 | 真实代码字段 | 对齐结论 |
|---|---|---|---|
| ① | `PostStaffingVO.postTypeName` | 后端 `PostStaffingVO.postType`、内部 mis-org 同名 `postType`、前端 `PostStaffingVO.postType` | ✅ 三端一致；架构图为文档笔误 |
| ② | `EmployeeLiteVO(id,name,avatar)` | 后端 `EmployeeLiteVO(id,name,isPrimary)`、内部同名、前端 `isPrimary` | ✅ 一致；架构图 avatar 为笔误 |
| ③ | BFF POJO 与前端类型 | 已逐字段核对 BFF 与内部 mis-org（record 字段一致）、BFF 与前端 TS 类型（postType / isPrimary） | ✅ 已对齐真实字段 |

**运行时风险判定**：Jackson 反序列化采用安全策略（未知字段忽略，已在 `OrgWebClientStaffingAndPostQueryTest.FieldAlignment` 中以「含 postTypeName/avatar 的脏响应」用例证明可正常解析且不报错）。三处偏差均不导致运行时问题。

---

## 5. 智能路由判定

| 判定项 | 结论 |
|---|---|
| 源码是否有 Bug（需反馈 Engineer） | **否** |
| 测试代码是否有 Bug（需 QA 自修） | **否** |
| 路由决策 | **NoOne（全部通过）** |

---

## 6. 总览

- 前端 typecheck：**0 错误**
- 前端测试：**24/24 PASS**（自建 harness，真实执行）
- 后端 mis-org 测试：**17/17 PASS**（真实 Maven 运行）
- 后端 mis-admin-bff 测试：**10/10 PASS**（真实 Maven 运行）
- 验收走查：**9/9 PASS**（DEPT-01~05、POST-01~04）
- 偏差复核：**3 处均为文档笔误，代码正确对齐，无运行时风险**
- 路由：**NoOne**

> 说明：本验证未修改任何业务实现代码，仅新增 QA 测试源码（前端 qa-tests/、后端两个 *Test.java）与 Maven 修复脚本（qa/mvn-run.sh）。
