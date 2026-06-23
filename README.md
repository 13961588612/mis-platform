# MIS Platform — 企业内部管理系统

基于 **React + shadcn/ui** 管理后台、**Java 17 + Spring Cloud Alibaba** 微服务、**Python** 智能体层的企业级 MIS 平台。

> **当前阶段**：Sprint 0 基建进行中 — `mis-migrator`、docker-compose 已就绪，微服务代码尚未开始。

## 文档导航

完整规格说明见 [`docs/README.md`](docs/README.md)。

| 分类 | 文档 |
|------|------|
| 架构 | [总览](docs/architecture/01-overview.md) · [系统架构](docs/architecture/02-system-architecture.md) · [安全设计](docs/architecture/03-security.md) |
| 数据库 | [表结构设计](docs/database/schema-design.md) · [种子数据](docs/database/seed-data.md) |
| API | [接口规范](docs/api/api-specification.md) · [权限清单](docs/api/permissions.md) |
| 前端 | [管理后台设计](docs/frontend/admin-web-design.md) |
| 后端 | [微服务划分](docs/backend/microservices.md) · [公共模块](docs/backend/common-modules.md) |
| 智能体 | [AI 层设计](docs/agent/ai-agent-design.md) |
| 工程 | [本地开发](docs/devops/local-dev.md) · [CI/CD](docs/devops/ci-cd.md) · [编码规范](docs/project/conventions.md) |
| 计划 | [Sprint 计划](docs/project/sprint-plan.md) |
| 决策 | [ADR 索引](docs/adr/README.md) |

## 技术栈摘要

| 层级 | 技术 |
|------|------|
| 前端 | React 18, TypeScript, Vite, shadcn/ui, Tailwind CSS, TanStack Query |
| 后端 | JDK 17, Spring Boot 3.2, Spring Cloud Alibaba, **Spring Data JPA**, PostgreSQL |
| 智能体 | Python 3.11, FastAPI, LangGraph（Phase 3） |
| 基础设施 | Nacos, Redis, MinIO, Docker Compose（开发）/ Kubernetes（生产） |

## 文档版本

- 规格书版本：**v1.0-draft**
- 最后更新：2026-06-23
- 状态：**待细化确认**
