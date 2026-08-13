import api from '@/lib/api/client';
import type { ApiResult, PostItem, PostTypeItem } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface PostQuery {
  deptId?: string | number;
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
}

export async function listPosts(query: PostQuery = {}): Promise<PostItem[]> {
  const res = await api.get<ApiResult<PostItem[]>>('/posts', { params: query });
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

export async function listPostTypes(): Promise<PostTypeItem[]> {
  const res = await api.get<ApiResult<PostTypeItem[]>>('/post-types');
  return unwrap(res, '获取岗位类型失败');
}
