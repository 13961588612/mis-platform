# ai-platform Gateway（Agent Gateway）安装与部署

> 组件：`agent/ai-platform/gateway`（Node/TS Fastify，端口 **3100**）  
> 正式环境主机：**S2** `10.254.26.34`  
> 配置方式：**本机 `.env` / systemd EnvironmentFile**（**不**走 Nacos）

相关：Backend 见 [ai-platform-backend-deploy.md](ai-platform-backend-deploy.md)；五机总览见 [prod-deploy.md](prod-deploy.md)。

---

## 1. 职责与依赖

| 项 | 说明 |
|----|------|
| 职责 | 通路 B REST/WS、JWT（MIS RS256 + 自有 HS256）、限流、企微适配、回源 Agent Core |
| 健康检查 | `GET http://127.0.0.1:3100/health` |
| 调用方 | Nginx / 管理台嵌入 / 企微 |

| 依赖 | 主机 | 说明 |
|------|------|------|
| Redis DB **2** | S4 | `REDIS_URL=redis://:<密码>@10.254.26.36:6379/2` |
| Agent Core `:8000` | S1 | `AGENT_CORE_API_URL` |
| JWT 公钥 | S2 本机 | `MIS_JWT_PUBLIC_KEY_PATH`（与 mis-gateway 共用） |
| mis-admin-bff `:8081` | S1 | 可选权限回源 `BFF_INTERNAL_URL` |

---

## 2. 前置

1. S2 已装 **Node.js 22**（`node -v`）。
2. S4 Redis 已开 AUTH；S1 Backend 已起。
3. `/usr/local/app/keys/public.pem` 已就位。

### 安装 Node 22

**RHEL / Rocky / Alma（S2 常见）** — 官方二进制（不依赖 NodeSource）：

```bash
cd /tmp
curl -fsSL -o node-v22.14.0-linux-x64.tar.xz \
  https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz
# 国内慢可换镜像，例如：
# https://npmmirror.com/mirrors/node/v22.14.0/node-v22.14.0-linux-x64.tar.xz

sudo mkdir -p /usr/local/lib/nodejs
sudo tar -xJf node-v22.14.0-linux-x64.tar.xz -C /usr/local/lib/nodejs
sudo ln -sfn /usr/local/lib/nodejs/node-v22.14.0-linux-x64 /usr/local/lib/nodejs/current
sudo ln -sfn /usr/local/lib/nodejs/current/bin/node /usr/local/bin/node
sudo ln -sfn /usr/local/lib/nodejs/current/bin/npm /usr/local/bin/npm
sudo ln -sfn /usr/local/lib/nodejs/current/bin/npx /usr/local/bin/npx

node -v   # v22.x
npm -v
```

**Ubuntu / Debian**（NodeSource）：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

---

## 3. 目录约定

```text
/usr/local/app/ai-platform-gateway/
└── agent/ai-platform/
    └── gateway/
        ├── .env                 # 生产环境变量（勿提交）
        ├── package.json
        ├── dist/                # npm run build 产物
        └── node_modules/
```

也可整仓 rsync 后只把 WorkingDirectory 指到 `.../gateway`。

---

## 4. 落盘与构建

```bash
# 将仓库 agent/ai-platform/gateway（及 .npmrc）同步到 S2 上路径
cd /usr/local/app/ai-platform-gateway/agent/ai-platform/gateway
cp /path/to/deploy/env/prod/ai-platform-gateway.env.example .env
chmod 600 .env
# 编辑 .env：REDIS_URL / JWT_SECRET / AGENT_CORE_API_URL / GATEWAY_INTERNAL_TOKEN 等

npm ci
npm run build
# 验收：test -f dist/index.js
```

**必改变量摘要：**

| 变量 | 生产值 |
|------|--------|
| `GATEWAY_PORT` | **3100**（勿用默认 8080） |
| `REDIS_URL` | `redis://:<密码>@10.254.26.36:6379/2` |
| `AGENT_CORE_API_URL` | `http://10.254.26.33:8000` |
| `JWT_SECRET` | 强随机 |
| `MIS_JWT_PUBLIC_KEY_PATH` | `/usr/local/app/keys/public.pem` |
| `GATEWAY_INTERNAL_TOKEN` | 与 S1 Backend `.env` **同值** |

完整模板：`deploy/env/prod/ai-platform-gateway.env.example`。

---

## 5. 先前台试跑

```bash
cd /usr/local/app/ai-platform-gateway/agent/ai-platform/gateway
set -a && source ./.env && set +a
node dist/index.js
# 另窗：
curl -fsS http://127.0.0.1:3100/health
```

Ctrl+C 后改 systemd。

---

## 6. systemd

```bash
sudo cp /path/to/mis-platform/agent/ai-platform/infra/ai-platform-gateway.service \
  /etc/systemd/system/
# 确认 node 路径（官方二进制一般为 /usr/local/bin/node）：
which node
# unit 内 ExecStart 须与 which node 一致；若用发行版包则可能是 /usr/bin/node
sudo systemctl daemon-reload
sudo systemctl enable --now ai-platform-gateway
sudo systemctl status ai-platform-gateway
journalctl -u ai-platform-gateway -f
```

---

## 7. 验收

```bash
curl -fsS http://127.0.0.1:3100/health
# S1 Backend 日志无异常拒绝；可选经 Nginx 反代再测 /api、/ws
```

---

## 8. 常见问题

| 现象 | 排查 |
|------|------|
| 端口冲突 / 起不来 | `GATEWAY_PORT` 是否为 **3100**（默认代码里是 8080） |
| WS 连上无回复 | `REDIS_URL` 是否带 **`/2`**；密码是否正确 |
| Bot 不热加载 | `GATEWAY_INTERNAL_TOKEN` 是否与 Backend 一致 |
| MIS JWT 拒签 | `MIS_JWT_PUBLIC_KEY_PATH` 与 `mis-auth` 公钥是否同一把 |

---

## 9. 源码与模板

| 路径 | 用途 |
|------|------|
| `agent/ai-platform/gateway/` | 源码 |
| `agent/ai-platform/gateway/.env.example` | 本地联调模板 |
| `deploy/env/prod/ai-platform-gateway.env.example` | 生产模板 |
| `agent/ai-platform/infra/Dockerfile.gateway` | 容器构建 |
| `agent/ai-platform/infra/ai-platform-gateway.service` | systemd |
| `deploy/nginx/edge.conf` | Nginx 反代参考（通路 B） |
