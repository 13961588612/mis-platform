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

export interface RoleBrief {
  id: string;
  name: string;
  code: string;
}

export interface UserView {
  id: string;
  username: string;
  realName: string | null;
  employeeNo: string | null;
  employeeId: string | null;
  deptId: string | null;
  deptName: string | null;
  orgId: string | null;
  orgName: string | null;
  email: string | null;
  phone: string | null;
  status: number;
  isTenantAdmin: number | null;
  roles: RoleBrief[];
  createdAt: string | null;
}

export interface OrgItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  sort: number;
  status: number;
  remark: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DeptNode {
  id: string;
  tenantId: string;
  orgId: string;
  parentId: string;
  code: string;
  name: string;
  categoryId: string | null;
  ancestors: string | null;
  sort: number;
  status: number;
  isRoot: number | null;
  leaderEmployeeId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  children?: DeptNode[] | null;
}

export interface RoleItem {
  id: string;
  tenantId: string;
  appId: string;
  code: string;
  name: string;
  type: number;
  dataScope: number;
  status: number;
  remark: string | null;
  createdAt: string | null;
}

export interface MenuNode {
  id: string;
  tenantId: string;
  appId: string;
  parentId: string;
  code: string;
  name: string;
  type: number;
  path: string | null;
  component: string | null;
  permission: string | null;
  icon: string | null;
  sort: number;
  visible: number;
  status: number;
  children?: MenuNode[] | null;
  apiList?: MenuApiItem[] | null;
}

export interface MenuApiItem {
  apiId: string;
  method: string;
  path: string;
}

/** 单个菜单已绑定接口的明细（GET /menus/{menuId}/apis 响应元素） */
export interface MenuApiBindingItem {
  apiId: string;
  name: string;
  method: string;
  path: string;
}

export interface DictTypeItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  status: number;
  remark: string | null;
}

export interface DictItem {
  id: string;
  typeId: string;
  label: string;
  value: string;
  sort: number;
  status: number;
  cssClass: string | null;
}

export interface OperLogItem {
  id: string;
  tenantId: string;
  userId: string | null;
  username: string | null;
  module: string | null;
  operation: string | null;
  method: string | null;
  requestUri: string | null;
  requestMethod: string | null;
  responseCode: number | null;
  durationMs: number | null;
  ip: string | null;
  requestParams: string | null;
  operTime: string | null;
}

export interface LoginLogItem {
  id: string;
  tenantId: string;
  appId: string;
  userId: string | null;
  username: string;
  ip: string | null;
  userAgent: string | null;
  status: number;
  msg: string | null;
  loginAt: string | null;
}

/** 菜单/按钮类型（对齐后端 MenuType：1 目录 / 2 菜单 / 3 按钮） */
export const MenuType = {
  CATALOG: 1,
  MENU: 2,
  BUTTON: 3,
} as const;

/** 平台业务模块（sys_module） */
export interface ModuleItem {
  id: string;
  code: string;
  name: string;
  serviceName: string;
  sort: number;
  status: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 模块下接口树节点（sys_api，catalog/api 自引用） */
export interface ModuleApiNode {
  id: string;
  moduleId: string;
  parentId: string;
  code: string;
  type: string;
  name: string;
  httpMethod: string | null;
  pathPattern: string | null;
  sort: number;
  status: number;
  children?: ModuleApiNode[] | null;
}

/** 模块下「接口 ↔ 菜单」绑定关系 */
export interface ModuleApiBinding {
  menuId: string;
  menuName: string;
  permission: string | null;
  apiId: string;
  apiName: string;
  httpMethod: string | null;
  pathPattern: string | null;
}
