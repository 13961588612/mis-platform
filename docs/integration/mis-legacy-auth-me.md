# MIS：凭 Access JWT 查询当前用户手机号（供老 auth 回查）

> 状态：✅ 口径已确认（配合 ADR-021 / 老 auth exchange）｜日期：2026-09-09  
> 调用方：**老 auth-service**（在 `/auth/service/exchange` 内调用）  
> 目的：用 BFF 传来的 **MIS Access JWT** 解析当前用户，返回手机号，供老 auth **本地**按手机号匹配 SMP 用户并发令牌  
> **本接口由 mis-platform 提供（建议新建）**；不是「按手机号查用户」——按手机号定老用户在老 auth 库内完成

---

## 1. 在整体链路中的位置

```
BFF ──misAccessToken──► 老 auth exchange
                           │
                           ▼
              GET /api/v1/integration/legacy-auth/me
              Authorization: Bearer <misAccessToken>
                           │
                           ▼
              MIS 返回 phone（当前 JWT 主体）
                           │
                           ▼
              老 auth 本地：phone → SMP 用户 → 签发老令牌
```

安全边界：

- 只返回 **JWT 对应本人** 的资料；**禁止**用 query/body 传入他人 `userId` / `phone` 做查询。  
- 老 auth 不得把 MIS JWT 转给浏览器或其他第三方。

---

## 2. 接口定义

| 项 | 约定 |
|----|------|
| Method | `GET` |
| Path | `/api/v1/integration/legacy-auth/me` |
| 服务 | `mis-admin-bff`（经 Gateway；与 `/api/v1/auth/me` 同属 BFF 优先路由） |
| Header | `Authorization: Bearer <MIS Access JWT>`（RS256，与管理台登录态相同） |
| 权限 | **登录即可**（读本人资料）；建议 `sys_api` 登记为「已认证即可」，不绑业务按钮码 |
| 限流 | 建议按 `userId` 或来源 IP 限流，防刷 |

> 为何不直接用现有 `GET /api/v1/auth/me`：当前 `MeVO` **不含** `phone`，且会聚合完整 `permissions`，对老 auth 过重。独立瘦接口便于白名单、审计与字段收敛。若后续给 `/auth/me` 补 `phone`，本集成接口仍建议保留（契约稳定、职责分离）。

### 2.1 请求

无 query、无 body。身份完全来自 Bearer Token。

### 2.2 成功响应

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "userId": "10001",
    "tenantId": "1",
    "appId": "1",
    "username": "zhangsan",
    "realName": "张三",
    "phone": "13800138000",
    "status": 1
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `userId` | 是 | MIS 用户 ID（字符串化 Long，与平台其它 API 一致） |
| `tenantId` | 是 | 租户 ID |
| `appId` | 建议 | 当前登录 app；老 auth 可只记日志 |
| `username` | 是 | 登录名 |
| `realName` | 否 | 显示名 |
| `phone` | 条件必填 | **兑换成功的前提**；空/空白时老 auth 必须拒绝发令牌 |
| `status` | 是 | `1`=正常；非正常时老 auth 拒绝兑换 |

`phone` 格式约定（双方遵守）：

- 存储与返回为**大陆 11 位数字**（无 `+86`、无空格、无横线），或  
- 若历史数据含其它格式：MIS 返回前做一次规范化；老 auth 匹配前使用**同一套**规范化函数。

### 2.3 失败

| HTTP / 业务 | 场景 |
|-------------|------|
| 401 | 无 token / JWT 无效 / 过期 |
| 403 | 令牌合法但不允许访问本集成端点（若另配客户端白名单） |
| 200 + `code!=0` 或 404 | 用户不存在（极少，JWT 与库不一致） |
| 200 + `phone` 空 | 视为业务失败：老 auth 不得发令牌 |

实现建议：用户存在但 `phone` 为空时仍可 `code=0` 且 `phone: null`，由老 auth 按 § 失败处理；或 MIS 直接返回业务码 `PHONE_NOT_BOUND`——联调时二选一写死。

---

## 3. 实现要点（mis-admin-bff）

1. Gateway 验签 / 透传后，BFF 从安全上下文取 `userId`。  
2. `IamWebClient.getUser(userId)`（`IamUserVO` 已含 `phone`）。  
3. 组装瘦 DTO 返回；**不要**附带 permissions / menus。  
4. 日志：禁止打完整 JWT；手机号脱敏（如 `138****8000`）。  
5. Flyway：登记 `sys_api` path=`/api/v1/integration/legacy-auth/me`，method=`GET`；权限策略与 `/auth/me` 同类（已登录可访问）。  

可选加固（P1）：

- 仅允许来源网段（老 auth 出口 IP）访问本 path；或  
- 额外要求头 `X-Legacy-Auth-Client: mis-admin-bff` + 共享密钥（与 exchange 的 client 分离也可）。

---

## 4. 明确不在本接口范围

| 需求 | 归属 |
|------|------|
| 按手机号查 MIS 用户列表 | **不做**（避免被老 auth 当枚举接口） |
| 按手机号查 SMP 老用户 | **老 auth 本地库** |
| 签发 `HC-SMP-Authorization` | **老 auth** `/auth/service/exchange` |
| 浏览器直调本接口 | 不作为产品能力宣传；有 JWT 即可调用，但前端应继续用 `/auth/me` |

---

## 5. 联调检查清单

- [ ] 有效 MIS JWT → 返回与 IAM 一致的 `phone`  
- [ ] 过期 / 篡改 JWT → 401  
- [ ] `phone` 为空的用户 → 老 auth exchange 失败  
- [ ] 响应无 permissions 大包  
- [ ] 老 auth 出口能访问 Gateway 本 path（网络 / 证书）

---

## 6. 关联

- 老 auth 兑换：[smp-auth-service-exchange.md](smp-auth-service-exchange.md)  
- ADR：[ADR-021](../adr/ADR-021-finance-pos-account-bff-legacy-token.md)  
- 现有本人信息（不含 phone）：`GET /api/v1/auth/me`
