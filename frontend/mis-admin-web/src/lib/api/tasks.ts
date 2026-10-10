import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface TaskItem {
  id: string;
  tenantId: string;
  taskType: string;
  bizType: string;
  bizRefId: string;
  bizTitle: string;
  targetEntity: string | null;
  assigneeId: string;
  assigneeName: string | null;
  status: string;
  priority: number;
  dueDate: string | null;
  metadata: string | null;
  result: string | null;
  read: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface TaskStats {
  pending: number;
  urgent: number;
  overdue: number;
}

export interface TaskQuery {
  tenantId: string;
  assigneeId: string;
  status?: string;
  /** 关键词模糊匹配（PR-04）；空白/空串**不透传**（见下方 buildQuery）。 */
  keyword?: string;
  page?: number;
  size?: number;
}

/** 构造请求参数：`keyword` 空白（null/undefined/纯空格）时**不带该 query**，退化为原查询。 */
function buildQuery(params: TaskQuery): Record<string, unknown> {
  const { keyword, ...rest } = params;
  const out: Record<string, unknown> = { ...rest };
  const kw = keyword?.trim();
  if (kw) out.keyword = kw;
  return out;
}

export async function fetchMyTasks(params: TaskQuery): Promise<PageResult<TaskItem>> {
  const res = await api.get<ApiResult<PageResult<TaskItem>>>('/tasks/my', { params: buildQuery(params) });
  return unwrap(res, '获取待办失败');
}

export async function fetchHandledTasks(params: TaskQuery): Promise<PageResult<TaskItem>> {
  const res = await api.get<ApiResult<PageResult<TaskItem>>>('/tasks/handled', { params: buildQuery(params) });
  return unwrap(res, '获取审批记录失败');
}

export async function fetchTaskStats(tenantId: string, assigneeId: string): Promise<TaskStats> {
  const res = await api.get<ApiResult<TaskStats>>('/tasks/stats', { params: { tenantId, assigneeId } });
  return unwrap(res, '获取待办统计失败');
}

export async function handleTask(
  id: string,
  tenantId: string,
  operatorId: string,
  action: string,
  comment?: string,
): Promise<void> {
  const res = await api.post<ApiResult<null>>(
    `/tasks/${id}/handle`,
    { action, comment },
    { params: { tenantId, operatorId } },
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '处理待办失败');
}

export async function transferTask(
  id: string,
  tenantId: string,
  operatorId: string,
  newAssigneeId: string,
  newAssigneeName?: string,
  comment?: string,
): Promise<void> {
  const res = await api.post<ApiResult<null>>(
    `/tasks/${id}/transfer`,
    { newAssigneeId, newAssigneeName, comment },
    { params: { tenantId, operatorId } },
  );
  if (res.data.code !== 0) throw new Error(res.data.message || '转办失败');
}

export async function batchHandleTasks(
  tenantId: string,
  operatorId: string,
  taskIds: string[],
  action: string,
  comment?: string,
): Promise<number> {
  const res = await api.post<ApiResult<number>>(
    '/tasks/batch-handle',
    { taskIds, action, comment },
    { params: { tenantId, operatorId } },
  );
  return unwrap(res, '批量处理失败');
}