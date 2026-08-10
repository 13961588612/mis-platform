# T04 收口 · Agent 控制台增量设计（前端接线 + P2 已知债收口）

- 作者：高见远（架构）
- 日期：2026-08-07
- 范围：只做设计，不写业务代码
- 上游输入：impl-plan.md（T04 端点清单 / wire 契约 / Q1/Q2/Q4 决策）、`frontend/mis-admin-web/src/features/agent/**` 现状、`backend/mis-admin-bff` AgentOps 域、ai-platform T04 已交付源码
- 基线：`npm run typecheck` 当前 **0 错**（tsc --noEmit 实测通过）

---

## 1. 现状调研摘要

### 1.1 features/agent 页面清单（13 个注册页，pages.ts）

| 页面 | 文件 | 接线状态 | T04 就绪后是否会炸 |
|---|---|---|---|
| 概览 | `overview/agent-overview-page.tsx` | 已接线（listAgents + getMonitorOverview） | ⚠️ P2：`monitor.agents_running/agents_total` 显示 `undefined / undefined` |
| 对话 | `chat/agent-chat-page.tsx` | 已接线（P0/P1 已对齐） | 安全 |
| 会话运营 | `sessions/agent-session-page.tsx` + `agent-session-detail-dialog.tsx` | **已接线且 wire 完全对齐** | 安全（#27 从 501 → 真数据，无需改动） |
| Agent 列表/详情 | `agents/agent-list-page.tsx` / `agent-detail-route.tsx` | 已接线 | ⚠️ P2：`enabled_skill_count` 恒 0 |
| 配置文件 | `agents/agent-config-page.tsx` + `agent-config-file-editor.tsx` | 已接线但 **wire 不匹配** | 🔴 读/写会错打到 `/config-files/content`，树形状也不对 |
| Agent↔技能绑定 | `agents/agent-skills-page.tsx` | 已接线但 **wire 不匹配** | 🔴 `getAgentSkills` 返回对象而非数组，`.map` 崩 |
| 调度配置 | `agents/agent-coordination-page.tsx` | 已接线但 **wire 不匹配** | 🔴 扁平 `Coordination` vs 真实嵌套 `{delegation,catalog}` |
| Worker Catalog | `catalog/agent-catalog-page.tsx` | 已接线但 **wire 不匹配** | 🔴 返回对象而非数组，`entries.filter` 崩 |
| 调度观测 | `dispatch/agent-dispatch-page.tsx` | 路由日志/统计 ✅；**traces 区块不匹配** | 🔴 traces 区块返回 `{traces,total}` 信封，字段全错 |
| 技能池/授权 | `skills/*` | 已接线（P0/P1 已对齐） | 安全 |
| MCP | `mcp/agent-mcp-page.tsx` + `agent-mcp-tools-dialog.tsx` | 已接线但 **4 字段臆造** | ⚠️ P2：`state/tool_count/enabled/updated_at` 恒 0 |
| 企微 Bot | `channels/agent-wecom-page.tsx` + `agent-wecom-bot-dialog.tsx` | **已接线且 wire 完全对齐** | 安全（T04 后转真数据，无需改动） |
| 系统监控 | `monitor/agent-monitor-page.tsx` | 已接线但 **MonitorOverview 臆造** | ⚠️ P2：四张卡基本无真数据 |
| 审批 | `approvals/agent-approval-page.tsx` | 已接线；类型 ✅；**BFF 转发路径错** | 🔴 BFF 打到 `/admin/approvals`（实际 `/push/approvals`） |

### 1.2 API / hooks 层结构

- `api/agent-ops-api.ts`：58 个 BFF 端点函数齐备（`unwrap`/`cleanParams`/`seg` 自建，`arch/no-cross-feature` 纪律下刻意重复）。**路径/BODY 与 ai-platform 真实 wire 不一致的函数**：`getConfigFileContent`/`saveConfigFileContent`（query 拼 `/content`）、`getWorkerCatalog`/`saveWorkerCatalog`（数组 vs 对象、`{entries}` vs `{updates}`）、`listDispatchTraces`（数组 vs `{traces,total}`、查询参数错）、`getAgentSkills`/`saveAgentSkills`（对象 vs 数组、`{bindings}` vs `{skill_ids}`）、`callMcpTool`（`tool` vs `tool_name`）。
- `stores/use-agent-store.ts`：Zustand 轻量跨页状态（selectedAgentId / 三类筛选 / 轮询开关），无服务端缓存。监控页是唯一用 react-query 的页面。
- 无独立 hooks 层，页面统一 `useState + load() + useEffect`。

### 1.3 BFF 现状

- `AgentOpsController`（透明透传）+ `AgentOpsChannelController`（企微脱敏）+ `AgentOpsGrantController`（授权域）。
- `AgentOpsFacadeService.monitorOverview()` 返回 `{proxy, llm, admin}` —— **前端类型与之完全不符**（见 B1）。
- `AgentOpsClient` 两处下游路径与 ai-platform 实际不符：审批（`/admin/approvals` → 实际 `/push/approvals`）、配置文件读/写（`/config-files/content?path=` → 实际 `/config-files/{file_path:path}`）。**都在 `AgentOpsClient.java` 一个文件内**。

### 1.4 ai-platform 真实 wire 事实表（本次调研结论，禁止再臆造）

见 §7「共享知识」—— 这是所有改动的唯一契约来源。

---

## 2. A 部分接线设计（页面 → 端点 → wire 映射）

### 2.1 会话运营页 —— ✅ 无需改动（仅联调验证）

| 项 | 值 |
|---|---|
| 端点 | #27 `GET /agent-ops/sessions`、#28/#29、#30/#31 |
| 前端类型 | `Session` / `SessionMessage` / `AgentPage<T>` |
| 结论 | 与 ai-platform `SessionResponse`/`MessageResponse`/`AgentPage` **逐字段一致**（含 `status`/`runtime_type` 附加字段）；`batch-delete` body `{ids}` 一致。**维持现状**，联调时验证即可。 |

### 2.2 企微 Bot 管理页 —— ✅ 无需改动（仅联调验证）

| 项 | 值 |
|---|---|
| 端点 | #48–#54 |
| 前端类型 | `WecomBot`（snake_case）、`WecomBotPayload`、health map |
| 结论 | 与 ai-platform `list_wire()` / `to_wire()` **逐字段一致**；#54 health `{bot_id: connected|disconnected|unknown}` 一致。**维持现状**。可选打磨：T04 后 wecom_bot_store 已带 on_change 回调，页头「需重启 Gateway 生效」提示条可弱化（P2，不阻塞）。 |

### 2.3 配置文件页 —— 🔴 需重接（前端 types/API + BFF 路径）

**真实 wire（ai-platform `agent_config_files.py` + `file_service.py`）：**

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/api/v1/agents/{id}/config-files` | 扁平数组 `[{path, type, read_only, size_bytes}]`（**不是树**，无 name/format/editable/size/updated_at/children） |
| GET | `/api/v1/agents/{id}/config-files/{file_path:path}`（路径段，URL 编码） | `{content, masked, read_only, type}`（**无 sha256/format/editable/path**） |
| PUT | `/api/v1/agents/{id}/config-files/{file_path:path}`，body `{content}` | `{path, masked, reloaded}`（**无 base_sha256 并发保护**） |

**改动：**

- **BFF `AgentOpsClient.java`**（与审批同文件）：
  - `configFileContent`：`path(AGENTS + "/{id}/config-files/{file}").build(agentId, path)`（用模板变量让 Spring 对 `/` 编码为 `%2F`，ai-platform `unquote` 还原），删除 `queryParam("path", ...)`。
  - `saveConfigFileContent`：同路径，body 只透传 `{content}`（下游不需要 `path`/`base_sha256`）。
- **前端 `types.ts`**：
  - `ConfigFileNode` → 重写为 wire 扁平项 `{path, type: string, read_only: boolean, size_bytes: number}`；新增**前端派生**树类型（`id`/`depth`/`children`，由 `agent-config-page` 用 path 拆分目录现场构建）。
  - `ConfigFileContent` → `{content, masked, read_only, type}`。
  - `SaveConfigFilePayload` → `{content: string}`（path 走 URL）。
  - 删除 `format`/`editable`/`sha256`/`base_sha256` 相关字段与文档。
- **前端 `api/agent-ops-api.ts`**：`getConfigFileContent(id, path)` → `GET /config-files/${encodeURIComponent(path)}`（注意保持 `/` 可被后端 `:path` 捕获，用 `seg()` 逐段编码）；`saveConfigFileContent(id, {content})` → `PUT` 同 URL。
- **`agent-config-page.tsx`**：扁平列表 → 按 `/` 拆段构建树（供 TreeTable）；`format` 列 → `type` 后缀；`editable` → `!read_only`；`size` → `size_bytes`；`fileCount` → list.length。
- **`agent-config-file-editor.tsx`**：删除 sha256 页脚与 `CONFIG_CONFLICT` 409 冲突护栏（后端无此能力，`masked`/`read_only` 两道护栏保留）；header `format.toUpperCase()` → `type.toUpperCase()`；保存只发 `{content}`；`editable` → `!read_only`。

### 2.4 worker-catalog 页 —— 🔴 需重接

**真实 wire（ai-platform `admin.py` + `coordinator/catalog.py`）：**

```json
GET /api/v1/admin/worker-catalog →
{
  "workers": [{"agent_id","display_name","when_to_use","capabilities",
               "input_contract","output_contract","security_level","enabled",
               "timeout_seconds","degrade_message"}],
  "coordinators": ["agent_id", ...],
  "fallback": bool
}
PUT /api/v1/admin/worker-catalog  body {"updates":[{"agent_id","enabled"?,"when_to_use"?}]}
```

**改动：**

- **`types.ts`**：`WorkerCatalogEntry` → 重写为 `WorkerCatalogWorker`（`security_level` 替代 `safety_level`，**无 `role` 字段**）；新增 `WorkerCatalog {workers, coordinators: string[], fallback: boolean}`。
- **`api/agent-ops-api.ts`**：`getWorkerCatalog(): Promise<WorkerCatalog>`；`saveWorkerCatalog` body 改 `{updates}`（页面临时只读，函数对齐 wire 供后续使用）。
- **`agent-catalog-page.tsx`**：`entries` → `catalog.workers`；`workerCount` → workers.length；新增「协调者 N」StatCard（`coordinators.length`）；`role` 筛选下拉删除（行内全是 worker）；安全等级筛选改用 `security_level`（`read_only` → 只读 / `needs_hitl` → 需人工确认）；`AgentStatusBadge kind="agentRole"` 移除或恒 worker；其余列（display_name/agent_id/when_to_use/enabled）保留。

### 2.5 审批页 —— 类型已对齐，修复 BFF 转发 + body

**真实 wire（ai-platform `push.py`）：**

- `GET /api/v1/push/approvals?status=&user_id=&limit=` → camelCase `Approval[]`（5 状态，**与前端 `Approval` 逐字段一致**）。
- `POST /api/v1/push/approvals/{id}/respond` body `{decision: "approved"|"rejected", comment: ""}`。
- BFF 现状：`GET /admin/approvals`、`POST /admin/approvals/{id}/decision`、body 原样透传 `{approved: bool}` → **两端都不对**。

**改动（BFF `AgentOpsClient.java`，单文件）：**

- `listApprovals`：路径 `ADMIN + "/approvals"` → `PUSH + "/approvals"`（新增 `PUSH = "/api/v1/push"` 常量）。
- `decideApproval`：路径 → `PUSH + "/approvals/{id}/respond"`；**body 加工** `{approved, comment}` → `{decision: approved ? "approved" : "rejected", comment: comment ?? ""}`（在 Client 内做，符合「BFF 归一下游契约」的既有模式，前端 `decideApproval` 保持 `{approved}` 不变）。
- 前端 `agent-approval-page.tsx`：**零改动**（`listApprovals(status)`、`decideApproval(id,{approved})` 语义不变）。仅联调验证。

### 2.6 dispatch-traces 观测 —— route-logs/stats ✅；traces 区块需重接

**真实 wire（ai-platform `admin.py` + `coordinator/trace.py`）：**

```json
GET /api/v1/admin/dispatch-traces?session_id=&worker_id=&intent=&limit=&offset= →
{ "traces": [{"intent","worker_id","tool","status","latency_ms","task_id",
              "brief_rejected","session_id","created_at"}], "total": N }
```

- 前端 `DispatchTrace`（`trace_id/coordinator_id/task_brief/depth/started_at/duration_ms/status∈success|failed|running`）**几乎全部臆造**。
- 路由日志/统计已对齐 ✅（`RouteLog`/`RouteStats` 与 `router/models.py` 逐字段一致）。

**改动：**

- **`types.ts`**：`DispatchTrace` → 重写为 wire 项 `{intent, worker_id, tool, status: 'completed'|'rejected'|..., latency_ms, task_id, brief_rejected, session_id, created_at}`。
- **`api/agent-ops-api.ts`**：`listDispatchTraces` → 返回 `result.traces`（剥信封）；查询参数只透传 `limit`（默认 100，`from/to/coordinator_id/status` 后端不支持，删掉）。
- **`agent-dispatch-page.tsx` traces 区块**：删除 status 下拉与 coordinator 筛选对 traces 的作用（保留主筛选区仅作用于 route-logs/stats）；列改为 时间(created_at) / 会话(session_id) / 执行者(worker_id) / 工具(tool) / 意图(intent) / 耗时(latency_ms) / 结果(status) / 备注(brief_rejected)。「刷新链路」按钮保留。

### 2.7 （A+ 增量，同属 T04 子集 10 端点，建议并入）

| 页面 | 真实 wire | 改动 |
|---|---|---|
| Agent↔技能绑定 | `GET /agents/{id}/skills` → `{agent_id, enabled_skill_ids, pool[]}`；`PUT` body `{skill_ids}` | API 层适配：`getAgentSkills` 把 `{enabled_skill_ids}` 摊平成 `AgentSkillBinding[]`；`saveAgentSkills` 把 `bindings` 压缩为 `{skill_ids}`。页面零改动 |
| 调度配置 | `GET/PUT /agents/{id}/coordination` → `AgentCoordination {agent_id, role, routing_enabled, delegation{spawn_tools_enabled,enforce_task_brief,max_depth,timeout_seconds,emit_dispatch_trace,forbid_self_invoke,worker_ids}, catalog{enabled,when_to_use,capabilities,input_contract[],output_contract,security_level,timeout_seconds,degrade_message}}` | `types.ts` `Coordination` 重写为嵌套结构；`agent-coordination-page.tsx` 表单重接（worker_ids 替代 allowed_workers、security_level 替代 safety_level、input_contract 变数组、max_fanout/task_brief_template 删除）。**改动量最大，需主理人确认是否本期纳入** |

---

## 3. B 部分修复方案（P2 已知债收口）

### 3.1 MonitorOverview 整块虚构 → 按真实 wire 重写

**根因**：`#55` 在 BFF 聚合为 `{proxy, llm, admin}`（`AgentOpsFacadeService#monitorOverview` 已实现），但前端 `MonitorOverview` 声明的 `proxy_status/agents_running/agents_total/llm_providers/updated_at` **全部不在 wire 上**。

**真实 wire（三路聚合，均来自 `llm_gateway.get_status()` + `admin/health`）：**

```ts
// types.ts 重写
interface MonitorProxyNode {
  host: string; port: number; url: string;
  is_healthy: boolean; consecutive_failures: number;
  total_requests: number; last_check_at: string | null;
}
interface MonitorLlmKeyStats {
  label: string; is_active: boolean; is_healthy: boolean;
  total_calls: number; error_count: number; error_rate: number;
  last_used_at: string | null;
}
interface MonitorLlmProvider {
  name: string; healthy_keys: number; key_stats: MonitorLlmKeyStats[];
}
interface MonitorOverview {
  proxy: MonitorProxyNode[];
  llm: {
    initialized: boolean;
    failover: { active_provider: string; is_failover_active: boolean; primary: string;
                fallback: string; failure_counts: Record<string, number>;
                last_failure_at: Record<string, string | null> };
    proxy_pool: MonitorProxyNode[];
    providers: Record<string, Omit<MonitorLlmProvider, 'name'>>; // {name: {healthy_keys, key_stats}}
  };
  admin: { llm_gateway: { initialized: boolean; active_provider: string; is_failover_active: boolean };
           proxy_nodes: number; healthy_proxy_nodes: number };
}
```

**页面渲染方案：**

- `monitor/agent-monitor-page.tsx` 四张卡改为：
  1. 「Proxy 健康」→ `admin.healthy_proxy_nodes / admin.proxy_nodes`（数据缺失显示 `-`）；
  2. 「运行中 / 已登记 Agent」→ **删除**（wire 无此数据；Agent 计数由概览页/列表页从 `listAgents()` 承担）；
  3. 「提供方健康」→ `Object.keys(llm.providers).length`（或 healthy_keys>0 计数）；
  4. 「熔断中」→ `llm.failover.is_failover_active ? 1 : 0`，副文案显示 `active_provider`；
- Provider 明细表改为：provider 名 / healthy_keys / key_stats 条数 / 展开 key 明细（label、is_healthy、total_calls、error_rate、last_used_at）；
- 「数据更新于 updated_at」→ 无 wire 时间，改为本地 `loadedAt`（fetch 完成时 `new Date()`）或删除；
- `resetFailover`（#56）保持不变；
- `ProxyStatus` 类型与 `PROXY_STATUS_TEXT` 表**删除**（wire 无此字段，`up|degraded|down` 语义来自臆造）。
- `overview/agent-overview-page.tsx` 运行指标区同样重写（Proxy 卡、提供方卡、熔断卡）；「运行中/已登记 Agent」卡删除（该页 Agent 统计区已用 `listAgents()` 提供 runningCount，不重复）。

### 3.2 MCP 四字段恒 0

**根因**：`MCPServerConfig` wire 只有 `{name, transport, endpoint, args, env, timeout, auto_connect, description}`；`state/tool_count/enabled/updated_at` **全部是前端臆造**。

**修法（前端映射修正 + 字段兜底/隐藏）：**

- `types.ts`：`McpServer` 重写为 wire 八字段；删除 `McpConnectionState`（或仅保留为 health 派生）；`McpTool.input_schema` → `inputSchema`；`McpServerPayload.endpoint` 改为**必填**（ai-platform `RegisterServerRequest.endpoint: str` 必填，stdio 也必填）。
- `api/agent-ops-api.ts`：`callMcpTool` body `{tool, arguments}` → `{tool_name, arguments}`（对话框 `agent-mcp-tools-dialog.tsx` 调用点同步改 `tool_name`）。
- `agent-mcp-page.tsx`：
  - 删除「登记状态」列（`state`）、「工具数」列（`tool_count`）、「更新时间」列（`updated_at`）；
  - 「实时探测」列保留（#35 health map）；
  - `enabled` 显示 → `auto_connect`（「自动连接」）；
  - 筛选「登记状态」→ 改为按探测结果（已连接=probe true / 未连接=probe false / 未知=未探测）；
  - 统计卡：Server 总数 / 探测正常 / 探测异常 / 自动连接数（替换「工具总数」）；
  - 「登记状态 vs 实时探测」信息条改写或删除。

### 3.3 `enabled_skill_count` 恒 0

**根因**：`AgentSummary` wire 字段是 `{agent_id, display_name, state, runtime_type, active_sessions, is_active, role}`，**无 `enabled_skill_count`**。

**修法**：`types.ts` `AgentSummary` 删除 `enabled_skill_count`，补 `runtime_type` / `active_sessions` / `is_active`（真实字段）；消费点（`agent-list-page.tsx` 列与统计、`agent-detail-route.tsx`、`chat/agent-chat-page.tsx`、`overview/agent-overview-page.tsx`）将「已启用技能」展示替换为 `active_sessions`（活跃会话，真实且有运营价值），无对应展示处直接删除。

### 3.4 BFF `/admin/approvals` 转发路径（精确到文件+行）

文件：`backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/AgentOpsClient.java`

| 位置 | 现状 | 改为 |
|---|---|---|
| 常量区（L45–50 附近） | — | 新增 `private static final String PUSH = "/api/v1/push";` |
| L420–424 `listApprovals` | `path(ADMIN + "/approvals")` | `path(PUSH + "/approvals")`（query 原样透传 `status`） |
| L426–430 `decideApproval` | `path(ADMIN + "/approvals/{id}/decision")`，body 透传 | `path(PUSH + "/approvals/{id}/respond")`；body 加工 `{approved, comment}` → `{decision, comment}` |

> ⚠️ **必要范围澄清**：同一文件 `AgentOpsClient.java` 还承载 §2.3 配置文件读/写两条路径修正（`/config-files/content?path=` → `/config-files/{file}`）。当前 BFF 若只改审批不改配置文件，配置文件页读/写会错打到名为 `content` 的文件（且写操作有覆盖风险）。建议把硬约束「approvals 转发一处」理解为 **`AgentOpsClient.java` 一处**（4 个方法同类修正），需主理人确认。

---

## 4. 文件清单

### 前端 `frontend/mis-admin-web/src/features/agent/`（主改动区）

| 文件 | 动作 | 归属任务 |
|---|---|---|
| `types.ts` | 改（重写 ConfigFileNode/Content/SaveConfigFilePayload、WorkerCatalog、DispatchTrace、McpServer/McpTool、AgentSummary、MonitorOverview+Monitor*；新增 WorkerCatalogWorker/MonitorProxyNode/MonitorLlmKeyStats/MonitorLlmProvider；删除 ProxyStatus/enabled_skill_count） | T01 |
| `api/agent-ops-api.ts` | 改（getConfigFileContent/saveConfigFileContent、getWorkerCatalog/saveWorkerCatalog、listDispatchTraces、getAgentSkills/saveAgentSkills、callMcpTool、McpServerPayload） | T01 |
| `agents/agent-config-page.tsx` | 改（扁平列表→树构建、字段映射） | T02 |
| `agents/agent-config-file-editor.tsx` | 改（去 sha256/冲突护栏、type 展示、保存 body） | T02 |
| `catalog/agent-catalog-page.tsx` | 改（对象化 workers/coordinators、security_level、删 role 筛选） | T02 |
| `dispatch/agent-dispatch-page.tsx` | 改（traces 区块列/筛选重接） | T03 |
| `agents/agent-skills-page.tsx` | 验证（若 API 适配则零改动） | T03 |
| `approvals/agent-approval-page.tsx` | 验证（BFF 适配后零改动） | T03 |
| `monitor/agent-monitor-page.tsx` | 改（四卡/明细表/删 ProxyStatus） | T04 |
| `overview/agent-overview-page.tsx` | 改（运行指标区重写、删 agents_running 卡） | T04 |
| `mcp/agent-mcp-page.tsx` | 改（删臆造列、auto_connect、探测筛选） | T04 |
| `mcp/agent-mcp-tools-dialog.tsx` | 改（`tool_name` 调用点） | T04 |
| `agents/agent-coordination-page.tsx` | 改（嵌套 Coordination 表单重接，**待确认**） | T05 |
| `agents/agent-list-page.tsx` / `agent-detail-route.tsx` / `chat/agent-chat-page.tsx` | 改（enabled_skill_count → active_sessions） | T04 |
| `pages.ts` | 不改（导出符号不动） | — |

### BFF `backend/mis-admin-bff/`

| 文件 | 动作 | 归属任务 |
|---|---|---|
| `src/main/java/com/mis/adminbff/client/AgentOpsClient.java` | 改（审批 ×2 + 配置文件读/写 ×2，路径与 body） | T01 |

> 约束：**不动 ai-platform**（已定型）；**不动其它前端 feature**（`arch/no-cross-feature` 红线）；BFF 只动 `AgentOpsClient.java` 一个文件。

---

## 5. 任务列表（有序，≤5 个，按依赖）

| 任务 | 名称 | 源文件 | 依赖 | 优先级 |
|---|---|---|---|---|
| **T01** | 数据层对齐：types.ts + agent-ops-api.ts + BFF AgentOpsClient 路径/body 修正 | `types.ts`、`api/agent-ops-api.ts`、`backend/.../client/AgentOpsClient.java` | — | P0 |
| **T02** | 配置文件页 + worker-catalog 页重接 | `agents/agent-config-page.tsx`、`agents/agent-config-file-editor.tsx`、`catalog/agent-catalog-page.tsx` | T01 | P0 |
| **T03** | 观测与审批收口：traces 区块重接 + skills/approvals 验证 | `dispatch/agent-dispatch-page.tsx`、`agents/agent-skills-page.tsx`、`approvals/agent-approval-page.tsx` | T01 | P0 |
| **T04** | P2 收口：MonitorOverview 重写 + MCP 重接 + enabled_skill_count 替换 | `monitor/agent-monitor-page.tsx`、`overview/agent-overview-page.tsx`、`mcp/agent-mcp-page.tsx`、`mcp/agent-mcp-tools-dialog.tsx`、`agents/agent-list-page.tsx`、`agents/agent-detail-route.tsx`、`chat/agent-chat-page.tsx` | T01 | P0 |
| **T05** | coordination 页重接（A+ 待确认）+ 最终 typecheck 全绿回归 | `agents/agent-coordination-page.tsx`（+ 回归检查 `pages.ts`/详情壳） | T01–T04 | P1 |

> 说明：typecheck（`npm run typecheck`）以**合入前最终态全绿**为准；T01 改类型后中间态允许阶段性红，但每个任务合入前必须本任务涉及文件无 TS 错误。会话页 / 企微页零改动。

---

## 6. 待确认事项

1. **BFF 改动边界**：是否同意将「approvals 转发一处」放宽为「`AgentOpsClient.java` 一处」（审批 2 方法 + 配置文件读/写 2 方法）？配置文件不修会错打 `content` 文件且有覆盖风险，无法纯前端解决。
2. **coordination 页（T05）**：A+ 增量是否纳入本期？（真实 wire 为嵌套 `{delegation, catalog}`，前端表单需整体重接，工作量约等于半个页面。）
3. **skills 绑定页（T03）**：属于 T04 子集端点，建议随本期 API 适配一并收口，是否同意？
4. **MonitorOverview 的「运行中/已登记 Agent」卡**：wire 无此数据，方案是删除（概览页已有 listAgents 派生计数）。若产品坚持保留在监控页，需要 ai-platform 在 `admin/health` 补字段（违反「不动 ai-platform」，不推荐）。
5. **审批「默认只看 pending」**：维持现状（`listApprovals(status='pending')` 默认）——ai-platform `list_approvals` 无分页信封，limit 默认 100，足够。

---

## 7. 共享知识（wire 事实表，唯一契约来源）

- 所有 BFF 响应统一 `{code, data, message}`（`unwrap` 校验 `code===0`）。
- 所有时间 ISO 8601 UTC；前端展示用 `formatTime`（本 feature 自建，跨 feature 禁止 import）。
- **ai-platform 真实 wire 对照（以源码为准，禁止臆造字段）：**

| ai-platform 端点 | 返回形状 | 前端对应 |
|---|---|---|
| `GET /sessions` | `{items,total,page,page_size}`，item=`SessionResponse` | `Session` ✅ |
| `GET /sessions/{id}/messages` | `SessionMessage[]` | `SessionMessage` ✅ |
| `GET /api/v1/channels/wecom/bots` | `WecomBot[]`（snake，secret_masked，health 内嵌） | `WecomBot` ✅ |
| `GET /api/v1/channels/wecom/bots/health` | `{bot_id: connected\|disconnected\|unknown}` | `Record<string, WecomBot['health']>` ✅ |
| `GET /agents/{id}/config-files` | `[{path,type,read_only,size_bytes}]` 扁平 | 重写 |
| `GET\|PUT /agents/{id}/config-files/{path}` | 读 `{content,masked,read_only,type}`；写 body `{content}` | 重写 + BFF |
| `GET /admin/worker-catalog` | `{workers[],coordinators[],fallback}` | 重写 |
| `PUT /admin/worker-catalog` | body `{updates:[{agent_id,enabled?,when_to_use?}]}` | 重写 |
| `GET /admin/dispatch-traces` | `{traces[],total}`；item=`{intent,worker_id,tool,status,latency_ms,task_id,brief_rejected,session_id,created_at}` | 重写 |
| `GET /admin/route-logs` | `RouteLog[]` | `RouteLog` ✅ |
| `GET /admin/route-stats` | `RouteStats` | `RouteStats` ✅ |
| `GET /push/approvals` | `Approval[]`（camelCase，5 状态） | `Approval` ✅ |
| `POST /push/approvals/{id}/respond` | body `{decision,comment}` | BFF body 加工 |
| BFF `#55 /agent-ops/monitor/overview` | `{proxy, llm, admin}` | 重写 |
| `GET /mcp` | `MCPServerConfig[]` = `{name,transport,endpoint,args,env,timeout,auto_connect,description}` | 重写 |
| `GET /mcp/health` | `{name: bool}` | ✅ |
| `GET /mcp/{name}/tools` | `[{name,description,inputSchema}]` | `inputSchema` |
| `POST /mcp/{name}/call` | body `{tool_name,arguments}` | `tool_name` |
| `GET /agents` | `AgentSummary[]` = `{agent_id,display_name,state,runtime_type,active_sessions,is_active,role}` | 删 `enabled_skill_count` |
| `GET\|PUT /agents/{id}/skills` | `{agent_id,enabled_skill_ids,pool[]}`；写 body `{skill_ids}` | API 适配 |
| `GET\|PUT /agents/{id}/coordination` | `AgentCoordination{agent_id,role,routing_enabled,delegation,catalog}` | 重写（T05） |

- 错误码约定：`AI_SKILL_FORBIDDEN`/`AI_ACL_UNAVAILABLE`/`AI_OPS_FORBIDDEN`/`CONFIG_CONFLICT`/`COORD_FIELD_NOT_APPLICABLE` 文案在 `types.ts`，`agentErrorMessage` 子串匹配。
- 前端门禁唯一：`cd frontend/mis-admin-web && npm run typecheck`（strict + noUnusedLocals），合入前 0 错。
- 改动红线：只动 `features/agent/**`、必要时共享组件、BFF 仅 `AgentOpsClient.java`；**不动 ai-platform**；features 间禁止互相 import。
