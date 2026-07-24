# OpenAPI 契约目录

本目录用于存放各服务的 OpenAPI 3.1 规范文件。

## 规划文件

| 文件 | 状态 | 说明 |
|------|------|------|
| mis-admin-bff.yaml | ⏳ 待编写 | 对外统一 API 契约 |
| mis-auth.yaml | ⏳ 待编写 | 认证服务内部 API |
| mis-iam.yaml | ⏳ 待编写 | 身份与权限（用户/角色/APP） |
| mis-org.yaml | ⏳ 待编写 | 组织 / 部门 / 员工 |
| mis-system.yaml | ⏳ 待编写 | 菜单 / 字典 / API 注册 |
| mis-audit.yaml | ⏳ 待编写 | 审计服务 |

> Sprint 2：不再规划独立的 mis-user.yaml / mis-rbac.yaml。  
> 开工后优先从 BFF 的 SpringDoc 导出 YAML，或手写与 [api-specification.md](../api-specification.md) 保持一致。

## 维护原则

1. API 变更先改文档，再改代码（或同步）
2. 前端 TypeScript 类型可从 OpenAPI 生成（可选 `openapi-typescript`）
