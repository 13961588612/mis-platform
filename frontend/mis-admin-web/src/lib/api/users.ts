import api from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { ApiResult, PageResult, UserView, EmployeePhoneMatch } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    // 抛出结构化错误，携带后端业务码（T6：字段级红字按 code 映射）
    throw new ApiError(res.data.code, res.data.message || fallback);
  }
  return res.data.data;
}

export interface UserPageQuery {
  page?: number;
  size?: number;
  status?: number;
  /** 用户名模糊 */
  username?: string;
  /** 姓名模糊（对齐后端 realName LIKE） */
  realName?: string;
  /** 手机号精确/模糊 */
  phone?: string;
  /** 组织多选 */
  orgIds?: number[];
  /** 部门多选 */
  deptIds?: number[];
  /** 所属 APP 多选（跨 APP 查询，D2：为空=查全部 APP） */
  appIds?: number[];
}

/** 员工绑定预检返回（D1）：该员工是否已在指定 APP 内被其他账号绑定 */
export interface EmployeeBindingCheck {
  exists: boolean;
}

export async function pageUsers(query: UserPageQuery = {}): Promise<PageResult<UserView>> {
  const params: Record<string, unknown> = {
    page: query.page ?? 1,
    size: query.size ?? 20,
  };
  if (query.status !== undefined) params.status = query.status;
  if (query.username) params.username = query.username;
  if (query.realName) params.realName = query.realName;
  if (query.phone) params.phone = query.phone;
  if (query.orgIds && query.orgIds.length) params.orgIds = query.orgIds.join(',');
  if (query.deptIds && query.deptIds.length) params.deptIds = query.deptIds.join(',');
  if (query.appIds && query.appIds.length) params.appIds = query.appIds.join(',');
  const res = await api.get<ApiResult<PageResult<UserView>>>('/users', { params });
  return unwrap(res, '获取用户列表失败');
}

export async function getUser(id: string): Promise<UserView> {
  const res = await api.get<ApiResult<UserView>>(`/users/${id}`);
  return unwrap(res, '获取用户失败');
}

export async function createUser(body: {
  username: string;
  realName: string;
  /** 所属 APP（显式提交，不再取登录态，D1/D2） */
  appId?: number;
  /** 绑定员工 ID；非员工用户不传 */
  employeeId?: number;
  email?: string;
  phone?: string;
  roleIds?: number[];
  password?: string;
  /** 归属组织（非员工用户可选） */
  orgIds?: number[];
  /** 归属部门（非员工用户可选） */
  deptIds?: number[];
}): Promise<UserView> {
  const res = await api.post<ApiResult<UserView>>('/users', body);
  return unwrap(res, '创建用户失败');
}

export async function updateUser(
  id: string,
  body: {
    username: string;
    /** 所属 APP（显式提交，D4 改 APP 守卫） */
    appId?: number | null;
    /** 绑定员工 ID；换绑传新值，解绑传 null，未变更可省略（Req2） */
    employeeId?: number | null;
    realName?: string;
    email?: string;
    phone?: string;
    status?: number;
    orgIds?: number[];
    deptIds?: number[];
  },
): Promise<UserView> {
  const res = await api.put<ApiResult<UserView>>(`/users/${id}`, body);
  return unwrap(res, '更新用户失败');
}

/** 员工绑定预检（D1）：该员工是否已在指定 APP 内被其他账号绑定；编辑时传 excludeUserId 排除自身。 */
export async function checkEmployeeBinding(
  appId: number,
  employeeId: number,
  excludeUserId?: string,
): Promise<EmployeeBindingCheck> {
  const params: Record<string, unknown> = { appId, employeeId };
  if (excludeUserId) params.excludeUserId = excludeUserId;
  const res = await api.get<ApiResult<EmployeeBindingCheck>>('/users/check-employee-binding', { params });
  return unwrap(res, '校验员工绑定失败');
}

export async function updateUserStatus(id: string, status: number): Promise<UserView> {
  const res = await api.put<ApiResult<UserView>>(`/users/${id}/status`, { status });
  return unwrap(res, '更新状态失败');
}

export async function resetUserPassword(id: string): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/users/${id}/reset-password`);
  if (res.data.code !== 0) throw new Error(res.data.message || '重置密码失败');
}

export async function deleteUser(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/users/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除用户失败');
}

export async function assignUserRoles(id: string, roleIds: number[]): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/users/${id}/roles`, { roleIds });
  if (res.data.code !== 0) throw new Error(res.data.message || '分配角色失败');
}

/** 按手机查员工（新建用户时检测是否已存在员工，Req2）。 */
export async function listEmployeesByPhone(phone: string): Promise<EmployeePhoneMatch[]> {
  const res = await api.get<ApiResult<EmployeePhoneMatch[]>>('/users/employees/by-phone', {
    params: { phone },
  });
  return unwrap(res, '查询员工失败');
}
