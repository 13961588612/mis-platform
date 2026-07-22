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

export interface MeResponse {
  id: string;
  username: string;
  realName: string;
  avatarUrl: string | null;
  roles: string[];
  permVersion: number;
  permissions: string[];
}

export interface RouterNode {
  id: string;
  name: string;
  path: string;
  component: string | null;
  meta: { title: string; icon?: string | null; permission?: string | null };
  children?: RouterNode[] | null;
}

/** runtime: 'host'（单体托管） | 'iframe'（远程页面直嵌） | 'remote'（未来微前端） */
export interface AppItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  icon: string | null;
  basePath: string | null;
  description: string | null;
  portalGroup: string | null;
  kind: string;
  runtime: string;
  sort: number;
  status: number;
  enterable: boolean;
}

export interface DashboardStats {
  userCount: number;
  orgCount: number;
  todayLoginCount: number;
  onlineUserCount: number;
}

export interface PageResult<T> {
  page: number;
  size: number;
  total: number;
  list: T[];
}
