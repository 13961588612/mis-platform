# ADR-013: 部门模型 — 层级 code、状态、租户部门类别、自动根节点

## 状态
已接受

## 日期
2026-06-23

## 背景

- 原 `sys_org` 仅粗粒度字段，缺少与菜单/API 一致的**层级 `code`**、租户级**部门类别**。
- `sys_role_permission.perm_type='dept'` 的 `target_id` 需指向明确的部门实体。
- 每个租户（集团公司）应有一棵部门树，**创建租户时自动建立顶级根部门**。

## 决策

### 1. 表命名

| 原 | 新 |
|----|-----|
| `sys_org` | **`sys_dept`**（组织/部门统一称「部门」） |
| — | **`sys_dept_category`**（租户自定义部门类别） |

微服务名可仍为 `mis-org`，对外 API 建议 `/api/v1/depts`。

### 2. sys_dept_category — 租户部门类别

每租户**独立维护**类别字典（非全局硬编码）：

| 字段 | 说明 |
|------|------|
| tenant_id | 租户 |
| code | 类别编码，租户内唯一，如 `headquarters`、`branch`、`store` |
| name | 显示名：总部、分公司、门店… |
| sort, status | 排序、0禁用 1启用 |

**开户默认种子（可改、可增删）：** 创建租户时插入租户自选模板，建议默认 3 条：

| code | name |
|------|------|
| `headquarters` | 总部 |
| `branch` | 分公司 |
| `department` | 部门 |

租户可在管理台自行增加如 `store`（门店）、`project`（项目部）等。

### 3. sys_dept — 部门树

| 字段 | 说明 |
|------|------|
| tenant_id | 租户 |
| parent_id | 父部门；**根节点 parent_id=0** |
| **code** | **层级编码**，规则同 ADR-011（每层 4 位：`0001`→`00010001`） |
| name | 部门名称 |
| **category_id** | → `sys_dept_category.id` |
| ancestors | 祖先路径 `0,1,5`（便于本部门及下级查询） |
| sort | 同级排序 |
| **status** | 0=禁用 1=启用（**不用 deleted 表达业务停用**） |
| **is_root** | 1=租户自动创建的顶级节点，**不可删** |
| leader_employee_id | 负责人 → `sys_employee.id` |
| deleted | 软删（物理移除用；根节点不允许删） |

**索引：**
- `uk_dept_tenant_code` UNIQUE (tenant_id, code) WHERE deleted=0
- `uk_dept_tenant_root` UNIQUE (tenant_id) WHERE is_root=1 AND deleted=0
- `idx_dept_parent` (tenant_id, parent_id)

### 4. 创建租户时自动建根部门

```
创建 sys_tenant
  → 插入默认 sys_dept_category（总部/分公司/部门，可配置模板）
  → 插入 sys_dept 根节点：
       code=0001, name=租户名称, parent_id=0, is_root=1,
       category_id=总部类别, status=1
```

子部门 code 由管理台按父 code 递增生成（应用层）。

### 5. 与员工、数据权限

| 关联 | 字段 |
|------|------|
| 员工主部门 | `sys_employee.dept_id` → `sys_dept.id` |
| 用户数据范围主部门 | `sys_user.dept_id`（可覆盖员工主部门） |
| 角色自定义部门 | `sys_role_permission`（`perm_type='dept'`, `target_id=dept.id`） |

`@DataScope` 中 `DEPT` / `DEPT_AND_CHILD` / `CUSTOM` 均基于 `sys_dept` 树。

### 6. S1 多角色部门权限合并（已确认）

用户拥有多角色时，`perm_type='dept'` 的 `target_id` 集合取 **并集（union）**。

与 `data_scope` 合并：先按角色取最宽松 `data_scope` 枚举；若为 `CUSTOM(5)`，再与并集后的 dept id 列表求交（实现层在 mis-rbac 统一计算）。

## 已确认

- [x] S1：多角色 `dept` 权限 **并集**
- [x] 部门表 `sys_dept`，层级 `code` + `status`
- [x] 每租户 `sys_dept_category` 自定义类别
- [x] 创建租户自动建顶级根部门 `code=0001`

## 关联

- [ADR-012](ADR-012-sys-role-permission.md) `perm_type` 枚举
- [schema-design.md](../database/schema-design.md) §3.4–3.5
