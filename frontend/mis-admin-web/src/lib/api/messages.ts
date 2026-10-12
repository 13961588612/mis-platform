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
  /**
   * 应用归属（`sys_app.code`）；`null` = 平台级。
   *
   * <p>对齐后端 `MessageVO.appCode`（末尾追加）。门户消息表「平台 / 关联应用」列据此取值：
   * `null` → 「平台」，否则经应用名映射取展示名。
   */
  appCode: string | null;
  /**
   * 业务类型（软引用 `biz_category.code`）；`null` = 未标注。
   *
   * <p>对齐后端 `MessageVO.bizType`（末尾追加）。门户消息表「业务类型」列据此取值：
   * `null` → 「—」，否则经业务分类映射取展示名、取不到回退原始 code。
   */
  bizType: string | null;
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
  /**
   * 应用归属过滤（P0）：`app_code` 等值目标。仅在 `scope='APP'` 时有意义；
   * 空白（null/undefined/纯空格）**不透传**（见下方 buildQuery）。
   */
  appCode?: string;
  /**
   * 归属范围（P0）：`ALL`（默认，不加条件）| `APP`（`app_code = appCode`）| `PLATFORM`（`app_code IS NULL`）。
   * 空白/未设置时**不透传** ⇒ 下游退化为原查询（零回归）。
   */
  scope?: string;
  page?: number;
  size?: number;
}

/**
 * 构造请求参数：`appCode` / `scope` 空白（null/undefined/纯空格）时**不带该 query**，
 * 退化为原查询（与 `tasks.ts` 的 `buildQuery` 同范式）。
 */
function buildQuery(params: MessageQuery & { q?: string }): Record<string, unknown> {
  const { appCode, scope, ...rest } = params;
  const out: Record<string, unknown> = { ...rest };
  const app = appCode?.trim();
  if (app) out.appCode = app;
  const sc = scope?.trim();
  if (sc) out.scope = sc;
  return out;
}

export async function fetchInbox(params: MessageQuery): Promise<PageResult<MessageItem>> {
  const res = await api.get<ApiResult<PageResult<MessageItem>>>('/messages/inbox', {
    params: buildQuery(params),
  });
  return unwrap(res, '获取收件箱失败');
}

export async function searchMessages(
  params: MessageQuery & { q: string },
): Promise<PageResult<MessageItem>> {
  const res = await api.get<ApiResult<PageResult<MessageItem>>>('/messages/search', {
    params: buildQuery(params),
  });
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