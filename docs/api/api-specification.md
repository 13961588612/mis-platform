# REST API 接口规范

> 状态：📝 草稿 | 版本：v1.0-draft  
> 基础路径：`/api/v1` | 对外统一经 `mis-gateway` 暴露

## 1. 通用约定

### 1.1 请求头

| Header | 必填 | 说明 |
|--------|------|------|
| Authorization | 除白名单外必填 | `Bearer {accessToken}` |
| Content-Type | POST/PUT | `application/json` |
| X-Trace-Id | 否 | 客户端可传入，否则 Gateway 生成 |

### 1.2 响应结构

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "traceId": "a1b2c3d4e5f67890"
}
```

### 1.3 分页请求参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| page | int | 1 | 页码，从 1 开始 |
| size | int | 20 | 每页条数，最大 100 |
| sort | string | — | 如 `createdAt,desc` |

### 1.4 分页响应 data

```json
{
  "page": 1,
  "size": 20,
  "total": 100,
  "list": []
}
```

## 2. 认证模块 `/auth`

### 2.1 获取验证码

```
GET /auth/captcha
```

**响应 data：**
```json
{
  "captchaId": "uuid",
  "imageBase64": "data:image/png;base64,..."
}
```

### 2.2 登录

```
POST /auth/login
```

**请求 body：**
```json
{
  "appCode": "system",
  "username": "admin",
  "password": "Mis@123456",
  "captchaId": "uuid",
  "captchaCode": "a1b2"
}
```

**响应 data：**
```json
{
  "accessToken": "eyJ...",
  "expiresIn": 7200,
  "app": { "id": "1", "code": "system", "name": "系统管理" },
  "user": {
    "id": "1",
    "employeeId": "1",
    "username": "admin",
    "realName": "系统管理员",
    "avatarUrl": null,
    "deptId": "1",
    "deptName": "总部",
    "roles": ["TENANT_ADMIN"],
    "mustChangePassword": true
  }
}
```

`mustChangePassword=true` 时前端跳转改密页，**不进入主界面**（ADR-014）。

**Set-Cookie：** `mis_refresh_system=...; HttpOnly; SameSite=Strict`

### 2.3 刷新 Token

```
POST /auth/refresh
```

从 Cookie 读取 `mis_refresh_token`，或 body 传 `{ "refreshToken": "..." }`（待确认）。

**响应 data：**
```json
{
  "accessToken": "eyJ...",
  "expiresIn": 7200
}
```

### 2.4 登出

```
POST /auth/logout
```

吊销 refresh token，access token jti 加入 Redis 黑名单。

### 2.5 当前用户信息

```
GET /auth/me
```

权限：**从 Redis 读取**（`mis:rbac:permissions:{userId}`），非 JWT decode。权限变更后应重新调用本接口刷新前端菜单。

**响应 data：**
```json
{
  "id": "1",
  "username": "admin",
  "realName": "系统管理员",
  "avatarUrl": null,
  "email": null,
  "phone": null,
  "orgId": "1",
  "orgName": "总公司",
  "roles": ["ADMIN"],
  "permVersion": 12,
  "permissions": ["system:user:list", "..."]
}
```

可选响应头：`X-Perm-Stale: true`（JWT 内 `permVersion` **与**当前版本 **不等** 时置位，提示前端调 `GET /auth/me` 刷新菜单；**不**作为 API 鉴权失败条件）。

## 3. 菜单模块 `/menus`

### 3.1 获取前端路由树

```
GET /menus/router
```

权限：登录即可。根据当前用户角色过滤。

**响应 data：** 路由节点数组（见下方结构）。

```json
[
  {
    "id": "1",
    "name": "Dashboard",
    "path": "/dashboard",
    "component": "dashboard/index",
    "meta": {
      "title": "仪表盘",
      "icon": "LayoutDashboard",
      "permission": "dashboard:view"
    }
  },
  {
    "id": "10",
    "name": "System",
    "path": "/system",
    "component": "Layout",
    "meta": { "title": "系统管理", "icon": "Settings" },
    "children": [
      {
        "id": "11",
        "path": "user",
        "component": "system/user/index",
        "meta": { "title": "用户管理", "permission": "system:user:list" }
      }
    ]
  }
]
```

### 3.2 菜单管理 CRUD

| 方法 | 路径 | 权限 |
|------|------|------|
| GET | `/menus/tree` | system:menu:list |
| GET | `/menus/{id}` | system:menu:query |
| POST | `/menus` | system:menu:add |
| PUT | `/menus/{id}` | system:menu:edit |
| DELETE | `/menus/{id}` | system:menu:delete |

### 3.3 API 树管理（sys_api）

| 方法 | 路径 | 权限 |
|------|------|------|
| GET | `/apis/tree?appId=` | system:api:query |
| GET | `/apis/{id}` | system:api:query |
| POST | `/apis` | system:api:edit |
| PUT | `/apis/{id}` | system:api:edit |
| DELETE | `/apis/{id}` | system:api:edit |

**POST body（catalog）：**
```json
{
  "appId": "1",
  "parentId": "0",
  "code": "00010001",
  "type": "catalog",
  "name": "用户查询",
  "moduleId": "1",
  "sort": 10
}
```

**POST body（api 叶子）：**
```json
{
  "appId": "1",
  "parentId": "100",
  "code": "000100010001",
  "type": "api",
  "name": "用户列表",
  "moduleId": "1",
  "httpMethod": "GET",
  "pathPattern": "/api/v1/users",
  "permission": "system:user:list",
  "sort": 10
}
```

变更后触发 BFF `ApiPermissionRegistry` 刷新。

## 4. 用户模块 `/users`

### 4.1 用户列表

```
GET /users?page=1&size=20&username=&realName=&orgId=&status=
```

权限：`system:user:list`

**响应 list 项：**
```json
{
  "id": "2",
  "username": "zhangsan",
  "realName": "张三",
  "employeeNo": "EMP001",
  "orgId": "3",
  "orgName": "研发部",
  "email": "zhangsan@example.com",
  "phone": "13800000001",
  "status": 1,
  "roles": [{ "id": "2", "name": "部门经理", "code": "DEPT_MANAGER" }],
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### 4.2 用户详情

```
GET /users/{id}
```

权限：`system:user:query`

### 4.3 创建用户

```
POST /users
```

权限：`system:user:add`

**请求 body：**
```json
{
  "username": "newuser",
  "realName": "新用户",
  "orgId": "3",
  "email": "new@example.com",
  "phone": "13800000002",
  "employeeNo": "EMP005",
  "roleIds": ["4"],
  "status": 1
}
```

### 4.4 更新用户

```
PUT /users/{id}
```

权限：`system:user:edit`

### 4.5 删除用户

```
DELETE /users/{id}
```

权限：`system:user:delete`  
规则：不能删除自己；不能删除最后一个 ADMIN。

### 4.6 修改状态

```
PUT /users/{id}/status
```

**body：** `{ "status": 0 }`  
权限：`system:user:edit`

### 4.7 重置密码

```
PUT /users/{id}/reset-password
```

权限：`system:user:resetPwd`  
重置为 `sys_config.user.default_password`。

### 4.8 分配角色

```
PUT /users/{id}/roles
```

**body：** `{ "roleIds": ["2", "3"] }`  
权限：`system:user:assignRole`

## 5. 组织模块 `/orgs`

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/orgs` | system:org:list | 组织列表（租户下扁平） |
| GET | `/orgs/{id}` | system:org:query | 详情 |
| POST | `/orgs` | system:org:add | 创建 |
| PUT | `/orgs/{id}` | system:org:edit | 更新 |
| DELETE | `/orgs/{id}` | system:org:delete | 删除 |

**创建 body：**
```json
{
  "code": "shanghai",
  "name": "上海分公司",
  "sort": 10,
  "status": 1,
  "remark": ""
}
```

**删除规则：** 组织下存在部门 → 409（`ORG_HAS_CHILDREN` 或业务 message）。

## 6. 部门模块 `/depts`

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/depts/tree?orgId=` | system:dept:list | 指定组织下的部门树 |
| GET | `/depts/{id}` | system:dept:query | 详情 |
| POST | `/depts` | system:dept:add | 创建（body 含 `orgId`） |
| PUT | `/depts/{id}` | system:dept:edit | 更新 |
| DELETE | `/depts/{id}` | system:dept:delete | 删除 |

**创建 body：**
```json
{
  "orgId": "1",
  "parentId": "1",
  "name": "研发部",
  "categoryId": "3",
  "sort": 10,
  "status": 1
}
```

**删除规则：** 存在子部门 → 409；存在关联用户/员工 → 409。

## 7. 角色模块 `/roles`

| 方法 | 路径 | 权限 |
|------|------|------|
| GET | `/roles` | system:role:list |
| GET | `/roles/{id}` | system:role:query |
| POST | `/roles` | system:role:add |
| PUT | `/roles/{id}` | system:role:edit |
| DELETE | `/roles/{id}` | system:role:delete |
| GET | `/roles/{id}/menus` | system:role:query |
| PUT | `/roles/{id}/menus` | system:role:assignMenu |
| PUT | `/roles/{id}/data-scope` | system:role:edit |

**分配菜单 body：**
```json
{
  "menuIds": ["1", "10", "11", "12"]
}
```

**数据范围 body（data_scope=5 时）：**
```json
{
  "dataScope": 5,
  "orgIds": ["2", "3"],
  "deptIds": ["10", "11"]
}
```

> `orgIds` 写入 `perm_type='org'`；`deptIds` 写入 `perm_type='dept'`；至少一项非空。查询时二者 **OR** 合并。

## 8. 字典模块 `/dicts`

| 方法 | 路径 | 权限 |
|------|------|------|
| GET | `/dicts/types` | system:dict:list |
| POST | `/dicts/types` | system:dict:add |
| PUT | `/dicts/types/{id}` | system:dict:edit |
| DELETE | `/dicts/types/{id}` | system:dict:delete |
| GET | `/dicts/items?typeId=` | system:dict:list |
| POST | `/dicts/items` | system:dict:add |
| PUT | `/dicts/items/{id}` | system:dict:edit |
| DELETE | `/dicts/items/{id}` | system:dict:delete |

**公共接口（登录即可）：**
```
GET /dicts/items/by-type/{typeCode}
```

## 9. 审计模块 `/audit`

### 8.1 登录日志

```
GET /audit/login-logs?page=1&username=&status=&startTime=&endTime=
```

权限：`monitor:loginlog:list`

### 8.2 操作日志

```
GET /audit/oper-logs?page=1&module=&username=&startTime=&endTime=
GET /audit/oper-logs/{id}
```

权限：`monitor:operlog:list` / `monitor:operlog:query`

## 10. 系统模块 `/system`

### 9.1 系统信息

```
GET /system/info
```

**响应 data：**
```json
{
  "name": "MIS Platform",
  "version": "1.0.0",
  "env": "dev",
  "buildTime": "2026-06-23T00:00:00Z"
}
```

### 9.2 仪表盘统计

```
GET /dashboard/stats
```

权限：`dashboard:view`

**响应 data：**
```json
{
  "userCount": 4,
  "orgCount": 6,
  "todayLoginCount": 12,
  "onlineUserCount": 3
}
```

## 11. OpenAPI 文件规划

开工后在 `docs/api/openapi/` 按服务拆分：

```
openapi/
├── mis-auth.yaml
├── mis-user.yaml
├── mis-org.yaml
├── mis-rbac.yaml
├── mis-system.yaml
├── mis-audit.yaml
└── mis-admin-bff.yaml    # 聚合后的对外契约
```

## 12. 待确认项

- [ ] 批量删除接口是否纳入 Phase 1（用户、角色）
- [ ] 用户导入/导出 Excel 是否 Phase 1
- [ ] 修改密码接口（用户自助）是否 Phase 1
- [ ] 头像上传接口归属 mis-user 还是 mis-file（Phase 2）
- [ ] API 错误时 HTTP 状态码策略：一律 200 + code，还是 4xx/5xx

## 13. 关联文档

- [权限清单](permissions.md)
- [安全设计](../architecture/03-security.md)
- [微服务划分](../backend/microservices.md)
