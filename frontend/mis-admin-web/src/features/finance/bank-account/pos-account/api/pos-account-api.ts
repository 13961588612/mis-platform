/**
 * POS 对账 API（经 BFF 反代，禁止直连旧网关）。
 * 路径：/api/v1/finance/bank-account/pos-account/** → /api/account-decide/**
 */
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

const BASE = '/finance/bank-account/pos-account';

async function unwrap<T>(p: Promise<{ data: ApiResult<T> }>): Promise<T> {
  const res = await p;
  // 反代透传下游 body；部分成功响应仍是 { code, data }
  const body = res.data as ApiResult<T> & T;
  if (body && typeof body === 'object' && 'code' in body) {
    if (body.code !== 0) {
      throw new Error(body.message || '请求失败');
    }
    return body.data as T;
  }
  return body as T;
}

function toLongIds(ids?: Array<string | number | null | undefined> | null): number[] {
  return (ids || [])
    .map((id) => {
      if (id == null || id === '') return null;
      const n = Number(id);
      return Number.isNaN(n) ? null : n;
    })
    .filter((id): id is number => id != null);
}

export type PageResult<T> = { total: number; rows: T[] };

export type BankOption = { id: number; name: string; code?: string };

export function listBanks() {
  return unwrap<BankOption[]>(api.get(`${BASE}/banks`)).then((list) =>
    (list || []).map((b) => ({ ...b, id: Number(b.id) })),
  );
}

// ---- terminals ----

export function queryTerminals(param: Record<string, unknown>) {
  return unwrap<PageResult<Record<string, unknown>>>(api.post(`${BASE}/terminals/query`, param));
}

export function updateTerminal(data: Record<string, unknown>) {
  return unwrap<unknown>(api.put(`${BASE}/terminals`, data));
}

export function deleteTerminal(data: Record<string, unknown>) {
  return unwrap<unknown>(api.delete(`${BASE}/terminals`, { data }));
}

export function previewTerminalImport(formData: FormData) {
  return unwrap<{
    successRows: Record<string, unknown>[];
    errorRows: Record<string, unknown>[];
  }>(
    api.post(`${BASE}/terminals/import/preview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  );
}

export function confirmTerminalImport(data: Record<string, unknown>) {
  return unwrap<unknown>(api.post(`${BASE}/terminals/import/confirm`, data));
}

export async function downloadTerminalTemplate() {
  const res = await api.get(`${BASE}/terminals/import/template`, {
    responseType: 'blob',
    timeout: 120000,
  });
  return res.data as Blob;
}

// ---- skt ----

export function querySkt(param: Record<string, unknown>) {
  return unwrap<PageResult<Record<string, unknown>>>(api.post(`${BASE}/skt/query`, param));
}

export function getSktDetail(sktno: string) {
  return unwrap<Record<string, unknown>>(api.post(`${BASE}/skt/detail`, { sktno }));
}

export function updateSkt(data: Record<string, unknown>) {
  return unwrap<unknown>(api.put(`${BASE}/skt`, data));
}

export function disableSkt(sktno: string, data: Record<string, unknown>) {
  return unwrap<unknown>(api.put(`${BASE}/skt/disable`, { sktno, ...data }));
}

export function previewSktImport(formData: FormData) {
  return unwrap<{
    successRows: Record<string, unknown>[];
    errorRows: Record<string, unknown>[];
    items: unknown[];
  }>(
    api.post(`${BASE}/skt/import/preview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  );
}

export function confirmSktImport(data: Record<string, unknown>) {
  return unwrap<unknown>(api.post(`${BASE}/skt/import/confirm`, data));
}

export async function downloadSktTemplate() {
  const res = await api.get(`${BASE}/skt/import/template`, {
    responseType: 'blob',
    timeout: 120000,
  });
  return res.data as Blob;
}

// ---- logs / marks ----

export function queryTerminalLogs(param: Record<string, unknown>) {
  return unwrap<PageResult<Record<string, unknown>>>(
    api.post(`${BASE}/terminal-logs/query`, param),
  );
}

export function queryPendingSktMarks(data: Record<string, unknown>) {
  return unwrap<Record<string, unknown>[]>(api.post(`${BASE}/mark/skt/query`, data));
}

export function saveSktMark(data: Record<string, unknown>) {
  return unwrap<unknown>(api.put(`${BASE}/mark/skt`, data));
}

export function queryPendingTerminalMarks(data: Record<string, unknown>) {
  return unwrap<Record<string, unknown>[]>(api.post(`${BASE}/mark/terminal/query`, data));
}

export function saveTerminalMark(data: Record<string, unknown>) {
  return unwrap<unknown>(api.put(`${BASE}/mark/terminal`, data));
}

export function listSktByShop(shopCode: string) {
  return unwrap<Record<string, unknown>[]>(
    api.get(`${BASE}/mark/skt/by-shop`, { params: { shopCode } }),
  );
}

// ---- reconcile ----

export function listPullBatches() {
  return unwrap<Record<string, unknown>[]>(api.get(`${BASE}/reconcile/pull-batches`));
}

export function listEnabledMerchants() {
  return unwrap<Record<string, unknown>[]>(api.get(`${BASE}/reconcile/merchants/enabled`));
}

export function listDecideBatches() {
  return unwrap<Record<string, unknown>[]>(api.get(`${BASE}/reconcile/batches`));
}

export function createDecideBatch(data: Record<string, unknown>) {
  return unwrap<Record<string, unknown>>(api.post(`${BASE}/reconcile/batches`, data));
}

export function storeSummary(batchId: number | string) {
  return unwrap<Record<string, unknown>[]>(
    api.post(`${BASE}/reconcile/batches/store-summary`, { batchId }),
  );
}

export function merchantSummary(batchId: number | string) {
  return unwrap<Record<string, unknown>[]>(
    api.post(`${BASE}/reconcile/batches/merchant-summary`, { batchId }),
  );
}

export function unmatchedMall(
  batchId: number | string,
  shopCode: string,
  param?: Record<string, unknown>,
) {
  return unwrap<Record<string, unknown>[]>(
    api.post(`${BASE}/reconcile/batches/stores/unmatched-mall`, {
      ...(param || {}),
      batchId,
      shopCode,
    }),
  );
}

export function unmatchedBankForStore(
  batchId: number | string,
  shopCode: string,
  param?: Record<string, unknown>,
) {
  return unwrap<unknown>(
    api.post(`${BASE}/reconcile/batches/stores/unmatched-bank`, {
      ...(param || {}),
      batchId,
      shopCode,
    }),
  );
}

export function storeManualMatch(
  batchId: number | string,
  shopCode: string,
  data: {
    mallBillIds?: Array<string | number>;
    bankBillIds?: Array<string | number>;
    memo?: string;
    operId?: string;
    operName?: string;
  },
) {
  return unwrap<unknown>(
    api.post(`${BASE}/reconcile/batches/stores/manual-match`, {
      ...data,
      batchId: Number(batchId),
      shopCode,
      mallBillIds: toLongIds(data.mallBillIds),
      bankBillIds: toLongIds(data.bankBillIds),
    }),
  );
}

export function matchedMall(
  batchId: number | string,
  shopCode: string,
  param?: Record<string, unknown>,
) {
  return unwrap<Record<string, unknown>[]>(
    api.post(`${BASE}/reconcile/batches/stores/matched-mall`, {
      ...(param || {}),
      batchId,
      shopCode,
    }),
  );
}

export function matchedBankForMall(
  batchId: number | string,
  shopCode: string,
  mallBillId: number | string,
) {
  return unwrap<unknown>(
    api.post(`${BASE}/reconcile/batches/stores/matched-bank`, {
      batchId,
      shopCode,
      mallBillId,
    }),
  );
}

export function deleteStoreMatches(
  batchId: number | string,
  shopCode: string,
  data: {
    mallBillIds?: Array<string | number>;
    operId?: string;
    operName?: string;
  },
) {
  return unwrap<unknown>(
    api.delete(`${BASE}/reconcile/batches/stores/matches`, {
      data: {
        ...data,
        batchId: Number(batchId),
        shopCode,
        mallBillIds: toLongIds(data.mallBillIds),
      },
    }),
  );
}

export function unmatchedBankForMerchant(batchId: number | string, merchantNo: string) {
  return unwrap<Record<string, unknown>[]>(
    api.post(`${BASE}/reconcile/batches/merchants/unmatched-bank`, { batchId, merchantNo }),
  );
}

export function merchantManualMatch(
  batchId: number | string,
  merchantNo: string,
  data: {
    bankBillIds?: Array<string | number>;
    memo?: string;
    operId?: string;
    operName?: string;
  },
) {
  return unwrap<unknown>(
    api.post(`${BASE}/reconcile/batches/merchants/manual-match`, {
      ...data,
      batchId: Number(batchId),
      merchantNo,
      bankBillIds: toLongIds(data.bankBillIds),
    }),
  );
}

export function matchedBankForMerchant(
  batchId: number | string,
  merchantNo: string,
  param?: Record<string, unknown>,
) {
  return unwrap<Record<string, unknown>[]>(
    api.post(`${BASE}/reconcile/batches/merchants/matched-bank`, {
      ...(param || {}),
      batchId,
      merchantNo,
    }),
  );
}

export function matchedMallForBank(
  batchId: number | string,
  merchantNo: string,
  bankBillId: number | string,
) {
  return unwrap<unknown>(
    api.post(`${BASE}/reconcile/batches/merchants/matched-mall`, {
      batchId,
      merchantNo,
      bankBillId,
    }),
  );
}

export function deleteMerchantMatches(
  batchId: number | string,
  merchantNo: string,
  data: {
    bankBillIds?: Array<string | number>;
    operId?: string;
    operName?: string;
  },
) {
  return unwrap<unknown>(
    api.delete(`${BASE}/reconcile/batches/merchants/matches`, {
      data: {
        ...data,
        batchId: Number(batchId),
        merchantNo,
        bankBillIds: toLongIds(data.bankBillIds),
      },
    }),
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { toLongIds };
