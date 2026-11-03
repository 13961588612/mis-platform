/**
 * 模板报告管理 / Copilot 运行时 API（BFF → mis-ai-template-report）。
 */
import api from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { ApiResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new ApiError(res.data.code ?? -1, res.data.message || fallback);
  }
  return res.data.data;
}

export interface AiReportCategory {
  id: number;
  parent_id: number;
  code: string;
  name: string;
  is_group: boolean;
  sort_order: number;
  enabled: boolean;
  children?: AiReportCategory[];
}

export interface AiParamSource {
  id: number;
  source_code: string;
  name: string;
  value_type: string;
  wire_key: string;
  handler_bean: string;
  enabled: boolean;
  sort_order: number;
}

export interface AiWorkflowPlatform {
  id: number;
  platform_code: string;
  name: string;
  enabled: boolean;
}

export interface AiReportSlot {
  source_code: string;
  required?: boolean;
  label_override?: string;
}

export interface AiReportDef {
  id: number;
  report_code: string;
  title: string;
  description?: string | null;
  category_id?: number | null;
  slots: AiReportSlot[];
  use_ai_workflow: boolean;
  workflow_platform_code?: string | null;
  workflow_code?: string | null;
  enabled: boolean;
  sort_order: number;
}

export async function fetchAiReportCategoryTree(): Promise<AiReportCategory[]> {
  const res = await api.get<ApiResult<AiReportCategory[]>>('/ai-reports/categories/tree');
  return res.data.data ?? [];
}

export async function createAiReportCategory(body: Record<string, unknown>): Promise<AiReportCategory> {
  const res = await api.post<ApiResult<AiReportCategory>>('/ai-reports/categories', body);
  return res.data.data!;
}

export async function updateAiReportCategory(
  id: number,
  body: Record<string, unknown>,
): Promise<AiReportCategory> {
  const res = await api.put<ApiResult<AiReportCategory>>(`/ai-reports/categories/${id}`, body);
  return res.data.data!;
}

export async function deleteAiReportCategory(id: number): Promise<void> {
  await api.delete(`/ai-reports/categories/${id}`);
}

export async function fetchAiParamSources(): Promise<AiParamSource[]> {
  const res = await api.get<ApiResult<AiParamSource[]>>('/ai-reports/param-sources');
  return res.data.data ?? [];
}

export async function fetchAiWorkflowPlatforms(): Promise<AiWorkflowPlatform[]> {
  const res = await api.get<ApiResult<AiWorkflowPlatform[]>>('/ai-reports/workflow-platforms');
  return res.data.data ?? [];
}

export async function fetchAiReportDefs(params?: {
  categoryId?: number;
  uncategorized?: boolean;
}): Promise<AiReportDef[]> {
  const res = await api.get<ApiResult<AiReportDef[]>>('/ai-reports/defs', { params });
  return res.data.data ?? [];
}

export async function createAiReportDef(body: Record<string, unknown>): Promise<AiReportDef> {
  const res = await api.post<ApiResult<AiReportDef>>('/ai-reports/defs', body);
  return res.data.data!;
}

export async function updateAiReportDef(id: number, body: Record<string, unknown>): Promise<AiReportDef> {
  const res = await api.put<ApiResult<AiReportDef>>(`/ai-reports/defs/${id}`, body);
  return res.data.data!;
}

export async function deleteAiReportDef(id: number): Promise<void> {
  await api.delete(`/ai-reports/defs/${id}`);
}

/** Copilot 分组目录（仅 ACL 可见报告）。 */
export interface AiReportCatalogItem {
  report_code: string;
  title: string;
  description?: string | null;
  use_ai_workflow?: boolean;
  workflow_code?: string | null;
  workflow_platform_code?: string | null;
}

export interface AiReportCatalogGroup {
  group_id: number;
  group_code: string;
  group_name: string;
  reports: AiReportCatalogItem[];
}

export interface AiReportParamOption {
  value: string;
  label: string;
  extra?: Record<string, unknown>;
}

export interface AiReportPreparedSlot {
  source_code: string;
  value_type: string;
  wire_key: string;
  label: string;
  required: boolean;
  default_value?: string | null;
  options: AiReportParamOption[];
}

export interface AiReportPrepareCard {
  report_code: string;
  title: string;
  description?: string | null;
  use_ai_workflow: boolean;
  workflow_code?: string | null;
  workflow_platform_code?: string | null;
  slots: AiReportPreparedSlot[];
}

/** 无权限 / 无可选参数（前端不插卡）。 */
export const AI_REPORT_NO_PARAM_ACCESS = 40321;

export async function fetchAiReportCatalog(): Promise<AiReportCatalogGroup[]> {
  const res = await api.get<ApiResult<AiReportCatalogGroup[]>>('/ai-reports/catalog');
  return unwrap(res, '加载报告目录失败');
}

export async function prepareAiReportCard(reportCode: string): Promise<AiReportPrepareCard> {
  const res = await api.post<ApiResult<AiReportPrepareCard>>('/ai-reports/prepare-card', {
    reportCode,
  });
  return unwrap(res, '准备参数卡失败');
}
