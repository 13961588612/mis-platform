# AGENTS.md — MIS Platform AI 辅助开发指南

本文件供 Cursor / 其他编码 Agent 快速对齐本仓库约定。详细规则见 `.cursor/rules/`。

## 角色怎么用

| 你要做的事 | 主角色 | 先读 |
|------------|--------|------|
| 需求范围、用户故事、验收标准 | Product | `docs/project/decisions.md`、`docs/project/sprint-plan.md`、相关业务文档 |
| 页面信息架构、表单/表格交互、空态 | UX | `docs/frontend/admin-web-design.md`（约束在 shadcn / 既有规范内） |
| 新服务、跨模块、权限模型 | Architect | `docs/architecture/`、`docs/adr/`、`docs/project/decisions.md` |
| 改 Java 微服务 | Backend | `docs/backend/`、对应模块 README、`mis-common` |
| 改管理后台实现 | Frontend | `docs/frontend/admin-web-design.md` |
| 改智能体 | Agent-Python | `docs/agent/ai-agent-design.md` |
| 部署/配置/CI | DevOps | `docs/devops/`、`deploy/` |
| 自检 / 审 diff | Reviewer | `.cursor/rules/git-and-review.mdc` |

新功能默认链路：Product →（可选 UX）→ Architect → Backend/Frontend。

## 工作流程（默认）

1. 查文档与现有代码 → 2. 非平凡改动先给方案（含验收/交互若适用）→ 3. 最小实现 → 4. 测试/自检 → 5. 按需同步文档  
用户未要求时不要 commit / push。

## Cursor 规则一览

| 文件 | 生效方式 |
|------|----------|
| `agent-roles-workflow.mdc` | 始终 |
| `git-and-review.mdc` | 始终 |
| `coding-java.mdc` | `backend/**/*.java` |
| `coding-frontend.mdc` | `frontend/**/*.{ts,tsx}` |
| `coding-python.mdc` | `agent/**/*.py` |
| `coding-sql-api.mdc` | 迁移 / API / 库表文档 |

## 编码规范摘要

- **Java**：Controller → Service → JPA Repository；`Result` 统一响应；Flyway 只追加
- **前端**：`features/` 分域；`@/` 别名；Zustand +（规划中）TanStack Query；shadcn
- **Python**：ruff；经 JWT 调 Java；写操作需确认
- **API/SQL**：`/api/v1`、统一分页与 `code=0`；表名 `sys_*`

全文：`docs/project/conventions.md`。

## 关键路径

- 文档中心：`docs/README.md`
- 代码阅读：`docs/CODE-READING-GUIDE.md`
- 本地开发：`docs/devops/local-dev.md`
