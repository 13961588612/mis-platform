import api from '@/lib/api/client';
import type { ApiResult, OrgItem } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export async function listOrgs(): Promise<OrgItem[]> {
  const res = await api.get<ApiResult<OrgItem[]>>('/orgs');
  return unwrap(res, '获取组织列表失败');
}

export async function createOrg(body: {
  code: string;
  name: string;
  sort?: number;
  remark?: string;
  categoryId?: number;
}): Promise<OrgItem> {
  const res = await api.post<ApiResult<OrgItem>>('/orgs', body);
  return unwrap(res, '创建组织失败');
}

export async function updateOrg(
  id: string,
  body: { name: string; sort?: number; status?: number; remark?: string },
): Promise<OrgItem> {
  const res = await api.put<ApiResult<OrgItem>>(`/orgs/${id}`, body);
  return unwrap(res, '更新组织失败');
}

export async function deleteOrg(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/orgs/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除组织失败');
}
