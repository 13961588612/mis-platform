# 智能体运营控制台 — 界面设计（信息架构）

> 文档角色：**界面与信息架构锁定**（**MIS host App 优先**）。  
> 版本：v1.4｜日期：2026-08-05  
> 上游：[prd.md](prd.md) · [adr.md](adr.md)  
> 下游：[spec.md](spec.md)  
> 对标：知识库 App（`/kb/**` + `features/kb`）  
> 协同：[../coordinator-worker/spec.md](../coordinator-worker/spec.md)

---

## 0. 强制清单（必须全部进 host App UI）

壳：`sys_app.code=agent`，路由前缀 **`/agent`**，前端域 **`features/agent`**。  
浏览器经 BFF 调运营 API；运行时在 ai-platform。

| # | 能力 | 界面落点（主入口） | 说明 |
|---|------|-------------------|------|
| 1 | **技能池管理** | `/agent/skills` | 全局 Skill 池 |
| 2 | **技能权限管理** | `/agent/skills/permissions` | 授 **mis-system `sys_role`**；未授权全路径不可执行 |
| 3 | **企微多机器人** | `/agent/channels/wecom` | Gateway 多 Bot |
| 4 | **会话管理** | `/agent/sessions` | 全量记录；删除 |
| 5 | **智能体可用技能** | `/agent/agents/:id/skills` | Agent↔Skill 绑定 |
| 6 | **本地发起对话** | `/agent/chat` | 运营调试（非业务 Copilot） |
| 7 | **技能创建/删除/停用** | `/agent/skills` | 与技能池同模块 |
| 8 | **MCP 管理** | `/agent/mcp` | Server / 工具 |
| 9 | **人设与配置文件** | `/agent/agents/:id/config` | personality / prompt / facts / model… |
| 10 | **C–W 调度配置** | `/agent/agents/:id/coordination` + `/agent/catalog` | role、白名单、Catalog 元数据等 |

门户：九宫格可进入；`ENTERABLE_CODES` 含 `agent`。  
**ai-platform/frontend `/admin` 不作为产品验收主路径。**

---

## 1. 整体布局

沿用 mis-admin-web 子系统壳（与 `kb` 相同：顶栏应用切换 + 侧栏菜单 + 内容区）。

```text
门户九宫格 → 智能体 App
┌─ AppShell ─────────────────────────────────────┐
│ TopBar（应用切换 / 用户）                        │
├──────────┬─────────────────────────────────────┤
│ 菜单     │  /agent/** 页面                      │
│（sys_menu）│                                     │
└──────────┴─────────────────────────────────────┘
```

- 菜单显隐：`PermissionGate` + `sys_menu.permission`。  
- 危险操作二次确认；Loading / Empty / Error。

---

## 2. 侧栏导航（sys_menu 建议）

### 2.1 对话与会话

| 菜单文案 | 路径 | UI# | 建议 permission |
|----------|------|-----|-----------------|
| 概览 | `/agent/overview` | — | `agent:overview:view` |
| 本地对话 | `/agent/chat` | #6 | `agent:chat:use` |
| 会话管理 | `/agent/sessions` | #4 | `agent:session:list` |

### 2.2 智能体与调度

| 菜单文案 | 路径 | UI# | 建议 permission |
|----------|------|-----|-----------------|
| Agent 总览 | `/agent/agents` | — | `agent:agent:list` |
| （详情子路由，可无独立菜单） | `/agent/agents/:id/skills` | #5 | `agent:agent:skills` |
| | `/agent/agents/:id/config` | #9 | `agent:agent:config` |
| | `/agent/agents/:id/coordination` | #10 | `agent:agent:coordination` |
| Worker Catalog | `/agent/catalog` | #10 | `agent:catalog:list` |
| 调度观测 | `/agent/dispatch` | — | `agent:dispatch:list` |

### 2.3 技能与工具

| 菜单文案 | 路径 | UI# | 建议 permission |
|----------|------|-----|-----------------|
| 技能池 | `/agent/skills` | #1 #7 | `agent:skill:list` |
| 技能权限 | `/agent/skills/permissions` | #2 | `agent:skill:grant` |
| MCP 管理 | `/agent/mcp` | #8 | `agent:mcp:list` |

### 2.4 渠道与运维

| 菜单文案 | 路径 | UI# | 建议 permission |
|----------|------|-----|-----------------|
| 企微机器人 | `/agent/channels/wecom` | #3 | `agent:wecom:list` |
| 系统监控 | `/agent/monitor` | — | `agent:monitor:view` |
| 审批中心 | `/agent/approvals` | — | `agent:approval:list` |

> Skill **执行码**（运行时）与上表 **菜单码**（进页）分离：执行码 `ai:skill:{skill_id}:run`；菜单码控制能否打开运营页。

---

## 3. 分屏线框（要点）

线框交互同 v1.3，**仅路径前缀由 `/admin` 改为 `/agent`**。摘要：

### 3.1–3.8

- 技能池 `/agent/skills`：创建/停用/删除/索引（#1 #7）  
- 技能权限 `/agent/skills/permissions`：左侧 Skill；右侧按**目标 App**选 `sys_role` 授权（#2）  
  - 运营菜单权 → App=`agent`  
  - Skill 执行码 → 默认 App=`system`（可选 `agent` 供调试）  
  - **≠** YAML `coordinator|worker`；本期无 `mis-agent` 服务角色  
- 企微 `/agent/channels/wecom`：多 Bot（#3）  
- 会话 `/agent/sessions`：列表/详情/删除（#4）  
- Agent 技能 `/agent/agents/:id/skills`（#5）  
- 本地对话 `/agent/chat`：角标「运营调试」（#6）  
- MCP `/agent/mcp`（#8）  
- 人设配置 `/agent/agents/:id/config`（#9）  

### 3.9 C–W 调度配置（#10）

- `/agent/agents/:id/coordination`：Coordinator / Worker 分表单（role、白名单、TaskBrief、when_to_use…）  
- `/agent/catalog`：全局 Catalog，编辑深链到 coordination  

字段对齐 C–W Spec，同原 ui.md §3.9。

---

## 4. Agent 详情壳

路径：`/agent/agents/:id`

```text
头部：display_name | role 徽章 | state | 启停
Tabs: 概览 | 可用技能(#5) | 人设与配置(#9) | 调度配置 C–W(#10) | 健康
```

---

## 5. 强制清单自检

| # | 能力 | 门户菜单可见 | 路由 | 备注 |
|---|------|--------------|------|------|
| 1–10 | 见 §0 | ✓（按 permission） | `/agent/**` | 缺一则界面验收失败 |

另验：`sys_app(agent)` enterable；业务 Copilot **无** Worker 选择器。

---

## 6. 关联

- [adr.md](adr.md) · [prd.md](prd.md) · [spec.md](spec.md) · [architecture.md](architecture.md)
