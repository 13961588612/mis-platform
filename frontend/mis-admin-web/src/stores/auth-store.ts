import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LoginResponse } from '@/types/api';

interface AuthState {
  accessToken: string | null;
  expiresAt: number | null;
  user: LoginResponse['user'] | null;
  app: LoginResponse['app'] | null;
  setSession: (payload: LoginResponse) => void;
  setAccessToken: (accessToken: string, expiresIn: number) => void;
  clearSession: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      expiresAt: null,
      user: null,
      app: null,
      setSession: (payload) =>
        set({
          accessToken: payload.accessToken,
          expiresAt: Date.now() + payload.expiresIn * 1000,
          user: payload.user,
          app: payload.app,
        }),
      setAccessToken: (accessToken, expiresIn) =>
        set({
          accessToken,
          expiresAt: Date.now() + expiresIn * 1000,
        }),
      clearSession: () =>
        set({
          accessToken: null,
          expiresAt: null,
          user: null,
          app: null,
        }),
      isAuthenticated: () => {
        const { accessToken, expiresAt } = get();
        return Boolean(accessToken && expiresAt && expiresAt > Date.now());
      },
    }),
    {
      name: 'mis-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        expiresAt: state.expiresAt,
        user: state.user,
        app: state.app,
      }),
    },
  ),
);
