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
  /** 归属组织 id 列表（多组织，首项主组织）；用于权限 Sheet 正确回填（N7/USR-01/03） */
  orgIds?: string[];
  /** 归属部门 id 列表（多部门，首项主部门）；用于权限 Sheet 正确回填（N7/USR-01/03） */
  deptIds?: string[];
  createdAt: string | null;
}

export interface OrgItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  parentId: string;
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
  linkedOrgId: string | null;
  linkedOrgName: string | null;
  /** V54 部门类型 id（NULL=未设置） */
  deptTypeId?: string | null;
  /** V54 部门类型名（由后端解析，NULL=未知） */
  deptTypeName?: string | null;
  /** V54 部门编制数 / headcount 配额（NULL=0） */
  establishmentCount?: number | null;
  /** V54 是否末级（1=末级 / 0=非末级；后端按「有无子部门」计算） */
  isLeaf?: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  children?: DeptNode[] | null;
}

/** 组织穿透树节点（mis-org DeptPierceVO）：来源组织 + 锚点信息 */
export interface DeptPierceNode {
  id: string;
  orgId: string;
  orgName: string;
  parentId: string;
  code: string;
  name: string;
  /** V54 部门类型 id（与 DeptNode.deptTypeId 对齐） */
  deptTypeId?: string | null;
  /** V54 部门类型名（穿透只读行同样携带，与 tree 对齐） */
  deptTypeName?: string | null;
  sort: number;
  status: number;
  isRoot: number | null;
  linkedOrgId: string | null;
  linkedOrgName: string | null;
  children?: DeptPierceNode[] | null;
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

/** 员工任职岗位明细（mis-org EmployeePostVO：含岗位名/部门名/是否主岗/任职开始时间） */
export interface EmployeePostItem {
  postId: string;
  postName: string | null;
  deptId: string | null;
  deptName: string | null;
  /** V54 该任职部门所属组织名（脏数据/未挂载组织时为 null，UI 显示「—」） */
  orgName?: string | null;
  isPrimary: number;
  status: number;
  startDate: string | null;
}

/** 员工（mis-org EmployeeVO：含多部门 deptIds + 多岗位 posts） */
export interface EmployeeItem {
  id: string;
  tenantId: string;
  deptId: string;
  deptIds: string[];
  primaryDeptId: string;
  /** V54 主部门所属组织名（由 emp.deptId → dept → org 解析；脏数据/未挂载组织时为 null） */
  orgName?: string | null;
  posts: EmployeePostItem[];
  employeeNo: string;
  realName: string;
  email: string | null;
  phone: string | null;
  gender: number | null;
  title: string | null;
  hireDate: string | null;
  /** 是否内置账号：1=内置（手机号必填/唯一校验豁免，EMP-03，Q2 推荐方案）；0/undefined=普通 */
  isBuiltin?: number;
  status: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 岗位（mis-org PostVO：含 deptName/postTypeName） */
export interface PostItem {
  id: string;
  tenantId: string;
  deptId: string;
  deptName: string | null;
  /** R7：所属组织 id（与 deptId 对称；脏数据可能为 null） */
  orgId?: string;
  /** R7：所属组织名（与 deptName 对称；脏数据/未挂载组织时为 null，UI 显示「—」） */
  orgName?: string | null;
  postTypeId: string;
  postTypeName: string | null;
  code: string;
  name: string;
  sort: number;
  status: number;
  /** 计划编制人数（业务可选，默认 0） */
  quota?: number;
}

/** 岗位类型（mis-org PostTypeVO） */
export interface PostTypeItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  sort: number;
  status: number;
  /** sys_post 引用数（删除拦截依据） */
  referenceCount: number;
  parentId?: string;
  /** 1=末级 / 0=非末级（显式字段） */
  isLeaf?: number;
}

/**
 * 岗位类型树节点（mis-org PostTypeTreeNodeVO / BFF PostTypeTreeNodeVO 对齐）。
 *
 * <p>仅末级节点（isLeaf===1）可被岗位选作类型；非末级仅作分类。
 * isLeaf 为显式字段（创建/更新可写），不按是否有子节点推导。
 * children 递归。parentId 用于前端展示层级；树已后端构建完成，前端无需再按 parentId 组装。
 */
export interface PostTypeTreeNode {
  id: string;
  /** 编码（管理树表展示用，后端 VO 已携带） */
  code?: string;
  name: string;
  sort?: number;
  status?: number;
  /** sys_post 引用数（删除拦截依据） */
  referenceCount?: number;
  parentId: string;
  /** 1=末级（可选）/ 0=非末级（仅分类） */
  isLeaf: number;
  children?: PostTypeTreeNode[];
}

/** 部门类型（mis-org DeptTypeVO） */
export interface DeptTypeItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  sort: number;
  status: number;
  /** sys_dept 引用数（删除拦截依据） */
  referenceCount: number;
  parentId?: string;
  /** 1=末级 / 0=非末级（显式字段） */
  isLeaf?: number;
}

/**
 * 部门类型树节点（mis-org DeptTypeTreeNodeVO / BFF DeptTypeTreeNodeVO 对齐）。
 *
 * <p>仅末级节点（isLeaf===1）可被部门选作类型；非末级仅作分类。
 * isLeaf 为显式字段（创建/更新可写），不按是否有子节点推导。
 * children 递归。parentId 用于前端展示层级；树已后端构建完成，前端无需再按 parentId 组装。
 */
export interface DeptTypeTreeNode {
  id: string;
  /** 编码（管理树表展示用，后端 VO 已携带） */
  code?: string;
  name: string;
  sort?: number;
  status?: number;
  /** sys_dept 引用数（删除拦截依据） */
  referenceCount?: number;
  parentId: string;
  /** 1=末级（可选）/ 0=非末级（仅分类） */
  isLeaf: number;
  children?: DeptTypeTreeNode[];
}

/** 系统参数（mis-system ConfigVO，全局无 tenant） */
export interface ConfigItem {
  id: string;
  configKey: string;
  configValue: string;
  remark: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
