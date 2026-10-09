import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface MessageItem {
  id: string;
  tenantId: string;
  msgType: string;
  category: string;
  title: string;
  summary: string | null;
  senderId: string | null;
  senderName: string | null;
  referenceTaskId: string | null;
  receiverGroupType: string;
  read: boolean;
  readCount: number;
  totalCount: number;
  createdAt: string;
}

export interface MessageDetail extends MessageItem {
  content: string | null;
  attachments: string | null;
  receiverUserIds: string[];
}

export interface MessageStats {
  unread: number;
  total: number;
}

export interface MessageQuery {
  tenantId: string;
  userId: string;
  msgType?: string;
  page?: number;
  size?: number;
}

export async function fetchInbox(params: MessageQuery): Promise<PageResult<MessageItem>> {
  const res = await api.get<ApiResult<PageResult<MessageItem>>>('/messages/inbox', { params });
  return unwrap(res, '获取收件箱失败');
}

export async function searchMessages(
  params: MessageQuery & { q: string },
): Promise<PageResult<MessageItem>> {
  const res = await api.get<ApiResult<PageResult<MessageItem>>>('/messages/search', { params });
  return unwrap(res, '搜索消息失败');
}

export async function fetchMessageDetail(id: string, userId: string): Promise<MessageDetail> {
  const res = await api.get<ApiResult<MessageDetail>>(`/messages/${id}`, { params: { userId } });
  return unwrap(res, '获取消息详情失败');
}

export async function markMessagesRead(userId: string, ids: string[]): Promise<number> {
  const res = await api.post<ApiResult<number>>('/messages/read', { ids }, { params: { userId } });
  return unwrap(res, '标记已读失败');
}

export async function fetchMessageStats(tenantId: string, userId: string): Promise<MessageStats> {
  const res = await api.get<ApiResult<MessageStats>>('/messages/stats', { params: { tenantId, userId } });
  return unwrap(res, '获取消息统计失败');
}