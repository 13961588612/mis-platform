# 后端公共模块（mis-common）

> 状态：📝 草稿 | 版本：v1.0-draft

## 1. 模块划分

```
mis-common/
├── mis-common-core/          # 工具类、常量、异常、统一响应
├── mis-common-security/      # LoginUser、GatewayContextFilter、JWT 验签/签发
├── mis-common-redis/         # Redis、Token 黑名单 ✅
├── mis-common-client/        # WebClient / RestClient 工厂（服务间 HTTP）
├── mis-common-jpa/           # Spring Data JPA、分页、数据权限 Specification
├── mis-common-web/           # TraceId、全局异常、OperLog（Servlet MVC）
```

## 2. mis-common-core

### 2.1 统一响应 `Result<T>`

```java
public class Result<T> {
    private int code;
    private String message;
    private T data;
    private String traceId;
}
```

### 2.2 分页 `PageResult<T>`

```java
public class PageResult<T> {
    private int page;
    private int size;
    private long total;
    private List<T> list;
}
```

### 2.3 业务异常

```java
public class BusinessException extends RuntimeException {
    private final int code;
}
```

### 2.4 响应码枚举 `ResultCode`

| 枚举 | code | message |
|------|------|---------|
| SUCCESS | 0 | ok |
| UNAUTHORIZED | 40100 | 未认证 |
| TOKEN_EXPIRED | 40101 | Token 已过期 |
| FORBIDDEN | 40300 | 无权限 |
| NOT_FOUND | 40400 | 资源不存在 |
| USER_EXISTS | 40901 | 用户名已存在 |
| ORG_HAS_CHILDREN | 40902 | 存在子部门 |
| VALIDATION_ERROR | 40001 | 参数校验失败 |
| INTERNAL_ERROR | 50000 | 系统错误 |

### 2.5 常量

- `SecurityConstants` — Token 头、Cookie 名、`X-Trace-Id` 等
- `CommonConstants` — 状态枚举、删除标记
- `CacheConstants` — Redis key 前缀
- `TraceConstants` — MDC 键名 `traceId`（**仅常量**，Filter 在 web 模块）

### 2.6 工具类

| 类 | 职责 | 状态 |
|----|------|------|
| `TraceIdUtils` | 生成 32 位 hex traceId | ✅ |
| `IdGenerator` | 雪花 ID | ⏳ 待定 |
| `ServletUtils` | IP、User-Agent | ⏳ |
| `JsonUtils` | JSON 序列化 | ⏳ |
| `DesensitizeUtils` | 脱敏 | ⏳ |

### 2.7 不放 core 的能力（边界）

| 能力 | 模块 |
|------|------|
| TraceId Filter、MDC 写入 | `mis-common-web` |
| 全局异常、`Result.traceId` 填充 | `mis-common-web` |
| Logback 配置、JSON 日志 | `mis-common-web` 或各服务 |
| `@OperLog` 操作日志 AOP | `mis-common-web`（待实现） |
| springdoc / Swagger | 仅 `mis-admin-bff` |
| OpenAPI YAML 归档 | `docs/api/openapi/` |
| OpenTelemetry（Phase 2） | `mis-common-web` 或独立 starter |

## 3. mis-common-security

> Servlet MVC 服务依赖本模块识别当前操作人。JWT 签发见 Sprint 1 `JwtUtils`（mis-auth）。

### 3.1 登录用户 `LoginUser` ✅

| 字段 | 来源 |
|------|------|
| userId / tenantId / appId | Gateway 透传头 |
| employeeId / username | Gateway 透传头 |
| roles / permissions | BFF 从 Redis 加载后 **可写入** LoginUser（Sprint 1+） |

### 3.2 `SecurityContextHolder` ✅

ThreadLocal 存 `LoginUser`；`requireUserId()` 无上下文抛 `UNAUTHORIZED`。

### 3.3 `GatewayContextFilter` ✅

读 `X-User-Id` 等头 → `SecurityContextHolder`；请求结束 `clear()`。

### 3.4 JPA 审计 `LoginUserAuditorAware` ✅

与 `mis-common-jpa` 同用时自动注册 `AuditorAware<Long>`。

### 3.5 权限版本 `PermVersionService` ✅

| 方法 | 用途 |
|------|------|
| `syncCacheFromAuthority` | 登录/刷新：DB `sys_user.perm_version` 写回 Redis |
| `getCurrentVersion` | BFF：Redis miss 回源 DB |
| `isStale(jwt, current)` | `jwt != current` → `X-Perm-Stale` |

权威源：**PostgreSQL**；不以 version 相等作为 API 鉴权条件（ADR-009）。

### 3.5 JWT 验签 `RsaJwtVerifier` ✅

| 组件 | 说明 |
|------|------|
| `JwtVerifier` / `RsaJwtVerifier` | RS256 公钥验签，解析 tenantId/appId/userId 等 |
| `JwtIssuer` / `RsaJwtIssuer` | RS256 私钥签发（mis-auth） |
| `PemPublicKeyLoader` | PEM 公钥加载 |
| Gateway `JwtAuthenticationGlobalFilter` | WebFlux 验签 + 写透传头 |
| `RedisTokenBlacklistChecker` | Gateway / mis-auth jti 黑名单 |

### 3.6 API 权限（BFF）⏳

`ApiPermissionInterceptor` + Redis permissions（Sprint 1），**非** `@PreAuthorize`。

## 4. mis-common-redis ✅

### 4.1 Key 规范

```
mis:auth:captcha:{id}              TTL 300s
mis:auth:login:fail:{username}     TTL 1800s
mis:auth:token:blacklist:{jti}      TTL = token 剩余有效期
mis:auth:refresh:{hash}            TTL 7d
mis:rbac:permissions:{userId}      TTL 900s (15min)，变更时主动 DEL
mis:rbac:perm-version:{tenantId}:{appId}:{userId}  与 sys_user.perm_version 一致；变更 INCR DB 后写入
mis:dict:{typeCode}                TTL 3600s
mis:config:{key}                   TTL 3600s
```

### 4.2 Token 黑名单 ✅

| 类 | 说明 |
|----|------|
| `TokenBlacklistService` | 写/读 `mis:auth:token:blacklist:{jti}` |
| `RedisTokenBlacklistChecker` | 实现 `TokenBlacklistChecker`，供 Gateway 使用 |

### 4.3 CacheService 封装

> 策略详见 [ADR-006](../adr/ADR-006-cache-strategy.md)：全阶段 **Redis 单级**，不引入 Caffeine。

```java
public interface CacheService {
    <T> Optional<T> get(String key, Class<T> type);
    void put(String key, Object value, Duration ttl);
    void evict(String key);
    void evictByPattern(String pattern);
}
```

### 4.3 Phase 1 缓存清单

| 用途 | Key 模式 | TTL | 失效 |
|------|----------|-----|------|
| 验证码 | `mis:auth:captcha:{id}` | 300s | 验证后删除 |
| 登录失败 | `mis:auth:login:fail:{username}` | 30min | 登录成功清除 |
| Token 黑名单 | `mis:auth:token:blacklist:{jti}` | 剩余有效期 | — |
| Refresh Token | `mis:auth:refresh:{hash}` | 7d | 轮换/吊销 |
| 用户权限 | `mis:rbac:permissions:{userId}` | **15min** | 角色/菜单/用户角色变更 **主动 evict**（TTL 仅兜底） |
| 字典 | `mis:dict:{typeCode}` | 1h | 字典 CRUD 主动 evict |
| 系统参数 | `mis:config:{key}` | 1h | 参数变更主动 evict |

**Phase 1 不缓存：** 用户列表、组织树、按用户的菜单路由。

**Phase 1 ~ 全阶段均不引入 Caffeine L1**（见 ADR-006 修订）：字典/参数与权限一样，仅 Redis 单级，写后 DEL 即可。

## 5. mis-common-jpa

> 决策见 [ADR-015](../adr/ADR-015-jpa-over-mybatis.md)

### 5.1 技术栈

| 项 | 选型 |
|----|------|
| ORM | Spring Data JPA + Hibernate 6 |
| 连接池 | HikariCP（Spring Boot 默认） |
| DDL | **仅 Flyway**，`spring.jpa.hibernate.ddl-auto=none` |
| 分页 | `Pageable` → `PageResult`（`PageMapper`） |

### 5.2 基础实体 `BaseEntity`

```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class BaseEntity {
    private Long createdBy;
    private LocalDateTime createdAt;
    private Long updatedBy;
    private LocalDateTime updatedAt;
    private Integer deleted;
}
```

软删子类加 `@SQLRestriction("deleted = 0")`（Hibernate 6）。

### 5.3 分页

`JpaRepository` + `Pageable`；`PageMapper.toPageResult(page)` 转 `PageResult`。

### 5.4 数据权限 `@DataScope`

```java
public @interface DataScope {
    String deptField() default "deptId";   // 无部门列时传 ""
    String orgField() default "";          // 有 orgId 列时填写，如 "orgId"
    String userField() default "createdBy";
}
```

### 5.5 DataScopeSpecification 逻辑

| data_scope | 常量 | 过滤策略 |
|------------|------|----------|
| 1 | SCOPE_ALL | 不追加 |
| 2 | SCOPE_DEPT | `dept_id IN (assignedDeptIds)` — 全部在任任职部门 |
| 3 | SCOPE_DEPT_AND_CHILD | `dept_id IN (assignedDeptSubtreeIds)` |
| 4 | SCOPE_SELF | `created_by = userId` |
| 5 | SCOPE_CUSTOM | 角色 `perm_type='org'|'dept'`（与任职无关） |
| 6 | SCOPE_ORG | `org_id IN (assignedOrgIds)` 或 `dept_id IN (deptIdsInAssignedOrgs)` |

1. 按 `employee_id` 加载在任 `sys_employee_post` → 解析 `assignedDeptIds`、`assignedOrgIds` 等
2. 根据用户角色计算 `data_scope`（取最大范围）
3. 构建 `DataScopeContext` 填入上述集合并集
4. `DataScopeSpecification.of(context, deptField, orgField, userField)` 生成 `Specification`
4. `repository.findAll(baseSpec.and(dataScopeSpec), pageable)`

### 5.6 租户（预留）

Phase 1 查询显式带 `tenant_id`；Phase 2 可考虑 Hibernate `@Filter` 或 Discriminator。

### 5.7 审计自动填充

`@EnableJpaAuditing` + `AuditorAware<Long>`；`createdBy` / `updatedBy` 由 `DefaultAuditorAware` 提供（security 模块接入后替换）。

## 6. mis-common-web

> **仅 Servlet MVC 服务**（BFF、领域微服务）。`mis-gateway`（WebFlux）不依赖本模块。

### 6.1 全局异常处理 `GlobalExceptionHandler` ✅

| 异常 | HTTP | 响应 code |
|------|------|-----------|
| BusinessException | 200 | ResultCode |
| MethodArgumentNotValidException | 200 | 40001 |
| AccessDeniedException | 403 | 40300 |
| Exception | 500 | 50000 |

所有响应通过 `TraceContext` 填充 `Result.traceId`。

### 6.2 TraceId 过滤器 ✅

`TraceIdFilter`：读 `X-Trace-Id` 或 `TraceIdUtils.generate()` → MDC + 响应头。

logback 示例：`%X{traceId}`（键名见 core `TraceConstants.MDC_TRACE_ID`）。

### 6.3 操作日志 `@OperLog` ⏳

```java
@OperLog(module = "用户管理", operation = "新增用户")
@PostMapping
public Result<Long> create(@RequestBody UserCreateDTO dto) { ... }
```

AOP 采集后调 `mis-audit`（Sprint 2+ 实现）。

### 6.4 服务间 HTTP 客户端（mis-common-client）

> 决策详见 [ADR-007](../adr/ADR-007-webclient-over-feign.md)：**不用 OpenFeign**。

| 使用方 | 客户端 | 说明 |
|--------|--------|------|
| mis-admin-bff | WebClient + `@LoadBalanced` | 并行聚合多服务 |
| 领域微服务 | RestClient + `@LoadBalanced` | 阻塞栈、单次调用 |

**ClientRequestFilter** 统一透传：`X-User-Id`, `X-Tenant-Id`, `X-Trace-Id`

**默认超时：** connect 2s；领域服务 read 5s；BFF 聚合整体 3s。

```
com.mis.common.client/
├── WebClientFactory.java
├── RestClientFactory.java
├── ServiceClientProperties.java
└── filter/ClientContextFilter.java

com.mis.common.security.permission/
├── ApiPermissionInterceptor.java
├── ApiPermissionRegistry.java
├── ApiPermissionProperties.java
└── PermissionCodes.java              # 可选
```

## 7. Maven 父 POM 依赖管理

```xml
<!-- 核心版本 -->
<spring-boot.version>3.2.5</spring-boot.version>
<spring-cloud.version>2023.0.1</spring-cloud.version>
<spring-cloud-alibaba.version>2023.0.1.0</spring-cloud-alibaba.version>
<!-- JPA 由 spring-boot-starter-data-jpa 管理，无 MyBatis -->
```

## 8. 待确认项

- [ ] 雪花 ID 实现：Hutool vs 自定义 vs Leaf
- [ ] 全局异常 HTTP 状态码：200 统一 vs RESTful 4xx/5xx
- [ ] 多角色 data_scope 合并规则：取最大范围 vs 取最小范围
- [ ] OperLog 是否默认记录所有 Controller 还是仅注解标记

## 9. 关联文档

- [微服务划分](microservices.md)
- [安全设计](../architecture/03-security.md)
- [编码规范](../project/conventions.md)
