# 外部系统 iframe 嵌入 Copilot

> 状态：✅ 可联调（D14 `/embed/chat` + D12 身份兑换）  
> 权威架构：[docs/ai-fusion/a2ui/01-architecture.md](../ai-fusion/a2ui/01-architecture.md)  
> 示例宿主页：`frontend/mis-admin-web/public/embed-host-demo.html`

外部系统通过 **iframe** 嵌入 MIS Copilot（对话 + A2UI）。管理后台 Copilot Sheet **不是**对外出口。

---

## 1. 端到端流程

```
宿主后端 ──POST /api/v1/embed/identity/exchange──► mis-admin-bff
                                                      │ 验签 externalToken
                                                      │ 三级映射 → MIS userId
                                                      │ 签发短时 RS256 MIS JWT
                                                      ▼
宿主前端 ◄── misJwt / permissions / mappedBy ─────────┘
   │
   │ iframe src = {MIS_WEB}/embed/chat?hostId={hostId}
   │
   ▼
embed 页 ──AUTH_READY──► 宿主
宿主 ──AUTH_TOKEN + PAGE_CONTEXT──► embed
embed ──WS/SSE Bearer misJwt──► Gateway（agentId=mis-copilot）
   │                              └─ ask-context 富化（roles 不塞 JWT）
写操作 ──A2UI_EVENT──► 宿主业务 API ──A2UI_EVENT_RESULT──► embed
临期 ──AUTH_TOKEN_REQUEST──► 宿主重新 exchange ──AUTH_TOKEN──► embed
```

要点：

| 步骤 | 谁做 | 说明 |
|------|------|------|
| 兑换 JWT | **宿主后端** | 密钥不出浏览器；前端只拿短时 `misJwt` |
| 注入令牌 | **宿主前端** | `postMessage` `AUTH_TOKEN`（白名单 origin） |
| 对话 | embed → Gateway | 与管理台 Copilot 同源 `useChat` + `mis-copilot` |
| 问数权限 | Gateway → BFF ask-context | thin JWT + 服务端富化 |
| 写操作 | 默认事件桥 | 宿主用自己的会话执行业务写 |

---

## 2. iframe 接入

```html
<iframe
  id="mis-copilot"
  src="https://mis.example.com/embed/chat?hostId=embed-demo"
  sandbox="allow-scripts allow-same-origin allow-forms"
  style="width:420px;height:640px;border:0"
  title="MIS Copilot"
></iframe>
```

| 参数 | 说明 |
|------|------|
| `hostId` | 已注册宿主 ID（与 `agent_external_host.host_id` 一致） |
| `writeMode` | 缺省 `bridge`；`direct` 为备选（需 CORS，不推荐首接） |
| `:sessionId` | 可选路径 `/embed/chat/:sessionId` 续接指定会话 |

**sandbox**：不要开 `allow-top-navigation`。

本地联调可打开（Vite 开发服务器需已启动）：

`http://localhost:5173/embed-host-demo.html`

---

## 3. postMessage 协议

### 3.1 iframe → 父页

| type | 时机 | 载荷 |
|------|------|------|
| `AUTH_READY` | iframe 加载完成 | `{}` |
| `AUTH_TOKEN_REQUEST` | JWT 临期（默认提前 5 分钟） | `{ reason: "expiring" }` |
| `A2UI_EVENT` | 写操作（审批/表单提交等） | 见下 |

```jsonc
// A2UI_EVENT
{
  "type": "A2UI_EVENT",
  "eventId": "evt_...",
  "event": {
    "name": "approve",
    "componentName": "approval-card",
    "payload": { "approvalId": "WO-1234" }
  },
  "meta": { "sessionId": "embed-demo-...", "hostId": "embed-demo" }
}
```

### 3.2 父页 → iframe

| type | 时机 | 载荷 |
|------|------|------|
| `AUTH_TOKEN` | 首次鉴权 / 续期 | `{ token: "<misJwt>" }` |
| `PAGE_CONTEXT` | 鉴权后（可多次） | `{ context: { ... } }` |
| `A2UI_EVENT_RESULT` | 处理完写操作 | `{ eventId, ok, data?, error? }` |

```jsonc
// PAGE_CONTEXT
{
  "type": "PAGE_CONTEXT",
  "context": {
    "hostId": "embed-demo",
    "embedMode": "iframe",
    "route": "/crm/opportunity/123",
    "module": "crm",
    "title": "商机详情",
    "sessionHint": null,
    "contextRef": {
      "pageId": "opp-123",
      "pageName": "商机详情",
      "moduleCode": "crm",
      "orgId": "1001",
      "storeId": "88"
    },
    "permissions": ["agent:chat:use", "approval:view"]
  }
}
```

**`contextRef` 约定**（透传给 Agent metadata，**不参与鉴权**）：

- 推荐键：`pageId` / `pageName` / `formCode` / `formName` / `moduleCode` / `orgId` / `storeId` / `route` / `currentTab` / `selectedRowIds` / `visibleFields`
- **禁止**：`token` / `secret` / `password` / `phone` / `roles` / `permissions` 等冒充身份或敏感字段  
  （Agent 侧另有白名单/脱敏；父页仍应自律）

父页必须校验 `event.origin` 为 MIS Web 域；iframe 只接受 `VITE_PARENT_ORIGINS` 白名单内的父域消息。

---

## 4. 身份兑换 API

`POST /api/v1/embed/identity/exchange`（无 MIS JWT；宿主后端直调）

### 请求

```json
{
  "hostId": "embed-demo",
  "externalToken": "<HS256 JWT>",
  "externalUserId": "ext-001",
  "phone": "13800138000",
  "scope": ["agent:chat:use"]
}
```

`externalToken` 建议 claim：`iss`/`appId`（= hostId）、`externalUserId`、`phone`（可选）、`iat`、`exp`。  
验签密钥 = 部署配置 `mis.embed.client-secrets.{hostId}`，且须与表 `client_secret_hash`（sha256）一致。

### 成功响应（`code=0`）

```json
{
  "code": 0,
  "data": {
    "misJwt": "eyJ...",
    "expiresIn": 1800,
    "mappedUserId": "1",
    "mappedBy": "explicit|phone|shadow",
    "permissions": ["agent:chat:use", "approval:view"]
  }
}
```

### 错误码

| code | 含义 |
|------|------|
| `40101` | `EMBED_TOKEN_INVALID`：验签失败 / host 未注册 / secret 不一致 |
| `40301` | 未映射 / 手机号歧义或未命中 / 映射用户不可用 |
| `40303` | 权限源或 JWT 签发能力不可用 |

映射顺序：显式表 → 手机号（正常账号恰 1 条）→ 影子账号 → 否则 40301。

---

## 5. 宿主注册与白名单（三处对齐）

### 5.1 数据库 `agent_external_host`

本地种子见 Flyway `V119__embed_demo_host_seed.sql`（hostId=`embed-demo`）。生产环境替换 secret、origins、映射用户。

显式用户映射写入 `agent_external_identity`（`host_id` + `external_user_id` → `mis_user_id`）。

### 5.2 BFF 配置

```yaml
mis:
  embed:
    client-secrets:
      embed-demo: ${MIS_EMBED_HOST_EMBED_DEMO_CLIENT_SECRET:}
    salt: ${MIS_EMBED_PHONE_HASH_SALT:}
```

本地默认 secret（**仅开发**）：`embed-demo-local-secret-do-not-use-in-prod`  
对应 hash：`03b41217a5fd9210de55bd8cdb959d34b6875036da2820dfdc58fb6912e7d1b3`

### 5.3 前端 `VITE_PARENT_ORIGINS`

构建/开发环境变量，逗号分隔父域 origin。空 = **拒绝一切** postMessage。

```env
VITE_PARENT_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### 5.4 边缘 CSP `frame-ancestors`

托管 `/embed/*` 的 nginx 须允许父域嵌套（且不要 `X-Frame-Options: DENY`）。见 [`deploy/nginx/edge.conf`](../../deploy/nginx/edge.conf)。

| 层级 | 作用 |
|------|------|
| `VITE_PARENT_ORIGINS` | postMessage 鉴权/事件桥 |
| nginx `frame-ancestors` | 浏览器是否允许 iframe 嵌套 |
| `agent_external_host.allowed_origins` | 宿主登记审计/运维对照 |

---

## 6. 令牌续期

- MIS JWT 默认 TTL **30 分钟**。
- iframe 在 `exp - 5min` 向父页发 `AUTH_TOKEN_REQUEST`。
- 父页重新调用 exchange，再推 `AUTH_TOKEN`；**sessionId 不变**。
- 续期超时/父页不响应 → iframe 进入「需重新登录」错误态。

---

## 7. 最小父页伪代码

```js
const MIS_ORIGIN = 'https://mis.example.com';
const frame = document.getElementById('mis-copilot');

window.addEventListener('message', async (e) => {
  if (e.origin !== MIS_ORIGIN) return;
  const { type } = e.data || {};

  if (type === 'AUTH_READY' || type === 'AUTH_TOKEN_REQUEST') {
    const data = await fetch('/api/host/embed-exchange', { method: 'POST' })
      .then((r) => r.json()); // 宿主后端代理 exchange，勿在浏览器持有 client_secret
    frame.contentWindow.postMessage(
      { type: 'AUTH_TOKEN', token: data.misJwt },
      MIS_ORIGIN,
    );
    frame.contentWindow.postMessage(
      {
        type: 'PAGE_CONTEXT',
        context: {
          hostId: 'embed-demo',
          embedMode: 'iframe',
          route: location.pathname,
          module: 'crm',
          contextRef: { pageId: 'home', moduleCode: 'crm' },
          permissions: data.permissions,
          mappedUserId: data.mappedUserId,
        },
      },
      MIS_ORIGIN,
    );
  }

  if (type === 'A2UI_EVENT') {
    try {
      const result = await callOwnBff(e.data.event);
      frame.contentWindow.postMessage(
        { type: 'A2UI_EVENT_RESULT', eventId: e.data.eventId, ok: true, data: result },
        MIS_ORIGIN,
      );
    } catch (err) {
      frame.contentWindow.postMessage(
        {
          type: 'A2UI_EVENT_RESULT',
          eventId: e.data.eventId,
          ok: false,
          error: { code: 40301, message: String(err.message || err) },
        },
        MIS_ORIGIN,
      );
    }
  }
});
```

---

## 8. 验收清单

- [ ] 非白名单父域的 `AUTH_TOKEN` 被拒绝  
- [ ] 握手后可发消息，问数权限与同 MIS 用户在管理台一致  
- [ ] 临期可续期；未续期有明确错误态  
- [ ] `A2UI_EVENT` → 宿主处理 → `A2UI_EVENT_RESULT` 回写成功/403  
- [ ] 密钥仅在宿主后端；浏览器网络面板看不到 `client_secret`
