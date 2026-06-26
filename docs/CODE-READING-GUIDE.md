# 代码与文档阅读顺序

> 面向新成员 onboarding：先文档后代码，按「架构 → 数据 → 安全 → 公共库 → 服务 → 部署」顺序阅读。

## 一、文档阅读顺序（建议 1–2 天）

| 顺序 | 文档 | 目的 |
|------|------|------|
| 1 | [docs/README.md](README.md) | 文档中心索引与状态 |
| 2 | [project/decisions.md](project/decisions.md) | 已确认的全局技术决策 |
| 3 | [architecture/01-overview.md](architecture/01-overview.md) | 项目目标与范围 |
| 4 | [architecture/02-system-architecture.md](architecture/02-system-architecture.md) | 分层、服务拓扑、仓库结构 |
| 5 | [architecture/03-security.md](architecture/03-security.md) | **认证/授权分层**（Gateway / BFF / 领域服务） |
| 6 | [adr/ADR-002-jwt-refresh-cookie.md](adr/ADR-002-jwt-refresh-cookie.md) | JWT + Refresh Cookie |
| 7 | [adr/ADR-009-permissions-in-redis-not-jwt.md](adr/ADR-009-permissions-in-redis-not-jwt.md) | 权限不进 JWT |
| 8 | [adr/ADR-008-bff-centralized-api-authz.md](adr/ADR-008-bff-centralized-api-authz.md) | BFF 统一 API 鉴权 |
| 9 | [database/schema-design.md](database/schema-design.md) | 表结构与 ER |
| 10 | [api/api-specification.md](api/api-specification.md) | REST 契约（含 `/auth`） |
| 11 | [backend/microservices.md](backend/microservices.md) | 微服务职责与端口 |
| 12 | [backend/common-modules.md](backend/common-modules.md) | mis-common-* 模块说明 |
| 13 | [devops/configuration.md](devops/configuration.md) | **配置策略**（prod/test 经 Nacos PG 库） |
| 14 | [devops/local-dev.md](devops/local-dev.md) | 本地 Docker + 启动顺序 |
| 15 | [project/sprint-plan.md](project/sprint-plan.md) | Sprint 与验收 |

按需查阅：`adr/README.md`、`database/seed-data.md`、`backend/api-permission-mapping.md`。

---

## 二、代码阅读顺序（建议按模块逐日）

### 阶段 A：契约与常量（30 min）

| 顺序 | 文件 | 说明 |
|------|------|------|
| A1 | `backend/mis-common/mis-common-core/.../result/Result.java` | 统一 API 响应 |
| A2 | `.../exception/ResultCode.java` | 统一响应码 |
| A3 | `.../constant/SecurityConstants.java` | 透传头、Bearer 前缀 |
| A4 | `.../constant/CacheConstants.java` | Redis Key 规范 |

### 阶段 B：JWT 验签/签发（1 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| B1 | `mis-common-security/.../jwt/JwtClaims.java` | 验签后身份模型 |
| B2 | `.../jwt/AccessTokenClaims.java` | 签发载荷（无 permissions） |
| B3 | `.../jwt/RsaJwtVerifier.java` | RS256 公钥验签 |
| B4 | `.../jwt/RsaJwtIssuer.java` | RS256 私钥签发（mis-auth） |
| B5 | `.../jwt/JwtProperties.java` | 公钥/私钥/TTL 配置 |
| B6 | `.../config/MisJwtAutoConfiguration.java` | 条件装配 Issuer/Verifier |

### 阶段 C：Gateway L1 认证（1 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| C1 | `mis-gateway/.../GatewaySecurityProperties.java` | 白名单规则 |
| C2 | `mis-gateway/.../GatewaySecurityConfiguration.java` | 验签 Bean、过滤器注册 |
| C3 | `mis-gateway/.../JwtAuthenticationGlobalFilter.java` | **核心**：验签 → 黑名单 → 透传头 |
| C4 | `mis-gateway/src/main/resources/bootstrap.yml` | Nacos 可选 |
| C5 | `mis-gateway/src/main/resources/application*.yml` | 路由、profile |

### 阶段 D：Redis 黑名单（30 min）

| 顺序 | 文件 | 说明 |
|------|------|------|
| D1 | `mis-common-security/.../jwt/TokenBlacklistChecker.java` | 黑名单接口 |
| D2 | `mis-common-redis/.../TokenBlacklistService.java` | jti 写/读 Redis |
| D3 | `mis-common-redis/.../RedisTokenBlacklistChecker.java` | Gateway 使用 |
| D4 | `mis-common-redis/.../MisRedisAutoConfiguration.java` | 自动装配 |

### 阶段 E：Servlet 侧操作人上下文（30 min）

| 顺序 | 文件 | 说明 |
|------|------|------|
| E1 | `mis-common-security/.../context/LoginUser.java` | 当前登录用户 |
| E2 | `.../support/LoginUserHeaderResolver.java` | 从头解析 LoginUser |
| E3 | `.../filter/GatewayContextFilter.java` | Filter → ThreadLocal |
| E4 | `mis-common-web/.../TraceIdFilter.java` | TraceId |
| E5 | `mis-common-web/.../GlobalExceptionHandler.java` | 全局异常 |

### 阶段 F：mis-auth 认证服务（1.5 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| F1 | `mis-auth/.../controller/AuthController.java` | login/refresh/logout/captcha |
| F2 | `mis-auth/.../service/AuthService.java` | **核心**业务流程 |
| F3 | `mis-auth/.../service/RefreshTokenService.java` | Refresh 双写 DB+Redis、轮换 |
| F4 | `mis-auth/.../service/CaptchaService.java` | 验证码 Redis |
| F5 | `mis-auth/.../service/LoginLockService.java` | 登录失败锁定 |
| F6 | `mis-auth/.../support/TokenUtils.java` | Refresh 随机串与 SHA-256 |

### 阶段 G：数据与部署（1 h）

| 顺序 | 文件 | 说明 |
|------|------|------|
| G1 | `backend/mis-migrator/.../V1__init_schema.sql` | 建表 |
| G2 | `.../V2__seed_data.sql` | 种子（admin 账号） |
| G3 | `deploy/docker-compose.dev.yml` | PG / Redis / Nacos |
| G4 | `deploy/nacos-config/prod/*.yaml` | 正式配置 Git 源 → 推送到 Nacos |
| G5 | `deploy/nacos-config/test/*.yaml` | 测试环境 Nacos 配置 Git 源 |
| G6 | `deploy/nacos/server/application.properties` | Nacos → PostgreSQL |
| G7 | `scripts/import-nacos-config.ps1` | 导入 Nacos 配置 |

### 阶段 H：测试（按需）

| 顺序 | 文件 | 说明 |
|------|------|------|
| H1 | `mis-common-security/.../RsaJwtIssuerTest.java` | 签发+验签往返 |
| H2 | `mis-gateway/.../JwtAuthenticationGlobalFilterTest.java` | 过滤器单元测试 |
| H3 | `mis-common-redis/.../TokenBlacklistServiceTest.java` | 黑名单 Mock 测试 |

---

## 三、请求链路速查（登录 → 业务 API）

```
1. POST /api/v1/auth/login
   → Gateway 白名单 → mis-auth
   → AuthService：验证码/密码 → JwtIssuer 签发 → Refresh 写 DB+Redis

2. GET /api/v1/...（受保护）
   → JwtAuthenticationGlobalFilter：验签 → Redis 查 jti 黑名单 → 写 X-* 头
   → mis-admin-bff（未来）：Redis 读 permissions → API 鉴权
   → 领域服务：GatewayContextFilter → SecurityContextHolder

3. POST /api/v1/auth/logout
   → AuthService：jti 入黑名单 + 吊销 Refresh
```

---

## 四、已实现 vs 待实现（代码层）

| 模块 | 状态 |
|------|------|
| mis-common-core / web / jpa / security / redis | ✅ 骨架可用 |
| mis-gateway JWT + 透传头 | ✅ |
| mis-auth login/refresh/logout | ✅ |
| mis-admin-bff API 权限 | ⏳ |
| mis-user / mis-rbac / … | ⏳ |
| mis-common-client 透传头 | ⏳ |

---

## 五、关联 README

- 根目录：[README.md](../README.md)
- 后端：[backend/README.md](../backend/README.md)
- 各服务：`backend/mis-gateway/README.md`、`backend/mis-auth/README.md`
- 部署：`deploy/nacos-config/README.md`、`deploy/nacos/README.md`
