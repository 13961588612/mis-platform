import api from '@/lib/api/client';
import type { ApiResult, AppItem, DashboardStats } from '@/types/api';

export async function fetchApps(): Promise<AppItem[]> {
  const res = await api.get<ApiResult<AppItem[]>>('/apps');
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '获取应用列表失败');
  }
  return res.data.data;
}

export async function updateApp(
  id: string,
  payload: {
    name?: string;
    icon?: string | null;
    basePath?: string | null;
    entry?: string | null;
    description?: string | null;
    portalGroup?: string | null;
    kind?: string;
    runtime?: string;
    sort?: number;
    status?: number;
  },
): Promise<AppItem> {
  const res = await api.put<ApiResult<AppItem>>(`/apps/${id}`, payload);
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '保存应用失败');
  }
  return res.data.data;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await api.get<ApiResult<DashboardStats>>('/dashboard/stats');
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '获取统计失败');
  }
  return res.data.data;
}
