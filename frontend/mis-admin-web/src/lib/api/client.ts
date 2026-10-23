import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResult, TokenResponse } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { recordAuthKick } from '@/lib/auth/auth-kick-log';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  withCredentials: true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;
/** 最近一次 refresh 失败原因（供踢登录日志使用）。 */
let lastRefreshError: string | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    lastRefreshError = null;
    refreshPromise = api
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

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiResult<unknown>>) => {
    const original = error.config;
    if (!original || original.url?.includes('/auth/refresh') || original.url?.includes('/auth/login')) {
      return Promise.reject(error);
    }
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const shouldRefresh = status === 401 || code === 40101;
    if (!shouldRefresh || (original as InternalAxiosRequestConfig & { _retry?: boolean })._retry) {
      return Promise.reject(error);
    }
    (original as InternalAxiosRequestConfig & { _retry?: boolean })._retry = true;
    console.warn('[auth-kick] 收到 401/40101，尝试 refresh', {
      url: original.url,
      method: original.method,
      status,
      code,
      message: error.response?.data?.message,
    });
    const newToken = await refreshAccessToken();
    if (!newToken) {
      recordAuthKick({
        client: 'main',
        triggerUrl: original.url,
        triggerMethod: original.method?.toUpperCase(),
        httpStatus: status,
        bizCode: code,
        bizMessage: error.response?.data?.message,
        refreshError: lastRefreshError ?? undefined,
      });
      window.location.href = '/login';
      return Promise.reject(error);
    }
    original.headers.Authorization = `Bearer ${newToken}`;
    return api(original);
  },
);

export default api;
