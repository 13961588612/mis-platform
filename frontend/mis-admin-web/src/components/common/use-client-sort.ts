import { useCallback, useMemo, useState } from 'react';
import type { SortDir } from './sort-indicator';

/**
 * 客户端列排序：三态 无 → 升 → 降 → 无。
 * 对 string / number / boolean / Date 做稳定比较；null/undefined 沉底。
 */
export function useClientSort<T>(rows: T[], getValue: (row: T, key: string) => unknown) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = useCallback(
    (key: string) => {
      if (sortKey !== key) {
        setSortKey(key);
        setSortDir('asc');
      } else if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortKey(null);
        setSortDir('asc');
      }
    },
    [sortKey, sortDir],
  );

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const key = sortKey;
    const dir = sortDir;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getValue(a, key);
      const bv = getValue(b, key);
      const cmp = compareSortValues(av, bv);
      return dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir, getValue]);

  return { sorted, sortKey, sortDir, toggleSort };
}

function compareSortValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
}
