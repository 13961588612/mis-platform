# ADR-008: API 权限校验 — BFF 统一拦截，mis-iam 作策略中心

## 状态
已接受（2026-07-21 修订：PDP 由原规划 mis-rbac 归入 **mis-iam**）

## 日期
2026-06-23（初版） / 2026-07-21（服务边界）

## 背景

安全设计中若在 BFF 每个 Controller 使用 `@PreAuthorize` 硬编码权限，会导致：

- 权限点散落，容易漏配或不一致
- 与「BFF 作为唯一对外入口」架构重复

另一方面，若新建独立 **authz-service**，让每个请求都 RPC 询问「用户 X 能否访问 API Y」：

- 热路径多一跳，延迟与可用性压力大

> 权限运行时存储见 ADR-009；**校验方式**见 [ADR-010](ADR-010-api-permission-mapping.md)（集中映射表，**禁止** Controller 硬编码 `@PreAuthorize`）。  
> Sprint 2：**mis-user + mis-rbac 合并为 mis-iam**，PDP 职责落在 mis-iam。

需明确：**权限逻辑放哪、权限校验执行点放哪**。

## 决策

采用 **PDP / PEP 分离**，**不新建**独立 authz 微服务：

| 角色 | 组件 | 职责 |
|------|------|------|
| **PDP**（策略决策点） | **mis-iam** | 权限数据权威来源：角色、角色-权限、权限聚合；内部查询 API；Redis 缓存 |
| **PEP**（策略执行点） | **mis-admin-bff** | **唯一**对外 API 权限校验（`ApiPermissionInterceptor` + 映射表，见 ADR-010） |
| **认证** | mis-gateway + mis-auth | 仅认证，不做接口权限 |
| **数据权限** | 各领域服务（含 mis-org、mis-iam） | `@DataScope`（行级），与 API 权限分离 |

```
对外请求：Gateway(认证) → BFF(映射表鉴权) → 领域服务(/internal，信任内网 + @DataScope)
```

### 不在以下位置做 API 权限校验

| 位置 | 原因 |
|------|------|
| mis-gateway | 路由级规则难维护，无法表达细粒度 permission |
| 新建 authz-service 每请求 RPC | 热路径延迟、单点故障 |
| 每个领域服务 @PreAuthorize | 重复、易漂移（**Phase 1 不采用**） |

### mis-iam 内部 API（供登录与 BFF 可选调用）

```
GET  /internal/v1/permissions/{userId}     # 登录/refresh 加载并写 Redis；BFF 缓存 miss 时回源
```

- **登录/refresh**：mis-auth 调 mis-iam → **permissions 写入 Redis**，JWT **不含** permissions
- **BFF 校验**：每请求 **GET Redis** → `ApiPermissionInterceptor` 查映射表（ADR-010）

### 领域服务安全边界

| 规则 | 说明 |
|------|------|
| 只暴露 `/internal/v1/**` | 不经过 Gateway 公网路由 |
| 不做 API 权限注解 | API 权限已在 BFF 映射表统一校验（ADR-010） |
| 必须做 `@DataScope` | 防止 BFF 被绕过后直接调内部 API 时的越权读 |
| 内部调用鉴权 | Phase 1：网络隔离 + 服务名；Phase 2：mTLS 或服务账号 Token |

> 若内网 `/internal` 被误暴露，还需 NetworkPolicy；API 权限单靠领域服务无法兜底，依赖 **不对外路由**。

## 备选方案

| 方案 | 评价 |
|------|------|
| A. 每服务 @PreAuthorize | 纵深防御好，维护成本高 |
| B. **BFF 统一 PEP + mis-iam PDP（选定）** | 对外单点校验，职责清晰 |
| C. 独立 authz-service 每请求 RPC | 集中但热路径重 |
| D. Gateway 配置 route→permission | 适合极简 API，不适合 RBAC 细粒度 |

## 后果

### 正面
- 对外 API 权限**只维护一份**（BFF 映射表）
- mis-iam 专注身份与权限模型，不扛每秒万级 check QPS
- 领域服务代码更简，专注业务与数据权限

### 负面
- 内部 API 依赖网络隔离，不能单独作为对外安全边界
- 未来若有第二个 BFF（移动端），需复用同一套 PEP 规范或抽公共 `mis-common-security` 模块

## 待确认

- [x] JWT **不内嵌** permissions；运行时存 Redis（ADR-009）
- [x] PDP 服务名为 **mis-iam**（Sprint 2）
