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
| **本地跑起来** | **[local-dev](devops/local-dev.md)** |
| **测试/正式部署** | **[devops/README](devops/README.md)** → [test-deploy](devops/test-deploy.md) / [prod-deploy](devops/prod-deploy.md) |
| 混合联调 | [integration-test](devops/integration-test.md) |
| 配置与 Nacos | [configuration](devops/configuration.md) |
| 读代码从哪开始 | **[CODE-READING-GUIDE](CODE-READING-GUIDE.md)** |
| 配置 Cursor Agent 角色/规范 | [ai-assisted-dev](project/ai-assisted-dev.md) · [AGENTS.md](../AGENTS.md) |

---

## 目录结构

```
docs/
├── README.md                          # 本文件 — 文档索引
├── CODE-READING-GUIDE.md              # 代码/文档阅读顺序
├── architecture/                      # 架构设计
├── database/                          # 表结构与种子数据
├── api/                               # REST API 与权限
├── frontend/                          # 管理后台设计
├── backend/                           # 微服务与公共模块
├── agent/                             # 智能体层
├── devops/                            # ★ 运维与部署
│   ├── README.md                      # 运维总览（环境对照）
│   ├── local-dev.md                   # 本地开发
│   ├── test-deploy.md                 # 测试环境部署
│   ├── prod-deploy.md                 # 正式环境部署
│   ├── integration-test.md          # 混合联调
│   ├── configuration.md               # 配置策略
│   └── ci-cd.md                       # CI/CD
├── project/                           # 决策、Sprint、AI 辅助开发
└── adr/                               # 架构决策记录
```

---

## 推荐阅读顺序（文档）

1. [项目总览](architecture/01-overview.md)
2. [系统架构](architecture/02-system-architecture.md)
3. [安全设计](architecture/03-security.md)
4. [表结构设计](database/schema-design.md)
5. [接口规范](api/api-specification.md) + [权限清单](api/permissions.md)
6. [微服务划分](backend/microservices.md) + [公共模块](backend/common-modules.md)
7. **[运维总览](devops/README.md)** → [本地开发](devops/local-dev.md)
8. [代码阅读顺序](CODE-READING-GUIDE.md)

---

## 代码实现进度（Sprint 0 摘要）

| 组件 | 状态 | 说明 |
|------|------|------|
| mis-migrator + Flyway V1/V2/V3 | ✅ | 单库；V3 对齐 mis-iam/mis-org |
| mis-common-* | ✅ | core / jpa / web / security / redis |
| mis-gateway | ✅ | JWT 验签、透传头、Redis 黑名单 |
| mis-auth | ✅ | 登录/刷新/登出、JWT 签发 |
| mis-audit | ✅ | 登录日志 |
| mis-iam | ⏳ | 用户/角色/APP（Sprint 2） |
| mis-org | ⏳ | 组织/部门/员工（Sprint 2） |
| mis-admin-bff | ⏳ | API 权限、聚合 |
| mis-system | ⏳ | 菜单/字典 |
| 前端 mis-admin-web | ✅ | Sprint 1 登录页 |

---

## 部署与配置（仓库内）

| 路径 | 说明 |
|------|------|
| `deploy/docker-compose.dev.yml` | 本地 PG / Redis / Nacos / MinIO |
| `deploy/docker-compose.stack.yml` | 混合联调稳定服务 |
| `deploy/nacos-config/{prod,test,integration}/` | 配置 Git 源 → `nacos-push` |
| `deploy/nacos/` | Nacos Server（PG 存储） |
| `deploy/ide/` | IDE 联调环境变量模板 |
| `.env.example` | 本地环境变量模板 |

---

## 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0-draft | 2026-06-23 | 初版文档体系 |
| v1.1-draft | 2026-06-24 | MIS_REMOTE 配置简化、运维文档拆分 |
| v1.2 | 2026-07-21 | Sprint 2 服务边界：mis-iam / mis-org；ADR-016 |
