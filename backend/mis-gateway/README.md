# mis-gateway

Spring Cloud Gateway — JWT 验签（L1 认证）+ 身份头透传。

## JWT 配置

至少配置一种公钥来源：

```yaml
mis:
  security:
    jwt:
      public-key-path: classpath:jwt/public.pem   # 或文件路径
      # public-key-pem: |                          # 内联 PEM（测试常用）
```

环境变量：`JWT_PUBLIC_KEY_PATH=./keys/public.pem`

未配置公钥时 **不启用** JWT 过滤器（`/actuator/health` 仍可用）。

## 透传头（下游 BFF / 领域服务）

验签成功后注入：

`X-User-Id`, `X-Tenant-Id`, `X-App-Id`, `X-Employee-Id`, `X-Username`, `X-Trace-Id`

下游 Servlet 服务依赖 `mis-common-security` 的 `GatewayContextFilter` 解析。

## 白名单（默认）

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/captcha`
- `GET /actuator/**`
- `GET /v3/api-docs/**`

## 开发自测

```bash
mvn -pl mis-gateway test
```

集成环境配置公钥后，对任意受保护路由携带 `Authorization: Bearer <token>` 即可；下游服务通过 `GatewayContextFilter` 读取透传头。

## jti 黑名单

Phase 1：`RedisTokenBlacklistChecker` 已接入 Gateway（需 Redis）；未配置 Redis 时 Gateway 回退 `NoOpTokenBlacklistChecker`。
