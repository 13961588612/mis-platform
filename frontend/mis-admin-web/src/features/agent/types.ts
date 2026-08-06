/**
 * 智能体运营控制台 DTO。
 *
 * <p>骨架版（T01）：只放 impl-plan §4.6 已确定的类型 + T02–T05 页面壳需要的最小集合。
 * T05 按需**增量追加，不重构**（impl-plan §10.2 约定）。
 *
 * <p>**字段命名为什么是 snake_case**：这些结构绝大多数由 BFF `/agent-ops/**`
 * 从 ai-platform（Python/FastAPI）**原样透传**，不做 key 转换。仓库内 `features/kb`
 * 用 camelCase 是因为它的对端是 Java BFF 自建 DTO，两者不是一回事。
 * 这里跟随实际 wire format，避免在页面里到处写映射函数。
 * 仅 `AgentRoleOption` 例外 —— 它来自 IAM（Java）侧的 sys_role，保持 camelCase。
 */

// ------------------------------------------------------------------ 通用

/** 后端分页信封（ai-platform 侧列表接口统一形状）。 */
export interface AgentPage<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 列表类查询的公共分页入参。 */
export interface AgentPageQuery {
  page?: number;
  page_size?: number;
}

// ------------------------------------------------------------------ 技能池（UI#1 #7）

export type SkillStatus = 'active' | 'disabled';

/**
 * 技能池条目。
 *
 * <p>**主键是 `skill_id` 而不是 `id`**：ai-platform `api/routes/skill.py` 的 `Skill`
 * 模型定义即为 `skill_id`，BFF 原样透传。此前这里写成 `id` 是照设计文档臆造的，
 * 运行时取到 `undefined`，导致列表 `key`、选中集合、`getSkill(s.id)` 全部错位
 * （拼出 `/agent-ops/skills/undefined`）。
 */
export interface Skill {
  skill_id: string;
  name: string;
  description: string;
  status: SkillStatus;
  category?: string;
  version?: string;
  tags?: string[];
  updated_at: string;
}

export interface SkillStats {
  total: number;
  active: number;
  disabled: number;
  /** 最近一次重建索引时间，未建过为 null。 */
  last_reindex_at: string | null;
}

/**
 * 技能授权（UI#2）。
 *
 * <p>`permission_code` 恒为 `ai:skill:{skill_id}:run`（V21 建的按钮节点），
 * `target_app_code` 决定这个码挂在哪个 App 的菜单树下 —— 当前 V21 统一落 `system`，
 * 保留 `agent` 取值是为 T05 支持"只在运营台内可执行"的技能预留。
 */
export interface SkillGrant {
  skill_id: string;
  permission_code: string;
  target_app_code: 'system' | 'agent';
  role_ids: number[];
  /**
   * 执行码是否已在 IAM 注册（impl-plan §5.4 / §11.3 Q1-b 方案 A）。
   *
   * <p>BFF 创建 Skill 时懒注册 `ai:skill:{id}:run`，注册失败**不回滚主流程**，
   * 只回传 `false`。为 `false` 时授权页必须提示「码尚未注册，保存将顺带补建」，
   * 否则运营会以为授权成功但运行时依旧 fail-closed 拒绝。
   * 字段来自 Java 侧，故为 camelCase（与 `AgentRoleOption` 同理）。
   */
  permissionCodeRegistered?: boolean;
}

/** 授权选择器用的角色项（来源：IAM sys_role，camelCase）。 */
export interface AgentRoleOption {
  id: number;
  name: string;
  code: string;
  appCode?: string | null;
}

// ------------------------------------------------------------------ Agent

export type AgentRole = 'coordinator' | 'worker';
export type AgentState = 'running' | 'paused' | 'stopped' | 'error';

/**
 * Agent 概要。
 *
 * <p>**主键是 `agent_id` 而不是 `id`**：ai-platform `api/routes/agent.py` 的
 * `AgentSummary(agent_id=inst.id, ...)` 明确以 `agent_id` 出网，BFF 原样透传。
 * 此前声明为 `id`，导致所有下拉选中判等（`a.id === value`）恒为 `undefined === x`
 * 即恒 false，且 `startAgent(agent.id)` 拼出 `/agent-ops/agents/undefined`。
 *
 * <p>`enabled_skill_count` 真实 wire 上**并不存在**（ai-platform 未产出该字段），
 * 属已知 P2 差异：消费点只做数字展示，取到 `undefined` 时渲染为空而不崩溃，
 * 故本次不动，留待后端补字段或前端改为可选。
 */
export interface AgentSummary {
  agent_id: string;
  display_name: string;
  role: AgentRole;
  state: AgentState;
  enabled_skill_count: number;
}

export interface AgentDetail extends AgentSummary {
  description?: string;
  model?: string;
  /** 磁盘上的 agent 目录名，配置文件接口以此定位。 */
  workspace?: string;
  updated_at?: string;
}

export interface AgentHealth {
  agent_id: string;
  healthy: boolean;
  state: AgentState;
  /** 逐项探针结果，键为探针名（如 llm / mcp / memory）。 */
  checks?: Record<string, boolean>;
  message?: string;
  checked_at?: string;
}

/** Agent ⇄ Skill 绑定（UI#5：仅可选池内 status=active 的 Skill）。 */
export interface AgentSkillBinding {
  skill_id: string;
  enabled: boolean;
  /** 该技能在池内的当前状态，用于前端置灰已下线项。 */
  skill_status?: SkillStatus;
}

// ------------------------------------------------------------------ 配置文件（UI#9）

export interface ConfigFileNode {
  path: string;
  name: string;
  type: 'dir' | 'file';
  format: 'yaml' | 'markdown';
  editable: boolean;
  size: number;
  updated_at: string;
  children?: ConfigFileNode[];
}

/**
 * 配置文件内容。
 *
 * <p>`masked=true` 表示内容里的密钥已被替换成 `***`，
 * 此时**禁止整体保存**（会把 `***` 写回覆盖真密钥）—— 这是 impl-plan §4.4 的必备护栏。
 * `sha256` 用于保存时的并发保护，回传为 `base_sha256`，不符则 409 CONFIG_CONFLICT。
 */
export interface ConfigFileContent {
  path: string;
  content: string;
  format: 'yaml' | 'markdown';
  editable: boolean;
  masked: boolean;
  sha256: string;
}

export interface SaveConfigFilePayload {
  path: string;
  content: string;
  base_sha256: string;
}

// ------------------------------------------------------------------ 调度配置（UI#10）

export type SafetyLevel = 'low' | 'medium' | 'high';

/**
 * C–W 调度契约。coordinator 字段与 worker 字段**互斥**，
 * 提交不适用的字段服务端返回 COORD_FIELD_NOT_APPLICABLE（impl-plan §4.5）。
 */
export interface Coordination {
  role: AgentRole;
  // worker 侧
  when_to_use?: string;
  input_contract?: string;
  output_contract?: string;
  safety_level?: SafetyLevel;
  // coordinator 侧
  allowed_workers?: string[];
  max_depth?: number;
  max_fanout?: number;
  task_brief_template?: string;
}

/** 保存 coordination 的响应：role 变更引发级联清理时回传受影响的 agent。 */
export interface CoordinationSaveResult {
  coordination: Coordination;
  affected_agents: string[];
}

/** Worker Catalog 单行（全局视图，深链到各自的 coordination 页）。 */
export interface WorkerCatalogEntry {
  agent_id: string;
  display_name: string;
  role: AgentRole;
  when_to_use?: string;
  safety_level?: SafetyLevel;
  enabled: boolean;
}

// ------------------------------------------------------------------ 会话（UI#4）

export type SessionChannel = 'web' | 'wecom' | 'api' | 'unknown';

/**
 * 会话。
 *
 * <p>主理人决策 ①：会话列表的**存储与检索在 T04 落地**，但类型按"全量可查"定义 ——
 * 即列表不限于内存中的活跃会话，历史会话同样可检索，故这里带齐时间与统计字段。
 */
export interface Session {
  /**
   * 会话主键。**wire 上是 `session_id`**（ai-platform `SessionResponse.session_id`，
   * 见 `api/routes/session.py`），此前写成 `id` 属臆造。
   */
  session_id: string;
  agent_id: string;
  agent_name?: string;
  channel: SessionChannel;
  user_id?: string;
  user_name?: string;
  title?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 会话消息。
 *
 * <p>字段名对齐 ai-platform `MessageResponse`（`api/routes/session.py`）：
 * 时间字段是 `timestamp` 不是 `created_at`，附加信息是 `metadata` 不是 `meta`。
 * 用错名字不会报错、只会静默渲染成 `-`，比崩溃更难查，故一并收口。
 */
export interface SessionMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  /** 工具调用类消息的附加信息（tool 名、入参摘要等）。 */
  metadata?: Record<string, unknown>;
}

export interface SessionQuery extends AgentPageQuery {
  agent_id?: string;
  channel?: SessionChannel;
  keyword?: string;
  from?: string;
  to?: string;
}

// ------------------------------------------------------------------ MCP（UI#8）

export type McpConnectionState = 'connected' | 'disconnected' | 'error' | 'unknown';

export interface McpServer {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  endpoint?: string;
  state: McpConnectionState;
  tool_count: number;
  enabled: boolean;
  updated_at?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema，形状由各 MCP Server 自定，前端只做只读展示。 */
  input_schema?: Record<string, unknown>;
}

export interface McpCallPayload {
  tool: string;
  arguments: Record<string, unknown>;
}

// ------------------------------------------------------------------ 调度观测

export interface DispatchTrace {
  trace_id: string;
  coordinator_id: string;
  worker_id?: string;
  task_brief?: string;
  status: 'success' | 'failed' | 'running';
  depth: number;
  started_at: string;
  duration_ms?: number;
}

/**
 * 单条路由日志。对齐 ai-platform `src/router/models.py` 的 `RouteLog`。
 *
 * <p>#46 `GET /api/v1/admin/route-logs` 返回 `[log.model_dump() for log in logs]`，
 * 是**数组**。此前前端声明的 `reason` / `created_at` 两个字段在 wire 上并不存在，
 * 实际字段是 `strategy_used` / `timestamp`，表格里那两列一直是空的。
 */
export interface RouteLog {
  id: string;
  session_id?: string;
  user_id?: string;
  /** 触发路由的原始输入文本，用于替代此前臆造的 `reason` 列。 */
  input_text?: string;
  matched_agent_id?: string;
  /** 命中该 Agent 所用的路由策略（keyword / llm / fallback 等）。 */
  strategy_used?: string;
  confidence?: number;
  latency_ms?: number;
  timestamp: string;
}

/**
 * 路由统计。**是一个聚合对象，不是数组。**
 *
 * <p>#47 `GET /api/v1/admin/route-stats` 返回 `stats.model_dump()`，其中
 * `stats: RouteStats`（`src/router/route_logger.py#get_stats`）。此前前端把它
 * 声明成 `RouteStat[]` 并直接 `[...stats].sort()` / `stats.reduce()`，
 * 对着一个普通对象展开迭代器 → `stats is not iterable` 直接崩页。
 *
 * <p>`by_agent` / `by_strategy` 是 `{ 键: 次数 }` 的计数字典，
 * 占比需前端用 `total_routes` 自行换算（后端不下发 ratio）。
 */
export interface RouteStats {
  total_routes: number;
  by_agent: Record<string, number>;
  by_strategy: Record<string, number>;
  avg_latency_ms: number;
  avg_confidence: number;
}

/**
 * 由 {@link RouteStats.by_agent} 摊平出的单行视图（**纯前端派生，非 wire 类型**）。
 *
 * <p>页面表格需要「Agent / 命中数 / 占比」三列，而后端只给计数字典，
 * 故在页面侧做一次 `Object.entries` + 排序 + 占比换算，得到本结构。
 */
export interface RouteAgentShare {
  agent_id: string;
  hit_count: number;
  /** 0–1 之间的占比，`total_routes` 为 0 时取 0。 */
  ratio: number;
}

// ------------------------------------------------------------------ 企微机器人（UI#3）

/**
 * 企微 Bot。
 *
 * <p>主理人决策 ②：本期只做**多实例并存 + 独立启停**，不改 WS→HTTP 接入方式。
 * `secret` **只写不读**：后端只返回 `secret_masked`，表单留空 = 不修改。
 */
export interface WecomBot {
  bot_id: string;
  name: string;
  enabled: boolean;
  ws_url: string;
  secret_masked: string;
  bound_agent_id?: string;
  health: 'connected' | 'disconnected' | 'unknown';
}

export interface WecomBotPayload {
  name: string;
  ws_url: string;
  /** 留空表示不修改既有 secret（新建时必填）。 */
  secret?: string;
  bound_agent_id?: string;
}

// ------------------------------------------------------------------ 监控 / 审批

/**
 * 出站代理状态。
 *
 * <p>`up | degraded | down` 来自 ai-platform 侧的语义；`unknown` 是**前端兜底档**
 * —— 见 {@link MonitorOverview.proxy_status}，wire 上这个字段并不保证存在。
 * 把兜底做成枚举成员（而不是每个消费点各写一个 if）是为了让文案/配色只有一处定义。
 */
export type ProxyStatus = 'up' | 'down' | 'degraded' | 'unknown';

export interface MonitorOverview {
  /**
   * 出站代理状态。**可选，且可能为 null。**
   *
   * <p>为什么不是必填：#55 `GET /agent-ops/monitor/overview` 在 BFF
   * （`AgentOpsFacadeService#monitorOverview`）里是把 ai-platform 的
   * `admin/proxy/status`、`admin/llm/status`、`admin/health` 三路响应
   * 原样拼成 `{proxy, llm, admin}` 返回的，**并不产出 `proxy_status`**。
   * 也就是说运行时取到 `undefined` 是常态而非异常。
   *
   * <p>此前这里声明为 `'up' | 'down' | 'degraded'`（必填），等于向 TS 撒谎：
   * 消费点 `PROXY_STATUS_TEXT[proxy_status].label` 被静态判定为安全，
   * 实际查表得 `undefined` 后读 `.label` 直接白屏。
   * 现在声明为可选，TS 会在每个消费点强制要求兜底 —— 这是修复的核心。
   */
  proxy_status?: ProxyStatus | null;
  agents_running: number;
  agents_total: number;
  llm_providers: Array<{
    name: string;
    healthy: boolean;
    /** failover 熔断中为 true，可由 agent:monitor:operate 重置。 */
    tripped: boolean;
    latency_ms?: number;
  }>;
  updated_at: string;
}

/**
 * 审批状态。
 *
 * <p>取值与 ai-platform `src/hitl/store.py#ApprovalStatus` 枚举**逐项对齐**，
 * 共 5 档。此前前端只声明了前 3 档，一旦后端回 `timeout` / `expired`，
 * 状态文案表按键查不到就是 `undefined.label` —— 与 `proxy_status` 同款崩法。
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'expired';

/**
 * HITL 审批记录。
 *
 * <p>**本类型是整个 feature 里唯一的 camelCase 例外之二**（另一个是 `AgentRoleOption`）。
 * 原因：ai-platform `api/routes/push.py#_to_approval_response` 手工拼的就是
 * camelCase 字典，不走 Pydantic 的 snake_case `model_dump()`，BFF 又是原样透传。
 * 这里跟随真实 wire，不做映射。
 *
 * <p>此前声明的 `action` / `payload_summary` / `requested_at` / `decided_at` /
 * `decided_by` **在 wire 上全部不存在**：`action` 恒 `undefined`，
 * 而页面用它查动作文案表 `ACTION_TEXT[approval.action].label` → 白屏。
 * 真实语义映射为：动作描述在 `detail.title` / `detail.description`，
 * 发起时间是 `createdAt`，结束时间是 `resolvedAt`，决策人即 `userId`。
 */
export interface Approval {
  approvalId: string;
  sessionId?: string;
  agentId?: string;
  /** 触发审批的技能 ID（审批总是由某个 skill 调用发起）。 */
  skillId?: string;
  /** 被指派审批的用户；决策后即为决策人。 */
  userId?: string;
  status: ApprovalStatus;
  /**
   * 审批详情。后端为自由字典（`ApprovalManager.build_approval_detail`
   * 约定含 `title` / `description` / `skill_id`），故这里不写死结构。
   */
  detail?: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt?: string | null;
  comment?: string | null;
  timeoutSeconds?: number;
}

/**
 * 从 {@link Approval.detail} 里安全取字符串字段。
 *
 * <p>`detail` 是后端自由字典，键可能缺失、值可能不是字符串。
 * 页面若直接 `approval.detail.title` 会在 `detail` 为 null 时崩溃，
 * 故统一走这个兜底读取器。
 */
export function approvalDetailText(
  detail: Approval['detail'],
  key: string,
  fallback = '-',
): string {
  const value = detail?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export interface ApprovalDecisionPayload {
  approved: boolean;
  comment?: string;
}

// ------------------------------------------------------------------ 展示辅助（T05 增量）

/**
 * ISO 8601 UTC → 本地可读串（impl-plan §10.5「时间」约定）。
 *
 * <p>本 feature **自建**一份而不复用 `features/kb/types.ts` 的同名函数：
 * `arch/no-cross-feature` 是 error 级，跨 feature import 直接构建失败。
 * 与 `unwrap` / `cleanParams` 一样属于刻意的重复（§10.1 约定 1）。
 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 后端业务错误码 → 面向运营的中文文案（impl-plan §10.5「错误码」）。
 *
 * <p>键为错误码字符串，取值为**不带占位符**的固定文案；
 * `AI_SKILL_FORBIDDEN` 需要拼具体权限码，单独在下方处理。
 */
const AGENT_ERROR_TEXTS: Record<string, string> = {
  AI_ACL_UNAVAILABLE: '权限服务不可用，已按最小权限拒绝。请稍后重试或联系管理员。',
  AI_OPS_FORBIDDEN: '缺少该运营操作的权限码，请联系管理员。',
  CONFIG_CONFLICT: '文件已被他人修改，请重新加载后再保存。',
  COORD_FIELD_NOT_APPLICABLE: '提交了与当前角色不匹配的字段（协调者/执行者字段互斥），请检查后重试。',
};

/** 从任意异常里尽量取出后端 message（不 import axios，纯鸭子类型探测）。 */
function rawErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const shaped = error as {
      response?: { data?: { message?: unknown } };
      message?: unknown;
    };
    const fromBody = shaped.response?.data?.message;
    if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
    if (typeof shaped.message === 'string') return shaped.message;
  }
  return '';
}

/**
 * 统一错误提示：识别已知错误码则换成运营看得懂的话，否则透传后端 message。
 *
 * <p>为什么按**子串**匹配而不是精确等值：BFF 透传下游时 message 形如
 * `AI_SKILL_FORBIDDEN: missing ai:skill:member.points:run`，
 * 精确匹配会全部落到 fallback，等于这层文案白写。
 */
export function agentErrorMessage(error: unknown, fallback: string): string {
  const raw = rawErrorMessage(error);
  if (!raw) return fallback;

  if (raw.includes('AI_SKILL_FORBIDDEN')) {
    const code = /ai:skill:[^\s,'"]+:run/.exec(raw)?.[0];
    return code ? `缺少权限码 ${code}，请联系管理员。` : '缺少该技能的执行权限码，请联系管理员。';
  }
  for (const [code, text] of Object.entries(AGENT_ERROR_TEXTS)) {
    if (raw.includes(code)) return text;
  }
  return raw;
}
