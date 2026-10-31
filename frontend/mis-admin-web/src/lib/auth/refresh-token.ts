/**
 * 共享 accessToken 续期：REST 401 拦截、到期前主动刷新、Copilot SSE/WS 鉴权失败共用。
 *
 * <p>独立 axios 实例调 {@code POST /auth/refresh}，避免与 {@code lib/api/client} 循环依赖。
 */

import axios, { type AxiosError } from 'axios';
import type { ApiResult, TokenResponse } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';

/** 到期前多久触发主动刷新（5 分钟）。 */
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

/** 定时器下限，避免时钟抖动导致 tight loop。 */
const MIN_REFRESH_DELAY_MS = 5_000;

const refreshClient = axios.create({
  baseURL: '/api/v1',
  timeout: 15_000,
  withCredentials: true,
});

let refreshPromise: Promise<string | null> | null = null;
let lastRefreshError: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerStarted = false;

export function getLastRefreshError(): string | null {
  return lastRefreshError;
}

/**
 * 计算距下次主动刷新的延迟；已进入 skew 窗口则返回 0（应立即刷新）。
 */
export function computeRefreshDelayMs(
  expiresAt: number,
  now: number = Date.now(),
  skewMs: number = TOKEN_REFRESH_SKEW_MS,
): number {
  return Math.max(expiresAt - now - skewMs, 0);
}

/** 调用 /auth/refresh；并发调用合并为同一次 Promise。失败时 clearSession。 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    lastRefreshError = null;
    refreshPromise = refreshClient
      .post<ApiResult<TokenResponse>>('/auth/refresh', {})
      .then((res) => {
        if (res.data.code !== 0 || !res.data.data) {
          throw new Error(res.data.message || `refresh code=${res.data.code}`);
        }
        const { accessToken, expiresIn } = res.data.data;
        useAuthStore.getState().setAccessToken(accessToken, expiresIn);
        return accessToken;
      })
      .catch((err: unknown) => {
        const ax = err as AxiosError<ApiResult<unknown>>;
        lastRefreshError =
          ax.response?.data?.message ||
          ax.message ||
          (err instanceof Error ? err.message : 'refresh failed');
        console.warn('[auth-kick] /auth/refresh 失败', {
          status: ax.response?.status,
          code: ax.response?.data?.code,
          message: lastRefreshError,
        });
        useAuthStore.getState().clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * 若 token 仍在 skew 外则原样返回；已过期或即将过期则 refresh。
 */
export async function ensureTokenFresh(): Promise<string | null> {
  const { accessToken, expiresAt } = useAuthStore.getState();
  if (!accessToken) return null;
  if (expiresAt != null && expiresAt - Date.now() > TOKEN_REFRESH_SKEW_MS) {
    return accessToken;
  }
  return refreshAccessToken();
}

function clearRefreshTimer(): void {
  if (refreshTimer != null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/** 按当前 expiresAt 安排下一次主动刷新。 */
export function armTokenRefreshScheduler(): void {
  clearRefreshTimer();
  const { accessToken, expiresAt } = useAuthStore.getState();
  if (!accessToken || expiresAt == null) return;

  const delay = computeRefreshDelayMs(expiresAt);
  // 已进入 skew：短暂防抖后刷新；否则按剩余时间，且不少于 MIN。
  const wait = delay === 0 ? MIN_REFRESH_DELAY_MS : Math.max(delay, MIN_REFRESH_DELAY_MS);

  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshAccessToken().then((token) => {
      if (token) armTokenRefreshScheduler();
    });
  }, wait);
}

/**
 * 启动全局调度：监听 auth-store、persist 水合、页签可见时 ensure。
 * 幂等，可在 main 入口调用一次。
 */
export function initTokenRefreshScheduler(): void {
  if (schedulerStarted || typeof window === 'undefined') return;
  schedulerStarted = true;

  const arm = (): void => armTokenRefreshScheduler();

  useAuthStore.subscribe((state, prev) => {
    if (state.accessToken !== prev.accessToken || state.expiresAt !== prev.expiresAt) {
      if (!state.accessToken) {
        clearRefreshTimer();
        return;
      }
      arm();
    }
  });

  const persistApi = useAuthStore.persist;
  if (persistApi.hasHydrated()) {
    arm();
  } else {
    persistApi.onFinishHydration(() => arm());
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void ensureTokenFresh().then((token) => {
        if (token) arm();
      });
    }
  });
}
