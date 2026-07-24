import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LoginResponse, RouterNode } from '@/types/api';

interface AuthState {
  accessToken: string | null;
  expiresAt: number | null;
  user: LoginResponse['user'] | null;
  app: LoginResponse['app'] | null;
  permissions: string[];
  menus: RouterNode[];
  currentAppId: string | null;
  setSession: (payload: LoginResponse) => void;
  setAccessToken: (accessToken: string, expiresIn: number) => void;
  setPermissions: (permissions: string[]) => void;
  setMenus: (menus: RouterNode[]) => void;
  setCurrentAppId: (appId: string | null) => void;
  clearSession: () => void;
  isAuthenticated: () => boolean;
  hasPermission: (code?: string | null) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      expiresAt: null,
      user: null,
      app: null,
      permissions: [],
      menus: [],
      currentAppId: null,
      setSession: (payload) =>
        set({
          accessToken: payload.accessToken,
          expiresAt: Date.now() + payload.expiresIn * 1000,
          user: payload.user,
          app: payload.app,
          currentAppId: payload.app?.id ?? null,
        }),
      setAccessToken: (accessToken, expiresIn) =>
        set({
          accessToken,
          expiresAt: Date.now() + expiresIn * 1000,
        }),
      setPermissions: (permissions) => set({ permissions }),
      setMenus: (menus) => set({ menus }),
      setCurrentAppId: (appId) => set({ currentAppId: appId }),
      clearSession: () =>
        set({
          accessToken: null,
          expiresAt: null,
          user: null,
          app: null,
          permissions: [],
          menus: [],
          currentAppId: null,
        }),
      isAuthenticated: () => {
        const { accessToken, expiresAt } = get();
        return Boolean(accessToken && expiresAt && expiresAt > Date.now());
      },
      hasPermission: (code) => {
        if (!code) return true;
        return get().permissions.includes(code);
      },
    }),
    {
      name: 'mis-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        expiresAt: state.expiresAt,
        user: state.user,
        app: state.app,
        permissions: state.permissions,
        menus: state.menus,
        currentAppId: state.currentAppId,
      }),
    },
  ),
);
