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

### 2.3 知识库引擎 RAGFlow（可选，知识库迭代时必开）

企业文档 RAG 引擎以 Docker 运行，脚本见 [`deploy/ragflow/`](../../deploy/ragflow/)。**开发 mis-kb 时须同步维护该目录，并保证测试环境同一套脚本可用**（[ADR-018](../adr/ADR-018-knowledge-base-mis-kb.md)）。

```powershell
cd deploy/ragflow
copy .env.example .env
# K0 完成完整 compose 后：
docker compose --env-file .env --profile full up -d
```

说明：[knowledge-base.md](../backend/knowledge-base.md)。ai-platform 自带的 Qdrant 用于 Agent 记忆，与 RAGFlow 企业知识库职责不同。

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

# 推荐：脚本启动（会等端口就绪；已在跑则跳过）
.\start-dev.ps1                 # 全部
.\start-dev.ps1 mis-admin-bff   # 仅 BFF
.\start-dev.ps1 mis-admin-bff -Restart  # 强制重启

# 或分别开终端 / IDE（建议顺序：领域服务 → BFF → Gateway）
.\mvn.ps1 spring-boot:run -pl mis-auth       # :8101
.\mvn.ps1 spring-boot:run -pl mis-iam        # :8102
.\mvn.ps1 spring-boot:run -pl mis-org        # :8103
.\mvn.ps1 spring-boot:run -pl mis-system     # :8105
.\mvn.ps1 spring-boot:run -pl mis-audit      # :8106
.\mvn.ps1 spring-boot:run -pl mis-kb         # :8108
.\mvn.ps1 spring-boot:run -pl mis-admin-bff  # :8081
.\mvn.ps1 spring-boot:run -pl mis-gateway    # :8080
```

> **注意：**
> - 现脚本会：已监听且 **health 正常** 则跳过；端口在听但 health 失败（僵死/错库）会停掉再启；`-Restart` 强制重启。
> - 若仓库根存在 [`.env.integration`](../../.env.integration.example)，会自动加载（`DB_HOST`/`REDIS_HOST`/`MIS_REMOTE` 等）并传给各子进程。PG/Redis 不在本机时务必维护该文件，否则 mis-kb 等会默连 `localhost` 后卡住，BFF 报 3s 下游超时。
> - 仅「端口在听」不够：曾出现裸 `java -jar mis-kb` 占着 8108、start-dev 误跳过的情况。

需设置 JWT 密钥路径（绝对路径更稳），例如：

```powershell
$env:JWT_PRIVATE_KEY_PATH = "D:\code\mis-platform\backend\keys\private.pem"
$env:JWT_PUBLIC_KEY_PATH  = "D:\code\mis-platform\backend\keys\public.pem"
# 可选：本地关掉验证码校验
$env:AUTH_CAPTCHA_ENABLED = "false"
```

### 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| mis-gateway | 8080 | API 入口，路由到 localhost |
| mis-auth | 8101 | 登录 / 签发 Token |
| mis-iam | 8102 | 身份与权限 |
| mis-org | 8103 | 组织与人事 |
| mis-system | 8105 | 菜单 / 字典 / 仪表盘统计 |
| mis-audit | 8106 | 登录日志 |
| mis-kb | 8108 | 知识库（已纳入 start-dev / stop-dev） |
| mis-admin-bff | 8081 | 对外 API 聚合 + API 权限拦截 |
| mis-admin-web | 5173 | 前端 dev server |

### Gateway 本地路由

`application.yml` 中已配置直连（`order` 越小越优先）：

- `/api/v1/auth/me` → `http://localhost:8081`（**BFF**，须优先于下方 auth 通配）
- `/api/v1/auth/**` → `http://localhost:8101`
- `/api/v1/audit/**` → `http://localhost:8106`
- `/api/v1/**` → `http://localhost:8081`（BFF）

无需 Nacos 注册发现。

## 6. 启动前端

```powershell
cd frontend/mis-admin-web
pnpm install
pnpm dev
```

访问 http://localhost:5174 （见 `vite.config.ts`），API 代理到 Gateway `8080`。

默认账号：`admin` / `Mis@123456`（首次登录强制改密）。登录成功后进入 **`/portal`** 应用九宫格，再进 `system` 子系统。

### 6.1 管理台 Copilot（iframe 嵌入 Agent H5）

全局 FAB / Sheet **不再自建对话 UI**，而是嵌入 `agent/ai-platform/frontend` 的 `/chat?embed=1`（通路 B）。

```powershell
# 终端 A：Agent H5（默认 :3000）
cd agent/ai-platform/frontend
# 已提供 .env.development：VITE_PARENT_ORIGINS 含管理台 5174
pnpm install
pnpm dev

# 终端 B：TS gateway（:3100），需信任 MIS JWT
cd agent/ai-platform/gateway
$env:MIS_JWT_PUBLIC_KEY_PATH = "D:\code\mis-platform\backend\keys\public.pem"
$env:MIS_JWT_ISSUER = "mis-platform"
# REDIS_URL 必须带 /2，与 Agent Core REDIS_DB=2 一致（否则 WS 已连接但无回复）
# 例：REDIS_URL=redis://127.0.0.1:6379/2（见 gateway/.env.example）
pnpm dev   # 或项目既有启动方式

# 终端 C：Python Agent Core :8000（若尚未运行）
cd agent/ai-platform/backend
uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

| 变量 | 位置 | 说明 |
|------|------|------|
| `VITE_AI_H5_ORIGIN` | mis-admin-web | 默认 `http://127.0.0.1:3000` |
| `VITE_PARENT_ORIGINS` | Agent H5 | 须含管理台 origin（`http://localhost:5174` 与 `http://127.0.0.1:5174`） |
| `MIS_JWT_PUBLIC_KEY_PATH` | TS gateway | MIS `backend/keys/public.pem`，否则嵌入令牌验签失败 |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` | Agent Core | 聊天附件本地目录（默认 `data/uploads`，无需公网 URL） |

握手：H5 `AUTH_READY` → 管理台 `postMessage({ type:'AUTH_TOKEN', token })` + `PAGE_CONTEXT`。

对话附件：H5「附件」→ `POST /api/v1/files/upload` → WS `metadata.attachments`；图片由 Agent 读本地文件转 base64 识图（需 vision 模型）；预览走 `GET /api/v1/files/{id}?token=`。

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

确认 mis-auth、mis-admin-bff、mis-iam、mis-org、mis-system、mis-audit 已按需启动，且端口与 `application.yml` 一致。

### 登录报 JWT 相关错误

检查 `backend/keys/` 下公私钥是否存在，且 `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` 路径正确。

## 10. 关联文档

- [运维总览](README.md)
- [配置管理策略](configuration.md)
- [远端基础设施 + 本机代码](remote-infra-local-dev.md)（中间件全在远端、本机不跑 Docker）
- [混合联调](integration-test.md)
- [测试环境部署](test-deploy.md)
