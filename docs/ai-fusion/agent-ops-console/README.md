# 智能体运营控制台文档目录

> MIS **host App（优先）** × ai-platform **运行时**  
> 运营控制台：Agent / Skill / MCP / 会话 / 企微 / Catalog / 调度观测  
> 本目录：PRD / 界面设计 / 架构 / ADR / Spec。

## 阅读顺序

| 顺序 | 文档 | 说明 |
|------|------|------|
| 1 | [prd.md](prd.md) | 产品需求 |
| 2 | [ui.md](ui.md) | **界面设计**（`/agent/**`，强制 #1–#10） |
| 3 | [architecture.md](architecture.md) | host App + BFF + ai-platform |
| 4 | [adr.md](adr.md) | 决策：host App 优先；运行时不搬 Java |
| 5 | [spec.md](spec.md) | 路由、BFF API、权限码、分期 |

## 一句话结论

- **UI**：MIS 门户 **`sys_app=agent`** + `features/agent`（对标 `kb`）。  
- **运行时**：仍在 **`agent/ai-platform`**（YAML / 委派 / Skill 执行 / Gateway）。  
- **权限**：菜单与 Skill 执行码走 **mis-system `sys_role`**；未授权 Skill **全路径不可执行**。  
- **非目标**：业务多 Agent 选择器；运行时级 `mis-agent`（本期）。

## 已确认边界

| 项 | 结论 |
|----|------|
| 产品定位 | 平台运营控制台 |
| 界面落点 | **host App 优先**（`/agent/**`） |
| 运行时 | ai-platform |
| 业务对话 | mis-admin-web Copilot；仅 Coordinator |
| 界面必含 | [ui.md](ui.md) #1–#10 |

## 关联代码（目标落点）

| 区域 | 路径 |
|------|------|
| host App 前端 | `frontend/mis-admin-web/src/features/agent/`（待建） |
| 门户登记 | `lib/nav/host-apps.ts`、`AppController.ENTERABLE_CODES` |
| BFF | `backend/mis-admin-bff/...` AgentOps Facade / WebClient（待建） |
| 运行时 | `agent/ai-platform/backend`、`gateway`、`configs/` |
| 种子 | `mis-migrator`：`sys_app`/`sys_menu`/权限（待建） |
| C–W | [`../coordinator-worker/`](../coordinator-worker/README.md) |
| 融合总览 | [`../README.md`](../README.md) |
