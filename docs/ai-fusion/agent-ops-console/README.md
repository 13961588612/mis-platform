# 智能体运营控制台文档目录

> MIS × ai-platform **平台运营控制台**（Agent / Skill / MCP / 会话 / 企微通道 / Catalog / 调度观测）  
> 本目录集中存放本需求的 **PRD / 界面设计 / 架构 / ADR / 技术规范**。

## 阅读顺序

| 顺序 | 文档 | 说明 |
|------|------|------|
| 1 | [prd.md](prd.md) | 产品需求：目标、用例、验收、分期 |
| 2 | [ui.md](ui.md) | **界面设计**：强制含技能/权限/企微/会话/绑技能/本地对话/MCP/人设/**C–W 调度配置**等 |
| 3 | [architecture.md](architecture.md) | 架构说明：模块、数据流、与 C–W / Gateway 关系 |
| 4 | [adr.md](adr.md) | 架构决策记录（ADR） |
| 5 | [spec.md](spec.md) | 技术规范：路由、API、配置、分期 |

## 一句话结论

- **产品**：面向平台研发 / AI 运营的 **运营控制台**，不是业务用户的「智能体选择」应用。  
- **落点**：强化既有 [`agent/ai-platform/frontend`](../../../agent/ai-platform/frontend) 的 `/admin/*` + `/chat`；**不**新建 MIS 门户 host App。  
- **界面硬约束**：[`ui.md`](ui.md) §0 **十项**能力必须有独立菜单/路由（含 **#10 Coordinator–Worker 调度配置**：role、可委派白名单、Catalog 元数据、TaskBrief/超时等）。  
- **协同**：与 [Coordinator–Worker](../coordinator-worker/README.md) 字段与分期对齐。

## 已确认边界（产品选型）

| 项 | 结论 |
|----|------|
| 产品定位 | 平台运营控制台 |
| 界面落点 | `agent/ai-platform/frontend`；门户仅外链或嵌入 |
| 业务对话 | 仍由 mis-admin-web Copilot 承载；仅暴露 Coordinator（见 C–W C4） |
| 界面必含 | 见 [ui.md](ui.md) 强制清单 #1–#10（含 C–W 调度配置） |

## 关联代码（仓库内）

| 区域 | 路径 |
|------|------|
| 前端管理路由 | `agent/ai-platform/frontend/src/routes/` |
| Agent / Session / Skill / MCP API | `agent/ai-platform/backend/src/api/routes/` |
| 企微 Gateway | `agent/ai-platform/gateway/`（`WecomBotAdapter` 等） |
| Agent 配置与人设 | `agent/ai-platform/configs/agents/*/` |
| Skill 包 | `agent/ai-platform/configs/skills/` |
| 对话调度规范 | [`../coordinator-worker/`](../coordinator-worker/README.md) |
| 融合总览 | [`../README.md`](../README.md) |
