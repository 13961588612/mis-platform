# MIS Platform 文档中心

> 规格书版本：**v1.1-draft** | 最后更新：2026-06-24

## 文档状态说明

| 标记 | 含义 |
|------|------|
| ✅ 已定稿 | 可作为开发依据 |
| 📝 草稿 | 已有内容，待细化确认 |
| ⏳ 待补充 | 仅占位，尚未编写 |

## 快速入口

| 我想… | 去看 |
|--------|------|
| 了解整体架构 | [01-overview](architecture/01-overview.md) → [02-system-architecture](architecture/02-system-architecture.md) |
| 理解登录与安全 | [03-security](architecture/03-security.md) + [CODE-READING-GUIDE](CODE-READING-GUIDE.md) |
| 查表结构 | [schema-design](database/schema-design.md) |
| 查 API | [api-specification](api/api-specification.md) |
| 本地跑起来 | [local-dev](devops/local-dev.md) |
| 配置 prod/test/Nacos | [configuration](devops/configuration.md) |
| 读代码从哪开始 | **[CODE-READING-GUIDE](CODE-READING-GUIDE.md)** |
| 查各模块职责与内容 | **[modules-guide](project/modules-guide.md)** |

---

## 目录结构

```
docs/
├── README.md                          # 本文件 — 文档索引
├── CODE-READING-GUIDE.md              # 📝 代码/文档阅读顺序（onboarding）
├── architecture/
│   ├── 01-overview.md                 # 📝 项目总览
│   ├── 02-system-architecture.md      # 📝 系统架构与分层
│   ├── 03-security.md                 # 📝 认证/授权（Gateway/BFF/领域）
│   └── 04-app-module-mfe.md           # 📝 APP/模块/微前端
├── database/
│   ├── schema-design.md               # 📝 表结构
│   ├── schema-discussion.md           # 📝 Schema 讨论稿
│   └── seed-data.md                   # 📝 种子数据说明
├── api/
│   ├── api-specification.md           # 📝 REST API
│   ├── permissions.md                 # 📝 权限点与菜单
│   └── openapi/README.md              # ⏳ OpenAPI 归档
├── frontend/
│   └── admin-web-design.md            # 📝 管理后台
├── backend/
│   ├── microservices.md               # 📝 微服务职责
│   ├── common-modules.md              # 📝 公共模块（含 JWT/Redis）
│   └── api-permission-mapping.md      # 📝 API↔permission 映射
├── agent/
│   └── ai-agent-design.md             # 📝 智能体层
├── devops/
│   ├── local-dev.md                   # 📝 本地环境
│   ├── configuration.md               # 📝 配置管理（prod 仅文件）
│   └── ci-cd.md                       # 📝 CI/CD
├── project/
│   ├── decisions.md                   # ✅ 全局决策
│   ├── sprint-plan.md                 # 📝 Sprint 计划
│   ├── modules-guide.md               # 📝 各项目/模块详细说明
│   └── conventions.md                 # 📝 编码规范
└── adr/                               # 架构决策记录（ADR-001 … ADR-015）
    └── README.md
```

---

## 推荐阅读顺序（文档）

1. [项目总览](architecture/01-overview.md)
2. [系统架构](architecture/02-system-architecture.md)
3. [安全设计](architecture/03-security.md)
4. [表结构设计](database/schema-design.md)
5. [接口规范](api/api-specification.md) + [权限清单](api/permissions.md)
6. [微服务划分](backend/microservices.md) + [公共模块](backend/common-modules.md)
7. [配置管理](devops/configuration.md) + [本地开发](devops/local-dev.md)
8. [代码阅读顺序](CODE-READING-GUIDE.md)

---

## 代码实现进度（Sprint 0 摘要）

| 组件 | 状态 | 说明 |
|------|------|------|
| mis-migrator + Flyway V1/V2 | ✅ | 单库 `mis_platform` |
| mis-common-* | ✅ | core / jpa / web / security / redis |
| mis-gateway | ✅ | JWT 验签、透传头、Redis 黑名单 |
| mis-auth | ✅ | 登录/刷新/登出、JWT 签发 |
| mis-admin-bff | ⏳ | API 权限、聚合 |
| 领域微服务 | ⏳ | user / rbac / org / … |
| 前端 mis-admin-web | ⏳ | |

---

## 部署与配置（仓库内）

| 路径 | 说明 |
|------|------|
| `deploy/docker-compose.dev.yml` | 本地 PG / Redis / Nacos / MinIO |
| `deploy/config/prod/` | **正式环境**微服务外部 YAML |
| `deploy/config/test/` | **测试环境**文件配置 |
| `deploy/nacos/` | Nacos Server（PG 存储）与 import 模板 |
| `.env.example` | 环境变量模板 |

---

## 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0-draft | 2026-06-23 | 初版文档体系 |
| v1.1-draft | 2026-06-24 | 配置策略、mis-auth/gateway 实现、CODE-READING-GUIDE |
