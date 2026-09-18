/** 对账页通用工具（对齐 smp-client ReconcileManage.vue）。 */

export type BillRow = Record<string, unknown>;

export const MATCH_TYPE_OPTIONS = [
  { value: 'auto_order', name: '自动订单号核对' },
  { value: 'auto_terminal', name: '自动终端号核对' },
  { value: 'manual', name: '人工核对' },
] as const;

export function rowId(row: BillRow): string {
  const id = row.id;
  return id == null ? '' : String(id);
}

export function sumField(list: BillRow[] | undefined, field: string): number {
  let s = 0;
  (list || []).forEach((r) => {
    const n = Number(r[field]);
    if (!Number.isNaN(n)) s += n;
  });
  return Math.round(s * 100) / 100;
}

export function isBalanced(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

/** unmatchedBankForStore 可能返回数组或 { banks, merchants } */
export function parseBanksMerchantsResponse(data: unknown): {
  banks: BillRow[];
  merchants: BillRow[];
} {
  if (Array.isArray(data)) {
    return { banks: data, merchants: [] };
  }
  const obj = (data || {}) as Record<string, unknown>;
  return {
    banks: (Array.isArray(obj.banks) ? obj.banks : []) as BillRow[],
    merchants: (Array.isArray(obj.merchants) ? obj.merchants : []) as BillRow[],
  };
}

/** matchedBankForMall / matchedMallForBank 可能返回数组或分组对象 */
export function parseMatchDetailResponse(data: unknown): {
  groupId: string | number | null;
  malls: BillRow[];
  banks: BillRow[];
  matchType: string;
  matchTypeName: string;
  matchTime: string;
  memo: string;
  operName: string;
} {
  if (Array.isArray(data)) {
    return {
      groupId: null,
      malls: [],
      banks: data as BillRow[],
      matchType: '',
      matchTypeName: '',
      matchTime: '',
      memo: '',
      operName: '',
    };
  }
  const obj = (data || {}) as Record<string, unknown>;
  return {
    groupId: (obj.groupId as string | number | null) ?? null,
    malls: (Array.isArray(obj.malls) ? obj.malls : []) as BillRow[],
    banks: (Array.isArray(obj.banks) ? obj.banks : []) as BillRow[],
    matchType: String(obj.matchType ?? ''),
    matchTypeName: String(obj.matchTypeName ?? ''),
    matchTime: String(obj.matchTime ?? ''),
    memo: String(obj.memo ?? ''),
    operName: String(obj.operName ?? ''),
  };
}

export function sortStoreRows(rows: BillRow[]): BillRow[] {
  return rows.slice().sort((a, b) => {
    const sa = a.shopCode != null ? String(a.shopCode) : '';
    const sb = b.shopCode != null ? String(b.shopCode) : '';
    const na = Number(sa);
    const nb = Number(sb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return sa.localeCompare(sb, 'zh-CN', { numeric: true });
  });
}

export function cell(row: BillRow, key: string): string {
  const v = row[key];
  return v == null ? '' : String(v);
}
