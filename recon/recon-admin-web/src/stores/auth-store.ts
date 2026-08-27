import { useSyncExternalStore } from 'react';

/**
 * 会话状态（阶段 2：壳子 microApp.setData 下发的用户信息与权限码）。
 * <p>
 * 零依赖轻量 store（useSyncExternalStore + 发布订阅）：recon 未引入 zustand，
 * 避免为单一会话态增加依赖。token 仍由 lib/api/client 管理（axios 拦截器读取），
 * 本 store 只承载展示/权限判定所需的 user + permissions。
 */
export interface AuthUser {
  id?: string | number;
  username?: string;
  realName?: string;
  avatarUrl?: string;
  roles?: string[];
}

export interface AuthSession {
  token: string;
  user: AuthUser | null;
  permissions: string[];
}

let state: AuthSession = { token: '', user: null, permissions: [] };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthSession {
  return state;
}

export function setSession(token: string, user: AuthUser | null, permissions: string[]) {
  state = { token, user, permissions };
  listeners.forEach((l) => l());
}

export function clearSession() {
  state = { token: '', user: null, permissions: [] };
  listeners.forEach((l) => l());
}

/**
 * 订阅会话态（selector 返回 state 内的稳定引用，避免无限重渲染）。
 * 用法：useAuthStore((s) => s.user) / useAuthStore((s) => s.permissions)
 */
export function useAuthStore<T>(selector: (s: AuthSession) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
