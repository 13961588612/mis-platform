import api from '@/lib/api/client';
import type { ApiResult, DeptTypeItem, DeptTypeTreeNode } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

/**
 * 部门类型列表：GET /api/v1/dept-types（BFF 透传 mis-org /internal/v1/dept-types）。
 *
 * <p>status 可选：null=全量含禁用，1=仅启用；返回含 referenceCount（删除拦截依据）。
 */
export async function listDeptTypes(status?: number): Promise<DeptTypeItem[]> {
  const res = await api.get<ApiResult<DeptTypeItem[]>>('/dept-types', { params: { status } });
  return unwrap(res, '获取部门类型列表失败');
}

/**
 * 部门类型树：GET /api/v1/dept-types/tree（BFF 透传 mis-org /internal/v1/dept-types/tree）。
 *
 * <p>后端按 parent_id 递归组装树，返回 {@link DeptTypeTreeNode} 数组（顶层 parentId=0）。
 * status 可选：null=全量含禁用，1=仅启用（部门表单仅末级可选，且通常只显示启用）。
 */
export async function listDeptTypeTree(status?: number): Promise<DeptTypeTreeNode[]> {
  const res = await api.get<ApiResult<DeptTypeTreeNode[]>>('/dept-types/tree', { params: { status } });
  return unwrap(res, '获取部门类型树失败');
}

export interface DeptTypeCreateBody {
  code: string;
  name: string;
  sort?: number;
  status?: number;
  parentId?: number | null;
  isLeaf?: number;
}

export interface DeptTypeUpdateBody {
  name: string;
  sort?: number;
  status?: number;
  parentId?: number | null;
  isLeaf?: number;
}

/** 新增部门类型：POST /api/v1/dept-types（tenantId 由 BFF 注入）。 */
export async function createDeptType(body: DeptTypeCreateBody): Promise<DeptTypeItem> {
  const res = await api.post<ApiResult<DeptTypeItem>>('/dept-types', body);
  return unwrap(res, '创建部门类型失败');
}

/** 编辑部门类型：PUT /api/v1/dept-types/{id}（code 不可编辑）。 */
export async function updateDeptType(id: string, body: DeptTypeUpdateBody): Promise<DeptTypeItem> {
  const res = await api.put<ApiResult<DeptTypeItem>>(`/dept-types/${id}`, body);
  return unwrap(res, '更新部门类型失败');
}

/** 删除部门类型：DELETE /api/v1/dept-types/{id}（仅末级可删，有子/被引用硬拦截）。 */
export async function deleteDeptType(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/dept-types/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除部门类型失败');
}
