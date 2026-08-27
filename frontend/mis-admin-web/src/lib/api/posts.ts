import api from '@/lib/api/client';
import type { ApiResult, PostItem, PostTypeItem } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface PostQuery {
  /** 兼容单值部门过滤（保留，与后端 GET /posts 单 deptId 一致） */
  deptId?: string | number;
  /** 多部门过滤（POST-02）：数组经逗号序列化透传后端 deptIds */
  deptIds?: (string | number)[];
  /** 多组织过滤（POST-03）：数组经逗号序列化透传后端 orgIds（经部门 org_id 反查，精确匹配） */
  orgIds?: (string | number)[];
  postTypeId?: string | number;
  status?: number;
}

export interface PostPayload {
  deptId: number;
  postTypeId: number;
  code: string;
  name: string;
  sort?: number;
  status?: number;
  /** 计划编制人数（业务可选） */
  quota?: number;
}

/** 将数组参数逗号序列化；空数组/空值过滤掉，保持与后端契约一致。 */
function toParams(query: PostQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.deptId !== undefined && query.deptId !== '' && query.deptId != null) {
    params.deptId = query.deptId;
  }
  if (query.deptIds && query.deptIds.length > 0) {
    params.deptIds = query.deptIds.map(Number).join(',');
  }
  if (query.orgIds && query.orgIds.length > 0) {
    params.orgIds = query.orgIds.map(Number).join(',');
  }
  if (query.postTypeId !== undefined && query.postTypeId !== '' && query.postTypeId != null) {
    params.postTypeId = query.postTypeId;
  }
  if (query.status !== undefined && query.status != null) {
    params.status = query.status;
  }
  return params;
}

export async function listPosts(query: PostQuery = {}): Promise<PostItem[]> {
  const res = await api.get<ApiResult<PostItem[]>>('/posts', { params: toParams(query) });
  return unwrap(res, '获取岗位列表失败');
}

export async function getPost(id: string): Promise<PostItem> {
  const res = await api.get<ApiResult<PostItem>>(`/posts/${id}`);
  return unwrap(res, '获取岗位失败');
}

export async function createPost(body: PostPayload): Promise<PostItem> {
  const res = await api.post<ApiResult<PostItem>>('/posts', body);
  return unwrap(res, '创建岗位失败');
}

export async function updatePost(id: string, body: PostPayload): Promise<PostItem> {
  const res = await api.put<ApiResult<PostItem>>(`/posts/${id}`, body);
  return unwrap(res, '更新岗位失败');
}

export async function deletePost(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/posts/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除岗位失败');
}

/** 岗位类型全量（含禁用）+ referenceCount；status=1 仅启用（下拉用）。 */
export async function listPostTypes(status?: number): Promise<PostTypeItem[]> {
  const res = await api.get<ApiResult<PostTypeItem[]>>('/post-types', { params: { status } });
  return unwrap(res, '获取岗位类型失败');
}

export async function createPostType(body: {
  code: string;
  name: string;
  sort?: number;
  status?: number;
  /** 上级类型 id；0 / 不传 = 顶级（根分类） */
  parentId?: number | string | null;
  /** 1=末级 / 0=非末级（分类）；默认 1 */
  isLeaf?: number;
}): Promise<PostTypeItem> {
  const res = await api.post<ApiResult<PostTypeItem>>('/post-types', body);
  return unwrap(res, '创建岗位类型失败');
}

export async function updatePostType(
  id: string,
  body: {
    name: string;
    sort?: number;
    status?: number;
    parentId?: number | string | null;
    isLeaf?: number;
  },
): Promise<PostTypeItem> {
  const res = await api.put<ApiResult<PostTypeItem>>(`/post-types/${id}`, body);
  return unwrap(res, '更新岗位类型失败');
}

export async function deletePostType(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/post-types/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除岗位类型失败');
}
