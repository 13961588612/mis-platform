import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface AuditOpItem {
  id: string;
  userId: string | null;
  username: string | null;
  module: string | null;
  operationType: string;
  businessType: string | null;
  businessId: string | null;
  description: string | null;
  resultStatus: string;
  durationMs: number | null;
  operTime: string;
}

export interface AuditOpDetail extends AuditOpItem {
  beforeData: string;
  afterData: string;
  diffSummary: string;
  traceId: string | null;
  errorMsg: string | null;
  extraContext: string;
}

export interface AuditTimelineItem {
  id: string;
  operationType: string;
  description: string | null;
  username: string | null;
  resultStatus: string;
  diffSummary: string;
  operTime: string;
}

export interface AuditStats {
  total: number;
  failed: number;
}

export interface DiffField {
  field: string;
  old: string | null;
  new: string | null;
}

export interface AuditQuery {
  tenantId: string;
  userId?: string;
  module?: string;
  operationType?: string;
  businessType?: string;
  resultStatus?: string;
  keyword?: string;
  startTime?: string;
  endTime?: string;
  page?: number;
  size?: number;
}

export async function fetchAuditOps(params: AuditQuery): Promise<PageResult<AuditOpItem>> {
  const res = await api.get<ApiResult<PageResult<AuditOpItem>>>('/audit-ops', { params });
  return unwrap(res, '获取审计日志失败');
}

export async function fetchAuditOpDetail(id: string, tenantId: string): Promise<AuditOpDetail> {
  const res = await api.get<ApiResult<AuditOpDetail>>(`/audit-ops/${id}`, { params: { tenantId } });
  return unwrap(res, '获取审计详情失败');
}

export async function fetchAuditTimeline(
  tenantId: string,
  businessType: string,
  businessId: string,
): Promise<AuditTimelineItem[]> {
  const res = await api.get<ApiResult<AuditTimelineItem[]>>(
    `/audit-ops/timeline/${encodeURIComponent(businessType)}/${encodeURIComponent(businessId)}`,
    { params: { tenantId } },
  );
  return unwrap(res, '获取操作时间线失败');
}

export async function fetchAuditStats(tenantId: string, days = 7): Promise<AuditStats> {
  const res = await api.get<ApiResult<AuditStats>>('/audit-ops/stats', { params: { tenantId, days } });
  return unwrap(res, '获取审计统计失败');
}

/** 安全解析 diffSummary JSON。 */
export function parseDiff(json: string | null | undefined): DiffField[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}