import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export interface WfNode {
  nodeCode: string;
  nodeName: string;
  nodeType: string;
  sortOrder: number;
  canvasX: number | null;
  canvasY: number | null;
  conditionExpr: string | null;
  assigneeRule: string;
  timeoutHours: number | null;
  config: string;
}

export interface WfDefinition {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  category: string;
  description: string | null;
  version: number;
  status: string;
  supportedFormCodes: string[];
  formSchema: string | null;
  config: string;
  nodes: WfNode[];
  createdAt: string;
  updatedAt: string;
}

export interface WfInstance {
  id: string;
  definitionCode: string;
  startedFormCode: string | null;
  businessType: string;
  businessId: string;
  status: string;
  initiatorId: string | null;
  initiatorName: string | null;
  currentNodeCode: string | null;
  currentNodeName: string | null;
  progress: string | null;
  postProcessStatus: string;
  postRetryCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface WfTask {
  id: string;
  instanceId: string;
  nodeCode: string;
  nodeName: string;
  taskType: string;
  sysTaskId: string | null;
  assigneeId: string;
  assigneeName: string | null;
  status: string;
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WfHistory {
  id: string;
  nodeCode: string;
  operatorId: string | null;
  operatorName: string | null;
  operation: string;
  fromNode: string | null;
  toNode: string | null;
  comment: string | null;
  createdAt: string;
}

export interface ProcessDetail {
  instance: WfInstance;
  tasks: WfTask[];
  history: WfHistory[];
  /**
   * 本次发起提交的业务表单数据，**JSON 字符串**。
   *
   * ⚠️ 是 `string` 不是对象：后端 `ProcessDetailVO.formData` 直接透出
   * `wf_instance.form_data`（JSONB 的字符串形态），不做解析。
   * 前端**不要**在这里 `JSON.parse` —— 解析与容错统一由
   * `features/biz/forms/parse-form-data.ts` 的 `parseFormData` 负责，
   * 它对非法串返回 `{ ok: false, raw }` 供兜底卡展示原文，不抛。
   *
   * ⚠️ 刻意**不放在 `WfInstance` 上**：`GET /workflow/instances/my` 分页 20 条，
   * 挂在那里会让列表接口多传 20 份表单 JSON。
   */
  formData: string | null;
}

export async function fetchDefinitions(tenantId: string, page = 1, size = 20): Promise<PageResult<WfDefinition>> {
  const res = await api.get<ApiResult<PageResult<WfDefinition>>>('/workflow/definitions', {
    params: { tenantId, page, size },
  });
  return unwrap(res, '获取流程定义失败');
}

export async function activateDefinition(id: string, tenantId: string): Promise<void> {
  const res = await api.post<ApiResult<null>>(`/workflow/definitions/${id}/activate`, null, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '发布流程失败');
}

export async function fetchProcessDetail(id: string, tenantId: string): Promise<ProcessDetail> {
  const res = await api.get<ApiResult<ProcessDetail>>(`/workflow/instances/${id}`, { params: { tenantId } });
  return unwrap(res, '获取流程详情失败');
}

export async function fetchMyProcesses(
  tenantId: string,
  initiatorId: string,
  status?: string,
  page = 1,
  size = 20,
): Promise<PageResult<WfInstance>> {
  const res = await api.get<ApiResult<PageResult<WfInstance>>>('/workflow/instances/my', {
    params: { tenantId, initiatorId, status, page, size },
  });
  return unwrap(res, '获取我发起的流程失败');
}