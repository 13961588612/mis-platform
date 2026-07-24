import api from '@/lib/api/client';
import type { ApiResult, CaptchaResponse, LoginRequest, LoginResponse } from '@/types/api';

export async function fetchCaptcha(): Promise<CaptchaResponse> {
  const res = await api.get<ApiResult<CaptchaResponse>>('/auth/captcha');
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '获取验证码失败');
  }
  return res.data.data;
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const res = await api.post<ApiResult<LoginResponse>>('/auth/login', payload);
  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '登录失败');
  }
  return res.data.data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', {});
  } finally {
    // 无论后端是否成功，前端都清本地会话
  }
}

export async function changePassword(payload: {
  oldPassword: string;
  newPassword: string;
}): Promise<void> {
  const res = await api.put<ApiResult<null>>('/auth/password', payload);
  if (res.data.code !== 0) {
    throw new Error(res.data.message || '修改密码失败');
  }
}
