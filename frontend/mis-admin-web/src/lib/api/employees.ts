import api from '@/lib/api/client';
import type { ApiResult, EmployeeItem } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface EmployeeQuery {
  realName?: string;
  deptId?: string | number;
  status?: number;
}

/** 单个岗位任职项（提交用：postId + isPrimary + startDate） */
export interface EmployeePostPayload {
  postId: number;
  isPrimary: number;
  startDate: string | null;
}

export interface EmployeeCreatePayload {
  deptId: number;
  deptIds: number[];
  employeeNo: string;
  realName: string;
  email?: string;
  phone?: string;
  gender?: number;
  title?: string;
  hireDate?: string;
  posts?: EmployeePostPayload[];
}

export interface EmployeeUpdatePayload {
  realName: string;
  email?: string;
  phone?: string;
  gender?: number;
  title?: string;
  deptId?: number;
  deptIds?: number[];
  posts?: EmployeePostPayload[];
  hireDate?: string;
  status?: number;
}

export async function listEmployees(query: EmployeeQuery = {}): Promise<EmployeeItem[]> {
  const res = await api.get<ApiResult<EmployeeItem[]>>('/employees', { params: query });
  return unwrap(res, '获取员工列表失败');
}

export async function getEmployee(id: string): Promise<EmployeeItem> {
  const res = await api.get<ApiResult<EmployeeItem>>(`/employees/${id}`);
  return unwrap(res, '获取员工失败');
}

export async function createEmployee(body: EmployeeCreatePayload): Promise<EmployeeItem> {
  const res = await api.post<ApiResult<EmployeeItem>>('/employees', body);
  return unwrap(res, '创建员工失败');
}

export async function updateEmployee(id: string, body: EmployeeUpdatePayload): Promise<EmployeeItem> {
  const res = await api.put<ApiResult<EmployeeItem>>(`/employees/${id}`, body);
  return unwrap(res, '更新员工失败');
}

export async function deleteEmployee(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/employees/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除员工失败');
}
