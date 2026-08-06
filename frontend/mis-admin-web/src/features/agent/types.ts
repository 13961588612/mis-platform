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

export interface Skill {
  id: string;
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

export interface AgentSummary {
  id: string;
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
  id: string;
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

export interface SessionMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  /** 工具调用类消息的附加信息（tool 名、入参摘要等）。 */
  meta?: Record<string, unknown>;
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

export interface RouteLog {
  id: string;
  session_id?: string;
  matched_agent_id?: string;
  reason?: string;
  created_at: string;
}

export interface RouteStat {
  agent_id: string;
  display_name?: string;
  hit_count: number;
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

export interface MonitorOverview {
  proxy_status: 'up' | 'down' | 'degraded';
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

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Approval {
  id: string;
  session_id?: string;
  agent_id?: string;
  action: string;
  payload_summary?: string;
  status: ApprovalStatus;
  requested_at: string;
  decided_at?: string;
  decided_by?: string;
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
