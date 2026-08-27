import api from '@/lib/api/client';
import type { ApiResult, PostTypeTreeNode } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

/**
 * 岗位类型树：GET /api/v1/post-types/tree（BFF 透传 mis-org /internal/v1/post-types/tree）。
 *
 * <p>后端按 parent_id 递归组装树，返回 {@link PostTypeTreeNode} 数组（顶层 parentId=0）。
 * status 可选：null=全量含禁用，1=仅启用（岗位表单仅末级可选，且通常只显示启用）。
 */
export async function listPostTypeTree(status?: number): Promise<PostTypeTreeNode[]> {
  const res = await api.get<ApiResult<PostTypeTreeNode[]>>('/post-types/tree', { params: { status } });
  return unwrap(res, '获取岗位类型树失败');
}
