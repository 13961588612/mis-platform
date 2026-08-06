import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';

/**
 * 可调列宽 hook：拖表头右边缘改列宽 + localStorage 记忆 + 一键重置。
 *
 * <p><b>布局约定</b>：
 * <ul>
 *   <li>表格始终 {@code width:100%} 铺满容器；</li>
 *   <li>可拖拽的数据列使用<strong>固定像素宽</strong>；</li>
 *   <li>锁定列（通常是操作列 {@code __ops__}）不设宽，吃掉剩余空间；</li>
 *   <li>拖动时只改当前数据列，邻列像素不变；松手后也不再重算数据列。</li>
 * </ul>
 * 这样既铺满 100%，又避免 {@code min-width:100%} 把多余宽度摊到各列导致
 * 「分隔线跟不上鼠标 / 松手后列宽又变」。
 */
export interface ResizableColumn {
  key: string;
  label: string;
  /** 操作列等：不允许拖拽改宽，并作为剩余宽度的吸收列 */
  locked?: boolean;
}

const DEFAULT_COL_WIDTH = 160;
const MIN_COL_WIDTH = 64;
const MAX_COL_WIDTH = 480;
/** 吸收列（操作列）的最小宽，防止被数据列挤没 */
const MIN_FLEX_COL_WIDTH = 120;

interface StoredLayout {
  widths: Record<string, number>;
}

export function useColumnWidths(baseColumns: ResizableColumn[], storageKey: string) {
  const flexKey = useMemo(() => {
    const locked = baseColumns.find((c) => c.locked);
    return locked?.key ?? baseColumns[baseColumns.length - 1]?.key ?? '__ops__';
  }, [baseColumns]);

  const load = useCallback((): Record<string, number> => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Partial<StoredLayout>;
      const valid = new Set(baseColumns.map((c) => c.key));
      const widths: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed.widths ?? {})) {
        // 吸收列不持久化像素宽，始终自动吃剩余，否则松手/刷新后又会参与重分配
        if (k === flexKey) continue;
        if (valid.has(k) && typeof v === 'number') widths[k] = v;
      }
      return widths;
    } catch {
      return {};
    }
  }, [baseColumns, storageKey, flexKey]);

  const initial = useRef(load());
  const [widths, setWidths] = useState<Record<string, number>>(initial.current);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const columnsRef = useRef(baseColumns);
  columnsRef.current = baseColumns;
  const flexKeyRef = useRef(flexKey);
  flexKeyRef.current = flexKey;

  const persist = useCallback(() => {
    try {
      const toSave: Record<string, number> = {};
      for (const [k, v] of Object.entries(widthsRef.current)) {
        if (k !== flexKeyRef.current) toSave[k] = v;
      }
      localStorage.setItem(storageKey, JSON.stringify({ widths: toSave } satisfies StoredLayout));
    } catch {
      /* 隐私模式等场景下忽略持久化异常 */
    }
  }, [storageKey]);

  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const onMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const delta = e.clientX - r.startX;
    const next = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, r.startW + delta));
    if (widthsRef.current[r.key] === next) return;
    // 只改当前列；吸收列无固定宽，由表格自动缩/放，其它数据列像素不变
    widthsRef.current = { ...widthsRef.current, [r.key]: next };
    setWidths(widthsRef.current);
  }, []);

  const onEnd = useCallback(() => {
    resizingRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
    persist();
  }, [onMove, persist]);

  /** 测量并冻结所有「非吸收列」的当前渲染宽。 */
  const freezeDataColumns = useCallback((table: HTMLTableElement): Record<string, number> => {
    const thList = table.querySelectorAll('thead th');
    const flex = flexKeyRef.current;
    const next: Record<string, number> = {};
    columnsRef.current.forEach((c, i) => {
      if (c.key === flex) return;
      const el = thList.item(i) as HTMLElement | null;
      if (!el) {
        next[c.key] = widthsRef.current[c.key] ?? DEFAULT_COL_WIDTH;
        return;
      }
      const w = el.getBoundingClientRect().width;
      next[c.key] = w > 0 ? Math.round(w) : (widthsRef.current[c.key] ?? DEFAULT_COL_WIDTH);
    });
    return next;
  }, []);

  const startResize = useCallback(
    (e: ReactMouseEvent, key: string) => {
      const col = columnsRef.current.find((c) => c.key === key);
      if (col?.locked || key === flexKeyRef.current || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const handle = e.currentTarget as HTMLElement;
      const table = handle.closest('table');
      const frozen = table ? freezeDataColumns(table) : { ...widthsRef.current };
      delete frozen[flexKeyRef.current];

      const startW = frozen[key] ?? DEFAULT_COL_WIDTH;

      flushSync(() => {
        widthsRef.current = frozen;
        setWidths(frozen);
      });

      resizingRef.current = { key, startX: e.clientX, startW };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
    },
    [freezeDataColumns, onMove, onEnd],
  );

  /**
   * 数据列：固定像素（未拖过用默认值）。
   * 吸收列：返回 undefined，不写 style.width，吃掉 100% 里的剩余宽度。
   */
  const widthOf = useCallback(
    (key: string): number | undefined => {
      if (key === flexKey) return undefined;
      return widths[key] ?? DEFAULT_COL_WIDTH;
    },
    [widths, flexKey],
  );

  const dataSum = useMemo(() => {
    let s = 0;
    for (const c of baseColumns) {
      if (c.key === flexKey) continue;
      s += widths[c.key] ?? DEFAULT_COL_WIDTH;
    }
    return s;
  }, [baseColumns, flexKey, widths]);

  /** 铺满容器；minWidth 保证数据列之和 + 操作列下限，超出则父级横滑，绝不压缩已钉死的数据列。 */
  const tableStyle = useMemo<CSSProperties>(
    () => ({
      tableLayout: 'fixed',
      width: '100%',
      minWidth: dataSum + MIN_FLEX_COL_WIDTH,
    }),
    [dataSum],
  );

  const hasCustom = Object.keys(widths).some((k) => k !== flexKey);

  const reset = useCallback(() => {
    setWidths({});
    widthsRef.current = {};
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { widths, widthOf, startResize, hasCustom, reset, tableStyle, flexKey };
}
