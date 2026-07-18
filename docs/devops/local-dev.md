# 本地开发

> 模式：**local**（默认不连 Nacos）| 基础设施 Docker + 应用 IDE 直跑

本地开发的目标：**零 Nacos 依赖**，各服务读 jar 内 `application.yml`，Gateway 用 `localhost` 直连路由。

## 1. 前置依赖

| 工具 | 版本 | 用途 |
|------|------|------|
| JDK | 17 | 后端（环境变量 `JAVA_HOME_17`） |
| Maven | 3.9+ | 构建 |
| Node.js | 20 LTS | 前端 |
| pnpm | 8+ | 前端包管理 |
| Docker | 24+ | 基础设施 |
| Docker Compose | 2.x | 本地编排 |

## 2. 一次性准备

### 2.1 环境变量

```powershell
copy .env.example .env
# 按需修改 JAVA_HOME_17、DB_* 等
```

本地开发 **不需要** 设置 `MIS_REMOTE`。

### 2.2 JWT 密钥

```powershell
mkdir backend\keys
openssl genrsa -out backend\keys\private.pem 2048
openssl rsa -in backend\keys\private.pem -pubout -out backend\keys\public.pem
```

IDE 或 `.env` 中设置：

```
JWT_PRIVATE_KEY_PATH=./backend/keys/private.pem
JWT_PUBLIC_KEY_PATH=./backend/keys/public.pem
```

### 2.3 一键初始化（可选）

```powershell
.\scripts\init-dev.ps1
```

等价于：起 Docker 基础设施 → 等待 PG → Flyway 迁移。

## 3. 启动基础设施

```powershell
docker compose -f deploy/docker-compose.dev.yml up -d
```

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5432 | 库 `mis_platform`（业务）+ `nacos`（配置中心元数据） |
| Redis | 6379 | 缓存、验证码、Token 黑名单 |
| Nacos | 8848 | 控制台 http://localhost:8848/nacos（`nacos`/`nacos`） |
| MinIO | 9000 / 9001 | 对象存储占位（Phase 2+） |

### 数据库连接

| 项 | 值 |
|----|-----|
| Host | `localhost` |
| Port | `5432` |
| Database | `mis_platform` |
| Username | `mis` |
| Password | `mis123` |

## 4. 数据库迁移

```powershell
cd backend
.\mvn.ps1 -pl mis-migrator flyway:migrate
```

- 脚本路径：`backend/mis-migrator/src/main/resources/db/migration/`
- 业务微服务 **不** 启用 `spring.flyway`（单库集中迁移）

## 5. 启动后端（Sprint 1 已实现服务）

**不要** 设置 `MIS_REMOTE`；各服务使用 `application.yml` 默认值。

```powershell
cd backend

# 分别开终端，或 IDE 启动
.\mvn.ps1 spring-boot:run -pl mis-auth    # :8101
.\mvn.ps1 spring-boot:run -pl mis-audit   # :8106
.\mvn.ps1 spring-boot:run -pl mis-gateway # :8080
```

### 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| mis-gateway | 8080 | API 入口，路由到 localhost |
| mis-auth | 8101 | 登录 / 签发 Token |
| mis-audit | 8106 | 登录日志 |
| mis-admin-bff | 8081 | 规划中 |
| mis-admin-web | 5173 | 前端 dev server |

### Gateway 本地路由

`application.yml` 中已配置直连：

- `/api/v1/auth/**` → `http://localhost:8101`
- `/api/v1/audit/**` → `http://localhost:8106`

无需 Nacos 注册发现。

## 6. 启动前端

```powershell
cd frontend/mis-admin-web
pnpm install
pnpm dev
```

访问 http://localhost:5173 ，API 代理到 Gateway `8080`。

默认账号：`admin` / `Mis@123456`

## 7. 本地调试场景

| 场景 | 做法 |
|------|------|
| 单服务断点 | IDE 启动对应 `*Application`，环境变量引用 `.env` |
| 只改 mis-auth | 只重启 mis-auth，Gateway / audit 保持运行 |
| 看 SQL | `application.yml` 临时加 `logging.level.org.hibernate.SQL: DEBUG` |
| 验证码干扰 | `AUTH_CAPTCHA_ENABLED=false` |
| 验证 Gateway 路由 | `curl http://localhost:8080/api/v1/auth/captcha` |
| 健康检查 | `curl http://localhost:8101/actuator/health` |

### IntelliJ 配置示例

- Main Class：`com.mis.auth.AuthApplication`
- Environment variables：从 `.env` 粘贴，或只设 `JWT_*_PATH`、`DB_HOST=localhost`
- **Active profiles**：留空（不要用 test/prod profile）

## 8. 与 remote 模式的区别

| 项 | 本地 local | test/prod/integration |
|----|------------|------------------------|
| `MIS_REMOTE` | 不设（`false`） | `true` |
| 配置来源 | `application.yml` | Nacos |
| Gateway 路由 | `http://localhost:端口` | `lb://服务名` |
| 服务发现 | 关闭 | 开启 |

需要 **容器 + IDE 混合联调** 时，见 [混合联调](integration-test.md)，不要在本机日常开发中开启 `MIS_REMOTE`。

## 9. 常见问题

### Maven 报 JDK 版本不对

```powershell
$env:JAVA_HOME = $env:JAVA_HOME_17
.\mvn.ps1 clean package
```

或直接使用 `backend/mvn.ps1`（会自动设置 `JAVA_HOME`）。

### 连不上数据库

确认 `docker compose ps` 中 `mis-postgres` 健康，且 `DB_HOST=localhost`。

### Gateway 502 / Connection refused

确认 mis-auth、mis-audit 已启动且端口与 `application.yml` 一致。

### 登录报 JWT 相关错误

检查 `backend/keys/` 下公私钥是否存在，且 `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` 路径正确。

## 10. 关联文档

- [运维总览](README.md)
- [配置管理策略](configuration.md)
- [混合联调](integration-test.md)
- [测试环境部署](test-deploy.md)
