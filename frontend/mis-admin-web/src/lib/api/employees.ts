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
  /** 手机号精确匹配（透传 GET /employees?phone=） */
  phone?: string;
  deptId?: string | number;
  /** 多部门过滤（员工管理增强）：数组经逗号序列化透传后端 deptIds（与 orgIds 取交集） */
  deptIds?: (string | number)[] | string;
  /** 多组织过滤（员工管理增强）：经部门 org_id 反查，与 deptIds 取交集 */
  orgIds?: (string | number)[] | string;
  status?: number;
}

/** 将数组参数逗号序列化；空数组/空值过滤掉，保持与后端契约一致。 */
function toParams(query: EmployeeQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.realName?.trim()) params.realName = query.realName.trim();
  if (query.phone?.trim()) params.phone = query.phone.trim();
  if (query.deptId !== undefined && query.deptId !== '' && query.deptId != null) {
    params.deptId = query.deptId;
  }
  const deptIds = joinIds(query.deptIds);
  if (deptIds) params.deptIds = deptIds;
  const orgIds = joinIds(query.orgIds);
  if (orgIds) params.orgIds = orgIds;
  if (query.status !== undefined && query.status != null) params.status = query.status;
  return params;
}

function joinIds(ids: EmployeeQuery['deptIds']): string | undefined {
  if (ids == null || ids === '') return undefined;
  if (typeof ids === 'string') return ids;
  if (ids.length === 0) return undefined;
  return ids.map(Number).join(',');
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
  /** 是否内置账号：1=内置（手机号必填/唯一校验豁免，EMP-03，Q2 推荐方案）；默认 0 */
  isBuiltin?: number;
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
  /** 是否内置账号：1=内置（手机号必填/唯一校验豁免，EMP-03，Q2 推荐方案） */
  isBuiltin?: number;
}

export async function listEmployees(query: EmployeeQuery = {}): Promise<EmployeeItem[]> {
  const res = await api.get<ApiResult<EmployeeItem[]>>('/employees', { params: toParams(query) });
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
