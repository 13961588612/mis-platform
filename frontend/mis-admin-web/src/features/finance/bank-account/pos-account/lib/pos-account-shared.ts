import { useAuthStore } from '@/stores/auth-store';

/** 写入下游操作人字段（对齐 Vue resolveOper）。 */
export function useOper() {
  const user = useAuthStore((s) => s.user);
  return {
    operId: user?.id ? String(user.id) : '',
    operName: user?.realName || user?.username || '',
  };
}

export const SOURCE_TYPE_MAP: Record<number, string> = {
  1: '收款台',
  2: '团购中心',
};

export const OWNER_TYPE_MAP_SHORT: Record<number, string> = {
  1: '大POS',
  2: '租借PAD',
  3: '租户自有PAD',
  4: '其他',
};

export const OWNER_TYPE_OPTIONS = [
  { value: 1, name: '大POS' },
  { value: 2, name: '租借商场PAD' },
  { value: 3, name: '租户自有PAD' },
  { value: 4, name: '其他不对账POS/PAD' },
] as const;

export const STATUS_MAP: Record<number, string> = {
  1: '有效',
  0: '无效',
};

export const DEAL_TYPE_OPTIONS = [
  { value: 1, name: '导入款台新增' },
  { value: 2, name: '手工增加' },
  { value: 3, name: '手工删除' },
  { value: 4, name: '手工修改' },
  { value: 5, name: '独立终端导入' },
] as const;

export const DEAL_TYPE_MAP: Record<number, string> = Object.fromEntries(
  DEAL_TYPE_OPTIONS.map((o) => [o.value, o.name]),
);

export function fmtAmt(v: unknown): string {
  const n = Number(v);
  if (Number.isNaN(n)) return String(v ?? '');
  return n.toFixed(2);
}

export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
