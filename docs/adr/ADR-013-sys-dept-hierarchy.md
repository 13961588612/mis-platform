# ADR-013: 租户组织与部门模型 — sys_org + sys_dept 分层

## 状态
已接受（2026-06-24 修订：恢复 `sys_org` 组织层）

## 日期
2026-06-23（初版） / 2026-06-24（组织层）

## 背景

- 租户（集团公司）下往往有**多个组织**（法人主体、区域公司、事业部等），每个组织内再维护**多级部门树**。
- `sys_role_permission.perm_type='dept'` 的 `target_id` 指向 `sys_dept.id`；`perm_type='org'` 指向 `sys_org.id`（行级数据权限）。
- 部门树需与菜单/API 一致的**层级 `code`**（ADR-011），并支持租户级**部门类别**（`sys_dept_category`）。

> 初版 ADR-013 将 `sys_org` 合并为 `sys_dept`；现恢复 **`sys_org`（组织）+ `sys_dept`（部门）** 两层，以满足「租户 → 多组织 → 各部门」。

## 决策

### 1. 三层结构

```
sys_tenant（租户）
  └── sys_org（组织，扁平列表；Phase 1 不做组织间父子树）
        └── sys_dept（部门树，org 内 parent_id + 层级 code）
```

| 表 | 职责 | 对外 API（mis-org） |
|----|------|---------------------|
| `sys_org` | 租户下的组织单元 | `/api/v1/orgs` |
| `sys_dept` | 某组织内的部门树 | `/api/v1/depts?orgId=`、`/api/v1/depts/tree?orgId=` |
| `sys_dept_category` | 部门类别字典（总部/分公司/部门…） | 随部门维护引用 |

微服务名仍为 **`mis-org`**。

### 2. sys_org — 组织

| 字段 | 说明 |
|------|------|
| tenant_id | 租户 |
| code | 租户内唯一，如 `headquarters`、`shanghai` |
| name | 组织名称 |
| sort, status | 排序；0=禁用 1=启用 |
| remark | 备注 |
| deleted | 软删 |
| created_by / created_at / updated_by / updated_at | 审计 |

**索引：**
- `uk_org_tenant_code` UNIQUE (tenant_id, code) WHERE deleted=0
- `idx_org_tenant` (tenant_id)

Phase 1 组织为**扁平列表**（无 `parent_id`）；若未来需要组织树，另开 ADR 扩展。

### 3. sys_dept_category — 租户部门类别

每租户**独立维护**（非全局硬编码）：

| code | name（默认种子） |
|------|------------------|
| `headquarters` | 总部 |
| `branch` | 分公司 |
| `department` | 部门 |

### 4. sys_dept — 部门树（隶属组织）

| 字段 | 说明 |
|------|------|
| tenant_id | 租户 |
| **org_id** | → `sys_org.id`，部门树**按组织隔离** |
| parent_id | 父部门；**组织内根节点 parent_id=0** |
| **code** | **组织内**层级编码，规则同 ADR-011（每层 4 位：`0001`→`00010001`） |
| name | 部门名称 |
| category_id | → `sys_dept_category.id` |
| ancestors | 祖先路径 `0,1,5`（组织内查询本部门及下级） |
| sort | 同级排序 |
| **status** | 0=禁用 1=启用 |
| **is_root** | 1=该**组织**自动创建的根部门，**不可删** |
| leader_employee_id | 负责人 → `sys_employee.id` |
| deleted | 软删 |

**索引：**
- `uk_dept_org_code` UNIQUE (tenant_id, org_id, code) WHERE deleted=0
- `uk_dept_org_root` UNIQUE (org_id) WHERE is_root=1 AND deleted=0
- `idx_dept_org_parent` (org_id, parent_id)

> `code` 在**同一 org_id 内**唯一；不同组织可各有 `0001` 根节点。

### 5. 创建租户时自动初始化

```
创建 sys_tenant
  → 插入默认 sys_dept_category（总部/分公司/部门）
  → 插入默认 sys_org（如 code=headquarters, name=总部）
  → 在该组织下插入 sys_dept 根节点：
       org_id=上述组织, code=0001, parent_id=0, is_root=1, category_id=总部
  → TENANT_ADMIN 角色 + admin 用户（见 ADR-014）
```

租户管理员可**继续新增组织**；在每个组织下维护部门子树。

### 6. 与员工、数据权限

| 关联 | 字段 |
|------|------|
| 员工主部门 | `sys_employee.dept_id` → `sys_dept.id`（展示 / 主岗对齐） |
| **数据权限任职锚点** | 全部在任 `sys_employee_post` → `post.dept_id` / `dept.org_id` **并集**（ADR-014） |
| 角色自定义组织 | `sys_role_permission`（`perm_type='org'`, `target_id=org.id`） |
| 角色自定义部门 | `sys_role_permission`（`perm_type='dept'`, `target_id=dept.id`） |

`@DataScope` 预设范围（**不做任职切换**，多岗自动并集）：

| data_scope | 说明 |
|------------|------|
| 2 DEPT | `dept_id IN (全部在任任职部门)` |
| 3 DEPT_AND_CHILD | `dept_id IN (各任职部门子树并集)` |
| 6 ORG | `org_id IN (任职涉及的全部组织)` 或等价部门并集 |
| 5 CUSTOM | `perm_type='org'` 与 `perm_type='dept'` **OR** 合并（与任职无关） |

### 7. S1 多角色数据权限合并（已确认）

用户拥有多角色时，`perm_type='dept'|'org'` 的 `target_id` 集合各自取 **并集（union）**。

## 已确认

- [x] 租户下可有**多个** `sys_org`
- [x] 每个组织一棵 `sys_dept` 树（`uk_dept_org_root` 每组织一个根）
- [x] `sys_dept_category` 租户自定义
- [x] 开户：默认组织 + 该组织根部门
- [x] S1：多角色 `dept` / `org` 权限 **并集**

## 关联

- [ADR-012](ADR-012-sys-role-permission.md) `perm_type` 枚举
- [ADR-014](ADR-014-post-platform-admin.md) 开户流程
- [schema-design.md](../database/schema-design.md) §3.4–3.6
