# 致远 OA A8 → MIS Copilot（Ticket SSO）

> 状态：🚧 开发中（BFF ticket-exchange + embed 页 ticket 分支已落地；待 OA 联调）  
> 通用方案：[`embed-ticket-sso.md`](embed-ticket-sso.md)  
> 标准 iframe 兑换：[`embed-copilot.md`](embed-copilot.md)  
> 官方参考：  
> - [CIP 单点登录 / 门户认证](https://open.seeyoncloud.com/v5devCIP/250/257/259.html)  
> - [REST 验证服务](http://open.seeyon.com/book/ctp/restjie-kou/gai-shu.html)  
> - [按登录名取人员](https://open.seeyon.com/content/ch15s06.html) / [人员属性 `telNumber`](https://open.seeyon.com/content/ch15s06s01s02.html)

致远侧**几乎零代码**：在集成平台配置「PC/H5 登录地址」指向 MIS embed URL（**hostId 放在路径**，避免地址栏里先写 `?hostId=`），由 OA 再拼 `?ticket=` / `&ticket=`。  
MIS 侧按 ticket 验票 → REST 取手机号 → **按手机号映射本地账号** → 签发 MIS JWT。

---

## 1. 端到端（致远专用）

```
致远 OA（用户已登录）
  │ 门户认证：打开配置的第三方地址
  │   {MIS_WEB}/embed/seeyon-a8/chat?ticket={ticket}
  ▼
MIS embed 页
  │ POST /api/v1/embed/identity/ticket-exchange { hostId, ticket }
  ▼
mis-admin-bff（SeeyonTicketAdapter）
  │ ① GET  {OA}/seeyon/thirdpartyController.do?ticket=…
  │         ← 响应头 LoginName / MemberId / MemberName
  │ ② POST {OA}/seeyon/rest/token
  │         Body: { "userName":"<REST用户>", "password":"<REST密码>" }
  │         ← { "id": "<restToken>" }
  │ ③ GET  {OA}/seeyon/rest/orgMember?loginName={LoginName}
  │         Header: token: <restToken>
  │         ← telNumber（手机号）等
  │ ④ 三级映射（一期主路径：手机号 =1 命中 MIS 用户）
  │ ⑤ 签发短时 RS256 MIS JWT
  ▼
embed 对话 / A2UI（写操作是否桥接见 §6）
```

> **注意（门户握手）**：CIP 文档另有「OA 服务端先调第三方 SSO 接口，第三方回 `SSOOK`」步骤。若联调时 OA 先打 MIS 落地页以外的「SSO 握手 URL」，需另开极简握手端点回明文 `SSOOK`；浏览器带 ticket 进 embed 的路径仍走上图。高版本 ticket **一次性**，验票后即失效。

---

## 2. 致远接口契约（已对齐公开文档）

### 2.1 验票 → 用户名

```http
GET /seeyon/thirdpartyController.do?ticket=-6331871886887794391
```

| 项 | 说明 |
|----|------|
| 返回位置 | **HTTP 响应头**（非 Body） |
| `LoginName` | 协同登录名；若配置了用户映射则为映射后的第三方登录名 |
| `MemberId` / `MemberName` | 未做映射时返回；映射后可能不返回 |
| 消费语义 | 高版本 ticket 唯一且认证后失效，不可重复验 |

MIS 侧将 `LoginName`（优先）或 `MemberId` 记为 `externalUserId`。

### 2.2 REST Token（出站鉴权）

```http
POST /seeyon/rest/token
Content-Type: application/json

{"userName":"rest","password":"******"}
```

成功：`{"id":"<token>"}`；失败：`{"id":"-1"}`。  
后续 REST 在 Header 带 `token: <id>`（或 query `?token=`）。Token 约 **15 分钟**空闲失效，BFF 应缓存并在 401 时重取。

> **出站鉴权 = 谁有权代表 MIS 去调致远 REST**。这里就是管理员在 OA「信息集成 → REST 用户管理」创建的 REST 账号 + 密码（及可选 IP 绑定）。密钥只存在 MIS 配置中心，不进浏览器。

### 2.3 按登录名取人员 → 手机号

```http
GET /seeyon/rest/orgMember?loginName={LoginName}
token: <restToken>
```

人员对象关键字段（[属性说明](https://open.seeyon.com/content/ch15s06s01s02.html)）：

| 字段 | 用途 |
|------|------|
| `loginName` | 与验票 LoginName 对齐 |
| `id` | OA 人员 ID（可作 externalUserId 备选） |
| `telNumber` | **手机号码** → MIS 手机号映射 |
| `name` / `enabled` / `isValid` | 审计 / 可用性校验 |

无手机号或停用人员 → fail-closed（40301），不发 JWT。

### 2.4 本地登录（映射）

一期：**仅手机号**（正常状态 MIS 账号恰 1 条 → 登录；0 / >1 → 40301）。  
可选后续：`agent_external_identity` 显式映射 `hostId + loginName|memberId → misUserId`；影子账号按产品决定是否启用。

---

## 3. 致远侧配置（零/少开发）

| 配置项 | 建议值 |
|--------|--------|
| 认证模式 | 门户认证机制 |
| PC/H5 登录地址 | `https://mis.example.com/embed/seeyon-a8/chat`（OA 自动拼 `?ticket=`；hostId 在路径） |
| REST 用户 | 启用并授权 `orgMember` 读资源；记下账号密码给 MIS |
| 人员手机号 | OA 通讯录 `telNumber` 须与 MIS 用户手机号一致且唯一 |

MIS 侧注册 `hostId=seeyon-a8`，配置 OA baseUrl、REST 凭证、可选租户 `tenant_id`。

### 3.1 MIS 环境变量 / Nacos（已实现）

```yaml
mis:
  embed:
    ticket-hosts:
      seeyon-a8:
        provider: seeyon
        base-url: ${MIS_EMBED_SEEYON_BASE_URL:}
        rest-username: ${MIS_EMBED_SEEYON_REST_USER:}
        rest-password: ${MIS_EMBED_SEEYON_REST_PASSWORD:}
```

| 环境变量 | 说明 |
|----------|------|
| `MIS_EMBED_SEEYON_BASE_URL` | OA 根地址，如 `http://oa:80` |
| `MIS_EMBED_SEEYON_REST_USER` | REST 用户名 |
| `MIS_EMBED_SEEYON_REST_PASSWORD` | REST 密码 |
| `MIS_EMBED_PHONE_HASH_SALT` | 手机号 hash 盐（与 D12 共用） |

API：`POST /api/v1/embed/identity/ticket-exchange`（embed 同源，已豁免 JWT 拦截）。

排查日志关键字：`embed ticket-exchange`、`seeyon handshake`、`seeyon rest/token`、`seeyon orgMember`（含 `ticketFp=`，无明文 ticket）。

---

## 4. A2UI 写操作：要 vs 不要

| | **不要写操作（一期推荐）** | **要写操作** |
|--|---------------------------|--------------|
| 能力 | 对话、问数、展示类 A2UI（只读卡片） | 审批通过/驳回、表单提交等写事件 |
| 致远侧 | 只配打开 URL | 还要有能处理写结果的父页或 MIS 直连业务 API |
| 技术 | embed 自持 JWT 即可 | 标准模式：父页收 `A2UI_EVENT` → 调业务 → `A2UI_EVENT_RESULT`；或 `writeMode=direct`（CORS，不推荐首接） |
| 安全 | 写权限码不授予 / 组件占位 | 须明确写落到 OA 还是 MIS 业务服务 |

**结论**：致远「只嵌 Copilot 聊天」→ **不要**写操作即可上线；若要在 Copilot 里点「同意审批」且落到 OA/MIS 业务，再补写操作桥。

---

## 5. 程序 / 项目拆分

| # | 项目 / 目录 | 开发内容 | 一期是否必须 |
|---|-------------|----------|--------------|
| 1 | **`backend/mis-admin-bff`** | `POST /api/v1/embed/identity/ticket-exchange`；`SeeyonTicketAdapter`（验票头解析 + rest/token + orgMember）；凭证配置；限流审计；复用 `EmbedIdentityService` 手机号映射与 JWT 签发；权限白名单登记 | **必须** |
| 2 | **`backend/mis-migrator`** | Flyway：宿主种子 `seeyon-a8`、`auth_mode=ticket_pull` 相关列/配置（若扩表）；`sys_api` 登记 ticket-exchange（若需） | **必须** |
| 3 | **`frontend/mis-admin-web`** | `/embed/chat` 读 `ticket` → 调 ticket-exchange → 存 `misJwt` → `history.replaceState` 去掉 ticket；无 ticket 时仍走现有 postMessage | **必须** |
| 4 | **`deploy/` / Nacos** | `mis.embed.seeyon.base-url`、REST 用户密码、`VITE_PARENT_ORIGINS`、nginx `frame-ancestors` 含致远域 | **必须（OPS）** |
| 5 | **致远 OA** | 集成平台配第三方地址 + REST 用户授权；**无业务代码**（除非要 SSOOK 握手专用页） | 配置即可 |
| 6 | **`agent/ai-platform`** | 一般**不改**（仍用现有 Bearer JWT + mis-copilot） | 否 |
| 7 | **Gateway / mis-iam** | 一般不改；手机号查用户走 BFF 已有 IAM 客户端 | 否（除非映射 API 不足） |
| 8 | **写操作扩展（可选）** | 前端事件桥或业务 API；可能涉及 `mis-admin-web` 宿主页或 OA 自定义页 | 仅「要 A2UI 写」时 |

---

## 6. 验收清单（致远）

- [ ] OA 打开配置地址后 URL 带 `ticket`，MIS 能对话  
- [ ] 验票响应头无 `LoginName` → 40102  
- [ ] REST 账号错误 / orgMember 无 `telNumber` → 不发 JWT  
- [ ] MIS 侧该手机号 0 或多账号 → 40301  
- [ ] 恰 1 个正常账号 → 权限与管理台该用户一致  
- [ ] 兑换成功后地址栏无 ticket  
- [ ] REST 密码仅在 BFF/Nacos，浏览器不可见  
- [ ]（可选）写操作：审批事件能闭环  

---

## 7. 联调前向致远/运维确认

1. OA 外网/内网 baseUrl（BFF 能否访问）  
2. REST 用户名密码、是否勾选「获取 Token 校验 IP」（若勾选须把 BFF 出口 IP 配进绑定）  
3. `orgMember` 资源是否已授权给该 REST 用户  
4. 是否启用用户映射（影响头里是否还有 MemberId）  
5. 门户是否会先打「SSO 握手 URL」要 `SSOOK`（要则补握手端点）  
6. 一期是否只要聊天/问数（默认不要 A2UI 写）  

---

## 8. 编译 · 部署 · 联调（逐步执行）

> 角色：DEV 编译发版 + OPS 配环境 + 致远管理员配门户。  
> 目标：从 OA 点开链接 → MIS embed 对话成功。一期不要 A2UI 写操作。

### 8.0 联调前信息表（填空后再动环境）

| # | 项 | 示例 | 谁提供 |
|---|----|------|--------|
| A | OA 根地址（BFF 能访问） | `http://10.x.x.x:80` | 致远/网络 |
| B | REST 用户名 / 密码 | `rest` / `***` | 致远管理员 |
| C | REST 是否校验绑定 IP | 是 → 填 BFF 出口 IP | 致远 |
| D | MIS Web 对外地址 | `https://mis.example.com` | OPS |
| E | 致远浏览器 Origin | `http://oa.example.com` | 致远 |
| F | 联调账号（OA 登录名 + 手机号） | 张三 / `138****` | 双方 |
| G | MIS 同手机号用户 | 管理台已存在且唯一正常 | MIS 运维 |

---

### 8.1 数据准备（MIS）

**步骤 1 — 跑迁移（含 `seeyon-a8` 宿主种子 V153）**

```powershell
cd d:\code\mis-platform\backend
$env:JAVA_HOME = $env:JAVA_HOME_17
.\mvn.ps1 -pl mis-migrator flyway:migrate
```

**步骤 2 — 确认宿主行**

```sql
SELECT host_id, status, tenant_id, allowed_origins, shadow_mis_user_id
FROM agent_external_host
WHERE host_id = 'seeyon-a8';
-- 期望：status=active，tenant_id=联调租户（种子默认 1）
```

**步骤 3 — 改 `allowed_origins`（iframe 嵌 OA 时必改）**

把致远域写进 JSON（与下面前端 `VITE_PARENT_ORIGINS`、nginx `frame-ancestors` **三处一致**）：

```sql
UPDATE agent_external_host
SET allowed_origins = '["https://oa.example.com","http://oa.example.com"]'::json
WHERE host_id = 'seeyon-a8';
```

**步骤 4 — 手机号对齐**

- OA：该用户通讯录 `telNumber` 有值  
- MIS：同租户下该手机号 **恰好 1 个正常状态账号**（0 或多条都会 40301）  
- 管理台登录该 MIS 用户，确认有 `agent:chat:use`（或问数所需权限）

---

### 8.2 致远 OA 配置

**步骤 5 — 建 REST 用户**

1. 系统管理员 → 信息集成 → REST 用户管理 → 新建并启用  
2. 授权资源：至少 **人员 / orgMember 读**  
3. 若勾选「获取 Token 校验 IP」→ 绑定 **mis-admin-bff 出口 IP**  
4. 把用户名密码交给 MIS（填 §8.0 B）

**步骤 6 — 门户第三方接入**

1. 认证模式：**门户认证机制**  
2. PC / H5 登录地址（OA 会自动拼 `&ticket=`）：

```text
https://mis.example.com/embed/seeyon-a8/chat
```

本地联调可先用（见 §8.5 冒烟，可不配门户）：

```text
http://localhost:5173/embed/seeyon-a8/chat
```

3. 保存后，用联调账号登录 OA，确认菜单/门户能打开该链接  

---

### 8.3 编译（构建机）

**步骤 7 — 后端（至少 BFF；迁移已在 8.1）**

```powershell
cd d:\code\mis-platform\backend
$env:JAVA_HOME = $env:JAVA_HOME_17
.\mvn.ps1 package -pl mis-admin-bff -am -DskipTests
# 产物：mis-admin-bff/target/*.jar
```

测试/生产按现网清单一并打依赖服务（gateway / auth / iam 等），参见 [`docs/devops/prod-deploy.md`](../devops/prod-deploy.md)。

**步骤 8 — 前端（必须带致远 Origin）**

```powershell
cd d:\code\mis-platform\frontend\mis-admin-web
# 编辑 .env.production（或联调 .env）：
# VITE_PARENT_ORIGINS=https://oa.example.com,http://oa.example.com
pnpm i
pnpm build
# 产物：dist/（含 index.html + embed.html）
```

本地热更联调可跳过 build，用 `pnpm dev`（见 §8.5）。

---

### 8.4 部署与配置（MIS 运行时）

**步骤 9 — 配置 BFF 出站（Nacos `mis-admin-bff` 或进程环境变量）**

```yaml
mis:
  embed:
    ticket-hosts:
      seeyon-a8:
        provider: seeyon
        base-url: http://10.x.x.x        # §8.0 A，不要尾斜杠
        rest-username: rest              # §8.0 B
        rest-password: '***'
    phone-match-enabled: true
  security:
    jwt:
      private-key-path: /path/to/private.pem   # 必须能签发 RS256
```

或环境变量：

```text
MIS_EMBED_SEEYON_BASE_URL=http://10.x.x.x
MIS_EMBED_SEEYON_REST_USER=rest
MIS_EMBED_SEEYON_REST_PASSWORD=***
MIS_JWT_PRIVATE_KEY_PATH=...
```

**步骤 10 — 发布 BFF 并确认健康**

- 重启 / 滚动 `mis-admin-bff`  
- `GET .../actuator/health` 正常  
- 日志能搜到配置加载（启动后任意一次 ticket 请求会打 `embed ticket-exchange`）

**步骤 11 — 发布前端静态 + Nginx**

1. 同步 `dist/` 到 Web 主机（见 [`mis-admin-web-deploy.md`](../devops/mis-admin-web-deploy.md)）  
2. 确认 `/embed` → `embed.html`  
3. CSP `frame-ancestors` **加上致远域**（`deploy/nginx/mis-admin-web.conf` 或 edge）：

```nginx
add_header Content-Security-Policy "frame-ancestors 'self' https://oa.example.com http://oa.example.com" always;
```

4. `nginx -t && reload`  
5. 浏览器打开：`https://mis.example.com/embed/seeyon-a8/chat`（无 ticket 时应为等待/失败态，**不应**跳 MIS `/login`）

**步骤 12 — 网络连通（在 BFF 机器上测）**

```powershell
# 能打开 OA
curl -I "http://10.x.x.x/seeyon/"
# REST token（成功 id 不是 -1）
curl -s -X POST "http://10.x.x.x/seeyon/rest/token" `
  -H "Content-Type: application/json" `
  -d "{\"userName\":\"rest\",\"password\":\"***\"}"
```

---

### 8.5 联调冒烟（建议顺序）

**步骤 13 — 仅验 REST + 手机号（不经 embed）**

在 BFF 机能访问 OA 的前提下：

1. `POST /seeyon/rest/token` → 拿 `id`  
2. `GET /seeyon/rest/orgMember?loginName={联调登录名}` + Header `token: {id}` → 看 `telNumber`  
3. 用该手机号在 MIS 管理台确认用户存在且唯一  

**步骤 14 — 手工 ticket 验票头（可选）**

用 OA 生成一次真实 ticket（从门户打开后 URL 里抄，或抓包），在 BFF 机：

```powershell
curl -s -D - -o NUL "http://10.x.x.x/seeyon/thirdpartyController.do?ticket=从OA复制"
# 响应头应有 LoginName（或 MemberId）
```

注意：高版本 ticket **一次性**，验过后即失效，不要用同一 ticket 再测 embed。

**步骤 15 — 调 BFF ticket-exchange（绕过前端）**

换**新** ticket 后：

```powershell
curl -s -X POST "https://mis.example.com/api/v1/embed/identity/ticket-exchange" `
  -H "Content-Type: application/json" `
  -d "{\"hostId\":\"seeyon-a8\",\"ticket\":\"新ticket\"}"
```

| 期望 | 含义 |
|------|------|
| `code=0` + `misJwt` + `mappedBy=phone` | 映射成功 |
| `40102` | 验票失败 / host 未配 / REST 失败 |
| `40301` | 验票成功但手机号未映射或歧义 |
| `50301` | OA 不可达 / 超时 |

BFF 日志关键字：`embed ticket-exchange`、`seeyon handshake`、`seeyon rest/token`、`seeyon orgMember`（看 `ticketFp=`）。

**步骤 16 — 浏览器整链**

1. OA 登录联调账号 → 打开第三方入口  
2. 应进入 `.../embed/seeyon-a8/chat?ticket=...`  
3. 页内短暂「正在通过 ticket 登录」→ 可发对话  
4. 地址栏 **ticket 被清掉**（hostId 仍在路径）  
5. F12 Network：`ticket-exchange` 成功；**无**跳转 `/login`  
6. Console：`[EmbedTicket] exchange ok`

本地 DEV 整链（门户未配时）：

```text
1. 起 DB + Redis + 必要 Java 服务 + pnpm dev（5173）
2. 设好 MIS_EMBED_SEEYON_* 与 JWT 私钥
3. 从 OA 抄一个新 ticket，浏览器打开：
   http://localhost:5173/embed/seeyon-a8/chat?ticket=新ticket
```

**步骤 17 — 对话上游（若能登录但不能聊）**

确认 `mis-gateway`、`ai-platform-gateway`（`/api/events`、`/api/messages`、`/ws`）健康；JWT 公钥与 BFF 签发一致。

---

### 8.6 失败对照表

| 现象 | 先查 |
|------|------|
| iframe 空白 / 被拒嵌 | nginx `frame-ancestors`、OA 是否 https 混合内容 |
| 一直「等待宿主」且无 ticket | 门户地址是否带上；是否被中间页剥参 |
| `ticket_host_not_configured` / 40102 | `MIS_EMBED_SEEYON_*` 是否注入到 **正在跑的** BFF |
| handshake 无 LoginName | ticket 已用过 / 过期；换新 ticket |
| rest/token `id=-1` | REST 账号密码或 IP 绑定 |
| orgMember 无 telNumber | OA 通讯录手机号为空 |
| 40301 | MIS 手机号 0 条或多条；`tenant_id` 是否对 |
| 能兑换不能对话 | Gateway / agent JWT 公钥；浏览器 Network 401 |
| 跳到 MIS 登录页 | 是否误用管后 axios；embed 应走 fetch ticket-exchange |

---

### 8.7 验收勾选（联调签字用）

- [ ] §8.0 信息表填齐  
- [ ] V153 已迁；`seeyon-a8` active；origins 含致远域  
- [ ] OA REST + 门户地址已配  
- [ ] BFF 环境变量 / JWT 私钥已配并重启  
- [ ] 前端构建含正确 `VITE_PARENT_ORIGINS`；nginx frame-ancestors 已加  
- [ ] 步骤 15 `ticket-exchange` 返回 `misJwt`  
- [ ] 步骤 16 OA 打开可对话；URL 无残留 ticket；不进 MIS `/login`  
- [ ] 日志可按 `ticketFp` 串起 handshake → token → orgMember → mappedBy  
