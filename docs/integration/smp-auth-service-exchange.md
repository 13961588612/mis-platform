# 老 auth-service：凭 MIS 用户兑换老令牌（给对接方）

> 状态：✅ 已确认口径（ADR-021，2026-09-09 修订：手机号桥接）  
> 调用方：`mis-admin-bff`  
> 用途：BFF 携带 **MIS Access JWT** 向老 auth 兑换 `HC-SMP-Authorization` 令牌，再调 `bip-bank-receipt`  
> **本接口为新建**；勿复用 `/auth/desktop/login`、各类 `*-link-login`

---

## 1. 端到端流程（已确认）

```
浏览器 ──MIS JWT──► mis-admin-bff
                      │ ① 校验 MIS JWT + finance 权限
                      │ ② POST 老 auth /auth/service/exchange
                      │    （client 凭证 + misAccessToken）
                      ▼
                 老 auth-service
                      │ ③ 用 misAccessToken 调 MIS
                      │    GET …/integration/legacy-auth/me
                      │    ← 得到 phone（及 userId/username）
                      │ ④ 在老库按手机号定位 SMP 用户
                      │ ⑤ 为该用户签发老令牌
                      ▼
                 返回 token / expiresIn
                      │
                      ▼
            BFF 带 HC-SMP-Authorization → bip-bank-receipt
```

要点：

| 步骤 | 谁做 | 说明 |
|------|------|------|
| 查手机号 | **MIS** 提供接口 | 凭 MIS JWT 返回**当前用户**手机号（见 [mis-legacy-auth-me.md](mis-legacy-auth-me.md)） |
| 按手机号定用户 | **老 auth 本地** | 查老用户表；MIS **不**提供「按手机号查老用户」 |
| 发令牌 | **老 auth** | 形态须能被现网 `bip-bank-receipt` 校验接受 |

浏览器**永不**持有老令牌。

---

## 2. 接口：`POST /auth/service/exchange`

| 项 | 约定 |
|----|------|
| Method | `POST` |
| Path（建议） | `/auth/service/exchange`（完整 URL = 现网 gateway + `auth-service` 前缀 + 本 path） |
| Content-Type | `application/json` |
| 调用方身份 | 请求体 `clientId` + `clientSecret`（BFF 作为客户端） |
| 用户身份 | 请求体 `misAccessToken`（当前登录用户的 MIS Access JWT） |

### 2.1 请求体

```json
{
  "clientId": "mis-admin-bff",
  "clientSecret": "<明文密钥，仅信道内传递>",
  "audience": "bip-bank-receipt",
  "misAccessToken": "<MIS RS256 Access JWT，不含 Bearer 前缀>"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `clientId` | 是 | 预注册服务客户端；建议 `mis-admin-bff` |
| `clientSecret` | 是 | 与注册表校验（库内建议只存哈希） |
| `audience` | 否 | 目标下游；一期可校验或忽略 |
| `misAccessToken` | 是 | BFF 从当前请求透传的 MIS Access Token；老 auth 用其回查 MIS 手机号 |

### 2.2 老 auth 内部步骤（实现约束）

1. 校验 `clientId` / `clientSecret` / 客户端启用状态。  
2. 调用 MIS：[`GET /api/v1/integration/legacy-auth/me`](mis-legacy-auth-me.md)，请求头 `Authorization: Bearer <misAccessToken>`。  
3. 若 MIS 返回无手机号、用户停用、401/403 → **拒绝兑换**（fail-closed）。  
4. 用返回的 `phone`（建议规范化：仅数字、大陆 11 位等，双方约定）在老用户库精确匹配：  
   - 0 条 → 拒绝（用户未开通老账号）  
   - 多条 → 拒绝（数据歧义，防错发）  
   - 1 条且启用 → 继续  
5. 为该老用户签发令牌（与桌面登录令牌**同校验链可验**）。  
6. 返回 `token` + `expiresIn`。

### 2.3 成功响应

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "<写入 HC-SMP-Authorization 的字符串>",
    "expiresIn": 7200,
    "tokenType": "smp"
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `data.token` | 是 | BFF 原样放入 `HC-SMP-Authorization`（默认无 `Bearer ` 前缀） |
| `data.expiresIn` | 是 | 秒；须与真实过期一致 |
| `data.tokenType` | 否 | 建议 `smp` |

BFF JSONPath 默认：`$.data.token`、`$.data.expiresIn`。

### 2.4 失败响应

```json
{
  "code": "<非 0>",
  "message": "exchange_failed"
}
```

| 场景 | 建议 |
|------|------|
| client 无效 | 统一文案，防枚举 |
| MIS 回查失败 / 无手机号 | 明确业务码（如 `mis_profile_unavailable`），便于 BFF 日志 |
| 老库 0 条 / 多条手机号 | `user_not_linked` / `user_ambiguous`（文案可不区分细节给前端） |
| 限流 | 可返回「过于频繁」 |

---

## 3. 令牌与缓存语义

1. **按人发令牌**（经手机号映射到老用户），不是匿名全局服务主体。  
2. BFF 缓存键建议：`bff:legacy-token:bank-receipt:user:{misUserId}`（或 phone 哈希）；**不要**再用全局单 key。  
3. TTL：建议 1～2 小时；提前 `skew`（默认 60s）刷新。  
4. 下游令牌无效：清该用户缓存，重兑最多 1 次。  
5. 客户端凭证仅证明「调用方是 BFF」；**用户主体以 MIS JWT → 手机号 → 老用户为准**。

> 相对初版「纯 service_account 全局一枚令牌」：客户端注册方式保留，**主体解析改为 MIS 手机号桥接**（ADR-021 已同步修订）。

---

## 4. 客户端注册（auth 侧运维）

| 项 | 示例 |
|----|------|
| clientId | `mis-admin-bff` |
| clientSecret | 部署注入；库内存哈希 |
| 状态 | 启用 |
| 允许 audience | `bip-bank-receipt`（若启用） |
| 备注 | MIS 财务辅助 POS 对账；须能出站访问 MIS `legacy-auth/me` |

另需配置：MIS `legacy-auth/me` 的 base URL、超时；网络白名单（老 auth → MIS Gateway/BFF）。

---

## 5. 调用方行为（BFF，联调对照）

```
1. 浏览器请求带 MIS JWT → BFF 按 sys_api 鉴权
2. SmpTokenExchangeService（mis.bff.smp）按 misUserId(+audience) 读缓存
3. 未命中 → POST exchange（client 凭证 + 当前 misAccessToken）
4. 下游客户端（如 BankReceiptClient）写入 HC-SMP-Authorization 后转发
5. 下游令牌无效 → 清缓存重兑 ≤1 次；仍失败 fail-closed
```

配置前缀：`mis.bff.smp.token-exchange.*`（共享）；下游专用如 `mis.bff.bank-receipt.base-url` / `audience`。

环境变量示例：`SMP_TOKEN_URL`、`SMP_CLIENT_SECRET`、`BANK_RECEIPT_BASE_URL`。

---

## 6. 联调检查清单

- [ ] exchange：错误 client 被拒；缺 `misAccessToken` 被拒  
- [ ] MIS `legacy-auth/me`：有效 JWT 返回 phone；无 phone / 停用用户兑换失败  
- [ ] 老库手机号 0 条、1 条、多条行为符合 §2.2  
- [ ] 兑出 token 可调通 `bip-bank-receipt` 只读接口  
- [ ] 不同 MIS 用户兑出不同老主体（抽检）  
- [ ] 日志无 `clientSecret` / 完整 JWT / 完整老 token；手机号脱敏  

---

## 7. 关联

- MIS 回查手机号接口：[mis-legacy-auth-me.md](mis-legacy-auth-me.md)  
- 架构决策：[ADR-021](../adr/ADR-021-finance-pos-account-bff-legacy-token.md)  
- 现网头名：smp-client `HC-SMP-Authorization`
