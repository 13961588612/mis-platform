export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
  traceId?: string;
}

export interface LoginRequest {
  appCode: string;
  username: string;
  password: string;
  captchaId: string;
  captchaCode: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  app: { id: string; code: string; name: string };
  user: {
    id: string;
    employeeId: string;
    username: string;
    realName: string;
    avatarUrl: string | null;
    deptId: string | null;
    deptName: string | null;
    roles: string[];
    mustChangePassword: boolean;
  };
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
}

export interface CaptchaResponse {
  captchaId: string;
  imageBase64: string;
}
