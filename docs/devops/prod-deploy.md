# ai-red正式环境部署手册

> 模式：**remote** | Nacos 命名空间：`prod` | 配置 Git 源：`deploy/nacos-config/prod/`  
> 形态：**五台物理/虚拟机**（非本手册默认的 K8s 拓扑；若改用 K8s，配置与制品规则不变，编排见文末「附录」）  
> 最后更新：2026-10-14

正式环境所有 MIS 微服务与 Agent **必须** `MIS_REMOTE=true`（或等价 remote），配置权威源为 Nacos（元数据持久化在 PostgreSQL `nacos` 库）。

---

## 1. 服务器规划


| 编号  | 主机名          | IP             | 角色           | CPU / 内存 |
| --- | ------------ | -------------- | ------------ | -------- |
| S1  | `ai-service` | `10.254.26.33` | 后端服务（真实）     | 8C / 16G |
| S2  | `ai-portal`  | `10.254.26.34` | 代理 + 页面（双入口） | 8C / 16G |
| S3  | `ai-rag`     | `10.254.26.35` | 知识库（RAGFlow） | 8C / 32G |
| S4  | `ai-data`    | `10.254.26.36` | 数据底座         | 8C / 32G |
| S5  | `ai-sql`     | `10.254.26.37` | 问数（WrenAI）   | 8C / 16G |


```text
用户 / 内网入口
        │
        ▼
   S2 ai-portal          Nginx + 双入口网关 + 静态页 + Squid 出站
        │  ├─ mis-gateway（Java，MIS API 入口）
        │  ├─ ai-platform-gateway（Node/TS，通路 B / WS）
        │  └─ Squid（LLM 出站白名单，:3128）
        │
        ├──────────────► S1 ai-service     领域微服务 + Agent 运行时（无对外入口）
        │                      │
        │                      ├──────────► S4 ai-data      PG / Redis / Nacos / MinIO / Qdrant
        │                      ├──────────► S3 ai-rag       RAGFlow 引擎栈
        │                      ├──────────► S5 ai-sql       WrenAI + WrenMcpAgent
        │                      └──────────► S2:3128         Squid（LLM 出站）
        └──────────────►（页面静态资源本机托管）
```

**原则：**

- **双入口与出站在 S2**：`mis-gateway` + `ai-platform-gateway`（Node/TS，不是 Python）与 Nginx、管理端静态页、**Squid 出站代理**同机；对外只暴露 S2 的 HTTP(S)。
- **S1 只跑领域与运行时**：Java 业务服务、ai-platform backend（Python）、**Embedding**；不对外开入口端口。
- 业务库与中间件集中在 **S4**；知识库引擎独占 **S3**；问数数据面独占 **S5**。

### 1.1 前置：安装 Docker（各机第一步）

后续 Redis / MinIO / Qdrant / Nacos / RAGFlow / 业务镜像均依赖容器。建议版本：**Docker Engine 24+**、**Compose V2**（`docker compose` 子命令）。

| 主机 | 是否必须装 Docker |
|------|-------------------|
| S4 `ai-data` | **必须**（PG/Redis/MinIO/Qdrant/Nacos） |
| S3 `ai-rag` | **必须**（RAGFlow 整栈） |
| S1 `ai-service` | **建议**（Embedding、业务 JAR / Agent 镜像） |
| S2 `ai-portal` | **建议**（网关/Nginx/Squid 可用容器；亦可裸机 Nginx） |
| S5 `ai-sql` | 可选（WrenAI / WrenMcpAgent 主路径为 Python + systemd，不强制 Docker） |

以下以 **root**（或已加入 `docker` 组的用户）在目标机执行。内网环境请改用公司镜像源 / 离线包。

官方 `https://download.docker.com/...` 在国内常超时，**安装包仓库**请改用下方国内镜像（任选其一）。

| 来源 | CentOS/RHEL 系 repo | Ubuntu 系 apt 根 |
|------|---------------------|------------------|
| 阿里云 | https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo | `https://mirrors.aliyun.com/docker-ce/linux/ubuntu` |
| 清华 TUNA | https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/centos/docker-ce.repo | `https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/ubuntu` |
| 华为云 | https://mirrors.huaweicloud.com/docker-ce/linux/centos/docker-ce.repo | `https://mirrors.huaweicloud.com/docker-ce/linux/ubuntu` |
| 中科大 | https://mirrors.ustc.edu.cn/docker-ce/linux/centos/docker-ce.repo | `https://mirrors.ustc.edu.cn/docker-ce/linux/ubuntu` |

#### RHEL / Rocky / Alma Linux 9（国内源示例：阿里云）

```bash
sudo dnf -y install dnf-plugins-core
# 官方连不上时用国内源（可换成清华/华为/中科大 URL）
sudo dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
# 若 repo 内仍指向 download.docker.com，可改写 baseurl：
sudo sed -i 's|https://download.docker.com|https://mirrors.aliyun.com/docker-ce|g' \
  /etc/yum.repos.d/docker-ce.repo

sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

#### Ubuntu 22.04 / 24.04（国内源示例：阿里云）

```bash
sudo apt-get update
sudo apt-get -y install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://mirrors.aliyun.com/docker-ce/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

#### 验收与常用准备

```bash
docker version          # 应有 Client + Server，Engine ≥ 24
docker compose version  # 应为 Compose V2（如 v2.x）
sudo docker run --rm hello-world

# 非 root 运维账号（可选）
sudo usermod -aG docker <运维用户>
# 重新登录后生效

# 数据盘目录（本手册绑定挂载示例用；按盘规划调整）
sudo mkdir -p /data
sudo chmod 755 /data
```

#### 拉取镜像加速（装好后仍 `docker pull` 慢时）

安装包源与 **镜像拉取** 是两套配置。可配置 daemon 镜像加速（示例，按公司/云厂商实际地址替换）：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io"
  ]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```

> 若使用 **Docker Desktop（Windows）** 仅适合本机联调，正式五机请装 **Docker Engine**（Linux）。  
> 公网镜像站策略会变，仍失败时用公司 Harbor / 离线 `docker load`。

### 1.2 裸跑 JAR：安装 JDK / JRE 17（S1 / S2）

业务 JAR、`mis-gateway` 若不进容器、直接 `java -jar`，须在宿主机安装 **Java 17**（与镜像基线 `eclipse-temurin:17` 同大版本）。推荐 **Eclipse Temurin**；仅运行制品可用 **JRE**，本地偶发排查可用 **JDK**。

| 主机 | 用途 |
|------|------|
| S1 `10.254.26.33` | `mis-auth` / `mis-iam` / … / `mis-iqd` 等业务 JAR |
| S2 `10.254.26.34` | `mis-gateway` JAR |

#### RHEL / Rocky / Alma 9（Temurin 17）

```bash
# 方式 A：Adoptium yum 源（推荐）
sudo tee /etc/yum.repos.d/adoptium.repo <<'EOF'
[Adoptium]
name=Adoptium
baseurl=https://packages.adoptium.net/artifactory/rpm/rhel/$releasever/$basearch
enabled=1
gpgcheck=1
gpgkey=https://packages.adoptium.net/artifactory/api/gpg/key/public
EOF

# 仅运行 JAR → JRE；需要 javac/工具 → 改为 temurin-17-jdk
sudo dnf -y install temurin-17-jre
# sudo dnf -y install temurin-17-jdk
```

国内若 `packages.adoptium.net` 慢，可改用发行版 OpenJDK：

```bash
sudo dnf -y install java-17-openjdk-headless
# 完整 JDK：sudo dnf -y install java-17-openjdk-devel
```

#### Ubuntu 22.04 / 24.04

```bash
sudo apt-get update
# Temurin（需先加 Adoptium apt 源，见 https://adoptium.net/installation/linux/）
# 或直接用发行版：
sudo apt-get -y install openjdk-17-jre-headless
# 完整 JDK：sudo apt-get -y install openjdk-17-jdk-headless
```

#### 验收与环境变量

```bash
java -version
# 应看到 17.x（如 OpenJDK 17 / Temurin-17）

# 查 JAVA_HOME（路径因发行版而异，示例）：
dirname $(dirname $(readlink -f $(which java)))
# 常见：/usr/lib/jvm/temurin-17-jre  或  /usr/lib/jvm/java-17-openjdk

# 写入运维账号（按实际路径改）
echo 'export JAVA_HOME=/usr/lib/jvm/java-17-openjdk' | sudo tee /etc/profile.d/java17.sh
echo 'export PATH=$JAVA_HOME/bin:$PATH' | sudo tee -a /etc/profile.d/java17.sh
source /etc/profile.d/java17.sh
```

多版本并存时指定 17：

```bash
sudo alternatives --config java    # RHEL 系
# 或：sudo update-alternatives --config java   # Debian/Ubuntu
```

#### 启动 JAR 示例

```bash
# 建议单独目录与用户，日志与密钥不进 jar
sudo mkdir -p /opt/mis/{apps,logs,keys}
# 将 mis-xxx.jar 放到 /opt/mis/apps/

export MIS_REMOTE=true
export NACOS_NAMESPACE=prod
export NACOS_SERVER=10.254.26.36:8848
export NACOS_USERNAME=nacos
export NACOS_PASSWORD='<改成控制台真实口令>'   # 开鉴权后必填；勿提交仓库
export JWT_PUBLIC_KEY_PATH=/usr/local/app/keys/public.pem   # 多服务共享
# mis-auth / BFF 嵌入兑换另需：export JWT_PRIVATE_KEY_PATH=/usr/local/app/keys/private.pem
# 或 MIS_JWT_PRIVATE_KEY_PATH（BFF application.yml）

nohup java -Xms512m -Xmx1024m -jar /usr/local/app/mis-gateway/mis-gateway.jar \
  > /usr/local/app/mis-gateway/logs/console.out 2>&1 &
```

JWT 密钥目录（S1/S2 共用约定）：**`/usr/local/app/keys/{public,private}.pem`**，勿拷进各应用子目录。  
生产建议再用 **systemd** 托管（`Restart=always`、`User=`、`EnvironmentFile=`），避免裸 `nohup`。

---

## 2. 各主机软件清单（含外部软件版本）

> **版本钉扎来源**：仓库 `deploy/docker-compose*.yml`、`deploy/ragflow/.env.example`、`docs/ai-fusion/wrenai/deploy-iqd.md`。  
> 外部组件 **禁止使用** `latest`；升级须改钉扎位并回归后再上生产。  
> 本仓库自研组件（MIS JAR / Agent / 前端）版本以发版 **git sha / 发布 tag** 为准，下表不写死业务版本号。

### 2.1 S1 — `ai-service`（10.254.26.33）后端服务


| 类别          | 软件 / 组件                               | 版本 / 说明                                                                |
| ----------- | ------------------------------------- | ---------------------------------------------------------------------- |
| 运行时         | **OpenJDK / Temurin JRE**             | **17**（镜像基线 `eclipse-temurin:17-jre-alpine`）                           |
| 运行时         | **Python**                            | **3.12+**（ai-platform backend）                                         |
| 容器（推荐）      | Docker Engine + Compose V2            | 建议 **24+** / Compose **v2**                                            |
| 自研 · Java   | `mis-auth`                            | 发版制品（持 JWT **私钥**）                                                     |
| 自研 · Java   | `mis-iam`                             | 发版制品                                                                   |
| 自研 · Java   | `mis-org`                             | 发版制品                                                                   |
| 自研 · Java   | `mis-audit`                           | 发版制品                                                                   |
| 自研 · Java   | `mis-admin-bff`                       | 发版制品                                                                   |
| 自研 · Java   | `mis-system`                          | 发版制品                                                                   |
| 自研 · Java   | `mis-taskflow`                        | 发版制品（流程）                                                               |
| 自研 · Java   | `mis-kb`                              | 发版制品（知识库编排，连 S3 RAGFlow）                                               |
| 自研 · Java   | `mis-iqd`                             | 发版制品（问数配置/ACL，连 S5 MCP）                                                |
| 自研 · 运维 Job | `mis-migrator`                        | Flyway 迁移（发版时对 S4 业务库执行，可 Job 形态）                                      |
| 自研 · Agent  | **ai-platform backend**               | Python 编排 / Worker（含问数、知识检索等）                                          |
| 外部 · 模型服务   | **Embedding 服务**（`bge-small-zh-v1.5`） | 自建镜像（`Dockerfile.embedding`）；模型 **BAAI/bge-small-zh-v1.5**；端口 **8001** |


> **不在 S1 部署**：`mis-gateway`、`ai-platform-gateway`、**Squid**（均在 S2）。

启动要求：`MIS_REMOTE=true`，`NACOS_NAMESPACE=prod`，`NACOS_SERVER=10.254.26.36:8848`（或内网 DNS 名）。JWT **私钥**挂载到 `mis-auth`，不进镜像。  
Agent 出站：`OUTBOUND_PROXY_HOST=10.254.26.34`、`OUTBOUND_PROXY_PORT=3128`（指向 S2 Squid）。  
Embedding 本机：`EMBEDDING_SERVICE_URL=http://127.0.0.1:8001`。

#### Embedding 部署（S1 · 向量化服务）

**作用：** 为 Agent 提供本地文本向量（**BAAI/bge-small-zh-v1.5**，维度 **512**），供写入/检索 S4 Qdrant。  
**方案：** 在 **S1 服务器上直接 `docker build` + `docker run`**（不在本机打镜像再拷贝）。

前置：S1 已装 Docker；仓库代码已放到 S1（或至少有 `agent/ai-platform/infra/`：`Dockerfile.embedding`、`requirements-embedding.txt`、`embedding_server.py`）；构建机能访问 PyPI / PyTorch CPU 源，首次运行需能拉模型（可用 `HF_ENDPOINT` 镜像）。

```bash
# 在 S1 上执行
cd /path/to/mis-platform/agent/ai-platform/infra

docker build -f Dockerfile.embedding -t mis-embedding:bge-small-zh-v1.5 .

sudo mkdir -p /data/ai-platform-embedding_models
docker run -d --name ai-platform-embedding --restart unless-stopped \
  -p 8001:8001 \
  -e MODEL_NAME=BAAI/bge-small-zh-v1.5 \
  -e PORT=8001 \
  -e MAX_BATCH_SIZE=32 \
  -e HF_ENDPOINT=https://hf-mirror.com \
  -e HUGGINGFACE_HUB_ENDPOINT=https://hf-mirror.com \
  -v /data/ai-platform-embedding_models:/app/models \
  mis-embedding:bge-small-zh-v1.5
```

验收：`curl -sS http://127.0.0.1:8001/health`（期望含 `ready: true`；**首次**拉模型可能较久，属正常）。  
Agent：`EMBEDDING_SERVICE_URL=http://127.0.0.1:8001`。

### 2.2 S2 — `ai-portal`（10.254.26.34）代理 + 页面（双入口）


| 类别      | 软件 / 组件                   | 版本 / 说明                                                                             |
| ------- | ------------------------- | ----------------------------------------------------------------------------------- |
| 外部      | **Nginx**                 | **1.25-alpine**（与 `deploy/docker-compose.ai.yml` 中 `edge-nginx` 钉扎一致；亦可主机安装 1.25.x） |
| 运行时     | **OpenJDK / Temurin JRE** | **17**（跑 `mis-gateway`）                                                             |
| 运行时     | **Node.js**               | **22**（`ai-platform-gateway`；镜像 `node:22-alpine`）                                   |
| 自研 · 入口 | `**mis-gateway**`         | Java API 网关（Nacos 发现 → `lb://` 转发至 S1 各服务）                                          |
| 自研 · 入口 | `**ai-platform-gateway**` | **Node/TS** Gateway（通路 B / WS，`:3100`）；**不是 Python**                                |
| 自研      | **mis-admin-web** 静态产物    | `npm run build` 产物；由 Nginx 托管                                                       |
| 外部 · 出站 | **Squid 出站代理**            | 镜像自建（`agent/ai-platform/infra/Dockerfile.outbound-proxy`）；端口 **3128**；LLM API 白名单 |
| 配置      | Nginx 反代                  | 80/443 → 本机 `mis-gateway` / `ai-platform-gateway` / 静态目录（双入口路径按生产 conf）             |


说明：

- Nginx 做 TLS 终结与路径分流；**业务鉴权与路由**在两个 Gateway 内完成。
- `mis-gateway` 经 Nacos 调用 S1 上的 auth/bff/领域服务；挂载 JWT **公钥**验签。
- `ai-platform-gateway` 回源 S1 上的 ai-platform backend。
- **Squid** 仅对内网（尤其 **S1**）开放 **3128**，勿对公网；白名单见 `agent/ai-platform/infra/outbound-proxy/squid.conf`。
- 前端构建机 Node **20+** 即可；S2 运行时需要 Node **22**（Gateway）+ Nginx + JRE 17 + Squid。

#### mis-gateway 裸跑（S2 · JAR + systemd）

前置：§1.2 已装 **Java 17**；S4 Nacos/`mis-common`+`mis-gateway` 已推；S1 上 `mis-auth` / `mis-admin-bff` 等已注册；JWT **公钥**已放到 S2。

| 项 | 路径 |
|----|------|
| 安装目录 | `/usr/local/app/mis-gateway/` |
| JAR | `mis-gateway.jar` |
| 环境变量 | `mis-gateway.env`（模板 `deploy/env/prod/mis-gateway.env.example`） |
| systemd | `deploy/systemd/mis-gateway.service` → `/etc/systemd/system/` |
| JWT 公钥 | `/usr/local/app/keys/public.pem` |

**① 构建机打制品**

```bash
cd /path/to/mis-platform/backend
./mvn.ps1 package -pl mis-gateway -am -DskipTests -Pprod   # Windows: .\mvn.ps1 ...
# 产物：backend/mis-gateway/target/mis-gateway-*.jar（以实际文件名为准）
```

**② S2 落盘**

```bash
sudo mkdir -p /usr/local/app/mis-gateway/logs /usr/local/app/keys
# scp JAR → /usr/local/app/mis-gateway/mis-gateway.jar
# scp public.pem → /usr/local/app/keys/public.pem
# scp deploy/env/prod/mis-gateway.env.example → /usr/local/app/mis-gateway/mis-gateway.env
sudo chmod 600 /usr/local/app/mis-gateway/mis-gateway.env
sudo chmod 644 /usr/local/app/keys/public.pem
```

编辑 `mis-gateway.env`（必填）：

```bash
MIS_REMOTE=true
NACOS_SERVER=10.254.26.36:8848
NACOS_NAMESPACE=prod
NACOS_CONFIG_GROUP=MIS_GROUP
NACOS_USERNAME=nacos
NACOS_PASSWORD='<Nacos 控制台口令>'
REDIS_PASSWORD='<与 Redis requirepass 一致>'
JWT_PUBLIC_KEY_PATH=/usr/local/app/keys/public.pem
```

**③ systemd 启动**

```bash
sudo cp /path/to/mis-platform/deploy/systemd/mis-gateway.service /etc/systemd/system/
# 若 java 不在 /usr/bin/java：编辑 unit 里 ExecStart，或取消 JAVA_HOME 注释
sudo systemctl daemon-reload
sudo systemctl enable --now mis-gateway
sudo systemctl status mis-gateway
journalctl -u mis-gateway -f
```

**④ 验收**

```bash
curl -fsS http://127.0.0.1:8080/actuator/health
# Nacos 控制台：mis-gateway 实例 IP 应为 10.254.26.34
```

临时前台调试（不用 systemd 时）：

```bash
cd /usr/local/app/mis-gateway
set -a && source ./mis-gateway.env && set +a
java -Xms512m -Xmx1024m -jar mis-gateway.jar
```

#### ai-platform-gateway 裸跑（S2 · Node 22 + systemd）

> 全文见 [ai-platform-gateway-deploy.md](ai-platform-gateway-deploy.md)。

前置：S2 **Node.js 22**；S1 Agent Core `:8000`；S4 Redis DB **2**（含密码）；JWT 公钥已就位。

| 项 | 路径 |
|----|------|
| 工作目录 | `/usr/local/app/ai-platform-gateway/agent/ai-platform/gateway/` |
| 环境变量 | `.env`（模板 `deploy/env/prod/ai-platform-gateway.env.example`） |
| systemd | `agent/ai-platform/infra/ai-platform-gateway.service` |
| 监听 | **3100**（⚠ 代码默认 `GATEWAY_PORT=8080`，生产必须显式设 3100） |

```bash
# 安装 Node 22 后：
cd /usr/local/app/ai-platform-gateway/agent/ai-platform/gateway
cp /path/to/deploy/env/prod/ai-platform-gateway.env.example .env
# 编辑 REDIS_URL / JWT_SECRET / AGENT_CORE_API_URL / GATEWAY_INTERNAL_TOKEN / GATEWAY_PORT=3100
chmod 600 .env
npm ci && npm run build

# 试跑
node dist/index.js
# curl -fsS http://127.0.0.1:3100/health

# 常驻
sudo cp /path/to/agent/ai-platform/infra/ai-platform-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-platform-gateway
```

`GATEWAY_INTERNAL_TOKEN` 须与 S1 Backend `.env` **完全一致**。

### 2.3 S3 — `ai-rag`（10.254.26.35）知识库 RAGFlow

> 交付目录：`[deploy/ragflow/](../../deploy/ragflow/)` · 版本表以该目录 README / `.env.example` 为准。


| 类别  | 软件 / 组件                     | 版本（钉扎）                         |
| --- | --------------------------- | ------------------------------ |
| 外部  | **RAGFlow**                 | `infiniflow/ragflow:v0.26.4`   |
| 外部  | **MySQL**（RAGFlow 元数据）      | **8.0.39**                     |
| 外部  | **MinIO**（RAGFlow 对象存储）     | `RELEASE.2023-12-20T01-00-02Z` |
| 外部  | **Valkey**（Redis 协议兼容队列/缓存） | **8**（镜像 `valkey/valkey:8`）    |
| 外部  | **Elasticsearch**           | **8.11.3**                     |
| 容器  | Docker Engine + Compose V2  | 建议 24+ / Compose v2            |


说明：

- 与 MIS 主栈 **独立网络/卷**；`mis-kb` 经内网访问 RAGFlow HTTP（生产端口按 `.env`，默认引擎侧 **9380→80**）。
- API Key、强密码仅 Secret / `.env`（不进 Git）；`mis-kb` 的 `base-url` / `api-key` 由 Nacos / 环境变量注入。

### 2.4 S4 — `ai-data`（10.254.26.36）数据底座


| 类别  | 软件 / 组件                    | 版本（钉扎）                                                                                                |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| 外部  | **PostgreSQL**             | **16**（镜像 `postgres:16-alpine`）                                                                       |
| 外部  | **Redis**                  | **7.2**（镜像 `redis:7.2-alpine`）                                                                        |
| 外部  | **Nacos Server**           | **2.x 自建 JDK17**（推荐 `mis-nacos:2.3.2-jdk17` + PG 插件 **0.0.3**；若 Server 改 2.5.x 则插件用 **0.0.5**）。官方 `nacos-server:v2.x` Docker 仍是 Java 8；**勿用插件 0.0.7**（仅 Nacos 3.x） |
| 外部  | **MinIO**（MIS 对象存储）        | `RELEASE.2024-04-18T19-09-19Z`                                                                        |
| 外部  | **Qdrant**                 | **v1.9.0**（镜像 `qdrant/qdrant:v1.9.0`）                                                                 |
| 容器  | Docker Engine + Compose V2 | 建议 24+ / Compose v2                                                                                   |


#### PostgreSQL 部署（S4 · 最先安装）

**作用：** MIS 业务库、Nacos 元数据库、Agent 库的统一数据底座。正式环境 **先起 PG**，再建库，再装 Redis / Nacos 等。

| 项 | 约定 |
|----|------|
| 主机 | **S4**（`10.254.26.36`） |
| 镜像 | **`postgres:16-alpine`**（禁止 `latest`） |
| 端口 | **5432**（仅内网；对 S1/S2/本机 Nacos 放行） |
| 超级用户 | 容器环境变量 `POSTGRES_USER` / `POSTGRES_PASSWORD`（生产用强密码） |
| 持久化 | 绑定挂载 → 容器内 `/var/lib/postgresql/data` |

```bash
# 在 S4 上执行：先 pull，再 run
# Docker Hub 超时/失败时，改用华为云同步（再 tag 成本地名）：
docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/postgres:16-alpine
docker tag swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/postgres:16-alpine postgres:16-alpine
# 若 Hub 可达也可：docker pull postgres:16-alpine

sudo mkdir -p /data/mis-pg-data
docker run -d --name mis-postgres --restart unless-stopped \
  -p 5432:5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD='postgres#1014' \
  -v /data/mis-pg-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

验收：

```bash
docker exec -it mis-postgres pg_isready -U postgres
# 期望：accepting connections
```

**库与用途（建库后）：**

| 库名 | 用户（示例） | 用途 | 初始化脚本 |
|------|--------------|------|------------|
| `mis_platform` | `mis` | MIS 业务（含 iqd_* 等） | `deploy/postgres/init/01-init-db.sql` |
| `nacos` | `nacos` | Nacos 配置/服务发现元数据 | `02-init-nacos-db.sql` + `03-nacos-schema.sql` |
| `ai_platform` | `aiplatform` | Agent 运行时库 | `02-create-ai-platform.sql`（及用户脚本若有） |

首次建库（脚本内示例密码生产务必改掉，并与 Nacos `application.properties` / 应用配置一致）：

```bash
# 将仓库 deploy/postgres/init 拷到 S4 后：
docker exec -i mis-postgres psql -U postgres < 01-init-db.sql
docker exec -i mis-postgres psql -U postgres < 02-init-nacos-db.sql
docker exec -i mis-postgres psql -U postgres < 03-nacos-schema.sql
docker exec -i mis-postgres psql -U postgres < 02-create-ai-platform.sql
```

业务表再用 `mis-migrator` Flyway（连 `mis` / `mis_platform`）；细节见 [远端基础设施手册 §3.1](remote-infra-local-dev.md)。

#### Redis 部署（S4）


| 项    | 约定                                                                                  |
| ---- | ----------------------------------------------------------------------------------- |
| 主机   | **仅 S4**（`10.254.26.36`），与 PG/Nacos 同机                                              |
| 镜像   | `**redis:7.2-alpine**`（禁止 `latest`）                                                 |
| 端口   | **6379**（仅内网；对 S1/S2 放行，不对公网）                                                       |
| 实例数  | **一套共享实例**（MIS 与 Agent 共用，靠 DB 号隔离）                                                 |
| 逻辑库  | MIS / `mis-gateway` → **DB 0**；ai-platform backend / gateway → **DB 2**（键前缀 `aip:`） |
| 密码   | **生产必须** `requirepass`；经环境变量 / Secret 注入，**不进 Git**                                 |
| 持久化  | 建议开启 AOF（或 RDB+AOF）；数据卷独立挂载并纳入备份                                                    |
| 非本组件 | S3 RAGFlow 内的 **Valkey** 是引擎私有队列，**不是** 本 Redis，勿混用                                 |


示例（S4 上 Docker，密码自行替换）：

```bash
docker run -d --name mis-redis --restart unless-stopped \
  -p 6379:6379 \
  -v /data/mis-redis-data:/data \
  redis:7.2-alpine \
  redis-server --appendonly yes --requirepass 'mis#redis1014'
```

验收：`redis-cli -a '<强密码>' ping` → `PONG`。

应用侧配置：

- Java：`deploy/nacos-config/prod/mis-common.yaml` → `spring.data.redis.host/port`（`REDIS_HOST=10.254.26.36`），密码用 `${REDIS_PASSWORD}` 注入；`database: 0`。
- Agent：`REDIS_HOST` / `REDIS_URL=redis://:<密码>@10.254.26.36:6379/2`（必须带 `**/2**`）。

#### MinIO 部署（S4 · MIS 对象存储）

**作用：** S3 兼容对象存储，给平台存**文件/附件等二进制对象**（管理台与业务上传）。与 S3 主机上 RAGFlow 自带的 MinIO **不是同一套**，勿混用、勿共用卷。

> **镜像拉取说明（2026）：** Docker Hub 上的 `minio/minio` 已不可用；`quay.io/minio/minio` **匿名拉取会 401 UNAUTHORIZED**（仓库归档/关闭公开拉取），**不是**本机账号问题，`docker login` 也解决不了。  
> 生产推荐：用**已缓存的同版本镜像**（华为云 SWR），或改用可匿名拉取的兼容镜像（如 `pgsty/silo`，需单独评估）。

| 项 | 约定 |
|----|------|
| 主机 | **S4**（`10.254.26.36`） |
| 镜像版本 | **`RELEASE.2024-04-18T19-09-19Z`**（与仓库 `deploy/docker-compose.dev.yml` 钉扎一致） |
| 推荐拉取地址 | `swr.cn-north-4.myhuaweicloud.com/ddn-k8s/quay.io/minio/minio:RELEASE.2024-04-18T19-09-19Z` |
| 端口 | API **9000**；控制台 **9001**（仅内网） |
| 账号 | AccessKey / SecretKey 走 Secret，**不进 Git** |
| 持久化 | 绑定挂载宿主机目录 → 容器内 `/data` |

```bash
# 1) 从华为云同步拉取（同 tag，可匿名）
docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/quay.io/minio/minio:RELEASE.2024-04-18T19-09-19Z

# 2) 打本地别名，便于与文档/脚本中的镜像名一致（可选）
docker tag \
  swr.cn-north-4.myhuaweicloud.com/ddn-k8s/quay.io/minio/minio:RELEASE.2024-04-18T19-09-19Z \
  mis-minio:RELEASE.2024-04-18T19-09-19Z

# 3) 启动
sudo mkdir -p /data/mis-minio-data
docker run -d --name mis-minio --restart unless-stopped \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER='root' \
  -e MINIO_ROOT_PASSWORD='mis#minio1014' \
  -v /data/mis-minio-data:/data \
  mis-minio:RELEASE.2024-04-18T19-09-19Z \
  server /data --console-address ":9001"
```

华为云也失败时的备选（兼容 S3 / 环境变量，**需自行验证**后再上生产）：

```bash
# 示例：Silo（MinIO 兼容分叉，Docker Hub 可匿名拉取；tag 以当时可用为准）
# docker pull pgsty/silo:RELEASE.2024-04-18T19-09-19Z   # 若无此 tag，改查 https://hub.docker.com/r/pgsty/silo/tags
```

或在有外网的机器拉好 / 从内网 Harbor 导入后：`docker save` → 拷到 S4 → `docker load`。

验收：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://10.254.26.36:9000/minio/health/live
# 期望 200；控制台 http://10.254.26.36:9001 （内网）
```

上线后在控制台或 `mc` 创建业务 Bucket，把 Endpoint / AccessKey / SecretKey / Bucket 注入应用配置（Nacos 或环境变量）。

#### Qdrant 部署（S4 · 向量库）

**作用：** Agent 侧**向量检索库**，存技能索引、Agent 路由、动态记忆等向量（配合 **S1 Embedding** `bge-small-zh-v1.5`，维度 **512**）。知识库文档检索走 S3 **RAGFlow/ES**，不走本 Qdrant。

| 项 | 约定 |
|----|------|
| 主机 | **S4**（`10.254.26.36`） |
| 镜像 | **`qdrant/qdrant:v1.9.0`** |
| 端口 | HTTP **6333**；gRPC **6334**（仅对 S1 放行） |
| 持久化 | 命名卷 → 容器内 `/qdrant/storage` |
| 集合 | 初始化脚本创建 `skills_index` / `agent_router_index` / `agent_memory_index`（Cosine，512 维） |

```bash
docker run -d --name ai-platform-qdrant --restart unless-stopped \
  -p 6333:6333 -p 6334:6334 \
  -e QDRANT__SERVICE__HTTP_PORT=6333 \
  -e QDRANT__SERVICE__GRPC_PORT=6334 \
  -e QDRANT__LOG_LEVEL=INFO \
  -v /data/ai-platform-qdrant_data:/qdrant/storage \
  qdrant/qdrant:v1.9.0
```

集合初始化（在能访问 S4:6333 的机器上执行，需 bash/curl/python3）：

```bash
# 仓库内脚本
bash agent/ai-platform/infra/init-qdrant.sh http://10.254.26.36:6333
```

验收：

```bash
curl -sS http://10.254.26.36:6333/readyz
# 期望 ok / 200
```

Agent 配置：`QDRANT_HOST=10.254.26.36`、`QDRANT_PORT=6333`（生产如启用 API Key，同步设置 `QDRANT_API_KEY`）。

#### Nacos 部署（S4 · 配置中心 + 服务发现）

**作用：** 正式环境配置权威源与微服务注册发现；业务进程 `MIS_REMOTE=true` 后从 Nacos 拉配置、做 `lb://` 发现。  
**存储：** 生产 **必须外置 PostgreSQL**（库 `nacos`），**禁止**用内嵌模式当生产基线。

> **结论：** 官方 `nacos/nacos-server:v2.x` Docker 仍是 **Java 8**。外置 PG 用自建 **`eclipse-temurin:17` + 官方 zip + 与 Server 对齐的 pig4cloud 插件**。  
> **插件必须对齐（错版本会 `ConfigInfoGrayMapper`）：** Server **2.3.2 → 插件 0.0.3**；**2.5.x → 0.0.5**；**0.0.7 仅 Nacos 3.x，禁止与 2.3.2 混用。**

| 项 | 约定 |
|----|------|
| 主机 | **S4** |
| **服务器落盘目录** | **`/data/mis-nacos`** |
| 镜像 | **自建** `mis-nacos:2.3.2-jdk17`（可改 `NACOS_VERSION=2.5.4`） |
| 官方镜像 | 不推荐外置 PG |
| PG 插件 | **2.3.2 → `0.0.3`**（+ `postgresql-42.7.3.jar`）；2.5.x → `0.0.5` |
| 业务客户端 | SCA **2023.0.1.0** → `nacos-client` **2.3.x**；Server 留 **2.x** |
| 端口 | **8848** / **9848** |

以下为自建 JDK17 + 外置 PG（推荐）。

##### 目录规划（`/data/mis-nacos`）

```text
/data/mis-nacos/
├── Dockerfile
├── docker-entrypoint.sh
├── plugins/
│   ├── nacos-datasource-plugin-pg-0.0.3.jar   # 2.3.2（旧 artifact 名）；2.5.x 则为 …-postgresql-0.0.5.jar
│   └── postgresql-42.7.3.jar
├── server/application.properties      # 模板
├── conf/application-pg.properties     # 生产 JDBC（run 挂载）
├── scripts/ensure-nacos-pg-plugins.sh
└── logs/
```

```bash
sudo mkdir -p /data/mis-nacos/{plugins,server,conf,scripts,logs}
# scp 仓库 deploy/nacos/{Dockerfile,docker-entrypoint.sh} → /data/mis-nacos/
# scp deploy/nacos/server/application.properties → /data/mis-nacos/server/
# scp scripts/ensure-nacos-pg-plugins.sh → /data/mis-nacos/scripts/
sudo chmod +x /data/mis-nacos/scripts/ensure-nacos-pg-plugins.sh /data/mis-nacos/docker-entrypoint.sh
```

##### 步骤 0 — 预置官方 zip（**不要在 build 时 curl GitHub**）

Dockerfile 已改为 `COPY nacos-server-*.zip`。任选一种方式把包放到 `/data/mis-nacos/`：

```bash
# 方式 A：能访问 GitHub 的机器下载后 scp 到 S4
#   https://github.com/alibaba/nacos/releases/download/2.3.2/nacos-server-2.3.2.zip
#   scp nacos-server-2.3.2.zip root@10.254.26.36:/data/mis-nacos/

# 方式 B：服务器经 GitHub 加速代理（代理域名若失效可换 ghproxy.net / mirror.ghproxy.com 等）
cd /data/mis-nacos
curl -fL --retry 3 -o nacos-server-2.3.2.zip \
  "https://ghfast.top/https://github.com/alibaba/nacos/releases/download/2.3.2/nacos-server-2.3.2.zip"
ls -lh nacos-server-2.3.2.zip   # 大约 180MB+，过小说明下坏了
```

换 2.5.4 时文件名改为 `nacos-server-2.5.4.zip`，build 加 `--build-arg NACOS_VERSION=2.5.4`。

##### 步骤 1 — PostgreSQL 库表

- `02-init-nacos-db.sql`、`03-nacos-schema.sql`（密码与 conf 一致）

##### 步骤 2 — 插件（**2.3.2 → `nacos-datasource-plugin-pg-0.0.3.jar`**；勿用 0.0.7）

```bash
docker rm -f mis-nacos 2>/dev/null || true
rm -f /data/mis-nacos/plugins/nacos-datasource-plugin-postgresql-*.jar \
      /data/mis-nacos/plugins/nacos-datasource-plugin-pg-*.jar
bash /data/mis-nacos/scripts/ensure-nacos-pg-plugins.sh /data/mis-nacos/plugins 2.3.2
# 应看到 nacos-datasource-plugin-pg-0.0.3.jar（Maven 上 ≤0.0.4 用旧 artifact 名）
ls -la /data/mis-nacos/plugins/
```

##### 步骤 3 — 构建 JDK17 镜像

```bash
# 预拉基础镜像（Hub 超时用国内同步，见 §1.1）
docker pull eclipse-temurin:17-jre-jammy

# zip 与 Dockerfile、plugins/ 必须在同一构建上下文目录
ls /data/mis-nacos/nacos-server-2.3.2.zip /data/mis-nacos/Dockerfile /data/mis-nacos/plugins/

cd /data/mis-nacos
docker build -f /data/mis-nacos/Dockerfile -t mis-nacos:2.3.2-jdk17 /data/mis-nacos
```

##### 步骤 4 — 配置并启动

```bash
cp /data/mis-nacos/server/application.properties /data/mis-nacos/conf/application-pg.properties
# 编辑 db.url.0 / db.user.0 / db.password.0（postgres 主机名或 10.254.26.36）
vi /data/mis-nacos/conf/application-pg.properties


# 2. 生成密钥（保存好，重启要复用同一套）
export NACOS_AUTH_TOKEN="$(openssl rand -base64 32)"
export NACOS_AUTH_IDENTITY_VALUE="$(openssl rand -hex 16)"
mkdir -p /data/mis-nacos/conf
umask 077
printf '%s\n' "$NACOS_AUTH_TOKEN" > /data/mis-nacos/conf/.nacos-auth-token
printf '%s\n' "$NACOS_AUTH_IDENTITY_VALUE" > /data/mis-nacos/conf/.nacos-auth-identity
echo "TOKEN=$NACOS_AUTH_TOKEN"
echo "IDENT=$NACOS_AUTH_IDENTITY_VALUE"
# 3. 带 token 启动（其余参数按你现网补全）
docker run -d --name mis-nacos --restart unless-stopped \
  -p 8848:8848 -p 9848:9848 \
  -e MODE=standalone \
  -e SPRING_DATASOURCE_PLATFORM=postgresql \
  -e NACOS_AUTH_ENABLE=true \
  -e NACOS_AUTH_TOKEN \
  -e NACOS_AUTH_IDENTITY_KEY=serverIdentity \
  -e NACOS_AUTH_IDENTITY_VALUE \
  -e JVM_XMS=1024m -e JVM_XMX=1024m \
  -v /data/mis-nacos/plugins:/home/nacos/plugins:ro \
  -v /data/mis-nacos/conf/application-pg.properties:/home/nacos/conf/application-pg.properties:ro \
  -v /data/mis-nacos/logs:/home/nacos/logs \
  mis-nacos:2.3.2-jdk17

> **鉴权**：`NACOS_AUTH_ENABLE=true` 时必须带 `NACOS_AUTH_TOKEN`（entrypoint 会 `-D` 注入；缺则启动前直接 exit）。不改镜像时，也可把同名项写进挂载的 `application-pg.properties`。  
> 自建镜像已在 **build 时 COPY plugins/**，一般**不必**再 `-v plugins`；改插件 / entrypoint 后需 **重新 build** 镜像。  
> 自定义 JDBC 靠挂载 `application-pg.properties`。

##### 步骤 5 — 验收与推送 `prod`

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" http://10.254.26.36:8848/nacos/
docker logs mis-nacos --tail 80
```

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace prod -NacosServer "http://10.254.26.36:8848"
.\scripts\nacos-push.ps1 -Namespace prod -NacosServer "http://10.254.26.36:8848"
```

防火墙：对 S1/S2 放行 `8848`、`9848`。

### 2.5 S5 — `ai-sql`（10.254.26.37）问数 WrenAI


| 类别    | 软件 / 组件                           | 版本（钉扎）                                                                             |
| ----- | --------------------------------- | ---------------------------------------------------------------------------------- |
| 运行时   | **Python**                        | **3.11+**（`wrenai` 要求；建议 3.11）                                                     |
| 外部    | **WrenAI CLI（PyPI** `wrenai`**）** | `0.13.3`（`pip install 'wrenai[mcp,...]==0.13.3'`；以 `wren --version` 验收）            |
| 自研    | **WrenMcpAgent**                  | 仓库 `agent/ai-platform/deploy/wrenai/wren-mcp-agent/`；systemd 常驻                    |
| （勿混装） | 经典 Wren Docker 栈标签                | GitHub 项目标签 **0.29.2**（`wren-ui` + `wren-ai-service`）与 MCP 新线 **不兼容**，生产 **不要** 安装 |


说明：

- `wren serve mcp` 绑 `127.0.0.1`；对 S1 仅开放 WrenMcpAgent **9100**（控制面）/ **9101**（数据面），并做源 IP 白名单 + bearer。
- 项目持久目录示例：`/var/lib/mis-iqd/wren-projects`。  
- 细节 Runbook：[WrenAI 运营手册](../ai-fusion/wrenai/wrenai-ops-runbook.md)、[WrenMcpAgent 部署](../ai-fusion/wrenai/wren-mcp-agent-deploy.md)。

### 2.6 版本一览（外部组件速查）


| 组件                           | 版本                           | 部署主机                   |
| ---------------------------- | ---------------------------- | ---------------------- |
| Docker Engine + Compose V2   | Engine **24+** / Compose **v2** | S4/S3 必须；S1/S2 建议   |
| JDK / JRE                    | 17                           | S1（业务）、S2（mis-gateway） |
| Python（Agent）                | ≥3.12                        | S1                     |
| Python（Wren）                 | ≥3.11                        | S5                     |
| Node.js（ai-platform-gateway） | 22                           | S2                     |
| Nginx                        | 1.25.x                       | S2                     |
| Squid 出站代理                 | 自建镜像（:3128）                 | S2                     |
| PostgreSQL                   | 16                           | S4                     |
| Redis                        | 7.2                          | S4                     |
| Nacos Server                 | 2.3.2（mis-nacos JDK17）         | S4                     |
| MinIO（MIS）                   | quay.io … `RELEASE.2024-04-18T19-09-19Z` | S4            |
| Qdrant                       | v1.9.0                       | S4                     |
| Embedding 模型                 | BAAI/bge-small-zh-v1.5       | S1                     |
| RAGFlow                      | v0.26.4                      | S3                     |
| MySQL（RAGFlow）               | 8.0.39                       | S3                     |
| MinIO（RAGFlow）               | RELEASE.2023-12-20T01-00-02Z | S3                     |
| Valkey                       | 8                            | S3                     |
| Elasticsearch                | 8.11.3                       | S3                     |
| WrenAI（`wrenai`）             | 0.13.3                       | S5                     |


---

## 3. 关键端口与内网放行


| 源 → 目的             | 端口                                             | 用途                                  |
| ------------------ | ---------------------------------------------- | ----------------------------------- |
| 用户 → S2            | 80 / 443                                       | Nginx 入口                            |
| Nginx → 本机         | mis-gateway / ai-platform-gateway（如 8080、3100） | 双入口分流                               |
| S2 → S4            | 8848, 9848, 6379（按需）                           | Nacos 注册发现；网关侧缓存等                   |
| S2 → S1            | 各业务服务端口 + ai-platform backend                  | `lb://` / 通路 B 回源                   |
| S1 → S2            | **3128**                                       | Agent → Squid 出站代理                  |
| S1 → S4            | 5432, 6379, 8848, 9848, 9000, 6333             | PG / Redis / Nacos / MinIO / Qdrant |
| S1 → S3            | 9380（或生产映射端口）                                  | RAGFlow API                         |
| S1 → S5            | 9100, 9101                                     | WrenMcpAgent 控制面 / 数据面              |
| S1 → Embedding（本机） | 8001                                           | 向量化                                 |
| S4 Nacos → S4 PG   | 5432                                           | Nacos 外置库                           |
| 运维跳板 → 各机          | SSH + 各控制台（限制源 IP）                             | 运维                                  |


生产防火墙默认 **拒绝** 将 S3/S4/S5 管理口对公网开放。

---

## 4. 部署顺序（Day-1）

0. **各机安装 Docker**（§1.1）：至少 S4、S3；建议 S1、S2；验收 `docker` / `docker compose`。
1. **S4 数据底座**：PostgreSQL → 建库建用户 → Redis / MinIO / Qdrant → Nacos（外置 PG）→ 推送 `prod` 配置。
2. **S3 RAGFlow**：按 `deploy/ragflow` 生成 `.env`（强密码）→ `docker compose up` → 取得 API Key。
3. **S5 WrenAI**：Python 3.11 venv → `wrenai==0.13.3` → WrenMcpAgent systemd → 防火墙白名单 S1。
4. **S1 后端**：挂载 JWT 私钥 → 执行 `mis-migrator` → 启动领域微服务与 Agent / **Embedding**（出站→S2:3128）。
5. **S2 双入口 + 出站**：挂载 JWT 公钥 → 启动 `mis-gateway` + `ai-platform-gateway` + **Squid** → 部署静态资源与 Nginx → 验收 HTTPS / Cookie Secure。

库初始化脚本参考：[远端基础设施手册](remote-infra-local-dev.md)（将 `<INFRA_HOST>` 换为 `10.254.26.36`）。

---

## 5. 配置与密钥

### 5.1 Nacos `prod` 配置


| Data ID                                                                | 要点                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `mis-common`                                                           | 生产 DB/Redis 指向 S4；JWT 公钥路径                                   |
| `mis-gateway`                                                          | `lb://` 路由                                                   |
| `mis-auth`                                                             | `captcha-enabled: true`、`cookie.secure: true`                |
| `mis-iam` / `mis-org` / `mis-audit` / `mis-admin-bff` / `mis-system` 等 | 各域业务配置                                                       |
| `mis-kb`                                                               | `engine.type=ragflow`，`base-url` / `api-key` **运维注入**，不进 Git |
| `mis-iqd`                                                              | 端口 `8109`；`ddl-auto=validate`；DB/Redis 走 `mis-common`          |


源目录：`deploy/nacos-config/prod/`。

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace prod -NacosServer "http://10.254.26.36:8848"
.\scripts\nacos-push.ps1 -Namespace prod -NacosServer "http://10.254.26.36:8848"
```

### 5.2 敏感信息


| 类型                                         | 做法                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| JWT 私钥 / 公钥                                | **私钥**挂 S1（`mis-auth`）；**公钥**挂 S2（`mis-gateway`）及 S1 需验签的服务；**禁止**写入 Git 与 Nacos 明文 |
| DB / Redis / MinIO / RAGFlow / Wren bearer | 环境变量或 Secret；Nacos 仅占位 + 注入                                                         |
| Nacos 控制台账号                                | 禁用默认 `nacos/nacos`，使用独立强口令                                                          |


---

## 6. 构建与发版

```powershell
cd backend
.\mvn.ps1 package -pl mis-gateway,mis-auth,mis-iam,mis-org,mis-audit,mis-admin-bff,mis-system,mis-taskflow,mis-kb,mis-iqd -am -DskipTests -Pprod

# 示例：打业务镜像（仅含 JAR）
docker build -f deploy/docker/Dockerfile.service `
  --build-arg MODULE=mis-gateway `
  -t registry.example.com/mis-gateway:${GIT_SHA} `
  backend/mis-gateway
```

- 业务镜像 **不含** `deploy/nacos-config`。  
- 前端在 CI 构建后同步静态文件至 S2。  
- Agent / Embedding / WrenMcpAgent 按各目录 Dockerfile 或 systemd 单元发布。

### 滚动更新建议顺序

1. 推送 Nacos（若有变更）
2. `mis-migrator` 迁移业务库
3. S1 领域服务（audit / auth / iam / org / system / taskflow / kb / iqd / bff）与 Agent backend
4. S2：`mis-gateway` → `ai-platform-gateway` → Nginx（入口最后切换）

---

## 7. 启动验证


| 检查项           | 预期                                                              |
| ------------- | --------------------------------------------------------------- |
| Nacos（S4）服务列表 | `mis-gateway`、`mis-auth`、`mis-audit`、`mis-kb`、`mis-iqd` 等实例健康   |
| 门户（S2）        | HTTPS 可打开管理端；Cookie `Secure`                                    |
| 登录            | 验证码开启；审计有登录日志                                                   |
| 知识库           | `mis-kb` 健康；RAGFlow（S3）可达；建库/检索 PoC 通过                          |
| 问数            | WrenMcpAgent health；`wren --version` ≈ 0.13.3；平台侧 enable MCP 成功 |
| 数据面           | PG / Redis / Qdrant / MinIO 健康检查通过                              |


```bash
# 经门户或内网 Gateway
curl -sS https://<门户域名>/actuator/health
```

---

## 8. 回滚


| 层级             | 操作                                               |
| -------------- | ------------------------------------------------ |
| 应用             | 回滚 S1 领域服务 / Agent；回滚 S2 的两个 Gateway、Nginx 与静态资源 |
| 配置             | Nacos 控制台回退对应 Data ID 历史版本                       |
| 数据库            | **禁止** Flyway downgrade；使用补偿 migration           |
| RAGFlow / Wren | 按钉扎版本回滚镜像或 pip 包；先备份卷/项目目录                       |


---

## 9. 监控与运维要点

- Nacos 控制台：配置历史、实例上下线（`mis-gateway` 实例应在 **S2**）。  
- S2：Nginx / 双 Gateway 可用性与 TLS；SSE 路径勿缓冲。  
- S3：关注 ES 堆内存与磁盘；解析任务积压。  
- S4：定期备份 `mis_platform`、`nacos`、`ai_platform` 及 MinIO / Qdrant 卷。  
- S5：WrenMcpAgent 日志与子进程存活；勿对终端用户暴露 9100/9101。  
- 应用日志：Nacos 连接超时、审计写入失败、RAGFlow/MCP 调用失败。

---

## 10. 关联文档


| 文档                                                              | 用途                  |
| --------------------------------------------------------------- | ------------------- |
| [运维总览](README.md)                                               | 环境一览与命令入口           |
| [Agent Backend 部署](ai-platform-backend-deploy.md)                 | S1 ai-platform Backend `:8000` |
| [配置管理策略](configuration.md)                                      | Nacos 数据流与 Data ID  |
| [测试环境部署](test-deploy.md)                                        | 同机制、命名空间 `test`     |
| [远端基础设施 + 本机代码](remote-infra-local-dev.md)                      | 中间件初始化细节            |
| [RAGFlow 部署](../../deploy/ragflow/README.md)                    | S3 引擎安装与验收          |
| [WrenAI 对接部署](../ai-fusion/wrenai/deploy-iqd.md)                | 问数版本钉位              |
| [WrenAI 运营 Runbook](../ai-fusion/wrenai/wrenai-ops-runbook.md)  | S5 Day-1 / 联调       |
| [WrenMcpAgent 部署](../ai-fusion/wrenai/wren-mcp-agent-deploy.md) | 9100/9101 与 systemd |
| [知识库设计](../backend/knowledge-base.md)                           | mis-kb ↔ RAGFlow    |


---

## 附录 · K8s 形态（可选）

若生产改为 Kubernetes，仍使用同一套 `deploy/nacos-config/prod/` 与镜像规则；Deployment 示例环境变量：

```yaml
env:
  - name: MIS_REMOTE
    value: "true"
  - name: NACOS_NAMESPACE
    value: prod
  - name: NACOS_SERVER
    value: nacos.prod.svc:8848   # 或指向 S4 内网地址
  - name: JWT_PUBLIC_KEY_PATH
    value: /usr/local/app/keys/public.pem
```

JWT 用 Secret 挂载（裸机约定目录 **`/usr/local/app/keys/`**）；有状态组件（PG/Redis/Nacos/RAGFlow/Wren）可继续落在本手册 S3–S5 专用机，或迁入集群存储类——须单独容量与备份方案，不改变本文软件版本钉扎。