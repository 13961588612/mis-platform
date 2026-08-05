# 远端基础设施 + 本机跑代码

> 场景：**本机只跑 MIS / Agent 源码，不跑 Docker**；PostgreSQL、Redis、Nacos、MinIO、Embedding、Qdrant、RAGFlow 等均部署在**远程服务器**（远端可用 Docker 或其它方式安装，与本机无关）。

相关文档：[本地开发](local-dev.md)（本机 Docker 基础设施）· [混合联调](integration-test.md) · [测试环境部署](test-deploy.md) · [配置管理策略](configuration.md)

---

## 1. 架构

```text
本机（开发机）                         远端服务器
├─ mis-* 微服务 / 前端                  ├─ PostgreSQL :5432
├─ Agent Core / Gateway / H5            ├─ Redis :6379
└─ 仅填写连接配置                       ├─ Nacos :8848 / 9848
                                        ├─ MinIO :9000 / 9001
                                        ├─ Embedding :8001
                                        ├─ Qdrant :6333
                                        └─ RAGFlow :9380（及其自带 MySQL / ES 等）
```

| 阶段 | 在哪做 | 做什么 |
|------|--------|--------|
| A | 远端 | 安装并启动各中间件，放行端口 |
| B | 远端 + 本机连远端执行 | 建库、Flyway、Nacos 命名空间与配置推送、向量集合、RAGFlow API Key |
| C | 本机 | 连远端 Nacos：改 `deploy\nacos-config\integration\`、push、再改 `.env.integration` |

文中 `<INFRA_HOST>` 替换为远端 IP 或域名。

---

## 2. 向运维索取的连接信息

| 服务 | 需要拿到的配置项 |
|------|------------------|
| PostgreSQL | 地址、端口、库名（`mis_platform` / `ai_platform` / `nacos`）、用户名、密码 |
| Redis | 地址、端口、密码（若有）；约定 MIS→**DB 0**，Agent→**DB 2** |
| Nacos | `host:8848`、命名空间（`integration` / `test`）、控制台账号密码 |
| MinIO | Endpoint、AccessKey、SecretKey、Bucket |
| Embedding | Base URL，如 `http://<INFRA_HOST>:8001` |
| Qdrant | 地址、端口（常 `6333`）、API Key（若有） |
| RAGFlow | Base URL（常 `:9380`）、API Key |
| JWT | 与环境统一的一对公私钥（或本机生成后全环境共用） |

建议对本机开放：`5432`、`6379`、`8848`、`9848`、`9000`、`8001`、`6333`、`9380`（按实际启用）。

---

## 3. 远端初始化（一次性）

> 远端安装方式不限。若用本仓库 compose，可在**远端机器**上执行 `deploy/docker-compose*.yml`；**不要**在本机起这些容器。

### 3.1 PostgreSQL

若 DBA 只提供**管理/超级用户**（如 `postgres`），**必须先**用该账号创建业务用户与库，再让应用连接；不要直接用 DBA 账号跑 Flyway / 微服务。

| 库 | 用户（示例） | 用途 |
|----|--------------|------|
| `mis_platform` | `mis` | MIS 业务 |
| `nacos` | `nacos` | Nacos 元数据（remote 模式） |
| `ai_platform` | `aiplatform` | Agent（有 AI 时） |

用 DBA 账号执行（密码请改掉示例值）。推荐脚本：

```powershell
# 依赖本机 psql；用 DBA 账号创建 mis / mis_platform
.\scripts\init-mis-platform-db.ps1 `
  -DbHost <INFRA_HOST> -Port 5432 `
  -AdminUser postgres -AdminPassword '<DBA密码>' `
  -MisPassword '<mis密码>'
# 已存在时可加 -SkipIfExists
# 亦可用别名 -Host 代替 -DbHost
```

等价 SQL（对应 `deploy/postgres/init/01-init-db.sql`）：

```sql
-- 业务库（对应 01-init-db.sql）
CREATE USER mis WITH PASSWORD '<mis密码>';
CREATE DATABASE mis_platform OWNER mis;
GRANT ALL PRIVILEGES ON DATABASE mis_platform TO mis;

\connect mis_platform
GRANT ALL ON SCHEMA public TO mis;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mis;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mis;
```

有 Nacos / Agent 时，再分别执行 `02-init-nacos-db.sql`、`03-nacos-schema.sql`、`02-create-ai-platform.sql`（同样用 DBA 账号）。

**业务表迁移**（用刚建好的 `mis` 用户；Flyway 读 Maven 属性 `db.*`，**不是** `DB_HOST` 环境变量）：

```powershell
cd backend
.\mvn.ps1 -pl mis-migrator flyway:migrate `
  "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" `
  "-Ddb.user=mis" "-Ddb.password=mis123"
```

Agent 库 `ai_platform` 另按 `agent/ai-platform` 做 Alembic（有 AI 时）。

> 若 DBA 已按上表建好库与用户，可跳过建库步骤，直接 Flyway，并把 `.env` / Nacos 里的 `DB_USER` / `DB_PASSWORD` 改成实际账号。

### 3.2 Redis

- 监听 `6379`；生产务必设密码
- MIS 使用 **database 0**；Agent Core / TS Gateway 使用 **database 2**（同实例时勿混用）

### 3.3 Nacos

| 项 | 约定 |
|----|------|
| Server | **2.3.2**，运行 **JDK 17**（镜像说明见 `deploy/nacos/README.md`） |
| 存储 | PostgreSQL 库 `nacos`（联调/测试不要用内嵌当基线） |
| Group | `MIS_GROUP` |
| 命名空间 | 联调 `integration`；测试集群 `test` |

本机推送配置（先改好 Git 源，见 §5）：

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace integration -NacosServer "http://<INFRA_HOST>:8848"
.\scripts\nacos-push.ps1 -Namespace integration -NacosServer "http://<INFRA_HOST>:8848"
```

应有 Data ID：`mis-common`、`mis-gateway`、`mis-auth`、`mis-iam`、`mis-org`、`mis-audit`、`mis-admin-bff`、`mis-kb`（有知识库时）。配置源目录：`deploy/nacos-config/{integration|test}/`。

控制台：`http://<INFRA_HOST>:8848/nacos`。

### 3.4 MinIO

- API `:9000`，Console `:9001`
- 配置 AccessKey / SecretKey / Bucket
- 管理台基础登录可不依赖；知识库/对象存储场景需要

### 3.5 Embedding + Qdrant

| 服务 | 端口 | 说明 |
|------|------|------|
| Embedding | 8001 | `/health` 返回 `ready: true`；`bge-small-zh-v1.5` 维度 **512**；国内建议 `HF_ENDPOINT=https://hf-mirror.com` |
| Qdrant | 6333 | 集合向量维度与 embedding 一致（512） |

建集合（示例）：`skills_index`、`agent_router_index`、`agent_memory_index`。  
可用：`agent/ai-platform/infra/init-qdrant.sh http://<INFRA_HOST>:6333`（脚本内 `VECTOR_SIZE=512`）。

### 3.6 RAGFlow（知识库真实引擎）

- 对外 Web/API 常见端口 **9380**（见 `deploy/ragflow/README.md`）
- 在 Web 控制台创建 **API Key**，交给 `MIS_KB_ENGINE_*`
- `mis-kb` 默认可为 `noop`（不连真实引擎也能跑主流程占位）；联调真实检索时再改 `ragflow`

### 3.7 JWT 密钥

本机生成后全环境共用同一对：

```powershell
mkdir backend\keys
openssl genrsa -out backend\keys\private.pem 2048
openssl rsa -in backend\keys\private.pem -pubout -out backend\keys\public.pem
```

---

## 4. 本机配置（连远端 Nacos）

约定：

- 仓库根目录绝对路径：`D:\code\mis-platform`（若你本地不同，全文替换即可）
- Nacos 命名空间：`integration`（测试集群则把下文路径中的 `integration` 换成 `test`）
- 本机 Java 微服务：`MIS_REMOTE=true`，从远端 Nacos 拉配置并注册

**改配置顺序：** 先改 Git 源 yaml → `nacos-push` → 再改本机环境变量文件 → 启动服务。

---

### 4.1 必须修改 / 创建的文件一览

| # | 绝对路径 | 作用 |
|---|----------|------|
| 1 | `D:\code\mis-platform\deploy\nacos-config\integration\mis-common.yaml` | 推到 Nacos 的共享配置：PG / Redis / JWT 路径占位 |
| 2 | `D:\code\mis-platform\deploy\nacos-config\integration\mis-kb.yaml` | 知识库引擎（RAGFlow）连接 |
| 3 | `D:\code\mis-platform\deploy\nacos-config\integration\mis-admin-bff.yaml` | BFF 连 Agent Core 的 base-url |
| 4 | `D:\code\mis-platform\.env.integration` | 本机进程环境变量（从 `.env.integration.example` 复制） |
| 5 | `D:\code\mis-platform\backend\keys\private.pem` | JWT 私钥（不存在则生成） |
| 6 | `D:\code\mis-platform\backend\keys\public.pem` | JWT 公钥 |

其余 integration 下 yaml（`mis-gateway.yaml`、`mis-auth.yaml`、`mis-iam.yaml`、`mis-org.yaml`、`mis-audit.yaml`）一般**只需 push、不必改**；有特殊端口/开关再改。

Agent / Copilot 另见 §5。

---

### 4.2 文件 1 — `D:\code\mis-platform\deploy\nacos-config\integration\mis-common.yaml`

**改什么：** 把默认 `localhost` 改成远端，或保留 `${DB_HOST}` 占位、由本机环境变量注入（推荐占位 + 环境变量）。

推荐（占位，真实值写在 `.env.integration`）：

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:<INFRA_HOST>}:${DB_PORT:5432}/${DB_NAME:mis_platform}
    username: ${DB_USER:mis}
    password: ${DB_PASSWORD:<mis密码>}
  data:
    redis:
      host: ${REDIS_HOST:<INFRA_HOST>}
      port: ${REDIS_PORT:6379}
      database: 0

mis:
  security:
    jwt:
      public-key-path: ${JWT_PUBLIC_KEY_PATH:D:/code/mis-platform/backend/keys/public.pem}
      private-key-path: ${JWT_PRIVATE_KEY_PATH:D:/code/mis-platform/backend/keys/private.pem}
```

改完后必须 push（见 §4.5）。

---

### 4.3 文件 2 — `D:\code\mis-platform\deploy\nacos-config\integration\mis-kb.yaml`

**改什么：** 真实知识库时指向远端 RAGFlow；暂不用引擎可保持 `noop`。

```yaml
mis:
  kb:
    engine:
      type: ${MIS_KB_ENGINE_TYPE:ragflow}          # 或 noop
      base-url: ${MIS_KB_ENGINE_BASE_URL:http://<INFRA_HOST>:9380}
      api-key: ${MIS_KB_ENGINE_API_KEY:}           # 真实 key 用环境变量注入，勿提交 Git
```

对应本机环境变量（写在 `.env.integration`）：`MIS_KB_ENGINE_TYPE`、`MIS_KB_ENGINE_BASE_URL`、`MIS_KB_ENGINE_API_KEY`。

---

### 4.4 文件 3 — `D:\code\mis-platform\deploy\nacos-config\integration\mis-admin-bff.yaml`

**改什么：** `mis.ai-platform.base-url` 指向本机或远端 Agent Core。

| 场景 | 值 |
|------|-----|
| Agent Core 跑在本机 `:8000` | `http://127.0.0.1:8000` |
| Agent Core 也在远端 | `http://<INFRA_HOST>:8000` |

示例（本机跑 Agent）：

```yaml
mis:
  ai-platform:
    base-url: http://127.0.0.1:8000
    enabled: true
    sse-enabled: true
```

改完后 push。

---

### 4.5 推送到远端 Nacos（改完 yaml 后必做）

在仓库根目录执行：

```powershell
cd D:\code\mis-platform
.\scripts\ensure-nacos-namespace.ps1 -Namespace integration -NacosServer "http://<INFRA_HOST>:8848"
.\scripts\nacos-push.ps1 -Namespace integration -NacosServer "http://<INFRA_HOST>:8848"
```

控制台核对：`http://<INFRA_HOST>:8848/nacos` → 命名空间 `integration` → Group `MIS_GROUP`。

---

### 4.6 文件 4 — `D:\code\mis-platform\.env.integration`

**怎么来：**

```powershell
cd D:\code\mis-platform
copy .env.integration.example .env.integration
```

**整文件改成（按实际填写）：**

```env
MIS_REMOTE=true
NACOS_SERVER=<INFRA_HOST>:8848
NACOS_NAMESPACE=integration
NACOS_CONFIG_GROUP=MIS_GROUP

DB_HOST=<INFRA_HOST>
DB_PORT=5432
DB_NAME=mis_platform
DB_USER=mis
DB_PASSWORD=<mis密码>

REDIS_HOST=<INFRA_HOST>
REDIS_PORT=6379
# REDIS_PASSWORD=<若有>

JWT_PRIVATE_KEY_PATH=D:/code/mis-platform/backend/keys/private.pem
JWT_PUBLIC_KEY_PATH=D:/code/mis-platform/backend/keys/public.pem

AUTH_CAPTCHA_ENABLED=false

# 知识库真实引擎时取消注释并填写
# MIS_KB_ENGINE_TYPE=ragflow
# MIS_KB_ENGINE_BASE_URL=http://<INFRA_HOST>:9380
# MIS_KB_ENGINE_API_KEY=<key>

# 仅当「Gateway 在远端容器、本服务在 IDE」且需被发现时：
# NACOS_REGISTER_IP=<本机对远端可达的 IP>
```

**怎么生效：**

- IDE：Run Configuration → Environment variables → 加载本文件，或手工粘贴上述键值
- 终端：启动前 `Get-Content D:\code\mis-platform\.env.integration | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() } }`  
  或在 `start-dev.ps1` 调用前自行导出这些变量（脚本内默认只写了 JWT/Redis 等少量项，**连远端 Nacos 时务必保证 `MIS_REMOTE` / `NACOS_*` / `DB_*` 已在进程环境中**）

---

### 4.7 文件 5 / 6 — JWT 密钥

绝对路径：

- `D:\code\mis-platform\backend\keys\private.pem`
- `D:\code\mis-platform\backend\keys\public.pem`

不存在则生成：

```powershell
mkdir D:\code\mis-platform\backend\keys -Force
openssl genrsa -out D:\code\mis-platform\backend\keys\private.pem 2048
openssl rsa -in D:\code\mis-platform\backend\keys\private.pem -pubout -out D:\code\mis-platform\backend\keys\public.pem
```

`.env.integration` 中的 `JWT_*_PATH` 必须指向上述两个文件。

---

### 4.8 可选：测试命名空间 `test`

若连测试集群 Nacos，把上述路径中的：

- `D:\code\mis-platform\deploy\nacos-config\integration\` → `D:\code\mis-platform\deploy\nacos-config\test\`
- `.env.integration` 中 `NACOS_NAMESPACE=test`
- push：`-Namespace test`

---

## 5. Agent / Copilot（本机跑代码）

### 5.1 `D:\code\mis-platform\agent\ai-platform\backend\.env`

从 `D:\code\mis-platform\agent\ai-platform\backend\.env.example` 复制后修改：

```env
POSTGRES_HOST=<INFRA_HOST>
POSTGRES_PORT=5432
POSTGRES_DB=ai_platform
POSTGRES_USER=aiplatform
POSTGRES_PASSWORD=<密码>

REDIS_HOST=<INFRA_HOST>
REDIS_PORT=6379
REDIS_DB=2

QDRANT_HOST=<INFRA_HOST>
QDRANT_PORT=6333
EMBEDDING_SERVICE_URL=http://<INFRA_HOST>:8001
EMBEDDING_DIMENSION=512
SKILL_VECTOR_INDEX_ENABLED=true

# LLM：按实际填写 Key / Endpoint
# 无出站代理时可 OUTBOUND_PROXY_ENABLED=false
```

### 5.2 `D:\code\mis-platform\agent\ai-platform\gateway\.env`

从 `D:\code\mis-platform\agent\ai-platform\gateway\.env.example` 复制后修改：

```env
REDIS_URL=redis://<INFRA_HOST>:6379/2
AGENT_CORE_API_URL=http://127.0.0.1:8000
MIS_JWT_PUBLIC_KEY_PATH=D:/code/mis-platform/backend/keys/public.pem
MIS_JWT_ISSUER=mis-platform
```

> `REDIS_URL` 必须带 `/2`，与 Agent Core `REDIS_DB=2` 一致。

### 5.3 前端嵌入相关

| 绝对路径 | 改什么 |
|----------|--------|
| `D:\code\mis-platform\frontend\mis-admin-web\.env` 或 `.env.local`（可从 `.env.example` 复制） | `VITE_AI_H5_ORIGIN=http://127.0.0.1:3000`（H5 本机端口按实际） |
| `D:\code\mis-platform\agent\ai-platform\frontend\.env.development` 或 `.env` | `VITE_PARENT_ORIGINS` 须含管理台 origin，如 `http://localhost:5174,http://127.0.0.1:5174` |

---

## 6. 配置文件速查（连远端 Nacos）

| 目的 | 绝对路径 |
|------|----------|
| 共享 PG/Redis/JWT（推 Nacos） | `D:\code\mis-platform\deploy\nacos-config\integration\mis-common.yaml` |
| 知识库引擎（推 Nacos） | `D:\code\mis-platform\deploy\nacos-config\integration\mis-kb.yaml` |
| BFF→Agent（推 Nacos） | `D:\code\mis-platform\deploy\nacos-config\integration\mis-admin-bff.yaml` |
| 本机环境变量 | `D:\code\mis-platform\.env.integration` |
| JWT 密钥 | `D:\code\mis-platform\backend\keys\private.pem`、`public.pem` |
| 推送脚本 | `D:\code\mis-platform\scripts\nacos-push.ps1`、`ensure-nacos-namespace.ps1` |
| Agent Core | `D:\code\mis-platform\agent\ai-platform\backend\.env` |
| Agent Gateway | `D:\code\mis-platform\agent\ai-platform\gateway\.env` |

**注意：** `deploy\nacos-config\` 是 Git 源，改完必须 `nacos-push`；不要只改控制台却不回写仓库。

---

## 7. 本机启动顺序

```text
1. 确认远端端口可达（PG / Redis / 按需 Nacos、8001、6333、9380）
2. Flyway 已对 mis_platform 执行 migrate
3. 后端：领域服务 → mis-admin-bff → mis-gateway
4. 前端：frontend/mis-admin-web  pnpm dev
5. （可选）Agent Core :8000 → Gateway :3100 → H5 :3000
```

本机**不需要**执行 `docker compose` 起基础设施。

默认账号：`admin` / `Mis@123456`（首次登录强制改密）。

---

## 8. 最小集 vs 全量

| 目标 | 远端至少需要 |
|------|----------------|
| 管理台登录 / 组织权限 | PostgreSQL + Redis + Nacos |
| Copilot / 技能向量 | 上项 + Embedding + Qdrant（+ Agent Redis db2） |
| 知识库真实检索 | 上项 + RAGFlow（+ 按需 MinIO） |
| CRM 会员问数 | 另需 MCP `mcp-api-suite` 等外部服务 |

---

## 9. 关联路径

| 路径 | 说明 |
|------|------|
| `deploy/postgres/init/` | 建库 SQL |
| `deploy/nacos/` | Nacos Server 镜像与 PG 模式 |
| `deploy/nacos-config/` | 推送到 Nacos 的配置源 |
| `deploy/ragflow/` | RAGFlow 引擎部署说明 |
| `deploy/docker-compose.ai.yml` | AI 栈（Embedding / Qdrant 等）参考 |
| `.env.example` / `.env.integration.example` | 本机环境变量模板 |
| `agent/ai-platform/backend/.env.example` | Agent Core 模板 |
| `agent/ai-platform/gateway/.env.example` | Agent Gateway 模板 |
