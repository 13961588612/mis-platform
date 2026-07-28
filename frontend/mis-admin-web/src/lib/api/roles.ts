import api from '@/lib/api/client';
import type { ApiResult, PageResult, RoleItem } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export async function pageRoles(page = 1, size = 50): Promise<PageResult<RoleItem>> {
  const res = await api.get<ApiResult<PageResult<RoleItem>>>('/roles', { params: { page, size } });
  return unwrap(res, '获取角色列表失败');
}

export async function listEnabledRoles(): Promise<RoleItem[]> {
  const res = await api.get<ApiResult<RoleItem[]>>('/roles/enabled');
  return unwrap(res, '获取启用角色失败');
}

export async function createRole(body: {
  code: string;
  name: string;
  dataScope?: number;
  remark?: string;
}): Promise<RoleItem> {
  const res = await api.post<ApiResult<RoleItem>>('/roles', body);
  return unwrap(res, '创建角色失败');
}

export async function updateRole(
  id: string,
  body: { name: string; dataScope?: number; status?: number; remark?: string },
): Promise<RoleItem> {
  const res = await api.put<ApiResult<RoleItem>>(`/roles/${id}`, body);
  return unwrap(res, '更新角色失败');
}

export async function deleteRole(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/roles/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除角色失败');
}

export async function listRoleMenus(id: string): Promise<number[]> {
  const res = await api.get<ApiResult<number[]>>(`/roles/${id}/menus`);
  return unwrap(res, '获取角色菜单失败');
}

export async function assignRoleMenus(id: string, menuIds: number[]): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/roles/${id}/menus`, { menuIds });
  if (res.data.code !== 0) throw new Error(res.data.message || '分配菜单失败');
}
