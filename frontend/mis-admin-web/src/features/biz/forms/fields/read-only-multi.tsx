/**
 * 只读多选渲染器（方案 §3.5 映射表第 7 行）。
 *
 * 规则：逐项翻 label 成圆角标签；`collapseInReadonly` 且 > 3 项时前 3 + 「等 N 项」。
 *
 * ⚠️ **容错**：后端 `form_data` 里存的是数组，但历史数据/人工改库可能塞进逗号分隔串。
 * 这里两种都接受，否则整个字段会渲染成空白。
 */
import { EMPTY_PLACEHOLDER, isBlank } from './read-only-row';
import { findLabel } from './read-only-select';
import { cn } from '@/lib/utils';
import type { FormFieldOption } from '../types';

/** 超过几项开始折叠。与方案 §3.5 的「前 3 个」一致。 */
const COLLAPSE_THRESHOLD = 3;

/**
 * 把原始值规整成字符串数组。
 *
 * 兼容三种形态：真正的数组 / 逗号分隔串 / 单个标量（视为单元素数组）。
 */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (v === null || v === undefined ? '' : String(v))).filter((s) => s !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  if (value === null || value === undefined) return [];
  return [String(value)];
}

export function ReadOnlyMulti({
  value,
  options,
  collapse,
  className,
}: {
  value: unknown;
  options?: FormFieldOption[];
  /** schema 的 `collapseInReadonly`：>3 项时只显示前 3 + 「等 N 项」。 */
  collapse?: boolean;
  className?: string;
}) {
  if (isBlank(value)) {
    return <div className={cn('min-h-[34px] px-3 py-1.5 text-[13px]', className)}>{EMPTY_PLACEHOLDER}</div>;
  }

  const items = toStringList(value);
  const collapsed = !!collapse && items.length > COLLAPSE_THRESHOLD;
  const shown = collapsed ? items.slice(0, COLLAPSE_THRESHOLD) : items;
  const restCount = items.length - shown.length;

  return (
    <div className={cn('flex min-h-[34px] flex-wrap items-center gap-1 px-3 py-1.5', className)} data-testid="read-only-multi">
      {shown.map((item, i) => {
        const label = findLabel(options, item);
        return (
          // ⚠️ key 用索引而非 item：历史数据可能有重复值（如["A","A"]），
          // 用值做 key 会撞React 的 duplicate key 警告。
          <span
            key={`${item}-${i}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium',
              label === null ? 'bg-warning/10 text-warning' : 'bg-info/10 text-info',
            )}
            title={label === null ? `未登记的选项：${item}` : undefined}
          >
            {label ?? item}
          </span>
        );
      })}
      {restCount > 0 && (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {`等 ${restCount} 项`}
        </span>
      )}
    </div>
  );
}
