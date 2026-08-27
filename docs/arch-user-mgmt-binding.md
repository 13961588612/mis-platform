# 架构设计：用户管理重构 + 员工↔用户绑定 + 权限部门结构修复

> 主理人齐活林（因架构师智能体本环境不可用，代为产出设计与任务分解）
> 关联需求：用户管理 5 条（删左树/查询/列、按手机绑定、非员工用户、同步与禁用级联、权限部门结构修复）
> 已确认决策：D1 employee_id 改可空；D2 工号列表与表单都移除；D3 按手机查重提示+多员工手动选；D4 权限部门结构 bug 纳入本次。

---

## 1. 现状关键事实（已核实，file:line）

- `backend/mis-iam/.../domain/entity/SysUser.java:25` `employeeId` `@Column(nullable=false)` —— 当前每用户必绑员工。
- `SysUser` 实体**无 realName/phone 列**；当前用户名/手机全靠 BFF 从绑定员工 enrichment（`UserAggregateService.enrich`）。
- `UserService.create` (UserService.java:152) 强制 `existsByEmployeeId` + `requireEmployee` → 必须改造成 employeeId 可空、且不强制建员工。
- `UserService.update` (UserService.java:186) **不处理 realName/phone**，且无绑定态防御。
- `UserService.page` (UserService.java:81) 仅按单 `deptId` 经员工反查，需扩展为多维（姓名/手机/组织/多部门）且同时覆盖「绑定用户(走员工)」与「非绑定用户(走自身 userOrg/userDept)」。
- `UserAggregateService.create` (UserAggregateService.java:60) **无条件先建员工再建账号** —— 必须重构为创建双模式。
- `UserAggregateService.enrich` (UserAggregateService.java:194/202) 无员工时 `realName` 取 `user.realName()` 但 `phone` 错置 `null`，且不解析用户自身 org/dept。
- `UserCreateRequest`(iam)/`UserCreateRequest`(bff) 均强制 `employeeId`/`employeeNo`/`deptId`；`UserUpdateRequest` 无 realName/phone。
- `OrgEmployeeClient` 缺「按手机查员工」方法。
- `EmployeeService.update` (EmployeeService.java:250) 无条件 `setRealName/setPhone/setStatus` —— 加同步钩子的天然位置。
- 前端 `user-list-page.tsx`：左部门树(orgId+deptTree)、查询仅用户名+状态、列含工号；perms Sheet(第827-872行) 多组织树扁平拼接致结构错乱。

## 2. 数据模型

### 2.1 Flyway 迁移（mis-iam，`backend/mis-iam/src/main/resources/db/migration/` 取当前最大 V 号 +1）
```sql
ALTER TABLE sys_user ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE sys_user ADD COLUMN real_name VARCHAR(64);
ALTER TABLE sys_user ADD COLUMN phone VARCHAR(32);
-- 历史数据：employee_id 保持原值；real_name/phone 由上线脚本从绑定员工回填（非阻塞，可留 NULL 后续同步）
CREATE INDEX idx_sys_user_employee_id ON sys_user(employee_id);
CREATE INDEX idx_sys_user_real_name ON sys_user(real_name);
CREATE INDEX idx_sys_user_phone ON sys_user(phone);
```
- 移除 `UserService.create` 中的 `existsByEmployeeId` 唯一性校验（允许多用户绑同一员工；D3 手动选即暗示 1员工:N用户）。

### 2.2 实体 `SysUser.java`
- `employeeId` 改 `@Column(name="employee_id", nullable=true)`。
- 新增 `private String realName;` / `private String phone;` + getter/setter。

## 3. 绑定模型
- 关系：**1 用户 : 0..1 员工**（`employee_id` 可空）；**1 员工 : 0..N 用户**（允许多账号绑同一员工）。
- 判定 `isBound = user.employeeId != null`。
- 绑定时 `sys_user.real_name`/`phone` 由员工同步（req4），前端禁填；非绑定时用户自有。

## 4. API 契约

### 4.1 mis-org 新增「按手机查员工」
- `EmployeeController.listAll` 增加 `@RequestParam(required=false) String phone`；`EmployeeService.listAll` 增加 `phone` 参数（精确匹配或 LIKE，建议精确 `=` ）。
- 或新增轻量端点 `GET /internal/v1/employees/by-phone?tenantId=&phone=` 返回 `List<EmployeeLiteVO(id,realName,deptId,deptName,orgName)>`。建议新增该端点（前端只需 id/姓名/部门）。

### 4.2 mis-iam `UserService` 改造
- `UserCreateRequest`：`employeeId` 改 `@Nullable Long`；新增 `realName`、`phone`、`List<Long> orgIds`、`List<Long> deptIds`；去掉 `@NotNull`。
- `UserService.create`：
  - 若 `employeeId` 提供 → `requireEmployee` 校验存在+租户；realName/phone 以 form 优先、缺失则取员工（防御）。
  - 若 `employeeId` 为 null → 创建非员工用户，`realName`/`phone` 取自 form（realName 必填校验），`orgIds/deptIds` 可选（D3）。**不再要求建员工**。
  - 写 `sys_user.real_name`/`phone`；`replaceUserOrgs/Depts` 接受空列表（非员工可无）。
- `UserUpdateRequest`：新增 `realName`、`phone`（可选）。`UserService.update`：若 `user.employeeId != null` 且请求含 realName/phone → 抛 `BUSINESS`（绑定用户禁改，与前端双保险）。否则写入 `sys_user.real_name/phone`。
- `UserService.page`：新增 `realName`、`phone`、`List<Long> orgIds`、`List<Long> deptIds`；返回 `Page<UserVO>`。过滤策略见 §6。
- 新增内部端点 `POST /internal/v1/users/sync-by-employee`：`{employeeId, realName, phone, status}` → 批量更新 `employee_id=该值` 的用户：realName/phone 覆盖；`status=0` 时这些用户置 0；`status=1` 时**不**改用户状态（req4 恢复需手工）。`permVersion` 自增触发缓存失效。
- `UserVO` / `toVo`：填充 `realName`（来自 `sys_user.real_name`）、`phone`（来自 `sys_user.phone`）、`orgIds`/`deptIds`（已有）。

### 4.3 mis-org → mis-iam 反向调用（员工改 → 同步用户）
- 新增 `backend/mis-org/.../client/OrgIamClient.java`（对称于 `OrgEmployeeClient`）：`POST /internal/v1/users/sync-by-employee`。
- `EmployeeService.update` (EmployeeService.java:250) 末尾加钩子：保存后若 realName/phone/status 变更，调用 `orgIamClient.syncByEmployee(emp.getId(), realName, phone, status)`。
  - 注意方向：mis-org 调 IAM，与现有 IAM→org 反向，需确认 IAM 对内网可达（参考 `OrgEmployeeClient` 的 baseUrl 机制，同集群内网可达）。

### 4.4 BFF 改造
- `IamUserVO`：补 `phone`、`orgIds(List<String>)`、`deptIds(List<String>)`（对齐 IAM UserVO）。
- `UserAggregateService.page`：透传新过滤参数到 `IamWebClient.pageUsers`（新增 realName/phone/orgIds/deptIds）。
- `IamWebClient.pageUsers`：新增 `realName, phone, orgIds, deptIds` 查询参数（沿用 uriBuilder 编码规范，参考现有 username 处理）。
- `UserAggregateService.create` 重构为双模式：
  - `UserCreateRequest`(bff)：`employeeId` 改可选；移除 `employeeNo`/`deptId` 必填；新增 `realName`、`phone`、`orgIds`、`deptIds`。
  - 若 `employeeId` 提供（绑已有员工）→ 调 IAM `createUser`（带 employeeId，不建员工）。
  - 若 `employeeId` 为 null → 调 IAM `createUser`（employeeId=null，realName/phone/orgIds/deptIds 入参）。
  - **删除** `orgWebClient.createEmployee` 的强制调用与补偿逻辑（除非未来需要）。
- `UserAggregateService.update`：若 `existing.employeeId() != null`，**不**把 realName/phone 转发给员工（前端已禁填，后端防御：忽略这些字段）。其余（username/status/orgIds/deptIds/roles）照旧。
- `UserAggregateService.enrich` 修复：
  - 无员工时：`realName = user.realName()`、`phone = DesensitizeUtils.phone(user.phone())`（修正第202行 null bug）；
  - 无员工时 org/dept：用 `user.deptIds()` 取主部门 → `OrgWebClient.getDept` 取 `orgId` → `orgNames` 解析 `orgName`；`deptName` 取该部门名。
- BFF 新增 `GET /api/v1/employees/by-phone?phone=` → 调 mis-org `by-phone` 端点，返回轻量员工列表（`OrgWebClient.listEmployeesByPhone`）。
- `UserController.page`、`UserCreateRequest`、`UserUpdateRequest`(bff) 同步扩展字段。

## 5. 前端

### 5.1 `user-list-page.tsx` 重构（需求1）
- **删除**左侧部门树（orgId 下拉 + deptTree + deptId 过滤整段）。
- 顶部查询：用户名(text)、姓名(text→realName)、组织(multiselect, `orgOptionsLoader` 同员工管理)、部门(multiselect dept-tree)、手机号码(text→phone)。组织/部门参考 `page-defs.ts` `/system/employee` 的 `serverFilterKeys:['deptIds','orgIds']` + `loadOrgOptions` 模式；查询参数经 `pageUsers` 透传。
- 结果列（顺序）：用户名、姓名、组织、部门、手机、状态、创建时间（**去工号**）。表格组件沿用现有 resizable table / `StatusBadge` / 表头吸顶（参考员工管理页风格）。
- 详情卡片：相应去工号，显示组织/部门。

### 5.2 创建表单双模式（需求2 + D2 + D3）
- 移除工号字段。字段：用户名(必填)、姓名(必填)、手机、邮箱、组织(多选可选)、部门(多选可选)、角色。
- 手机输入框 blur 时调 `GET /api/v1/employees/by-phone?phone=`：
  - 命中 0 → 普通非员工用户（提交 employeeId=null）。
  - 命中 1 → 弹提示「该手机已存在于员工【姓名/部门】，是否绑定？」确认后写 `employeeId`，姓名禁用（同步）。
  - 命中多 → 提示 + 员工下拉手动选；选后写 `employeeId`，姓名禁用。
- 提交 `createUser({username, realName, phone, email, orgIds, deptIds, roleIds, employeeId?})`。

### 5.3 编辑表单（需求4）
- 若该用户 `employeeId` 非空（绑定）→ 姓名/手机输入框 `disabled`（禁改）；仅可改 用户名/状态/组织/部门/角色。
- 非绑定用户 → 姓名/手机可改。

### 5.4 权限部门结构修复（需求5 + D4）
- 根因：`loadPermsDepts` 把多组织树 `flattenDepts` 后**扁平拼接、depth 各自从0起**，合并成无归属平铺列表 → 视觉结构错乱。
- 修复：按组织分组渲染——每个组织一个标题(header) + 其下**独立缩进**的部门树（保留各自 depth）；或改为一次 `fetchDeptTree` 仅允许单选组织。推荐按组织分组，结构正确且契合「组织→部门」心智。
- 纯前端改动，不动 `fetchDeptTree` 数据本身。

### 5.5 类型
- `types/api.ts` `UserView`：`employeeNo?` 改可选（非员工为 null）；`realName`/`phone`/`orgId`/`orgName`/`deptId`/`deptName` 保持；新增可选 `employeeId?`。
- `lib/api/users.ts`：`createUser` 去 `employeeNo`/`deptId` 必填，加 `employeeId?`、`orgIds?`、`deptIds?`；`UserPageQuery` 加 `realName?`、`phone?`、`orgIds?`、`deptIds?`；`pageUsers` 透传。
- 新增 `lib/api/employees.ts` `listEmployeesByPhone(phone)`（或并入现有 employees API）。

## 6. 分页多维过滤策略（UserService.page）
核心：realName/phone 已落 `sys_user` 列（绑定用户同步写入），故统一在 `sys_user` 上过滤；dept/org 维度需解析候选 userId 集合（绑定走员工主部门、非绑定走自身 userDept）。

1. `realName`：对 `sys_user.real_name` 做 LIKE（若提供）。
2. `phone`：对 `sys_user.phone` 做精确/ LIKE（若提供）。
3. `deptIds`/`orgIds` → 解析候选 `allowedDeptIds`（同 `EmployeeService.listAll` 的 org∩dept 交集逻辑，复用 `deptRepository.findByOrgId`）。
4. 候选 userId：
   - 绑定用户：`orgEmployeeClient.listEmployeeIdsByDept` 不适用；改为 `userRepository.findByEmployeeDeptIn(allowedDeptIds)`？——实际员工主部门在 `sys_employee.dept_id`。需 `SELECT DISTINCT user_id FROM sys_user WHERE employee_id IN (SELECT id FROM sys_employee WHERE dept_id IN allowed AND tenant_id=?) `。
   - 非绑定用户：`userDeptRepository.findByDeptIds(allowedDeptIds)` → userId 集合。
   - 两者 UNION 得 `candidateUserIds`。
5. 最终 `userRepository.searchV2(tenantId, appId, status, usernameLike, realNameLike, phone, candidateUserIds, pageable)`：username/realName/phone 为 AND 模糊；`candidateUserIds` 为空集合时（传了 dept/org 但无命中）返回空页；为 null（未传 dept/org）时不限制。
6. BFF `enrich` 已按 employeeId 区分取 realName/phone/org/dept，无需改过滤逻辑。

## 7. 任务清单（按实现顺序，含依赖）

### 后端 mis-org
- T1 `EmployeeService.listAll` 增加 `phone` 参数 + `EmployeeController` 暴露（或新增 `by-phone` 轻量端点 `EmployeeLiteVO`）。
- T2 新增 `OrgIamClient`（调 IAM `sync-by-employee`）。
- T3 `EmployeeService.update` 钩子：变更后调 `orgIamClient.syncByEmployee`。

### 后端 mis-iam
- T4 Flyway 迁移（employee_id 可空 + real_name/phone + 索引）。
- T5 `SysUser` 实体加 realName/phone、employeeId 可空。
- T6 `UserCreateRequest`/`UserUpdateRequest` 扩展字段；`UserService.create` 双模式 + 去 existsByEmployeeId 唯一；`UserService.update` 绑定防御。
- T7 新增 `POST /internal/v1/users/sync-by-employee`（`UserController` + `UserService.syncByEmployee`）。
- T8 `UserService.page` 扩展参数 + `searchV2` 仓储方法 + 候选 userId 解析。
- T9 `UserVO`/`toVo` 填充 realName/phone/orgIds/deptIds。

### 后端 mis-admin-bff
- T10 `IamUserVO` 补 phone/orgIds/deptIds。
- T11 `IamWebClient.pageUsers` 透传新参数；新增 `listEmployeesByPhone`（经 OrgWebClient）。
- T12 `UserAggregateService.create` 双模式重构（删强制建员工）；`update` 绑定防御；`enrich` 非员工修复。
- T13 `UserController` + `UserCreateRequest`/`UserUpdateRequest`(bff) 扩展；新增 `GET /api/v1/employees/by-phone`。
- T14 `OrgWebClient` 新增 `listEmployeesByPhone` 调 mis-org by-phone。

### 前端 mis-admin-web
- T15 `types/api.ts` `UserView` 字段修正（employeeNo 可选等）。
- T16 `lib/api/users.ts` + `lib/api/employees.ts`（by-phone）扩展。
- T17 `user-list-page.tsx`：删左树、查询条件(用户名/姓名/组织/部门/手机)、结果列(去工号)、保存遮罩态沿用现有 `saving` 模式。
- T18 创建表单双模式（by-phone 提示+手动选+工号移除+组织/部门可选）。
- T19 编辑表单绑定态禁填姓名/手机。
- T20 权限 Sheet 部门树按组织分组渲染（需求5 修复）。

### 验证
- T21 后端单测：mis-iam `UserServiceCreateBindingTest`（双模式+唯一性去除）、`UserServiceSyncTest`（sync-by-employee 级联禁用/不逆恢复）、`UserServicePageFilterTest`（多维过滤）。mis-org `EmployeeServiceSyncTest`（update 钩子调 IAM）。
- T22 前端单测：`user-list-page` 查询参数构造、by-phone 提示逻辑、perms 部门树分组渲染（如有可单测的纯函数）。
- T23 `npm run typecheck` 0 错；mis-iam/mis-org/mis-admin-bff 模块 `test` 全绿。

## 8. 共享约定
- 数组查询参数序列化：前端 `orgIds/deptIds` 逗号串（参考员工管理 `page-defs.ts` loader），Spring `@RequestParam List<Long>` 用 `StringToCollectionConverter` 逗号拆分（与 POST-02/03 一致）。
- `realName` 同步语义：绑定用户 `sys_user.real_name` 恒等于员工 `real_name`（员工改→覆盖；用户自身不可改）。
- `permVersion` 在 sync/角色变更时自增，沿用 `rbacCacheSupport.onUserPermissionsChanged`。
- phone 脱敏：沿用 `DesensitizeUtils.phone`，非员工用户同样脱敏显示。

## 9. 需求5（权限部门结构）根因与修复
- 根因：perms Sheet `loadPermsDepts`（`user-list-page.tsx:149`）对多组织 `fetchDeptTree` 逐个 `flattenDepts` 后 `trees.flatMap(...)` 拼接，每棵树 depth 独立从 0 起，丢失组织归属 → 渲染成一条无分组、层级错乱的平铺列表。
- 修复（T20）：改为按组织分组——`permsFlatDepts` 改为 `Map<orgId, {node,depth}[]>` 或渲染时每组加组织标题 + 各自缩进树；选中部门集合仍基于所有勾选组织的部门 union 校验。纯前端。
