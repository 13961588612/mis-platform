# ADR：MIS 对话采用 OpenHarness 语义的 Coordinator–Worker 基座

> 状态：✅ 已确认（规范阶段）｜日期：2026-08-01  
> 范围：`agent/ai-platform` 管理台对话调度；关联实现见 `agent__invoke` / `mis-copilot`  
> 详细契约：[spec.md](spec.md)  
> 产品需求：[prd.md](prd.md)  
> 架构说明：[architecture.md](architecture.md)  
> 本目录：[README.md](README.md)

## 背景

管理台 AI 对话需要「用户只选一个智能体，由系统自动完成复杂任务」（如问知识走 RAG、CRM 问数走 crm-assistant）。  
平台已用自定义工具 `agent__invoke` 实现雏形，但：

1. 与 OpenHarness 官方 **Coordinator / Worker（Swarm）** 语义未对齐；
2. 上下文分片纪律不足（子 Agent 易拿不到自包含任务说明）；
3. `RuntimeCapabilities.multi_agent=True` 已声明，实际未接线 `TeamRegistry` / 官方 `AgentTool`；
4. 缺少「新业务如何扩展」的稳定基座约定。

## 决策

1. **管理台对话采用 Coordinator–Worker 架构**（业界 / OpenHarness 叫法），作为后续 AI 业务扩展基座。
2. **将 Agent `mis-copilot` 配置为按 Coordinator 模式运行**（`agent_id` 不变，以保证 BFF `capability=chat` → `mis-copilot` 映射稳定）；产品展示名可为「MIS 智能助手」。Coordinator 是**运行模式/角色**，不是另起一个 ID。
3. **采用 OpenHarness 调度语义与上下文纪律**（Worker 不可见 Coordinator 全量对话；委派必须自包含 TaskBrief；结果回传对齐 task-notification）。
4. **实现走 MIS Coordinator Adapter（in-process）**：对内继续用平台 `AgentManager` + 各 Worker 自有 `QueryEngine`；**不**直接使用 OH 默认 subprocess `AgentTool` 跑业务 Worker（其面向本地 coding teammate，与 JWT / YAML Worker 不匹配）。
5. **前端智能体选择器仅暴露 Coordinator**；Worker 通过 Catalog 注册扩展，不作为用户可选主智能体。
6. **与 `AgentRouter` 职责分离**：入站渠道（企微等）可继续用 AgentRouter；管理台对话内调度统一走 Coordinator，避免两套委派协议。
7. **默认调度深度 `max_depth=1`**；写操作保持 Human-in-the-loop。

## 概念分层

| 维度 | 名称 | 说明 |
|------|------|------|
| 上层调度 | Coordinator + Worker | 谁委派谁；可插拔扩展 |
| 下层执行 | ReAct / Plan-Execute（QueryEngine 循环） | 嵌在单个 Agent 内部 |

二者不是替代关系：Coordinator 负责调度；Worker 内部用多步工具循环完成专长任务。

## 备选方案

| 方案 | 结论 |
|------|------|
| A. 前端按能力选多个 Agent | 否：扩展成本高，用户心智复杂 |
| B. 仅 LLM 自由调用任意工具、无 Worker 边界 | 否：权限/可观测/专长隔离弱 |
| C. 直用 OH subprocess Swarm | 否：与 MIS 身份与 Agent 配置模型冲突 |
| D. Coordinator Adapter + WorkerCatalog（选定） | 是：对齐 OH 语义，贴合现网 |

## 后果

### 正面

- 新业务默认「注册 Worker」扩展，前端入口稳定
- 与 OpenHarness 术语/纪律一致，降低后续升级成本
- 调度可观测（dispatch_trace / task-notification）可产品化
- 角色契约与运行时解耦：未来可换 `runtime.type`，只要实现 multi_agent 委派面或平台 Middleware

### 负面 / 约束

- 需维护 Adapter，不能假设 OH 升级后 API 完全兼容
- **现网委派仍挂在 OH 工具链**；换 Coordinator 运行时前必须先具备等价 multi_agent 能力
- 专用结构化页（extract/rag 等）仍可直连 Worker，文档需持续标明双路径
- 并行 spawn / send_message 续聊分期落地；动态再规划以串行综合为主（非静态 DAG）

## 补充澄清（2026-08-04）

1. Coordinator–Worker 是**调度角色/运行模式**，不是某一个 `runtime.type` 的别名，也不是「Coordinator 这个名字等于某个固定 ID」。默认把 **`mis-copilot` 配成 Coordinator 模式**。  
2. Coordinator **支持**根据 Worker 结果做多轮再规划；默认不是一次性 Plan-Execute 引擎。  
3. 指定 Coordinator：现网靠 `allowed_tools` + prompt + 白名单将 **`mis-copilot` 配成 Coordinator 模式**；目标态靠 `agent.role: coordinator`（见 Spec §14）。任意 Agent 均可如此配置，平台默认对话入口使用已配置为 Coordinator 的 `mis-copilot`。

## 关联

- 需求：[prd.md](prd.md)
- 架构：[architecture.md](architecture.md)
- 规范：[spec.md](spec.md)（含 §14 FAQ）
- 目录：[README.md](README.md)
- 现网工具：`agent/ai-platform/backend/src/skills/tools/invoke_agent.py`
- Coordinator 配置：`agent/ai-platform/configs/agents/mis-copilot/`
- 运行时抽象：`agent/ai-platform/backend/src/runtime/`
- 融合总览：`docs/ai-fusion/README.md`