import api from '@/lib/api/client';
import type { ApiResult, DeptNode } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export async function fetchDeptTree(orgId: string | number): Promise<DeptNode[]> {
  const res = await api.get<ApiResult<DeptNode[]>>('/depts/tree', { params: { orgId } });
  return unwrap(res, '获取部门树失败');
}

export async function createDept(body: {
  orgId: number;
  parentId: number;
  name: string;
  categoryId: number;
  sort?: number;
  leaderEmployeeId?: number;
}): Promise<DeptNode> {
  const res = await api.post<ApiResult<DeptNode>>('/depts', body);
  return unwrap(res, '创建部门失败');
}

export async function updateDept(
  id: string,
  body: {
    name: string;
    categoryId?: number;
    sort?: number;
    status?: number;
    leaderEmployeeId?: number;
    parentId?: number;
  },
): Promise<DeptNode> {
  const res = await api.put<ApiResult<DeptNode>>(`/depts/${id}`, body);
  return unwrap(res, '更新部门失败');
}

export async function deleteDept(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/depts/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除部门失败');
}
