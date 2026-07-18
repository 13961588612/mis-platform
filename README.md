# MIS Platform — 企业内部管理系统

基于 **React + shadcn/ui** 管理后台、**Java 17 + Spring Cloud Alibaba** 微服务、**Python** 智能体层的企业级 MIS 平台。

> **当前阶段**：Sprint 1 — 认证闭环（mis-auth、mis-audit、Gateway、admin-web 登录页）。

## 快速开始（本地开发）

```powershell
# 1. 基础设施
docker compose -f deploy/docker-compose.dev.yml up -d

# 2. 数据库迁移
cd backend; .\mvn.ps1 -pl mis-migrator flyway:migrate

# 3. 启动后端（不设 MIS_REMOTE，默认 local 模式）
.\mvn.ps1 spring-boot:run -pl mis-gateway,mis-auth,mis-audit

# 4. 启动前端
cd ..\frontend\mis-admin-web; pnpm install; pnpm dev
```

详见 **[本地开发](docs/devops/local-dev.md)**。测试/正式部署见 **[运维文档](docs/devops/README.md)**。

## 文档导航

| 分类 | 文档 |
|------|------|
| **代码阅读顺序** | **[CODE-READING-GUIDE](docs/CODE-READING-GUIDE.md)** |
| 文档中心 | [docs/README.md](docs/README.md) |
| 架构 | [总览](docs/architecture/01-overview.md) · [系统架构](docs/architecture/02-system-architecture.md) · [安全设计](docs/architecture/03-security.md) |
| 数据库 | [表结构](docs/database/schema-design.md) · [种子数据](docs/database/seed-data.md) |
| API | [接口规范](docs/api/api-specification.md) · [权限清单](docs/api/permissions.md) |
| 后端 | [微服务](docs/backend/microservices.md) · [公共模块](docs/backend/common-modules.md) |
| **运维** | **[运维总览](docs/devops/README.md)** · [本地开发](docs/devops/local-dev.md) · [测试部署](docs/devops/test-deploy.md) · [正式部署](docs/devops/prod-deploy.md) · [混合联调](docs/devops/integration-test.md) |
| 决策 | [ADR 索引](docs/adr/README.md) · [全局决策](docs/project/decisions.md) |
| **AI 辅助开发** | **[AGENTS.md](AGENTS.md)** · [配置说明](docs/project/ai-assisted-dev.md) · [编码规范](docs/project/conventions.md) |

## 后端模块（已实现）

```
backend/
├── mis-migrator/          # Flyway 单库迁移
├── mis-common/            # core, jpa, web, security, redis, bom
├── mis-gateway/           # JWT 验签 + 透传头
├── mis-auth/              # 登录 / 签发 / Refresh / 黑名单写入
└── mis-audit/             # 登录日志写入 / 查询

frontend/
└── mis-admin-web/         # 登录页 + auth-store + 路由守卫
```

## 技术栈摘要

| 层级 | 技术 |
|------|------|
| 前端 | React 18, TypeScript, Vite, Zustand, Axios（mis-admin-web Sprint 1） |
| 后端 | JDK 17, Spring Boot 3.2, Spring Cloud Gateway, Spring Data JPA, PostgreSQL |
| 缓存 | Redis（权限、验证码、Token 黑名单） |
| 配置 | local 用 jar 内 yml；test/prod 经 **Nacos**（PG `nacos` 库） |

## 文档版本

- 规格书：**v1.1-draft**
- 最后更新：2026-06-24
