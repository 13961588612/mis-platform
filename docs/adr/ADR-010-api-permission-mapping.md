# ADR-010: API 权限 — 菜单/按钮绑定 API 组（数据库存储）

## 状态
已接受（2026-06-23）；**API 存储模型由 [ADR-011](ADR-011-sys-api-code-multi-app-auth.md) 演进**（`sys_menu_api` → `sys_api` 独立树）

## 日期
2026-06-23

## 背景

- Controller 上 `@PreAuthorize` 硬编码不可维护（见 ADR-008）
- 独立 `api-permissions.yml` 与菜单、按钮脱节，管理台无法配置
- 业务期望模型：**目录 → 菜单页 → 菜单内按钮 → 每个按钮（或菜单页）绑定一组 API**

## 决策

### 权限模型（三级 UI + API 组）

```
目录 (sys_menu.type=1)
└── 菜单页 (type=2, permission=如 system:user:list)
    ├── 页面 API 组 (sys_menu_api.menu_id = 菜单页 id)
    │     GET /api/v1/users
    │     GET /api/v1/orgs/tree          # 页面加载需要的接口
    └── 按钮 (type=3, parent_id=菜单页, permission=如 system:user:add)
          └── 按钮 API 组 (sys_menu_api.menu_id = 按钮 id)
                POST /api/v1/users
```

| 节点 | sys_menu.type | permission 含义 | API 绑定 |
|------|---------------|-----------------|----------|
| 目录 | 1 | 通常为空 | 无 |
| 菜单页 | 2 | 进入页面所需权限（含列表类 API） | 挂在**菜单页**上的 API 组 |
| 按钮 | 3 | 点击操作所需权限 | 挂在**按钮**上的 API 组 |

**角色分配**：用 **`sys_role_permission`**（`perm_type='menu'`）勾选菜单树。用户 permissions = 已勾选节点的 `sys_menu.permission` 去重集合。

> 表命名见 [ADR-012](ADR-012-sys-role-permission.md)；部门等数据权限用 `perm_type='dept'` 等同表扩展。

**API 鉴权**：请求 `method + path` → 查 `sys_menu_api` → 得 `menu_id` → 读 `sys_menu.permission` → 比对用户 Redis permissions。

### 存储

| 表 | 职责 |
|----|------|
| `sys_menu` | 目录/菜单/按钮树 + **permission 标识** |
| `sys_menu_api` | **菜单或按钮** ↔ HTTP API 一对多 |
| `sys_role_permission` | 角色权限（`perm_type='menu'` 为菜单/按钮） |

**不再使用** `api-permissions.yml` 作为主数据源（可用 Flyway 种子初始化，运行时只读 DB）。

### BFF 加载与刷新

```
启动 / 定时(5min) / 菜单变更事件:
  mis-system GET /internal/v1/api-permissions/registry
  → BFF 内存 ApiPermissionRegistry (method+path → permission)

菜单或 sys_menu_api 变更:
  → 发布刷新（Redis 通知或 MQ，Phase 1 可短轮询）
  → 重载 Registry
  → evict 受影响用户 permissions Redis（若 permission 字段变更）
```

### 请求处理

```
Gateway 验 JWT
 → BFF JwtContextFilter（userId → Redis permissions）
 → ApiPermissionInterceptor（DB 映射表：method+path → permission）
 → Controller
```

### 特殊 API

| 类型 | 处理 |
|------|------|
| login/captcha/refresh | Gateway 白名单，**不入库** |
| 仅登录即可（/auth/me） | `sys_menu_api` 关联 permission 为空的系统节点，或 `require_auth_only=true` 字段 |
| 未配置 API | 生产 **403** 默认拒绝 |

### 管理台 UI（菜单管理页扩展）

- 左：菜单树
- 中：选中**菜单页**或**按钮**的基本信息
- 右：**API 列表**（method、path_pattern、说明）增删改

### 禁止事项

- ❌ Controller `@PreAuthorize` 硬编码
- ❌ 独立 YAML 与 DB 双维护（种子 SQL 可生成初始数据）
- ❌ API 行上重复存 permission 字符串（**从 sys_menu 继承**，避免不一致）

### 实现类（mis-common-security）

```
com.mis.common.security.permission/
├── ApiPermissionRule.java
├── ApiPermissionRegistry.java        # 内存 method+path → permission
├── ApiPermissionInterceptor.java
└── ApiPermissionRefreshListener.java # 监听菜单/API 变更
```

## 后果

### 正面
- 菜单、按钮、API **一处配置**，角色勾选即生效
- 支持「一按钮多 API」（如编辑：GET 详情 + PUT 保存）
- 管理台可运维，无需改代码发版（改 API 绑定）

### 负面
- 启动依赖 mis-system；需 Registry 刷新机制
- 菜单管理员需理解 API 路径（可提供从 OpenAPI 导入，Phase 2）

## 已确认

- [x] API 映射存 **`sys_menu_api`**，挂在菜单页或按钮
- [x] permission 字符串只在 **`sys_menu.permission`**
- [x] BFF `ApiPermissionInterceptor` 读 DB 映射
