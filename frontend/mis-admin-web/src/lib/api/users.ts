import api from '@/lib/api/client';
import type { ApiResult, PageResult, UserView } from '@/types/api';

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
  username?: string;
  deptId?: string | number;
}

export async function pageUsers(query: UserPageQuery = {}): Promise<PageResult<UserView>> {
  const res = await api.get<ApiResult<PageResult<UserView>>>('/users', { params: query });
  return unwrap(res, '获取用户列表失败');
}

export async function getUser(id: string): Promise<UserView> {
  const res = await api.get<ApiResult<UserView>>(`/users/${id}`);
  return unwrap(res, '获取用户失败');
}

export async function createUser(body: {
  username: string;
  realName: string;
  deptId: number;
  employeeNo: string;
  email?: string;
  phone?: string;
  roleIds?: number[];
  password?: string;
}): Promise<UserView> {
  const res = await api.post<ApiResult<UserView>>('/users', body);
  return unwrap(res, '创建用户失败');
}

export async function updateUser(
  id: string,
  body: {
    username: string;
    realName?: string;
    email?: string;
    phone?: string;
    status?: number;
    orgId?: string;
    deptId?: string | number;
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
