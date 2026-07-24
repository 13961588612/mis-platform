# 种子数据与初始化

> 状态：📝 草稿 | 版本：v1.1 | 见 [ADR-014](../adr/ADR-014-post-platform-admin.md)

## 1. 原则

| 项 | 规则 |
|----|------|
| 测试账号 | Phase 1 **不预置** zhangsan 等 |
| 内置角色 | 仅 **`TENANT_ADMIN`**（租户）；`DEPT_MANAGER` 等由租户后期创建 |
| 默认密码 | `Mis@123456`；**首次登录强制改密** |
| 权限 | **不支持通配符** |

## 2. 平台 superadmin（sys_platform_user）

| username | 密码（明文） | is_protected | must_change_password |
|----------|-------------|--------------|----------------------|
| superadmin | Mis@123456 | 1 | 1 |

> 管理所有租户；登录：`POST /api/v1/platform/auth/login`（规划）。

## 3. 默认租户（sys_tenant id=1）

| code | name |
|------|------|
| default | 默认租户 |

**开户自动创建（应用层 / 迁移脚本）：**

1. `sys_dept_category` 默认 3 类（总部/分公司/部门）
2. `sys_org` 默认组织（如 `headquarters` / 总部）
3. `sys_dept` 在该组织下根节点 `code=0001`, `is_root=1`
4. `sys_role` 内置 `TENANT_ADMIN`（`type=1`, `data_scope=1`）
5. `sys_employee` + `sys_user`（`app=system`）：

| username | 说明 | is_tenant_admin | must_change_password |
|----------|------|-----------------|----------------------|
| admin | 租户管理员 | 1 | 1 |

6. `sys_user_role`：admin → TENANT_ADMIN
7. `sys_role_permission`：TENANT_ADMIN → 全部菜单节点（种子写入）

> **admin 不可删除自己**；不可禁用租户内最后一个 `is_tenant_admin=1` 的账号。

## 4. 组织与部门（Phase 1 种子）

默认 **1 个组织** + 该组织下 **1 个根部门**；不预置子部门树（租户自行维护）。

## 5. 岗位（Phase 1）

- **不预置** `sys_post` / `sys_employee_post`
- 租户可自行维护 `sys_post_type`；开户可不写岗位类型种子

## 6. 菜单 / API / 模块

见 [permissions.md](../api/permissions.md)、[api-permission-mapping.md](../backend/api-permission-mapping.md)。  
仅 `TENANT_ADMIN` 绑定全量菜单权限。

**`sys_module.service_name`（Sprint 2）：** `iam`→`mis-iam`、`org`→`mis-org`、`system`→`mis-system`、`audit`→`mis-audit`。  
原 `mis-user` / `mis-rbac` 已由 **Flyway V3**（`V3__rename_sys_module_services.sql`）合并到 `mis-iam`；**禁止改已发布的 V2**。

## 7. 系统参数 sys_config

| config_key | config_value | remark |
|------------|--------------|--------|
| security.password.min_length | 8 | |
| security.login.max_fail | 5 | |
| security.login.lock_minutes | 30 | |
| security.token.access_ttl | 7200 | |
| security.token.refresh_ttl | 604800 | |
| user.default_password | Mis@123456 | |
| **security.password.must_change_on_first_login** | **true** | 首次登录强制改密 |

## 8. 已确认

- [x] 无测试用户；仅 superadmin + 租户 admin
- [x] admin / superadmin 首次须改密
- [x] 不预置 DEPT_MANAGER 等角色

## 9. 关联文档

- [表结构设计](schema-design.md)
- [ADR-014](../adr/ADR-014-post-platform-admin.md)
