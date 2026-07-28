import api from '@/lib/api/client';
import type { ApiResult, MenuNode } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export async function fetchMenuTree(appId?: string | number): Promise<MenuNode[]> {
  const res = await api.get<ApiResult<MenuNode[]>>(
    '/menus/tree',
    appId != null ? { params: { appId } } : undefined,
  );
  return unwrap(res, '获取菜单树失败');
}

export async function createMenu(body: {
  parentId: number;
  name: string;
  type: number;
  path?: string;
  component?: string;
  permission?: string;
  icon?: string;
  sort?: number;
  visible?: number;
  appId?: string | number;
}): Promise<MenuNode> {
  const res = await api.post<ApiResult<MenuNode>>('/menus', body);
  return unwrap(res, '创建菜单失败');
}

export async function updateMenu(
  id: string,
  body: {
    name: string;
    path?: string;
    component?: string;
    permission?: string;
    icon?: string;
    sort?: number;
    visible?: number;
    status?: number;
  },
): Promise<MenuNode> {
  const res = await api.put<ApiResult<MenuNode>>(`/menus/${id}`, body);
  return unwrap(res, '更新菜单失败');
}

export async function deleteMenu(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/menus/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除菜单失败');
}
