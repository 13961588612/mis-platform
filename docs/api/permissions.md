# 权限点与菜单清单

> 状态：📝 草稿 | 版本：v1.0-draft

## 1. 权限标识命名规范

```
{模块}:{资源}:{操作}
```

| 段 | 说明 | 示例 |
|----|------|------|
| 模块 | 业务域 | system, monitor, dashboard |
| 资源 | 实体 | user, org, dept, role, menu, dict |
| 操作 | 动作 | list, add, edit, delete, query |

## 2. 权限与 API 的关系（ADR-011）

```
sys_menu（UI 树）                    sys_menu_api              sys_api
菜单页 permission ──关联──▶  menu_id ──api_id──▶  HTTP 端点
按钮 permission   ──关联──▶  menu_id ──api_id──▶  HTTP 端点
```

| 层级 | sys_menu.type | permission | API |
|------|---------------|------------|-----|
| 目录 | 1 | — | — |
| 菜单页 | 2 | 进入页面权限 | `sys_menu_api` → `sys_api` |
| 按钮 | 3 | 操作权限 | `sys_menu_api` → `sys_api` |

角色：**`sys_role_permission`**（`perm_type='menu'`）勾选菜单/按钮 → Redis permissions → BFF 经 `sys_menu_api` 解析 API。

详见 [api-permission-mapping.md](../backend/api-permission-mapping.md)。

## 3. 完整权限清单（Phase 1）

### 3.1 仪表盘

| permission | 类型 | 说明 |
|------------|------|------|
| dashboard:view | 菜单 | 查看仪表盘 |

### 3.2 用户管理

| permission | 类型 | 说明 |
|------------|------|------|
| system:user:list | 菜单页 | 用户列表页 + 列表 API |
| system:user:query | 按钮/菜单 | 详情 API（通常挂在「编辑」按钮 API 组） |
| system:user:add | 按钮 | 新增（含按手机查员工、员工绑定预检，V59） |
| system:user:edit | 按钮 | 编辑（可多 API；含按手机查员工、员工绑定预检，V59） |
| system:user:delete | 按钮 | 删除 |
| system:user:resetPwd | 按钮 | 重置密码 |
| system:user:assignRole | 按钮 | 分配角色 |

### 3.3 组织管理

| permission | 类型 | 说明 |
|------------|------|------|
| system:org:list | 菜单+API | 组织列表 |
| system:org:query | API | 组织详情 |
| system:org:add | 按钮+API | 新增组织 |
| system:org:edit | 按钮+API | 编辑组织 |
| system:org:delete | 按钮+API | 删除组织 |

### 3.4 部门管理

| permission | 类型 | 说明 |
|------------|------|------|
| system:dept:list | 菜单+API | 部门树（按 orgId）；含部门类型树/列表只读 |
| system:dept:query | API | 部门详情 |
| system:dept:add | 按钮+API | 新增部门 |
| system:dept:edit | 按钮+API | 编辑部门 |
| system:dept:delete | 按钮+API | 删除部门 |
| system:dept-type:add | 按钮+API | 新增部门类型（V55，菜单 224） |
| system:dept-type:edit | 按钮+API | 编辑部门类型（V55，菜单 225） |
| system:dept-type:delete | 按钮+API | 删除部门类型（V55，菜单 226） |

### 3.5 角色管理

| permission | 类型 | 说明 |
|------------|------|------|
| system:role:list | 菜单+API | 角色列表 |
| system:role:query | API | 角色详情 |
| system:role:add | 按钮+API | 新增角色 |
| system:role:edit | 按钮+API | 编辑角色 |
| system:role:delete | 按钮+API | 删除角色 |
| system:role:assignMenu | 按钮+API | 分配菜单 |

### 3.6 菜单管理

| permission | 类型 | 说明 |
|------------|------|------|
| system:menu:list | 菜单+API | 菜单树 |
| system:menu:query | API | 菜单详情 |
| system:menu:add | 按钮+API | 新增菜单 |
| system:menu:edit | 按钮+API | 编辑菜单 |
| system:menu:delete | 按钮+API | 删除菜单 |

### 3.7 字典管理

| permission | 类型 | 说明 |
|------------|------|------|
| system:dict:list | 菜单+API | 字典列表 |
| system:dict:query | API | 字典详情 |
| system:dict:add | 按钮+API | 新增字典 |
| system:dict:edit | 按钮+API | 编辑字典 |
| system:dict:delete | 按钮+API | 删除字典 |

### 3.8 系统监控

| permission | 类型 | 说明 |
|------------|------|------|
| monitor:loginlog:list | 菜单+API | 登录日志 |
| monitor:operlog:list | 菜单+API | 操作日志 |
| monitor:operlog:query | API | 操作日志详情 |

### 3.9 智能体运营（摘录）

| permission | 类型 | 说明 |
|------------|------|------|
| agent:skill:manage | 按钮 | 技能创建/编辑/删除/启停；含解析 SKILL.md（`POST /api/v1/agent-ops/skills/parse`，V50+V61） |
| agent:skill:grant | 按钮 92038（挂技能池 92037；V171 由独立菜单页改按钮） | 技能池「设置权限」；`GET/PUT /skills/{id}/grants`、`GET /roles` |
| agent:session:list | 菜单页 | 会话列表；含单轮/批量耗时（V50+V61） |
| ai:skill:form-assist:run | 按钮 92207（V173，挂 92200） | 表单辅助录入示例技能 `form-assist` 执行权；业务填单页「辅助录入」显隐与此码（及表单绑定的 skill_id）挂钩 |

## 4. 菜单树结构（数据库种子）

| id | parent_id | type | name | path | component | permission | icon |
|----|-----------|------|------|------|-----------|------------|------|
| 100 | 0 | 2 | 仪表盘 | dashboard | dashboard/index | dashboard:view | LayoutDashboard |
| 200 | 0 | 1 | 系统管理 | system | Layout | — | Settings |
| 201 | 200 | 2 | 用户管理 | user | system/user/index | system:user:list | Users |
| 202 | 200 | 2 | 组织管理 | org | system/org/index | system:org:list | Building2 |
| 206 | 200 | 2 | 部门管理 | dept | system/dept/index | system:dept:list | GitBranch |
| 203 | 200 | 2 | 角色管理 | role | system/role/index | system:role:list | Shield |
| 204 | 200 | 2 | 菜单管理 | menu | system/menu/index | system:menu:list | Menu |
| 205 | 200 | 2 | 字典管理 | dict | system/dict/index | system:dict:list | BookOpen |
| 300 | 0 | 1 | 系统监控 | monitor | Layout | — | Monitor |
| 301 | 300 | 2 | 登录日志 | login-log | monitor/login-log/index | monitor:loginlog:list | LogIn |
| 302 | 300 | 2 | 操作日志 | oper-log | monitor/oper-log/index | monitor:operlog:list | FileText |

### 4.1 按钮子节点（type=3）

以用户管理（id=201）为例：

| parent_id | name | permission |
|-----------|------|------------|
| 201 | 新增用户 | system:user:add |
| 201 | 编辑用户 | system:user:edit |
| 201 | 删除用户 | system:user:delete |
| 201 | 重置密码 | system:user:resetPwd |
| 201 | 分配角色 | system:user:assignRole |

> 各 API 的 `sys_api` 明细见 [api-permission-mapping.md](../backend/api-permission-mapping.md)。

### 4.2 登录即可（authOnly）补充

| API | sys_api | 说明 |
|-----|---------|------|
| `GET /api/v1/permissions/stores` | **1102**（V182） | 当前操作员权限内门店；可选 `storeType`；挂菜单 **90**（认证，permission=NULL） |

身份权限模块 API 树：顶级「权限模块」(1100) →「权限查询」(1101) → 本接口。

V183 起另挂超市运营菜单：**96041**（闭店退券 view）、**96037**（闭店退卡 view），前端以 `storeType=CSMD` 拉权限内超市门店。

## 5. 角色默认权限矩阵（Phase 1 种子）

| 角色 | 说明 |
|------|------|
| **superadmin** | 平台租户管理（非 sys_role） |
| **TENANT_ADMIN** | 默认租户 `admin` 绑定；全量菜单 |

> `DEPT_MANAGER`、`HR_MANAGER`、`USER` 等 **不在种子中**；由租户 admin 在「角色管理」中创建并分配。

## 6. 前端权限使用

```tsx
// 按钮
<PermissionButton permission="system:user:add">
  <Button>新增用户</Button>
</PermissionButton>

// Hook
const { hasPermission } = usePermission();
if (hasPermission('system:user:edit')) { ... }
```

## 7. 后端权限使用（BFF）

**不在 Controller 写 `@PreAuthorize`。** HTTP 端点在 `sys_api`；鉴权 permission 在 `sys_menu`；经 `sys_menu_api` 关联，BFF Registry 加载。

完整示例见 [api-permission-mapping.md](../backend/api-permission-mapping.md)。

## 8. 已确认项

- [x] **不支持**权限通配符 `system:user:*`
- [x] `DEPT_MANAGER` 等业务角色 **不预置**，租户后期创建
- [x] 内置仅 `TENANT_ADMIN`；平台 **superadmin** 独立账号
- [x] admin 不可删除自己

## 9. 流程定义（摘录）

| permission | 类型 | 说明 |
|------------|------|------|
| workflow:definition:edit | 菜单 95006 | 流程定义列表 / 编排 / 发布 / 关联表单 |

关联 API（经 `sys_menu_api`）：含 `PUT /api/v1/workflow/definitions/{id}/supported-forms`（sys_api **95101**，V142）。

## 9.1 问数增强 / 样本对分类（摘录，V148）

| permission | 类型 | 说明 |
|------------|------|------|
| iqd:enhance:view | 菜单 92521 | 含 `GET /api/v1/iqd/sql-pair-categories/tree`、`GET /api/v1/iqd/sql-pairs` |
| iqd:enhance:save | 菜单 92522 | 含样本对分类 POST/PUT/DELETE（sys_api **92981–92983**）与样本保存 |

## 9.2 模板报告（摘录，V160–V161）

| 权限码 | 菜单 | 说明 |
|--------|------|------|
| ai-report:view | 菜单 93201 | ping / 分类树 / 参数来源 / 工作流平台列表 / 报告 defs 读 / ACL 列表（sys_api **93211–93212,93216–93217,93220–93221,93225**）；S3：`catalog` / `prepare-card` / `execute` / `results`（**93228–93230,93232**，亦绑问数旗舰页 93040） |
| ai-report:save | 菜单 93202 | 分类/报告/工作流平台/ACL 写（sys_api **93213–93215,93218–93219,93222–93224,93226–93227**） |

报告 execute 旁路结果写入会话：`POST /api/v1/agent-ops/sessions/{id}/transcript`（sys_api **93231** / code **00920078**，V162；绑 `agent:chat:use` 92032 与问数旗舰页 93040）。

Copilot 语音转写：`POST /api/v1/agent-ops/speech/transcribe`（sys_api **93233** / code **00920079**，V167；绑 `agent:chat:use` 92032）。音频不进会话附件。

技能分类树（V170，表 `ai_skill_category` / `ai_skill_category_bind`）：`GET /api/v1/agent-ops/skill-categories`（sys_api **93234** / 00920080，绑 `agent:skill:list` 92037）；`POST/PUT/DELETE /skill-categories` 与 `PUT /skills/{id}/category`（**93235–93238** / 00920081–00920084，绑 `agent:skill:manage` 92051）。分类真值在平台库，不写 `Skill.category` 字符串。

运行时业务码：**40321** = 无权限或必要参数无可选项（前端不插参数卡）。

分类 API：`sys_api` **92980–92983** / `sys_menu_api` **92984–92987**（V148）。

## 10. 消息管理

| permission | 菜单 | API |
|------------|------|-----|
| `taskflow:message:manage` | 95131（挂在消息与待办 95003 下，侧栏不展示） | 预览 / 发送 / 发送记录 / 上传：`sys_api` **95141–95145**；按手机号解析：`sys_api` **95148**（V152） |
| （收件人下载） | 95003 与 95131 均绑定 | `GET /api/v1/messages/files/{id}`，`sys_api` **95146** |

接收范围可同时选全员、部门（含子部门）、岗位类型（含下级类型与兼职）、指定用户，按并集去重。内置管理员角色（role_id=1）已授权。

## 11. 应用管理加载地址（V175）

| permission | 菜单 | API |
|------------|------|-----|
| `system:app:edit` | 291 | `PUT /api/v1/apps/{id}`（含 `sys_app.mfe_remote` 加载地址） |

## 12. 超市运营（spm，独立仓 mis-spm-biz，V174 + V179 + V180）

| permission | 类型 | 说明 |
|------------|------|------|
| `spm:home:view` | 菜单 96036 | 首页；`GET /api/v1/spm/health`（sys_api **96100**） |
| `spm:cashcard:close-cleanup:view` | 菜单 96037 | 闭店退卡列表/详情；`GET /api/v1/spm/cashcard/**`（**96101**） |
| `spm:cashcard:close-cleanup:edit` | 按钮 96038 | 新建/保存；POST/PUT `/api/v1/spm/cashcard/**`（**96103–96104**） |
| `spm:cashcard:close-cleanup:audit` | 按钮 96039 | 审核；`POST .../shop-close-cleanup/*/audit`（**96102**） |
| `spm:cashcard:close-cleanup:delete` | 按钮 96040 | 删除；`DELETE /api/v1/spm/cashcard/**`（**96105**） |
| `spm:coupon:close-cleanup:view` | 菜单 96041 | 闭店退券列表/详情；`GET /api/v1/spm/coupon/**`（**96110**） |
| `spm:coupon:close-cleanup:edit` | 按钮 96042 | 新建/保存；POST/PUT `/api/v1/spm/coupon/**`（**96112–96113**） |
| `spm:coupon:close-cleanup:audit` | 按钮 96043 | 审核；`POST .../coupon/shop-close-cleanup/*/audit`（**96111**） |
| `spm:coupon:close-cleanup:delete` | 按钮 96044 | 删除；`DELETE /api/v1/spm/coupon/**`（**96114**） |

V179 起取消 `/api/v1/spm/**` 四方法 **authOnly** 通配（96091–96094 已停用）。V180 增加闭店退券分码。本应用默认仅内网：BFF `mis.spm.intranet-only`。与 `spm-report` 智能体、老 `mis.bff.smp` 无关。

## 13. 室内地图（imap，独立仓 indoor-map，V177）

| permission | 类型 | 说明 |
|------------|------|------|
| `imap:map:view` | 菜单 97031 | 浏览列表/详情；`GET /api/v1/imap/**` |
| `imap:map:edit` | 按钮 97032 | 新建、保存、锁图、本人解锁；POST/PUT/PATCH `/api/v1/imap/**` |
| `imap:map:unlock` | 按钮 97033 | 强制解锁；`POST /api/v1/imap/**/force-unlock` |
| `imap:map:delete` | 按钮 97034 | 删除；`DELETE /api/v1/imap/**` |

BFF `/api/v1/imap/**` 透传到 Nest `/api/v1/**`，不包第二层 Result。默认仅内网：`mis.imap.intranet-only`。登录身份为门户 SYSTEM 用户；地图 `orgId` 归属 MIS 组织。

## 14. 关联文档

- [接口规范](api-specification.md)
- [种子数据](../database/seed-data.md)
- [管理后台设计](../frontend/admin-web-design.md)
