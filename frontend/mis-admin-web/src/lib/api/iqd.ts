/**
 * iqd.ts — 问数（mis-iqd）管理面 API 客户端（W2）。
 *
 * <p>wire 一律 snake_case（与 BFF IqdFacadeService / mis-iqd DTO 对齐）。
 * 管理面端点集中在 BFF `/api/v1/iqd/**`（需 iqd:* 权限码）；
 * 问数端点 `/api/v1/iqd/ask` / `ask-stream` 需 ai:chat:use。
 */

import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

// ================================================================ DTO

export interface IqdConnectionConfig {
  id?: number | null;
  name: string;
  base_url?: string | null;
  auth_type?: string;
  secret_ref?: string | null;
  project_id?: string | null;
  default_connector?: string | null;
  timeout_seconds?: number;
  language?: string;
  status?: string;
  last_health_at?: string | null;
  last_health_msg?: string | null;
  enabled?: boolean;
  /** 按连接灰度闸门：是否允许平台写回 MDL（二期 P0-1~P0-12，U7/Q4）。 */
  mdl_writeback_enabled?: boolean;
}

export interface IqdConnectionSavePayload {
  name: string;
  base_url?: string | null;
  auth_type?: string;
  secret_ref?: string | null;
  project_id?: string | null;
  default_connector?: string | null;
  timeout_seconds?: number;
  language?: string;
  enabled?: boolean;
  /** 同步保存：是否允许平台写回 MDL（U7/Q4）。 */
  mdl_writeback_enabled?: boolean;
}

export interface IqdConnectionTest {
  status: string;
  message?: string;
  latency_ms?: number;
  last_health_at?: string | null;
}

export interface IqdCatalogItem {
  id?: number;
  connection_id?: number;
  kind: string;
  parent_key?: string | null;
  item_key: string;
  display_name?: string | null;
  data_type?: string | null;
  is_primary_key?: boolean;
  is_time_dimension?: boolean;
  is_email?: boolean;
  description?: string | null;
  expression?: string | null;
  source?: string;
  in_scope?: boolean;
  sensitive_level?: string;
  mask_rule?: string | null;
  /** 平台是否可编辑此 catalog 项（二期：editable && 连接 mdl_writeback_enabled 方可编辑）。 */
  editable?: boolean;
}

export interface IqdCatalogItemSavePayload {
  kind: string;
  parent_key?: string | null;
  item_key: string;
  display_name?: string | null;
  data_type?: string | null;
  is_primary_key?: boolean;
  is_time_dimension?: boolean;
  is_email?: boolean;
  description?: string | null;
  expression?: string | null;
  source?: string;
  in_scope?: boolean;
  sensitive_level?: string;
  mask_rule?: string | null;
}

export interface IqdScopePolicy {
  id?: number;
  connection_id?: number;
  subject_type: string;
  subject_id: string;
  item_key: string;
  allow?: boolean;
  effective?: boolean;
  remark?: string | null;
}

export interface IqdScopePolicySavePayload {
  subject_type: string;
  subject_id: string;
  item_key: string;
  allow?: boolean;
  effective?: boolean;
  remark?: string | null;
}

export interface IqdAcl {
  id?: number;
  connection_id?: number;
  subject_type: string;
  subject_id: string;
  item_key: string;
  action: string;
  row_scope?: string | null;
}

export interface IqdAclSavePayload {
  subject_type: string;
  subject_id: string;
  item_key: string;
  action: string;
  row_scope?: string | null;
}

export interface IqdMaskRule {
  id?: number;
  name: string;
  match_type: string;
  pattern: string;
  rule: string;
  replacement?: string | null;
  priority?: number;
  enabled?: boolean;
}

export interface IqdMaskRuleSavePayload {
  name: string;
  match_type: string;
  pattern: string;
  rule: string;
  replacement?: string | null;
  priority?: number;
  enabled?: boolean;
}

export interface IqdScopeDimension {
  id?: number;
  dimension_code: string;
  dimension_name: string;
  predicate_type: string;
  column_name: string;
  header_name: string;
  param_whitelist?: string | null;
  dict_table?: string | null;
  auto_mode?: boolean;
  enabled?: boolean;
  sort?: number;
}

export interface IqdDictSyncStatus {
  dimension: string;
  status: string;
  message?: string;
  updated_at?: string;
  rows?: number;
  failures?: unknown[];
}

/** 问数审计日志（W3 /traces）。 */
export interface IqdAskLog {
  id?: number;
  trace_id?: string | null;
  session_id?: string | null;
  thread_id?: string | null;
  query_id?: string | null;
  user_id?: number | null;
  employee_id?: string | null;
  role_codes?: string | null;
  question?: string | null;
  resolved_scope?: string | null;
  status?: string | null;
  wren_status_trail?: string | null;
  sql_text?: string | null;
  sql_dialect?: string | null;
  summary?: string | null;
  citations?: string | null;
  plan_steps?: string | null;
  row_count?: number | null;
  masked_columns?: string | null;
  latency_ms?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  view_mode?: string | null;
  simulated_role_code?: string | null;
  created_at?: string | null;
}

/** 问数样本对（W4 /sql-pairs；v1.10 增 source_dialect / native_sql / wren_sql）。 */
export interface IqdSqlPair {
  id?: number;
  connection_id?: number;
  question: string;
  source_dialect?: string | null;
  native_sql?: string | null;
  wren_sql: string;
  remark?: string | null;
  enabled?: boolean;
  wren_ref_id?: string | null;
  sync_status?: string;
  synced_at?: string | null;
  created_by?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface IqdSqlPairSavePayload {
  id?: number | null;
  connection_id?: number;
  question: string;
  source_dialect?: string;
  native_sql?: string;
  wren_sql: string;
  remark?: string | null;
  enabled?: boolean;
}

/** v1.10 样本对方言转化结果（POST /sql-pairs/translate）。 */
export interface IqdTranslateResult {
  wren_sql: string;
  warnings: string[];
}

/** v1.10 样本对试运行结果（POST /sql-pairs/trial）。 */
export interface IqdTrialResult {
  columns: unknown[];
  rows: unknown[][];
  error: string | null;
  duration_ms: number;
}

/** 问数知识/术语/口径（W4 /knowledge）。 */
export interface IqdKnowledge {
  id?: number;
  connection_id?: number;
  kind: string;
  title: string;
  content?: string | null;
  related_item_keys?: string | null;
  source?: string;
  kb_term_id?: string | null;
  enabled?: boolean;
  wren_ref_id?: string | null;
  sync_status?: string;
  synced_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface IqdKnowledgeSavePayload {
  id?: number;
  connection_id?: number;
  kind: string;
  title: string;
  content?: string | null;
  related_item_keys?: string | null;
  source?: string;
  kb_term_id?: string | null;
  enabled?: boolean;
}

/** 问数响应（非流式 ask 的 data 段，与 Python iqd_schema.AskResponse 对齐）。 */
export interface IqdAskResponse {
  query_id: string;
  thread_id?: string | null;
  /** 回答智能体标识（路由展示元数据；Worker 默认 mis-iqd）。 */
  agent_id?: string;
  status: string;
  answer_summary: string;
  sql?: string | null;
  sql_dialect?: string | null;
  data: {
    columns: Array<{
      name: string;
      item_key?: string;
      data_type?: string;
      display_name?: string;
      masked?: boolean;
    }>;
    rows: unknown[][];
    row_count: number;
    truncated?: boolean;
  };
  citations: Array<{
    kind: string;
    item_key: string;
    display_name?: string;
    description?: string | null;
    snippet?: string | null;
    source_ref?: string | null;
  }>;
  plan: Array<{
    seq: number;
    code: string;
    label: string;
    detail?: string | null;
    sql?: string | null;
    status: string;
    duration_ms?: number;
  }>;
  scope: {
    decision: string;
    allowed_item_keys: string[];
    denied_item_keys: string[];
    reason?: string | null;
    subject_summary?: string;
    connection_id?: number | null;
  };
  masked_columns: string[];
  latency_ms: number;
  error_code?: string | null;
  error_message?: string | null;
}

export interface IqdAskPayload {
  question: string;
  session_id?: string | null;
  thread_id?: string | null;
  connection_id?: number | null;
  view?: 'user' | 'admin';
  simulate_role_code?: string | null;
  scope_hint?: string[];
}

// ================================================================ 连接配置

export async function getIqdConfig(): Promise<IqdConnectionConfig> {
  const res = await api.get<ApiResult<IqdConnectionConfig>>('/iqd/config');
  return unwrap(res, '获取问数连接配置失败');
}

export async function saveIqdConfig(body: IqdConnectionSavePayload): Promise<IqdConnectionConfig> {
  const res = await api.put<ApiResult<IqdConnectionConfig>>('/iqd/config', body);
  return unwrap(res, '保存问数连接配置失败');
}

export async function testIqdConfig(): Promise<IqdConnectionTest> {
  const res = await api.post<ApiResult<IqdConnectionTest>>('/iqd/config/test');
  return unwrap(res, '问数连接连通自检失败');
}

// ================================================================ 清单

export async function listIqdCatalog(connectionId: number): Promise<IqdCatalogItem[]> {
  const res = await api.get<ApiResult<IqdCatalogItem[]>>('/iqd/catalog', {
    params: { connectionId },
  });
  return unwrap(res, '获取问数清单失败');
}

export async function saveIqdCatalogBatch(
  connectionId: number,
  items: IqdCatalogItemSavePayload[],
): Promise<{ count: number }> {
  const res = await api.post<ApiResult<{ count: number }>>('/iqd/catalog/batch', items, {
    params: { connectionId },
  });
  return unwrap(res, '保存问数清单失败');
}

export async function setIqdCatalogInScope(
  connectionId: number,
  inScope: boolean,
  itemKeys: string[],
): Promise<{ count: number }> {
  const res = await api.post<ApiResult<{ count: number }>>('/iqd/catalog/in-scope', itemKeys, {
    params: { connectionId, inScope },
  });
  return unwrap(res, '更新问数范围失败');
}

// ================================================================ 范围策略

export async function listIqdScopePolicies(connectionId: number): Promise<IqdScopePolicy[]> {
  const res = await api.get<ApiResult<IqdScopePolicy[]>>('/iqd/scope/policies', {
    params: { connectionId },
  });
  return unwrap(res, '获取范围策略失败');
}

export async function saveIqdScopePolicies(
  connectionId: number,
  items: IqdScopePolicySavePayload[],
): Promise<{ count: number }> {
  const res = await api.post<ApiResult<{ count: number }>>('/iqd/scope/policies', items, {
    params: { connectionId },
  });
  return unwrap(res, '保存范围策略失败');
}

// ================================================================ 表级 ACL

export async function listIqdAcls(connectionId: number): Promise<IqdAcl[]> {
  const res = await api.get<ApiResult<IqdAcl[]>>('/iqd/acl', {
    params: { connectionId },
  });
  return unwrap(res, '获取表级 ACL 失败');
}

export async function saveIqdAcls(
  connectionId: number,
  items: IqdAclSavePayload[],
): Promise<{ count: number }> {
  const res = await api.post<ApiResult<{ count: number }>>('/iqd/acl/batch', items, {
    params: { connectionId },
  });
  return unwrap(res, '保存表级 ACL 失败');
}

export async function deleteIqdAcl(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/iqd/acl/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除 ACL 失败');
}

// ================================================================ 脱敏规则

export async function listIqdMaskRules(): Promise<IqdMaskRule[]> {
  const res = await api.get<ApiResult<IqdMaskRule[]>>('/iqd/mask/rules');
  return unwrap(res, '获取脱敏规则失败');
}

export async function saveIqdMaskRule(body: IqdMaskRuleSavePayload): Promise<IqdMaskRule> {
  const res = await api.post<ApiResult<IqdMaskRule>>('/iqd/mask/rules', body);
  return unwrap(res, '保存脱敏规则失败');
}

export async function deleteIqdMaskRule(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/iqd/mask/rules/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除脱敏规则失败');
}

// ================================================================ 维度注册表

export async function listIqdDimensions(): Promise<IqdScopeDimension[]> {
  const res = await api.get<ApiResult<IqdScopeDimension[]>>('/iqd/dimensions');
  return unwrap(res, '获取行级维度注册表失败');
}

export async function saveIqdDimension(body: Partial<IqdScopeDimension>): Promise<IqdScopeDimension> {
  const res = await api.post<ApiResult<IqdScopeDimension>>('/iqd/dimensions', body);
  return unwrap(res, '保存维度注册表失败');
}

export async function deleteIqdDimension(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/iqd/dimensions/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除维度注册表失败');
}

// ================================================================ 字典同步

export async function syncIqdDimension(dimensionCode: string): Promise<Record<string, unknown>> {
  const res = await api.post<ApiResult<Record<string, unknown>>>(
    `/iqd/scope/sync/${encodeURIComponent(dimensionCode)}`,
  );
  return unwrap(res, '触发字典同步失败');
}

export async function listIqdDictSyncStatus(): Promise<IqdDictSyncStatus[]> {
  const res = await api.get<ApiResult<IqdDictSyncStatus[]>>('/iqd/scope/dict-sync-status');
  return unwrap(res, '获取字典同步状态失败');
}

// ================================================================ 问数（测试页）

export async function askIqd(body: IqdAskPayload): Promise<IqdAskResponse> {
  const res = await api.post<ApiResult<IqdAskResponse>>('/iqd/ask', body, { timeout: 180000 });
  return unwrap(res, '问数请求失败');
}

// ================================================================ 审计回查（W3）

export async function listIqdTraces(params?: {
  limit?: number;
  status?: string;
  userId?: number;
}): Promise<IqdAskLog[]> {
  const res = await api.get<ApiResult<IqdAskLog[]>>('/iqd/traces', { params });
  return unwrap(res, '获取问数审计日志失败');
}

export async function getIqdTrace(id: number): Promise<IqdAskLog> {
  const res = await api.get<ApiResult<IqdAskLog>>(`/iqd/traces/${id}`);
  return unwrap(res, '获取问数审计详情失败');
}

// ================================================================ 样本对（W4）

export async function listIqdSqlPairs(connectionId: number): Promise<IqdSqlPair[]> {
  const res = await api.get<ApiResult<IqdSqlPair[]>>('/iqd/sql-pairs', {
    params: { connectionId },
  });
  return unwrap(res, '获取样本对失败');
}

export async function saveIqdSqlPair(body: IqdSqlPairSavePayload): Promise<IqdSqlPair> {
  const res = await api.post<ApiResult<IqdSqlPair>>('/iqd/sql-pairs', body);
  return unwrap(res, '保存样本对失败');
}

export async function deleteIqdSqlPair(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/iqd/sql-pairs/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除样本对失败');
}

/**
 * 样本对方言转化（v1.10 / §4.2.3）：调 BFF /api/v1/iqd/sql-pairs/translate。
 * 服务端用 sqlglot 把源方言翻到 WrenAI 方言；前端不直连 WrenAI（NFR-1）。
 */
export async function translateSqlPair(body: {
  db_type: string;
  native_sql: string;
}): Promise<IqdTranslateResult> {
  const res = await api.post<ApiResult<IqdTranslateResult>>('/iqd/sql-pairs/translate', body);
  return unwrap(res, '样本对翻译失败');
}

/**
 * 样本对试运行（v1.10 / §4.2.3）：调 BFF /api/v1/iqd/sql-pairs/trial。
 * 服务端经 MCP run_sql 在 WrenAI 引擎侧执行转化后的 wren_sql。
 */
export async function trialSqlPair(body: { wren_sql: string }): Promise<IqdTrialResult> {
  const res = await api.post<ApiResult<IqdTrialResult>>('/iqd/sql-pairs/trial', body);
  return unwrap(res, '样本对试运行失败');
}

// ================================================================ 知识/术语（W4）

export async function listIqdKnowledge(
  connectionId: number,
  kind?: string,
): Promise<IqdKnowledge[]> {
  const res = await api.get<ApiResult<IqdKnowledge[]>>('/iqd/knowledge', {
    params: { connectionId, kind },
  });
  return unwrap(res, '获取知识/术语失败');
}

export async function saveIqdKnowledge(body: IqdKnowledgeSavePayload): Promise<IqdKnowledge> {
  const res = await api.post<ApiResult<IqdKnowledge>>('/iqd/knowledge', body);
  return unwrap(res, '保存知识/术语失败');
}

export async function deleteIqdKnowledge(id: number): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/iqd/knowledge/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除知识/术语失败');
}

export async function importIqdKnowledgeS07(connectionId: number): Promise<Record<string, unknown>> {
  const res = await api.post<ApiResult<Record<string, unknown>>>(
    '/iqd/knowledge/import-s07',
    undefined,
    { params: { connectionId } },
  );
  return unwrap(res, 'S-07 术语导入失败');
}

// ================================================================ 增强推送（W4）

export async function pushIqdEnhancements(connectionId: number): Promise<Record<string, unknown>> {
  const res = await api.post<ApiResult<Record<string, unknown>>>(
    '/iqd/enhance/push',
    undefined,
    { params: { connectionId } },
  );
  return unwrap(res, '获取待推送增强物料失败');
}

// ================================================================ 闭环补全（P0-2 / P0-4）

/** 增强同步作业状态（GET /iqd/enhance/sync-status；snake_case wire，对齐 IqdSyncJobVO）。 */
export interface IqdSyncStatus {
  id?: number;
  connection_id?: number;
  build_status?: string;
  build_mdl_hash?: string | null;
  index_status?: string;
  build_at?: string | null;
  index_at?: string | null;
  synced_sql_pair_count?: number;
  synced_knowledge_count?: number;
  build_error?: string | null;
  index_error?: string | null;
  updated_at?: string | null;
}

// ================================================================ 二期：语义模型编辑（P0-1~P0-12）

/** catalog 编辑态枚举（与 mis-iqd getCatalogSyncStatus 派生值一致）。 */
export type IqdCatalogEditStatus =
  | 'EDITED_UNSYNCED'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_FAILED'
  | 'STALE_DRIFT';

/** catalog 节点编辑请求体（PUT /iqd/catalog/node）。 */
export interface IqdEditNodePayload {
  item_key: string;
  kind: string;
  patch: {
    display_name?: string | null;
    description?: string | null;
    expression?: string | null;
  };
  base_revision: number;
  idempotency_key: string;
}

/** catalog 编辑同步状态（GET /iqd/catalog/sync-status；对齐 mis-iqd getCatalogSyncStatus）。 */
export interface IqdCatalogSyncStatus {
  connection_id?: number;
  current_edit_revision?: number;
  built_edit_revision?: number;
  edit_status?: IqdCatalogEditStatus | string;
  build_status?: string;
  index_status?: string;
  mdl_hash?: string | null;
  stale_drift?: boolean;
}

/** 直接引用方（后端 422 引用阻断依据）。 */
export type IqdDependents = Array<{ item_key: string; kind: string }>;

/** catalog 节点编辑返回（PUT /iqd/catalog/node 成功）。 */
export interface IqdEditNodeResult {
  edit_revision: number;
  edit_status: string;
  wren_ref_id: string | null;
}

/**
 * 触发增强同步（闭环补全 P0-2）：调 BFF /api/v1/iqd/enhance/sync → ai-platform Worker
 * 经 SyncCoordinator 合并窗口异步执行 context build + memory index + 回填。
 * 默认 wait=false（接受即返回）。
 */
export async function syncIqdEnhancements(
  connectionId: number,
  wait = false,
): Promise<Record<string, unknown>> {
  const res = await api.post<ApiResult<Record<string, unknown>>>(
    '/iqd/enhance/sync',
    undefined,
    { params: { connectionId, wait } },
  );
  return unwrap(res, '触发增强同步失败');
}

/**
 * 回查最近一次增强同步作业（P0-4 状态条）。无作业记录时后端返回 data=null，
 * 此处归一化为 null（前端展示「尚未同步」）。
 */
export async function getIqdEnhancementSyncStatus(
  connectionId: number,
): Promise<IqdSyncStatus | null> {
  const res = await api.get<ApiResult<IqdSyncStatus | null>>('/iqd/enhance/sync-status', {
    params: { connectionId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '获取同步状态失败');
  return res.data.data ?? null;
}

// ================================================================ 二期：语义模型编辑（P0-1~P0-12）

/**
 * 编辑 catalog 节点（写回 MDL 前置）：调 BFF PUT /api/v1/iqd/catalog/node。
 *
 * <p>乐观并发冲突（40900，data.current_edit_revision）与引用阻断（42200，
 * data.dependents）由 BFF 透传业务码；本方法把 code / data 挂在 Error 上便于
 * 前端提示「版本已变更，点重读」或列出直接引用方并禁用确认。
 */
export async function updateIqdCatalogNode(
  connectionId: number,
  payload: IqdEditNodePayload,
): Promise<IqdEditNodeResult> {
  const res = await api.put<ApiResult<IqdEditNodeResult>>(
    '/iqd/catalog/node',
    payload,
    { params: { connectionId } },
  );
  if (res.data.code !== 0) {
    const err = new Error(res.data.message || '编辑 catalog 节点失败') as Error & {
      code?: number;
      data?: unknown;
    };
    err.code = res.data.code;
    err.data = res.data.data;
    throw err;
  }
  return res.data.data as IqdEditNodeResult;
}

/**
 * 取连接级编辑同步状态（GET /iqd/catalog/sync-status），前端 CatalogSyncStatusBar 轮询。
 * 无记录时后端返回 data=null，归一化为 null。
 */
export async function getIqdCatalogSyncStatus(
  connectionId: number,
): Promise<IqdCatalogSyncStatus | null> {
  const res = await api.get<ApiResult<IqdCatalogSyncStatus | null>>('/iqd/catalog/sync-status', {
    params: { connectionId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '获取编辑同步状态失败');
  return res.data.data ?? null;
}

/**
 * 触发对账（POST /iqd/catalog/reconcile）：清空外部漂移并重按 model 范围重建。
 */
export async function reconcileIqdCatalog(
  connectionId: number,
): Promise<{ triggered: boolean }> {
  const res = await api.post<ApiResult<{ triggered: boolean }>>(
    '/iqd/catalog/reconcile',
    undefined,
    { params: { connectionId } },
  );
  return unwrap(res, '触发对账失败');
}
