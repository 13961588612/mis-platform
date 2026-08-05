# ADR：智能体运营控制台 — host App 优先，运行时留 ai-platform

> 状态：✅ 已确认｜日期：2026-08-05（**v1.4.1：澄清 sys_role↔host App agent；≠ YAML role**）  
> 范围：MIS 门户智能体运营 App + `agent/ai-platform` 运行时；Skill/MCP/C–W；mis-system 角色权限  
> 详细契约：[spec.md](spec.md)  
> 产品需求：[prd.md](prd.md)  
> 界面设计：[ui.md](ui.md)  
> 架构说明：[architecture.md](architecture.md)  
> 本目录：[README.md](README.md)

## 背景

此前 v1.3 将运营 UI 落在 `ai-platform/frontend`，门户仅外链。产品确认改为：**管理界面以 MIS host App 为优先交付面**；**Agent 运行时、YAML、委派、热更新仍留在 ai-platform**（不新建运行时级 `mis-agent`）。

对标知识库：`features/kb` + `sys_app(kb)` + BFF，引擎/领域服务分立。

---

## 决策（现行 · v1.4）

1. **产品定位**：平台运营控制台（非业务「多智能体选择中心」；业务对话仍仅 Coordinator）。  
2. **界面落点（优先）**：**MIS host App**  
   - `sys_app.code = agent`（名称如「智能体」/「智能体运营」），`runtime=host`，`base_path=/agent`  
   - 前端：`frontend/mis-admin-web/src/features/agent/**`  
   - 门户：`ENTERABLE_CODES` 含 `agent`；`host-apps` 落地路由（如 `/agent/overview` 或 `/agent/agents`）  
   - 菜单 / 按钮权限走 `sys_menu` + `sys_role_permission`（与 `kb`/`system` 同范式）  
3. **运行时仍留 ai-platform**：AgentManager、ConfigManager、C–W Adapter、Skill 执行、MCP、会话引擎、Gateway 企微；**不**把 QueryEngine/YAML 真相搬进 Java。  
4. **不新建运行时级 `mis-agent`（本期）**；BFF 聚合运营 API → ai-platform；权限元数据在 mis-system。若未来仅需 Java 台账/订购再另开 ADR。  
5. **BFF 为管理面唯一对外入口（浏览器）**：`mis-admin-web` → `mis-admin-bff` `/api/v1/agent-ops/**`（或等价前缀）→ ai-platform `/api/v1/**`；浏览器不直连 Python Admin（内网调试除外）。  
6. **ai-platform/frontend**：降为可选 **调试/嵌入**（如既有 Copilot H5 embed）；**不再作为运营控制台主交付面**；其 `/admin/*` 可保留给研发应急，不计入产品验收主路径。  
7. 业务对话与运营调试分离；本地对话在 host App 内提供（`/agent/chat`），标明运营调试。  
8. 与 Coordinator–Worker 分期对齐；Monitor ≠ Dispatch。  
9. 界面强制 UI#1–#10（见 [ui.md](ui.md)），路径以 `/agent/**` 为准。  
10. **技能授权硬约束**（同 v1.3）：未授权**全路径**不可执行；角色 = **`sys_role`**；执行码经 `sys_role_permission`；运行时用 MIS 权限码集合鉴权。  
11. 企微多 Bot；#9 / #10 配置分工不变。

---

## 为何 host App 优先？

| 收益 | 说明 |
|------|------|
| 统一门户体验 | 与 system/kb 相同登录、九宫格、菜单、权限门禁 |
| 角色权限天然对齐 | Skill/运营菜单码与 mis-system 同套运营，无「外链台 + 平行权限」割裂 |
| 可审计可授人 | 非纯研发运营也可按角色授权进入 |
| 边界清晰 | 业务 Copilot 仍在主站能力位；本 App 明确是「运营」而非选 Worker |

**代价（接受）：** BFF 需透传/聚合较多运营 API；联调多一跳。用 Facade/WebClient 对标 `KbWebClient` 模式控制复杂度。

---

## 为何运行时仍不进 `mis-agent`？

| 留在 ai-platform | 原因 |
|------------------|------|
| YAML 热更新、OH、C–W 委派 | 已实现；搬迁双真相 |
| Skill/MCP 执行循环 | Python 编排本职 |
| 与 host App 关系 | **引擎** vs **壳+权限+BFF**，同 KB 思路 |

---

## 逻辑拆分

```text
mis-admin-web features/agent   ← 唯一产品 UI（host App）
        │
        ▼
mis-admin-bff  /api/v1/agent-ops/*   ← 鉴权、权限码、聚合
        │
        ▼
ai-platform backend / gateway        ← 运行时真相
        │
        ├── ConfigManager / Agents / Skills 执行
        ├── WorkerCatalog / 委派
        └── 企微 Bot（Gateway）

mis-system / IAM / migrator          ← sys_app、菜单、sys_role、Skill 执行权限码
```

---

## 备选方案

| 方案 | 结论 |
|------|------|
| A. MIS host App + BFF + ai-platform 运行时 | **是（v1.4 选定）** |
| B. 仅 ai-platform/frontend 运营台 | **否（已废止为主路径）**；可作研发应急 |
| C. `mis-agent` 管运行时 | **否（本期）** |
| D. Skill 平行角色、不对接 `sys_role` | **否** |

## 后果

### 正面

- 门户与权限体系统一；Skill 授权与菜单同套  
- 运行时与 C–W 同栈不搬家  
- 产品叙事清晰：运营 App ≠ 业务选智能体  

### 负面 / 约束

- 必须交付：`sys_app` 种子、菜单权限、`ENTERABLE_CODES`、`features/agent`、BFF Facade  
- BFF 契约与 ai-platform Admin API 需版本协同  
- 避免把业务用户菜单做成「可选多个 Worker」（C–W 约束仍在）  

## 补充澄清

1. host App **管理** Agent/Worker/Catalog；**不**向业务用户暴露 Worker 选择器。  
2. 业务 Copilot / 专用能力页路径不变。  
3. Skill 未授权 = 运行时全路径拒绝（不仅 UI 隐藏）。  
4. **三种「role」必须区分（v1.4.1）——详见下文「sys_role 与 APP」。**

---

## sys_role 与 APP：挂 host App `agent`，不是 Agent YAML role

平台事实（ADR-011 / schema）：**`sys_role` 必带 `app_id`，角色按 APP 隔离**；JWT / Redis 权限也是 `{tenantId}:{appId}:{userId}`。

| 名称 | 是什么 | 是否 = sys_role |
|------|--------|-----------------|
| **host App `agent` 的 sys_role** | 门户应用 `sys_app.code=agent` 下的运营角色 | **是**——运营菜单、授权操作挂这里 |
| **Agent YAML `role`** | C–W 运行模式：`coordinator` \| `worker` | **否**——配置字段，与 RBAC 无关 |
| **`mis-agent` 服务角色** | 本期**无**运行时级 `mis-agent` 微服务，故无其独立 role | **不适用** |

**回答「是不是与 mis-agent 的 role 挂钩」：**

- 若指 **Java `mis-agent` 服务**：本期不做该服务，**不挂钩**。  
- 若指 **host App「智能体」(`agent`)**：运营侧 **菜单 / 按钮 / 授权页操作权限** → **是，挂 `app=agent` 的 `sys_role`**。  
- 若指 **YAML `role: coordinator|worker`**：与 `sys_role` **无关**，禁止混称。

### Skill 执行码挂哪个 App？（因 sys_role 按 APP 隔离）

业务用户走 Copilot 时，登录 JWT 的 `appId` 通常是 **`system`（或其它业务 App）**，权限缓存也只含该 App 下角色权限。若把 `ai:skill:*:run` **只**授给 `agent` App 角色，则业务对话里**永远验不过**。

| 权限类型 | 建议挂靠的 App | 用途 |
|----------|----------------|------|
| 运营菜单/按钮（`agent:skill:list`、`agent:skill:grant`、`agent:agent:list`…） | **`agent`** | 进运营台、做授权 |
| Skill **执行码**（`ai:skill:{id}:run`） | **业务入口 App（默认 `system`）**；运营调试可同时授给 **`agent`** 角色 | Copilot / `/agent/chat` 运行时校验 |

授权 UI（在 `agent` App 内）：

- 授「谁能进运营页」→ 只列 **`agent` App** 的 `sys_role`。  
- 授「谁能跑某个 Skill」→ 角色选择器按**目标 App**过滤（默认 `system`，可选 `agent` 供本 App 调试对话）；写入对应该 `app_id` 的 `sys_role_permission`。

运行时（ai-platform）：用**当前请求 JWT 的 appId** 对应的权限码集合做 fail-closed 校验（与 BFF 一致）。

## 关联

- [prd.md](prd.md) · [ui.md](ui.md) · [spec.md](spec.md) · [architecture.md](architecture.md)  
- KB 对标：[../../backend/knowledge-base-app-plan.md](../../backend/knowledge-base-app-plan.md)  
- [ADR-009](../../adr/ADR-009-permissions-in-redis-not-jwt.md) · [ADR-012](../../adr/ADR-012-sys-role-permission.md)  
- [../coordinator-worker/adr.md](../coordinator-worker/adr.md)
