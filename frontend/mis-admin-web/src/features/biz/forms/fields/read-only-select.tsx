/**
 * 只读单选渲染器（方案 §3.5 映射表第 6 行）。
 *
 * 规则：**查 `options` 把 value 翻成 label**；查不到则显示 value 并标黄色。
 *
 * ⚠️ 「查不到」不是数据错误，而是**发版不同步**的信号（后台加了选项、前端 schema 还是旧的），
 * 所以用 warning 色而不是直接显示裸 value——裸 value（`HIGH`）对审批人毫无信息量，
 * 而黄色能提示「这个选项前端还不认识」。
 */
import { EMPTY_PLACEHOLDER, READONLY_VALUE_CLASS, isBlank } from './read-only-row';
import { cn } from '@/lib/utils';
import type { FormFieldOption } from '../types';

/** 按 value 找 label；找不到返回 null（调用方决定降级策略）。 */
export function findLabel(options: FormFieldOption[] | undefined, value: string): string | null {
  if (!options) return null;
  const hit = options.find((o) => o.value === value);
  return hit ? hit.label : null;
}

export function ReadOnlyTag({
  value,
  options,
  className,
}: {
  value: unknown;
  options?: FormFieldOption[];
  className?: string;
}) {
  if (isBlank(value)) {
    return <div className={cn(READONLY_VALUE_CLASS, className)}>{EMPTY_PLACEHOLDER}</div>;
  }

  const raw = String(value);
  const label = findLabel(options, raw);

  // 未登记的选项：黄色 + 标题给出原始 value
  if (label === null) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium',
            'bg-warning/10 text-warning',
            className,
          )}
          title={`未登记的选项：${raw}`}
          data-testid="read-only-tag-unknown"
        >
          {raw}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className="inline-flex items-center gap-1 rounded-full border border-transparent bg-info/10 px-2 py-0.5 text-xs font-medium text-info"
        data-testid="read-only-tag"
      >
        {label}
      </span>
    </div>
  );
}
