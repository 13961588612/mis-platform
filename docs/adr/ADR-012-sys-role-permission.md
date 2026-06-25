# ADR-012: sys_role_permission 统一角色权限表（按 perm_type 扩展）

## 状态
已接受

## 日期
2026-06-23

## 背景

原 `sys_role_menu` 仅表达「角色勾选菜单树」。后续还需为角色配置：

- 部门数据范围（原 `sys_role_data_scope`）
- 分店 / 门店权限（Phase 2+）
- 其他按资源类型扩展的授权

若每种权限单独建关联表，表数量与 evict 逻辑会线性膨胀。

## 决策

### 1. 表命名

| 原 | 新 |
|----|-----|
| `sys_role_menu` | **`sys_role_permission`**（`perm_type='menu'`） |
| `sys_role_data_scope` | **合并**入 `sys_role_permission`（`perm_type='dept'`） |

### 2. 表结构

```sql
sys_role_permission (
  id          BIGINT PK,
  role_id     BIGINT NOT NULL,
  perm_type   sys_perm_type NOT NULL,  -- ENUM: menu | dept | store
  target_id   BIGINT NOT NULL,       -- 多态目标
  created_at  TIMESTAMPTZ NOT NULL
)
UNIQUE (role_id, perm_type, target_id)
```

### 3. perm_type 语义

| perm_type | target_id | 用途 | 运行时 |
|-----------|-----------|------|--------|
| `menu` | `sys_menu.id` | 功能/UI 权限 | 聚合 `permission` → Redis；BFF API 鉴权 |
| `dept` | `sys_dept.id` | 部门数据范围 | `@DataScope`；`data_scope=5` 时读取 |
| `org` | `sys_org.id` | 组织数据范围 | `@DataScope`；`data_scope=5` 时与 `dept` **OR** 合并 |
| `store` | 待定 | 门店权限 | Phase 2+ |

### 3.1 perm_type 存储（S2 已确认）

Phase 1 使用 PostgreSQL **`sys_perm_type` ENUM**（`menu`, `dept`, `org`, `store`）。应用层 Java 枚举与之一一对应；扩展新类型需 `ALTER TYPE ... ADD VALUE` 迁移。

### 4. 与 sys_role.data_scope 的关系

| data_scope | 行为 |
|------------|------|
| 1–4、6 | 按枚举规则，**不读** `perm_type='dept'|'org'` |
| 5 CUSTOM | `perm_type='org'` 与 `perm_type='dept'` 的 `target_id` 分别加载；查询时 **OR** 合并 |

多角色合并 data_scope 规则不变（取最宽松：`ALL > CUSTOM > ORG > DEPT_AND_CHILD > DEPT > SELF`）；`perm_type='dept'|'org'` 的 `target_id` 多角色均取 **并集（S1 已确认）**。

### 5. Redis evict

角色 `sys_role_permission` 变更（任意 `perm_type`）→ 查 `sys_user_role` → DEL `mis:rbac:permissions:{tenantId}:{appId}:{userId}`。

`perm_type='dept'` 变更不影响 Redis permissions 集合，但影响数据查询范围（可 bump `sys_user.perm_version` + Redis 供前端刷新）。

## 后果

### 正面
- 一张表承载多种角色授权，扩展新店型只需加 `perm_type` 枚举
- 命名 `sys_role_permission` 比 `sys_role_menu` 更准确

### 负面
- `target_id` 多态，数据库无法建单一 FK，靠应用层校验
- 查询需带 `perm_type` 条件

## 已确认

- [x] `sys_role_menu` → `sys_role_permission`，`perm_type` 区分类型
- [x] `sys_role_data_scope` 合并为 `perm_type='dept'`
- [x] S1：多角色 `dept` 并集
- [x] S2：`perm_type` 使用 ENUM（`menu`/`dept`/`store`）
