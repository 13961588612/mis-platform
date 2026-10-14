# ai-platform Backend（Agent Core）安装与部署

> 组件：`agent/ai-platform/backend`（Python FastAPI，端口 **8000**）  
> 正式环境主机：**S1** `10.254.26.33`  
> 配置方式：**本机 `.env` / 容器环境变量**（**不**走 Nacos；与 Java 微服务不同）

相关：本地联调见 [local-dev.md](local-dev.md)；远端中间件见 [remote-infra-local-dev.md](remote-infra-local-dev.md)；五机总览见 [prod-deploy.md](prod-deploy.md)。  
Gateway（Node `:3100`）在 **S2**，本文只覆盖 **Backend**。

---

## 1. 职责与依赖

| 项 | 说明 |
|----|------|
| 职责 | Agent 编排 / Worker、会话、Skill、权限回源、问数 MCP 客户端等 |
| 健康检查 | `GET http://127.0.0.1:8000/health` |
| 被谁调用 | S1 `mis-admin-bff`、S2 `ai-platform-gateway` |

| 依赖 | 主机 | 说明 |
|------|------|------|
| PostgreSQL 库 `ai_platform` | S4 | 用户 `aiplatform`；表用 **Alembic**（不是 Flyway） |
| Redis DB **2** | S4 | 键前缀建议 `aip:` |
| Qdrant | S4 | 向量记忆 / 技能索引 |
| Embedding `:8001` | S1 本机 | 见 prod-deploy Embedding 小节 |
| Squid `:3128` | S2 | LLM 出站（`OUTBOUND_PROXY_*`） |
| mis-admin-bff `:8081` | S1 | ACL 回源；`AI_PLATFORM_BFF_SHARED_SECRET` 必须与 BFF 一致 |
| mis-kb / mis-iqd | S1 | 按功能可选 |

---

## 2. 前置

1. S4 已建库：`deploy/postgres/init/02-create-ai-platform.sql`（及用户脚本）。
2. S1 已装 **Python 3.12+**（裸跑）或 **Docker**（镜像跑）。
3. S1 能访问 S4 `5432` / `6379` / `6333`，S2 `3128`。
4. Embedding 已起（若启用技能向量索引）。

---

## 3. 目录约定（裸机示例）

```text
/usr/local/app/ai-platform-backend/
├── .env                 # 生产环境变量（勿提交 Git）
├── logs/
└── （代码：仓库 checkout 或 rsync）
    agent/ai-platform/
    ├── backend/         # 源码 + alembic
    ├── configs/         # Agent/Skill 等文件配置
    └── infra/Dockerfile.backend
```

密钥若与 Java 共用：`/usr/local/app/keys/`（Backend 当前以 `.env` 里的密钥为主，不一定读 JWT pem）。

---

## 4. 配置（`.env`）

模板：`agent/ai-platform/backend/.env.example`。生产最少改这些：

```env
ENVIRONMENT=production
DEBUG=false
LOG_LEVEL=INFO
HOST=0.0.0.0
PORT=8000
RELOAD=false
WORKERS=1

POSTGRES_HOST=10.254.26.36
POSTGRES_PORT=5432
POSTGRES_DB=ai_platform
POSTGRES_USER=aiplatform
POSTGRES_PASSWORD=<生产密码>

REDIS_HOST=10.254.26.36
REDIS_PORT=6379
REDIS_DB=2

QDRANT_HOST=10.254.26.36
QDRANT_PORT=6333

EMBEDDING_SERVICE_URL=http://127.0.0.1:8001
EMBEDDING_DIMENSION=512
SKILL_VECTOR_INDEX_ENABLED=true

OUTBOUND_PROXY_ENABLED=true
OUTBOUND_PROXY_HOST=10.254.26.34
OUTBOUND_PROXY_PORT=3128

# 与 Nacos mis-admin-bff 中 service-token 一致
MIS_ADMIN_BFF_BASE_URL=http://127.0.0.1:8081
AI_PLATFORM_BFF_SHARED_SECRET=<与BFF相同>
MIS_ACL_ENABLED=true

CONFIG_MODE=file_system
CONFIG_BASE_PATH=/usr/local/app/ai-platform-backend/agent/ai-platform/configs
# 若工作目录在 backend 下且 configs 在上级：
# CONFIG_BASE_PATH=../configs

QWEN_API_KEY=...
DEEPSEEK_API_KEY=...
# 其它 LLM / 企微 / Vault 按 .env.example 填
```

`AI_PLATFORM_BFF_SHARED_SECRET` 必须与 BFF（Nacos `mis.ai-platform.service-token`）一致，否则权限回源 401、Skill fail-closed。

---

## 5. 数据库迁移（Alembic）

在 **能访问 S4 PG** 的机器上，用已写好的 `.env`：

```bash
cd /path/to/agent/ai-platform/backend
# 推荐 uv；或 pip install -e .
uv sync   # 若尚未装依赖
uv run alembic upgrade head
uv run alembic current
```

Windows 本机连远端示例见 [remote-infra-local-dev.md §3.1](remote-infra-local-dev.md)。

---

## 6. 部署方式（二选一）

### 方案 A — Docker（推荐与 compose 一致）

构建上下文必须是 **`agent/ai-platform/`**（含 `backend/` + `configs/`）：

```bash
cd /path/to/mis-platform/agent/ai-platform

docker build -f infra/Dockerfile.backend --target production \
  -t mis-ai-platform-backend:prod .

# 用 --env-file 注入生产变量（不要把密钥写进镜像）
docker run -d --name ai-platform-backend --restart unless-stopped \
  -p 8000:8000 \
  --env-file /usr/local/app/ai-platform-backend/.env \
  -v /path/to/agent/ai-platform/configs:/app/configs:ro \
  mis-ai-platform-backend:prod
```

镜像内默认 `CONFIG_BASE_PATH=/app/configs`；挂卷可热更新 configs。  
联调栈参考：`deploy/docker-compose.ai.yml` 服务 `ai-platform-backend`。

### 方案 B — 裸机 + uv PATH + systemd（推荐）

#### B.1 安装 Python / uv，并写入系统 PATH

```bash
# Python 3.12（按发行版调整）
sudo dnf install -y python3.12 python3.12-devel   # 或 apt install python3.12 ...

# 安装 uv 到当前用户 ~/.local/bin
curl -LsSf https://astral.sh/uv/install.sh | sh

# 全局 PATH：链到 /usr/local/bin（登录 shell 与 systemd 都能用）
sudo ln -sfn "$HOME/.local/bin/uv"  /usr/local/bin/uv
sudo ln -sfn "$HOME/.local/bin/uvx" /usr/local/bin/uvx

# 可选：所有交互用户自动带上 ~/.local/bin
echo 'export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"' | sudo tee /etc/profile.d/uv-path.sh
sudo chmod 644 /etc/profile.d/uv-path.sh

# 当前会话立即生效
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
hash -r
uv --version
which uv   # 期望 /usr/local/bin/uv 或 ~/.local/bin/uv
```

> systemd **不会**读 `~/.bashrc`；unit 里已设 `PATH=/usr/local/bin:...`，且 `ExecStart` 优先用项目 **`.venv/bin/uvicorn`**，不依赖登录 PATH。

#### B.2 同步代码、装依赖、迁移

```bash
# 目录示例（按实际上传路径调整）
sudo mkdir -p /usr/local/app/ai-platform-backend
# 将仓库 agent/ai-platform 放到：
#   /usr/local/app/ai-platform-backend/agent/ai-platform/

cp agent/ai-platform/backend/.env.example /usr/local/app/ai-platform-backend/.env
vi /usr/local/app/ai-platform-backend/.env   # 填 S4/代理/密钥等
chmod 600 /usr/local/app/ai-platform-backend/.env

cd /usr/local/app/ai-platform-backend/agent/ai-platform/backend
set -a && source /usr/local/app/ai-platform-backend/.env && set +a

uv sync
uv run alembic upgrade head
test -x .venv/bin/uvicorn && echo "venv ok"
```

#### B.3 安装 systemd 单元并启停

单元模板：`agent/ai-platform/infra/ai-platform-backend.service`  
若代码路径不是文档默认，先改 unit 里的 `WorkingDirectory` / `ExecStart` / `EnvironmentFile`。

```bash
sudo cp /usr/local/app/ai-platform-backend/agent/ai-platform/infra/ai-platform-backend.service \
  /etc/systemd/system/ai-platform-backend.service
# 或从本机仓库：
# scp agent/ai-platform/infra/ai-platform-backend.service root@10.254.26.33:/etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now ai-platform-backend
sudo systemctl status ai-platform-backend
```

常用：

```bash
sudo systemctl start ai-platform-backend
sudo systemctl stop ai-platform-backend
sudo systemctl restart ai-platform-backend
journalctl -u ai-platform-backend -f
```

改 `.env` 或代码后：再 `uv sync`（若依赖变了）→ `sudo systemctl restart ai-platform-backend`。

---

## 7. 验收

```bash
curl -fsS http://127.0.0.1:8000/health
# 期望 HTTP 200

# 从 BFF 机确认（同机）
curl -fsS http://127.0.0.1:8000/health

# 日志无 PG/Redis/Qdrant 连接风暴；LLM 经 Squid 可出站（按需测一条 chat）
```

BFF 侧 Nacos 已配：`mis.ai-platform.base-url: http://127.0.0.1:8000`（同机）。

---

## 8. 与相邻组件的边界

| 组件 | 部署位置 | 文档 |
|------|----------|------|
| Embedding | S1 `:8001` | [prod-deploy.md](prod-deploy.md) Embedding 小节 |
| ai-platform-gateway | S2 `:3100` | `agent/ai-platform/gateway/`，compose / 单独 Node 部署 |
| WrenMcpAgent | S5 | [wren-mcp-agent-deploy.md](../ai-fusion/wrenai/wren-mcp-agent-deploy.md) |
| Squid | S2 `:3128` | prod-deploy S2 |

---

## 9. 常见问题

| 现象 | 排查 |
|------|------|
| 权限全拒 /「权限服务暂不可用」 | `MIS_ADMIN_BFF_BASE_URL` 是否指向 **8081**（勿用 gateway 8080）；`AI_PLATFORM_BFF_SHARED_SECRET` 是否与 BFF 一致 |
| 连不上库 | `.env` 的 `POSTGRES_*`；S4 防火墙；Alembic 是否已 `upgrade head` |
| LLM 超时 | Squid `OUTBOUND_PROXY_*`；S2:3128 是否对 S1 放行；API Key |
| 向量相关失败 | Embedding `:8001`、`QDRANT_*`、`EMBEDDING_DIMENSION=512` |

---

## 10. 源码与模板路径

| 路径 | 用途 |
|------|------|
| `agent/ai-platform/backend/` | 应用与 Alembic |
| `agent/ai-platform/backend/.env.example` | 环境变量模板 |
| `agent/ai-platform/configs/` | Agent / Skill / system 文件配置 |
| `agent/ai-platform/infra/Dockerfile.backend` | 生产镜像 |
| `agent/ai-platform/infra/ai-platform-backend.service` | 裸机 systemd 单元 |
| `deploy/docker-compose.ai.yml` | 联调 compose 参考 |
| `deploy/postgres/init/02-create-ai-platform.sql` | 建库 |
