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
  /**
   * 关联流程实例 ID（无关联时为 `null`）。由 V134 新增列 `sys_message.instance_id` 透出。
   * 门户消息抽屉据此判定「流程通知形态」（展示只读表单 + 回复区）还是「普通消息形态」。
   */
  instanceId: string | null;
  /**
   * 是否可回复（后端口径：`msgType==='NOTIFY' && instanceId!=null`）。
   * 前端**仅据此**控制回复入口显隐，不自行推断（避免与后端口径漂移）。
   */
  canReply: boolean;
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

/**
 * 回复流程通知消息（T02 新增端点 `POST /api/v1/messages/{id}/reply`）。
 *
 * <p>后端编排归属 `ProcessService.replyToMessage`：把回复内容作为一条
 * `wf_history(operation='COMMENT')` 追加到关联流程实例，故回复会出现在
 * `GET /workflow/instances/{id}` 的 history（审批信息区）里。
 *
 * <p>`tenantId`/`operatorId`/`operatorName` 均为查询参数（后端 `required=false`，
 * 由 BFF 网关身份兜底），body 为 `{ content }`。
 */
export async function replyMessage(
  id: string,
  tenantId: string,
  operatorId: string,
  operatorName: string,
  content: string,
): Promise<void> {
  const res = await api.post<ApiResult<null>>(
    `/messages/${id}/reply`,
    { content },
    { params: { tenantId, operatorId, operatorName } },
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '回复失败');
}