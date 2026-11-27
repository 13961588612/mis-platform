# mis-admin-web（管理台前端）部署

> 组件：`frontend/mis-admin-web`（Vite + React 静态产物）  
> 正式环境主机：**S2** `10.254.26.34`  
> 托管：本机 **Nginx**；API 反代到 `mis-gateway:8080` / `ai-platform-gateway:3100`

相关：[prod-deploy.md](prod-deploy.md) §2.2；Nginx 模板 `deploy/nginx/mis-admin-web.conf`。

---

## 1. 职责与依赖

| 项 | 说明 |
|----|------|
| 产物 | `dist/`（`index.html` + `embed.html` 双入口） |
| 浏览器请求 | 相对路径 `/api/**`、`/ws`（无独立 API 域名时） |
| 上游 | `mis-gateway`（业务 REST）、`ai-platform-gateway`（events/messages/ws） |

前置（S2 已就绪）：

1. `mis-gateway` `:8080` 健康  
2. `ai-platform-gateway` `:3100` 健康（若不用对话可暂缓，但 `/api/events` 会失败）  
3. Nginx 1.25.x（或发行版 nginx）

---

## 2. 构建（构建机 Node 20+）

```bash
cd frontend/mis-admin-web
cp .env.production.example .env.production
# 编辑 VITE_PARENT_ORIGINS=实际可嵌入父域（管理台同域可填生产站点 origin）

npm ci
npm run build
# 产物：dist/
```

Windows：

```powershell
cd d:\code\mis-platform\frontend\mis-admin-web
copy .env.production.example .env.production
# 编辑后
npm ci
npm run build
```

---

## 3. 同步到 S2

```bash
sudo mkdir -p /usr/local/app/mis-admin-web
# 将 dist/ 整目录 rsync/scp 到：
#   /usr/local/app/mis-admin-web/dist/
rsync -avz --delete dist/ root@10.254.26.34:/usr/local/app/mis-admin-web/dist/
```

---

## 4. 安装 Nginx 配置

```bash
# RHEL 系示例
sudo dnf -y install nginx    # 或已装 1.25.x
sudo cp deploy/nginx/mis-admin-web.conf /etc/nginx/conf.d/mis-admin-web.conf
# 改 server_name；HTTPS 按 §4.1（443 转本机 80），不要把 80 改成强制 301
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

分流规则（与本地 `vite.config.ts` proxy 对齐）：

| 路径 | 上游 |
|------|------|
| `/api/events`、`/api/messages`、`/ws` | `127.0.0.1:3100` |
| `/api/`（含 `/api/v1/**`） | `127.0.0.1:8080` |
| `/embed` | `embed.html` |
| 其它 | SPA `index.html` |

---

## 4.1 HTTPS（定稿：443 转到本机 80）

业务 location **只写在 80**。443 只卸 TLS，再 `proxy_pass` 到 `http://127.0.0.1:80`。**80 继续对外提供 HTTP，不做 301 跳 https。**

```text
浏览器 https://IP或域名:443 → Nginx(443, ssl) → 127.0.0.1:80 → 静态 / 双网关
浏览器 http://IP或域名:80  → Nginx(80) 同一套 location
```

| 项 | 约定 |
|----|------|
| 证书 | 内网 IP 证书或域名证书，放到 `/etc/nginx/ssl/`（路径与 conf 一致） |
| 443 server | 见 `deploy/nginx/mis-admin-web.conf` 文末注释块；解开后 `nginx -t && reload` |
| `X-Forwarded-Proto` | 443→80 必须设 `https`；80 侧用 `$forwarded_proto`（有头用头，否则 `$scheme`），否则 Cookie Secure / 登录 Refresh 会丢 |
| WebSocket | 443→80 须透传 `Upgrade` / `Connection` |
| 防火墙 | 放行 **TCP 443**（11-10 曾因只开 80、外网打 443 超时） |
| 不采用 | 把全部 location 抄到 443，且 80 一律 `return 301 https://$host$request_uri`。防火墙未放 443 时页面会转圈 |

上线步骤（S2）：

```bash
sudo mkdir -p /etc/nginx/ssl
# 放入 server.crt / server.key（或 fullchain.pem / privkey.pem，与 conf 路径对齐）
# 解开 mis-admin-web.conf 末尾「443 → 80」server 块
sudo nginx -t && sudo systemctl reload nginx

# 本机
curl -vk --max-time 5 https://127.0.0.1/nginx-health
# 外网不通时先查：ss -lntp | grep 443；firewall-cmd --list-all
```

前面若已有 **LB/WAF 终结 TLS**、回源 S2 只走 80：S2 **不必**听 443，保持现 80 配置即可。

---

## 5. 验收

```bash
curl -fsS http://127.0.0.1/nginx-health
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1/
curl -fsS http://127.0.0.1:8080/actuator/health    # mis-gateway
curl -fsS http://127.0.0.1:3100/health              # agent gateway

# 浏览器打开 http://10.254.26.34/（HTTP 仍应可开）
# HTTPS：https://10.254.26.34/ 或域名；登录 Cookie 在 https 下应为 Secure
```

---

## 6. 发版更新静态

```bash
# 构建机重新 npm run build 后
rsync -avz --delete dist/ root@10.254.26.34:/usr/local/app/mis-admin-web/dist/
# 一般无需 reload nginx；强缓存资源带 hash，HTML 建议勿长期 cache
```

---

## 7. 常见问题

| 现象 | 排查 |
|------|------|
| 页面 200 但接口 502 | `mis-gateway` / `ai-platform-gateway` 是否监听；nginx error.log |
| 登录后 Refresh 丢 | HTTPS / Cookie Secure；443→80 是否传 `X-Forwarded-Proto https` |
| `http://` 301 后一直转圈 | 80 被改成跳 https，但防火墙未放 443；应恢复 80 业务、只加 443 转 80 |
| `https://` 超时 | 本机 `curl -vk https://127.0.0.1`；通则放行 TCP 443 |
| 对话 WS 失败 | `/ws` 是否指到 3100；`GATEWAY_HOST=0.0.0.0` |
| 嵌入空白 / postMessage 拒 | 构建时 `VITE_PARENT_ORIGINS`；nginx `frame-ancestors` |

---

## 8. 路径一览

| 路径 | 用途 |
|------|------|
| `frontend/mis-admin-web/` | 源码 |
| `frontend/mis-admin-web/.env.production.example` | 构建环境变量模板 |
| `deploy/nginx/mis-admin-web.conf` | S2 Nginx |
| `deploy/nginx/edge.conf` | 仅 Agent 通路 B 参考（无管理台静态） |
