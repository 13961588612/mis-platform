/**
 * 只读字段的「标签 + 值」行容器（方案 Q2 §3.5视觉规范）。
 *
 * ⚠️ 与 `features/taskflow/readonly-field.tsx` 的 `READONLY_FIELD_CLASS` **故意不同**：
 * 那边有灰底（`bg-muted/40`）+ 边框，是为了在旧 4 字段区里区分输入框；
 * 这边字段有明确的标签列，可以去掉灰底让数值更突出。
 *
 * 保留 `cursor-default` + `whitespace-pre-wrap`：审批人是**读者**，
 * 值要能选中复制，但不该看起来像能点的输入框。
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function ReadOnlyRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** 只读值容器：去边框、透明底、可复制。 */
export const READONLY_VALUE_CLASS = cn(
  'w-full min-h-[34px] rounded border border-transparent bg-muted/40 px-3 py-1.5 text-[13px] text-foreground cursor-default whitespace-pre-wrap',
);

/** textarea 型字段的容器：保留换行且给更高最小高度。 */
export const READONLY_VALUE_MULTILINE_CLASS = cn(READONLY_VALUE_CLASS, 'min-h-[72px]');

/** 空值统一占位符（与 `ReadOnlyText` 现有行为一致）。 */
export const EMPTY_PLACEHOLDER = '-';

/**
 * 判定字段是否为空值。
 *
 * ⚠️ `0` 与 `false` **不是**空值——金额 0 与「是否加急=否」都是有意义的业务值，
 * 渲染成 `-` 会让审批人以为没填。这是本文件最容易写错的地方，故抽成公共函数。
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
