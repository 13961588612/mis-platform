import { useState, type MouseEvent, type PointerEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface FilterSelectOption {
  label: string;
  value: string | number;
}

/** 与员工管理筛选栏组织下拉触发器对齐 */
const triggerClass =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground shadow-none';

/**
 * 筛选栏选项下拉：单选 / 多选由 {@code multiple} 控制（默认多选）。
 *
 * <p>多选：值以数组回传，复选框 toggle + 全选/清空；触发器内 chip 单行裁切。
 * 单选：值以标量回传，点选项即选中并关闭 Popover。
 */
export function FilterMultiSelect({
  options,
  value,
  onChange,
  multiple = true,
  triggerClassName,
}: {
  options: FilterSelectOption[];
  value: unknown;
  onChange: (v: unknown) => void;
  multiple?: boolean;
  /** 覆盖触发器高度/内边距，便于与同排 Input 对齐 */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const current: (string | number)[] = multiple
    ? Array.isArray(value)
      ? (value as (string | number)[])
      : []
    : value == null || value === ''
      ? []
      : [value as string | number];
  const idToLabel = (v: string | number) => options.find((o) => String(o.value) === String(v))?.label ?? String(v);

  const pick = (v: string | number) => {
    if (!multiple) {
      onChange(v);
      setOpen(false);
      return;
    }
    onChange(current.some((x) => String(x) === String(v)) ? current.filter((x) => String(x) !== String(v)) : [...current, v]);
  };
  const selectAll = () => onChange(options.map((o) => o.value));
  const clearAll = () => onChange([]);
  const emptyText = multiple ? '请选择（可多选）' : '请选择';
  /** Dialog/Sheet 的 dismiss 层可能 preventDefault 掉 click；动作放在 pointerdown。键盘仍走 click（detail === 0）。 */
  const onActionPointerDown =
    (action: () => void) => (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      action();
    };
  const onActionClick = (action: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail !== 0) return;
    action();
  };

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(triggerClass, 'flex items-center justify-between gap-2 text-left', triggerClassName)}
        >
          {multiple ? (
            <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden">
              {current.length === 0 ? (
                <span className="truncate text-muted-foreground">{emptyText}</span>
              ) : (
                current.map((v) => (
                  <span
                    key={String(v)}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary/80"
                  >
                    {idToLabel(v)}
                  </span>
                ))
              )}
            </span>
          ) : (
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                current.length > 0 ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {current.length > 0 ? idToLabel(current[0]) : emptyText}
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        {multiple ? (
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onPointerDown={onActionPointerDown(selectAll)}
              onClick={onActionClick(selectAll)}
              disabled={options.length === 0}
              className="rounded border border-input px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              全选
            </button>
            <button
              type="button"
              onPointerDown={onActionPointerDown(clearAll)}
              onClick={onActionClick(clearAll)}
              disabled={current.length === 0}
              className="rounded border border-input px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              清空
            </button>
          </div>
        ) : null}
        {options.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无可选项</div>
        ) : (
          <div className="max-h-60 overflow-auto rounded-md border border-border/60 p-1">
            {options.map((o) => {
              const on = current.some((x) => String(x) === String(o.value));
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onPointerDown={onActionPointerDown(() => pick(o.value))}
                  onClick={onActionClick(() => pick(o.value))}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition hover:bg-muted',
                    on && 'bg-primary/10 font-medium text-primary',
                  )}
                  aria-pressed={on}
                >
                  {multiple ? (
                    <span
                      className={cn(
                        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                      )}
                    >
                      {on ? <Check className="h-3 w-3" /> : null}
                    </span>
                  ) : null}
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
