/**
 * 智能体运营控制台 API 客户端。
 *
 * <p>一一对应 impl-plan §4.3 的 58 条 BFF 端点（前缀 `/agent-ops`，
 * `lib/api/client.ts` 已把 baseURL 设为 `/api/v1`，故这里不重复写 `/api/v1`）。
 * 每个函数上方的 `§4.3 #n` 即映射表行号，也对应 `V20__agent_ops_api_perms.sql`
 * 里 `sys_api` 的 sort 值，三方可逐条比对。
 *
 * <p>**为什么本文件自带 `unwrap` / `cleanParams`**：ESLint 规则 `arch/no-cross-feature`
 * 是 **error** 级，`features/agent` 不得 import `features/kb` / `features/ai`。
 * 这两个小工具与 `features/kb/api/kb-api.ts` 里的实现逐字相同，
 * 是**刻意的重复**（impl-plan §10.1 约定 1），不要"优化"成共享模块——
 * 抽到 `lib/` 会让两个 feature 产生隐式耦合，改一处炸两处。
 *
 * <p>T01 骨架阶段：函数签名与路径已按最终形态定稿，页面尚未接线。
 * 下游 ai-platform 未实现的端点会返回 501，前端按普通错误处理即可（不会白屏）。
 */
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';
import type {
  AgentCoordination,
  AgentDetail,
  AgentFeedbackBatchResult,
  AgentFeedbackItem,
  AgentFeedbackProcessPayload,
  AgentFeedbackQuery,
  AgentFeedbackStats,
  AgentHealth,
  AgentPage,
  AgentRoleOption,
  AgentSkillBinding,
  AgentSummary,
  Approval,
  ApprovalDecisionPayload,
  ConfigFileContent,
  ConfigFileNode,
  CoordinationSaveResult,
  DispatchTrace,
  McpCallPayload,
  McpOfflineCleanupResult,
  McpServer,
  McpTool,
  McpToolPermissions,
  MonitorOverview,
  RouteLog,
  RouteStats,
  SaveConfigFilePayload,
  SaveConfigFileResult,
  Session,
  SessionMessage,
  SessionQuery,
  Skill,
  SkillGrant,
  SkillParseResponseFE,
  SkillStats,
  WecomBot,
  WecomBotPayload,
  WorkerCatalog,
  WorkerCatalogWorker,
} from '../types';

/** 统一解包 BFF `ApiResult`：code!=0 抛错（message 透传）。 */
function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

/** 剔除值为 undefined / 空串的查询参数，避免 axios 拼出 `?from=&to=` 这类噪声。 */
function cleanParams(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

/**
 * 路径参数转义。
 *
 * <p>Skill id 形如 `member.points-account`，MCP server name 由用户自定，
 * 都可能含 `/` 或空格 —— 不转义会把路径拼歪（甚至越权命中别的端点）。
 */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * 配置文件相对路径 → URL 路径段（**逐段**编码）。
 *
 * <p>ai-platform 的读/写端点把文件路径放在路径段里（`/config-files/{file_path:path}`），
 * 后端收到后 `unquote` 还原。这里刻意**保留 `/` 作为分隔符**（只编码每段内容），
 * 让 BFF 的 `{file:.*}` 路由能捕获完整相对路径；若对整个 path 做 `encodeURIComponent`，
 * `/` 会变成 `%2F`，多数 Servlet 容器默认直接 400。
 */
function segPath(path: string): string {
  return path
    .split('/')
    .map(seg)
    .join('/');
}

// ------------------------------------------------------------------ 技能池（§4.3 #1–#9）

/**
 * §4.3 #1 — agent:skill:list。
 *
 * <p>**下游返回的是分页信封而不是裸数组**：ai-platform `api/routes/skill.py`
 * 的 `list_skills` 回的是 `SkillListResponse{items,total,page,page_size}`，
 * BFF 原样透传。此前这里直接把整个信封当 `Skill[]` 返回，
 * 页面 `setSkills(list)` 塞进数组 state 后 `.map()` 立刻炸。
 *
 * <p>仍然兼容裸数组：万一后端某天改回不分页，前端不至于再崩一次。
 */
export async function listSkills(): Promise<Skill[]> {
  const res = await api.get<ApiResult<AgentPage<Skill> | Skill[]>>('/agent-ops/skills');
  const payload = unwrap(res, '获取技能列表失败');
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.items) ? payload.items : [];
}

/** §4.3 #2 — agent:skill:list */
export async function getSkillStats(): Promise<SkillStats> {
  const res = await api.get<ApiResult<SkillStats>>('/agent-ops/skills/stats');
  return unwrap(res, '获取技能统计失败');
}

/** §4.3 #3 — agent:skill:list */
export async function getSkill(id: string): Promise<Skill> {
  const res = await api.get<ApiResult<Skill>>(`/agent-ops/skills/${seg(id)}`);
  return unwrap(res, '获取技能详情失败');
}

export interface SkillPayload {
  /** 新建时由表单指定的技能 ID；编辑时不下发。与 wire 的 `skill_id` 同名。 */
  skill_id?: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  /**
   * 执行器标识（可选）。空串或不传 = 文档型/检索型技能，仅用于语义检索与上下文注入；
   * 非空 = 可执行，格式 `mcp:{server}:{tool}` / `builtin:{name}` / `custom:{module}.{func}`。
   */
  handler?: string;
}

/** §4.3 #4 — agent:skill:manage */
export async function createSkill(payload: SkillPayload): Promise<Skill> {
  const res = await api.post<ApiResult<Skill>>('/agent-ops/skills', payload);
  return unwrap(res, '创建技能失败');
}

/** §4.3 #5 — agent:skill:manage */
export async function updateSkill(id: string, payload: SkillPayload): Promise<Skill> {
  const res = await api.put<ApiResult<Skill>>(`/agent-ops/skills/${seg(id)}`, payload);
  return unwrap(res, '更新技能失败');
}

/** §4.3 #6 — agent:skill:manage */
export async function deleteSkill(id: string): Promise<void> {
  const res = await api.delete<ApiResult<void>>(`/agent-ops/skills/${seg(id)}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除技能失败');
}

/** §4.3 #7 — agent:skill:manage */
export async function enableSkill(id: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/skills/${seg(id)}/enable`);
  if (res.data.code !== 0) throw new Error(res.data.message || '启用技能失败');
}

/** §4.3 #8 — agent:skill:manage */
export async function disableSkill(id: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/skills/${seg(id)}/disable`);
  if (res.data.code !== 0) throw new Error(res.data.message || '停用技能失败');
}

/** §4.3 #9 — agent:skill:reindex */
export async function reindexSkills(): Promise<void> {
  const res = await api.post<ApiResult<void>>('/agent-ops/skills/reindex');
  if (res.data.code !== 0) throw new Error(res.data.message || '重建技能索引失败');
}

/**
 * 解析 SKILL.md（§4.3 #10，新增端点）。
 *
 * <p>后端 `POST /skills/parse` 仅做预览、不持久化：返回 `{metadata, body}`。
 * YAML 语法错误时后端回 code=400 + message「SKILL.md Front Matter 解析失败：…」，
 * 由 `unwrap` 抛出、调用方以 toast 展示。
 */
export async function parseSkill(content: string): Promise<SkillParseResponseFE> {
  const res = await api.post<ApiResult<SkillParseResponseFE>>('/agent-ops/skills/parse', {
    content,
  });
  return unwrap(res, '解析 SKILL.md 失败');
}

// ------------------------------------------------------------------ 技能权限（§4.3 #10–#12）

/** §4.3 #10 — agent:skill:grant */
export async function getSkillGrants(id: string): Promise<SkillGrant> {
  const res = await api.get<ApiResult<SkillGrant>>(`/agent-ops/skills/${seg(id)}/grants`);
  return unwrap(res, '获取技能授权失败');
}

/** §4.3 #11 — agent:skill:grant */
export async function saveSkillGrants(id: string, payload: SkillGrant): Promise<SkillGrant> {
  const res = await api.put<ApiResult<SkillGrant>>(`/agent-ops/skills/${seg(id)}/grants`, payload);
  return unwrap(res, '保存技能授权失败');
}

/** §4.3 #12 — agent:skill:grant。appCode 用于筛选目标 App 下的角色（UI#2）。 */
export async function listGrantableRoles(appCode?: string): Promise<AgentRoleOption[]> {
  const res = await api.get<ApiResult<AgentRoleOption[]>>('/agent-ops/roles', {
    params: cleanParams({ appCode }),
  });
  return unwrap(res, '获取角色列表失败');
}

// ------------------------------------------------------------------ Agent（§4.3 #13–#19）

/** §4.3 #13 — agent:agent:list */
export async function listAgents(): Promise<AgentSummary[]> {
  const res = await api.get<ApiResult<AgentSummary[]>>('/agent-ops/agents');
  return unwrap(res, '获取 Agent 列表失败');
}

/** §4.3 #14 — agent:agent:list */
export async function getAgent(id: string): Promise<AgentDetail> {
  const res = await api.get<ApiResult<AgentDetail>>(`/agent-ops/agents/${seg(id)}`);
  return unwrap(res, '获取 Agent 详情失败');
}

/** §4.3 #15 — agent:agent:manage */
export async function startAgent(id: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/agents/${seg(id)}/start`);
  if (res.data.code !== 0) throw new Error(res.data.message || '启动 Agent 失败');
}

/** §4.3 #16 — agent:agent:manage */
export async function pauseAgent(id: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/agents/${seg(id)}/pause`);
  if (res.data.code !== 0) throw new Error(res.data.message || '暂停 Agent 失败');
}

/** §4.3 #17 — agent:agent:manage */
export async function resumeAgent(id: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/agents/${seg(id)}/resume`);
  if (res.data.code !== 0) throw new Error(res.data.message || '恢复 Agent 失败');
}

/** §4.3 #18 — agent:agent:manage */
export async function stopAgent(id: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/agents/${seg(id)}/stop`);
  if (res.data.code !== 0) throw new Error(res.data.message || '停止 Agent 失败');
}

/** §4.3 #19 — agent:agent:list */
export async function getAgentHealth(id: string): Promise<AgentHealth> {
  const res = await api.get<ApiResult<AgentHealth>>(`/agent-ops/agents/${seg(id)}/health`);
  return unwrap(res, '获取 Agent 健康状态失败');
}

// ------------------------------------------------------------------ Agent 技能绑定（§4.3 #20–#21）

/**
 * #20 — agent:agent:skills。
 *
 * <p>**下游返回的是对象而不是数组**：ai-platform `GET /agents/{id}/skills` 回的是
 * `{agent_id, enabled_skill_ids, pool[]}`。这里把 `enabled_skill_ids` 摊平成
 * `AgentSkillBinding[]`（`{skill_id, enabled: true}`），页面零改动即可继续消费。
 */
export async function getAgentSkills(id: string): Promise<AgentSkillBinding[]> {
  const res = await api.get<ApiResult<{ agent_id: string; enabled_skill_ids?: string[] }>>(
    `/agent-ops/agents/${seg(id)}/skills`,
  );
  const wire = unwrap(res, '获取 Agent 技能绑定失败');
  const ids = Array.isArray(wire.enabled_skill_ids) ? wire.enabled_skill_ids : [];
  return ids.map((skill_id) => ({ skill_id, enabled: true }));
}

/**
 * #21 — agent:agent:skills:save。
 *
 * <p>下游 `PUT /agents/{id}/skills` 只收 `{skill_ids: string[]}`（启用集合），
 * 没有「已绑定但停用」的概念。这里把 `bindings` 压缩成启用 id 列表，
 * 页面零改动即可继续提交。
 */
export async function saveAgentSkills(
  id: string,
  bindings: AgentSkillBinding[],
): Promise<AgentSkillBinding[]> {
  const skillIds = bindings.filter((b) => b.enabled).map((b) => b.skill_id);
  const res = await api.put<ApiResult<{ agent_id: string; enabled_skill_ids?: string[] }>>(
    `/agent-ops/agents/${seg(id)}/skills`,
    { skill_ids: skillIds },
  );
  const wire = unwrap(res, '保存 Agent 技能绑定失败');
  const ids = Array.isArray(wire.enabled_skill_ids) ? wire.enabled_skill_ids : [];
  return ids.map((skill_id) => ({ skill_id, enabled: true }));
}

// ------------------------------------------------------------------ 配置文件（§4.3 #22–#24）

/** §4.3 #22 — agent:agent:config */
export async function listConfigFiles(id: string): Promise<ConfigFileNode[]> {
  const res = await api.get<ApiResult<ConfigFileNode[]>>(
    `/agent-ops/agents/${seg(id)}/config-files`,
  );
  return unwrap(res, '获取配置文件列表失败');
}

/**
 * §4.3 #23 — agent:agent:config。
 *
 * <p>真实 wire 是**路径段**（`/config-files/{file_path:path}`），不是
 * `/config-files/content?path=` 的 query 形式。BFF 已把 `content` 段收口为
 * `{file}` 模板变量（见 AgentOpsClient#configFileContent），这里逐段编码 path。
 */
export async function getConfigFileContent(id: string, path: string): Promise<ConfigFileContent> {
  const res = await api.get<ApiResult<ConfigFileContent>>(
    `/agent-ops/agents/${seg(id)}/config-files/${segPath(path)}`,
  );
  return unwrap(res, '读取配置文件失败');
}

/**
 * §4.3 #24 — agent:agent:config:write。
 *
 * <p>path 走 URL 路径段；body **只发 `{content}`**（后端无 sha256 并发保护）。
 * 响应是 `{path, masked, reloaded}`，不是完整 content —— 调用方保存后应重新拉取内容。
 */
export async function saveConfigFileContent(
  id: string,
  path: string,
  payload: SaveConfigFilePayload,
): Promise<SaveConfigFileResult> {
  const res = await api.put<ApiResult<SaveConfigFileResult>>(
    `/agent-ops/agents/${seg(id)}/config-files/${segPath(path)}`,
    { content: payload.content },
  );
  return unwrap(res, '保存配置文件失败');
}

// ------------------------------------------------------------------ 调度配置（§4.3 #25–#26）

/** §4.3 #25 — agent:agent:coordination */
export async function getCoordination(id: string): Promise<AgentCoordination> {
  const res = await api.get<ApiResult<AgentCoordination>>(
    `/agent-ops/agents/${seg(id)}/coordination`,
  );
  return unwrap(res, '获取调度配置失败');
}

/** §4.3 #26 — agent:agent:coordination:save */
export async function saveCoordination(
  id: string,
  payload: AgentCoordination,
): Promise<CoordinationSaveResult> {
  const res = await api.put<ApiResult<CoordinationSaveResult>>(
    `/agent-ops/agents/${seg(id)}/coordination`,
    payload,
  );
  return unwrap(res, '保存调度配置失败');
}

// ------------------------------------------------------------------ 会话（§4.3 #27–#31）

/** §4.3 #27 — agent:session:list */
export async function listSessions(query: SessionQuery = {}): Promise<AgentPage<Session>> {
  const res = await api.get<ApiResult<AgentPage<Session>>>('/agent-ops/sessions', {
    params: cleanParams({ ...query }),
  });
  return unwrap(res, '获取会话列表失败');
}

/** §4.3 #28 — agent:session:list */
export async function getSession(id: string): Promise<Session> {
  const res = await api.get<ApiResult<Session>>(`/agent-ops/sessions/${seg(id)}`);
  return unwrap(res, '获取会话详情失败');
}

/** §4.3 #29 — agent:session:list */
export async function listSessionMessages(id: string): Promise<SessionMessage[]> {
  const res = await api.get<ApiResult<SessionMessage[]>>(`/agent-ops/sessions/${seg(id)}/messages`);
  return unwrap(res, '获取会话消息失败');
}

/** §4.3 #30 — agent:session:delete */
export async function deleteSession(id: string): Promise<void> {
  const res = await api.delete<ApiResult<void>>(`/agent-ops/sessions/${seg(id)}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除会话失败');
}

/** §4.3 #31 — agent:session:delete */
export async function batchDeleteSessions(ids: string[]): Promise<void> {
  const res = await api.post<ApiResult<void>>('/agent-ops/sessions/batch-delete', { ids });
  if (res.data.code !== 0) throw new Error(res.data.message || '批量删除会话失败');
}

// ------------------------------------------------------------------ 会话反馈（CF-01 / CF-03 / CF-05）

/**
 * CF-01 — 会话反馈列表（分页 + rating/comment_only/agent_id/channel/from/to/keyword/status 过滤）。
 *
 * <p>**下游返回的是分页信封**（ai-platform `FeedbackPage.to_wire()`），不是裸数组——
 * 页面必须取 `result.items`，不要直接把信封当数组 `.map()`。
 * 默认排序「吐槽且带说明优先」由下游实现，本函数不排序。
 */
export async function listAgentFeedback(
  query: AgentFeedbackQuery = {},
): Promise<AgentPage<AgentFeedbackItem>> {
  const res = await api.get<ApiResult<AgentPage<AgentFeedbackItem>>>(
    '/agent-ops/sessions/feedback',
    { params: cleanParams({ ...query }) },
  );
  return unwrap(res, '获取会话反馈列表失败');
}

/**
 * CF-05 — 会话反馈统计。
 *
 * <p>**返回聚合对象，不是数组**——`{total, up, down, up_rate, down_rate, pending,
 * by_agent, by_day}`。这里把缺省值补齐后再返回，调用方无需再写 `?? {}`。
 */
export async function getAgentFeedbackStats(
  query: Pick<AgentFeedbackQuery, 'agent_id' | 'channel' | 'from' | 'to'> = {},
): Promise<AgentFeedbackStats> {
  const res = await api.get<ApiResult<Partial<AgentFeedbackStats>>>(
    '/agent-ops/sessions/feedback/stats',
    { params: cleanParams({ ...query }) },
  );
  const raw = unwrap(res, '获取会话反馈统计失败');
  return {
    total: raw.total ?? 0,
    up: raw.up ?? 0,
    down: raw.down ?? 0,
    up_rate: raw.up_rate ?? 0,
    down_rate: raw.down_rate ?? 0,
    pending: raw.pending ?? 0,
    by_agent: raw.by_agent ?? {},
    by_day: raw.by_day ?? {},
  };
}

/** CF-03 — 单条标记处理（pending → handled/ignored，单向终态）。 */
export async function processAgentFeedback(
  id: number,
  payload: AgentFeedbackProcessPayload,
): Promise<AgentFeedbackItem> {
  const res = await api.post<ApiResult<AgentFeedbackItem>>(
    `/agent-ops/sessions/feedback/${id}/process`,
    payload,
  );
  return unwrap(res, '标记反馈失败');
}

/** CF-03 — 批量标记处理（只更新 status=pending 的行，单次上限 200）。 */
export async function batchProcessAgentFeedback(
  ids: number[],
  payload: AgentFeedbackProcessPayload,
): Promise<AgentFeedbackBatchResult> {
  const res = await api.post<ApiResult<AgentFeedbackBatchResult>>(
    '/agent-ops/sessions/feedback/batch-process',
    { ids, ...payload },
  );
  return unwrap(res, '批量标记反馈失败');
}

// ------------------------------------------------------------------ 本地对话（§4.3 #32–#33）
// 实现已迁至 agent-chat-api.ts（独立 180s 超时客户端）；此处再导出保持旧 import 兼容。

export { createChatSession, sendChatMessage } from './agent-chat-api';

// ------------------------------------------------------------------ MCP（§4.3 #34–#42）

/** §4.3 #34 — agent:mcp:list */
export async function listMcpServers(): Promise<McpServer[]> {
  const res = await api.get<ApiResult<McpServer[]>>('/agent-ops/mcp/servers');
  return unwrap(res, '获取 MCP 服务器列表失败');
}

/** §4.3 #35 — agent:mcp:list */
export async function getMcpServersHealth(): Promise<Record<string, boolean>> {
  const res = await api.get<ApiResult<Record<string, boolean>>>('/agent-ops/mcp/servers/health');
  return unwrap(res, '获取 MCP 健康状态失败');
}

/** §4.3 #36 — agent:mcp:list */
export async function getMcpServer(name: string): Promise<McpServer> {
  const res = await api.get<ApiResult<McpServer>>(`/agent-ops/mcp/servers/${seg(name)}`);
  return unwrap(res, '获取 MCP 服务器详情失败');
}

/** §4.3 #37 — agent:mcp:list */
export async function listMcpTools(name: string): Promise<McpTool[]> {
  const res = await api.get<ApiResult<McpTool[]>>(`/agent-ops/mcp/servers/${seg(name)}/tools`);
  return unwrap(res, '获取 MCP 工具列表失败');
}

export interface McpServerPayload {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  /** ai-platform `RegisterServerRequest.endpoint: str` 必填（stdio 也必填）。 */
  endpoint: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  auto_connect?: boolean;
  description?: string;
}

/** §4.3 #38 — agent:mcp:manage */
export async function createMcpServer(payload: McpServerPayload): Promise<McpServer> {
  const res = await api.post<ApiResult<McpServer>>('/agent-ops/mcp/servers', payload);
  return unwrap(res, '新增 MCP 服务器失败');
}

/** §4.3 #39 — agent:mcp:manage */
export async function connectMcpServer(name: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/mcp/servers/${seg(name)}/connect`);
  if (res.data.code !== 0) throw new Error(res.data.message || '连接 MCP 服务器失败');
}

/** §4.3 #40 — agent:mcp:manage */
export async function disconnectMcpServer(name: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(`/agent-ops/mcp/servers/${seg(name)}/disconnect`);
  if (res.data.code !== 0) throw new Error(res.data.message || '断开 MCP 服务器失败');
}

export interface McpDiscoverResult {
  /** 本次注册/刷新的工具数。 */
  discovered: number;
  skill_ids: string[];
}

/** §4.3 #41 — agent:mcp:manage */
export async function discoverMcpTools(name: string): Promise<McpDiscoverResult> {
  const res = await api.post<ApiResult<McpDiscoverResult | McpTool[]>>(
    `/agent-ops/mcp/servers/${seg(name)}/discover`,
  );
  const wire = unwrap(res, '发现 MCP 工具失败');
  // ai-platform POST /mcp/{name}/discover 回的是 `{discovered, skill_ids}`，
  // 不是工具数组（数组在 GET .../tools）。兼容两种形状，避免 toast 出现 undefined。
  if (Array.isArray(wire)) {
    return { discovered: wire.length, skill_ids: wire.map((t) => t.name) };
  }
  const ids = Array.isArray(wire.skill_ids) ? wire.skill_ids : [];
  const count = typeof wire.discovered === 'number' ? wire.discovered : ids.length;
  return { discovered: count, skill_ids: ids };
}

/**
 * §4.3 #42 — agent:mcp:call ⚠️ **高危**。
 *
 * <p>可直接执行任意 MCP 工具，等同于把下游系统的写能力交给调用者。
 * 调用点必须包在 `PermissionGate` + 二次确认弹窗内，不得做成一键按钮。
 */
export async function callMcpTool(name: string, payload: McpCallPayload): Promise<unknown> {
  const res = await api.post<ApiResult<unknown>>(`/agent-ops/mcp/servers/${seg(name)}/call`, payload);
  return unwrap(res, '调用 MCP 工具失败');
}

// ------------------------------------------------------------------ MCP 工具授权（方案 B′）

/**
 * BFF 聚合端点：单个 MCP Server 的工具授权视图。
 *
 * <p>三路数据（ai-platform live 工具 × MCP Skill 集合 × IAM 角色翻转）在 BFF 拼好，
 * 前端一次请求拿齐 {@code {server, tools[], offline_skills[]}}。页面不并发打三个接口。
 */
export async function listMcpToolPermissions(server: string): Promise<McpToolPermissions> {
  const res = await api.get<ApiResult<McpToolPermissions>>('/agent-ops/mcp/tools', {
    params: cleanParams({ server }),
  });
  return unwrap(res, '获取 MCP 工具授权失败');
}

/**
 * 清理已下线 MCP 工具（破坏性，调用点必须二次确认）。
 *
 * <p>BFF 三步处置：ai-platform 注销 Skill → 删 sys_menu → 回收 sys_role_menu。
 * 返回 `{skill_id, menu_removed, roles_updated}`。
 */
export async function cleanupOfflineMcpSkill(skillId: string): Promise<McpOfflineCleanupResult> {
  const res = await api.post<ApiResult<McpOfflineCleanupResult>>(
    '/agent-ops/mcp/tools/cleanup-offline',
    { skill_id: skillId },
  );
  return unwrap(res, '清理下线工具失败');
}

// ------------------------------------------------------------------ Worker Catalog（§4.3 #43–#44）

/**
 * §4.3 #43 — agent:catalog:list。
 *
 * <p>**下游返回聚合对象而不是数组**：ai-platform `GET /admin/worker-catalog` 回的是
 * `{workers[], coordinators[], fallback}`。此前声明成数组、页面直接
 * `entries.filter` 会 `entries.filter is not a function` 崩页。
 */
export async function getWorkerCatalog(): Promise<WorkerCatalog> {
  const res = await api.get<ApiResult<WorkerCatalog>>('/agent-ops/catalog');
  return unwrap(res, '获取 Worker Catalog 失败');
}

/**
 * §4.3 #44 — agent:catalog:manage。
 *
 * <p>下游 `PUT /admin/worker-catalog` 只收 `{updates: [{agent_id, enabled?, when_to_use?}]}`，
 * 不再接受整表 `{entries}`。本页定位为只读总览，此函数对齐 wire 供后续编辑能力使用。
 */
export async function saveWorkerCatalog(
  updates: Array<Partial<Pick<WorkerCatalogWorker, 'enabled' | 'when_to_use'>> & { agent_id: string }>,
): Promise<WorkerCatalogWorker[]> {
  const res = await api.put<ApiResult<{ updated?: WorkerCatalogWorker[] }>>('/agent-ops/catalog', {
    updates,
  });
  const wire = unwrap(res, '保存 Worker Catalog 失败');
  return wire.updated ?? [];
}

// ------------------------------------------------------------------ 调度观测（§4.3 #45–#47）

/** 路由日志 / 统计共用查询条件（#46/#47）。 */
export interface DispatchQuery {
  from?: string;
  to?: string;
  coordinator_id?: string;
  /** agent_router | coordinator；不传=全部。 */
  kind?: string;
}

/**
 * §4.3 #45 — agent:dispatch:list。
 *
 * <p>**下游返回 `{traces, total}` 信封**（ai-platform `query_dispatch_traces`），
 * 且只支持 `session_id / worker_id / intent / limit / offset` 过滤 ——
 * `from/to/coordinator_id/status` 均不支持，故这里只透传 `limit`，并剥掉信封返回 `traces`。
 */
export async function listDispatchTraces(limit = 100): Promise<DispatchTrace[]> {
  const res = await api.get<ApiResult<{ traces?: DispatchTrace[]; total?: number }>>(
    '/agent-ops/dispatch/traces',
    { params: cleanParams({ limit }) },
  );
  const wire = unwrap(res, '获取调度链路失败');
  return Array.isArray(wire.traces) ? wire.traces : [];
}

/** §4.3 #46 — agent:dispatch:list */
export async function listRouteLogs(query: DispatchQuery = {}): Promise<RouteLog[]> {
  const res = await api.get<ApiResult<RouteLog[]>>('/agent-ops/dispatch/route-logs', {
    params: cleanParams({ ...query }),
  });
  return unwrap(res, '获取路由日志失败');
}

/**
 * §4.3 #47 — agent:dispatch:list。
 *
 * <p>**返回聚合对象，不是数组**：ai-platform `admin.py#get_route_stats` 回的是
 * `stats.model_dump()`（`RouteStats`，见 `src/router/models.py`）。
 * 此前这里声明成 `RouteStat[]`，页面对着一个普通对象做 `[...stats]` 展开，
 * 直接 `stats is not iterable` 崩页。
 *
 * <p>这里把缺省值补齐后再返回，保证调用方拿到的 `by_agent` / `by_strategy`
 * 一定是可枚举对象 —— 消费点无需再写一遍 `?? {}`。
 */
export async function listRouteStats(query: DispatchQuery = {}): Promise<RouteStats> {
  const res = await api.get<ApiResult<Partial<RouteStats>>>('/agent-ops/dispatch/route-stats', {
    params: cleanParams({ ...query }),
  });
  const raw = unwrap(res, '获取路由统计失败');
  return {
    total_routes: raw.total_routes ?? 0,
    by_agent: raw.by_agent ?? {},
    by_strategy: raw.by_strategy ?? {},
    by_kind: raw.by_kind ?? {},
    avg_latency_ms: raw.avg_latency_ms ?? 0,
    avg_confidence: raw.avg_confidence ?? 0,
  };
}

// ------------------------------------------------------------------ 企微机器人（§4.3 #48–#54）

/** §4.3 #48 — agent:wecom:list */
export async function listWecomBots(): Promise<WecomBot[]> {
  const res = await api.get<ApiResult<WecomBot[]>>('/agent-ops/channels/wecom/bots');
  return unwrap(res, '获取企微机器人列表失败');
}

/** §4.3 #49 — agent:wecom:manage */
export async function createWecomBot(payload: WecomBotPayload): Promise<WecomBot> {
  const res = await api.post<ApiResult<WecomBot>>('/agent-ops/channels/wecom/bots', payload);
  return unwrap(res, '新增企微机器人失败');
}

/** §4.3 #50 — agent:wecom:manage。secret 留空表示不修改。 */
export async function updateWecomBot(botId: string, payload: WecomBotPayload): Promise<WecomBot> {
  const res = await api.put<ApiResult<WecomBot>>(
    `/agent-ops/channels/wecom/bots/${seg(botId)}`,
    payload,
  );
  return unwrap(res, '更新企微机器人失败');
}

/** §4.3 #51 — agent:wecom:manage */
export async function deleteWecomBot(botId: string): Promise<void> {
  const res = await api.delete<ApiResult<void>>(`/agent-ops/channels/wecom/bots/${seg(botId)}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除企微机器人失败');
}

/** §4.3 #52 — agent:wecom:manage */
export async function enableWecomBot(botId: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(
    `/agent-ops/channels/wecom/bots/${seg(botId)}/enable`,
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '启用企微机器人失败');
}

/** §4.3 #53 — agent:wecom:manage */
export async function disableWecomBot(botId: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(
    `/agent-ops/channels/wecom/bots/${seg(botId)}/disable`,
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '停用企微机器人失败');
}

/** §4.3 #54 — agent:wecom:list */
export async function getWecomBotsHealth(): Promise<Record<string, WecomBot['health']>> {
  const res = await api.get<ApiResult<Record<string, WecomBot['health']>>>(
    '/agent-ops/channels/wecom/bots/health',
  );
  return unwrap(res, '获取企微机器人健康状态失败');
}

// ------------------------------------------------------------------ 监控 / 审批（§4.3 #55–#58）

/** §4.3 #55 — agent:monitor:view */
export async function getMonitorOverview(): Promise<MonitorOverview> {
  const res = await api.get<ApiResult<MonitorOverview>>('/agent-ops/monitor/overview');
  return unwrap(res, '获取监控总览失败');
}

/** §4.3 #56 — agent:monitor:operate */
export async function resetFailover(provider?: string): Promise<void> {
  const res = await api.post<ApiResult<void>>(
    '/agent-ops/monitor/failover/reset',
    cleanParams({ provider }),
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '重置 failover 失败');
}

/** §4.3 #57 — agent:approval:list */
export async function listApprovals(status?: Approval['status']): Promise<Approval[]> {
  const res = await api.get<ApiResult<Approval[]>>('/agent-ops/approvals', {
    params: cleanParams({ status }),
  });
  return unwrap(res, '获取审批列表失败');
}

/** §4.3 #58 — agent:approval:handle */
export async function decideApproval(
  id: string,
  payload: ApprovalDecisionPayload,
): Promise<Approval> {
  const res = await api.post<ApiResult<Approval>>(
    `/agent-ops/approvals/${seg(id)}/decision`,
    payload,
  );
  return unwrap(res, '提交审批决策失败');
}
