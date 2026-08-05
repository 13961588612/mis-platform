# 智能体运营控制台技术规范

> 状态：✅ 规范已发布（O0）｜版本：v1.4｜日期：2026-08-05  
> 决策依据：[adr.md](adr.md)（**host App 优先，运行时 ai-platform**）  
> 产品需求：[prd.md](prd.md)  
> 界面设计（强制）：[ui.md](ui.md)  
> 架构说明：[architecture.md](architecture.md)  
> 协同：[../coordinator-worker/spec.md](../coordinator-worker/spec.md)

## 1. 目标与非目标

### 1.1 目标

- **产品 UI** 在 MIS host App（`/agent/**`，`features/agent`）覆盖 [ui.md](ui.md) §0 十项。  
- 浏览器经 **BFF** 访问运营能力；**运行时**仍为 ai-platform。  
- Skill 执行权对接 `sys_role`；未授权全路径拒绝。  
- C–W coordination / Catalog 与 C–W Spec 对齐。

### 1.2 非目标

- 业务多 Agent / Worker 选择器  
- 将运行时搬进 Java `mis-agent`（本期）  
- 以 ai-platform/frontend 作为产品主验收面  
- 无白名单任意文件浏览；完整 DAG 编排器  

---

## 2. 前端路由（host App · 必须）

权威见 [ui.md](ui.md)。前缀 **`/agent`**：

| 路径 | 页面 | UI# |
|------|------|-----|
| `/agent/overview` | 概览 | — |
| `/agent/chat` | 本地对话（运营调试） | #6 |
| `/agent/sessions` | 会话管理 | #4 |
| `/agent/agents` | Agent 总览 | — |
| `/agent/agents/:id` | 详情壳 | — |
| `/agent/agents/:id/skills` | 可用技能 | #5 |
| `/agent/agents/:id/config` | 人设与配置 | #9 |
| `/agent/agents/:id/coordination` | C–W 调度配置 | #10 |
| `/agent/catalog` | Worker Catalog | #10 |
| `/agent/dispatch` | 调度观测 | — |
| `/agent/skills` | 技能池 | #1 #7 |
| `/agent/skills/permissions` | 技能权限 | #2 |
| `/agent/mcp` | MCP | #8 |
| `/agent/channels/wecom` | 企微多机器人 | #3 |
| `/agent/monitor` | 系统监控 | — |
| `/agent/approvals` | 审批中心 | — |

门户：`sys_app.code=agent`，`ENTERABLE_CODES` 含 `agent`，落地路由登记于 `host-apps.ts`。

---

## 2.1 BFF 对外前缀

浏览器只调：

```text
/api/v1/agent-ops/**
```

BFF 使用 WebClient 转发至 ai-platform（示例映射）：

| BFF | ai-platform |
|-----|-------------|
| `.../agent-ops/agents/**` | `/api/v1/agents/**` |
| `.../agent-ops/skills/**` | `/api/v1/skills/**` |
| `.../agent-ops/mcp/**` | `/api/v1/mcp/**` |
| `.../agent-ops/sessions/**` | `/api/v1/sessions/**` |
| `.../agent-ops/admin/**` | `/api/v1/admin/**` |
| `.../agent-ops/channels/wecom/**` | Gateway 或 backend channels API |
| `.../agent-ops/skills/{id}/grants` | **BFF 本地**：写 `sys_role_permission`（不转发 Python） |

具体路径以实现为准，须在 OpenAPI/权限清单登记，避免 `authOnly` 静默放行。

---

## 3. API 契约（运行时 + 权限）

统一响应：`{ code, data, message, traceId }`。下列为 **ai-platform** 契约；host App 经 BFF 同名资源访问（除 grants）。

### 3.1 技能池与 CRUD（UI#1 #7）— 既有为主

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/skills` | 分页列表/筛选 |
| GET | `/skills/{id}` | 详情 |
| POST | `/skills` | 创建 |
| PUT | `/skills/{id}` | 更新 |
| DELETE | `/skills/{id}` | 删除 |
| POST | `/skills/{id}/enable\|disable` | 启停 |
| POST | `/skills/reindex` | 重建索引 |
| GET | `/skills/stats` | 统计 |

### 3.2 技能权限 ACL（UI#2）— 对接 mis-system

**硬约束（产品锁定）：**

1. **未授权一律不可执行**：拦截范围包括但不限于——显式 `skill` 工具、Agent 自动选 Skill、Skill handler 触发的 MCP、其它「加载并执行 Skill」入口。不是「仅禁止显式执行」。  
2. **角色来源 = mis-system**：以 `sys_role` + `sys_user_role` 为准；权限授予走 `sys_role_permission`（`perm_type` 惯例对齐 ADR-012）。禁止 AI 库平行角色主源。  
3. **权限码**：每个可运行 Skill 对应执行码，建议 `ai:skill:{skill_id}:run`（最终码表在 `docs/api/permissions.md` / Flyway 种子中登记；新建 Skill 须同步登记或受控动态注册策略）。  
4. **fail-closed**：用户权限码集合不含该码 → 拒绝执行并返回明确错误；**不**静默跳过。平台超级管理员是否豁免须显式配置，默认仅持有运维码的角色可管授权，不可默认「任意登录可跑」。  
5. 与 Agent 绑定（UI#5）：`skill ∈ agent.enabled_skills` **且** `user.has(ai:skill:{skill_id}:run)`（权限码来自**当前 JWT appId** 下的角色）。  
6. **`sys_role` 挂靠（锁定）**：  
   - 运营菜单/授权操作 → **`sys_app=agent`** 的角色；  
   - Skill 执行码 → 默认授给 **`system`（业务入口）** 角色，并可同时授给 **`agent`** 角色（本 App 调试对话）；  
   - **不是** Agent YAML 的 `coordinator|worker`，也**不是**不存在的 `mis-agent` 服务角色。  
   详见 [adr.md](adr.md)「sys_role 与 APP」。

#### 管理 API（运营台 / 经 BFF）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/skills/{id}/grants` 或 BFF `/api/v1/ai/skills/{id}/grants` | 已授权的 **role** 列表 |
| PUT | 同上 | body：`{ "target_app_code": "system"|"agent", "role_ids": [...] }` → 写对应 app 下 `sys_role_permission` |
| GET | BFF/IAM 角色列表 | `?appCode=` 过滤；授执行权默认 `system`，授运营菜单仅 `agent` |

ai-platform 侧也可保留只读镜像，但**写授权必须落到 MIS 权限表**。

#### 运行时校验

```text
Skill 执行入口（所有路径）
  → 解析 skill_id
  → 取 LoginUser 权限码（Redis/IAM，ADR-009）
  → 无 ai:skill:{skill_id}:run → 拒绝（error code 明确）
  → 再检查 Agent enabled_skills
  → 执行
```

> 旧版「AI 本地 subject_type=user|role|dept 自建 ACL 表」**废弃为辅**；若需用户级例外，通过 MIS 用户绑定角色或后续 `perm_type` 扩展完成，不另起一套。

### 3.3 Agent 可用技能（UI#5）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/agents/{agent_id}/skills` | 当前启用 skill_id 列表 + 池内可选集 |
| PUT | `/agents/{agent_id}/skills` | body: `{ "skill_ids": ["…"] }` |

持久化：写入该 Agent 的 `skills/enabled-skills.yaml`（或等价配置），经 ConfigManager 热更新。

### 3.4 Agent 配置文件（UI#9）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/agents/{agent_id}/config-files` | 可编辑文件树（相对路径 + 类型） |
| GET | `/agents/{agent_id}/config-files/{path}` | 读内容（path URL-encode） |
| PUT | `/agents/{agent_id}/config-files/{path}` | 写内容；校验 + 热更新 |

**路径白名单（相对 `configs/agents/{agent_id}/`）：**

- `memory/personality.md`
- `runtime/prompts/system.md`
- `memory/facts/**`（仅 `.md`）
- `system/model.yaml`
- `runtime/runtime.yaml`
- `skills/enabled-skills.yaml`
- `metadata.yaml`
- `agent.yaml`（允许有限字段编辑或整文件校验后写回）

拒绝 `..`、绝对路径、白名单外路径。密钥类字段响应脱敏。

### 3.5 会话管理（UI#4）

既有：`GET/DELETE /sessions/{id}`、`GET …/messages`。

**扩展：**

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/sessions` | 运营列表：`user_id,agent_id,channel,from,to,page,size` |
| DELETE | `/sessions/{session_id}` | 删除会话及消息（已有语义对齐「关闭/删除」） |
| POST | `/sessions/batch-delete` | body: `{ "session_ids": [] }` 可选 |

列表接口需 **运营权限**；普通用户仅能看自己的会话（若共用端点则按角色过滤）。

### 3.6 MCP（UI#8）— 既有

| 方法 | 路径 | 用途 |
|------|------|------|
| GET/POST | `/mcp` | 列表 / 注册 |
| GET | `/mcp/{name}` | 配置 |
| POST | `/mcp/{name}/connect\|disconnect` | 连接管理 |
| GET | `/mcp/{name}/tools` | 工具列表 |
| GET | `/mcp/health` | 健康 |
| POST | `/mcp/{name}/discover` | 发现并注册 Skill（可选） |

### 3.7 企微多机器人（UI#3）— 新建/扩展

建议挂在 Gateway 管理 API 或 backend 代理：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/channels/wecom/bots` | 列表 |
| POST | `/channels/wecom/bots` | 创建 |
| PUT | `/channels/wecom/bots/{bot_id}` | 更新 |
| POST | `/channels/wecom/bots/{bot_id}/enable\|disable` | 启停 |
| DELETE | `/channels/wecom/bots/{bot_id}` | 删除 |
| GET | `/channels/wecom/bots/{bot_id}/health` | 连接状态 |

Bot 配置字段（示例）：`bot_id, name, corp_id, agent_id, secret(脱敏), token, encoding_aes_key, callback_path, default_agent_id, enabled`。

Gateway：回调改为 `/wecom/bot/callback/{bot_id}`（或 query 区分）；**必须支持多个 Bot 同时 enabled**。

### 3.8 Coordinator–Worker 调度配置（UI#10）

对齐 [C–W Spec](../coordinator-worker/spec.md) §4 / §9 / §12 / §14.3。

#### GET/PUT `/agents/{agent_id}/coordination`

**Coordinator 形态响应/请求示例：**

```json
{
  "agent_id": "mis-copilot",
  "role": "coordinator",
  "routing_enabled": false,
  "delegation": {
    "spawn_tools_enabled": true,
    "enforce_task_brief": true,
    "max_depth": 1,
    "timeout_seconds": 120,
    "emit_dispatch_trace": true,
    "forbid_self_invoke": true,
    "worker_ids": ["mis-rag", "crm-assistant", "mis-extract", "mis-summary"]
  },
  "catalog": null
}
```

**Worker 形态：**

```json
{
  "agent_id": "mis-rag",
  "role": "worker",
  "routing_enabled": false,
  "delegation": null,
  "catalog": {
    "enabled": true,
    "when_to_use": "制度、手册、知识库相关问题",
    "capabilities": ["rag"],
    "input_contract": ["goal", "user_question", "page_context_slice"],
    "output_contract": "answer+citations",
    "security_level": "readonly",
    "timeout_seconds": 120,
    "degrade_message": "知识检索暂不可用，请稍后重试"
  }
}
```

校验规则：

1. `role=coordinator` 时必须 `spawn_tools_enabled=true`；`worker_ids` 不得含自身；建议 `routing_enabled=false`。
2. `role=worker` 时剥离 spawn；`catalog` 必填结构；`enabled=false` 则不得出现在任一 Coordinator 的 `worker_ids`（保存时级联清理或拒绝）。
3. 将 `role` 改为 `coordinator` 前，若该 Agent 仍在全局 Catalog enabled，须先禁用。
4. 持久化：`agent.yaml` 的 `role` + `catalog:`（或 `metadata.yaml`）+ Coordinator 白名单文件/段；并触发 `WorkerCatalog.rebuild` 与委派工具 schema 刷新（C3）。

#### 全局 Catalog（同前）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/admin/worker-catalog` | 列表（由各 Worker catalog 段聚合） |
| PUT | `/admin/worker-catalog` | 批量改 `enabled` / `when_to_use`（可转调各 Agent coordination） |

环境变量 `INVOKE_AGENT_*` 为过渡期种子；目标态以 Catalog + 每 Coordinator `worker_ids` 为准（见 C–W Spec §12）。

### 3.9 Agent 生命周期 / Traces

`/agents` CRUD 与启停；`GET /admin/dispatch-traces`（O2 / C1）。

### 3.10 本地对话（UI#6）

复用 ChatPage；标明「运营调试」。

---

## 4. 页面行为摘要

细则与线框以 [ui.md](ui.md) §3 为准。规范层补充：

| 页面 | 关键规则 |
|------|----------|
| 技能池 | 停用后不可再被新绑定；已绑定 Agent 保存时提示 |
| 技能权限 | deny > allow；变更写审计日志 |
| 企微机器人 | 密钥不回显明文；多行并存 |
| 会话 | 删除不可恢复；详情只读消息 |
| Agent 技能 | 仅可选 status=enabled 的池内 Skill |
| 配置编辑 | 保存前校验；成功触发热更新提示 |
| **调度配置 #10** | role 切换二次确认；Coordinator/Worker 表单互斥展示；保存失败展示规范校验原因 |
| MCP | 断开后工具表生效时机须在 UI 提示 |

---

## 5. 安全

- 运营页与列表 API 需登录；会话跨用户列表、ACL、Bot 密钥、配置写 需运营/管理员角色。
- 配置文件 API 路径白名单；禁止任意文件读写。
- Skill 运行 = Agent 绑定 ∩ ACL allow。
- 企微 secret / MCP env 脱敏。

---

## 6. 分期与验收

| 阶段 | 内容 | UI# | 验收 |
|------|------|-----|------|
| O0 | 文档（host App 优先） | 全部写入 | 对照表齐全 |
| **O1-portal** | sys_app + 菜单 + ENTERABLE + features/agent 壳 | — | 九宫格可进 |
| O1a | 技能池 + Chat + Agent 总览 | #1 #6 #7 | B1/B2 |
| O1b | 会话 | #4 | B5 |
| O1c | MCP | #8 | B8 |
| O1d | 绑技能 + 配置编辑 | #5 #9 | B6/B7 |
| **O1g** | Coordination + Catalog | **#10** | B9/B10 |
| O1e | Skill 执行码 + `sys_role` 授权 UI | #2 | B3 |
| O1f | 多企微 Bot | #3 | B4 |
| O2 | Dispatch | — | C1 |
| O3 | Catalog↔工具 schema | #10 增强 | C3 |

黄金用例编号见 [prd.md](prd.md) §9。

---

## 7. FAQ

### 7.1 技能权限与 Agent 绑技能谁优先？

两者同时满足才可执行。绑定决定「这个 Agent 能不能用这技能」；ACL 决定「这个人能不能触发这技能」。

### 7.2 现网单企微 Bot 如何迁移？

将现有 env/配置导入为 `bot_id=default` 一条；再在 UI 增加第二条。回调 URL 按新路径更新企微后台。

### 7.4 #9 人设配置与 #10 调度配置如何分工？

| | #9 人设与配置文件 | #10 调度配置 |
|--|-------------------|--------------|
| 形态 | Markdown/YAML 原文编辑 | 结构化表单（role/Catalog/白名单） |
| 典型内容 | personality、system prompt 正文、model | role、worker_ids、when_to_use、TaskBrief 开关 |
| 关系 | Coordinator 的调度**纪律文案**在 #9；**开关与名单**在 #10 | 保存 #10 不替代改 prompt，UI 提供跳转 |

### 7.5 与 C–W 环境变量关系？

过渡期可读 `INVOKE_AGENT_WHITELIST` 作为 Coordinator `worker_ids` 初始值；UI 保存后以配置源为准并热更新。

---

## 8. 参考

- 界面：[ui.md](ui.md)
- Skill API：`backend/src/api/routes/skill.py`
- MCP API：`backend/src/api/routes/mcp.py`
- Session API：`backend/src/api/routes/session.py`
- Gateway 企微：`gateway/src/server.ts`、`adapters/wecom/`
- Agent 人设示例：`configs/agents/mis-copilot/memory/personality.md`
- enabled-skills：`configs/agents/*/skills/enabled-skills.yaml`
