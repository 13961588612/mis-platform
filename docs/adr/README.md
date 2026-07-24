# 架构决策记录（ADR）

> 状态：📝 草稿

## 什么是 ADR

Architecture Decision Record，记录重要架构决策的**背景、选项、结论、后果**，便于后续回顾与 onboarding。

## 索引

| ID | 标题 | 状态 | 日期 |
|----|------|------|------|
| [ADR-001](ADR-001-single-database-phase1.md) | Phase 1 采用单库策略 | 已接受 | 2026-06-23 |
| [ADR-002](ADR-002-jwt-refresh-cookie.md) | JWT + HttpOnly Refresh Cookie | 已接受 | 2026-06-23 |
| [ADR-003](ADR-003-bff-layer.md) | 引入 BFF 聚合层 | 已接受 | 2026-06-23 |
| [ADR-004](ADR-004-shadcn-ui.md) | 前端采用 shadcn/ui | 已接受 | 2026-06-23 |
| [ADR-005](ADR-005-ai-layer-python.md) | AI 层独立 Python 服务 | 已接受 | 2026-06-23 |
| [ADR-006](ADR-006-cache-strategy.md) | 全阶段 Redis 单级，不用 Caffeine | 已接受 | 2026-06-23 |
| [ADR-007](ADR-007-webclient-over-feign.md) | BFF WebClient + 领域 RestClient | 已接受 | 2026-06-23 |
| [ADR-008](ADR-008-bff-centralized-api-authz.md) | BFF 统一 API 权限，**mis-iam** 作 PDP | 已接受 | 2026-06-23 / 2026-07-21 |
| [ADR-009](ADR-009-permissions-in-redis-not-jwt.md) | 权限存 Redis，JWT 不带 permissions | 已接受 | 2026-06-23 |
| [ADR-010](ADR-010-api-permission-mapping.md) | 菜单/按钮 API 绑定（已由 ADR-011 演进） | 已接受 | 2026-06-23 |
| [ADR-011](ADR-011-sys-api-code-multi-app-auth.md) | sys_api 树 + code 层级 + 按 APP 隔离用户与令牌 | 已接受 | 2026-06-23 |
| [ADR-012](ADR-012-sys-role-permission.md) | sys_role_permission + perm_type ENUM | 已接受 | 2026-06-23 |
| [ADR-013](ADR-013-sys-dept-hierarchy.md) | sys_org + sys_dept 分层 | 已接受 | 2026-06-24 |
| [ADR-014](ADR-014-post-platform-admin.md) | 岗位任职、superadmin/租户 admin、F1–F6 | 已接受 | 2026-06-23 |
| [ADR-015](ADR-015-jpa-over-mybatis.md) | 持久层 Spring Data JPA（替代 MyBatis-Plus） | 已接受 | 2026-06-23 |
| [ADR-016](ADR-016-mis-iam-org-service-boundary.md) | Sprint 2：mis-iam / mis-org 合并原 mis-user/mis-rbac | 已接受 | 2026-07-21 |

## ADR 模板

```markdown
# ADR-XXX: 标题

## 状态
提议中 | 已接受 | 已废弃 | 已替代

## 背景
...

## 决策
...

## 备选方案
...

## 后果
正面 / 负面

## 待确认
...
```

## 如何新增 ADR

1. 复制模板，编号递增
2. 在本索引表添加一行
3. 若替代旧 ADR，更新旧 ADR 状态为「已替代」并链接新 ADR
