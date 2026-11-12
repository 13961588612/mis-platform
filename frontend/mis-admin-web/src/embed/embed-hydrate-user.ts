/**
 * 嵌入鉴权成功后，用 MIS JWT 拉 {@code GET /api/v1/auth/me}，回填 auth-store.user。
 *
 * <p>P4：不信任宿主 PAGE_CONTEXT / 外部身份字段；展示名只来自 MIS 自己的 /auth/me。
 * 使用原生 fetch，避免 axios 401 拦截器把 iframe 踢到管理台 /login。
 */

import { useAuthStore } from '@/stores/auth-store';
import type { LoginResponse, MeResponse } from '@/types/api';

function toAuthUser(me: MeResponse): LoginResponse['user'] {
  return {
    id: String(me.id),
    employeeId: '',
    username: me.username || '',
    realName: me.realName || me.username || '',
    avatarUrl: me.avatarUrl ?? null,
    deptId: null,
    deptName: null,
    roles: Array.isArray(me.roles) ? me.roles : [],
    mustChangePassword: false,
  };
}

/**
 * 用当前 Bearer 拉 MIS 用户资料并写入 auth-store。
 * 失败仅打日志，不打断对话（头像回退「我」）。
 */
export async function hydrateEmbedUser(accessToken: string): Promise<boolean> {
  const token = (accessToken || '').trim();
  if (!token) return false;

  try {
    const res = await fetch('/api/v1/auth/me', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'same-origin',
    });

    let body: { code?: number; message?: string; data?: MeResponse } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      console.warn('[EmbedHydrate] /auth/me non-json', { httpStatus: res.status });
      return false;
    }

    if (!res.ok || body.code !== 0 || !body.data?.id) {
      console.warn('[EmbedHydrate] /auth/me failed', {
        httpStatus: res.status,
        code: body.code,
        message: body.message,
      });
      return false;
    }

    const me = body.data;
    const patch: Partial<ReturnType<typeof useAuthStore.getState>> = {
      user: toAuthUser(me),
    };
    if (Array.isArray(me.permissions) && me.permissions.length > 0) {
      patch.permissions = me.permissions;
    }
    useAuthStore.setState(patch);
    console.info('[EmbedHydrate] user ok', {
      userId: me.id,
      username: me.username,
      realName: me.realName,
    });
    return true;
  } catch (err) {
    console.warn('[EmbedHydrate] /auth/me error', err);
    return false;
  }
}
