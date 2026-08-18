import api from '@/lib/api/client';
import type { ApiResult, ConfigItem } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface ConfigCreatePayload {
  configKey: string;
  configValue: string;
  remark?: string;
}

export interface ConfigUpdatePayload {
  configValue: string;
  remark?: string;
}

export async function listConfigs(): Promise<ConfigItem[]> {
  const res = await api.get<ApiResult<ConfigItem[]>>('/configs');
  return unwrap(res, '获取系统参数失败');
}

export async function getConfig(id: string): Promise<ConfigItem> {
  const res = await api.get<ApiResult<ConfigItem>>(`/configs/${id}`);
  return unwrap(res, '获取系统参数失败');
}

export async function getConfigByKey(key: string): Promise<ConfigItem | null> {
  const res = await api.get<ApiResult<ConfigItem>>(`/configs/key/${encodeURIComponent(key)}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '获取系统参数失败');
  return res.data.data ?? null;
}

export async function createConfig(body: ConfigCreatePayload): Promise<ConfigItem> {
  const res = await api.post<ApiResult<ConfigItem>>('/configs', body);
  return unwrap(res, '创建系统参数失败');
}

export async function updateConfig(id: string, body: ConfigUpdatePayload): Promise<ConfigItem> {
  const res = await api.put<ApiResult<ConfigItem>>(`/configs/${id}`, body);
  return unwrap(res, '更新系统参数失败');
}

export async function deleteConfig(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/configs/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除系统参数失败');
}
