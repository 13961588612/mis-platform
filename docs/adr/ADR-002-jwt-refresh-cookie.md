# ADR-002: JWT + HttpOnly Refresh Cookie

## 状态
提议中

## 日期
2026-06-23

## 背景

管理后台需要无状态认证以支持水平扩展。需选择 Token 存储与传输策略，平衡安全性与前端实现复杂度。

## 决策

1. **Access Token**：JWT（RS256），存前端内存（Zustand），通过 `Authorization: Bearer` 传输，有效期 2 小时
2. **Refresh Token**：256bit 随机字符串，存 **HttpOnly Cookie**（`mis_refresh_token`），有效期 7 天，每次刷轮换
3. **登出**：Refresh 吊销 + Access Token `jti` 入 Redis 黑名单

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. JWT + HttpOnly Cookie（选定） | 防 XSS 窃取 refresh | 需处理 CSRF（SameSite） |
| B. 双 Token 均 localStorage | 实现简单 | XSS 可窃取 refresh |
| C. Session + Redis | 易吊销 | 有状态，扩展需粘性会话 |

## 后果

### 正面
- Access Token 短有效期降低泄露风险
- Refresh 不可被 JS 读取
- 无状态 Gateway 可验签 JWT

### 负面
- 前端需实现 refresh 单飞锁
- 跨域场景需配置 CORS + Cookie
- 移动端需另行约定 refresh 传递方式

## 待确认

- [ ] 是否同时支持 body 传 refreshToken（移动端）
- [ ] JWT 私钥管理：Nacos vs K8s Secret
- [ ] 是否 Phase 1 启用 MFA
