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

/** 问数样本对（W4 /sql-pairs）。 */
export interface IqdSqlPair {
  id?: number;
  connection_id?: number;
  question: string;
  sql_text: string;
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
  connection_id?: number;
  question: string;
  sql_text: string;
  remark?: string | null;
  enabled?: boolean;
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
