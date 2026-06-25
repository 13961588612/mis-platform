import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResult, TokenResponse } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';

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

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = api
      .post<ApiResult<TokenResponse>>('/auth/refresh', {})
      .then((res) => {
        if (res.data.code !== 0 || !res.data.data) {
          throw new Error(res.data.message || 'refresh failed');
        }
        const { accessToken, expiresIn } = res.data.data;
        useAuthStore.getState().setAccessToken(accessToken, expiresIn);
        return accessToken;
      })
      .catch(() => {
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
    const newToken = await refreshAccessToken();
    if (!newToken) {
      window.location.href = '/login';
      return Promise.reject(error);
    }
    original.headers.Authorization = `Bearer ${newToken}`;
    return api(original);
  },
);

export default api;
