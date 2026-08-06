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
  AgentDetail,
  AgentHealth,
  AgentPage,
  AgentRoleOption,
  AgentSkillBinding,
  AgentSummary,
  Approval,
  ApprovalDecisionPayload,
  ConfigFileContent,
  ConfigFileNode,
  Coordination,
  CoordinationSaveResult,
  DispatchTrace,
  McpCallPayload,
  McpServer,
  McpTool,
  MonitorOverview,
  RouteLog,
  RouteStat,
  SaveConfigFilePayload,
  Session,
  SessionMessage,
  SessionQuery,
  Skill,
  SkillGrant,
  SkillStats,
  WecomBot,
  WecomBotPayload,
  WorkerCatalogEntry,
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

// ------------------------------------------------------------------ 技能池（§4.3 #1–#9）

/** §4.3 #1 — agent:skill:list */
export async function listSkills(): Promise<Skill[]> {
  const res = await api.get<ApiResult<Skill[]>>('/agent-ops/skills');
  return unwrap(res, '获取技能列表失败');
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
  id?: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
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

/** §4.3 #20 — agent:agent:skills */
export async function getAgentSkills(id: string): Promise<AgentSkillBinding[]> {
  const res = await api.get<ApiResult<AgentSkillBinding[]>>(`/agent-ops/agents/${seg(id)}/skills`);
  return unwrap(res, '获取 Agent 技能绑定失败');
}

/** §4.3 #21 — agent:agent:skills:save */
export async function saveAgentSkills(
  id: string,
  bindings: AgentSkillBinding[],
): Promise<AgentSkillBinding[]> {
  const res = await api.put<ApiResult<AgentSkillBinding[]>>(
    `/agent-ops/agents/${seg(id)}/skills`,
    { bindings },
  );
  return unwrap(res, '保存 Agent 技能绑定失败');
}

// ------------------------------------------------------------------ 配置文件（§4.3 #22–#24）

/** §4.3 #22 — agent:agent:config */
export async function listConfigFiles(id: string): Promise<ConfigFileNode[]> {
  const res = await api.get<ApiResult<ConfigFileNode[]>>(
    `/agent-ops/agents/${seg(id)}/config-files`,
  );
  return unwrap(res, '获取配置文件列表失败');
}

/** §4.3 #23 — agent:agent:config */
export async function getConfigFileContent(id: string, path: string): Promise<ConfigFileContent> {
  const res = await api.get<ApiResult<ConfigFileContent>>(
    `/agent-ops/agents/${seg(id)}/config-files/content`,
    { params: cleanParams({ path }) },
  );
  return unwrap(res, '读取配置文件失败');
}

/** §4.3 #24 — agent:agent:config:write。base_sha256 不符时后端返回 409 CONFIG_CONFLICT。 */
export async function saveConfigFileContent(
  id: string,
  payload: SaveConfigFilePayload,
): Promise<ConfigFileContent> {
  const res = await api.put<ApiResult<ConfigFileContent>>(
    `/agent-ops/agents/${seg(id)}/config-files/content`,
    payload,
  );
  return unwrap(res, '保存配置文件失败');
}

// ------------------------------------------------------------------ 调度配置（§4.3 #25–#26）

/** §4.3 #25 — agent:agent:coordination */
export async function getCoordination(id: string): Promise<Coordination> {
  const res = await api.get<ApiResult<Coordination>>(`/agent-ops/agents/${seg(id)}/coordination`);
  return unwrap(res, '获取调度配置失败');
}

/** §4.3 #26 — agent:agent:coordination:save */
export async function saveCoordination(
  id: string,
  payload: Coordination,
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

// ------------------------------------------------------------------ 本地对话（§4.3 #32–#33）

/** §4.3 #32 — agent:chat:use */
export async function createChatSession(agentId: string): Promise<Session> {
  const res = await api.post<ApiResult<Session>>('/agent-ops/chat/sessions', {
    agent_id: agentId,
  });
  return unwrap(res, '创建对话会话失败');
}

/** §4.3 #33 — agent:chat:use */
export async function sendChatMessage(
  sessionId: string,
  content: string,
): Promise<SessionMessage> {
  const res = await api.post<ApiResult<SessionMessage>>(
    `/agent-ops/chat/sessions/${seg(sessionId)}/messages`,
    { content },
  );
  return unwrap(res, '发送消息失败');
}

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
  endpoint?: string;
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

/** §4.3 #41 — agent:mcp:manage */
export async function discoverMcpTools(name: string): Promise<McpTool[]> {
  const res = await api.post<ApiResult<McpTool[]>>(`/agent-ops/mcp/servers/${seg(name)}/discover`);
  return unwrap(res, '发现 MCP 工具失败');
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

// ------------------------------------------------------------------ Worker Catalog（§4.3 #43–#44）

/** §4.3 #43 — agent:catalog:list */
export async function getWorkerCatalog(): Promise<WorkerCatalogEntry[]> {
  const res = await api.get<ApiResult<WorkerCatalogEntry[]>>('/agent-ops/catalog');
  return unwrap(res, '获取 Worker Catalog 失败');
}

/** §4.3 #44 — agent:catalog:manage */
export async function saveWorkerCatalog(
  entries: WorkerCatalogEntry[],
): Promise<WorkerCatalogEntry[]> {
  const res = await api.put<ApiResult<WorkerCatalogEntry[]>>('/agent-ops/catalog', { entries });
  return unwrap(res, '保存 Worker Catalog 失败');
}

// ------------------------------------------------------------------ 调度观测（§4.3 #45–#47）

export interface DispatchQuery {
  from?: string;
  to?: string;
  coordinator_id?: string;
  status?: DispatchTrace['status'];
}

/** §4.3 #45 — agent:dispatch:list */
export async function listDispatchTraces(query: DispatchQuery = {}): Promise<DispatchTrace[]> {
  const res = await api.get<ApiResult<DispatchTrace[]>>('/agent-ops/dispatch/traces', {
    params: cleanParams({ ...query }),
  });
  return unwrap(res, '获取调度链路失败');
}

/** §4.3 #46 — agent:dispatch:list */
export async function listRouteLogs(query: DispatchQuery = {}): Promise<RouteLog[]> {
  const res = await api.get<ApiResult<RouteLog[]>>('/agent-ops/dispatch/route-logs', {
    params: cleanParams({ ...query }),
  });
  return unwrap(res, '获取路由日志失败');
}

/** §4.3 #47 — agent:dispatch:list */
export async function listRouteStats(query: DispatchQuery = {}): Promise<RouteStat[]> {
  const res = await api.get<ApiResult<RouteStat[]>>('/agent-ops/dispatch/route-stats', {
    params: cleanParams({ ...query }),
  });
  return unwrap(res, '获取路由统计失败');
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
