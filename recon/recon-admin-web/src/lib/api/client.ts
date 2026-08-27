import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { toast } from 'sonner';
import type { ApiResponse } from '@/types/api';
import { clearSession } from '@/stores/auth-store';

/** 业务错误（code ≠ 0），message 可直接展示 */
export class BizError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'BizError';
    this.code = code;
  }
}

/** 网络/HTTP 错误统一包装 */
export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** 认证相关业务码（与后端 ErrorCode / 平台 ResultCode 对齐）：未认证 / 过期 / 无效 */
const AUTH_CODES = [40100, 40101, 40104];

/** 平台 JWT（micro-app 嵌入时由壳子下发；独立运行无认证） */
let authToken: string | null = null;

/** 设置/清除认证令牌（壳子经 microApp.setData 下发后写入） */
export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** 401 联动（防抖）：壳内跳壳子登录页；独立运行提示改走平台（避免并发请求多次跳转） */
let authRedirecting = false;
function handleUnauthorized(message: string) {
  if (authRedirecting) return;
  authRedirecting = true;
  setAuthToken(null);
  clearSession();
  const inShell = !!window.__MICRO_APP_ENVIRONMENT__ && !!window.microApp?.router;
  if (inShell) {
    toast.error(message || '登录已过期，请重新登录');
    window.microApp?.router?.push('/login');
  } else {
    toast.error('登录状态不可用：请通过平台（mis-admin）访问本应用', { duration: 6000 });
  }
}

const instance = axios.create({
  baseURL: '/api/v1/recon',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// 注入平台 JWT；无令牌时不携带（recon-service 未加认证时后端不校验）
instance.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

instance.interceptors.response.use(
  (res) => {
    const body = res.data as ApiResponse<unknown>;
    if (body.code !== 0) {
      // HTTP 200 但业务返回认证码（后端部分路径直接回 ApiResponse）→ 同样触发 401 联动
      if (AUTH_CODES.includes(body.code)) {
        handleUnauthorized(body.message || '未认证');
      }
      return Promise.reject(new BizError(body.code, body.message || `业务错误 ${body.code}`));
    }
    return body.data as never;
  },
  (err: AxiosError<{ code?: number; message?: string }>) => {
    const respCode = err.response?.data?.code;
    // HTTP 401（JwtAuthFilter 拦截）或业务 401xx → 触发 401 联动
    if (err.response?.status === 401 || (respCode !== undefined && AUTH_CODES.includes(respCode))) {
      handleUnauthorized(err.response?.data?.message ?? '未认证');
    }
    if (err.response?.data?.message) {
      return Promise.reject(new ApiError(err.response.data.message, err.response.status));
    }
    if (err.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError('请求超时，请检查后端服务是否启动', 0));
    }
    return Promise.reject(new ApiError(err.message || '网络错误', err.response?.status));
  }
);

/**
 * 统一 HTTP 客户端：响应拦截器已解包 data，泛型直接指向业务数据类型。
 * get/post/put/delete 均返回 Promise<T>（非 AxiosResponse<T>）。
 */
export const client = {
  get: <T>(url: string, config?: AxiosRequestConfig) => instance.get(url, config) as Promise<T>,
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    instance.post(url, data, config) as Promise<T>,
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    instance.put(url, data, config) as Promise<T>,
  delete: <T>(url: string, config?: AxiosRequestConfig) => instance.delete(url, config) as Promise<T>,
};

/** 统一错误信息提取（页面 catch 后 toast 用） */
export function errMsg(e: unknown): string {
  if (e instanceof BizError || e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
