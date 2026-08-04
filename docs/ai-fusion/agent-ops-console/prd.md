# 智能体运营控制台需求文档（PRD）

> 文档角色：AI 平台运营控制台的**产品级需求锁定**。  
> 上游：[adr.md](adr.md) · [architecture.md](architecture.md)  
> 界面设计（强制 IA）：[ui.md](ui.md)  
> 下游技术契约：[spec.md](spec.md)  
> 本目录首页：[README.md](README.md)  
> 协同规范：[../coordinator-worker/](../coordinator-worker/README.md)  
> 版本：v1.2｜状态：✅ 需求已发布｜日期：2026-08-04｜语言：中文

---

## 0. 项目信息

| 项 | 内容 |
|---|---|
| Language | 中文 |
| Project Name | `agent_ops_console` |
| 技术栈（复用既有） | 前端：`agent/ai-platform/frontend`；后端：`agent/ai-platform/backend`；Gateway：`agent/ai-platform/gateway`；配置：`configs/agents/**`、`configs/skills/**` |
| 原始需求复述 | 规划「智能体管理」运营后台；并**强制**覆盖技能池、技能权限、企微多机器人、会话管理、Agent 绑技能、本地对话、技能 CRUD/停用、MCP、人设与配置文件管理。 |
| 产品选型（已确认） | ① 定位 = **平台运营控制台**；② 界面落点 = **ai-platform frontend**（非 MIS host App）。 |
| 界面硬约束 | [ui.md](ui.md) §0 **十项**必须有菜单/路由；含 **Coordinator–Worker 调度配置（#10）**。 |

---

## 1. 产品目标

> 一句话定位：**给平台研发与 AI 运营一套控制台，管理智能体配置与人设、技能池与权限、MCP、企微多机器人与全量会话，并支持本地发起调试对话；业务用户仍只通过「MIS 智能助手」对话。**

| # | 目标 | 关键结果 |
|---|---|---|
| G1 Agent 可运维 | 列表/启停/详情；人设与配置文件可改 | UI #9；Agent 总览可用 |
| G2 技能池闭环 | 池化管理 + 创建/删除/停用 | UI #1 #7 |
| G3 技能权限 | 主体→Skill 运行授权可配 | UI #2 |
| G4 Agent 绑技能 | 每 Agent 可配可用技能集 | UI #5 |
| G5 MCP 可管 | Server 注册/连接/工具可见 | UI #8 |
| G6 企微多机器人 | 多 Bot 配置与启停 | UI #3 |
| G7 会话可管 | 全量记录可查可删 | UI #4 |
| G8 本地对话 | `/chat` 选 Agent 发起 | UI #6 |
| G9 Catalog/调度配置 | 每 Agent 可配 role / 白名单 / Catalog 元数据；全局 Catalog 可管 | UI #10；对齐 C–W Spec |
| G10 调度可观测 | dispatch_trace 可查 | Dispatch 页 |
| G11 业务入口不破坏 | 不向业务暴露多 Agent 选择器 | 与 C–W C4 一致 |

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
| UC-SK-1 技能池浏览 | P0 | #1 | `/admin/skills` 列表/筛选/统计 |
| UC-SK-2 技能创建 | P0 | #7 | 创建自定义 Skill |
| UC-SK-3 技能停用/启用 | P0 | #7 | enable/disable |
| UC-SK-4 技能删除 | P0 | #7 | 确认后删除 |
| UC-SK-5 技能权限配置 | P0 | #2 | `/admin/skills/permissions` 主体授权 |
| UC-AG-1 Agent 绑技能 | P0 | #5 | `/admin/agents/:id/skills` 勾选保存 |
| UC-AG-2 人设与配置编辑 | P0 | #9 | `/admin/agents/:id/config` 编辑保存 |
| UC-CW-1 Agent 调度角色 | P0 | #10 | 设置 `role=coordinator\|worker` |
| UC-CW-2 Coordinator 委派白名单 | P0 | #10 | 勾选可委派 Worker；禁自调 |
| UC-CW-3 Worker Catalog 元数据 | P0 | #10 | when_to_use、capabilities、契约、超时、enabled |
| UC-CW-4 全局 Catalog 页 | P0 | #10 | `/admin/catalog` 浏览/启停；深链到 Agent 调度配置 |
| UC-CW-5 TaskBrief/超时/depth | P1 | #10 | Coordinator 侧治理开关与数值 |
| UC-AG-3 Agent 列表启停 | P0 | — | `/admin/agents` |
| UC-MCP-1 MCP 管理 | P0 | #8 | `/admin/mcp` 注册/连接/工具 |
| UC-CH-1 企微多机器人 | P0 | #3 | `/admin/channels/wecom` CRUD/启停，**≥2 个实例可并存** |
| UC-SS-1 会话列表与详情 | P0 | #4 | `/admin/sessions` 跨用户可查 |
| UC-SS-2 删除会话 | P0 | #4 | 单删/可选批删 |
| UC-CH-2 本地发起对话 | P0 | #6 | `/chat` 选 Agent 发消息 |

### 4.2 协同观测（C–W）

| 用例 | 优先级 | 期望 |
|---|---|---|
| UC-OC-6 调度观测 | P1 | dispatch_trace 列表 |
| UC-OC-9 门户外链 | P2 | 文档说明即可 |

> Catalog / role 配置已升为 **§4.1 强制 UI#10**，不再仅作「扩展」。

---

## 5. 信息架构

**权威界面设计见 [ui.md](ui.md)。** 摘要：

| 分组 | 路径 | UI# |
|---|---|---|
| 本地对话 | `/chat` | #6 |
| 会话管理 | `/admin/sessions` | #4 |
| Agent 总览 | `/admin/agents` | — |
| Agent 可用技能 | `/admin/agents/:id/skills` | #5 |
| Agent 人设与配置 | `/admin/agents/:id/config` | #9 |
| **Agent 调度配置（C–W）** | `/admin/agents/:id/coordination` | **#10** |
| **Worker Catalog** | `/admin/catalog` | **#10** |
| 调度观测 | `/admin/dispatch` | — |
| 技能池 | `/admin/skills` | #1 #7 |
| 技能权限 | `/admin/skills/permissions` | #2 |
| MCP 管理 | `/admin/mcp` | #8 |
| 企微机器人 | `/admin/channels/wecom` | #3 |
| 系统监控 / 审批 / 用户 | 既有路径 | — |

**验收门禁：** 无 [ui.md](ui.md) §5 对照表任一项「菜单可见=否」，则界面设计验收不通过。

---

## 6. 功能需求明细

### 6.1 前端（必须进界面）

| ID | 需求 | UI# | 优先级 |
|---|---|---|---|
| FR-FE-SK-1 | 技能池页：列表/筛选/统计/重建索引 | #1 | P0 |
| FR-FE-SK-2 | 技能创建、删除、启用/停用 | #7 | P0 |
| FR-FE-SK-3 | 技能权限页：按 Skill 配置用户/角色(/部门) allow/deny | #2 | P0 |
| FR-FE-AG-1 | Agent 总览 + 启停；取消 redirect | — | P0 |
| FR-FE-AG-2 | Agent 可用技能配置页并保存 | #5 | P0 |
| FR-FE-AG-3 | 人设/Prompt/facts/model/runtime 等编辑器 | #9 | P0 |
| FR-FE-CW-1 | Agent「调度配置」页：role 切换；Coordinator/Worker 分表单 | #10 | P0 |
| FR-FE-CW-2 | Coordinator：可委派 Worker 多选、TaskBrief/超时/depth/trace 开关 | #10 | P0 |
| FR-FE-CW-3 | Worker：when_to_use、capabilities、契约、安全级别、降级文案、catalog.enabled | #10 | P0 |
| FR-FE-CW-4 | 全局 Catalog 页 + 深链到 Agent 调度配置；总览展示 role 徽章 | #10 | P0 |
| FR-FE-MCP-1 | MCP 管理页：注册/连接/断开/工具/健康 | #8 | P0 |
| FR-FE-CH-1 | 企微机器人页：多 Bot CRUD、启停、脱敏凭证 | #3 | P0 |
| FR-FE-SS-1 | 会话管理：全量列表、详情消息、删除 | #4 | P0 |
| FR-FE-CHAT-1 | 本地对话页标明运营调试，可选 Agent 发起 | #6 | P0 |
| FR-FE-NAV-1 | 侧栏按 [ui.md](ui.md) §2 完整注册 | 全部 | P0 |
| FR-FE-UX-1 | loading / empty / error；危险操作二次确认 | — | P0 |

### 6.2 后端 / Gateway

| ID | 需求 | 优先级 |
|---|---|---|
| FR-BE-SK-1 | 既有 Skill CRUD/enable/disable API 对齐 UI | P0 |
| FR-BE-SK-2 | Skill ACL API（主体×skill×allow/deny）；运行时强制校验 | P0（现网缺口，需新建） |
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
| FR-MIS-1 | 不新建 host App | P0 |
| FR-MIS-2 | 运营 API 不经 BFF 暴露给业务主路径 | P0 |
| FR-MIS-3 | 技能 ACL 主体 ID 与 MIS 用户/角色对齐（JWT claims） | P0 |
| FR-MIS-4 | 业务 Copilot 仅 Coordinator（C–W C4） | — |

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

**做：** ui.md 九项 + Agent 运维 + Catalog/调度（分期）+ 本地调试对话。

**不做：**

- MIS 门户 host App、业务多 Agent 选择器
- 新建 `mis-agent` Java 领域服务（配置真相仍在 ai-platform）
- 用控制台替代知识库内容管理 / CRM 主数据管理
- 无校验的任意宿主机文件浏览器

---

## 9. 分期与验收

| 阶段 | 产品交付 | 验收 |
|---|---|---|
| **O0** | 文档齐套（含 **ui.md**） | 九项均写入界面设计 |
| **O1a** | 技能池 CRUD/停用 + 本地对话文案 + Agent 总览 | UI #1 #6 #7；B1 |
| **O1b** | 会话列表/详情/删除 | UI #4 |
| **O1c** | MCP 管理页 | UI #8 |
| **O1d** | Agent 绑技能 + 人设/配置编辑 | UI #5 #9 |
| **O1g** | **C–W 调度配置页 + Catalog 页**（role/白名单/元数据） | UI #10；可与 C2–C3 并行 |
| **O1e** | 技能权限 ACL | UI #2 |
| **O1f** | 企微多机器人 | UI #3 |
| **O2** | Dispatch 观测 | 依赖 C1 |
| **O3** | Catalog↔工具 schema 深度同步、虚假 multi_agent 修正 | 依赖 C3；承接 O1g |
| **O4** | 门户外链说明 | 文档 |

### 黄金验收用例

| # | 场景 | 期望 |
|---|---|---|
| B1 | 侧栏对照 ui.md §5 | 九项菜单均存在 |
| B2 | 创建→停用→删除 Skill | 状态正确 |
| B3 | 为角色授权 Skill，无权限用户触发被拒 | ACL 生效 |
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
| Q1 | Skill ACL 默认策略 | 未授权 = 不允许显式 `skill` 执行（fail-closed）；平台管理员豁免 |
| Q2 | 多企微 Bot 热更新 | 优先管理 API + Gateway 热加载；否则保存后滚动重启并 UI 提示 |
| Q3 | 会话列表数据源 | SessionManager/DB 扩展 list；保留期可配 |
| Q4 | 配置文件可编辑路径白名单 | 仅 `configs/agents/<id>/` 下约定相对路径 |
| Q5 | traces 存储 | 同原 Q1：环形缓冲 → Redis/PG |

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
