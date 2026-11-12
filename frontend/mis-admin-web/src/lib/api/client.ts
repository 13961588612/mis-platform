import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResult } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { recordAuthKick } from '@/lib/auth/auth-kick-log';
import { getLastRefreshError, refreshAccessToken } from '@/lib/auth/refresh-token';

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
        refreshError: getLastRefreshError() ?? undefined,
      });
      window.location.href = '/login';
      return Promise.reject(error);
    }
    original.headers.Authorization = `Bearer ${newToken}`;
    return api(original);
  },
);

export default api;
