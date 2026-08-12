import api from '@/lib/api/client';
import type { ApiResult, MenuApiBindingItem, MenuNode } from '@/types/api';

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

/** 查询某菜单已绑定的接口明细（绑定弹层回显）。 */
export async function fetchMenuApis(menuId: string | number): Promise<MenuApiBindingItem[]> {
  const res = await api.get<ApiResult<MenuApiBindingItem[]>>(`/menus/${menuId}/apis`);
  return unwrap(res, '获取菜单关联接口失败');
}

/** 全量替换某菜单的关联接口（apiIds 顺序即 sort 顺序；传空数组等价于清空）。 */
export async function replaceMenuApis(menuId: string | number, apiIds: (string | number)[]): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/menus/${menuId}/apis`, {
    apiIds: apiIds.map((id) => Number(id)),
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '保存菜单关联接口失败');
}
