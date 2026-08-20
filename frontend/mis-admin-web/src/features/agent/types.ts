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
 *
 * <p>**T04 收口后 wire 事实以 `docs/ai-fusion/agent-ops-console/t04-closeout-design.md`
 * §7 事实表为准**：本文件与 ai-platform 真实源码（`agent/ai-platform/backend/src`）
 * 逐字段对齐，不再保留任何臆造字段。
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
  /** 执行器标识：mcp:{server}:{tool} / builtin:{name} / custom:{module}.{func}；空串 = 文档型/检索型。 */
  handler?: string;
  /** 来源：custom / mcp / builtin / package（对齐 SkillSource 枚举）。 */
  source?: string;
}

/**
 * 选择器用的技能摘要（内嵌选择器数据源，对齐 `GET /skills` 列表项）。
 *
 * <p>比 {@link Skill} 精简：仅保留选择器渲染与注入所需的字段。
 */
export interface SkillSummary {
  skill_id: string;
  name: string;
  description: string;
  category?: string;
}

/**
 * 选择器确认后的「已选技能」载荷（含正文，供注入下一条用户消息）。
 */
export interface SkillBuilderSelection {
  skill_id: string;
  name: string;
  body: string;
}

/**
 * 技能详情（列表项 + 详情抽屉扩展字段）。
 *
 * <p>对齐 ai-platform `GET /skills/{id}` 在 package skill 下额外返回的
 * `body / scripts / references / assets`。custom 自建技能这些字段为 `undefined` / `null`。
 */
export interface SkillDetail extends Skill {
  body?: string;
  scripts?: string[];
  references?: string[];
  assets?: string[];
  /** B-1.5：参考资料文件内容（key = 相对路径，value = 文件正文），由详情接口按 `references` 一并读出。 */
  reference_contents?: Record<string, string>;
}

/**
 * 解析 SKILL.md 的响应（前端只读预览，不持久化）。
 *
 * <p>对齐后端 `POST /skills/parse` 的 `SkillParseResponse`：`metadata` 为 Front Matter
 * 解析出的字典（可能为空），`body` 为 Markdown 正文（无 Front Matter 时为原文）。
 */
export interface SkillParseResponseFE {
  metadata: Record<string, unknown>;
  body: string;
}

/**
 * 「AI 对话创建」Tab(C) 的单条对话消息（前端本地 state 维护，不落库）。
 *
 * <p>`role` 沿用 LLM 约定（user/assistant/system）；`status` 为渲染态：
 * `generating` 生成中 / `generated` 已生成 / `error` 出错；`converged` 由后端
 * 判定（本轮产出的 SKILL.md 是否已完整，可作为回填信号）。
 */
export interface SkillBuilderMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'generating' | 'generated' | 'error';
  converged?: boolean;
}

/**
 * 「AI 对话创建」请求契约（前端 → BFF → ai-platform `POST /skills/builder/chat`）。
 *
 * <p>`messages` 为前端全量维护的多轮上下文（仅 role/content）；`user_input` 为
 * 本轮新增输入；`converged` 为前端收敛信号（如「定稿」），作后端判定的兜底增强。
 */
export interface SkillBuilderChatRequest {
  messages: Array<{ role: string; content: string }>;
  user_input: string;
  converged?: boolean;
}

/**
 * 「AI 对话创建」响应契约（ai-platform `BuilderChatResponse` 透传）。
 *
 * <p>`reply` 为 AI 文本（内含 ```SKILL.md 代码块）；`status` 为 `generating`/`generated`；
 * `converged` 由后端依据产出是否含完整 Front Matter + 正文判定。
 */
export interface SkillBuilderChatResponse {
  reply: string;
  status: 'generating' | 'generated';
  converged: boolean;
}

/**
 * 会话各阶段耗时（A-5 / A-6，对齐后端 `SessionTiming`）。
 *
 * <p>`retrieval_ms` 为 `null` 表示 rag 轨迹不可得，前端显示「—」。其余阶段为
 * 数值（毫秒，可能为 `null` 表示该阶段未发生，如纯生成会话无工具调用）。
 */
export interface StageTiming {
  planning_ms: number | null;
  retrieval_ms: number | null;
  tool_call_ms: number | null;
  generation_ms: number | null;
  post_process_ms: number | null;
}

export interface SessionTiming {
  /** 本轮对应的 assistant 消息 id（2.1 按轮存储的 turn_key）。 */
  turn_key?: string;
  total_ms: number | null;
  stages: StageTiming;
  /** 采样时间（ISO 8601 UTC）。 */
  sampled_at: string;
  /** timing schema 版本，结构变更时 +1。 */
  schema_version: number;
  /**
   * 子阶段细分下钻（v2，schema_version >= 2 才有；旧数据 / 未采集为 null）。
   * 各子段为毫秒整数或 ``null``（不可得，前端显示「—」）。
   */
  sub_stages?: SubStages | null;
}

/**
 * 平铺的子阶段字典（key 为 snake_case 指标名，value 为毫秒或 null）。
 * 用于 retrieval / planning / generation / post_process 各段的内部明细。
 */
export interface SubStageMap {
  [key: string]: number | null;
}

/** 单次工具调用的子阶段明细（tool_call 数组元素）。 */
export interface ToolCallItem {
  tool_name: string;
  /** delegate：委派类（如 agent__invoke）；native：普通工具。 */
  kind: 'delegate' | 'native';
  latency_ms: number | null;
  /** 仅 delegate 类携带：该 worker 内部的 sub_stages（结构同 {@link SubStageMap}）。 */
  sub_stages?: SubStageMap | null;
}

/** tool_call 子阶段：按调用分别计时 + 委派往返近似。 */
export interface ToolCallSubStage {
  calls: ToolCallItem[];
  /** 委派往返近似（父→子 网络委派 + 会话创建/初始化开销）。 */
  delegate_round_trip_ms?: number | null;
}

/**
 * 顶层子阶段结构（v2）。每个键对应一个父阶段；缺测为 null。
 */
export interface SubStages {
  planning?: SubStageMap | null;
  retrieval?: SubStageMap | null;
  tool_call?: ToolCallSubStage | null;
  generation?: SubStageMap | null;
  post_process?: SubStageMap | null;
}

/**
 * 单会话「按轮」耗时 map（2.1 改造后）。
 *
 * <p>key = assistant 消息 id（与 {@link SessionMessage.id} 对齐），value = 该轮
 * {@link SessionTiming}。前端按 ``message.id`` 在 map 中查到对应轮的耗时，逐条内联展示。
 */
export type SessionTimingMap = Record<string, SessionTiming>;

/**
 * 耗时查询返回包（后端 ``GET /sessions/{id}/timing`` 与 ``POST /sessions/timing/batch``）。
 *
 * <p>``turns`` 为按轮 map；``last`` 为最近一轮的 turn_key（兼容旧消费方）。
 * 会话无调试耗时时整体为 ``null``。
 */
export interface SessionTimingPayload {
  turns: SessionTimingMap;
  last: string | null;
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
 * <p>**T04 收口**：真实 wire 字段为
 * `{agent_id, display_name, state, runtime_type, active_sessions, is_active, role}`，
 * **不存在 `enabled_skill_count`**（属 P2 已知债，本期删除）。
 * 「已启用技能」展示统一替换为 `active_sessions`（活跃会话，真实且有运营价值）。
 *
 * <p>**运行位标记**（列表 enrichment）：`in_process` / `lease_owner` /
 * `lease_held_locally` / `core_id` —— 行集合为本地 configs 全量，不再仅本机已 claim 实例。
 */
export interface AgentSummary {
  agent_id: string;
  display_name: string;
  role: AgentRole;
  state: AgentState;
  /** 运行时类型（openharness / custom / langgraph）。 */
  runtime_type?: string;
  /** 当前活跃会话数，替代已删除的臆造字段 `enabled_skill_count`。 */
  active_sessions?: number;
  is_active?: boolean;
  /** 是否已装入本进程 AgentManager 内存。 */
  in_process?: boolean;
  /** Redis 租约持有者 coreId；无租约时为 null。 */
  lease_owner?: string | null;
  /** 租约是否由本机 CORE_ID 持有。 */
  lease_held_locally?: boolean;
  /** 本机 CORE_ID；未启多 Core 租约时为 null。 */
  core_id?: string | null;
}

/**
 * Agent 详情。
 *
 * <p>对齐 ai-platform `AgentDetail`（`api/routes/agent.py`）：
 * `{agent_id, display_name, description, version, tags, state, runtime_type,
 * active_sessions, model_primary, model_fallback, routing_enabled,
 * routing_priority, routing_keywords, started_at}`。
 * T04 收口时删除臆造的 `model` / `workspace` / `updated_at`。
 */
export interface AgentDetail extends AgentSummary {
  description?: string;
  version?: string;
  tags?: string[];
  model_primary?: string;
  model_fallback?: string;
  routing_enabled?: boolean;
  routing_priority?: number;
  routing_keywords?: string[];
  started_at?: string;
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

/**
 * 配置文件列表项（**真实 wire 是扁平数组，不是树**）。
 *
 * <p>对齐 ai-platform `file_service.list_editable_files()`：
 * `[{path, type, read_only, size_bytes}]`。其中 `type` 是文件扩展名（yaml / md / …），
 * `read_only` 表示白名单只读；**无** `name` / `format` / `editable` / `size` /
 * `updated_at` / `children` —— 这些都是 T04 前臆造的字段。
 */
export interface ConfigFileNode {
  path: string;
  /** 文件扩展名（如 `yaml` / `md`），目录项不产生（目录由前端按 path 拆段派生）。 */
  type: string;
  read_only: boolean;
  size_bytes: number;
}

/**
 * 前端派生：由扁平 wire 项按 `/` 拆段构建的目录树节点（供 TreeTable）。
 *
 * <p>TreeTable 要求行是「扁平化 + 带 `id`/`depth`」的数组，这里把 path 的
 * 目录部分合成 `kind='dir'` 节点、叶子为 `kind='file'` 节点，再统一 flatten。
 * **不是 wire 类型**，只在 `agent-config-page.tsx` 内部构建与消费。
 */
export interface ConfigFileTreeRow {
  /** 完整相对路径；目录节点为前缀路径（不带尾部 `/`）。 */
  path: string;
  /** 最后一段（文件或目录名）。 */
  name: string;
  kind: 'dir' | 'file';
  /** 文件扩展名（wire `type`），目录节点为空串。 */
  type: string;
  read_only: boolean;
  size_bytes: number;
  /** TreeTable 硬性契约：稳定 id 与层级深度。 */
  id: string;
  depth: number;
  children?: ConfigFileTreeRow[];
}

/**
 * 配置文件内容。
 *
 * <p>对齐 ai-platform `file_service.read_config_file()`：`{content, masked, read_only, type}`。
 * `masked=true` 表示内容里的密钥已被替换成 `***`，此时**禁止整体保存**（会把 `***`
 * 写回覆盖真密钥）—— 这是 impl-plan §4.4 的必备护栏，与 T04 前的语义一致。
 * **无** `sha256` / `base_sha256`：后端没有并发保护能力（CONFIG_CONFLICT 409 已不存在）。
 */
export interface ConfigFileContent {
  content: string;
  masked: boolean;
  read_only: boolean;
  type: string;
}

/** 保存配置文件请求体：**只发 `{content}`**（path 走 URL 路径段）。 */
export interface SaveConfigFilePayload {
  content: string;
}

/** 保存配置文件响应：`{path, masked, reloaded}`（后端不下发 content）。 */
export interface SaveConfigFileResult {
  path: string;
  masked: boolean;
  reloaded: boolean;
}

// ------------------------------------------------------------------ 调度配置（UI#10）

/**
 * Worker 安全等级。
 *
 * <p>对齐 ai-platform `coordination_service.CoordinationCatalog.security_level`
 * 与 `coordinator/catalog.py` 的 WorkerSpec：仅 `read_only` / `needs_hitl` 两档，
 * **不是** T04 前臆造的 `low|medium|high`。
 */
export type SecurityLevel = 'read_only' | 'needs_hitl';

/** Coordinator 委派段（真实 wire `delegation`）。 */
export interface CoordinationDelegation {
  spawn_tools_enabled: boolean;
  enforce_task_brief: boolean;
  max_depth: number;
  timeout_seconds: number;
  emit_dispatch_trace: boolean;
  forbid_self_invoke: boolean;
  worker_ids: string[];
}

/** Worker Catalog 段（真实 wire `catalog`）。 */
export interface CoordinationCatalog {
  enabled: boolean;
  when_to_use: string;
  capabilities: string[];
  input_contract: string[];
  output_contract: string;
  security_level: SecurityLevel;
  timeout_seconds: number;
  degrade_message: string;
}

/**
 * C–W 调度契约（**嵌套结构**，T05 收口）。
 *
 * <p>对齐 ai-platform `AgentCoordination`（`coordinator/coordination_service.py`）：
 * `{agent_id, role, routing_enabled, delegation?, catalog?}`。
 * 此前扁平化的 `when_to_use / safety_level / allowed_workers / max_depth /
 * max_fanout / task_brief_template` 全部不存在 —— coordinator 字段收进 `delegation`、
 * worker 字段收进 `catalog`。
 */
export interface AgentCoordination {
  agent_id: string;
  role: AgentRole;
  routing_enabled: boolean;
  delegation?: CoordinationDelegation | null;
  catalog?: CoordinationCatalog | null;
}

/** 保存 coordination 的响应：role 变更引发级联清理时回传受影响的 agent。 */
export interface CoordinationSaveResult {
  coordination: AgentCoordination;
  affected_agents: string[];
}

/**
 * Worker Catalog 单行（全局视图，深链到各自的 coordination 页）。
 *
 * <p>对齐 ai-platform `serialize_worker_catalog()`：wire 字段为
 * `{agent_id, display_name, when_to_use, capabilities, input_contract,
 * output_contract, security_level, enabled, timeout_seconds, degrade_message}`。
 * **无 `role`**（行内全是 worker）；安全等级是 `security_level` 而非 `safety_level`。
 */
export interface WorkerCatalogWorker {
  agent_id: string;
  display_name: string;
  when_to_use?: string;
  capabilities?: string[];
  input_contract?: string[];
  output_contract?: string;
  security_level: SecurityLevel;
  enabled: boolean;
  timeout_seconds?: number;
  degrade_message?: string;
}

/** Worker Catalog 聚合对象：`{workers, coordinators, fallback}`（**不是数组**）。 */
export interface WorkerCatalog {
  workers: WorkerCatalogWorker[];
  coordinators: string[];
  fallback: boolean;
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

// ------------------------------------------------------------------ 会话反馈（CF-01 / CF-03 / CF-05）

/** 反馈处理状态：pending → handled/ignored 单向终态。 */
export type AgentFeedbackStatus = 'pending' | 'handled' | 'ignored';

/** 反馈评价方向。 */
export type AgentFeedbackRating = 'up' | 'down';

/**
 * 会话反馈列表项。
 *
 * <p>wire 对齐 ai-platform `AgentFeedbackModel.to_wire()`（`agent_feedback` 表 +
 * 服务层按 message_id 补 `answer_brief` / 按 session_id 补 `agent_name`/`user_name`）。
 * `handler_*` 为运营标记处理人；`processed_at` 为处理时间。
 */
export interface AgentFeedbackItem {
  id: number;
  session_id: string;
  message_id: string;
  agent_id: string;
  agent_name?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  rating: AgentFeedbackRating;
  comment?: string | null;
  status: AgentFeedbackStatus;
  handler_id?: string | null;
  handler_name?: string | null;
  note?: string | null;
  processed_at?: string | null;
  created_at: string;
  updated_at: string;
  /** 被评价回答的截断摘要（≤60 字，由后端按 message_id 填充）。 */
  answer_brief?: string | null;
  /** 触发该回答的提问（被评价助手消息之前最近的用户消息，≤60 字截断）。 */
  query_text?: string | null;
  /** 对话编号：被评价助手消息在所属会话中的 1-based 顺序号（非会话编号）。 */
  turn_index?: number | null;
}

/** 会话反馈列表查询条件（字段名与 ai-platform `FeedbackQuery` 一致）。 */
export interface AgentFeedbackQuery extends AgentPageQuery {
  rating?: AgentFeedbackRating;
  /** 只看带说明的吐槽（comment 非空）。 */
  comment_only?: boolean;
  agent_id?: string;
  channel?: SessionChannel;
  from?: string;
  to?: string;
  /** 匹配吐槽说明。 */
  keyword?: string;
  status?: AgentFeedbackStatus;
}

/** 单 Agent 反馈统计（CF-05 by_agent 项）。 */
export interface AgentFeedbackAgentStat {
  total: number;
  up: number;
  down: number;
  /** 0–1 之间，total 为 0 时为 0。 */
  up_rate: number;
  down_rate: number;
}

/** 单日反馈趋势（CF-05 by_day 项，键为 `YYYY-MM-DD` UTC 日期）。 */
export interface AgentFeedbackDayStat {
  up: number;
  down: number;
  /** 带说明的吐槽数（comment 非空）。 */
  comment: number;
}

/**
 * 会话反馈统计（CF-05）。
 *
 * <p>**是一个聚合对象，不是数组**——与 `RouteStats` 同款教训：此前把统计声明成
 * 数组、页面直接 `[...stats]` 展开会 `stats is not iterable` 崩页。
 */
export interface AgentFeedbackStats {
  total: number;
  up: number;
  down: number;
  up_rate: number;
  down_rate: number;
  pending: number;
  by_agent: Record<string, AgentFeedbackAgentStat>;
  by_day: Record<string, AgentFeedbackDayStat>;
}

/** 标记处理请求体（单条 / 批量共用）。 */
export interface AgentFeedbackProcessPayload {
  status: 'handled' | 'ignored';
  note?: string;
}

/** 批量标记处理响应。 */
export interface AgentFeedbackBatchResult {
  /** 实际更新的行数（只更新 pending 行）。 */
  processed: number;
  /** 去重后的请求条数。 */
  requested: number;
}

// ------------------------------------------------------------------ MCP（UI#8）

/**
 * MCP Server（wire：配置八字段 + 运行时 `connected`）。
 *
 * <p>对齐 ai-platform `MCPServerConfig`：`{name, transport, endpoint, args, env,
 * timeout, auto_connect, description}`；列表/详情额外附带 `connected`（是否已在
 * 管理器中登记连接，与 #35 短连接探活结果独立）。
 */
export interface McpServer {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  endpoint: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  auto_connect: boolean;
  description?: string;
  /** 是否已在 ai-platform MCPManager 登记连接（点过「连接」且未断开）。 */
  connected?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema，形状由各 MCP Server 自定，前端只做只读展示。wire 上是 camelCase `inputSchema`。 */
  inputSchema?: Record<string, unknown>;
}

export interface McpCallPayload {
  /** ai-platform `CallToolRequest.tool_name`（不是 `tool`）。 */
  tool_name: string;
  arguments: Record<string, unknown>;
}

// ------------------------------------------------------------------ MCP 工具授权（方案 B′）

/**
 * MCP 工具授权行（BFF `GET /agent-ops/mcp/tools` 聚合产物）。
 *
 * <p>{@code skill_id} 由 BFF 按 {@code mcp-{server}-{tool}} 拼接（与 ai-platform
 * 运行时判别名逐字节一致），前端**只展示、不拼接、不反解**。{@code permission_code}
 * 恒为 {@code ai:skill:{skill_id}:run}，由后端回传，前端不自己拼。
 */
export interface McpToolPermission {
  /** 工具名（ai-platform live 清单原始名，可含点号如 `profile.query`）。 */
  name: string;
  description: string;
  /** 判别名 `mcp-{server}-{tool}`（保存授权时作为 skill_id 传给 BFF）。 */
  skill_id: string;
  permission_code: string;
  /** 是否已在 ai-platform 注册成 Skill；false 时不可授权（先发现再授权）。 */
  discovered: boolean;
  /** 已持有该执行码的角色 ID 列表。 */
  role_ids: number[];
}

/** 已下线 MCP 工具（曾 discover 但 live 清单已无，可清理）。 */
export interface McpOfflineSkill {
  skill_id: string;
  /** 展示用工具名（skill_id 去掉 `mcp-{server}-` 前缀后的剩余段）。 */
  tool: string;
  permission_code: string;
  /** 当前仍持有该码的角色 ID 列表（清理时会回收）。 */
  role_ids: number[];
}

/** 单个 MCP Server 的工具授权聚合视图。 */
export interface McpToolPermissions {
  server: string;
  tools: McpToolPermission[];
  offline_skills: McpOfflineSkill[];
}

/** 清理已下线工具的处置结果。 */
export interface McpOfflineCleanupResult {
  skill_id: string;
  /** sys_menu 行是否被删除（false = 该码从未建过菜单）。 */
  menu_removed: boolean;
  /** 被回收角色菜单关联的角色 ID 列表。 */
  roles_updated: number[];
}

// ------------------------------------------------------------------ 调度观测

/**
 * 单条委派轨迹。
 *
 * <p>对齐 ai-platform `DispatchTraceEntry` + `session_id`/`created_at`
 * （`coordinator/trace.py`）：`{intent, coordinator_id, worker_id, tool, status,
 * latency_ms, task_id, brief_rejected, session_id, created_at}`。
 * `coordinator_id` 为调度者（父会话 agent_id）；缺失时运营台显示 `-`。
 */
export interface DispatchTrace {
  intent: string;
  /** 发起委派的 Coordinator；旧缓冲条目可能为空。 */
  coordinator_id?: string;
  worker_id: string;
  tool: string;
  status: DispatchTraceStatus;
  latency_ms: number;
  task_id: string;
  /** 是否因 Brief 校验失败而未真正委派（此时 status 多为 rejected）。 */
  brief_rejected: boolean;
  session_id: string;
  created_at: string;
}

/** 委派轨迹状态：TaskStatus 终态（completed/failed/killed/timeout）+ brief 拒绝 + 进行中。 */
export type DispatchTraceStatus =
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'killed'
  | 'timeout'
  | 'running';

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
  /** agent_router=自动选 Agent；coordinator=协调者转执行者；specified=用户直接指定 Agent。 */
  dispatch_kind?: 'agent_router' | 'coordinator' | 'specified';
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
  by_kind: Record<string, number>;
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

/** 出站代理节点（#55 `proxy` 与 `llm.proxy_pool` 共用）。 */
export interface MonitorProxyNode {
  host: string;
  port: number;
  url: string;
  is_healthy: boolean;
  consecutive_failures: number;
  total_requests: number;
  last_check_at: string | null;
}

/** 单个 LLM Key 的统计（#55 `llm.providers[*].key_stats[]`）。 */
export interface MonitorLlmKeyStats {
  label: string;
  is_active: boolean;
  is_healthy: boolean;
  total_calls: number;
  error_count: number;
  error_rate: number;
  last_used_at: string | null;
}

/** 单个 LLM 提供方（#55 `llm.providers[*]`；键为提供方名，`name` 字段由前端从键取）。 */
export interface MonitorLlmProvider {
  name: string;
  healthy_keys: number;
  key_stats: MonitorLlmKeyStats[];
}

/**
 * 监控总览（#55 BFF 三路聚合 `{proxy, llm, admin}`）。
 *
 * <p>对齐 `AgentOpsFacadeService#monitorOverview`：`proxy` 来自
 * `GET /admin/proxy/status`（= `proxy_pool` 数组）、`llm` 来自
 * `GET /admin/llm/status`（= `llm_gateway.get_status()`）、`admin` 来自
 * `GET /admin/health`。T04 收口删除臆造的
 * `proxy_status / agents_running / agents_total / llm_providers / updated_at`。
 */
export interface MonitorOverview {
  proxy: MonitorProxyNode[];
  llm: {
    initialized: boolean;
    failover: {
      active_provider: string;
      is_failover_active: boolean;
      primary: string;
      fallback: string;
      failure_counts: Record<string, number>;
      last_failure_at: Record<string, string | null>;
    };
    proxy_pool: MonitorProxyNode[];
    /** 键为提供方名，值为 `{healthy_keys, key_stats}`。 */
    providers: Record<string, Omit<MonitorLlmProvider, 'name'>>;
  };
  admin: {
    llm_gateway: {
      initialized: boolean;
      active_provider: string;
      is_failover_active: boolean;
    };
    proxy_nodes: number;
    healthy_proxy_nodes: number;
  };
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

/** 反馈评价 → 中文标签（列表 / 详情 / 看板共用同一份口径）。 */
export function feedbackRatingLabel(
  rating: AgentFeedbackRating | null | undefined,
): string {
  return rating === 'up' ? '点赞' : rating === 'down' ? '吐槽' : '未评价';
}

/** 反馈处理状态 → 徽标规格（变体 + 文案）。 */
export const FEEDBACK_STATUS_META: Record<
  AgentFeedbackStatus,
  { label: string; variant: 'warning' | 'success' | 'secondary' }
> = {
  pending: { label: '待处理', variant: 'warning' },
  handled: { label: '已处理', variant: 'success' },
  ignored: { label: '已忽略', variant: 'secondary' },
};

/** 0–1 比率 → 百分比展示串（非法值显示 '-'）。 */
export function formatRate(rate: number | null | undefined): string {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return '-';
  return `${Math.round(rate * 100)}%`;
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
