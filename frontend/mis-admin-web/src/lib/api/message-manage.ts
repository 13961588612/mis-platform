import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface MessageAudienceInput {
  all: boolean;
  userIds: string[];
  deptIds: string[];
  postTypeIds: string[];
}

export interface MessageFileItem {
  fileId: string;
  name: string;
  size: number;
  mime: string;
}

export interface SentMessageItem {
  id: string;
  title: string;
  summary: string | null;
  senderName: string | null;
  audience: string | null;
  readCount: number;
  totalCount: number;
  createdAt: string;
}

export interface SentReceiver {
  userId: string;
  name: string | null;
  read: boolean;
}

export interface SentMessageDetail {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  attachments: string | null;
  audience: string | null;
  senderName: string | null;
  readCount: number;
  totalCount: number;
  receiversTruncated: boolean;
  receivers: SentReceiver[];
  createdAt: string;
}

function audienceBody(input: MessageAudienceInput, extra?: Record<string, unknown>) {
  return {
    all: input.all,
    userIds: input.userIds.map((id) => id),
    deptIds: input.deptIds,
    postTypeIds: input.postTypeIds,
    ...extra,
  };
}

export async function previewMessageAudience(input: MessageAudienceInput): Promise<number> {
  const res = await api.post<ApiResult<{ count: number }>>('/messages/manage/preview', audienceBody(input));
  return unwrap(res, '预览接收人数失败').count;
}

export async function sendManagedMessage(input: MessageAudienceInput & {
  title: string;
  summary?: string;
  contentHtml?: string;
  attachmentFileIds: string[];
}): Promise<string> {
  const res = await api.post<ApiResult<string>>('/messages/manage/send', audienceBody(input, {
    title: input.title,
    summary: input.summary,
    contentHtml: input.contentHtml,
    attachmentFileIds: input.attachmentFileIds,
  }));
  return String(unwrap(res, '发送失败'));
}

export async function uploadMessageFile(file: File, kind: 'file' | 'image'): Promise<MessageFileItem> {
  const body = new FormData();
  body.append('file', file);
  const res = await api.post<ApiResult<MessageFileItem>>('/messages/manage/files', body, {
    params: { kind },
    timeout: 60000,
  });
  return unwrap(res, '上传失败');
}

export async function fetchSentMessages(page: number, size: number): Promise<PageResult<SentMessageItem>> {
  const res = await api.get<ApiResult<PageResult<SentMessageItem>>>('/messages/manage/sent', { params: { page, size } });
  return unwrap(res, '加载发送记录失败');
}

export async function fetchSentMessageDetail(id: string): Promise<SentMessageDetail> {
  const res = await api.get<ApiResult<SentMessageDetail>>(`/messages/manage/sent/${id}`);
  return unwrap(res, '加载发送详情失败');
}

export async function downloadMessageFile(fileId: string): Promise<Blob> {
  const res = await api.get<Blob>(`/messages/files/${fileId}`, { responseType: 'blob', timeout: 60000 });
  return res.data;
}

export function audienceLabel(raw: string | null): string {
  if (!raw) return '—';
  try {
    const parsed = JSON.parse(raw) as {
      all?: boolean;
      userIds?: string[];
      deptIds?: string[];
      postTypeIds?: string[];
    };
    const parts: string[] = [];
    if (parsed.all) parts.push('全员');
    if (parsed.deptIds?.length) parts.push(`部门 ${parsed.deptIds.length}`);
    if (parsed.postTypeIds?.length) parts.push(`岗位类型 ${parsed.postTypeIds.length}`);
    if (parsed.userIds?.length) parts.push(`指定 ${parsed.userIds.length}`);
    return parts.length ? parts.join('、') : '—';
  } catch {
    return '—';
  }
}
