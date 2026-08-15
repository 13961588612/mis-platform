# MIS 平台 Agent 控制台 · 需求 1.3 / 1.4 产品需求文档（PRD）

> 本文档由产品经理（许清楚）产出，是标准 SOP 第一环。后续架构师 / 工程师 / QA 均以此为准。
> 调研基于 `D:\code\mis-platform` 仓库现状（git 已提交，未改动代码）。

---

## 1. 项目信息

| 项 | 内容 |
| --- | --- |
| Language | 中文 |
| Programming Language | 沿用现有仓库技术栈：前端 `mis-admin-web`（React + TypeScript + Tailwind + shadcn 风格原语）；后端 `ai-platform`（Python，FastAPI） |
| Project Name | `agent_helper_1_3_1_4` |
| 原始需求复述 | 把零散 worker 智能体按**受众**拆成两个 helper，并把"联网搜索"抽象成可插拔 tool：① 新建 `mis-admin-helper`（后台操作用户，内聚 `create_skill`，含浏览现有技能 + 合并生成 + 1.4 联网，**不进 copilot**）；② 新建 `mis-user-helper`（全员，内聚 `extract`+`summary`，**可进 copilot**）；③ 下线旧 `mis-extract`/`mis-summary`；④ copilot 接入改为配置驱动（`coordination.worker_ids`）；⑤ 1.4 联网搜索抽象为 `search` tool（provider 可配置切换）。 |

---

## 2. 业务背景与已确认决策（复述，作为约束基线）

1. **`mis-admin-helper`**：受众 = 后台操作用户（比"技能管理员"略宽，非普通终端用户）。内聚 `create_skill`（浏览现有技能 + 合并生成新技能 + 1.4 联网）。**默认不配入 copilot 委派白名单**。
2. **`mis-user-helper`**：受众 = 全员。内聚 `extract` + `summary`（从即将下线的 `mis-extract`/`mis-summary` 迁来）。**可进 copilot**。
3. 下线旧 worker `mis-extract` / `mis-summary`，按受众拆入上面两个 helper。
4. **copilot 接入 = 配置驱动**：copilot 默认对接 `mis-copilot`（协调者）；某 helper 是否可被 copilot 委派，由"协调者-工作者关系配置"决定（`coordinator/catalog.py` 注册 + `invoke_agent.py` 委派白名单 + 权限门控）。"是否接入 copilot"是声明式配置项，不硬编码。
5. **1.4 联网搜索 = 可插拔 tool**：搜索后端不当作一次性选型写死，抽象成 `search` tool 给 agent（与"联网搜索"同构）；provider 经配置切换（通用搜索 API / 内部检索 MCP / 仅指定 URL 都能挂）。架构阶段定工具抽象接口 + 默认 provider + 配置开关。
6. **create-skill 子能力（含用户新需求）**：builder 面板内嵌多选选择器（可搜索、可预览 body，不离开创建流）；操作员发"查看现有技能"类提示词 → LLM 调工具列出已有技能 → 内嵌选择器呈现（**对话驱动 + LLM 智能合成**）；勾选多个 → LLM 智能合成（提炼公共能力、去重，生成符合 Anthropic skill-creator 规范的统一新 SKILL.md），非机械拼接；合成时可挂 web 搜索 tool 找外部专业资料补全。
7. **硬约束**：`create_skill`（尤其"读现有技能组合生成新技能"）只暴露给后台操作用户，绝不进面向全员的 copilot。

---

## 3. 产品目标

- **G1（受众隔离）**：按受众把能力收口到两个 helper，使"创建/改写技能"这一高权限动作与"全员可用的抽取/摘要"彻底分域，且 create_skill 在 copilot 全链路不可达（fail-closed）。
- **G2（配置驱动接入）**：helper 与 copilot 的接入关系由 `coordination.worker_ids` 声明式配置决定，新增/下线 helper 不改 `invoke_agent.py` 硬编码白名单即可生效。
- **G3（技能合成智能化 + 联网可插拔）**：把"看现有技能 → 合并生成新技能"从手工填写升级为对话驱动 + LLM 智能合成，并让合成可挂可切换的联网搜索 tool 补全外部资料。

---

## 4. 用户故事

- **后台操作用户（视角 A）**
  - 作为后台操作员，我想在「技能管理」页用对话方式创建技能，并能在对话中一键"查看现有技能"、勾选多个已有技能让 AI 帮我合并成统一的新 SKILL.md，以便快速沉淀公共能力、避免重复造轮子。
  - 作为后台操作员，我想在合并生成时让 AI 自动联网查找该领域的外部专业资料补全，以便生成的技能说明更专业、准确。

- **全员（视角 B）**
  - 作为普通业务用户，我想在任意业务页点开 copilot 说"总结这页"，copilot 能结合我当前所在的页面自动给出本页要点摘要，而不用我自己粘贴内容。
  - 作为普通业务用户，我想把一段文本丢给 copilot 做字段抽取 / 摘要，且体验与现在的 `mis-extract`/`mis-summary` 一致（能力已迁入 `mis-user-helper`）。

- **管理员（视角 C）**
  - 作为平台管理员，我想在「协调者-工作者关系」配置页勾选 `mis-copilot` 可委派哪些 helper，且系统明确拦住"把 `mis-admin-helper` 加入 copilot"这类违规操作，以便接入关系一目了然、不靠改代码。
  - 作为平台管理员，我想在「Worker Catalog」管理台看到两个新 helper 的注册信息与 enabled 状态，并能开关，以便灰度与排障。

---

## 5. 需求池（P0 / P1 / P2）

> 影响范围图例：`[后端配置]` = agent yaml/coordination 配置文件；`[copilot配置]` = mis-copilot 委派关系；`[前端]` = mis-admin-web；`[后端逻辑]` = ai-platform Python 代码；`[权限]` = 权限/审计；`[搜索工具]` = 1.4 search tool。

### P0（本期必须做）

| 编号 | 需求 | 影响范围 | 验收要点 |
| --- | --- | --- | --- |
| R1 | 新增 `mis-admin-helper` agent 配置（角色=worker，enabled，capabilities=[create_skill]） | `[后端配置]` | `configs/agents/mis-admin-helper/{agent.yaml,metadata.yaml}` 就位；`agent.yaml` 含 `role: worker`；`metadata.yaml` 含 `when_to_use`/`capabilities`/`input_contract`/`output_contract`/`safety_level: read_only`，被 `WorkerCatalog` 正确加载（`build_worker_catalog` 能列出它）。 |
| R2 | 新增 `mis-user-helper` agent 配置（角色=worker，enabled，capabilities=[extract, summary]） | `[后端配置]` | `configs/agents/mis-user-helper/{agent.yaml,metadata.yaml}` 就位；role=worker；catalog 字段对齐旧 `mis-extract`/`mis-summary` 契约。 |
| R3 | 下线 `mis-extract` / `mis-summary` | `[后端配置]` `[copilot配置]` | 两 agent 配置从仓库移除（或先 `enabled: false` 灰度再删）；不再出现在任何 coordinator 的 `worker_ids`；`INVOKE_AGENT_WHITELIST` 默认不再含二者。检索全仓无残留 `mis-extract`/`mis-summary` 硬编码引用（除迁移备注）。 |
| R4 | copilot 接入声明式配置（硬约束落地点） | `[copilot配置]` | `mis-copilot/coordination.yaml` 的 `delegation.worker_ids` = `[mis-rag, crm-assistant, mis-user-helper]`（**不含 `mis-admin-helper`**）；`mis-admin-helper` 不出现在任何 coordinator 的 `worker_ids`。 |
| R5 | 委派白名单与环境默认对齐 | `[后端逻辑]` | `config.py` 的 `INVOKE_AGENT_WHITELIST` 默认改为 `[mis-rag, crm-assistant, mis-user-helper]`（去 extract/summary，不加 admin-helper）；`catalog.py` 的 `STATIC_WORKER_HINTS` 移除 `mis-extract`/`mis-summary`、补 `mis-user-helper`。运行时守卫 `invoke_agent.py:249` 对 `mis-admin-helper` 恒定拒绝。 |
| R6 | `mis-admin-helper` create_skill 基础对话能力（对话驱动 + LLM 智能合成） | `[后端逻辑]` `[前端]` | `mis-admin-helper` 作为真实 agent 运行，带 `list_skills` 工具；对话产物符合 Anthropic skill-creator 规范（front matter `name`+`description` + 非空 body）。沿用/升级现有 `SkillBuilderService` 的收敛判定（`_detect_converged`）。 |
| R7 | 内嵌多选选择器（对话驱动 + 不离开创建流） | `[前端]` `[后端逻辑]` | 操作员在 builder 对话发"查看现有技能"类提示词 → `mis-admin-helper` LLM 调 `list_skills` → 前端内嵌选择器（**可搜索、可预览 body、可多选**）呈现，不跳转/不关闭对话框；勾选多个后 LLM 智能合成（提炼公共能力、去重），结果回填/暂存。 |
| R8 | 硬约束：create_skill 仅后台操作用户可达，copilot 全链路不可达 | `[权限]` `[后端逻辑]` `[copilot配置]` | 触达 `mis-admin-helper` 需 `agent:skill:manage`（或更细权限）；即便被错误配入 copilot，`invoke_agent.py` 运行时白名单拒绝（`mis-admin-helper` 不在 `INVOKE_AGENT_WHITELIST`）。fail-closed 验证通过。 |
| R9 | `mis-user-helper` summary 页面感知 | `[后端逻辑]` `[copilot配置]` | `copilot-panel.tsx` 推送的 `PAGE_CONTEXT{route, module}` 经 `TaskBrief.page_context` 透传给 `mis-user-helper`；收到即能"总结这页"。 |
| R10 | 1.4 联网搜索 = 可插拔 `search` tool（抽象接口 + 默认 provider + 配置开关） | `[后端逻辑]` `[搜索工具]` | 定义 `search` tool 抽象接口（统一入参/出参）；提供至少 1 个默认 provider；provider 经配置开关切换；`mis-admin-helper` 合成时可挂该 tool 补全外部资料。后端当前无 web 访问能力，此为净新增。 |

### P1（Should，本期优先但不阻塞主线）

| 编号 | 需求 | 影响范围 | 验收要点 |
| --- | --- | --- | --- |
| R11 | 旧 `SkillBuilderService` 端点迁移策略 | `[后端逻辑]` `[前端]` | 明确 `POST /skills/builder/chat`（ephemeral）保留（手动 AI tab 仍可用）还是切到 `mis-admin-helper`；若切，前端 `chatSkillBuilder` 改为走 `mis-admin-helper` 会话。 |
| R12 | create_skill 操作审计与权限细化 | `[权限]` | create_skill 生成/落盘动作留痕（操作者、时间、来源技能列表）；评估是否需要比 `agent:skill:manage` 更细的 `agent:helper:create_skill`。 |
| R13 | 配置页"协调者-工作者关系"护栏增强 | `[前端]` `[后端逻辑]` | `agent-coordination-page.tsx` 在 `mis-copilot` 的 `worker_ids` 勾选处明确标注/禁用 `mis-admin-helper`（硬约束提示 + 后端提交校验拒绝非法加入）。 |
| R14 | `mis-user-helper` extract 页面感知（可选增强） | `[后端逻辑]` | 同 R9，把"抽取本页字段"也做成页面感知（按需）。 |

### P2（可延后 / Nice to have）

| 编号 | 需求 | 影响范围 | 验收要点 |
| --- | --- | --- | --- |
| R15 | 多 provider search 完整接入（内部检索 MCP、仅指定 URL） | `[搜索工具]` | 除默认 provider 外，支持"内部检索 MCP""仅指定 URL"两类 provider 经配置挂载。 |
| R16 | 合成结果 diff 预览（对比已有技能，避免重复创建） | `[前端]` | 合成前展示"与已有 N 个技能的重叠度/差异"，辅助操作员判断是否值得新建。 |
| R17 | 历史 create_skill 会话留存/复用 | `[后端逻辑]` `[前端]` | 当前 `SkillBuilderService` 为 ephemeral；评估 `mis-admin-helper` 会话是否需留存与续聊。 |
| R18 | 合成质量评测与人工校验提示 | `[后端逻辑]` | 对"去重/提炼公共能力"给出质量信号与人工复核提示。 |

---

## 6. UI 设计稿（关键页面，文字 + 结构描述）

### 页面 A：后台技能管理页「新建技能」对话框 — `mis-admin-helper` create-skill 面板（含内嵌选择器）

> 落点：`agent-skill-form-dialog.tsx` 的「AI 对话创建」Tab（右栏 `skill-builder-panel.tsx`）。双栏布局不变：左=元数据表单，右=AI 对话。

结构描述：

```
┌─ 新建技能（Dialog, max-w-4xl）──────────────────────────────┐
│ [手动填写] [AI 对话创建]          ← 模式切换（保留）          │
├───────────────────────┬────────────────────────────────────┤
│ 左：元数据表单          │ 右：AI 对话面板（mis-admin-helper） │
│  - 技能 ID / 名称       │  ┌─ 消息流 ──────────────────────┐ │
│  - 描述 / 分类 / 标签   │  │ （系统）你是技能合并助手…      │ │
│  - handler             │  │ 用户：查看现有"会员"相关技能   │ │
│  - 正文 body（可编辑） │  │ 助手：已为你列出，请勾选 →     │ │
│                        │  └────────────────────────────────┘ │
│                        │  ┌─ 内嵌多选选择器（不离开创建流）┐│
│                        │  │ 搜索框：_______   [可预览 body] ││
│                        │  │ ☑ 会员积分查询 skill           ││
│                        │  │ ☑ 会员等级判定 skill           ││
│                        │  │ ☐ VIP 画像 skill               ││
│                        │  │ [确认合并生成]                  ││
│                        │  └────────────────────────────────┘ │
│                        │  ┌─ 暂存预览 SKILL.md（可回填）──┐ │
│                        │  │ （合成后回填/暂存，复用现有）  │ │
│                        │  └────────────────────────────────┘ │
│                        │  [输入框 + 发送]  [自动回填开关]    │
└───────────────────────┴────────────────────────────────────┘
│ [保存] [取消]                                              │
└──────────────────────────────────────────────────────────┘
```

要点：
- 内嵌多选选择器在对话流内浮层/卡片呈现，**不关闭对话框、不跳转**；支持关键字搜索、点击单条可展开预览其 `body`。
- 勾选多个 → 点"确认合并生成" → `mis-admin-helper` 调 LLM 智能合成（提炼公共能力、去重）→ 产物经现有 `parseSkill` + `applyParsedSkill` 回填左侧表单与正文（沿用现有解析，不另写）。
- 合成时可挂 web 搜索（R10）：助手在对话中标注"已联网补全 X 资料"，前端以 `[工具告警]/引用` 形式提示。

### 页面 B：copilot 内 `mis-user-helper` 页面感知总结交互

> 落点：`copilot-panel.tsx`（H5 iframe 已收到 `PAGE_CONTEXT{route, module}`）→ `mis-copilot` → 委派 `mis-user-helper` summary。

结构描述：

```
[业务页：/agent/skills 或任意模块页]
        │  (copilot-panel.tsx:222 推送 PAGE_CONTEXT{route, module})
        ▼
┌─ AI Copilot（右侧 Sheet, H5 iframe）─────────────────────┐
│ 用户：「总结这页」                                        │
│ 助手：(mis-copilot 识别 page_context) → 委派 mis-user-helper│
│       → 返回本页要点摘要（基于 route/module 定位的页面语义）│
│ 用户：「总结我选中的这段」  → extract/summary 直接处理      │
└──────────────────────────────────────────────────────────┘
```

要点：
- `PAGE_CONTEXT` 已具备 `route` + `module`；R9 只需把它透传为 `TaskBrief.page_context` 给 `mis-user-helper`，无需前端新增推送字段。
- 全员可用，体验对齐旧 `mis-summary`（输入契约含 `attachments_text` / `page_context_slice`）。

### 页面 C：配置页「协调者-工作者关系」

> 落点：`agent-coordination-page.tsx`（`mis-copilot` 详情下的 coordination 配置）。

结构描述：

```
┌─ mis-copilot · 调度配置 ─────────────────────────────────┐
│ 调度角色：[协调者(Coordinator)] (worker 互斥)             │
│ 启用智能路由：[开]                                       │
├─ 协调者配置（delegation）───────────────────────────────┤
│ 可派发的执行者（worker_ids）  已选 3 个                 │
│  ├─ ☑ mis-rag                                          │
│  ├─ ☑ crm-assistant                                     │
│  ├─ ☑ mis-user-helper        ← 默认可勾选（全员 helper）│
│  ├─ 🔒 mis-admin-helper  【不可加入 copilot · 已禁用并提示】│
│  └─ （其它 worker…）                                    │
└──────────────────────────────────────────────────────────┘
```

要点：
- `mis-admin-helper` 在 `mis-copilot` 的 `worker_ids` 列表中**禁用 + 红字提示硬约束**（R13）；即便绕过前端，后端 `write_coordination` 校验拒绝（R4/R8 双重保险）。
- `mis-user-helper` 默认勾选，体现"可进 copilot"。

---

## 7. 待确认问题（架构阶段裁定项）

- **Q1 委派白名单单一来源**：现有 `WorkerCatalog`（`catalog.py`）是**全局**目录（所有 role=worker ∩ enabled ∩ `INVOKE_AGENT_WHITELIST`）；而 `mis-copilot` 实际可委派对象是 `coordination.yaml` 的 `delegation.worker_ids`。两者目前不完全同源。`mis-admin-helper` 若 role=worker 会出现在全局 catalog 的 `agent_id` 枚举里，存在被 `mis-copilot` 误委派的风险。需裁定：是否将 `mis-copilot` 的 `agent__invoke` 工具改为按**其自身 `delegation.worker_ids`** 构建 coordinator-scoped catalog（推荐），并让 `INVOKE_AGENT_WHITELIST` 与 coordination 对齐，保证 `mis-admin-helper` 既在全局 catalog 注册、又**绝不**进入 copilot 视图与运行时白名单。
- **Q2 `mis-admin-helper` 如何被 admin web 触达**：候选路径 = 复用通用会话机制 `createChatSession(agent_id="mis-admin-helper")` + `sendChatMessage`（`session.py:733 / :980`）；或新增专用端点。需裁定会话归属、身份与权限门（`agent:skill:manage`）。
- **Q3 内嵌选择器如何获得 `list_skills` 结果**：现有 `sendChatMessage` 仅回 `response` + `tool_errors`，不含结构化 tool-call 结果。需裁定 admin web 如何观测"助手调用了 `list_skills` 并返回 N 条技能"——SSE 流式暴露 tool 事件，还是前端自行调 `GET /skills` 渲染选择器（LLM 仅负责意图识别与合成）。
- **Q4 `search` tool 抽象与默认 provider 选型**：抽象接口签名、默认 provider（通用搜索 API 用哪家 / 内部 MCP 名）、provider 配置开关 schema（Q5 同理）。
- **Q5 create_skill 产物落盘路径**：合成后的 SKILL.md 经现有 `createSkill` → `custom_store.save_custom_skill` 落盘，还是新流程；与 `SkillBuilderService` 收敛判据如何复用。
- **Q6 旧 worker 下线灰度**：先 `enabled: false` 观察再删配置，还是直接删；是否有页面/脚本硬编码 `invoke_agent(mis-extract)` 需清理（检索应覆盖 `agent__invoke` 调用点）。
- **Q7 `mis-user-helper` 输出契约**：`extract`/`summary` 是否仍输出 JSON（沿用旧 `output_contract: json`），还是改为 text。
- **Q8 权限模型边界**：后台操作员 vs 技能管理员的权限如何在现有模型表达；create_skill 是否需要比 `agent:skill:manage` 更细粒度。

---

## 8. 调研确认的关键代码引用点（给架构师省去重新摸索）

**后端 · 调度/白名单**
- `agent/ai-platform/backend/src/coordinator/catalog.py:53-68` — `STATIC_WORKER_HINTS`，仍含 `mis-extract`/`mis-summary`，无新 helper。
- `agent/ai-platform/backend/src/coordinator/catalog.py:403-451` — `build_worker_catalog()`：目录 = `role=worker ∩ enabled ∩ whitelist`（全局，非 per-coordinator）。
- `agent/ai-platform/backend/src/coordinator/catalog.py:257-272` — `_resolve_whitelist()` 读 `settings.INVOKE_AGENT_WHITELIST`。
- `agent/ai-platform/backend/src/skills/tools/invoke_agent.py:73-80` — `DEFAULT_WHITELIST = {mis-extract, mis-summary, mis-rag, crm-assistant}`。
- `agent/ai-platform/backend/src/skills/tools/invoke_agent.py:83` — `FORBIDDEN_TARGETS = {mis-copilot}`。
- `agent/ai-platform/backend/src/skills/tools/invoke_agent.py:220-222` — 运行时读取 `INVOKE_AGENT_WHITELIST` / `MAX_DEPTH` / `TIMEOUT`。
- `agent/ai-platform/backend/src/skills/tools/invoke_agent.py:249` — 运行时守卫 `agent_id not in whitelist`（硬约束 fail-closed 落点）。
- `agent/ai-platform/backend/src/config.py:326-334` — `INVOKE_AGENT_WHITELIST` 默认值（需改）。

**后端 · 配置持久化**
- `agent/ai-platform/backend/src/coordinator/coordination_service.py:127-154` — `coordination.yaml` 写回（含 `delegation` / `catalog`）；`role` 落在 `agent.yaml`。
- `agent/ai-platform/configs/agents/mis-copilot/coordination.yaml:1` — `role: coordinator`（其 `delegation.worker_ids` 即"是否接入 copilot"声明）。
- `agent/ai-platform/configs/agents/mis-extract/agent.yaml:19` 与 `mis-summary/agent.yaml:19` — `role: worker`（下线对象）。
- `agent/ai-platform/configs/agents/mis-copilot/metadata.yaml` / `mis-extract/metadata.yaml` / `mis-summary/metadata.yaml` — catalog 字段（`when_to_use`/`capabilities`/`input_contract`/`output_contract`/`safety_level`）模板。

**后端 · API 与技能**
- `agent/ai-platform/backend/src/api/routes/agent.py:558,574` — `GET/PUT /{agent_id}/coordination`（写 worker_ids 的入口）。
- `agent/ai-platform/backend/src/api/routes/skill.py:181` — `POST /skills/builder/chat`（ephemeral `SkillBuilderService`，R11 迁移对象）。
- `agent/ai-platform/backend/src/skills/skill_builder_service.py` — `SkillBuilderService`（对话生成 + `_detect_converged` 收敛判定，R6 复用）。
- `agent/ai-platform/backend/src/skills/custom_store.py:51-75` — `save_custom_skill`（custom 技能落盘，R5 产物去处）。
- `agent/ai-platform/backend/src/api/routes/session.py:733,980` — `POST /sessions` 与 `POST /{session_id}/messages`（admin web 触达 `mis-admin-helper` 候选路径，Q2）。

**前端**
- `frontend/mis-admin-web/src/components/layout/copilot-panel.tsx:222-232` — `pushAuthAndContext` 推送 `PAGE_CONTEXT{route, module}`（R9 已有数据源）。
- `frontend/mis-admin-web/src/features/agent/skills/agent-skill-form-dialog.tsx` — 「新建技能」对话框（manual/ai 双 Tab，R7 落点）。
- `frontend/mis-admin-web/src/features/agent/skills/skill-builder-panel.tsx` — AI 对话面板容器（内嵌选择器挂载处）。
- `frontend/mis-admin-web/src/features/agent/agents/agent-coordination-page.tsx:88,151,176-192,623-669` — `delegation.worker_ids` 勾选 UI（R4/R13 落点）。
- `frontend/mis-admin-web/src/features/agent/api/agent-chat-api.ts:116,141` — `createChatSession` / `sendChatMessage`（Q2/Q3 触达与 tool 事件观察候选）。

**新建确认**
- 全仓检索 `mis-admin-helper` / `mis-user-helper`：**零引用**（确认纯新增，无残留接线）。
- 全仓检索 web/search tool：仅 `indexer.py`/`formfill_client.py`/`reverse_trust.py` 用 `httpx` 做内部调用，**无对外联网搜索 tool** → 1.4 为净新增（R10）。

---

## 9. 优先级结论（给主理人汇编用）

- **P0 必做（本期交付）**：R1、R2、R3、R4、R5、R6、R7、R8、R9、R10。
  - 其中 **R4 + R5 + R8 三者共同构成硬约束闭环**（声明式不进 copilot + 运行时白名单拒绝 + 权限门），缺一不可，建议架构评审时作为验收红线。
- **P1 延后可但不建议**：R11（旧端点迁移，影响前端落点）、R12（审计）、R13（配置页护栏，建议与 R4 同批做以免漏配）、R14（extract 页面感知）。
- **P2 明确可延后**：R15、R16、R17、R18。

> 说明：本 PRD 为"简单 PRD"（标准 SOP 第一环），不含竞品分析与象限图；如需完整 PRD（含竞品对标），另行触发。
