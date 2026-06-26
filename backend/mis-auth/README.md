# mis-auth

认证服务：登录、JWT 签发（RS256）、Refresh Token、登出黑名单。

## 端口

`8101`

## 依赖

- PostgreSQL（`sys_user`、`sys_refresh_token`）
- Redis（验证码、登录锁定、Refresh 缓存、**jti 黑名单**）
- **mis-audit**（异步写入登录日志）
- RSA 密钥对（**私钥仅本服务**）

## 配置

```yaml
mis:
  auth:
    captcha-enabled: true
    captcha-ttl-seconds: 300
    captcha-length: 4
    max-login-failures: 5
    login-lock-seconds: 1800
    default-client-id: web
    refresh-cookie-prefix: mis_refresh_
    cookie:
      path: /
      same-site: Strict
      secure: false   # 生产建议 true
    audit-enabled: true
    audit-base-url: http://localhost:8106
    audit-discovery-enabled: false
    audit-service-id: mis-audit
  security:
    jwt:
      private-key-path: ${JWT_PRIVATE_KEY_PATH:./keys/private.pem}
      public-key-path: ${JWT_PUBLIC_KEY_PATH:./keys/public.pem}
      access-token-ttl-seconds: 7200
      refresh-token-ttl-seconds: 604800
```

与 `sys_config` 中 `security.login.*`、`security.token.*` 语义对齐；Phase 1 以 yml 为准。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/auth/captcha` | 验证码 |
| POST | `/api/v1/auth/login` | 登录，Set-Cookie refresh |
| POST | `/api/v1/auth/refresh` | 刷新 Access Token |
| POST | `/api/v1/auth/logout` | 吊销 refresh + jti 入黑名单 |

内部路径：`/internal/v1/auth/*`（BFF 聚合时使用）

## 登出黑名单

`logout` 解析 `Authorization: Bearer` 中的 Access Token，将 `jti` 写入 Redis：

`mis:auth:token:blacklist:{jti}`，TTL = Access Token 剩余有效期（Phase 1 简化为配置的 TTL）。

Gateway 验签后通过 `RedisTokenBlacklistChecker` 拒绝已登出 token。

## 本地启动

```bash
# 生成密钥对（示例）
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem

export JWT_PRIVATE_KEY_PATH=./keys/private.pem
export JWT_PUBLIC_KEY_PATH=./keys/public.pem

mvn -pl mis-auth spring-boot:run
```

默认账号（V2 种子）：`admin` / `Mis@123456`，appCode=`system`

## 混合联调（integration Profile）

见 [integration-test.md](../../docs/devops/integration-test.md)。IDE 环境变量模板：`deploy/ide/mis-auth-integration.env`。
