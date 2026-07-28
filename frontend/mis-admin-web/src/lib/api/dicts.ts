import api from '@/lib/api/client';
import type { ApiResult, DictItem, DictTypeItem, LoginLogItem, OperLogItem, PageResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export async function listDictTypes(): Promise<DictTypeItem[]> {
  const res = await api.get<ApiResult<DictTypeItem[]>>('/dicts/types');
  return unwrap(res, '获取字典类型失败');
}

export async function createDictType(body: {
  code: string;
  name: string;
  remark?: string;
}): Promise<DictTypeItem> {
  const res = await api.post<ApiResult<DictTypeItem>>('/dicts/types', body);
  return unwrap(res, '创建字典类型失败');
}

export async function updateDictType(
  id: string,
  body: { name: string; status?: number; remark?: string },
): Promise<DictTypeItem> {
  const res = await api.put<ApiResult<DictTypeItem>>(`/dicts/types/${id}`, body);
  return unwrap(res, '更新字典类型失败');
}

export async function deleteDictType(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/dicts/types/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除字典类型失败');
}

export async function listDictItems(typeId: string | number): Promise<DictItem[]> {
  const res = await api.get<ApiResult<DictItem[]>>('/dicts/items', { params: { typeId } });
  return unwrap(res, '获取字典项失败');
}

export async function createDictItem(body: {
  typeId: number;
  label: string;
  value: string;
  sort?: number;
  cssClass?: string;
}): Promise<DictItem> {
  const res = await api.post<ApiResult<DictItem>>('/dicts/items', body);
  return unwrap(res, '创建字典项失败');
}

export async function updateDictItem(
  id: string,
  body: { label: string; value: string; sort?: number; status?: number; cssClass?: string },
): Promise<DictItem> {
  const res = await api.put<ApiResult<DictItem>>(`/dicts/items/${id}`, body);
  return unwrap(res, '更新字典项失败');
}

export async function deleteDictItem(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/dicts/items/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除字典项失败');
}

export async function pageOperLogs(params: {
  page?: number;
  size?: number;
  module?: string;
  username?: string;
}): Promise<PageResult<OperLogItem>> {
  const res = await api.get<ApiResult<PageResult<OperLogItem>>>('/audit/oper-logs', { params });
  return unwrap(res, '获取操作日志失败');
}

export async function pageLoginLogs(params: {
  page?: number;
  size?: number;
  username?: string;
  status?: number;
}): Promise<PageResult<LoginLogItem>> {
  const res = await api.get<ApiResult<PageResult<LoginLogItem>>>('/audit/login-logs', { params });
  return unwrap(res, '获取登录日志失败');
}
