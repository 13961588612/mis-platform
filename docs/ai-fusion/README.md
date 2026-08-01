# MIS × ai-platform 融合文档中心

> 最后更新：2026-07-31 ｜ 范围：MIS 主项目与 `agent/ai-platform` 的 AI 能力融合
> （阶段5 前端 AI 融合 MVP + 后端扩展 T-ext/T-sum/T-stream + 容器/部署融合 + Copilot 调度）

## 当前状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| 阶段1+2 认证对齐 / BFF 适配层 | ✅ | 已落地（历史任务见 `archive/identity-enrichment-task-list.md`） |
| 阶段5 前端 AI 融合 MVP（F0–F7） | ✅ | build 绿（tsc 0 错误，vite build 通过） |
| 阶段5 后端扩展（T-ext/T-sum/T-stream） | ✅ | pytest 175 passed；BFF SSE 流式透传；生产须 `sse-enabled=true` |
| 融合部署（DEP-0~10） | ✅ | 共享 PG/Redis、去 agent nginx、TS gateway 信任 MIS JWT、A2UI 渲染器落地；详见 `decisions/deploy.md` |
| Copilot 调度智能体 | ✅ | `mis-copilot` 经平台工具 `agent__invoke` 委托 `mis-extract` / `mis-summary` / `mis-rag` / `crm-assistant`；FormFill 仍走 `formfill__*` |

## Copilot 调度边界（对话 vs 专用端点）

| 入口 | 行为 |
|------|------|
| 管理台 Copilot（`capability=chat` → BFF → `mis-copilot`） | Copilot 判断意图后可 `agent__invoke` 委托白名单 Agent，或 `formfill__*` 填单 |
| 专用 UI（`/ai/extract` `/ai/summary` `/ai/rag`） | BFF **仍直连**对应 Agent，不经 Copilot（避免双重 LLM） |
| CRM 委托 | 依赖 MCP `mcp-api-suite`（本地常见 `:3333`）；不可达时工具返回友好错误，禁止臆造会员数据 |

白名单配置：`INVOKE_AGENT_WHITELIST`（默认含上述四 Agent）；深度 `INVOKE_AGENT_MAX_DEPTH=1`（禁止递归调度）。

## 目录导航

| 我想看… | 文件 |
|--------|------|
| 融合部署架构决策（H5 入口 / A2UI / PG·Redis 共享 / 去 nginx） | [decisions/deploy.md](decisions/deploy.md) |
| JWT / 身份建模澄清决策 | [decisions/identity-jwt.md](decisions/identity-jwt.md) |
| 阶段5 前端融合 PRD | [specs/phase5-frontend-prd.md](specs/phase5-frontend-prd.md) |
| 阶段5 前端融合设计 | [specs/phase5-frontend-design.md](specs/phase5-frontend-design.md) |
| 阶段5 后端扩展 PRD | [specs/phase5-backend-ext-prd.md](specs/phase5-backend-ext-prd.md) |
| 阶段5 后端扩展设计（含类图/时序图） | [specs/phase5-backend-ext-design.md](specs/phase5-backend-ext-design.md) · [类图](specs/phase5-backend-ext-class.mermaid) · [时序图](specs/phase5-backend-ext-sequence.mermaid) |
| 后端集成契约审计（BFF↔ai-platform） | [specs/phase5-backend-audit.md](specs/phase5-backend-audit.md) |
| 前端 H5 容器构建门禁技术债 | [techdebt.md](techdebt.md) |
| 历史：身份 enrichment 任务清单（已落地） | [archive/identity-enrichment-task-list.md](archive/identity-enrichment-task-list.md) |

## 目录说明

- `decisions/`：当前生效的架构决策评审，作为开发依据。
- `specs/`：各阶段需求 / 设计 / 审计快照，按阶段归档。
- `archive/`：已完成或已过时的历史交付物，仅供追溯。
- 早期探索稿（能力蓝图 PRD、集成架构、可行性评估、阶段1-2 设计）已于 2026-07-24 文档整理时移除——它们已被后续阶段5 的具体 PRD / 设计 / 实现完全取代。
