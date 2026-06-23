# ADR-014: 岗位任职、平台 superadmin、租户 admin

## 状态
已接受

## 日期
2026-06-23

## 背景

- 租户需自定义**岗位类型**，在部门下设置**岗位**，员工**任职**且可**兼职多岗**。
- **superadmin** 管理全平台租户；每租户有独立 **admin**，不可自删。
- **DEPT_MANAGER** 等业务角色由租户后期在系统内创建，**不预置种子**。
- 权限**不支持通配符**；默认密码**首次登录必须修改**；Phase 1 **不预置测试账号**。

## 决策

### 1. 岗位模型

| 表 | 说明 |
|----|------|
| `sys_post_type` | 租户岗位**类型**（如管理岗、技术岗、财务岗） |
| `sys_post` | 部门下的**岗位编制**（dept_id + post_type_id + name） |
| `sys_employee_post` | 员工**任职**（多岗；`is_primary` 标记主岗） |

```
sys_tenant
  ├── sys_post_type（租户自定义类型）
  ├── sys_dept
  │     └── sys_post（部门岗位编制）
  └── sys_employee
        └── sys_employee_post → sys_post（可多条，兼职）
```

| 字段要点 | 说明 |
|----------|------|
| `sys_employee.dept_id` | **主部门**（数据权限默认锚点） |
| `sys_employee_post.is_primary` | 主岗=1；每员工建议仅一条主岗 |
| `sys_employee_post.status` | 0结束 1在任 |

开户可为 `sys_post_type` 写入可选默认模板；**不强制**预置岗位编制。

### 2. 平台 superadmin vs 租户 admin

| 身份 | 存储 | 说明 |
|------|------|------|
| **superadmin** | `sys_platform_user` | 平台级；`tenant_id` 无；管理所有租户 |
| **租户 admin** | `sys_user` + 内置角色 `TENANT_ADMIN` | 每租户至少一个；`is_tenant_admin=1` |

**保护规则：**
- `sys_platform_user.is_protected=1`：不可删、不可禁用（种子 superadmin）
- `sys_user.is_tenant_admin=1`：租户管理员；**不可删除自己**；不可禁用最后一个租户 admin
- 内置角色 `TENANT_ADMIN`（`sys_role.type=1`）不可删

**DEPT_MANAGER / HR_MANAGER 等**：`type=2` 自定义角色，**种子不插入**；由租户 admin 在角色管理中创建。

### 3. 密码与权限

| 项 | 规则 |
|----|------|
| 默认密码 | `Mis@123456`（`sys_config`） |
| 首次登录 | `sys_user.must_change_password=1` → 强制改密后才可进入系统 |
| 权限通配符 | **不支持** `system:user:*`；仅精确 `permission` 匹配 |
| 测试账号 | Phase 1 种子**仅** superadmin + 默认租户 admin |

### 4. Phase 1 功能范围（F1–F6）

| ID | 项 | Phase 1 |
|----|-----|---------|
| F1 | 批量删除（用户/角色） | ❌ |
| F2 | 用户 Excel 导入/导出 | ❌ |
| F3 | 自助改密 + **首次登录强制改密** | ✅ |
| F4 | 个人中心（改密页） | ✅（支撑 F3） |
| F5 | 多 Tab 工作区 | ✅ |
| F6 | AI Copilot **占位 UI**（无真实 LLM 调用） | ✅ |

### 5. 工程（同期确认）

| 项 | 决策 |
|----|------|
| 服务部署 | **mis-auth** 与 **mis-user** **分开**部署 |
| 内部调用 | 服务间 **直连**（RestClient/WebClient），不经 Gateway |
| SonarQube | Phase 1 **不接入** |
| 本地开发 | **同时支持** Docker Compose 全栈 **与** IDE 直跑 Java 服务 |

## 已确认

- [x] 岗位类型 + 部门岗位 + 员工多岗任职
- [x] superadmin + 租户 admin 保护规则
- [x] DEPT_MANAGER 不预置；无权限通配符；首次改密；无测试账号
- [x] F1–F6、auth/user 分离、内网直连、无 Sonar、Docker+IDE 本地开发
