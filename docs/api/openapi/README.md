# OpenAPI 契约目录

本目录用于存放各服务的 OpenAPI 3.1 规范文件。

## 规划文件

| 文件 | 状态 | 说明 |
|------|------|------|
| mis-admin-bff.yaml | ⏳ 待编写 | 对外统一 API 契约 |
| mis-auth.yaml | ⏳ 待编写 | 认证服务内部 API |
| mis-user.yaml | ⏳ 待编写 | 用户服务 |
| mis-org.yaml | ⏳ 待编写 | 组织服务 |
| mis-rbac.yaml | ⏳ 待编写 | 权限服务 |
| mis-system.yaml | ⏳ 待编写 | 系统服务 |
| mis-audit.yaml | ⏳ 待编写 | 审计服务 |

> 开工后优先从 BFF 的 SpringDoc 导出 YAML，或手写与 [api-specification.md](../api/api-specification.md) 保持一致。

## 维护原则

1. API 变更先改文档，再改代码（或同步）
2. 前端 TypeScript 类型可从 OpenAPI 生成（可选 `openapi-typescript`）
