import api from '@/lib/api/client';
import type { ApiResult, PageResult, UserView, EmployeePhoneMatch } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
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
