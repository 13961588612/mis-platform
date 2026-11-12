# 外部 Ticket SSO 入站（URL + ticket → MIS 登录）

> 状态：🚧 开发中（致远适配已开工，见 [`seeyon-a8-ticket-sso.md`](seeyon-a8-ticket-sso.md)）  
> 关联：[`embed-copilot.md`](embed-copilot.md)、[`seeyon-a8-ticket-sso.md`](seeyon-a8-ticket-sso.md)（致远 A8）、[`03-permission-design.md`](../ai-fusion/a2ui/03-permission-design.md) §5  
> 目标读者：Product / Architect / Backend / 外部对接方

外部系统**只配置一个 URL**，打开时带 `ticket`；由 **MIS 后端**拿 ticket 向外部验票、取用户信息，再映射本地账号并登录。  
**不替代**现有 D12 `POST /api/v1/embed/identity/exchange`（宿主自签 `externalToken`）；本方案是第二种入站模式。

---

## 1. 与标准 embed 的差异

| 维度 | 标准模式（已可联调） | Ticket SSO（本方案） |
|------|----------------------|----------------------|
| 外部前端 | 需嵌 iframe + `postMessage` 注 token | **可不开发**：只配 URL / 打开链接 |
| 外部后端 | 签 `externalToken` + 调 MIS exchange | **须提供验票接口**（MIS 回调） |
| 身份证明方向 | 外部 **推** 签名令牌给 MIS | MIS **拉** 外部验票结果 |
| 密钥位置 | 外部持有 `client_secret` 签 JWT | MIS 持有调外部验票的出站凭证 |
| iframe 鉴权 | 父页 `AUTH_TOKEN` | embed **同源**兑换，可不依赖 postMessage |
| 令牌续期 | 父页重新 exchange | 见 §6（ticket 通常一次性） |

---

## 2. 端到端流程

```
外部系统（已登录用户）
  │ 生成一次性 ticket
  │ 打开 / 嵌套：
  │   {MIS_WEB}/embed/{hostId}/chat?ticket={ticket}
  ▼
MIS embed 页（同源）
  │ POST /api/v1/embed/identity/ticket-exchange
  │   { hostId, ticket }     ← 浏览器不持有出站密钥
  ▼
mis-admin-bff
  │ ① 查 agent_external_host（active + ticket 模式已启用）
  │ ② 服务端调外部「验票 / 取用户」接口（出站凭证）
  │ ③ 得到 externalUserId / phone（可选）
  │ ④ 复用 D12 三级映射 → misUserId
  │ ⑤ 签发短时 RS256 MIS JWT（TTL 与 D12 一致，默认 30min）
  │ ⑥ ticket 标记已消费（防重放；以外部作废为准 + MIS 侧短时去重）
  ▼
embed 页持有 misJwt → WS/SSE Bearer → Gateway（agentId=mis-copilot）
  │ ask-context 富化（与标准 embed 相同）
  ▼
对话 / A2UI（写操作：无宿主事件桥时见 §7）
```

要点：

| 步骤 | 谁做 | 说明 |
|------|------|------|
| 发 ticket | **外部** | 绑定当前外部会话用户；建议短 TTL + 一次性 |
| 验票 | **MIS → 外部** | 服务端出站；浏览器永不直连外部验票密钥 |
| 映射 / 发 JWT | **MIS BFF** | 与 D12 同一套映射与签发 |
| 使用 JWT | **MIS embed 页** | 同源拿到 `misJwt`，无需父页注入 |

---

## 3. 外部系统最小职责

### 3.1 必须提供

1. **打开地址配置**（示例）：

```text
https://mis.example.com/embed/crm-portal/chat?ticket={ticket}
```

| 参数 | 说明 |
|------|------|
| 路径 `{hostId}` | 已在 MIS 注册的宿主 ID（与 `agent_external_host.host_id` 一致）；推荐放路径，避免部分 OA 不支持配置 URL 自带 `?` |
| `ticket` | 外部签发的一次性票据（query）；**不要**把长期 token / 密码放进 URL |

兼容旧链：`/embed/chat?hostId={hostId}&ticket={ticket}` 仍可读。

2. **验票接口**（供 MIS 服务端调用），契约见 §4。

### 3.2 建议提供

- ticket TTL（如 60–300 秒）与一次性消费语义  
- 与外部登录会话绑定（未登录用户不得发 ticket）  
- 可选：验票响应中带 `phone`（便于手机号映射）；无则依赖显式映射表  

### 3.3 不需要提供（相对标准 embed）

- 调 MIS `identity/exchange`  
- 自签 HS256 `externalToken`  
- 父页 `postMessage` / `AUTH_TOKEN` / `AUTH_TOKEN_REQUEST`  
- （可选）A2UI 写操作事件桥——若仅对话/问数，可暂不接；见 §7  

---

## 4. 外部验票接口（待对接方确认）

> 以下为 **MIS 建议契约**；字段名可按外部现网适配，由宿主配置映射。  
> **联调前必须书面确认**：URL、Method、鉴权方式、成功/失败体、ticket 是否一次性。

### 4.1 建议：`POST {ticketValidateUrl}`

**请求（MIS → 外部）**

```http
POST /api/sso/ticket/validate HTTP/1.1
Host: external.example.com
Content-Type: application/json
Authorization: Bearer <MIS_OUTBOUND_CREDENTIAL>
```

```json
{
  "ticket": "tkt_...",
  "appId": "crm-portal"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `ticket` | 是 | URL 上的 ticket |
| `appId` | 否 | 建议等于 MIS `hostId`，便于外部区分接入方 |

**成功响应（建议）**

```json
{
  "code": 0,
  "data": {
    "externalUserId": "ext-001",
    "username": "zhangsan",
    "phone": "13800138000",
    "displayName": "张三",
    "expiresAt": "2026-10-21T06:30:00Z"
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `externalUserId` | **是** | 外部稳定用户主键；映射键 |
| `phone` | 否 | 规范化手机号；参与 D12 手机号匹配 |
| `username` / `displayName` | 否 | 审计 / 展示 |
| `expiresAt` | 否 | 信息性；消费以外部验票结果为准 |

**失败**

| 场景 | 建议 HTTP / 业务码 | MIS 行为 |
|------|-------------------|----------|
| ticket 无效 / 过期 / 已用 | 401 或业务非 0 | `40102 EMBED_TICKET_INVALID` |
| 外部不可用 | 5xx / 超时 | `50301 EMBED_TICKET_UPSTREAM`（fail-closed，不发 JWT） |

### 4.2 出站鉴权方式（宿主配置择一）

| 方式 | 配置项（概念） | 说明 |
|------|----------------|------|
| Bearer / API Key | `outbound_token`（仅配置中心/密钥仓） | 最常见 |
| Basic | `outbound_basic_user` + `secret` | 兼容老系统 |
| mTLS | 客户端证书 | 高安全环境 |

密钥**只存 MIS 侧**（Nacos / 环境变量），不进浏览器、不进 git。

### 4.3 适配器

BFF 按 `hostId` 选择 `TicketValidateAdapter`（默认 JSON 契约；可插个别宿主的字段映射），避免每个外部改核心编排。

---

## 5. MIS 侧 API

### 5.1 `POST /api/v1/embed/identity/ticket-exchange`

供 **MIS embed 同源页**调用（浏览器可调；**无** `client_secret`）。

**请求**

```json
{
  "hostId": "crm-portal",
  "ticket": "tkt_..."
}
```

**成功响应（与 D12 exchange 对齐）**

```json
{
  "code": 0,
  "data": {
    "misJwt": "eyJ...",
    "expiresIn": 1800,
    "mappedUserId": "1",
    "mappedBy": "explicit|phone|shadow",
    "permissions": ["agent:chat:use"]
  }
}
```

**错误码**

| code | 含义 |
|------|------|
| `40102` | `EMBED_TICKET_INVALID`：验票失败 / 过期 / 已用 / host 未启用 ticket 模式 |
| `40301` | 映射未命中 / 手机号歧义或未命中 / 用户不可用（与 D12 同语义） |
| `40303` | 权限源或 JWT 签发不可用 |
| `50301` | `EMBED_TICKET_UPSTREAM`：外部验票超时或 5xx |

### 5.2 映射（复用 D12，不另起一套）

顺序不变：

1. `agent_external_identity`（hostId + externalUserId）  
2. 手机号（正常账号恰 1 条；歧义/0 条 → 40301，**不**降级影子）  
3. 影子账号 `shadow_mis_user_id`  

安全红线相对 D12 的调整：

| 红线 | Ticket 模式落点 |
|------|-----------------|
| R1（身份可信） | **出站验票成功** =「合法外部系统确认了该用户」；禁止仅凭 URL 上的 phone/userId 签发 |
| R2–R5 | 不变：手机号只做匹配键；日志脱敏；歧义 fail-closed |
| R6 | 按 hostId 限流 + 审计（hostId + externalUserId + mappedBy + ticket 指纹，不落明文 ticket） |

### 5.3 宿主注册扩展（概念字段）

在现有 `agent_external_host` 上扩展（实现期 Flyway **追加**列或旁路配置表）：

| 字段 / 配置 | 说明 |
|-------------|------|
| `auth_mode` | `push_token`（现 D12）/ `ticket_pull` / `both` |
| `ticket_validate_url` | 外部验票 URL |
| `ticket_outbound_secret_ref` | 出站凭证引用（不落明文到业务库为佳） |
| 既有 `client_secret_hash` 等 | D12 推模式仍用；纯 ticket 宿主可保留占位或仅用于管理面 |

白名单三处对齐仍适用：`VITE_PARENT_ORIGINS` / nginx `frame-ancestors` / `allowed_origins`（若完全无父页 postMessage，父域仍须允许 iframe 嵌套）。

---

## 6. 令牌续期

- ticket **默认一次性**，不能像标准模式那样「父页再 exchange」。  
- MIS JWT TTL 仍建议 **30 分钟**。  
- 续期策略（择一，实现前拍板）：

| 方案 | 做法 | 适用 |
|------|------|------|
| **A. 短会话重开**（推荐一期） | JWT 过期后 embed 提示「请从业务系统重新打开」；用户再带新 ticket 进入 | 外部零前端开发 |
| **B. MIS 侧 refresh** | 兑换时另发 refresh（HttpOnly / 同源），临期静默续 access | 体验更好；需防盗用设计 |
| **C. 回退标准模式** | 外部补最小父页，临期走 D12 exchange | 外部愿意加一点前端时 |

一期建议 **A**，与「外部只配 URL」目标一致。

---

## 7. 写操作（A2UI）

标准 embed 默认 `writeMode=bridge`：写事件交给宿主父页。

Ticket 模式常**没有**可响应的父页逻辑：

| 策略 | 说明 |
|------|------|
| 一期 | 仅开放对话 / 问数等读路径；写组件无权限或占位 |
| 二期 | `writeMode=direct`（CORS + MIS 业务 API，不推荐首接） |
| 或 | 外部补最小父页只处理 `A2UI_EVENT`（仍可不做 AUTH_*） |

---

## 8. embed 页行为（前端）

```
加载 /embed/{hostId}/chat?ticket=
  ├─ 有 ticket → 调 ticket-exchange → 存 misJwt → 清 URL 中 ticket（replaceState，防泄漏到 Referer/历史）
  ├─ 无 ticket 且无 token → 若在 iframe 内则走现有 AUTH_READY / postMessage（标准模式）
  └─ 两者皆无 → 错误态「缺少登录凭证」
```

安全注意：

- URL 中的 ticket 尽量短命；兑换成功后立即从地址栏移除  
- 日志 / 监控禁止打印完整 ticket  
- 同源兑换接口须限流，防 ticket 撞库  

---

## 9. 验收清单

- [ ] 外部仅配置 URL + 生成 ticket，无需 postMessage 即可对话  
- [ ] 伪造 / 过期 / 已用 ticket → 40102，不发 JWT  
- [ ] 验票成功但无映射 → 40301（不区分提示）  
- [ ] 外部验票超时 → 50301，fail-closed  
- [ ] 成功后 URL 不再残留 ticket  
- [ ] 出站凭证仅在 MIS 服务端；浏览器网络面板无该密钥  
- [ ] 问数权限与同 MIS 用户在管理台一致  
- [ ] JWT 过期后有明确「请从业务系统重新打开」态（一期方案 A）  

---

## 10. 待外部确认清单（阻塞实现）

请对接方书面回复：

1. 验票 URL、Method、Content-Type  
2. 出站鉴权方式（Bearer / Basic / 其他）及联调账号  
3. 成功响应字段：稳定用户 ID 字段名、是否有手机号、编码格式  
4. ticket TTL、是否一次性、是否可跨域重复提交  
5. 嵌入方式：iframe 嵌套还是整页跳转  
6. 是否需要 A2UI 写操作（决定是否要最小父页事件桥）  

确认后：补 Flyway / BFF 端点 / embed 页 ticket 分支 / 联调种子 host，并回写本文状态为「可联调」。

---

## 11. 非目标

- 不替换 D12 `identity/exchange`（两种模式可并存于不同 host）  
- 不把 ticket 当长期会话凭证  
- 不在浏览器持有外部验票密钥  
- 不单独凭 URL 参数中的手机号 / userId 登录（必须验票）  
