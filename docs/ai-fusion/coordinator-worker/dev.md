# Coordinator–Worker 开发设计与任务清单

> 文档角色：本需求的**开发落地说明**（在独立目录内与 PRD/架构并列）。  
> 上游：[prd.md](prd.md) · [architecture.md](architecture.md) · [adr.md](adr.md) · [spec.md](spec.md)  
> 版本：v1.0｜日期：2026-08-04｜状态：C0 文档已齐；实现从 C1 起

---

## 1. 开发目标

在现有 `mis-copilot` + `agent__invoke` 基线上，按 OpenHarness **Coordinator / Worker 语义**升级委派链路：

1. 将 Agent `mis-copilot` **配置为 Coordinator 模式**运行（`agent_id` 不变）。
2. 委派前强制 **TaskBrief 上下文裁剪**。
3. 回传 **task_notification / dispatch_trace**。
4. 用 **WorkerCatalog** 管理可委派 Worker；前端对话只暴露 Coordinator。

**不做：** 直用 OH subprocess Swarm；用 AgentRouter 替换管理台对话调度。

---

## 2. 影响范围（代码）

| 区域 | 路径 | 改动性质 |
|------|------|----------|
| 委派工具 | `agent/ai-platform/backend/src/skills/tools/invoke_agent.py` | C1 核心：Brief 校验、结果信封 |
| 工具注册 | `agent/ai-platform/backend/src/runtime/tool_registry_builder.py` | Catalog / 工具描述 |
| Coordinator 配置 | `agent/ai-platform/configs/agents/mis-copilot/` | role、prompt、allowed_tools |
| Worker 配置 | `configs/agents/mis-rag` 等 | role=worker；接入元数据 |
| 运行时声明 | `backend/src/runtime/factory.py` | 修正 multi_agent 能力描述与真实能力一致 |
| BFF | `backend/mis-admin-bff/.../Ai*` | 透传 `dispatch_trace`（若尚未） |
| 前端 | `frontend/mis-admin-web/src/features/ai/` | C4：选择器仅 Coordinator；调度轻提示 |
| 单测 | `backend/tests/test_invoke_agent.py` 等 | 黄金委派用例 |

---

## 3. 分期任务（与 Spec C0–C5 对齐）

### C0 — 文档（已完成）

- [x] PRD / 架构 / ADR / Spec 集中至本目录
- [x] 本开发设计文档

### C1 — TaskBrief + 可观测（下一实现优先）

| 任务 | 说明 | 验收 |
|------|------|------|
| TaskBrief 模型 | goal / purpose / inputs / constraints / expected_output | 缺关键字段拒委派 |
| Brief 渲染进 content | `agent__invoke` 入参校验或自动渲染 | Worker 只收到分片，无全量历史 |
| page_context_slice | 按 Worker 契约选字段并脱敏 | 禁止整页倾倒 |
| task_notification | 统一 status / summary / result / latency | 可测可日志 |
| dispatch_trace | 写入会话事件或 BFF 响应 metadata | 前端可展示 |
| 单测 | A1–A5 黄金问句可观测到正确 worker_id | pytest 绿 |

### C2 — Coordinator 模式强化

| 任务 | 说明 |
|------|------|
| 重写 `mis-copilot` system prompt | 对齐 OH Writing Worker Prompts + 意图表 |
| WorkerCatalog 初版 | 从 agent.yaml 收集 when_to_use / capabilities |
| 降低懒委托 | 「帮我查一下」类须被 Brief 校验拦住或要求重写 |

### C3 — 配置显式化

| 任务 | 说明 |
|------|------|
| `agent.role: coordinator \| worker` | 平台按 role 注入工具与纪律 |
| Catalog ↔ 工具 schema 同步 | 委派工具描述动态列出 Worker |
| 修正虚假 multi_agent 声明 | 与真实 Adapter 能力一致 |

### C4 — 前端收敛

| 任务 | 说明 |
|------|------|
| Agent 选择器 | 仅列出 role=coordinator（默认 mis-copilot） |
| 调度提示 UI | 消费 dispatch_trace 轻文案 |
| 专用页文案 | 不表述为「选择智能体」 |

### C5 — 增强（可选）

| 任务 | 说明 |
|------|------|
| send_message 续聊 | Continue vs Spawn |
| 同轮并行 spawn | 独立只读任务 |
| task_stop / 超时熔断 | 生命周期管控 |

---

## 4. 委派决策（开发须实现的逻辑）

见 [spec.md §5](spec.md) 与 [architecture.md](architecture.md)。实现要点：

1. 意图 → Worker / formfill / 直答（固定表）。
2. 仅白名单可派；`max_depth=1`。
3. 派前组装 TaskBrief；派后汇总转述。
4. 多步：串行再规划（先看上一轮 notification）。

现网过渡：继续 `agent__invoke`，行为向上述语义靠拢；目标态可双名 `agent`。

---

## 5. 测试计划

| 类型 | 内容 |
|------|------|
| 单测 | 白名单、深度、Brief 校验、禁止自调、超时 |
| 集成 | chat → mis-copilot → mis-rag / crm-assistant 黄金路径 |
| 回归 | 专用页直连 extract/summary/rag 不受损；FormFill HITL |
| 评测集 | PRD A1–A7；正确率门槛见 PRD G2 |

---

## 6. 风险与依赖

| 风险 | 缓解 |
|------|------|
| LLM 误调 Worker | Brief 校验 + 黄金集 + 可选 IntentGate |
| CRM MCP 不可达 | 友好错误，禁止臆造（已有约束） |
| 与 OH 升级 API 漂移 | Adapter 隔离；契约测锁定信封字段 |
| 前端双入口混淆 | C4 文案与选择器收敛 |

---

## 7. 建议实施顺序

1. **C1**（平台）：Brief + trace（收益最大、改动集中在 invoke 路径）  
2. **C2**（配置/prompt）  
3. **C3**（role + Catalog）  
4. **C4**（前端）  
5. **C5**（按需）

---

## 8. 关联

- 目录首页：[README.md](README.md)  
- 需求 / 架构 / 决策 / 规范：同目录 `prd` / `architecture` / `adr` / `spec`
