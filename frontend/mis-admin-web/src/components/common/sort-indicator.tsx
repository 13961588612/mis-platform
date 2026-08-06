import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';
export type SortState = SortDir | 'none';

/** 表头排序箭头：无→双箭头淡显，升→上箭头高亮，降→下箭头高亮 */
export function SortIndicator({ state }: { state: SortState }) {
  if (state === 'asc') return <ArrowUp className="h-3.5 w-3.5 shrink-0 text-primary" />;
  if (state === 'desc') return <ArrowDown className="h-3.5 w-3.5 shrink-0 text-primary" />;
  return <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />;
}
