# MIS Platform 文档中心

## 文档状态说明

| 标记 | 含义 |
|------|------|
| ✅ 已定稿 | 可作为开发依据 |
| 📝 草稿 | 已有内容，待细化确认 |
| ⏳ 待补充 | 仅占位，尚未编写 |

## 目录结构

```
docs/
├── README.md                          # 本文件 — 文档索引
├── architecture/                      # 架构设计
│   ├── 01-overview.md                 # 📝 项目总览与目标
│   ├── 02-system-architecture.md      # 📝 系统架构与分层
│   └── 04-app-module-mfe.md           # 📝 APP/模块/微前端模型
├── database/                          # 数据设计
│   ├── schema-design.md               # 📝 表结构、索引、ER
│   ├── schema-discussion.md           # 📝 Schema 细化讨论稿（当前重点）
│   └── seed-data.md                   # 📝 初始化与种子数据
├── api/                               # 接口契约
│   ├── api-specification.md           # 📝 REST API 全量清单
│   └── permissions.md                 # 📝 权限点与菜单树
├── frontend/                          # 前端设计
│   └── admin-web-design.md            # 📝 页面、路由、组件、状态
├── backend/                           # 后端设计
│   ├── microservices.md               # 📝 微服务职责与通信
│   ├── common-modules.md              # 📝 公共模块与横切能力
│   └── api-permission-mapping.md      # 📝 API↔permission 映射表
├── agent/                             # 智能体设计
│   └── ai-agent-design.md             # 📝 Python AI 层（Phase 1 骨架 + Phase 3 能力）
├── devops/                            # 运维与工程
│   ├── local-dev.md                   # 📝 本地环境与端口
│   └── ci-cd.md                       # 📝 流水线与质量门禁
├── project/                           # 项目管理
│   ├── decisions.md                   # ✅ 已确认全局决策
│   ├── sprint-plan.md                 # 📝 Sprint 分解与验收
│   └── conventions.md                 # 📝 编码与 Git 规范
└── adr/                               # 架构决策记录
    └── README.md                      # 📝 ADR 索引
```

## 阅读顺序建议

1. [项目总览](architecture/01-overview.md) — 了解目标与范围
2. [系统架构](architecture/02-system-architecture.md) — 理解分层与服务划分
3. [表结构设计](database/schema-design.md) — 数据模型
4. [接口规范](api/api-specification.md) + [权限清单](api/permissions.md) — 前后端契约
5. [管理后台设计](frontend/admin-web-design.md) — 前端实现规格
6. [微服务划分](backend/microservices.md) — 后端实现规格
7. [Sprint 计划](project/sprint-plan.md) — 实施节奏与验收

## 细化与更新流程

1. 在对应文档中标注「待确认项」或新增章节
2. 讨论确认后更新文档，同步修改关联文档（如改表结构需同步 API 文档）
3. 重大决策写入 `adr/` 并更新索引
4. 全部「待确认项」清零后，将文档状态改为 ✅，方可开工

## 待确认项汇总（全局）

> 第一步、第三步已确认项见 [decisions.md](project/decisions.md)。Schema 讨论见 [schema-discussion.md](database/schema-discussion.md)。

| # | 主题 | 状态 |
|---|------|------|
| 1–7 | 单库、管理员、JWT、Flowable、中文、K8s、LLM | ✅ 已确认 |
| 8 | 团队分工 | ⏳ 待定 |
| 9–10 | 缓存、WebClient | ✅ ADR-006/007 |
| 11 | Maven 构建 | ✅ 已确认 |
| 12 | Schema 细化 | 📝 [讨论中](database/schema-discussion.md) |

## 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0-draft | 2026-06-23 | 初版文档体系 |
| v1.0-draft | 2026-06-23 | ADR-010 菜单/按钮/sys_menu_api |
| v1.1-discussion | 2026-06-23 | 全局决策确认；Maven；schema-discussion 讨论稿 |
| v1.2-discussion | 2026-06-23 | ADR-011 sys_api + code 层级 + 多 APP 隔离登录 |
| v1.2-discussion | 2026-06-23 | F5 多 Tab、F6 AI 占位纳入 Phase 1 |
