# Schema 细化讨论稿

> 状态：📝 **讨论中**（确认后再写 V1/V2 SQL）  
> 主文档：[schema-design.md](schema-design.md)  
> 版本：v1.1-discussion

---

## 0. 已拍板项（2026-06-23）

### 0.1 全局（第一步）


| #   | 决策                                 | 状态   |
| --- | ---------------------------------- | ---- |
| 1   | Phase 1 单库 `mis_platform`          | ✅    |
| 2   | 默认管理员 `admin` / `Mis@123456`       | ✅    |
| 3   | JWT + Refresh Cookie，Phase 1 无 SSO | ✅    |
| 4   | Flowable Phase 2                   | ✅    |
| 5   | UI 默认中文，i18n 预留                    | ✅    |
| 6   | 生产部署 Kubernetes                    | ✅    |
| 7   | LLM Phase 3 多模型可插拔                 | ✅    |
| 8   | 团队分工                               | ⏳ 待定 |


### 0.2 工程（第三步）


| 项              | 决策                                                             |
| -------------- | -------------------------------------------------------------- |
| Java 构建        | **Maven**（多模块 `pom.xml`）                                       |
| HTTP 错误        | 业务错误 **HTTP 200 + body.code**；认证 401、网关层 403 可用 HTTP 状态        |
| 权限 Redis evict | 角色/菜单变更 → 查 `sys_user_role` **按 roleId 批量 DEL** 用户 permissions |
| 多角色 data_scope | 取 **最大范围**（ALL > CUSTOM > ORG > DEPT_AND_CHILD > DEPT > SELF）        |
| Flyway 执行      | **独立 `mis-migrator` 模块**（见 §9）                                 |
| 前端包管理          | pnpm（暂定，可再改）                                                   |
| Python         | uv 或 poetry（Phase 3 前再定）                                       |


### 0.3 权限与 API（已 ADR）

- 权限运行时：**Redis**（key 含 `appId`），JWT 不含 permissions（ADR-009）
- API 注册：`**sys_api`** 独立树，`type=catalog|api`；菜单树 `**sys_menu**` 独立 `code` 层级（ADR-011）
- 角色授权：**`sys_role_permission`**（`perm_type` 区分；Phase 1：`menu` / `dept` / `org`）
- BFF：`ApiPermissionInterceptor` 从 `sys_api WHERE type=api` 加载 Registry

---

## 1. 设计原则（数据库层）


| 原则    | 说明                                          |
| ----- | ------------------------------------------- |
| 权威源   | 菜单、按钮、API 绑定、角色授权 **全部在 PostgreSQL**        |
| 应用层校验 | 服务层校验树结构（目录→菜单→按钮）、API 归属类型                 |
| 软删除   | 用户/组织/角色软删；菜单/API 建议 **硬删或 status=0**（见 §4） |
| 外键    | Phase 1 **逻辑外键为主**，减少软删级联复杂度；关键字段应用层保证      |
| ID    | 雪花 BIGINT；种子数据可用**ID** **固定小整数** 便于引用       |


---

## 2. 核心域：菜单树 + API 树（两棵独立 code 树）

> ADR-011：`sys_menu` 与 `sys_api` **各自** `code` 编号；鉴权 permission 来自菜单节点 + 已授权 API 叶子。

### 2.1 sys_menu 树结构规则

```
type=1 目录     parent 可为 0 或其他目录
type=2 菜单页   parent 必须是 type=1 目录（或 0 仅根级特殊页）
type=3 按钮     parent 必须是 type=2 菜单页
```


| type  | permission | path/component   | sys_menu_api |
| ----- | ---------- | ---------------- | ------------ |
| 1 目录  | NULL       | path 有值          | ❌            |
| 2 菜单页 | **必填**     | path + component | ✅ 页面 API     |
| 3 按钮  | **必填**     | 空                | ✅ 操作 API     |


**讨论点 D1：** 是否允许「按钮挂在目录下」？  
**倾向：** ❌ 不允许，强制 目录→菜单→按钮，UI 与数据一致。

### 2.2 sys_menu 字段细化


| 字段                      | 类型              | 必填规则    | 说明                              |
| ----------------------- | --------------- | ------- | ------------------------------- |
| id                      | BIGINT          | PK      | 雪花；种子可用 1–9999                  |
| tenant_id               | BIGINT          | 默认 0    | **0=全局模板**；租户定制 Phase 2 复制      |
| parent_id               | BIGINT          | 默认 0    | 根=0                             |
| **code**                | **VARCHAR(64)** | 必填      | 层级编码 `0001`/`00010001`（ADR-011） |
| app_id                  | BIGINT          | 必填      | 菜单只属于一个 APP                     |
| name                    | VARCHAR(64)     | 必填      | 侧栏/按钮文案                         |
| type                    | SMALLINT        | 必填      | 1/2/3                           |
| path                    | VARCHAR(128)    | type1/2 | 路由相对 path，如 `user`              |
| component               | VARCHAR(128)    | type=2  | 如 `system/user/index`           |
| permission              | VARCHAR(128)    | type2/3 | 全局唯一？见 D2                       |
| icon                    | VARCHAR(64)     | type1/2 | Lucide 名                        |
| sort                    | INT             | 默认 0    | 同级排序                            |
| visible                 | SMALLINT        | 默认 1    | 按钮也可隐藏                          |
| status                  | SMALLINT        | 默认 1    | 0 禁用：不参与授权与 Registry            |
| is_external             | SMALLINT        | 0       | 外链菜单                            |
| keep_alive              | SMALLINT        | 0       | 仅 type=2                        |
| deleted                 | SMALLINT        | 见 D3    | 是否软删                            |
| created_at / updated_at | TIMESTAMPTZ     | 必填      |                                 |


**讨论点 D2：** `permission` 是否 APP 内唯一？  
**倾向：** ✅ `(app_id, permission)` 唯一（WHERE status=1）。

**讨论点 D3：** 菜单是否软删除？  
**倾向：** 用 **status=0 禁用** 代替软删；删除菜单前校验无子节点、无角色引用。`deleted` 字段可从 menu 表 **去掉** 简化。

### 2.3 sys_api 字段细化（API 注册树）

| 字段                      | 类型              | 约束       | 说明                |
| ----------------------- | --------------- | -------- | ----------------- |
| id                      | BIGINT          | PK       |                   |
| tenant_id               | BIGINT          |          |                   |
| app_id                  | BIGINT          | NOT NULL |                   |
| module_id               | BIGINT          | NOT NULL | → sys_module      |
| parent_id               | BIGINT          | 默认 0     |                   |
| **code**                | **VARCHAR(64)** | NOT NULL | 层级编码，与 menu 独立    |
| **type**                | **VARCHAR(16)** | NOT NULL | `catalog` \| `api` |
| name                    | VARCHAR(64)     |          |                   |
| http_method             | VARCHAR(16)     | type=api | GET,POST,...      |
| path_pattern            | VARCHAR(256)    | type=api | `/api/v1/...`     |
| sort                    | INT             | 默认 0     |                   |
| status                  | SMALLINT        | 默认 1     |                   |
| created_at / updated_at | TIMESTAMPTZ     |          |                   |

> **无 `permission` 字段**；鉴权标识在关联的 `sys_menu.permission`。

**全局唯一：** `UNIQUE (http_method, path_pattern)` WHERE type=api AND status=1。

**讨论点 D4：** path 存完整 `/api/v1/...`。✅

**讨论点 D5：** 仅登录 API 挂在 `permission IS NULL` 的**菜单页**下（经 `sys_menu_api`）。✅

### 2.4 sys_menu_api — 菜单页/按钮 ↔ sys_api

| 字段 | 类型 | 说明 |
|------|------|------|
| menu_id | BIGINT | type=2 菜单页 或 type=3 按钮 |
| api_id | BIGINT | → `sys_api.id`（type=api） |

**唯一：** `(menu_id, api_id)`；`api_id` 全局唯一（一个 HTTP 端点只挂在一个菜单/按钮下）。

**讨论点 D9：** 角色是否直接勾选 API 树？  
**倾向：** ❌ **仅勾选菜单树**；API 权限由按钮/菜单页关联的 `sys_api` 间接生效。

### 2.5 授权聚合逻辑

```sql
-- 用户有效 permissions（仅来自已勾选菜单/按钮）
SELECT DISTINCT m.permission
FROM sys_user_role ur
JOIN sys_role_permission rp ON ur.role_id = rp.role_id AND rp.perm_type = 'menu'
JOIN sys_menu m ON rp.target_id = m.id
WHERE ur.user_id = ? AND m.app_id = ?
  AND m.status = 1 AND m.permission IS NOT NULL AND m.type IN (2, 3);
```

BFF 解析 API 所需 permission：

```sql
SELECT a.http_method, a.path_pattern, m.permission
FROM sys_api a
JOIN sys_menu_api ma ON ma.api_id = a.id
JOIN sys_menu m ON ma.menu_id = m.id
WHERE a.type = 'api' AND a.status = 1 AND m.status = 1;
```

角色勾选 **目录** 时：是否自动包含子节点？  
**倾向：** ❌ 不自动；**树保存时存显式勾选**（含半选展开后的子 id），与 Element/shadcn Tree 行为一致。

---

## 3. 租户、员工、APP 用户

### 3.1 模型（ADR-011）

```
sys_tenant（集团公司）
  ├── sys_app（多应用）
  ├── sys_employee（员工主数据，一人一条）
  └── sys_user（员工 × APP 登录账号，password 独立）
```


| 讨论点      | 倾向                                                       |
| -------- | -------------------------------------------------------- |
| U1 登录    | **app_code + username + password**                       |
| U2 用户名   | `(tenant_id, app_id, username)` 唯一                       |
| U3 员工与账号 | `sys_user.employee_id` FK；每 APP 每员工最多一条 user；**无** `dept_id`（部门经员工/任职） |
| U4 令牌    | JWT / Refresh / Redis permissions **均带 appId**，跨 APP 不可用 |
| U5 多部门 | 在任任职多条；`@DataScope` 预设范围对全部任职部门/组织 **并集**；不做上下文切换（ADR-014） |

### 3.2 sys_employee

- 工号 `employee_no` 租户内唯一
- `dept_id` → 主部门
- 合并原 `sys_user_profile` 展示字段（姓名、手机等）

### 3.3 sys_dept_category + sys_dept（ADR-013）

| 讨论点 | 倾向 |
|--------|------|
| O1 表结构 | **`sys_org`（组织）+ `sys_dept`（组织内部门树）** + `sys_dept_category` |
| O2 层级 code | 与 menu 相同，每层 4 位；`uk(tenant_id, code)` |
| O3 status | 0禁用 1启用；业务停用不用 deleted |
| O4 根节点 | **创建租户自动** `is_root=1`, `code=0001`, `name=租户名` |
| O5 部门类别 | **`sys_dept_category`** 每租户独立维护，开户默认种子 |
| O6 负责人 | `leader_employee_id` → sys_employee |
| O7 删除 | 有子部门 / 有员工 → 拒绝；`is_root` 不可删 |

**默认部门类别种子（租户开户，可改）：**

| code | name |
|------|------|
| headquarters | 总部 |
| branch | 分公司 |
| department | 部门 |

### 3.3.1 岗位（ADR-014）

| 表 | 说明 |
|----|------|
| sys_post_type | 租户岗位类型 |
| sys_post | 部门下岗位编制 |
| sys_employee_post | 员工任职，可兼职多岗 |

### 3.4 sys_user（APP 级登录账号）


| 字段                             | 说明                   |
| ------------------------------ | -------------------- |
| tenant_id, app_id, employee_id | 三元组定位账号              |
| username, password_hash        | 登录凭证，**每 APP 可不同密码** |
| status                         | 0禁用 1启用 2锁定          |


---

### 4.1 sys_role（APP 级）


| 字段         | 说明                  |
| ---------- | ------------------- |
| app_id     | 角色归属 APP            |
| type       | 1=内置 2=自定义          |
| data_scope | 1–6，见 schema-design |


**多角色合并（已确认）：** 取 **最宽松** data_scope（数字越小越宽：ALL=1 最宽）。

### 4.2 sys_role_permission

| perm_type | target_id | 说明 |
|-----------|-----------|------|
| `menu` | sys_menu.id | 勾选目录/菜单页/按钮；聚合 `permission` |
| `dept` | sys_dept.id | 自定义部门数据范围 |
| `store` | 待定 | Phase 2+ 分店权限 |

- `(role_id, perm_type, target_id)` 唯一
- **不**直接授权 `sys_api`；菜单类 API 经 `sys_menu_api` 关联

### 4.3 权限变更与 Redis（已确认）


| 事件          | SQL / 动作                                                                   |
| ----------- | -------------------------------------------------------------------------- |
| 用户角色变更      | `DEL mis:rbac:permissions:{tenantId}:{appId}:{userId}` + INCR perm-version |
| 角色菜单/API 变更 | 按 roleId 查 user_id → 批量 DEL（含 appId）                                       |
| sys_api 变更  | 刷新 BFF Registry；permission 变更时 evict                                       |


---

## 5. 字典与配置

### 5.1 sys_dict_type / sys_dict_item

- `tenant_id=0` 全局字典
- item.`value` 在 type 内唯一

### 5.2 sys_config

- `config_key` 全局唯一
- 安全类 key 前缀 `security.`

---

## 6. 认证与审计

### 6.1 sys_refresh_token

- 只存 hash，不存明文
- `revoked=1` 保留记录便于审计（可定时清理过期）

### 6.2 sys_login_log / sys_oper_log


| 讨论点               | 倾向                       |
| ----------------- | ------------------------ |
| L1 分区             | Phase 1 不分区；Phase 2 按月分区 |
| L2 request_params | TEXT，应用层截断 **4000** 字符   |
| L3 归档             | 180 天后置冷存储（Phase 2）      |


---

## 7. 索引汇总（待确认后写入 V1）


| 表             | 索引                                                                           |
| ------------- | ---------------------------------------------------------------------------- |
| sys_menu      | uk(app_id, code)；uk(app_id, permission) WHERE status=1；idx(parent_id)        |
| sys_api       | uk(app_id, code)；uk(http_method, path_pattern) WHERE type=api；idx(parent_id) |
| sys_user      | uk(tenant_id, app_id, username) WHERE deleted=0；uk(app_id, employee_id)      |
| sys_role      | uk(app_id, code) WHERE deleted=0                                             |
| sys_menu_api | uk(menu_id, api_id)；uk(api_id) |
| sys_user_role | uk(user_id, role_id)；**idx(role_id)** ← 批量 evict 用                           |
| sys_role_permission | uk(role_id, perm_type, target_id)；idx(role_id, perm_type) |


---

## 8. 种子 ID 规划（V2 讨论用）

固定 ID 便于种子引用（**仅 V2**；生产用雪花）：


| 段   | id / code 前缀       | 用途           |
| --- | ------------------ | ------------ |
| APP | app_id=1 `system`  | Phase 1 唯一应用 |
| 菜单  | code `0001`–`0099` | 侧栏树          |
| API | code `0001`–`0099` | API 树（独立编号）  |


---

## 9. Flyway 与 Maven

```
backend/
├── pom.xml                 # 父 POM（groupId: com.mis）
├── mis-migrator/           # 仅 Flyway，packaging=pom
│   ├── pom.xml             # flyway-maven-plugin
│   ├── README.md
│   └── src/main/resources/db/migration/
│       ├── V1__init_schema.sql
│       └── V2__seed_data.sql
├── mis-gateway/            # Sprint 0+ 待建
└── ...
```

- 本地：`cd backend && mvn -pl mis-migrator flyway:migrate`
- 一键：`scripts/init-dev.ps1`（Docker + migrate）
- docker-compose：`deploy/docker-compose.dev.yml`

---

## 10. 待讨论清单（请你逐项确认或修改）


| ID    | 主题                               | 当前倾向                         |
| ----- | -------------------------------- | ---------------------------- |
| D1    | 按钮必须挂在菜单页下                       | ✅ 是                          |
| D2    | permission APP 内唯一                 | ✅ 是                          |
| D3    | 菜单不用软删，用 status                  | ✅ 去掉 menu.deleted            |
| D4    | API path 存完整 `/api/v1/...`       | ✅                            |
| D5    | 仅登录 API 挂系统节点 permission=NULL    | ✅                            |
| D6    | 角色树勾选存显式 menu_id，不自动展开父节点        | ✅                            |
| U1    | Phase 1 单主部门                     | ✅                            |
| D7    | 种子用固定 ID，生产用雪花                   | ✅                            |
| D8    | `sys_menu` 是否加 `perm_version` 字段 | ❌ 不需要，用 Redis `perm-version` |
| D9    | 角色只勾选菜单/按钮；API 经 `sys_menu_api` 关联 | ✅ 已确认 |
| D10   | `sys_role_menu` → **`sys_role_permission`**，按 `perm_type` 扩展 | ✅ ADR-012 |
| M1–M6 | APP / 模块，见 §12                   | ✅ **已全部确认**                  |
| M7    | `sys_module` 与 `app_id` 无对应关系   | ✅ 已确认                        |
| A1–A8 | sys_api + 多 APP 用户，见 §13         | ✅ ADR-011/012 |
| S1    | 多角色 `perm_type=dept|org` 取 **并集** | ✅ 已确认 |
| S2    | `perm_type` 使用 **ENUM**（menu/dept/org/store） | ✅ 已确认 |
| O1–O7 | 部门模型，见 §3.3、ADR-013 | ✅ 已确认 |
| P1–P8 | 岗位/管理员/Phase1 范围，见 §14、ADR-014 | ✅ 已确认 |
| F1–F6 | Phase 1 功能范围 | ✅ 见 ADR-014 |
| E1–E4 | 工程：auth/user 分离、内网直连、无 Sonar、Docker+IDE | ✅ 已确认 |


---

## 12. 应用（APP）与模块（Module）— 延伸讨论

> 详见 [04-app-module-mfe.md](../architecture/04-app-module-mfe.md)

### 12.1 层级关系（推荐）

```
sys_app（应用 ≈ 微前端子应用边界）
  ├── sys_menu（菜单树，app_id + code）
  └── sys_api（API 树，app_id + code；module_id → 微服务）

sys_module（平台微服务注册表，**无 app_id**）
  └── 被各 APP 的 sys_api 引用

sys_employee → sys_user（每 APP 一个登录账号）
```

### 12.2 新增表草案

**sys_app — 应用**


| 字段         | 类型           | 说明                             |
| ---------- | ------------ | ------------------------------ |
| id         | BIGINT       | PK                             |
| tenant_id  | BIGINT       | 租户                             |
| code       | VARCHAR(64)  | 如 `system`、`hr`                |
| name       | VARCHAR(128) | 显示名                            |
| icon       | VARCHAR(64)  | APP 切换器图标                      |
| base_path  | VARCHAR(128) | 路由前缀，如 `/system`               |
| mfe_remote | VARCHAR(256) | Phase 2 微前端 remote 名，Phase 1 空 |
| sort       | INT          |                                |
| status     | SMALLINT     |                                |


**sys_module — 后端业务模块（1:1 微服务，平台级）**


| 字段           | 类型           | 说明                   |
| ------------ | ------------ | -------------------- |
| id           | BIGINT       | PK                   |
| code         | VARCHAR(64)  | 如 `user`、`org`       |
| name         | VARCHAR(128) | 用户模块                 |
| service_name | VARCHAR(64)  | Nacos 服务名 `mis-user` |
| sort         | INT          |                      |
| status       | SMALLINT     |                      |


> **无 `app_id`。** 模块是平台级微服务目录；APP 与模块的关联仅通过 `sys_api.module_id` 体现。


**sys_menu 增补：** `app_id`、`code` 必填

**sys_api：** 统一 API 注册表（替代 `sys_menu_api`），见 [ADR-011](../adr/ADR-011-sys-api-code-multi-app-auth.md)

### 12.3 M1–M7（已全部确认）


| ID  | 主题                         | 状态        |
| --- | -------------------------- | --------- |
| M1  | 新增 sys_app、sys_module      | ✅ Phase 1 |
| M2  | sys_menu.app_id 必填         | ✅         |
| M3  | `sys_api.module_id` 必填     | ✅         |
| M4  | API 树用 `sys_api` 单表        | ✅ ADR-011 |
| M5  | Phase 1 仅 1 个 APP `system` | ✅         |
| M6  | module 与微服务 1:1            | ✅         |
| M7  | **sys_module 与 app_id 无对应** | ✅         |


### 12.4 不对等的类比（避免混淆）


| ❌ 错误          | ✅ 正确                                                   |
| ------------- | ------------------------------------------------------ |
| 1 页面 = 1 API  | 1 菜单页 = 1 路由 = **多** API                               |
| 1 微服务 = 1 微前端 | 1 **APP** = 1 微前端子应用；**module 与 APP 无隶属**，经 API 引用 |
| API 树参与运行时路由  | API 树 `**sys_api`** 的 `type=api` 叶子参与 BFF Registry     |
| 菜单绑 API       | **菜单页/按钮** 经 `sys_menu_api` 关联 `sys_api`；角色只勾选菜单树 |


---

## 13. ADR-011：sys_api + code 层级 + 按 APP 隔离（已接受）


| ID  | 决策                                                | 状态  |
| --- | ------------------------------------------------- | --- |
| A1  | **`sys_api`** API 注册树 + **`sys_menu_api`** 关联表 | ✅   |
| A2  | `sys_menu`、`sys_api` 增加 `code` 层级编码           | ✅   |
| A3  | 租户=集团；一租户多 **sys_app**                            | ✅   |
| A4  | **sys_employee** 主数据 + **sys_user** 每 APP 一账号     | ✅   |
| A5  | 登录 **app_code + username + password**             | ✅   |
| A6  | JWT / Refresh / Redis **按 APP 隔离**                | ✅   |
| A7  | 角色只勾选菜单/按钮；API 经 `sys_menu_api` 关联 | ✅   |
| A8  | **`sys_role_permission`** 替代 `sys_role_menu` + `sys_role_data_scope` | ✅ ADR-012 |
| A9  | **sys_dept** + 部门类别 + 自动根节点 | ✅ ADR-013 |
| A10 | 岗位/任职 + superadmin/租户 admin（ADR-014） | ✅ |

---

## 14. ADR-014：岗位、平台与租户管理员（已接受）

| ID | 决策 | 状态 |
|----|------|------|
| P1 | `sys_post_type` 租户自定义岗位类型 | ✅ |
| P2 | `sys_post` 部门下岗位编制 | ✅ |
| P3 | `sys_employee_post` 多岗任职 | ✅ |
| P4 | `sys_platform_user` superadmin 管全租户 | ✅ |
| P5 | 每租户 `admin`，`is_tenant_admin=1`，不可删自己 | ✅ |
| P6 | `DEPT_MANAGER` 不预置，后期自建角色 | ✅ |
| P7 | 无权限通配符；首次登录强制改密 | ✅ |
| P8 | Phase 1 无测试账号 | ✅ |
| F5 | 多 Tab 工作区 | ✅ Phase 1 |
| F6 | AI Copilot 占位 UI | ✅ Phase 1（无 LLM） |

---

## 11. 下一步

1. ~~生成 `V1__init_schema.sql`、`V2__seed_data.sql`~~ ✅
2. ~~`mis-migrator` Maven 模块 + docker-compose + init-dev 脚本~~ ✅
3. ~~`mis-common-bom` / `mis-common-core` / `mis-gateway` 骨架~~ ✅
4. 本地验证：配置 `config/jdk.properties` → `mvn clean package` → Gateway `/actuator/health`
5. Sprint 0 其余项（mis-admin-bff、mis-auth 等）

---

## 12. 关联文档

- [表结构主文档](schema-design.md)
- [种子数据](seed-data.md)
- [API 权限映射](../backend/api-permission-mapping.md)
- [ADR-011](../adr/ADR-011-sys-api-code-multi-app-auth.md)
- [ADR-010](../adr/ADR-010-api-permission-mapping.md)（历史，部分由 ADR-011 替代）

