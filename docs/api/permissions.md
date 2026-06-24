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
| system:user:add | 按钮 | 新增 |
| system:user:edit | 按钮 | 编辑（可多 API） |
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
| system:dept:list | 菜单+API | 部门树（按 orgId） |
| system:dept:query | API | 部门详情 |
| system:dept:add | 按钮+API | 新增部门 |
| system:dept:edit | 按钮+API | 编辑部门 |
| system:dept:delete | 按钮+API | 删除部门 |

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

## 9. 关联文档

- [接口规范](api-specification.md)
- [种子数据](../database/seed-data.md)
- [管理后台设计](../frontend/admin-web-design.md)
