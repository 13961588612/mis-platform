import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface ExecutionTask {
  id: string;
  sourceInstanceId: string | null;
  actionType: string;
  bizType: string | null;
  bizRefId: string | null;
  txStatus: string;
  retryCount: number;
  nextRetryAt: string | null;
  errorMsg: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchExecTasks(
  tenantId: string,
  status?: string,
  page = 1,
  size = 20,
): Promise<PageResult<ExecutionTask>> {
  const res = await api.get<ApiResult<PageResult<ExecutionTask>>>('/exec-monitor', {
    params: { tenantId, status, page, size },
  });
  return unwrap(res, '获取执行监控失败');
}

export async function retryExecTask(id: string, tenantId: string): Promise<void> {
  const res = await api.post<ApiResult<null>>(`/exec-monitor/${id}/retry`, null, { params: { tenantId } });
  if (res.data.code !== 0) throw new Error(res.data.message || '手动重试失败');
}

export async function forceArchiveExecTask(id: string, tenantId: string): Promise<void> {
  const res = await api.post<ApiResult<null>>(`/exec-monitor/${id}/force-archive`, null, { params: { tenantId } });
  if (res.data.code !== 0) throw new Error(res.data.message || '强制归档失败');
}