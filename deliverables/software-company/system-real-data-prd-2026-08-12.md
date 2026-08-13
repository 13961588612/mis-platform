# MIS 系统管理三页示例数据真实化（全站 sample 清零）增量 PRD

- **作者**：许清楚（软件产品经理 / Alice）
- **日期**：2026-08-12
- **类型**：增量 PRD（简单 PRD 格式，聚焦本轮 3 页真实化 + 全站 sample 清零）
- **上游输入**：用户验收反馈（员工/岗位页部门与「部门管理」真实 sys_dept 不一致 → 确认为前端硬编码示例数据）；主理人核实现状清单
- **状态声明**：本文只描述产品需求与验收口径，不含实现代码；技术方案细节（段位、接口签名）由架构师在施工时最终定夺

---

## 1. 项目信息

| 项 | 值 |
|---|---|
| Language | 中文 |
| 前端技术栈 | 沿用仓库既有：React + TypeScript + Vite + shadcn/ui + Tailwind + Zustand（不引入新框架） |
| 后端技术栈 | 沿用既有：Spring Boot 3.2.5 / Java 17 / JPA / PostgreSQL；Flyway 集中在 `mis-migrator` |
| Project Name | `system_sample_clear` |
| 影响模块 | `frontend/mis-admin-web/src/features/system`、`backend/mis-org`、`backend/mis-system`、`backend/mis-admin-bff`、`backend/mis-migrator` |

### 1.1 原始需求复述

用户验收发现「员工管理」「岗位管理」页展示的部门与「部门管理」页（真实 `sys_dept`）对不上，确认为前端硬编码示例数据。用户已拍板：**员工 / 岗位 / 系统参数 3 页全部对接真实数据库，不再使用示例数据；其他页面同样处理，全站 sample 清零**。

---

## 2. 现状盘点（逐项读码核实，直接采信）

| # | 项 | 现状 | 证据 |
|---|---|---|---|
| 1 | 前端通用列表机制 | `AdminListPage` 初始行 = `def.sample`；仅当 `def.loader` 存在才拉真实 API；无 loader 时顶部渲染「当前为示例数据（未接入后端）」警示条 | `admin-list-page.tsx:441`（初始 sample）、`:493-509`（loader 拉取）、`:743-751`（警示条） |
| 2 | 前端页面清单 | `SYSTEM_PAGE_DEFS` 共 12 个页面；**仅 `/system/app` 有 loader**（fetchApps）；`/system/employee`、`/system/post`、`/system/config` 无 loader、纯 sample | `page-defs.ts` 全文件 |
| 3 | 其余 7 页 | org / dept / user / role / menu / dict / module 已走独立组件接真实 API（`OrgListPage`/`DeptTreePage`/`UserListPage`/`RoleListPage`/`MenuManagePage`/`DictManagePage`/`ModulePage`），login-log / oper-log 亦为独立组件 | `keep-alive-outlet.tsx:76-116`（PAGE_MAP） |
| 4 | 员工后端（mis-org） | **已具备完整 CRUD**：`GET /internal/v1/employees?tenantId&deptId`、`GET /names`、`GET /{id}`、`POST`、`PUT /{id}`、`DELETE /{id}`；内部 VO 已含 `deptIds` 多部门 + `posts` 多岗位（含 postName/deptName/isPrimary/status） | `EmployeeController.java`、`EmployeeService.java`、`EmployeeVO.java` |
| 5 | 员工 BFF | **仅透传 `GET /api/v1/employees?deptId=`**（按部门查，且内部实现强制 `status=1` 过滤、`deptId` 必填）；无全量列表、无分页、无新增/编辑/删除透传；BFF VO 被裁剪为**不含 deptIds/posts** | `BFF EmployeeController.java:23`、`OrgFacadeService.listEmployees`、`BFF EmployeeVO.java` |
| 6 | 岗位后端 | **零实现**：`sys_post` / `sys_post_type` 表存在（V1:114/126）；JPA 实体 `SysPost`/`SysPostType` + `SysPostRepository` 已存在，但**无 `SysPostTypeRepository`、无 PostController、无 PostService、无种子数据**；`DeptStaffingService` 已读岗位做编制统计（岗位类型名硬编码 1管理/2技术/3财务） | `SysPost.java`、`SysPostType.java`、`SysPostRepository.java`、`DeptStaffingService.java:118-126` |
| 7 | 系统参数后端 | **零实现**：`sys_config` 表存在（V1:345）且 V2 已种 7 条（security.* 等）；mis-system 无 Config 实体/仓库/服务/控制器；BFF 无透传 | `V1__init_schema.sql:345`、`V2__seed_data.sql:293-299`、mis-system 源码 |
| 8 | 权限体系 | V9 已建 4 页菜单 + 各页 add/edit/delete 按钮权限码（`system:employee:*`、`system:post:*`、`system:config:*` 等已存在）；但 **sys_api 仅登记了 `GET /api/v1/employees`**（V4:1011），岗位/系统参数端点与员工写端点均未登记，`sys_menu_api` 关联缺失 | `V9__add_missing_system_menus.sql:24-53`、`V4__api_path_align.sql:35` |
| 9 | Flyway 段位 | 最新迁移为 **V38**，新迁移从 **V39** 起；登记规范参考 V35-V38：`sys_api` id 段 911xx+、`code` 0090007x+、`sys_menu_api` 912xx+、`sort` 顺延（V35: 91157-91167 / 91257-91266 / sort 92-101；V37: 91177 / 91267） | `mis-migrator` 目录 + V35/V36/V37 文件头注释 |
| 10 | 全站 sample 残留 | 3 页（employee/post/config）为**运行时可见** sample；`page-defs.ts` 中 org/dept/user/role/menu/dict/login-log/oper-log 的 sample 数组为**死代码**（页面走独立组件，不再被 `AdminListPage` 消费）；`/system/app` 的 sample 标注为「接口失败时的兜底样例」；monitor/dashboard/kb/agent 等其他域无 sample 假数据（kb-engine mock 为合法引擎模式） | `page-defs.ts` 全文件、`keep-alive-outlet.tsx` |

### 2.1 关键结论

1. 员工页**后端能力已就绪**（mis-org 内部 CRUD + 多部门/多岗位），缺口集中在 **BFF 透传**与**前端 loader 接入**。
2. 岗位页与系统参数页**后端从零建**，且需**补权限登记迁移（V39+）**与**种子数据**。
3. 「全站 sample 清零」需区分**运行时可见 sample**（3 页，必须清零）与**死代码 sample**（page-defs 中未被消费的数组，建议一并清理，防止未来误用）。

---

## 3. 产品定义

### 3.1 产品目标

1. **3 页真实化**：员工 / 岗位 / 系统参数从「前端假数据」变为「真实读写数据库」，新增/编辑/删除/启停后刷新可见，与组织/部门管理口径一致。
2. **部门同源一致**：员工/岗位页的部门选项与「部门管理」页同源（真实 `sys_dept`），杜绝再次出现「对不上」。
3. **全站无示例数据残留**：运行时任何页面不再展示 sample 假数据；源码中死代码 sample 一并清零，防止回归。

### 3.2 用户故事

- 作为系统管理员，我在「员工管理」页新增员工 E002 后，刷新或切换到其他页面仍能看到该员工，且其部门选项来自真实部门树。
- 作为系统管理员，我在「岗位管理」页维护岗位编制（新增/停用/删除），保存后刷新可见，岗位类型可稳定选择，部门选项与「部门管理」一致。
- 作为系统管理员，我在「系统参数」页修改 `security.password.min_length` 后保存，刷新可见且修改被持久化。
- 作为系统管理员，我打开任何系统管理页面，不再看到「当前为示例数据」警示条，也不再看到与真实数据不符的假数据。
- 作为 QA，我验收全站时可通过「无 sample 警示条 + 页面数据与数据库一致」快速判定是否仍有假数据残留。

---

## 4. 技术规范

### 4.1 需求池（P0 / P1）

优先级约定：**P0 = 必须实现（本轮交付）**；**P1 = 应该实现（随本轮收口）**。

#### P0-员工：员工管理页真实化

| 编号 | 需求 | 优先级 | 验收要点 |
|---|---|---|---|
| EMP-1 | BFF 补**全量列表**透传：`GET /api/v1/employees`（建议支持 `realName` / `deptId` / `status` 筛选；数据量小可全量返回，前端已有分页/筛选，见 Q4） | P0 | 员工页列表来自真实 `sys_employee`，含禁用员工 |
| EMP-2 | BFF 补 `GET /api/v1/employees/{id}` 详情透传 | P0 | 详情与列表一致 |
| EMP-3 | BFF 补新增/编辑/删除透传：`POST /api/v1/employees`、`PUT /api/v1/employees/{id}`、`DELETE /api/v1/employees/{id}`（启停=编辑 status，软删语义沿用后端 `deleted=1`） | P0 | 新增 E002 后刷新可见；编辑/停用/删除后刷新生效 |
| EMP-4 | 前端 employee 页接 **loader**（新增 `lib/api/employees.ts`，字段与真实结构对齐），移除运行时 sample | P0 | 页面不再显示示例数据警示条 |
| EMP-5 | 前端员工表单提交结构与后端对齐：`deptId`（主部门）+ `deptIds`（多部门，首项为主）+ `posts[{postId,isPrimary}]`（多岗位）；任职记录见 **Q1 取舍** | P0 | 保存成功且刷新可见 |
| EMP-6 | 前端部门下拉/任职部门下拉携带**真实 dept id**（当前 `loadDeptOptions` 用 `{value: node.name}`，需改为携带 id），岗位下拉选项来自真实 `sys_post`（替代硬编码 `POST_OPTS`） | P0 | 选项与部门管理页一致；选择后提交使用 id |

#### P0-岗位：岗位管理页从零真实化（归属 mis-org）

| 编号 | 需求 | 优先级 | 验收要点 |
|---|---|---|---|
| POST-1 | mis-org 新增 `PostController` + `PostService`（CRUD + 启停 + 按部门/类型筛选）+ 补 `SysPostTypeRepository` | P0 | 岗位 CRUD 可用 |
| POST-2 | 迁移 V39+ 种 `sys_post_type`（对齐真实岗位类型，至少含管理/技术/财务等）+ 种 `sys_post` 种子（对齐真实部门「总部/总经理办公室」等，见 Q6） | P0 | 页面首屏有真实岗位数据 |
| POST-3 | 迁移 V39+ 登记权限：`sys_api`（岗位/类型端点，段位施工前 ls+全仓 grep 确认，建议接 V38 之后顺延）+ `sys_menu_api` 关联 V9 既有菜单按钮（285-288） | P0 | 权限树可查到岗位端点 |
| POST-4 | BFF 透传：`GET/POST /api/v1/posts`、`PUT/DELETE /api/v1/posts/{id}`、`GET /api/v1/post-types` | P0 | 前端可读写真实岗位 |
| POST-5 | 前端 post 页接 loader（含 post_type 选项），移除运行时 sample | P0 | 页面不再显示示例数据警示条 |

#### P0-系统参数：系统参数页从零真实化（归属 mis-system）

| 编号 | 需求 | 优先级 | 验收要点 |
|---|---|---|---|
| CFG-1 | mis-system 新增 `ConfigController` + `ConfigService` + `ConfigRepository`（CRUD + `config_key` 唯一校验，DB 已有 `uk_config_key`） | P0 | 参数 CRUD 可用；重复 key 被拒 |
| CFG-2 | 迁移 V39+ 登记权限：`sys_api`（系统参数端点）+ `sys_menu_api` 关联 V9 既有菜单按钮（293-296） | P0 | 权限树可查到系统参数端点 |
| CFG-3 | BFF 透传：`GET/POST /api/v1/configs`、`PUT/DELETE /api/v1/configs/{id}` | P0 | 前端可读写真实参数 |
| CFG-4 | 前端 config 页接 loader，移除运行时 sample | P0 | 页面不再显示示例数据警示条；V2 种子 7 条真实参数可见 |

#### P1：全站 sample 清零收口

| 编号 | 需求 | 优先级 | 验收要点 |
|---|---|---|---|
| S1 | 清理 `page-defs.ts` 中**未被消费的 sample 死代码**（org/dept/user/role/menu/dict/login-log/oper-log 等）；`/system/app` 的「接口失败兜底 sample」按 Q5 决策处理 | P1 | 源码中无残留 sample 定义 |
| S2 | 移除/收口 3 页「示例数据」警示条（接入 loader 后自动消失，需确认无其他无后端页面） | P1 | 全站无「当前为示例数据」提示 |
| S3 | 全站 sample 清零核对（QA 侧收口）：grep 全仓 sample/示例数据/演示数据，确认无运行时假数据残留；monitor/dashboard/kb/agent 等域复核 | P1 | 验收报告含清零核对清单 |

### 4.2 UI 设计稿（以现有页面为基准，仅切换数据源，不新增交互）

| 页面 | 保留结构 | 变化点 |
|---|---|---|
| 员工管理 | 现有表格（工号/姓名/性别/主部门/任职数/状态）+ 新建/编辑 Sheet + 任职记录行式编辑器 + 任职数展开子表 | 数据源切换为真实 API；部门下拉/任职部门下拉携带真实 dept id；岗位下拉来自真实 sys_post；表单提交结构对齐后端 |
| 岗位管理 | 现有表格（编码/名称/所属部门/岗位类型/状态）+ 新建/编辑 Sheet + 筛选 | 数据源切换为真实 API；岗位类型下拉来自真实 `sys_post_type`；所属部门下拉携带真实 dept id |
| 系统参数 | 现有表格（参数键/参数值/备注）+ 新建/编辑 Sheet + 筛选 | 数据源切换为真实 API；`config_key` 唯一校验失败时表单内提示 |

> 说明：**不新增交互、不改变页面布局**；仅将「内置演示数据」替换为「真实读写」。

### 4.3 待确认问题（Q&A）

1. **员工任职记录真实化后的数据模型**：前端 assignments 为「行式编辑（一行=部门+岗位+开始时间+主职）」，后端为双子表 `sys_employee_dept`（多部门）+ `sys_employee_post`（多岗位，含 start_date/is_primary），BFF 无任职子表独立接口。取舍：**本页按「主部门 + 多部门 + 多岗位（isPrimary）」简化提交**（对齐 `EmployeeCreateRequest.deptIds + posts`），startDate 字段暂存或映射到 `sys_employee_post.start_date`？需架构师定。
2. **岗位/系统参数后端归属模块**：建议岗位归 mis-org（与 dept/employee 同域，实体/仓库已就绪）、系统参数归 mis-system（与 dict 同域）——架构师最终定夺。
3. **系统参数是否允许运行时改**：`security.*` 类参数可能被启动配置/认证服务读取，运行时修改是否立即生效/是否需要缓存刷新？若仅 CRUD 不接入读取方，需在产品口径上明确「改后不一定立即生效」。
4. **员工列表分页还是全量**：数据量小（V2 种子 1 条）建议 BFF 全量返回、前端沿用现有分页/筛选；是否服务端分页由架构师按规模定。
5. **「示例数据」警示条保留策略**：3 页接入后自动消失；`/system/app` 的「接口失败兜底 sample」是保留为降级预案还是随 sample 清零一并移除？（建议保留降级但标注，或改为空态+错误提示）
6. **岗位类型（post_type）维护方式**：是走字典管理（sys_dict）维护，还是固定枚举/`sys_post_type` 表种子化？现有 `DeptStaffingService` 是硬编码 1/2/3，建议统一到 `sys_post_type` 种子并供前端下拉。
7. **员工提交的岗位为空**（无 posts）是否允许：后端 `posts` 可为 null，前端是否强制至少一条任职（主部门必填，岗位可选）？
8. **岗位删除约束**：已有员工任职（`sys_employee_post` 引用）的岗位是否禁止删除/需软删校验？（参考员工软删语义）

---

## 5. 验收标准

> 每条均为可验证描述，验收时按此逐条核对。

| # | 页面/范围 | 验收标准 |
|---|---|---|
| A1 | 员工管理 | 在员工管理页新增员工 E002 后刷新可见，且「部门」选项来自真实部门树（与部门管理页一致，携带真实 dept id）；编辑/停用/删除后刷新生效；页面无「示例数据」警示条 |
| A2 | 岗位管理 | 岗位列表来自真实 `sys_post`（含 V39 种子岗位，部门为「总部/总经理办公室」等真实部门）；新增岗位保存后刷新可见；岗位类型下拉来自真实 `sys_post_type`；页面无「示例数据」警示条 |
| A3 | 系统参数 | 系统参数页展示 V2 种子 7 条真实参数；新增参数保存后刷新可见；提交重复 `config_key` 被后端拒绝并提示；页面无「示例数据」警示条 |
| A4 | 权限 | 迁移 V39+ 后，岗位/系统参数（及员工写端点）在 `sys_api` 有登记、`sys_menu_api` 关联 V9 既有菜单按钮，权限树可查（验收以管理端菜单/按钮鉴权可用为准） |
| A5 | 全站清零 | 全仓 grep 无「运行时可见」sample/示例数据残留（`/system/app` 降级策略按 Q5 结论执行）；monitor/dashboard/kb/agent 等域复核无假数据；QA 清零核对报告输出 |

---

## 6. 交付范围声明

- 本文覆盖**产品需求 + 验收口径**；接口签名、迁移段位、代码实现由架构师在施工阶段最终确定。
- 本 PRD 不包含：竞品分析（简单 PRD 模式）、UI 视觉重设计、非 3 页之外的业务功能新增。
