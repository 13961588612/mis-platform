# MIS Platform — 企业内部管理系统

基于 **React + shadcn/ui** 管理后台、**Java 17 + Spring Cloud Alibaba** 微服务、**Python** 智能体层的企业级 MIS 平台。

> **当前阶段**：Sprint 0 — 基建与认证链路已落地（Flyway、common 模块、Gateway JWT、mis-auth、Nacos+PG 配置策略）。

## 快速开始

```bash
# 1. 基础设施
docker compose -f deploy/docker-compose.dev.yml up -d

# 2. 数据库迁移
cd backend && mvn -pl mis-migrator flyway:migrate

# 3. 启动服务（需 JAVA_HOME_17、Maven 3.9+）
mvn -pl mis-auth,mis-gateway spring-boot:run
```

详见 [本地开发](docs/devops/local-dev.md)、[配置管理](docs/devops/configuration.md)。

## 文档导航

| 分类 | 文档 |
|------|------|
| **代码阅读顺序** | **[CODE-READING-GUIDE](docs/CODE-READING-GUIDE.md)** |
| 文档中心 | [docs/README.md](docs/README.md) |
| 架构 | [总览](docs/architecture/01-overview.md) · [系统架构](docs/architecture/02-system-architecture.md) · [安全设计](docs/architecture/03-security.md) |
| 数据库 | [表结构](docs/database/schema-design.md) · [种子数据](docs/database/seed-data.md) |
| API | [接口规范](docs/api/api-specification.md) · [权限清单](docs/api/permissions.md) |
| 后端 | [微服务](docs/backend/microservices.md) · [公共模块](docs/backend/common-modules.md) |
| 运维 | [本地开发](docs/devops/local-dev.md) · [配置策略](docs/devops/configuration.md) |
| 决策 | [ADR 索引](docs/adr/README.md) · [全局决策](docs/project/decisions.md) |

## 后端模块（已实现）

```
backend/
├── mis-migrator/          # Flyway 单库迁移
├── mis-common/            # core, jpa, web, security, redis, bom
├── mis-gateway/           # JWT 验签 + 透传头
└── mis-auth/              # 登录 / 签发 / Refresh / 黑名单写入
```

## 技术栈摘要

| 层级 | 技术 |
|------|------|
| 前端 | React 18, TypeScript, Vite, shadcn/ui（规划中） |
| 后端 | JDK 17, Spring Boot 3.2, Spring Cloud Gateway, Spring Data JPA, PostgreSQL |
| 缓存 | Redis（权限、验证码、Token 黑名单） |
| 配置 | 正式环境外部 YAML；测试可选 Nacos（PG 存储） |

## 文档版本

- 规格书：**v1.1-draft**
- 最后更新：2026-06-24
