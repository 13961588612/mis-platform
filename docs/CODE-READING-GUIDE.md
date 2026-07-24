# 代码与文档阅读顺序

> 面向新成员 onboarding：先文档后代码，按「架构 → 数据 → 安全 → 公共库 → 领域服务 → BFF → 前端 → 部署 → AI」顺序阅读。

## 一、文档阅读顺序（建议 2–3 天）

### 第一阶段：全貌（半天）

| 顺序 | 文档 | 目的 |
|------|------|------|
| 1 | [docs/README.md](README.md) | 文档中心索引与状态 |
| 2 | [project/decisions.md](project/decisions.md) | 已确认的全局技术决策 |
| 3 | [project/conventions.md](project/conventions.md) | 编码规范与命名约定 |
| 4 | [architecture/01-overview.md](architecture/01-overview.md) | 项目目标与范围 |
| 5 | [architecture/02-system-architecture.md](architecture/02-system-architecture.md) | 分层、服务拓扑、仓库结构 |
| 6 | [backend/microservices.md](backend/microservices.md) | 微服务职责与端口一览 |

### 第二阶段：安全与认证（半天）

| 顺序 | 文档 | 目的 |
|------|------|------|
| 7 | [architecture/03-security.md](architecture/03-security.md) | **认证/授权分层**（Gateway L1 / BFF L2 / 领域服务 L3） |
| 8 | [adr/ADR-002-jwt-refresh-cookie.md](adr/ADR-002-jwt-refresh-cookie.md) | JWT + HttpOnly Refresh Cookie |
| 9 | [adr/ADR-009-permissions-in-redis-not-jwt.md](adr/ADR-009-permissions-in-redis-not-jwt.md) | 权限存 Redis，JWT 不带 permissions |
| 10 | [adr/ADR-008-bff-centralized-api-authz.md](adr/ADR-008-bff-centralized-api-authz.md) | BFF 统一 API 鉴权，mis-iam 作 PDP |
| 11 | [adr/ADR-010-api-permission-mapping.md](adr/ADR-010-api-permission-mapping.md) | 菜单/按钮 ↔ API 绑定模型（已由 ADR-011 演进） |
| 12 | [adr/ADR-011-sys-api-code-multi-app-auth.md](adr/ADR-011-sys-api-code-multi-app-auth.md) | sys_api 树 + 层级 code + 按 APP 隔离 |
| 13 | [adr/ADR-012-sys-role-permission.md](adr/ADR-012-sys-role-permission.md) | 统一角色权限表 `sys_role_permission` |
| 14 | [backend/api-permission-mapping.md](backend/api-permission-mapping.md) | API 权限映射实现细节 |
| 15 | [api/permissions.md](api/permissions.md) | 权限码清单与鉴权规则 |

### 第三阶段：数据与业务模型（半天）

| 顺序 | 文档 | 目的 |
|------|------|------|
| 16 | [database/schema-design.md](database/schema-design.md) | 完整表结构与 ER 关系 |
| 17 | [database/seed-data.md](database/seed-data.md) | 种子数据（superadmin / 租户 / 默认角色） |
| 18 | [adr/ADR-013-sys-dept-hierarchy.md](adr/ADR-013-sys-dept-hierarchy.md) | 组织 + 部门层级模型 |
| 19 | [adr/ADR-014-post-platform-admin.md](adr/ADR-014-post-platform-admin.md) | 岗位任职、superadmin/租户 admin、Phase 1 功能范围 |
| 20 | [adr/ADR-016-mis-iam-org-service-boundary.md](adr/ADR-016-mis-iam-org-service-boundary.md) | Sprint 2 服务边界：mis-iam / mis-org 合并原规划 |
| 21 | [api/api-specification.md](api/api-specification.md) | REST 契约（含 `/auth`、`/users`、`/orgs` 等） |

### 第四阶段：工程与部署（1 小时）

| 顺序 | 文档 | 目的 |
|------|------|------|
| 22 | [backend/common-modules.md](backend/common-modules.md) | mis-common-* 公共模块说明 |
| 23 | [adr/ADR-015-jpa-over-mybatis.md](adr/ADR-015-jpa-over-mybatis.md) | 持久层选型 JPA（替代 MyBatis-Plus） |
| 24 | [adr/ADR-007-webclient-over-feign.md](adr/ADR-007-webclient-over-feign.md) | BFF WebClient + 领域 RestClient |
| 25 | [adr/ADR-006-cache-strategy.md](adr/ADR-006-cache-strategy.md) | Redis 单级缓存策略 |
| 26 | [devops/configuration.md](devops/configuration.md) | **配置策略**（prod/test 经 Nacos PG 库） |
| 27 | [devops/local-dev.md](devops/local-dev.md) | 本地 Docker + 启动顺序 |
| 28 | [devops/integration-test.md](devops/integration-test.md) | 集成测试指南 |
| 29 | [devops/ci-cd.md](devops/ci-cd.md) | CI/CD 流水线 |
| 30 | [project/sprint-plan.md](project/sprint-plan.md) | Sprint 计划与验收标准 |

### 第五阶段：前端与 AI（按需）

| 顺序 | 文档 | 目的 |
|------|------|------|
| 31 | [adr/ADR-004-shadcn-ui.md](adr/ADR-004-shadcn-ui.md) | 前端 UI 框架选型 |
| 32 | [frontend/admin-web-design.md](frontend/admin-web-design.md) | 管理后台前端设计方案 |
| 33 | [frontend/architecture-blueprint.md](frontend/architecture-blueprint.md) | 前端架构蓝图 |
| 34 | [architecture/04-app-module-mfe.md](architecture/04-app-module-mfe.md) | 应用模块与微前端集成 |
| 35 | [adr/ADR-005-ai-layer-python.md](adr/ADR-005-ai-layer-python.md) | AI 层独立 Python 服务 |
| 36 | [agent/ai-agent-design.md](agent/ai-agent-design.md) | AI Agent 设计 |

按需查阅：`adr/README.md`（全部 16 篇 ADR 索引）、`project/modules-guide.md`、`database/schema-discussion.md`、`frontend/design-proposal/`、`ai-fusion/`。

---

## 二、代码阅读顺序（建议按模块逐日，共 6 天）

### 第 1 天：基础设施

#### 阶段 A：契约与常量（30 min）

| 顺序 | 文件 | 说明 |
|------|------|------|
| A1 | `mis-common/mis-common-core/.../result/Result.java` | 统一 API 响应 |
| A2 | `.../exception/ResultCode.java` | 统一响应码 |
| A3 | `.../constant/SecurityConstants.java` | 透传头、Bearer 前缀 |
| A4 | `.../constant/CacheConstants.java` | Redis Key 规范 |

#### 阶段 B：JWT 验签/签发（1 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| B1 | `mis-common-security/.../jwt/JwtClaims.java` | 验签后身份模型 |
| B2 | `.../jwt/AccessTokenClaims.java` | 签发载荷（无 permissions） |
| B3 | `.../jwt/RsaJwtVerifier.java` | RS256 公钥验签 |
| B4 | `.../jwt/RsaJwtIssuer.java` | RS256 私钥签发（mis-auth 使用） |
| B5 | `.../jwt/JwtProperties.java` | 公钥/私钥/TTL 配置 |
| B6 | `.../config/MisJwtAutoConfiguration.java` | 条件装配 Issuer/Verifier |

#### 阶段 C：Gateway L1 认证（1 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| C1 | `mis-gateway/.../GatewaySecurityProperties.java` | 白名单规则 |
| C2 | `mis-gateway/.../GatewaySecurityConfiguration.java` | 验签 Bean、过滤器注册 |
| C3 | `mis-gateway/.../JwtAuthenticationGlobalFilter.java` | **核心**：验签 → 黑名单 → 透传头 |
| C4 | `mis-gateway/src/main/resources/bootstrap.yml` | Nacos 配置发现 |
| C5 | `mis-gateway/src/main/resources/application*.yml` | 路由规则、profile |

#### 阶段 D：Redis 黑名单与缓存（30 min）

| 顺序 | 文件 | 说明 |
|------|------|------|
| D1 | `mis-common-security/.../jwt/TokenBlacklistChecker.java` | 黑名单接口 |
| D2 | `mis-common-redis/.../TokenBlacklistService.java` | jti 写/读 Redis |
| D3 | `mis-common-redis/.../RedisTokenBlacklistChecker.java` | Gateway 验签用 |
| D4 | `mis-common-redis/.../MisRedisAutoConfiguration.java` | Redis 自动装配 |

#### 阶段 E：Servlet 侧操作人上下文（30 min）

| 顺序 | 文件 | 说明 |
|------|------|------|
| E1 | `mis-common-security/.../context/LoginUser.java` | 当前登录用户模型 |
| E2 | `.../support/LoginUserHeaderResolver.java` | 从 X-* 头解析 LoginUser |
| E3 | `.../filter/GatewayContextFilter.java` | Filter → ThreadLocal |
| E4 | `mis-common-web/.../TraceIdFilter.java` | 全链路 TraceId |
| E5 | `mis-common-web/.../GlobalExceptionHandler.java` | 全局异常处理 |

---

### 第 2 天：认证与身份

#### 阶段 F：mis-auth 认证服务（1.5 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| F1 | `mis-auth/.../controller/AuthController.java` | login / refresh / logout / captcha |
| F2 | `mis-auth/.../service/AuthService.java` | **核心**认证业务流程 |
| F3 | `mis-auth/.../service/RefreshTokenService.java` | Refresh 双写 DB+Redis、轮换 |
| F4 | `mis-auth/.../service/CaptchaService.java` | 验证码生成与校验（Redis） |
| F5 | `mis-auth/.../service/LoginLockService.java` | 登录失败锁定策略 |
| F6 | `mis-auth/.../support/TokenUtils.java` | Refresh 随机串与 SHA-256 |
| F7 | `mis-auth/.../service/LoginLogClientService.java` | 异步写登录日志 → mis-audit |

#### 阶段 G：mis-iam 身份与权限服务（2 h）

> 端口 **8102**，合并原 mis-user + mis-rbac。用户/角色/APP/权限聚合。

| 顺序 | 文件 | 说明 |
|------|------|------|
| G1 | `mis-iam/.../controller/UserController.java` | 用户 CRUD + 状态/密码/角色分配 |
| G2 | `mis-iam/.../service/UserService.java` | **核心**：用户生命周期、密码策略、多 APP 隔离 |
| G3 | `mis-iam/.../controller/RoleController.java` | 角色 CRUD + 菜单/数据权限分配 |
| G4 | `mis-iam/.../service/RoleService.java` | 角色管理 + 权限变更 evict Redis |
| G5 | `mis-iam/.../service/RolePermissionService.java` | `sys_role_permission` 统一操作（menu/dept/org） |
| G6 | `mis-iam/.../service/PermissionService.java` | 权限聚合 → Redis `mis:rbac:permissions:*` |
| G7 | `mis-iam/.../controller/AppController.java` | 应用管理 |
| G8 | `mis-iam/.../domain/entity/` | `SysUser` / `SysRole` / `SysApp` 等实体 |
| G9 | `mis-iam/.../client/OrgEmployeeClient.java` | 跨服务查 Org 员工信息 |

---

### 第 3 天：组织与系统

#### 阶段 H：mis-org 组织人事服务（2 h）

> 端口 **8103**。组织 → 部门树 → 岗位 → 员工任职。

| 顺序 | 文件 | 说明 |
|------|------|------|
| H1 | `mis-org/.../controller/OrgController.java` | 组织 CRUD |
| H2 | `mis-org/.../service/OrgService.java` | 组织管理 + 开户自建根部门 |
| H3 | `mis-org/.../controller/DeptController.java` | 部门树查询/维护 |
| H4 | `mis-org/.../service/DeptService.java` | **核心**：部门层级 code、ancestors、约束校验 |
| H5 | `mis-org/.../controller/EmployeeController.java` | 员工 CRUD |
| H6 | `mis-org/.../service/EmployeeService.java` | 员工 + 任职（兼岗） |
| H7 | `mis-org/.../domain/entity/` | `SysOrg` / `SysDept` / `SysEmployee` / `SysPost` 等 |
| H8 | `mis-org/.../service/DataScopeService.java` | `data_scope` 解析 → `DataScopeContext`（多岗并集） |
| H9 | `mis-org/.../client/IamDataScopeClient.java` | 跨服务查 IAM 角色数据权限 |

#### 阶段 I：mis-system 系统服务（1 h）

> 端口 **8105**。菜单树、API 注册、路由/权限组装。

| 顺序 | 文件 | 说明 |
|------|------|------|
| I1 | `mis-system/.../controller/MenuController.java` | 菜单 CRUD + 树 |
| I2 | `mis-system/.../service/MenuService.java` | **核心**：菜单树 code、permission 组装、router 生成 |
| I3 | `mis-system/.../controller/ApiController.java` | API 注册树 |
| I4 | `mis-system/.../service/ApiService.java` | `sys_api` 树 + `sys_menu_api` 关联 |
| I5 | `mis-system/.../domain/entity/SysMenu.java` | 菜单实体（type: 目录/菜单页/按钮） |
| I6 | `mis-system/.../domain/entity/SysApi.java` | API 实体（type: catalog/api） |

---

### 第 4 天：BFF 聚合与审计

#### 阶段 J：mis-admin-bff 聚合层（2 h）

> 端口 **8081**。对外唯一 `/api/v1/**` 入口，聚合 mis-iam / mis-org / mis-system / mis-audit。

| 顺序 | 文件 | 说明 |
|------|------|------|
| J1 | `mis-admin-bff/.../controller/AuthMeController.java` | `/auth/me`：用户信息 + 菜单 + 权限 |
| J2 | `mis-admin-bff/.../controller/UserController.java` | 用户聚合（补全部门/组织名） |
| J3 | `mis-admin-bff/.../controller/RoleController.java` | 角色 + 菜单分配 |
| J4 | `mis-admin-bff/.../controller/MenuController.java` | 菜单树 + router / permissions |
| J5 | `mis-admin-bff/.../controller/OrgController.java` | 组织/部门/员工 透传 |
| J6 | `mis-admin-bff/.../service/UserAggregateService.java` | **核心**：跨 IAM+Org 用户聚合 |
| J7 | `mis-admin-bff/.../service/MenuAggregateService.java` | 菜单聚合 → `RouterNode` 树 |
| J8 | `mis-admin-bff/.../service/RoleFacadeService.java` | 角色门面 |
| J9 | `mis-admin-bff/.../client/AbstractDownstreamClient.java` | **重点**：WebClient 基类，透传 X-* 头 |
| J10 | `mis-admin-bff/.../client/IamWebClient.java` | → mis-iam 调用 |
| J11 | `mis-admin-bff/.../client/OrgWebClient.java` | → mis-org 调用 |
| J12 | `mis-admin-bff/.../client/SystemWebClient.java` | → mis-system 调用 |
| J13 | `mis-admin-bff/.../config/ApiPermissionConfiguration.java` | L2 API 鉴权拦截器注册 |
| J14 | `mis-admin-bff/.../security/ApiPermissionRegistryLoader.java` | 启动加载 method+path → permission 映射 |
| J15 | `mis-admin-bff/.../security/UserPermissionLoader.java` | Redis 加载用户 permissions |

#### 阶段 K：mis-audit 审计服务（30 min）

> 端口 **8106**。登录日志已实现，操作日志待 Sprint 4。

| 顺序 | 文件 | 说明 |
|------|------|------|
| K1 | `mis-audit/.../domain/entity/SysLoginLog.java` | 登录日志实体 |
| K2 | `mis-audit/.../service/LoginLogService.java` | 写入 + 分页查询（username/status/时间范围） |
| K3 | `mis-audit/.../controller/LoginLogInternalController.java` | POST 写入（mis-auth 内部调用） |
| K4 | `mis-audit/.../controller/LoginLogController.java` | GET 分页查询（经 Gateway） |

---

### 第 5 天：前端

#### 阶段 L：mis-admin-web 前端（3 h）

> React 18 + TypeScript + Vite + shadcn/ui + Tailwind CSS + Zustand + React Router 6。

| 顺序 | 文件 | 说明 |
|------|------|------|
| L1 | `frontend/mis-admin-web/src/app/App.tsx` | 应用入口 |
| L2 | `frontend/mis-admin-web/src/app/router.tsx` | 路由配置（含懒加载） |
| L3 | `frontend/mis-admin-web/src/app/providers.tsx` | QueryClient / Theme / Auth 等 Provider |
| **认证与路由守卫** |||
| L4 | `frontend/mis-admin-web/src/stores/auth-store.ts` | **核心**：Zustand 认证状态管理 |
| L5 | `frontend/mis-admin-web/src/lib/api/auth.ts` | 登录/刷新/登出 API |
| L6 | `frontend/mis-admin-web/src/lib/api/client.ts` | Axios 实例 + 拦截器（自动刷新 Token） |
| L7 | `frontend/mis-admin-web/src/components/auth/protected-route.tsx` | 路由守卫 |
| L8 | `frontend/mis-admin-web/src/components/auth/permission-gate.tsx` | 按钮级权限控制 |
| L9 | `frontend/mis-admin-web/src/features/auth/login-page.tsx` | 登录页 |
| **布局与导航** |||
| L10 | `frontend/mis-admin-web/src/components/layout/app-layout.tsx` | 主布局（侧栏 + 顶栏 + Tab） |
| L11 | `frontend/mis-admin-web/src/components/layout/side-nav.tsx` | 左侧菜单导航 |
| L12 | `frontend/mis-admin-web/src/components/layout/tab-bar.tsx` | 多 Tab 工作区 |
| L13 | `frontend/mis-admin-web/src/lib/nav/menu-tree.ts` | 动态菜单树构建 |
| **业务页面** |||
| L14 | `frontend/mis-admin-web/src/features/dashboard/dashboard-page.tsx` | 仪表盘 |
| L15 | `frontend/mis-admin-web/src/features/system/admin-list-page.tsx` | **重点**：用户管理页（761 行，含 FormSheet） |
| L16 | `frontend/mis-admin-web/src/features/system/page-defs.ts` | 页面配置定义（1014 行） |
| **通用组件** |||
| L17 | `frontend/mis-admin-web/src/components/common/form-sheet.tsx` | 通用表单抽屉 |
| L18 | `frontend/mis-admin-web/src/components/common/list-page-skeleton.tsx` | 列表页骨架（含搜索/表格/分页） |
| **AI 功能** |||
| L19 | `frontend/mis-admin-web/src/features/ai/` | AI Copilot / 表单填充 / RAG / 摘要 / 文本提取 |

---

### 第 6 天：数据与部署

#### 阶段 M：数据库与 Flyway 迁移（30 min）

| 顺序 | 文件 | 说明 |
|------|------|------|
| M1 | `backend/mis-migrator/.../V1__init_schema.sql` | 全部建表语句 |
| M2 | `.../V2__seed_data.sql` | 种子数据（superadmin / 租户 / 菜单 / 权限） |
| M3 | `deploy/postgres/init/01-init-db.sql` | PostgreSQL 初始化 |

#### 阶段 N：部署与配置（1 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| N1 | `deploy/docker-compose.dev.yml` | 本地开发：PG / Redis / Nacos |
| N2 | `deploy/nacos/mis-auth-dev.yaml` | mis-auth Nacos 开发配置 |
| N3 | `deploy/nacos/mis-common-dev.yaml` | mis-common Nacos 开发配置 |
| N4 | `deploy/nacos/mis-gateway-dev.yaml` | mis-gateway Nacos 开发配置 |
| N5 | `deploy/nacos/import/*.yaml` | 生产配置（导入 Nacos） |
| N6 | `deploy/nacos/server/application.properties` | Nacos 连接 PostgreSQL |
| N7 | `deploy/nacos/nacos-standalone-pg.env` | Nacos 环境变量 |
| N8 | `scripts/import-nacos-config.ps1` | 推送配置到 Nacos |
| N9 | `scripts/init-dev.ps1` | 一键初始化开发环境 |

#### 阶段 O：测试（按需）

| 顺序 | 文件 | 说明 |
|------|------|------|
| O1 | `mis-common-security/.../RsaJwtIssuerTest.java` | 签发+验签往返 |
| O2 | `mis-gateway/.../JwtAuthenticationGlobalFilterTest.java` | Gateway 过滤器单元测试 |
| O3 | `mis-common-redis/.../TokenBlacklistServiceTest.java` | 黑名单 Mock 测试 |

---

## 三、请求链路速查

### 3.1 登录认证链路

```
POST /api/v1/auth/login
  → Gateway 白名单放行 → mis-auth (8104)
  → AuthService：验证码校验 → 密码验证(mis-iam 查用户) → 登录锁定检查
  → JwtIssuer 签发 Access Token（含 tenantId/appId/userId/employeeId）
  → Refresh Token 双写 DB+Redis（HttpOnly Cookie）
  → 异步写登录日志 → mis-audit (8106)
```

### 3.2 登出链路

```
POST /api/v1/auth/logout
  → Gateway 验 JWT → mis-auth
  → AuthService：jti 入 Redis 黑名单 + 吊销 Refresh Token
```

### 3.3 业务 API 请求链路（最常用）

```
GET/POST /api/v1/users 或 /api/v1/roles、/api/v1/menus、/api/v1/orgs 等
  → Gateway JwtAuthenticationGlobalFilter：
       RS256 公钥验签 → Redis 查 jti 黑名单 → 写 X-User-Id/X-Tenant-Id/X-App-Id 透传头
  → mis-admin-bff (8081)：
       GatewayContextFilter 解析 LoginUser → ThreadLocal
       UserPermissionLoader → Redis 读 permissions
       ApiPermissionInterceptor → ApiPermissionRegistry 匹配 method+path → permission
       Controller → 聚合调用下游(mis-iam/mis-org/mis-system) → 组装返回
```

### 3.4 首次登录 /me 聚合链路

```
GET /api/v1/auth/me
  → Gateway 验签 + 透传 → mis-admin-bff
  → AuthMeController：
       1. mis-auth 获取用户基本信息
       2. mis-iam 获取用户角色、permissions
       3. mis-system 获取动态菜单树 + router
       4. mis-org 补全部门/组织名称
       5. 组装 MeVO 返回前端
```

### 3.5 登录日志写入链路

```
mis-auth login 成功/失败
  → LoginLogClientService → POST /internal/v1/login-logs → mis-audit (8106)
  → LoginLogService → 写入 sys_login_log

前端查询登录日志：
  GET /api/v1/audit/login-logs → Gateway → mis-admin-bff → AuditWebClient → mis-audit
```

---

## 四、已实现 vs 待实现（代码层）

### 后端服务

| 模块 | 端口 | 状态 | 说明 |
|------|------|------|------|
| mis-common-core | — | ✅ | Result / ResultCode / SecurityConstants / CacheConstants |
| mis-common-web | — | ✅ | TraceIdFilter / GlobalExceptionHandler |
| mis-common-jpa | — | ✅ | JPA 基础配置 / 审计字段 / 分页 |
| mis-common-security | — | ✅ | JWT 验签/签发 / LoginUser / TokenBlacklistChecker |
| mis-common-redis | — | ✅ | TokenBlacklistService / Redis 自动装配 |
| mis-gateway | 8080 | ✅ | JWT 验签 + 黑名单 + 透传头 + 路由 |
| mis-auth | 8104 | ✅ | login / refresh / logout / captcha / 登录锁定 / 写登录日志 |
| mis-iam | 8102 | ✅ | 用户/角色/APP/权限 全 CRUD（合并原 mis-user + mis-rbac） |
| mis-org | 8103 | ✅ | 组织/部门/员工/岗位/数据权限（DataScopeService） |
| mis-system | 8105 | ✅ | 菜单树/API 注册/路由组装/permissions 聚合 |
| mis-admin-bff | 8081 | ✅ | 聚合 IAM/Org/System/Audit + L2 API 权限拦截 + AI 代理 |
| mis-audit | 8106 | 🟡 | 登录日志 ✅；操作日志 `sys_oper_log` + `@OperLog` AOP 待 Sprint 4 |
| mis-migrator | — | ✅ | Flyway 迁移（V1 建表 + V2 种子数据） |

### 前端

| 模块 | 状态 | 说明 |
|------|------|------|
| mis-admin-web | ✅ | React 18 + Vite + shadcn/ui；登录/仪表盘/用户管理/门户/AI Copilot |
| 菜单动态渲染 | ✅ | 基于后端 permissions 的动态菜单树 + 路由 |
| 多 Tab 工作区 | ✅ | KeepAlive + TabBar 切换 |
| 按钮级权限 | ✅ | PermissionGate 组件 |
| AI Copilot UI | ✅ | 占位 UI（无真实 LLM 调用） |

### 待实现

| 项 | 状态 | 说明 |
|------|------|------|
| 操作日志 `@OperLog` | ⏳ | AOP 采集 + `sys_oper_log` 存储 + 查询（Sprint 4） |
| 数据字典 | ⏳ | 通用字典管理（Sprint 3+） |
| 通知公告 | ⏳ | 系统通知 + 站内信（Sprint 4+） |
| 定时任务 | ⏳ | Quartz / XXL-Job 集成（Phase 2） |
| 代码生成 | ⏳ | 低代码 CRUD 生成（Phase 2） |
| 工作流 | ⏳ | Flowable / Camunda 集成（Phase 3） |
| mis-common-client 透传头 | ⏳ | 跨服务透传 X-* 头的 Feign/WebClient 工具 |
| 微前端集成 | ⏳ | 门户九宫格 → 子应用加载（Module Federation） |

---

## 五、关联 README

- 根目录：[README.md](../README.md)
- 后端总览：[backend/README.md](../backend/README.md)
- 各微服务 README：
  - [mis-gateway](../backend/mis-gateway/README.md) — 网关配置与启动
  - [mis-auth](../backend/mis-auth/README.md) — 认证服务
  - [mis-admin-bff](../backend/mis-admin-bff/README.md) — BFF 聚合层
  - [mis-system](../backend/mis-system/README.md) — 系统服务
  - [mis-audit](../backend/mis-audit/README.md) — 审计服务
  - [mis-migrator](../backend/mis-migrator/README.md) — Flyway 迁移
- 部署：
  - [deploy/README.md](../deploy/README.md)
  - [deploy/config/README.md](../deploy/config/README.md)
  - [deploy/nacos/README.md](../deploy/nacos/README.md)
- 前端：[frontend/mis-admin-web/README.md](../frontend/mis-admin-web/README.md)
- 文档中心：[docs/README.md](README.md)
