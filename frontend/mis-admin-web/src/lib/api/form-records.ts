import api from '@/lib/api/client';
import type { ApiResult, PageResult } from '@/types/api';

/** 表单单据（结构化宽表 + 生命周期）。 */
export interface FormRecord {
  id: string;
  formCode: string;
  status: string;
  storageTable: string;
  dataId: string;
  currentInstanceId: string | null;
  lastInstanceId: string | null;
  title: string | null;
  values: Record<string, unknown>;
  payloadSnapshot: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canStartProcess: boolean;
  canWithdraw: boolean;
}

export async function fetchFormRecords(
  tenantId: string,
  createdBy: string,
  opts?: { status?: string; formCode?: string; page?: number; size?: number },
): Promise<PageResult<FormRecord>> {
  const res = await api.get<ApiResult<PageResult<FormRecord>>>('/form-records', {
    params: {
      tenantId,
      createdBy,
      status: opts?.status || undefined,
      formCode: opts?.formCode || undefined,
      page: opts?.page ?? 1,
      size: opts?.size ?? 20,
    },
  });
  return res.data.data;
}

export async function fetchFormRecord(
  id: string,
  tenantId: string,
  viewerId: string,
): Promise<FormRecord> {
  const res = await api.get<ApiResult<FormRecord>>(`/form-records/${id}`, {
    params: { tenantId, viewerId },
  });
  return res.data.data;
}

export async function createFormRecord(
  tenantId: string,
  body: {
    formCode: string;
    values: Record<string, unknown>;
    title?: string | null;
    createdBy?: string;
    createdByName?: string | null;
  },
): Promise<string> {
  const res = await api.post<ApiResult<string | number>>('/form-records', body, {
    params: { tenantId },
  });
  return String(res.data.data);
}

export async function updateFormRecord(
  id: string,
  tenantId: string,
  operatorId: string,
  body: {
    formCode: string;
    values: Record<string, unknown>;
    title?: string | null;
  },
): Promise<void> {
  await api.put(`/form-records/${id}`, body, {
    params: { tenantId, operatorId },
  });
}

export async function startFormRecordProcess(
  id: string,
  tenantId: string,
  body: {
    definitionCode: string;
    businessId?: string;
    title?: string;
    priority?: number | null;
    dueDate?: string | null;
    initiatorId?: string;
    initiatorName?: string | null;
    initiatorOrgName?: string | null;
    appCode?: string | null;
  },
): Promise<string> {
  const res = await api.post<ApiResult<string | number>>(`/form-records/${id}/start-process`, body, {
    params: { tenantId },
  });
  return String(res.data.data);
}
