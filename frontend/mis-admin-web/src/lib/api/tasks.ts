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
  /**
   * 应用归属（`sys_app.code`）；`null` = 平台级。对齐后端 `TaskVO.appCode`（末尾追加）。
   * 门户待办表「平台 / 关联应用」列据此取值：`null` → 「平台」，否则经应用名映射取展示名。
   */
  appCode: string | null;
  /** 关联流程实例发起人；无实例则 null。 */
  initiatorName: string | null;
  /** 发起人所属组织/公司名快照；无则 null。 */
  initiatorOrgName: string | null;
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
  /** 发起人模糊（本轮新增）：匹配所属实例 `initiator_name`；空白**不透传** ⇒ 零回归。 */
  initiatorName?: string;
  /** 参与人模糊（本轮新增）：匹配该实例任一 `wf_task` 处理人（或关联 `sys_task` 处理人）；空白**不透传**。 */
  participantName?: string;
  /** 应用归属过滤（P0）：`scope='APP'` 时的 `app_code` 等值目标；空白**不透传**。 */
  appCode?: string;
  /** 归属范围（P0）：`ALL`（默认）| `APP` | `PLATFORM`；空白**不透传** ⇒ 零回归。 */
  scope?: string;
  page?: number;
  size?: number;
}

/**
 * 构造请求参数：`keyword` / `initiatorName` / `participantName` / `appCode` / `scope`
 * 空白（null/undefined/纯空格）时**不带该 query**，退化为原查询（零回归）。
 */
function buildQuery(params: TaskQuery): Record<string, unknown> {
  const { keyword, initiatorName, participantName, appCode, scope, ...rest } = params;
  const out: Record<string, unknown> = { ...rest };
  const kw = keyword?.trim();
  if (kw) out.keyword = kw;
  const ini = initiatorName?.trim();
  if (ini) out.initiatorName = ini;
  const par = participantName?.trim();
  if (par) out.participantName = par;
  const app = appCode?.trim();
  if (app) out.appCode = app;
  const sc = scope?.trim();
  if (sc) out.scope = sc;
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

/** 抄送我的（仅 taskType=CC，与待办/已办隔离）。 */
export async function fetchCcTasks(params: TaskQuery): Promise<PageResult<TaskItem>> {
  const res = await api.get<ApiResult<PageResult<TaskItem>>>('/tasks/cc', { params: buildQuery(params) });
  return unwrap(res, '获取抄送记录失败');
}

/**
 * 门户「待办事项 · 全部」聚合行（对齐后端 `PortalMatterVO`，设计 §2.3）。
 *
 * <p>`kind` 决定状态徽标口径（`TASK` 用待办徽标、`INSTANCE` 用流程徽标）；
 * `instanceId` 供抽屉拉流程详情；`sysTaskId` 供抽屉「转办」。
 * 时间字段由后端 `LocalDateTime` 序列化为 ISO 字符串。
 */
export interface PortalMatterItem {
  kind: 'TASK' | 'INSTANCE';
  id: string;
  instanceId: string | null;
  sysTaskId: string | null;
  title: string;
  subtitle: string;
  bizType: string | null;
  appCode: string | null;
  initiatorName: string | null;
  /** 发起人所属组织/公司名快照；无则 null。 */
  initiatorOrgName: string | null;
  assigneeName: string | null;
  status: string;
  createdAt: string;
  category: string;
}

/**
 * 「全部」聚合查询参数。`userId` = 「我」（既是 assignee 又是 initiator）。
 *
 * <p>`keyword` / `initiatorName` / `participantName` / `appCode` / `scope` 空白
 * **不透传**（零回归）。
 */
export interface PortalMattersQuery {
  tenantId: string;
  userId: string;
  keyword?: string;
  initiatorName?: string;
  participantName?: string;
  appCode?: string;
  scope?: string;
  page?: number;
  size?: number;
}

/**
 * 拉取「全部」事项（三源 UNION 的服务端聚合，**非前端合并**）。
 *
 * <p>端点 `GET /tasks/matters` 由 `V141__portal_matters_api.sql` 登记（`sys_api 95100`），
 * 未登记会被 deny-unmapped 拦成 403。
 */
export async function fetchPortalMatters(
  params: PortalMattersQuery,
): Promise<PageResult<PortalMatterItem>> {
  const { keyword, initiatorName, participantName, appCode, scope, ...rest } = params;
  const out: Record<string, unknown> = { ...rest };
  const kw = keyword?.trim();
  if (kw) out.keyword = kw;
  const ini = initiatorName?.trim();
  if (ini) out.initiatorName = ini;
  const par = participantName?.trim();
  if (par) out.participantName = par;
  const app = appCode?.trim();
  if (app) out.appCode = app;
  const sc = scope?.trim();
  if (sc) out.scope = sc;
  const res = await api.get<ApiResult<PageResult<PortalMatterItem>>>('/tasks/matters', { params: out });
  return unwrap(res, '获取全部事项失败');
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