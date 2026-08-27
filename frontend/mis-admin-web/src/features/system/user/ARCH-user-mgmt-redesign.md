# MIS 平台用户管理模块交互与约束重构 — 系统架构设计 + 任务分解（ARCH）

> 文档类型：架构设计 + 任务分解（仅设计，不含实现代码）
> 作者：架构师 高见远（Gao）
> 适用范围：`mis-iam` / `mis-admin-bff` / `frontend/mis-admin-web`（用户模块）
> 配套文档：`PRD-user-mgmt-redesign.md`（已冻结决策 D1–D4）
> 提取图文件：`class-diagram.mermaid`、`sequence-diagram.mermaid`（同目录）

---

## 0. 现状核对（关键发现，影响设计假设）

阅读现有源码后，确认以下与 PRD 目标状态存在偏差的事实，设计据此给出裁决：

| # | 现状事实（已 Read 核实） | 对设计的影响 |
|---|--------------------------|--------------|
| F1 | 前端 `user-list-page.tsx` 仍为「重做前」状态：表单内仍有角色复选块（L1134-1160）；员工绑定走「输手机号→`listEmployeesByPhone` 自动检测」而非「绑定员工按钮→选择窗」；**全文件无 `appId` 字段**；权限 Sheet 仍按组织分组联动部门（L162 / L198）。 | 本设计为**较大重构**，需在现有文件上重做交互，并保留 AI 辅助录入(`FormFillBridge`)、列宽记忆等既有能力。 |
| F2 | `SysUser` 实体**无 `email` 列**；`mis-iam` 的 `UserCreateRequest`/`UserUpdateRequest`/`UserVO` 均无 `email` 字段；`UserAggregateService.create/update` 不透传 `email`；BFF `enrich` 仅从**绑定员工**透传 email（`emp != null ? DesensitizeUtils.email(emp.email()) : null`）。 | "用户级邮箱"当前**不存在**，仅绑定用户能借道员工邮箱显示。满足 PRD 需**新增列 + 端到端贯通**（见 Q1 裁决）。 |
| F3 | `appId` 在 BFF `UserAggregateService` 全部取 `RequestContext.requireAppId()`（登录态）；BFF `UserCreateRequest`/`UserUpdateRequest`、`mis-iam UserUpdateRequest` 均**不含 `appId`**（仅 `mis-iam UserCreateRequest` 有）。 | 需在 BFF 两个 DTO、`UserUpdateRequest`、`UserAggregateService`、前端 `form` 与 API 全链路补 `appId` 显式透传。 |
| F4 | `ResultCode.EMPLOYEE_ALREADY_BOUND(40910,"该员工已绑定登录账号")` 已定义但**后端无使用点**；`EMPLOYEE_PHONE_EXISTS(40917)` 为员工域。 | 40910 可安全复用为 D1「APP 内 employeeId 唯一」守卫；手机重复码按 Q2 裁决新增 40918。 |
| F5 | 前端 `UserView.email` 字段已声明（types/api.ts L109）、`AppItem`/`fetchApps` 已存在、`listEmployees` 已存在于 `@/lib/api/employees.ts`、`SysUserRoleRepository.findByUserId` 已存在。 | 邮箱回显类型前端已就绪；APP 下拉可复用 `fetchApps`；员工选择窗可复用 `listEmployees`；改 APP 守卫复用 `findByUserId` 判角色。 |

---

## 1. 实现方案 + 框架选型

**核心难点**
1. APP 归属从「隐式登录态」改为「表单显式选择 + 跨 APP 查询」，需前后端全链路把 `appId` 从隐式改为显式参数。
2. 员工绑定模式从「输手机号自动检测」改为「选员工弹窗 + 即时唯一校验」，交互组件需重做。
3. 用户名/手机号在「租户 + APP」维度唯一，需要字段级（而非仅 toast）错误提示——要求前端错误通道能携带 `code`。
4. 邮箱回填需要**数据库新增列**（F2），是本次唯一的结构性 schema 变更。
5. 权限弹窗由「组织↔部门联动」改为「三 TAB 互不联动」，且角色分配从表单迁移到弹窗。

**框架 / 库选型**
- 后端：`mis-iam` / `mis-admin-bff` 沿用 **Java 17 + Spring Boot + Spring Data JPA**（现有栈），**不引入新框架**。
- 前端：沿用 **Vite + React 18 + TypeScript + MUI + Tailwind**（现有栈），**不引入新依赖**。
- 员工选择窗：复用现有 `@/lib/api/employees.ts#listEmployees`（无需新端点，仅新增一个「绑定唯一性预检」端点）。
- 跨 APP 分页：复用 `UserService.page` 现有分页参数（`page/size`），仅把单 `appId` 扩展为 `List<Long> appIds`。

**架构模式**
- 后端保持既有分层：Controller → AggregateService(BFF) → WebClient → IAM Controller → UserService → Repository。
- 前端保持单页 `UserListPage` + 子组件（新增 `EmployeePickerDialog`、`PermissionTabs`），状态用 `useState`（与现有风格一致，不引入新状态库）。

---

## 2. 文件清单及相对路径

| 模块 | 文件路径（相对仓库根） | 改动 | 职责 |
|------|------------------------|------|------|
| mis-iam | `backend/mis-iam/.../domain/repository/SysUserRepository.java` | 修改 | 新增 `existsByTenantIdAndAppIdAndPhone` / `...AndIdNot` / `existsByTenantIdAndAppIdAndEmployeeId`；新增 `searchV3`（支持多 appId IN 过滤） |
| mis-iam | `backend/mis-iam/.../domain/repository/SysUserRoleRepository.java` | 修改 | 新增 `boolean existsByUserId(Long)` 供改 APP 守卫使用 |
| mis-iam | `backend/mis-iam/.../domain/entity/SysUser.java` | 修改 | 新增 `email` 列字段 + getter/setter（对应 DB 迁移） |
| mis-iam | `backend/mis-iam/.../dto/UserCreateRequest.java` | 修改 | 新增 `String email`（appId/phone/employeeId 已有） |
| mis-iam | `backend/mis-iam/.../dto/UserUpdateRequest.java` | 修改 | 新增 `Long appId`、`String email` |
| mis-iam | `backend/mis-iam/.../dto/UserVO.java` | 修改 | 新增 `String email` |
| mis-iam | `backend/mis-iam/.../service/UserService.java` | 修改 | `page` 支持多 appId；`create` 加手机唯一(40918)+员工唯一(40910)+email 落库；`update` 加改 APP 守卫 + 手机唯一(AndIdNot) + 员工唯一 + email 同步 |
| mis-iam | `backend/mis-iam/.../controller/UserController.java` | 修改 | `page` 入参由单 `appId` 改为 `List<Long> appIds`；新增 `GET /check-employee-binding` |
| mis-common | `backend/mis-common/mis-common-core/.../exception/ResultCode.java` | 修改 | 新增 `USER_PHONE_EXISTS(40918,"该手机号在所属应用内已存在")` |
| DB | `backend/mis-iam/src/main/resources/db/migration/...Vx__add_sys_user_email.sql` | 新增 | `ALTER TABLE sys_user ADD COLUMN email VARCHAR(255)`（按项目既有迁移规范 Flyway/Liquibase 二选一） |
| mis-admin-bff | `backend/mis-admin-bff/.../dto/UserCreateRequest.java` | 修改 | 新增 `Long appId` |
| mis-admin-bff | `backend/mis-admin-bff/.../dto/UserUpdateRequest.java` | 修改 | 新增 `Long appId` |
| mis-admin-bff | `backend/mis-admin-bff/.../service/UserAggregateService.java` | 修改 | `page` 接收 `appIds`；`create` 用 `request.appId()` 取代登录态 + 透传 `email`；`update` 透传 `appId`+`email` |
| mis-admin-bff | `backend/mis-admin-bff/.../client/IamWebClient.java` | 修改 | `userCreateBody` 加 `email`；`pageUsers` 支持 `List<Long> appIds`（空=不过滤）；`updateUser` body 加 `appId`/`email` |
| mis-admin-bff | `backend/mis-admin-bff/.../controller/UserController.java` | 修改 | `page` 加 `appIds`；新增 `GET /check-employee-binding` 转发 IAM |
| frontend | `frontend/mis-admin-web/src/types/api.ts` | 修改 | `UserView` 加 `appId?: string`；如需新增 `EmployeeBindingCheck` 类型 |
| frontend | `frontend/mis-admin-web/src/lib/api/users.ts` | 修改 | `UserPageQuery` 加 `appIds?`；`createUser` 加 `appId`；`updateUser` 加 `appId?`；新增 `checkEmployeeBinding(appId,employeeId)`；`unwrap` 抛 `ApiError` |
| frontend | `frontend/mis-admin-web/src/lib/api/errors.ts` | 新增 | `ApiError` 类（携带 `code`/`message`），供错误码映射 |
| frontend | `frontend/mis-admin-web/src/features/system/user/user-list-page.tsx` | 修改 | 表单重构（APP 下拉/字段顺序/强制绑定 picker/删角色框/邮箱/解绑/改 APP 守卫）；查询加 APP 多选；权限弹窗三 TAB 去联动；`onSave` 字段级红字（最大改动文件） |
| frontend | `frontend/mis-admin-web/src/features/system/user/employee-picker-dialog.tsx` | 新增 | 员工选择弹窗：复用 `listEmployees`，选中时调 `checkEmployeeBinding` 即时唯一校验 |
| frontend | `frontend/mis-admin-web/src/features/system/user/permission-tabs.tsx` | 新增 | 组织/部门/角色 三 TAB 组件，互不联动 |

---

## 3. 数据结构与接口（类图 / 表）

> 完整 Mermaid 见同目录 `class-diagram.mermaid`。下面列出**关键改动契约**。

### 3.1 后端（mis-iam）关键签名

```java
// SysUserRepository —— 新增派生查询
boolean existsByTenantIdAndAppIdAndPhone(Long tenantId, Long appId, String phone);
boolean existsByTenantIdAndAppIdAndPhoneAndIdNot(Long tenantId, Long appId, String phone, Long id);
boolean existsByTenantIdAndAppIdAndEmployeeId(Long tenantId, Long appId, Long employeeId);
// 复用现有 searchV2 思路，新增支持多 appId：
Page<SysUser> searchV3(Long tenantId, Collection<Long> appIds, boolean hasAppFilter,
        Integer status, String username, String realName, String phone,
        Collection<Long> candidateUserIds, boolean hasCandidate, Pageable pageable);

// SysUserRoleRepository —— 新增
boolean existsByUserId(Long userId);

// UserService —— 变更点
Page<UserVO> page(Long tenantId, List<Long> appIds, Integer status, String username,
                  String realName, String phone, List<Long> orgIds, List<Long> deptIds, int page, int size);
UserVO create(UserCreateRequest req);   // +手机唯一(40918) +员工唯一(40910) +email 落库
UserVO update(Long id, UserUpdateRequest req); // +改APP守卫 +手机唯一(AndIdNot) +email 同步

// UserCreateRequest 新增：String email（appId/phone/employeeId 已存在）
// UserUpdateRequest 新增：Long appId, String email
// UserVO 新增：String email
```

### 3.2 后端（mis-admin-bff）关键签名

```java
// BFF UserCreateRequest 新增：Long appId
// BFF UserUpdateRequest 新增：Long appId
// UserAggregateService
PageResult<UserView> page(..., List<Long> appIds, ...); // appIds 空=查全部
UserView create(UserCreateRequest req);   // 用 req.appId() 取代 RequestContext.requireAppId()；透传 email
UserView update(Long id, UserUpdateRequest req); // 透传 appId + email
// IamWebClient.userCreateBody(..., String email) ; pageUsers(tenantId, List<Long> appIds, ...)
```

### 3.3 前端关键结构

```ts
// 表单 state（user-list-page.tsx）
interface UserFormState {
  appId: string;          // 新增：所属 APP（显式）
  username: string;
  realName: string;
  phone: string;
  email: string;          // 已存在，需支持绑员工回填+只读态
  password: string;
  employeeId: string;
  orgIds: string[];
  deptIds: string[];
  roleIds: string[];
}
// 字段级错误（新增）
type FieldErrors = { username?: string; phone?: string; appId?: string };

// 员工绑定预检返回（新增）
interface EmployeeBindingCheck { exists: boolean }

// 权限弹窗三 TAB（permission-tabs.tsx）
// OrgTab / DeptTab / RoleTab 各自独立渲染全量列表，互不联动
```

### 3.4 错误码约定（共享）

| 码 | 含义 | 触发点 | 前端挂载 |
|----|------|--------|----------|
| 40901 `USER_EXISTS` | 用户名在租户+APP 内已存在 | UserService.create/update | 用户名框红字 |
| 40918 `USER_PHONE_EXISTS`（新增） | 手机号在租户+APP 内已存在 | UserService.create/update | 手机号框红字 |
| 40910 `EMPLOYEE_ALREADY_BOUND`（复用） | 该员工在当前 APP 内已绑定其他账号 | UserService.create/update（D1 守卫） | 员工选择窗提示 |
| 40001 `VALIDATION_ERROR` | 改 APP 守卫等参数校验 | UserService.update（已分配角色禁改 APP） | APP 框红字 + toast |

---

## 4. 程序调用流程（时序图，Mermaid）

> 完整 4 张时序图见同目录 `sequence-diagram.mermaid`。摘要如下：

- **(a) 强制模式新建全流程**：打开→读 `forceBindEmp`→选 APP→点「绑定员工」→`EmployeePickerDialog` 列员工→选员工→`checkEmployeeBinding(appId,empId)` 预检（IAM `existsByTenantIdAndAppIdAndEmployeeId`）→回填手机/姓名/邮箱并灰化→填用户名/密码→`createUser`→BFF→IAM `create`：用户名唯一(40901)/员工唯一(40910)/手机唯一(40918)→落库（写 employeeId，绑定标记由 employeeId 非空隐式表达）→失败则按 code 挂红字。
- **(b) 编辑改 APP 守卫被拒**：`openEdit` 载 apps→用户改 appId 且该用户 `roles>0`→保存→`updateUser({appId})`→IAM `update`：`newAppId!=oldAppId && userRoleRepository.existsByUserId`→抛 `VALIDATION_ERROR("已分配角色，禁止修改所属APP")`→前端红字挂 APP 框 + toast。
- **(c) 跨 APP 查询**：查询区选「所属 APP」多选 `queryAppIds`→`pageUsers({appIds})`→BFF `page(appIds)`→IAM `pageUsers(tenantId,appIds)`→`UserService.page(tenantId,appIds)`→`searchV3` 按 `appId IN` 过滤（空则 `hasAppFilter=false` 查全部）→统一分页返回。
- **(d) 权限弹窗三 TAB 保存**：`openPerms`→分别加载全量组织/全量部门/全量角色（**不联动**）→用户勾选→保存→`updateUser({orgIds,deptIds})` + `assignUserRoles(roleIds)`→IAM `update`(`replaceUserOrgs/Depts`) + `assignRoles`(`replaceRoles`，保留 `role.appId==user.appId` 校验)。

---

## 5. 任务列表（有序、含依赖）

> 按模块分批；每个任务对应一组文件改动（≥3 个文件），标注依赖与优先级。P0 为本次必须交付。

### T1 — mis-iam 数据层与用户服务约束增强  **[P0]**
- 依赖：无（基础）
- 改动文件：`SysUserRepository.java`、`SysUserRoleRepository.java`、`SysUser.java`、`UserCreateRequest.java`、`UserUpdateRequest.java`、`UserVO.java`、`UserService.java`、`UserController.java`、`ResultCode.java`、DB 迁移脚本
- 要点：新增 3 个 Repository 派生查询 + `searchV3` 多 appId；`existsByUserId`；实体与 DTO/VO 加 `email`；`UserService.page` 多 appId；`create` 加手机唯一(40918)/员工唯一(40910)/email 落库；`update` 加改 APP 守卫 + 手机唯一(AndIdNot) + email 同步；`UserController.page` 改 `appIds`；新增 `GET /check-employee-binding`；`ResultCode` 加 40918。

### T2 — mis-admin-bff 请求与聚合层透传 appId/email/多 appIds  **[P0]**
- 依赖：T1（依赖 IAM 新接口/字段契约）
- 改动文件：`BFF UserCreateRequest.java`、`BFF UserUpdateRequest.java`、`UserAggregateService.java`、`IamWebClient.java`、`BFF UserController.java`
- 要点：`create` 用 `request.appId()` 取代登录态 + 透传 `email`；`update` 透传 `appId`+`email`；`page` 接收并下传 `appIds`（空=查全部）；`IamWebClient.userCreateBody` 加 `email`、`pageUsers` 支持 `appIds`、`updateUser` body 加 `appId`/`email`；`UserController.page` 加 `appIds` 入参 + 转发 `check-employee-binding`。

### T3 — 前端 API 契约与错误通道  **[P0]**
- 依赖：T2（契约就绪后可并行前端联调准备）
- 改动文件：`types/api.ts`、`lib/api/users.ts`、`lib/api/errors.ts`（新增）
- 要点：`UserView` 加 `appId?`；`UserPageQuery` 加 `appIds?` 并下发；`createUser` 加 `appId`；`updateUser` 加 `appId?`；新增 `checkEmployeeBinding(appId,employeeId)`；新增 `ApiError{code,message}` 并由 `unwrap` 抛出（错误码透传基础）。

### T4 — 前端用户表单重构（APP/字段顺序/强制绑定 picker/删角色框/邮箱/解绑/改 APP 守卫）  **[P0]**
- 依赖：T3
- 改动文件：`user-list-page.tsx`、`employee-picker-dialog.tsx`（新增）
- 要点：`form` 加 `appId`；查询区加「所属 APP」多选 `queryAppIds`；加载 `apps`（复用 `fetchApps`）；新建字段顺序固定为 所属APP→手机→姓名→邮箱→用户名→密码；删除表单内角色块（D3）；强制模式（`forceBindEmp`）显示提示+「绑定员工」按钮、非员工字段灰化、未选员工禁止保存(P1#19)；用 `EmployeePickerDialog`（复用 `listEmployees`+`checkEmployeeBinding`）替代原「输手机号自动检测」；编辑：APP 下拉 + 改 APP 软校验（roles>0 禁改并提示）、已绑定仅用户名可改、其余随员工只读、显示/隐藏解绑按钮（强制时不显示）；邮箱绑定回填且只读态灰化。

### T5 — 前端权限弹窗三 TAB + 取消联动  **[P0]**
- 依赖：T4（同文件，顺序执行避免冲突）
- 改动文件：`user-list-page.tsx`、`permission-tabs.tsx`（新增）
- 要点：权限 Sheet 改为三 TAB（组织/部门/角色）独立渲染全量列表、**互不联动**（移除原 `buildOrgGroups`/`loadPermsDepts` 组织↔部门联动逻辑）；角色 TAB 为角色分配唯一入口（D3），保存调 `updateUser({orgIds,deptIds})` + `assignUserRoles`；保留已选状态。

### T6 — 前端字段级红字 + 错误码映射 + 联调测试  **[P0/P1]**
- 依赖：T3（ApiError）、T4、T5
- 改动文件：`user-list-page.tsx`（onSave 改造）、可选 `errors` 封装、后端单测桩、前端联调
- 要点：`onSave` catch 按 `e.code` 映射（40901→username、40918→phone、40001 角色守卫→appId），写入 `errors` state 并由字段组件渲染红字+高亮，onChange 清除；保留 toast 通道；覆盖场景：强制新建、改 APP 守卫拒绝、跨 APP 查询、权限三 TAB 保存、唯一冲突红字。

---

## 6. 依赖包列表

**后端 / 前端均不引入新依赖**（沿用既有 Spring Boot、Spring Data JPA、React18、MUI、Tailwind）。
唯一结构性变更是 **DB schema（新增 `sys_user.email` 列）**，使用项目既有迁移框架（Flyway 或 Liquibase，与现有迁移文件同机制），不引入新包。

---

## 7. 共享知识（跨文件约定）

1. **错误码常量**（全链路统一）：`USER_EXISTS=40901`、`USER_PHONE_EXISTS=40918(新增)`、`EMPLOYEE_ALREADY_BOUND=40910(复用)`、`VALIDATION_ERROR=40001`。
2. **字段命名**：`appId`（数字 Long，前端表单存 `string` 提交时 `Number()` 转换）、`phone`（非 mobile）、`email`、`employeeId`。
3. **appId 透传约定**：新建/编辑 `appId` 由前端**显式提交**（不再取登录态）；跨 APP 查询 `appIds: List<Long>`，**空 = 查全部 APP**（契合 D2），非空 = `appId IN` 取并集。
4. **forceBindEmp 读取时机**：打开新建/编辑 Sheet 时各调一次 `getConfigByKey('user.force.employee.bind')`（前端已做）；BFF `isForceEmployeeBind()` 已做，双保险。
5. **employeeId 唯一校验统一在 select-employee 时调用**：前端 `EmployeePickerDialog` 选中即调 `checkEmployeeBinding`（预检），后端 `existsByTenantIdAndAppIdAndEmployeeId` 兜底（保存时再校验一次）。
6. **phone 非空才查唯一**：后端仅当 `phone` 非 blank 时调 `existsBy...Phone`（D4）。
7. **邮箱贯通约定**：绑员工时 `email = emp.email()`；非员工用户表单手填；落库 `sys_user.email`；`UserVO`/`UserView` 回显**用户自身 email**（BFF `enrich` 改为优先用 `IamUserVO.email`，不再仅从员工透传）。
8. **错误码透传**：前端统一 `ApiError{code,message}`（扩展 `unwrap`）；`onSave` catch 按 `code` 映射字段红字；`toast` 通道保留。
9. **角色分配唯一入口**：表单内角色框删除，统一走权限弹窗「角色」TAB（D3）。
10. **组织/部门/角色三 TAB 互不联动**（PRD ④），各自列出全量供勾选。

---

## 8. 待明确事项裁决（Q1–Q8）

### Q1 选员工后「邮箱」能否回填至用户邮箱？EmployeeInfoBlock 是否支持 email 回填？
- **核实结论**：`EmployeeVO.email` **确实存在**（已确认 L18）；但当前 `SysUser` 无 `email` 列、`mis-iam` 的 `UserCreateRequest/UserUpdateRequest/UserVO` 无 `email`、`UserAggregateService` 不透传 `email`、`enrich` 仅把**绑定员工**的 email 透传显示（非员工用户为 `null`）。`EmployeeInfoBlock` 当前仅展示 org/dept/posts，**不含 email**。
- **裁决**：**新增 `sys_user.email` 列（DB 迁移）+ 端到端贯通用户级 email**。
  - mis-iam：`UserCreateRequest/UserUpdateRequest` 加 `email`；`UserService.create` 绑员工取 `emp.email()`、非员工取请求值落库；`update` 在 `empChanged` 时从员工同步 email；`UserVO` 回显 `email`。
  - BFF：`UserAggregateService.create/update` 透传 `email`；`enrich` 改为优先用 `IamUserVO.email`。
  - 前端：`EmployeeInfoBlock` 增加「邮箱」展示；绑员工时把 `emp.email` 写入 `form.email`（强制/只读态灰化）；编辑已绑定用户邮箱随员工只读。
- **轻量替代（若禁止改表）**：仅显示员工邮箱、非员工无邮箱——不推荐，违背 PRD 字段顺序与可编辑性。需主理人确认是否接受 DB 变更（见风险 R1）。

### Q2 手机重复错误码：复用 40917 还是新增 40918？
- **裁决**：**新增 `USER_PHONE_EXISTS(40918, "该手机号在所属应用内已存在")`**。
- **理由**：与 `USER_EXISTS(40901)` 同族（用户域冲突码），语义清晰、便于前端按码映射与审计归类；复用 `EMPLOYEE_PHONE_EXISTS(40917)` 会与**员工域**手机号冲突码混淆（用户与员工是两个独立聚合，错误码应隔离）。

### Q3 跨 APP 查询默认范围 + 分页？
- **裁决**：多选**为空 = 查全部 APP**（不做单 APP 限制），契合 D2（全部登录用户可跨 APP 查）；非空则按所选 APP 取并集（`appId IN`）。**分页**沿用现有 `page/size`（默认 `size=20`），跨 APP 结果**统一分页**（不按 APP 分组）。实现：BFF/IAM 当 `appIds` 为空时 `hasAppFilter=false`（repository 跳过 appId 过滤）。

### Q4 已绑定员工改 APP 与 D1 冲突？
- **裁决**：**不冲突，合并为统一守卫**。
  - D1 是「APP 内 employeeId 唯一」，跨 APP 换绑合法（同员工在新 APP 内无绑定即可）。
  - 改 APP 的唯一阻点是「已分配任意角色」（角色按 `appId` 隔离会失效）。
  - **统一守卫规则**：仅当用户 `userRoleRepository.existsByUserId(id)` 为真时禁止改 APP；员工绑定本身**不**阻止改 APP。
  - 实现：`UserService.update` 中若 `newAppId != oldAppId && 已分配角色` → 抛 `VALIDATION_ERROR("已分配角色，禁止修改所属APP")`；前端同步软校验（roles>0 时禁用/提示）。

### Q6 已绑定员工编辑时「密码」是否允许手填？
- **裁决**：**允许手填**。密码不随员工同步（员工无登录密码概念）；编辑时密码框可填、留空 = 不改（沿用现有逻辑）；强制模式**新建**密码必填。已绑定用户编辑时仅「用户名」与「密码」可改，手机/姓名/邮箱随员工只读（用户名受 40901 约束）。

### Q7 解绑后手机/姓名/邮箱清空还是保留？
- **裁决**：**保留并转为非员工用户**。与现有 `UserService.update` 解绑逻辑一致（L238 仅清 `employeeId`，保留已同步姓名/手机；新增 `email` 同样保留）。即解绑不清除这些字段，用户变为普通账号可继续编辑，符合 D4 与数据连续性。

### Q8 字段级红字挂载方式？
- **裁决**：新增 `errors: { username?, phone?, appId? }` state（可封装为 `useFieldErrors`）。前端统一异常类型 `ApiError{code,message}`（扩展现有 `unwrap`，在 `@/lib/api/errors.ts` 定义并在 `users.ts` 使用）。`onSave` catch 中按 `e.code` 映射：40901→`errors.username`、40918→`errors.phone`、40001（角色守卫）→`errors.appId`；字段组件据 `errors[field]` 渲染红字+高亮；`onChange` 时 `clearFieldError(field)`。`toast` 通道保留（AC3）。

---

## 9. 仍无法确定的风险点

- **R1（高）**：新增 `sys_user.email` 列需 **DB 迁移 + DBA 评审**。若本期不允许改表，Q1 退化为「仅显示员工邮箱、非员工无邮箱」，需主理人确认取舍。
- **R2（中）**：`ResultCode` 新增 40918 涉及公共模块 `mis-common-core`，需通知各模块负责人避免码段冲突；建议与 40917 段位相邻。
- **R3（中）**：跨 APP 查询在大数据量下性能（`appId IN` + 现有 `LIKE` 过滤）；建议确认 `app_id` 已建索引（大概率已建），必要时加复合索引。
- **R4（中）**：`user-list-page.tsx` 为「重做前」状态（F1），本设计为较大重构，工程需保留 AI 辅助录入(`FormFillBridge`)、列宽记忆(`useColumnWidths`)、客户端排序(`useClientSort`) 等既有能力，避免回归。
- **R5（低）**：`EmployeePickerDialog` 为新增组件，需复用现有 `/employees` 列表/搜索 API（`@/lib/api/employees.listEmployees`），并新增后端 `check-employee-binding` 预检端点（T1/T2）。
- **R6（低）**：改 APP 守卫需读取「用户已分配角色数」，当前 `SysUserRoleRepository` 无 `existsByUserId`，T1 已规划新增（或用 `findByUserId.isEmpty()`）。
- **R7（低）**：跨 APP 查询结果分页语义——裁决为统一分页（不分组）；若产品后续要求按 APP 分组展示，需迭代。

---

## 附：实施顺序总览

```
T1(mis-iam 数据/服务) ──► T2(BFF 透传) ──► T3(前端 API/错误通道)
                                        └──► T4(前端表单重构) ──► T5(权限三TAB)
                                                                  └──► T6(字段红字+测试)
```
- T1 是基础，必须先完成契约（含 40918、email、多 appId、check-employee-binding）。
- T2 依赖 T1 的 IAM 契约；T3 可与 T2 并行准备类型，但联调需 T2 就绪。
- T4/T5 改同一文件，顺序执行；T6 最后做字段级红字与联调测试。
