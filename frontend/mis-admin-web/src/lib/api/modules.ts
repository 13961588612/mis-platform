import api from '@/lib/api/client';
import type { ApiResult, ModuleItem, ModuleApiNode, ModuleApiBinding } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export async function fetchModules(): Promise<ModuleItem[]> {
  const res = await api.get<ApiResult<ModuleItem[]>>('/modules');
  return unwrap(res, '获取模块列表失败');
}

export async function createModule(body: {
  code: string;
  name: string;
  serviceName: string;
  sort?: number;
}): Promise<ModuleItem> {
  const res = await api.post<ApiResult<ModuleItem>>('/modules', body);
  return unwrap(res, '创建模块失败');
}

export async function updateModule(
  id: string,
  body: { name: string; serviceName: string; sort?: number; status?: number },
): Promise<ModuleItem> {
  const res = await api.put<ApiResult<ModuleItem>>(`/modules/${id}`, body);
  return unwrap(res, '更新模块失败');
}

export async function deleteModule(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/modules/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除模块失败');
}

export async function fetchModuleApiTree(moduleId: string | number): Promise<ModuleApiNode[]> {
  const res = await api.get<ApiResult<ModuleApiNode[]>>(`/modules/${moduleId}/apis`);
  return unwrap(res, '获取接口树失败');
}

export async function fetchModuleBindings(moduleId: string | number): Promise<ModuleApiBinding[]> {
  const res = await api.get<ApiResult<ModuleApiBinding[]>>(`/modules/${moduleId}/bindings`);
  return unwrap(res, '获取绑定关系失败');
}

export async function createModuleApi(body: {
  moduleId: string | number;
  parentId?: number;
  code: string;
  type: string;
  name: string;
  httpMethod?: string | null;
  pathPattern?: string | null;
  sort?: number;
  status?: number;
}): Promise<ModuleApiNode> {
  const res = await api.post<ApiResult<ModuleApiNode>>(`/modules/${body.moduleId}/apis`, body);
  return unwrap(res, '创建接口失败');
}

export async function updateModuleApi(
  id: string,
  body: {
    parentId?: number;
    code: string;
    type: string;
    name: string;
    httpMethod?: string | null;
    pathPattern?: string | null;
    sort?: number;
    status?: number;
  },
): Promise<ModuleApiNode> {
  const res = await api.put<ApiResult<ModuleApiNode>>(`/modules/apis/${id}`, body);
  return unwrap(res, '更新接口失败');
}

export async function deleteModuleApi(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/modules/apis/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除接口失败');
}
