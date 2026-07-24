import api from '@/lib/api/client';
import type { ApiResult, MeResponse, RouterNode } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';

export async function fetchMe(): Promise<MeResponse> {
  const res = await api.get<ApiResult<MeResponse>>('/auth/me');
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '获取用户信息失败');
  }
  return res.data.data;
}

export async function fetchRouterMenus(): Promise<RouterNode[]> {
  const res = await api.get<ApiResult<RouterNode[]>>('/menus/router');
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '获取菜单失败');
  }
  return res.data.data;
}

export async function fetchPermissions(): Promise<string[]> {
  const res = await api.get<ApiResult<string[]>>('/menus/permissions');
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '获取权限失败');
  }
  return res.data.data;
}

/** 登录后或刷新会话时拉取权限与动态菜单。 */
export async function bootstrapSession(): Promise<void> {
  const [permissions, menus] = await Promise.all([fetchPermissions(), fetchRouterMenus()]);
  useAuthStore.getState().setPermissions(permissions);
  useAuthStore.getState().setMenus(menus);
}
