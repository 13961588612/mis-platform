# ADR-021: 财务辅助 · POS 对账迁入 host + BFF 反代 + 老 auth 令牌兑换（MIS 手机号桥接）

## 状态

已接受 | 2026-09-09（同日修订：兑换主体改为「MIS JWT → 手机号 → 老用户」，不再发匿名全局服务令牌）

## 背景

将 smp-client 中银行商场对账（原 `bank-account-decide`，下游 `bip-bank-receipt`）逐步迁入 mis-platform 管理台。约束：

- 客户端分模块迁入；第一期为财务辅助下的 POS 对账。
- **服务端业务（`bip-bank-receipt`）尽量少改或不改。**
- 浏览器**禁止**直连旧网关；CORS / 鉴权统一走 MIS。
- 老系统请求头为 `HC-SMP-Authorization`（见 smp-client `util/request.js`），与 MIS JWT 不同体系，需在 BFF 侧与老 auth **交换令牌**后再调下游。

已确认（2026-09-09）：

- 前端路径：`/finance/bank-account/pos-account/*`
- 菜单：财务辅助 → 银行账目 → POS对账
- 老 auth：**新开** exchange；BFF 以 **client 凭证 + MIS Access JWT** 调用
- 老 auth 用 MIS JWT 回查 MIS 手机号，再在老库按手机号定位用户并签发老令牌
- MIS 提供瘦接口 `GET /api/v1/integration/legacy-auth/me`（本人 phone；非「按手机号查用户」）

## 决策

### 1. Host App 与信息架构

| 层级 | 文案 | 编码 / 路径 |
|------|------|-------------|
| `sys_app` | 财务辅助 | `code=finance`，`runtime=host`，`base_path=/finance`，`portal_group=operations` |
| 侧栏一级 | 银行账目 | `bank-account` |
| 侧栏二级 | POS对账 | `pos-account`（其下挂业务页） |

前端路由与目录：

```
/finance/bank-account/pos-account/terminals|skt|reconcile|marks
features/finance/bank-account/pos-account/
```

实现口径对齐 kb/agent/iqd：静态 `FINANCE_NAV` + `host-apps` + `PAGE_MAP` + Flyway `sys_menu`/`sys_api` **同改**；权限码命名空间 `finance:bank-account:pos-account:*`。  
**不做**独立微前端子工程；React 重写进 `mis-admin-web` host。

### 2. BFF 反代（浏览器只打 MIS）

```
浏览器 + MIS JWT
  → Gateway → mis-admin-bff（sys_api 鉴权）
  → WebClient + 老令牌头
  → bip-bank-receipt `/api/account-decide/**`
```

- 对外前缀：`/api/v1/finance/bank-account/pos-account/**`
- 下游映射：剥前缀后转发至 `{bank-receipt.base-url}/api/account-decide/**`（method / query / body / multipart 透传）
- 判权走 `sys_api` 注册表（ADR-008/010），**不写** `@PreAuthorize`
- `bip-bank-receipt` 业务 API **路径与语义保持不变**；一期不新建 `mis-finance` Java 领域服务

### 3. 出站令牌：client 凭证 + MIS JWT → 手机号桥接

与 D12「外部 token → MIS JWT」**方向相反**：本决策为 **MIS BFF → 老 auth 兑老用户令牌 → 调 bip-bank-receipt**。单独组件实现，不复用 embed 兑换接口。

```
BFF(MIS JWT) → 老 auth exchange(clientId/secret + misAccessToken)
  → 老 auth 调 MIS GET /api/v1/integration/legacy-auth/me
  → 得 phone → 老库按手机号唯一匹配用户 → 签发 HC-SMP 令牌
```

| 项 | 取值 |
|----|------|
| 调用方证明 | `clientId` + `clientSecret`（登记客户端 `mis-admin-bff`） |
| 用户主体 | `misAccessToken` → MIS 回查 `phone` → 老用户 |
| MIS 接口 | **新建** `GET /api/v1/integration/legacy-auth/me`（本人资料含 phone；禁止按他人手机号查询） |
| 老 auth | **新建** `POST .../auth/service/exchange` |
| 下游头名 | 可配，默认 `HC-SMP-Authorization`；前缀默认空 |
| BFF 缓存 | 按 `misUserId`（禁止全局单 key） |
| 浏览器 | **永不**下发老令牌 |
| 失败 | `fail-closed`（无 phone / 老库 0 或多条 / 兑换失败均不转发） |

配置挂载于 BFF（密钥仅环境变量 / 密钥库）：

```yaml
# 共享：多下游复用（SmpProperties / SmpTokenExchangeService）
mis.bff.smp.auth.header-name                    # 默认 HC-SMP-Authorization
mis.bff.smp.token-exchange.enabled
mis.bff.smp.token-exchange.token-url            # SMP_TOKEN_URL
mis.bff.smp.token-exchange.client-id
mis.bff.smp.token-exchange.client-secret        # SMP_CLIENT_SECRET
mis.bff.smp.token-exchange.audience             # 默认 audience，可被下游覆盖
mis.bff.smp.token-exchange.token-json-path      # $.data.token
mis.bff.smp.token-exchange.cache.key-prefix     # ...:user:{misUserId}:{audience}
mis.bff.smp.token-exchange.cache.skew-seconds
mis.bff.smp.token-exchange.fail-closed

# 下游专用（BankReceiptProperties）
mis.bff.bank-receipt.base-url                   # BANK_RECEIPT_BASE_URL
mis.bff.bank-receipt.audience                   # 兑换时覆盖默认 audience
```

建议组件：`SmpProperties`、`SmpTokenExchangeService`、`BankReceiptProperties`、`BankReceiptClient`、`PosAccountProxyController`、`LegacyAuthMeController`（MIS 回查）。

### 4. 老 auth / 下游 / MIS 改动边界

- **MIS**：新增 `legacy-auth/me`（读 IAM 用户 phone）；现有 `/auth/me` 可不改。
- **老 auth**：exchange + 出站调 MIS；本地按手机号匹配；签发令牌须与桌面令牌同校验链可被 `bip-bank-receipt` 接受。
- **bip-bank-receipt**：业务逻辑不动。
- **本期不做**：独立 MIS↔老账号映射表（手机号即桥）、微前端、浏览器直连旧网关、MIS「按手机号枚举用户」接口。

## 备选方案

| 方案 | 结论 |
|------|------|
| 浏览器直连旧网关 + CORS | **否决**：双鉴权、密钥暴露面、与 MIS 门户割裂 |
| BFF 反代但不兑令牌（仅内网免鉴权） | **否决**：破坏老系统现有鉴权模型，下游改动更大 |
| 纯匿名 `service_account` 全局一枚令牌 | **否决（修订）**：老 auth 需按手机号落到具体老用户 |
| 复用 desktop login / link-login | **否决**：语义是人机登录；服务调用应新开 exchange |
| MIS 提供「按手机号查用户」给老 auth | **否决**：易成枚举面；老 auth 只应持 JWT 查**本人** phone |
| qiankun / Module Federation 挂 Vue | **否决（本期）**：已选定 React 重写进 host；异构 MFE 留待多域阈值 |

## 后果

### 正面

- 门户 / 菜单 / MIS 鉴权统一；前端无旧网关依赖。
- `bip-bank-receipt` 业务面稳定；老令牌落到真实老用户，利于下游按人审计/权限。
- 手机号桥接无需单独映射表（要求两边手机号一致且唯一）。

### 负面

- 兑换多一跳（老 auth → MIS `legacy-auth/me`）；依赖手机号数据质量（空号/一人多号失败）。
- 需运维打通老 auth → MIS 网络，并配置 client 密钥与按用户缓存。
- 老 auth、MIS 均需新增接口（跨仓协作）。

## 待确认

- [ ] 老 auth `exchange` 完整 URL 路径（建议 `/auth/service/exchange`）
- [ ] 老令牌 TTL / `expiresIn` 约定
- [ ] 客户端 `clientId` 正式取值（建议 `mis-admin-bff`）
- [ ] 手机号规范化规则（是否去 `+86`、是否允许非 11 位）
- [ ] `phone` 为空时 MIS 返回 `code=0 + phone:null` 还是业务错误码

## 关联

- 老 auth 兑换：[`docs/integration/smp-auth-service-exchange.md`](../integration/smp-auth-service-exchange.md)
- MIS 回查手机号：[`docs/integration/mis-legacy-auth-me.md`](../integration/mis-legacy-auth-me.md)
- BFF 层：[ADR-003](ADR-003-bff-layer.md)、[ADR-007](ADR-007-webclient-over-feign.md)、[ADR-008](ADR-008-bff-centralized-api-authz.md)
- 多 APP / API 树：[ADR-011](ADR-011-sys-api-code-multi-app-auth.md)
- 微前端演进（本期不用）：`docs/frontend/micro-frontend-integration.md`
- 反向对照（外部→MIS 兑换，勿混用）：A2UI D12 / `EmbedIdentityService`
