# 智能体运营控制台需求文档（PRD）

> 文档角色：AI 平台运营控制台的**产品级需求锁定**。  
> 上游：[adr.md](adr.md) · [architecture.md](architecture.md)  
> 界面设计（强制 IA）：[ui.md](ui.md)  
> 下游技术契约：[spec.md](spec.md)  
> 本目录首页：[README.md](README.md)  
> 协同规范：[../coordinator-worker/](../coordinator-worker/README.md)  
> 版本：v1.4｜状态：✅ 需求已发布｜日期：2026-08-05｜语言：中文

---

## 0. 项目信息

| 项 | 内容 |
|---|---|
| Language | 中文 |
| Project Name | `agent_ops_console` |
| 技术栈 | **UI**：`mis-admin-web` `features/agent`（host App）；**BFF**：`mis-admin-bff`；**运行时**：`agent/ai-platform`（backend/gateway/configs）；权限：mis-system / IAM |
| 原始需求复述 | 运营后台强制覆盖技能池/权限、企微多机器人、会话、绑技能、本地对话、技能 CRUD、MCP、人设配置、C–W 调度配置等。 |
| 产品选型（已确认） | ① 定位 = **平台运营控制台**；② **界面 = MIS host App 优先**；③ **运行时仍留 ai-platform**；④ Skill 权限对接 `sys_role`，未授权全路径不可执行。 |
| 界面硬约束 | [ui.md](ui.md) §0 十项，路径前缀 **`/agent/**`**。 |

---

## 1. 产品目标

> 一句话定位：**在 MIS 门户「智能体」host App 中**，为平台研发与 AI 运营提供控制台（人设、技能池与权限、MCP、企微多机器人、会话、C–W 调度配置、本地调试对话）；执行引擎仍在 ai-platform；业务用户仍只通过「MIS 智能助手」对话。

| # | 目标 | 关键结果 |
|---|---|---|
| G1 Agent 可运维 | 列表/启停/详情；人设与配置文件可改 | UI #9；Agent 总览可用 |
| G2 技能池闭环 | 池化管理 + 创建/删除/停用 | UI #1 #7 |
| G3 技能权限 | 向 mis-system 角色授予执行码；未授权全路径不可跑 | UI #2 |
| G4 Agent 绑技能 | 每 Agent 可配可用技能集 | UI #5 |
| G5 MCP 可管 | Server 注册/连接/工具可见 | UI #8 |
| G6 企微多机器人 | 多 Bot 配置与启停 | UI #3 |
| G7 会话可管 | 全量记录可查可删 | UI #4 |
| G8 本地对话 | host App `/agent/chat` 选 Agent | UI #6 |
| G9 Catalog/调度配置 | role / 白名单 / Catalog 元数据 | UI #10 |
| G10 调度可观测 | dispatch_trace | Dispatch 页 |
| G11 业务入口不破坏 | 不向业务暴露多 Agent 选择器 | C–W C4 |
| G12 门户可进 | `sys_app=agent` enterable | 对标 kb |

---

## 2. 用户与角色

| 角色 | 诉求 |
|---|---|
| 平台研发 | 改人设/Prompt、绑技能、管 MCP、本地调试、查会话与调度 |
| AI 运营 | 技能启停与权限、企微机器人、会话清理、Catalog |
| 渠道运营 | 多企微机器人凭证与回调 |
| 业务用户 | **不是本产品用户** |

---

## 3. 用户故事

1. As a 运营，I want 在技能池里创建/停用/删除 Skill，so that 能力供给可控。
2. As a 运营，I want 配置「谁可以运行哪些 Skill」，so that 敏感技能不会被无关人触发。
3. As a 渠道运营，I want 配置**多个**企微机器人，so that 不同业务线可独立接入。
4. As a 运营，I want 查看并删除任意会话记录，so that 可审计与清理。
5. As a 研发，I want 给某个智能体勾选可用技能，so that 运行时工具面正确。
6. As a 研发，I want 在本地对话页选 Agent 直接聊，so that 快速验证。
7. As a 研发，I want 管理 MCP Server 连接与工具，so that CRM 等外部能力可控。
8. As a 研发，I want 在线改人设 / system prompt / facts 等文件，so that 不必只靠改仓库发版。
9. As a 研发，I want 在智能体上配置 Coordinator/Worker 角色、可委派列表与 Catalog 元数据，so that 调度行为可在控制台治理（对齐 C–W）。
10. As a 业务用户，I want 日常仍只面对一个智能助手，so that 不被运营控制台影响（C–W）。

---

## 4. 用例目录

### 4.1 强制界面能力（对应 ui.md #1–#9）

| 用例 | 优先级 | UI# | 期望 |
|---|---|---|---|
| UC-SK-1 技能池浏览 | P0 | #1 | `/agent/skills` 列表/筛选/统计 |
| UC-SK-2 技能创建 | P0 | #7 | 创建自定义 Skill |
| UC-SK-3 技能停用/启用 | P0 | #7 | enable/disable |
| UC-SK-4 技能删除 | P0 | #7 | 确认后删除 |
| UC-SK-5 技能权限配置 | P0 | #2 | 向 **mis-system 角色**授予 Skill 执行码；未授权全路径不可执行 |
| UC-AG-1 Agent 绑技能 | P0 | #5 | `/agent/agents/:id/skills` 勾选保存 |
| UC-AG-2 人设与配置编辑 | P0 | #9 | `/agent/agents/:id/config` 编辑保存 |
| UC-CW-1 Agent 调度角色 | P0 | #10 | 设置 `role=coordinator\|worker` |
| UC-CW-2 Coordinator 委派白名单 | P0 | #10 | 勾选可委派 Worker；禁自调 |
| UC-CW-3 Worker Catalog 元数据 | P0 | #10 | when_to_use、capabilities、契约、超时、enabled |
| UC-CW-4 全局 Catalog 页 | P0 | #10 | `/agent/catalog` 浏览/启停；深链到 Agent 调度配置 |
| UC-CW-5 TaskBrief/超时/depth | P1 | #10 | Coordinator 侧治理开关与数值 |
| UC-AG-3 Agent 列表启停 | P0 | — | `/agent/agents` |
| UC-MCP-1 MCP 管理 | P0 | #8 | `/agent/mcp` 注册/连接/工具 |
| UC-CH-1 企微多机器人 | P0 | #3 | `/agent/channels/wecom` CRUD/启停，**≥2 个实例可并存** |
| UC-SS-1 会话列表与详情 | P0 | #4 | `/agent/sessions` 跨用户可查 |
| UC-SS-2 删除会话 | P0 | #4 | 单删/可选批删 |
| UC-CH-2 本地发起对话 | P0 | #6 | `/agent/chat` 选 Agent 发消息 |
| UC-APP-1 门户进入 | P0 | — | 九宫格进入 `agent` App |

### 4.2 协同观测（C–W）

| 用例 | 优先级 | 期望 |
|---|---|---|
| UC-OC-6 调度观测 | P1 | dispatch_trace 列表 |
| UC-OC-9 门户外链 | P2 | 文档说明即可 |

> Catalog / role 配置已升为 **§4.1 强制 UI#10**，不再仅作「扩展」。

---

## 5. 信息架构

**权威界面设计见 [ui.md](ui.md)（路径 `/agent/**`）。**

| 分组 | 路径 | UI# |
|---|---|---|
| 本地对话 | `/agent/chat` | #6 |
| 会话管理 | `/agent/sessions` | #4 |
| Agent 总览 | `/agent/agents` | — |
| Agent 可用技能 | `/agent/agents/:id/skills` | #5 |
| Agent 人设与配置 | `/agent/agents/:id/config` | #9 |
| Agent 调度配置（C–W） | `/agent/agents/:id/coordination` | #10 |
| Worker Catalog | `/agent/catalog` | #10 |
| 调度观测 | `/agent/dispatch` | — |
| 技能池 | `/agent/skills` | #1 #7 |
| 技能权限 | `/agent/skills/permissions` | #2 |
| MCP | `/agent/mcp` | #8 |
| 企微机器人 | `/agent/channels/wecom` | #3 |

**验收门禁：** ui.md §5 对照表任一项缺失，或门户无法进入 `agent` App，则验收不通过。

---

## 6. 功能需求明细

### 6.1 前端（mis-admin-web host App）

| ID | 需求 | UI# | 优先级 |
|---|---|---|---|
| FR-FE-APP-1 | `features/agent` + 路由 `/agent/**` + 门户落地 | — | P0 |
| FR-FE-SK-1 | 技能池页 | #1 | P0 |
| FR-FE-SK-2 | 技能创建、删除、启用/停用 | #7 | P0 |
| FR-FE-SK-3 | 技能权限页：MIS 角色授权 | #2 | P0 |
| FR-FE-AG-1 | Agent 总览 + 启停 | — | P0 |
| FR-FE-AG-2 | Agent 可用技能 | #5 | P0 |
| FR-FE-AG-3 | 人设/配置文件编辑 | #9 | P0 |
| FR-FE-CW-1 | 调度配置页 role 分表单 | #10 | P0 |
| FR-FE-CW-2 | Coordinator 白名单 / TaskBrief / 超时等 | #10 | P0 |
| FR-FE-CW-3 | Worker Catalog 元数据 | #10 | P0 |
| FR-FE-CW-4 | 全局 Catalog 页 | #10 | P0 |
| FR-FE-MCP-1 | MCP 管理页 | #8 | P0 |
| FR-FE-CH-1 | 企微多机器人 | #3 | P0 |
| FR-FE-SS-1 | 会话列表/详情/删除 | #4 | P0 |
| FR-FE-CHAT-1 | `/agent/chat` 运营调试对话 | #6 | P0 |
| FR-FE-NAV-1 | 侧栏按 ui.md + sys_menu | 全部 | P0 |
| FR-FE-UX-1 | loading / empty / error；危险确认 | — | P0 |

### 6.2 后端 / Gateway

| ID | 需求 | 优先级 |
|---|---|---|
| FR-BE-SK-1 | 既有 Skill CRUD/enable/disable API 对齐 UI | P0 |
| FR-BE-SK-2 | Skill 执行权对接 mis-system：`sys_role` + permission 码；**一切执行路径** fail-closed | P0 |
| FR-BE-SK-3 | 新建/注册 Skill 时同步权限码登记（防 authOnly 静默放行） | P0 |
| FR-BE-SK-4 | 运行时用 MIS 权限码集合鉴权（JWT→IAM/Redis） | P0 |
| FR-BE-AG-1 | Agent 可用技能读写（`enabled-skills` 或等价） | P0 |
| FR-BE-AG-2 | Agent 配置文件读写 API（路径白名单 + 校验 + 热更新） | P0 |
| FR-BE-CW-1 | `agent.role` 读写；Coordinator 禁止入白名单 | P0 |
| FR-BE-CW-2 | 每 Coordinator 可委派列表 + 全局 WorkerCatalog API | P0 |
| FR-BE-CW-3 | Worker catalog 元数据（when_to_use 等）持久化与热更新 | P0 |
| FR-BE-CW-4 | TaskBrief 强制、timeout、max_depth 配置面（对齐 C–W §12） | P1 |
| FR-BE-MCP-1 | 既有 `/mcp` API 对齐 UI | P0 |
| FR-BE-SS-1 | 会话**列表**（跨用户，运营权限）+ 详情消息 + 删除 | P0（列表可能需扩展） |
| FR-GW-1 | 多企微 Bot 配置模型与管理 API；Gateway 支持多实例回调 | P0（现网多为单 Bot，需扩展） |
| FR-BE-CAT-* | Catalog / dispatch-traces（见原 O2/O3） | P1 |

### 6.3 与 MIS / BFF

| ID | 需求 | 优先级 |
|---|---|---|
| FR-MIS-1 | **新建 host App**：`sys_app(agent)` + 菜单 + `ENTERABLE_CODES` + `host-apps` 落地 | P0 |
| FR-MIS-2 | 浏览器经 BFF `/api/v1/agent-ops/**`（或等价）访问运营能力；不直连 Python | P0 |
| FR-MIS-3 | 技能 ACL：执行码默认挂 **system** App 的 `sys_role`；运营菜单挂 **agent** App 的 `sys_role`；授权 UI 按目标 App 选角色 | P0 |
| FR-MIS-3b | 文档与 UI 文案区分：`sys_role` ≠ Agent YAML `role`；≠ 不存在的 mis-agent 服务角色 | P0 |
| FR-MIS-4 | 业务 Copilot 仅 Coordinator（C–W C4） | — |
| FR-MIS-5 | 运营台角色选择器经 BFF/IAM | P0 |
| FR-MIS-6 | **不**新建运行时级 `mis-agent`；运行时留 ai-platform | P0 |

---

## 7. 非功能需求

| ID | 类别 | 要求 |
|---|---|---|
| NFR-1 | 安全 | JWT；密钥脱敏；配置路径白名单防任意文件读写；会话列表需运营权限 |
| NFR-2 | 可靠 | 校验失败拒绝保存；Gateway 多 Bot 互不影响启停 |
| NFR-3 | 审计 | 技能权限变更、配置保存、会话删除记操作日志（可先结构化日志） |
| NFR-4 | 兼容 | 不破坏 BFF chat；不破坏已有 Skill/Monitor |
| NFR-5 | 扩展 | 新 Skill/MCP/Bot/Agent 均可在 UI 完成接入主路径 |

---

## 8. 边界与非目标

**做：** host App UI（#1–#10）+ BFF 聚合 + ai-platform 运行时 + mis-system 权限。

**不做：**

- 业务用户多 Agent / Worker 选择器  
- 将 QueryEngine/YAML 运行时搬进 Java `mis-agent`（本期）  
- 以 ai-platform/frontend 作为产品主验收面  
- 无校验任意文件浏览；替代 KB/CRM 主数据管理  

---

## 9. 分期与验收

| 阶段 | 产品交付 | 验收 |
|---|---|---|
| **O0** | 文档齐套（host App 优先） | 评审通过 |
| **O1-portal** | `sys_app`+菜单+ENTERABLE+`features/agent` 壳 | 九宫格可进 `/agent/**` |
| **O1a** | 技能池 + 本地对话 + Agent 总览 | UI #1 #6 #7 |
| **O1b** | 会话 | UI #4 |
| **O1c** | MCP | UI #8 |
| **O1d** | 绑技能 + 人设配置 | UI #5 #9 |
| **O1g** | C–W 调度 + Catalog | UI #10 |
| **O1e** | 技能权限对接 `sys_role` | UI #2 |
| **O1f** | 企微多机器人 | UI #3 |
| **O2** | Dispatch | C1 |
| **O3** | Catalog↔schema | C3 |
### 黄金验收用例

| # | 场景 | 期望 |
|---|---|---|
| B1 | 侧栏对照 ui.md §5 | 十项菜单/入口均存在（含 #10） |
| B2 | 创建→停用→删除 Skill | 状态正确 |
| B3 | 角色未授予执行码时，任意路径触发该 Skill | **一律拒绝**（含自动调用） |
| B3b | 授权 UI 角色列表 | 来自 mis-system/`sys_role` |
| B4 | 配置 ≥2 个企微机器人 | 列表并存、可独立停用 |
| B5 | 会话页查看消息并删除 | 记录消失 |
| B6 | 给 Agent 绑定技能并本地对话验证 | 工具面符合配置 |
| B7 | 修改 personality / system prompt 保存 | 新会话生效 |
| B8 | MCP 连接并查看 tools | 状态健康 |
| B9 | 将 mis-copilot 视为 coordinator，勾选可委派 Worker | 白名单生效；不可自选 |
| B10 | 编辑 mis-rag 的 when_to_use / enabled | Catalog 与委派可见性同步 |
| B11 | 业务 Copilot | 仍仅 Coordinator |

---

## 10. 待确认项

| # | 项 | 建议默认 |
|---|---|---|
| Q1 | Skill 未授权策略 | **锁定**：一律不可执行（全路径）；角色对接 `sys_role` |
| Q2 | 多企微 Bot 热更新 | 优先管理 API + Gateway 热加载；否则滚动重启并 UI 提示 |
| Q3 | 会话列表数据源 | SessionManager/DB 扩展 list |
| Q4 | 配置文件可编辑路径白名单 | 仅 `configs/agents/<id>/` 约定相对路径 |
| Q5 | traces 存储 | 环形缓冲 → Redis/PG |
| Q6 | 运行时是否建 mis-agent | **本期不做**；host App + BFF + ai-platform |

---

## 11. 关联文档

| 文档 | 关系 |
|---|---|
| [ui.md](ui.md) | **界面设计（强制）** |
| [adr.md](adr.md) | 架构决策 |
| [architecture.md](architecture.md) | 架构说明 |
| [spec.md](spec.md) | 技术规范 |
| [../coordinator-worker/prd.md](../coordinator-worker/prd.md) | 对话调度 |
| [../README.md](../README.md) | 融合文档中心 |
