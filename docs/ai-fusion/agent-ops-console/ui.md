# 智能体运营控制台 — 界面设计（信息架构）

> 文档角色：**界面与信息架构锁定**；凡列入本文件的模块，实现时侧栏/路由必须具备对应入口。  
> 版本：v1.2｜日期：2026-08-04  
> 上游：[prd.md](prd.md) · [architecture.md](architecture.md)  
> 下游：[spec.md](spec.md)  
> 协同配置权威：[../coordinator-worker/spec.md](../coordinator-worker/spec.md)  
> 本目录：[README.md](README.md)

---

## 0. 强制清单（必须全部进 UI）

以下能力为**界面必含**，不得仅在后端/配置存在而缺少管理台入口：

| # | 能力 | 界面落点（主入口） | 说明 |
|---|------|-------------------|------|
| 1 | **技能池管理** | `/admin/skills` | 全局 Skill 池：列表、筛选、统计、索引重建 |
| 2 | **技能权限管理** | `/admin/skills/permissions` | 哪些主体可运行哪些 Skill |
| 3 | **企微通道机器人管理（多机器人）** | `/admin/channels/wecom` | Gateway 企微 Bot 多实例 |
| 4 | **会话管理** | `/admin/sessions` | 全量对话记录；删除会话 |
| 5 | **智能体可用技能配置** | `/admin/agents/:id/skills` | Agent ↔ Skill 绑定 |
| 6 | **本地发起对话** | `/chat` | 运营调试对话 |
| 7 | **技能创建 / 删除 / 停用** | `/admin/skills` | 与技能池同一模块 |
| 8 | **MCP 管理** | `/admin/mcp` | MCP Server / 工具 |
| 9 | **智能体人设与配置文件管理** | `/admin/agents/:id/config` | 人设、Prompt、facts、模型/runtime 等 |
| 10 | **Coordinator–Worker 调度配置** | `/admin/agents/:id/coordination` + `/admin/catalog` | **role、可委派 Worker、Catalog 元数据、委派超时/深度、TaskBrief 开关等**（对齐 C–W Spec） |

> Catalog 全局页与 Agent「调度配置」Tab **互补**：前者管全站可委派池；后者按 Agent 编辑 C–W 角色与契约。缺一不可。

---

## 1. 整体布局

```text
┌─────────────────────────────────────────────────────────────┐
│  TopBar：产品名「智能体运营控制台」 | 环境 | 当前用户 | 退出   │
├──────────────┬──────────────────────────────────────────────┤
│  Sidebar     │  Content（路由 Outlet）                        │
│  （分组导航） │  列表 / 详情 / 表单 / 对话                      │
└──────────────┴──────────────────────────────────────────────┘
```

- 桌面优先；表格 + 详情/抽屉；危险操作二次确认；Loading / Empty / Error 三态。

---

## 2. 侧栏导航（完整）

### 2.1 对话与会话

| 菜单文案 | 路径 | 覆盖强制项 |
|----------|------|------------|
| 本地对话 | `/chat` | **#6** |
| 会话管理 | `/admin/sessions` | **#4** |

### 2.2 智能体与调度

| 菜单文案 | 路径 | 覆盖强制项 |
|----------|------|------------|
| Agent 总览 | `/admin/agents` | — |
| └ 详情 · 可用技能 | `/admin/agents/:id/skills` | **#5** |
| └ 详情 · 人设与配置 | `/admin/agents/:id/config` | **#9** |
| └ 详情 · **调度配置（C–W）** | `/admin/agents/:id/coordination` | **#10** |
| **Worker Catalog** | `/admin/catalog` | **#10**（全局池） |
| 调度观测 | `/admin/dispatch` | C–W 可观测 |

### 2.3 技能与工具

| 菜单文案 | 路径 | 覆盖强制项 |
|----------|------|------------|
| 技能池 | `/admin/skills` | **#1 #7** |
| 技能权限 | `/admin/skills/permissions` | **#2** |
| MCP 管理 | `/admin/mcp` | **#8** |

### 2.4 渠道

| 菜单文案 | 路径 | 覆盖强制项 |
|----------|------|------------|
| 企微机器人 | `/admin/channels/wecom` | **#3** |

### 2.5 运维

| 菜单文案 | 路径 | 说明 |
|----------|------|------|
| 系统监控 | `/admin/monitor` | 基础设施 / LLM |
| 审批中心 | `/admin/approvals` | HITL |
| 用户权限 | `/admin/users` | 平台账号 |

---

## 3. 分屏线框（要点）

### 3.1 技能池 `/admin/skills`（#1 #7）

```text
[创建技能] [重建索引]     筛选: 分类 | 状态 | 关键词
| 名称 | 分类 | 状态 | 来源 | 更新时间 | 编辑 停用 删除 |
```

### 3.2 技能权限 `/admin/skills/permissions`（#2）

```text
左侧 Skill 列表 | 右侧授权主体（用户/角色/部门 · allow/deny）
```

### 3.3 企微机器人 `/admin/channels/wecom`（#3）

```text
[添加机器人] 多实例 | 名称 | 凭证脱敏 | 回调 | 默认 Agent | 启停 |
```

### 3.4 会话管理 `/admin/sessions`（#4）

```text
筛选用户/Agent/渠道/时间 | 查看消息时间线 | 删除/批量删除
```

### 3.5 Agent 可用技能 `/admin/agents/:id/skills`（#5）

```text
技能池多选勾选 → 保存（enabled-skills）
```

### 3.6 本地对话 `/chat`（#6）

```text
[运营调试] Agent 选择器 | 消息列表 | 发送
```

### 3.7 MCP `/admin/mcp`（#8）

```text
注册 / 连接 / 断开 / 工具列表 / 健康
```

### 3.8 人设与配置 `/admin/agents/:id/config`（#9）

```text
Tab: 人设 | System Prompt | Facts | 模型 | Runtime | 文件树
（调度专用结构化字段放 §3.9，避免与原文 YAML 编辑混淆）
```

- 覆盖：`personality.md`、`system.md`、`facts/*`、`model.yaml`、`runtime.yaml` 等。
- 调度纪律相关的 **system prompt 正文**仍在此编辑；**role / Catalog / 白名单**在 #10。

### 3.9 Coordinator–Worker 调度配置（#10）

#### A. Agent 详情 · 调度配置 `/admin/agents/:id/coordination`

```text
头部徽章：role = Coordinator | Worker

┌─ 角色 ─────────────────────────────────────────┐
│ 运行模式 ● coordinator  ○ worker                 │
│ 说明：Coordinator=可委派；Worker=不可再 spawn     │
│ routing.enabled  [ ]（Coordinator 建议关闭）      │
└────────────────────────────────────────────────┘

── 当 role = coordinator 时显示 ──────────────────
┌─ 委派治理 ─────────────────────────────────────┐
│ 启用委派工具     [x] agent__invoke / spawn      │
│ 强制 TaskBrief   [x]（缺 goal/question 拒委派） │
│ max_depth        [1]（Worker 禁止再委派）         │
│ 默认超时秒       [120]                          │
│ 写出 dispatch_trace [x]                         │
│ 禁止委派自身     [x] 只读锁定                    │
└────────────────────────────────────────────────┘
┌─ 可委派 Worker（本 Coordinator 白名单）─────────┐
│ ☑ mis-rag    ☑ crm-assistant                   │
│ ☑ mis-extract ☑ mis-summary   [从 Catalog 同步] │
│ （仅可选 catalog.enabled=true 的 Worker）        │
└────────────────────────────────────────────────┘
┌─ 调度提示 ─────────────────────────────────────┐
│ System Prompt 须含意图→Worker 表与 OH 纪律；     │
│ [打开人设与配置 · System Prompt] → #9            │
└────────────────────────────────────────────────┘
[保存]  校验：coordinator 必须启用委派工具；
        不可把自己加入可委派列表

── 当 role = worker 时显示 ───────────────────────
┌─ Catalog 元数据（供 Coordinator / IntentGate）──┐
│ when_to_use     [多行文本]                      │
│ capabilities    [rag] [+]                       │
│ catalog.enabled [x] 允许被委派                  │
│ 输入契约        ☑ goal ☑ user_question          │
│                 ☑ page_context_slice            │
│ 输出契约        [answer+citations / JSON / …]   │
│ 安全级别        ○ 只读  ○ 写操作需 HITL         │
│ 超时秒          [120]                           │
│ 降级文案        [MCP 不可达时…]                 │
│ 禁止再委派      [x] 只读（平台强制 max_depth）   │
└────────────────────────────────────────────────┘
[保存] → 写 agent.yaml role + catalog 段；热更新 Catalog
```

| UI 字段 | C–W 规范来源 |
|---------|--------------|
| `role` | Spec §14.3 |
| 可委派列表 | §6 / §12 白名单；§9 Catalog |
| TaskBrief 强制 | §4.2 / C1 |
| `when_to_use` / capabilities | §9.1 |
| 输入/输出契约 | §9.1 |
| 超时 / max_depth | §12 / §8 |
| Worker 禁止 spawn | §2.1 / §8 |

#### B. 全局 Worker Catalog `/admin/catalog`

```text
全站可被委派的 Worker 池（= C–W WorkerCatalog）

| Agent | when_to_use | capabilities | enabled | 超时 | 操作 |
| mis-rag | 制度/手册… | rag | ✓ | 120 | 编辑 禁用 |

[编辑] → `/admin/agents/:id/coordination`（Worker 表单）
[从 YAML 重建 Catalog] [导出 Worker 接入清单模板]
```

---

## 4. Agent 详情壳（聚合 #5 #9 #10）

路径：`/admin/agents/:id`

```text
头部：display_name | role 徽章 | state | [启动][暂停][停止]
Tabs:
  概览 | 可用技能(#5) | 人设与配置(#9) | 调度配置 C–W(#10) | 健康/会话摘要
```

总览列表列须展示 **role**（coordinator / worker）。

---

## 5. 与强制清单对照自检

| # | 能力 | 菜单可见 | 独立路由 | 关键操作在 UI 可完成 |
|---|------|----------|----------|----------------------|
| 1 | 技能池 | ✓ | `/admin/skills` | 列表/筛选/统计 |
| 2 | 技能权限 | ✓ | `/admin/skills/permissions` | 授权增删 |
| 3 | 企微多机器人 | ✓ | `/admin/channels/wecom` | CRUD/启停 |
| 4 | 会话管理 | ✓ | `/admin/sessions` | 查看/删除 |
| 5 | Agent 绑技能 | ✓ Tab | `/admin/agents/:id/skills` | 勾选保存 |
| 6 | 本地对话 | ✓ | `/chat` | 选 Agent 发消息 |
| 7 | 技能 CRUD/停用 | ✓ | 同 #1 | 创建/删除/停用 |
| 8 | MCP | ✓ | `/admin/mcp` | 注册/连接/工具 |
| 9 | 人设与配置文件 | ✓ Tab | `/admin/agents/:id/config` | 编辑保存 |
| 10 | **C–W 调度配置** | ✓ Tab + Catalog | `/admin/agents/:id/coordination`、`/admin/catalog` | 改 role/白名单/Catalog 元数据 |

验收：**缺 #10（详情 Tab 或 Catalog 任一侧缺失）则界面验收失败。**

---

## 6. 关联

- 需求：[prd.md](prd.md)  
- 规范：[spec.md](spec.md)  
- C–W：[../coordinator-worker/spec.md](../coordinator-worker/spec.md)  
- 架构：[architecture.md](architecture.md)
