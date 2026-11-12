/**
 * 只读文本 / 长文本渲染器（方案 §3.5 映射表第1、2 行）。
 *
 * 规则：原样输出，`whitespace-pre-wrap` 可选中复制，空值显示 `-`。
 * `multiline`（对应 `type: 'textarea'`）保留换行并给更高最小高度。
 */
import { EMPTY_PLACEHOLDER, READONLY_VALUE_CLASS, READONLY_VALUE_MULTILINE_CLASS, isBlank } from './read-only-row';
import { cn } from '@/lib/utils';

export function ReadOnlyText({
  value,
  multiline,
  className,
}: {
  value: unknown;
  /** type 为 'textarea' 时置true：保留换行 + 更高最小高度。 */
  multiline?: boolean;
  className?: string;
}) {
  if (isBlank(value)) {
    return (
      <div className={cn(multiline ? READONLY_VALUE_MULTILINE_CLASS : READONLY_VALUE_CLASS, className)}>
        {EMPTY_PLACEHOLDER}
      </div>
    );
  }
  return (
    <div
      className={cn(multiline ? READONLY_VALUE_MULTILINE_CLASS : READONLY_VALUE_CLASS, className)}
      data-testid="read-only-text"
    >
      {String(value)}
    </div>
  );
}
