# MIS × ai-platform Coordinator–Worker 需求文档（PRD）

> 文档角色：管理台对话调度升级的**产品级需求锁定**。  
> 上游：[adr.md](adr.md)（ADR）· [architecture.md](architecture.md)（架构）  
> 下游技术契约：[spec.md](spec.md)（规范）  
> 本目录首页：[README.md](README.md)  
> 用途：锁定最终效果、边界、验收与分期；供架构/研发实现。  
> 范围：**简单 PRD，不做竞品分析**；不写实现代码。  
> 版本：v1.0｜状态：✅ 需求已发布｜日期：2026-08-04｜语言：中文

---

## 0. 项目信息

| 项 | 内容 |
|---|---|
| Language | 中文 |
| Project Name | `coordinator_worker_orchestration` |
| 技术栈（复用既有） | 前端：mis-admin-web Copilot / H5 embed；BFF：`mis-admin-bff` `/api/v1/ai/*`；AI：`agent/ai-platform`（默认 runtime=`openharness`） |
| 原始需求复述 | 用户在对话里**只选择一个智能体**；由系统自动识别意图并调度专业子能力完成复杂工作（问知识→RAG，CRM 问数→crm-assistant 等）；该模式须成为后续 AI 业务扩展的基座。 |
| 现状（关键事实） | ① `mis-copilot` 已能通过自定义工具 `agent__invoke` 委托白名单 Agent；② 与 OpenHarness 官方 Coordinator/Worker（Swarm）语义未完全对齐（无强制 TaskBrief、无标准结果信封、无 TeamRegistry 接线）；③ 专用页 `/ai/extract|summary|rag` 仍直连 Worker；④ 能力位声明 `multi_agent=true` 超前于实现。 |

---

## 1. 产品目标

> 一句话定位：**对话入口永远是一个「智能助手」；背后的专业能力是可插拔 Worker，由协调者按任务裁剪上下文后自动调度，用户不必也不会去选子智能体。**

| # | 目标 | 关键结果（可衡量） |
|---|---|---|
| G1 单入口 | 管理台对话智能体选择器仅暴露已配置为 **Coordinator 模式**的 Agent（默认 `mis-copilot`，展示名「MIS 智能助手」） | 选择器可选 Agent 数 = 1；用户无法选手动选 `mis-rag` / `crm-assistant` 等 |
| G2 自动调度 | 问知识、CRM 问数、抽取、摘要、填单等意图由 Coordinator 自动委派正确 Worker/工具 | 黄金问句集（≥20 条）意图→Worker 正确率 ≥ 90%（可配置评测） |
| G3 上下文裁剪 | 委派时只传与任务相关的分片上下文，不传 Coordinator 全量会话 | 100% 委派经 TaskBrief；抽样审计无「整包历史转发」 |
| G4 可观测 | 用户与运维可感知「调用了哪类能力」 | 响应含 `dispatch_trace`；关键路径可查 task_notification |
| G5 可扩展基座 | 新业务域以注册 Worker 接入，不改前端选 Agent 模型 | 新增 1 个 Worker 不改 Agent 选择器即可被对话调度（完成 Catalog/白名单/评测后） |
| G6 安全可控 | 身份透传、深度限制、写操作 HITL；失败可降级说明 | Worker 不可再委派；MCP 失败不臆造业务数据；写操作需用户确认 |

---

## 2. 用户故事

1. As a 业务用户，I want 只和一个「MIS 智能助手」对话，so that 我不必理解 RAG/CRM/抽取等多个智能体。
2. As a 业务用户，I want 问制度时自动检索知识库并带依据回答，so that 我得到可信结论而非通用闲聊。
3. As a 业务用户，I want 问会员积分/画像时自动走 CRM 能力，so that 我不用打开专用 CRM 页也能问数。
4. As a 业务用户，I want 看到「已调用知识库/CRM」之类轻提示，so that 我知道助手在做什么，但不必选 Worker。
5. As a 业务录入员，I want 填单仍走确认流程，so that AI 只辅助、不擅自提交。
6. As a 平台研发/运营，I want 用标准清单接入新 Worker（如 HR/财务），so that 扩展不必改前端选择器与 BFF 主入口。
7. As a 无相关权限用户，I want 不可用的能力被拒绝或隐藏，so that 不会越权或看到混乱错误。

---

## 3. 用例目录

### 3.1 总览

| 用例 | 优先级 | 触发 | 期望调度 | 说明 |
|---|---|---|---|---|
| UC-CW-1 闲聊/文案 | P0 | Copilot 对话 | **不**调度 Worker | Coordinator 直接答 |
| UC-CW-2 知识问答 | P0 | 「制度/手册/规定…」 | `mis-rag` | 需引用或明确无命中 |
| UC-CW-3 CRM 问数 | P0 | 「会员/积分/画像…」 | `crm-assistant` | MCP 不可达时友好错误，禁止臆造 |
| UC-CW-4 字段抽取 | P1 | 「从这段话抽出…」 | `mis-extract` | 对话路径；专用页可直连 |
| UC-CW-5 文本摘要 | P1 | 「总结/提炼要点…」 | `mis-summary` | 同上 |
| UC-CW-6 智能填单 | P1 | 「帮我填采购单…」 | `formfill__*` | 工具引擎，非对话 Worker；HITL |
| UC-CW-7 多步串行 | P1 | 「先查制度再总结」 | 先 rag 再 summary（再规划） | Coordinator 综合后再派 |
| UC-CW-8 调度可视 | P0 | 任意成功委派 | 展示/返回 `dispatch_trace` | 前端轻提示 |
| UC-CW-9 新 Worker 接入 | P1 | 运营注册新域 Worker | 对话可调度且选择器不变 | 扩展基座验收 |
| UC-CW-10 专用页直连 | P1 | `/ai/rag` 等 | **不经** Coordinator | 避免双重 LLM；不叫「选智能体」 |

### 3.2 用例详述

#### UC-CW-1 闲聊 / 文案（P0）

- **输入**：概念解释、写通知/邮件草稿等，无明确专业工具意图。
- **行为**：Coordinator 直接回答；`dispatch_trace` 为空或 intent=`chitchat`。
- **验收**：不出现对 `mis-rag` / `crm-assistant` 等的误调。

#### UC-CW-2 知识问答（P0）

- **输入**：制度、手册、知识库相关自然语言问题；可带脱敏 `page_context`。
- **行为**：组装 TaskBrief → 委派 `mis-rag` → 汇总为面向用户的中文回答。
- **验收**：黄金集命中 `mis-rag`；无命中时说明原因，不编造条款。

#### UC-CW-3 CRM 问数（P0）

- **输入**：会员、积分、等级、画像、客户查询类问题。
- **行为**：委派 `crm-assistant`（经 MCP）；失败时返回可操作提示。
- **验收**：不可达 MCP 时**零**臆造会员数据；trace 含 `crm-assistant`。

#### UC-CW-4 / UC-CW-5 抽取与摘要（P1）

- **对话路径**：经 Coordinator 委派对应 Worker。
- **工作台路径**：专用页可直连；产品上不展示为可选智能体。
- **验收**：两种路径结果语义一致；对话路径有 trace。

#### UC-CW-6 智能填单（P1）

- **行为**：走 `formfill__*`，不走 `agent__invoke`。
- **验收**：落库/提交前必须用户确认（HITL）。

#### UC-CW-7 多步串行再规划（P1）

- **行为**：第一轮 Worker 结果返回后，Coordinator 可再派下一 Worker（动态再规划）。
- **首版约束**：串行；并行 spawn / 续聊同一 Worker 为后续阶段。
- **验收**：至少 1 条「先 A 后 B」黄金用例端到端通过。

#### UC-CW-8 调度可视（P0）

- **输出**：`dispatch_trace[]`（intent / worker_id / status / latency_ms 等）。
- **前端**：轻量状态文案（如「已查询知识库」），不暴露 Worker 选择器。

#### UC-CW-9 新 Worker 接入（P1）

- **交付物**：按 Spec「Worker 接入清单」完成元数据、YAML、白名单、黄金问句。
- **验收**：选择器仍仅 Coordinator；对话可调度到新 Worker。

#### UC-CW-10 专用页直连（P1）

- **行为**：保持现有 BFF capability → Worker 直连。
- **验收**：文档与 UI 文案不将其表述为「选择智能体」。

---

## 4. 功能需求明细

### 4.1 前端（产品行为）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-FE-1 | 对话 Agent 选择器仅列出 Coordinator | P0 |
| FR-FE-2 | 默认对话入口固定 `capability=chat` → Agent `mis-copilot`（该 Agent 按 Coordinator 模式运行） | P0 |
| FR-FE-3 | 展示调度轻提示（消费 `dispatch_trace`） | P0 |
| FR-FE-4 | 专用 AI 工作台页保留，定位为能力页而非 Agent 选择 | P1 |
| FR-FE-5 | AI 不可用/无权限时主业务 CRUD 不受阻 | P0 |

### 4.2 平台调度（ai-platform）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PL-1 | Coordinator 支持意图识别并委派白名单 Worker | P0 |
| FR-PL-2 | 委派前组装/校验 TaskBrief（目标、用途、相关输入切片、约束、期望输出） | P0 |
| FR-PL-3 | Worker 不可见 Coordinator 全量对话历史 | P0 |
| FR-PL-4 | `page_context` 仅以脱敏相关切片进入 Worker，禁止整页倾倒 | P0 |
| FR-PL-5 | 返回 task_notification 形结果 + 对外 `dispatch_trace` | P0 |
| FR-PL-6 | `max_depth=1`；禁止委托 Coordinator 自身 | P0 |
| FR-PL-7 | WorkerCatalog（由 agent YAML 生成）驱动可委派列表与工具描述 | P1 |
| FR-PL-8 | 配置显式 `role: coordinator \| worker`（目标态） | P1 |
| FR-PL-9 | 支持根据上轮结果再规划下一 Worker（串行） | P1 |
| FR-PL-10 | 可选：并行 spawn / send_message 续聊 / task_stop | P2 |
| FR-PL-11 | 委派实现采用 MIS Adapter（in-process AgentManager），不直用 OH subprocess coding AgentTool | P0 |

### 4.3 BFF / 契约

| ID | 需求 | 优先级 |
|---|---|---|
| FR-BF-1 | `chat` → `mis-copilot` 映射保持稳定；由配置保证该 Agent 以 Coordinator 模式运行 | P0 |
| FR-BF-2 | 透传/暴露 `dispatch_trace`（或等价字段）给前端 | P0 |
| FR-BF-3 | 专用 capability（extract/summary/rag）直连行为保留并文档化 | P1 |

---

## 5. 非功能需求

| ID | 类别 | 要求 |
|---|---|---|
| NFR-1 | 安全 | JWT 身份透传；写操作 HITL；敏感字段脱敏 |
| NFR-2 | 可靠 | 单 Worker 超时可配置（默认 120s）；失败可向用户说明 |
| NFR-3 | 可观测 | 委派日志含 task_id / worker_id / latency / status |
| NFR-4 | 扩展 | 新 Worker 接入不强制改前端选择器与 chat 主路径 |
| NFR-5 | 兼容 | 不破坏现有专用页与 FormFill；过渡期保留 `agent__invoke` 别名 |
| NFR-6 | 运行时 | Coordinator–Worker 契约与 `runtime.type` 解耦；换运行时须具备 multi_agent 委派面 |

---

## 6. 边界与非目标

**做：**

- 管理台对话的 Coordinator–Worker 基座与扩展契约
- 上下文裁剪（TaskBrief）与调度可视
- 与 OpenHarness **语义**对齐（隔离、自包含委派、结果信封）

**不做（本 PRD）：**

- 直用 OH 默认 subprocess Swarm 跑业务 Worker
- Worker 互调 / 无界深度
- 用 AgentRouter 替换管理台对话调度
- Coordinator 直写业务库绕过 Java API
- 首版完整 DAG 工作流引擎、完整 Plan-Execute 独立模式
- 默认向用户暴露多个主智能体

---

## 7. 分期与验收

对齐规范分期（详见 Spec §10）：

| 阶段 | 产品交付重点 | 验收门槛 |
|---|---|---|
| **C0** | ADR + Spec + **本 PRD** | 文档评审通过 |
| **C1** | TaskBrief 校验、task_notification、`dispatch_trace` | UC-CW-2/3/8；黄金集可观测 |
| **C2** | Coordinator 调度纪律强化、Catalog 初版 | 懒委托/误调率下降 |
| **C3** | role 配置化、Catalog 与工具 schema 同步 | UC-CW-9 路径打通 |
| **C4** | 前端仅 Coordinator + 调度提示 | G1、FR-FE-1/3 |
| **C5** | 并行/续聊/停止（可选） | UC-CW-7 增强场景 |

### 黄金验收用例（摘要）

| # | 用户说法（示例） | 期望 |
|---|---|---|
| A1 | 「差旅报销制度怎么规定」 | → `mis-rag` |
| A2 | 「查一下会员积分」 | → `crm-assistant`；MCP 挂则不编造 |
| A3 | 「帮我写一则放假通知」 | 不调度 Worker |
| A4 | 「从这段话抽出姓名和部门」 | → `mis-extract` |
| A5 | 「总结下面审批意见」 | → `mis-summary` |
| A6 | 「先查制度再总结给领导」 | 串行再规划，两段 trace |
| A7 | 新增 Worker 只配 Catalog | 选择器不变即可调度 |

---

## 8. 待确认项

| # | 项 | 建议默认 |
|---|---|---|
| Q1 | 调度提示文案是否对所有用户展示 | 默认展示轻提示，可配置关闭 |
| Q2 | IntentGate（规则/小模型）是否进 C1 | C1 以 TaskBrief+LLM 调度为主；IntentGate 可并行评估 |
| Q3 | 第二 Coordinator（强隔离域）是否允许 | 默认不允许；须另开 ADR |
| Q4 | 专用页是否中长期全部改走 Coordinator | 默认保留直连；结构化 UI 场景优先直连 |
| Q5 | 智能体运营控制台落点 | **已确认**：`agent/ai-platform/frontend` 运营控制台（非 MIS host App）；见 [`../agent-ops-console/`](../agent-ops-console/README.md) |

---

## 9. 关联文档

| 文档 | 关系 |
|---|---|
| [adr.md](adr.md) | 架构决策 |
| [architecture.md](architecture.md) | 架构说明 |
| [spec.md](spec.md) | 技术规范 / FAQ / 接入清单 |
| [README.md](README.md) | 本需求文档目录 |
| [../README.md](../README.md) | 融合文档中心 |
| 现网实现 | `agent__invoke`、`configs/agents/mis-copilot/` |
