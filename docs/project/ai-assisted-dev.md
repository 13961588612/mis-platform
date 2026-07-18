# AI 辅助开发配置

> 状态：✅ 已启用 | 版本：v1.0

本仓库已配置 Cursor Project Rules，用于约束 Agent 角色、工作流与编码行为。

## 配置位置

| 路径 | 说明 |
|------|------|
| [AGENTS.md](../../AGENTS.md) | Agent 入口（角色、流程、规则索引） |
| `.cursor/rules/*.mdc` | Cursor 持久化规则 |
| [conventions.md](./conventions.md) | 编码与 Git 规范全文 |

## 角色摘要

| 角色 | 要点 |
|------|------|
| Product | 范围、用户故事、验收标准 |
| UX | 在 shadcn / 既有后台规范内做信息架构与交互，不另起视觉体系 |
| Architect / Backend / Frontend / Agent-Python / DevOps / Reviewer | 见 [AGENTS.md](../../AGENTS.md) |

## 规则生效策略

- **始终生效**：角色 / 工作流 / 工作规范、Git 与审查清单
- **按文件匹配**：编辑 Java / 前端 / Python / SQL·API 相关文件时自动带上对应编码规范

## 维护说明

- 新增技术栈或分层约定时：同步更新 `conventions.md` 与对应 `.mdc`
- 架构级决策：走 ADR，并在 `decisions.md` 登记；不要只改规则文件绕过评审
- 规则宜短、可执行；细节仍以 `docs/` 为准
