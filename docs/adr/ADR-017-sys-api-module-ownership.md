# ADR-017: sys_api 归属模块、去租户/应用、API 多绑定

## 状态
已接受（2026-07-28）

## 日期
2026-07-28

## 背景

ADR-011 原设计中，`sys_api` 同时携带 `tenant_id` + `app_id`（按 APP 隔离）+ `module_id`（平台级）。但在实际鉴权链路中，`SysApi.tenant_id` / `app_id` 从未被读取——BFF Registry SQL 只取 `method` / `path` / `permission` 三元组。因此：

- 归属 APP（`tenant_id`, `app_id`）是**冗余列**，徒增维护成本；
- 「按 APP 隔离」与产品目标「模块下 API 跨 app / 租户共享」直接冲突——同一端点（如 `GET /api/v1/users/{id}`）在不同 APP 下需重复登记，违背 DRY；
- 模块停用缺乏运行时熔断手段，下线一个模块需手工清理其下所有 API 注册行。

本 ADR 记录上一轮「接口模块管理后台」重构（落地于 commit `3e992a7` / `712721b`）对上述问题的架构决策。

## 决策

### 1. sys_api 归属 sys_module，去租户/应用

- 移除 `sys_api.tenant_id`、`sys_api.app_id` 两列；
- `module_id` 由可空升级为 **`NOT NULL`** + 外键 `fk_api_module` → `sys_module.id`；
- `sys_api` 成为**平台级共享资源**，由模块（`sys_module` 本身为平台级，无 `tenant_id` / `app_id`）组织。

一个 API 端点只登记一次，模块下跨 app / 租户共享。

### 2. 唯一索引迁移

| 原 | 新 |
|----|----|
| `uk_api_app_code (app_id, code)` | `uk_api_module_code (module_id, code)` |

唯一性由「应用 + code」改为「模块 + code」，与归属变更对齐。

### 3. type 字段类型升级

`sys_api.type` 由 `VARCHAR(16)` 升级为 PostgreSQL ENUM `sys_api_node_type`，取值 `catalog | api`：

- 数据库层强约束取值域，杜绝脏数据；
- 与 `SysMenu.type` 的 `MenuType` 枚举化思路一致（见决策 6）。

### 4. API 多绑定放开

`sys_menu_api` 调整唯一约束：

| 约束 | 变更 |
|------|------|
| `uk_menu_api_api UNIQUE (api_id)` | **移除** |
| `uk_menu_api_pair UNIQUE (menu_id, api_id)` | **保留** |

一个 API 可被**多个菜单页 / 按钮绑定**，所需 permission 取**并集**。例如 `GET /api/v1/users/{id}` 可同时挂在「用户列表」菜单页（`system:user:list`）与「编辑用户」按钮（`system:user:edit`），命中时用户拥有任一即放行。

### 5. 模块停用拦截

Registry SQL 由原来的

```sql
sys_api ⋈ sys_menu_api ⋈ sys_menu
```

演进为

```sql
sys_api
  JOIN sys_module sm ON sm.id = sys_api.module_id
  JOIN sys_menu_api ...
  JOIN sys_menu ...
```

关键点：

- registry SQL **取 `sm.status AS moduleStatus`，但不过滤 `sm.status = 1`**——停用模块的规则仍留在注册表（保留行）；
- `ApiPermissionInterceptor` 命中规则后，若 `moduleStatus == 0` → 抛 `BusinessException(ResultCode.FORBIDDEN)`，位于**登录校验之前**，无绕过路径；
- Phase-1 约定：`BusinessException` → HTTP 200 + `body.code = 40300`（非真实 HTTP 403），由全局异常处理器统一包装。

如此停用一个模块 = 把 `sys_module.status` 置 0 即可即时熔断其下所有 API，无需删注册行、无需重启。

### 6. 按钮 = menu 节点类型

`SysMenu.type` 用 `MenuType` 枚举表示：

| 值 | 枚举 | 含义 |
|----|------|------|
| 1 | `CATALOG` | 目录 |
| 2 | `MENU` | 菜单页 |
| 3 | `BUTTON` | 按钮 |

- 加 `@Convert`（JPA `AttributeConverter`），DB 存 tinyint，Java 用枚举；
- 与 `sys_api.type` ENUM 化一致，取值域受控。

### 7. 旧 /system/api 泛型页下线

前端 `/system/api`（原泛型 API 树管理页）由 `/system/module`（**接口模块管理后台**）接管：

- `/system/module`：模块 CRUD + 选中模块下的 API 树（只读展示）；
- `/system/api` 路由下线，避免两处入口维护同一批数据造成不一致。

## 备选方案

| 方案 | 未采纳原因 |
|------|-----------|
| 保留 `sys_api.app_id`，在 registry 用 `app_id` 做隔离过滤 | 与「跨 app 共享」目标冲突；且鉴权链路根本不读 `app_id`，属无意义隔离 |
| 模块停用时物理删除其下 API 注册行 | 需重建注册表、影响 registry 一致性窗口；不如「保留行 + 运行时熔断」简单可逆 |
| `sys_api.type` 仍用 `VARCHAR(16)` | 无取值域约束，易产生 `Catalog`/`CATALOG`/`catalog` 等脏值 |
| API 仍一对一绑定菜单 | 一个通用详情接口无法复用于「列表」与「编辑」两个权限点，权限配置膨胀 |

## 后果

### 正面

- `sys_api` 模型与鉴权链路**实际读取**一致，消除冗余归属列；
- API **跨 app / 租户共享**成为一等公民，同一端点只登记一次；
- 模块停用提供**运行时熔断**能力（置 `status=0` 即时生效），运维友好；
- API 多绑定让通用接口可复用于多个权限点，配置更贴近真实业务。

### 负面 / 权衡

- `sys_api` 不再有**应用级隔离**：若未来某 app 需私有 API，须靠 module 划分或新增隔离机制；
- 停用模块的 API 规则仍**驻留 registry**（占用注册表行），换取拦截器一次 JOIN 即可熔断，属「空间换时间 + 可逆」的取舍；
- `type` ENUM 化使后续新增节点类型需走 DDL `ALTER TYPE ... ADD VALUE`，略增迁移成本。

## 关联 ADR

### 接续（supersede 局部条款）

- **ADR-011**（sys_api 统一 API 树、层级 code、按 APP 隔离用户与令牌）：以下条款已被本 ADR 接续——
  - §2 sys_api `归属：tenant_id, app_id（门户隔离）` → 已去 `tenant/app`，仅 `module_id`；
  - §3 sys_menu_api `每个 api_id 全局唯一归属一个 menu 节点` → 已放开多绑定；
  - §5 BFF Registry `sys_api ⋈ sys_menu_api ⋈ sys_menu` → 现含 `JOIN sys_module` + `moduleStatus`；
  - §附录 ER `sys_api (app=system)` → `sys_api` 无 `app`。
  - ADR-011 其余条款（sys_api 树 / code 层级、按 APP 隔离用户与令牌、`sys_role_permission` 等）仍然有效。
- **ADR-010**（API 权限映射）：存储模型部分仍有效，仅 registry SQL 演进（JOIN `sys_module` + `moduleStatus`）。

### 关联

- **ADR-008**（BFF 集中式鉴权）：`ApiPermissionInterceptor` 位于 BFF 层，本 ADR 的模块停用熔断即挂在此拦截器；
- **ADR-009**（权限存 Redis 不存 JWT）：registry 加载 / 刷新策略仍有效，本 ADR 不改变权限存储位置，仅演进 registry SQL 与拦截逻辑。

## 验收清单（已落地，commit 3e992a7 + 712721b）

- [x] `V8__module_api_refactor.sql` 迁移：去 `tenant_id`/`app_id` 列、加 `fk_api_module` FK、`uk_api_module_code` 索引、`sys_api_node_type` ENUM、种子菜单
- [x] `SysApi.java` 实体去 `tenantId` / `appId`，`module_id` 必填
- [x] `SysApiRepository.findRegistryRows()` JOIN `sys_module` 取 `moduleStatus`
- [x] `ApiPermissionInterceptor` 命中后 `moduleStatus == 0` → `BusinessException(ResultCode.FORBIDDEN)`
- [x] `SysModule` / `SysModuleRepository` / `ModuleService` / `ModuleController`（模块 CRUD + API 树只读）
- [x] `sys_menu_api` 放开 `uk_menu_api_api`，保留 `uk_menu_api_pair`
- [x] `MenuType` 枚举（CATALOG=1 / MENU=2 / BUTTON=3）+ `@Convert`
- [x] 前端 `/system/module` 页接管，`/system/api` 下线
- [x] QA 回归全绿（`ApiPermissionModuleStatusTest` / V8 迁移 / 跨文件一致性 / 前端接线）
