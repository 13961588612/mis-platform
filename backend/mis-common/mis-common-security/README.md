# mis-common-security

登录用户上下文 + JWT 验签/签发。

**代码阅读**：见 [CODE-READING-GUIDE](../../../docs/CODE-READING-GUIDE.md) 阶段 B、E。

## 包结构

| 包 | 职责 |
|----|------|
| `jwt` | RS256 验签（`RsaJwtVerifier`）、签发（`RsaJwtIssuer`）、黑名单接口 |
| `filter` | `GatewayContextFilter` — Servlet 侧解析透传头 |
| `context` | `LoginUser`、`SecurityContextHolder` |
| `config` | `MisSecurityAutoConfiguration`、`MisJwtAutoConfiguration` |

## 透传请求头（Gateway 注入）

| Header | 常量 | 说明 |
|--------|------|------|
| `X-User-Id` | `HEADER_USER_ID` | `sys_user.id`（必填） |
| `X-Tenant-Id` | `HEADER_TENANT_ID` | 租户 |
| `X-App-Id` | `HEADER_APP_ID` | APP（ADR-011） |
| `X-Employee-Id` | `HEADER_EMPLOYEE_ID` | 员工（DataScope 锚点） |
| `X-Username` | `HEADER_USERNAME` | 登录名 |

## 业务代码取当前操作人

```java
Long operatorId = SecurityContextHolder.requireUserId();
LoginUser user = SecurityContextHolder.getLoginUser();
```

## JWT 配置（`mis.security.jwt`）

| 配置项 | 使用方 |
|--------|--------|
| `public-key-path` / `public-key-pem` | Gateway、mis-auth（logout 解析 jti） |
| `private-key-path` / `private-key-pem` | **仅 mis-auth** 签发 |
| `access-token-ttl-seconds` | Access Token 有效期 |
| `refresh-token-ttl-seconds` | Refresh Token 有效期 |

## 依赖

```xml
<dependency>
    <groupId>com.mis</groupId>
    <artifactId>mis-common-security</artifactId>
</dependency>
```

与 `mis-common-jpa` 同用时，自动注册 `LoginUserAuditorAware`。

## 注意

- Servlet 服务信任 Gateway 头（ADR-003）；Gateway 使用独立 `JwtAuthenticationGlobalFilter`
- BFF → 领域服务须继续透传头（`mis-common-client`，待实现）
- permissions **不在 JWT**（ADR-009）
