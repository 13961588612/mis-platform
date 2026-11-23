import { useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const FILTER_FIELD_LABEL_CLASS = 'mb-[0.4rem] block text-[13px] font-medium text-foreground';
export const FILTER_FIELD_CONTROL_CLASS =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

const COL_CLASS: Record<number, string> = {
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  6: 'md:col-span-6',
};

/** 筛选面板内一列：标签 + 控件，栅格与应用管理一致。 */
export function FilterField({
  label,
  col = 4,
  htmlFor,
  children,
}: {
  label: string;
  col?: 2 | 3 | 4 | 6;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={COL_CLASS[col] ?? COL_CLASS[4]}>
      <label htmlFor={htmlFor} className={FILTER_FIELD_LABEL_CLASS}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** 应用管理同款筛选卡：顶栏「筛选 + 操作/查询/重置」，下方条件区可折叠。 */
export function FilterPanel({
  filterCount,
  actions,
  onSearch,
  onReset,
  children,
  className,
  defaultOpen = true,
}: {
  filterCount: number;
  actions?: ReactNode;
  onSearch: () => void;
  onReset?: () => void;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('mb-4 shrink-0 overflow-hidden rounded-md border bg-card shadow-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">筛选</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs',
              filterCount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            已设置 {filterCount} 项条件
          </span>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button type="button" size="sm" onClick={onSearch}>
            <Search className="h-3.5 w-3.5" />
            查询
          </Button>
          {onReset ? (
            <Button type="button" variant="secondary" size="sm" onClick={onReset}>
              重置查询条件
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            aria-label={open ? '收起筛选' : '展开筛选'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} />
          </Button>
        </div>
      </div>
      {open ? <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-3.5 md:grid-cols-12">{children}</div> : null}
    </div>
  );
}
