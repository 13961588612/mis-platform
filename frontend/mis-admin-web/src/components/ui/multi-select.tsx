import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/**
 * 多选下拉（Popover + Checkbox 组合，不用 radix-multiselect）。
 *
 * 用法：
 * ```tsx
 * <MultiSelect options={[{value:'HIGH',label:'高'}]} value={['HIGH']} onChange={setVals} />
 * ```
 *
 * 受控：`value` + `onChange`。非受控：`defaultValue` + `onChange`。
 *
 * ⚠️ 为什么不用原生 `<select multiple>`：它在移动端与部分桌面浏览器上
 * 交互不可用（需要 Ctrl/Shift 点选），且样式无法与项目统一。
 */
export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  /** 受控选中值。 */
  value?: string[];
  /** 非受控初始选中值。 */
  defaultValue?: string[];
  onChange?: (next: string[]) => void;
  /** 无选中项时的占位文案。 */
  placeholder?: string;
  disabled?: boolean;
  /** 下拉面板最大高度（超出滚动）。 */
  maxHeight?: number;
  className?: string;
}

export function MultiSelect({
  options,
  value,
  defaultValue = [],
  onChange,
  placeholder = '请选择',
  disabled,
  maxHeight = 240,
  className,
}: MultiSelectProps) {
  const [inner, setInner] = React.useState<string[]>(defaultValue);
  const [open, setOpen] = React.useState(false);
  const isControlled = value !== undefined;
  const selected = isControlled ? value : inner;

  const selectedSet = new Set(selected);
  const labelMap = new Map(options.map((o) => [o.value, o.label]));

  const commit = (next: string[]) => {
    if (!isControlled) setInner(next);
    onChange?.(next);
  };

  const toggle = (v: string) => {
    commit(selectedSet.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  const selectedLabels = selected.map((v) => labelMap.get(v) ?? v);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="multi-select-trigger"
          className={cn(
            'flex h-9 w-full items-center justify-between gap-1 rounded-md border border-input bg-card px-3 py-2 text-sm shadow-none ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span
            className={cn(
              'flex min-w-0 flex-1 flex-wrap items-center gap-1',
              selectedLabels.length === 0 && 'text-muted-foreground',
            )}
          >
            {selectedLabels.length === 0 ? (
              placeholder
            ) : (
              selectedLabels.map((label) => (
                <span
                  key={label}
                  className="max-w-[10rem] truncate rounded bg-muted px-1.5 py-0.5 text-xs"
                  data-testid="multi-select-item"
                >
                  {label}
                </span>
              ))
            )}
          </span>
          {selectedLabels.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="清空已选"
              data-testid="multi-select-clear"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                commit([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  commit([]);
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[10rem] p-1">
        <div className="overflow-y-auto" style={{ maxHeight }}>
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">暂无可选项</p>
          ) : (
            options.map((opt) => {
              const checked = selectedSet.has(opt.value);
              return (
                <label
                  key={opt.value}
                  data-testid="multi-select-option"
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                    opt.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Checkbox checked={checked} disabled={opt.disabled} onCheckedChange={() => toggle(opt.value)} />
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {checked ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </label>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

MultiSelect.displayName = 'MultiSelect';
