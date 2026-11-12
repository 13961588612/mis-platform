/**
 * 只读布尔渲染器（方案 §3.5 映射表第 8 行）。
 *
 * 规则：`true` → 绿徽「是」；`false` → 灰徽「否」。
 *
 * ⚠️ `false` **不是空值**。渲染成 `-` 会让审批人以为「没填」，
 * 而实际含义是「明确回答了否」。同理 `null`/`undefined` 才显示 `-`
 * （确实没提交这个字段）。
 *
 * ⚠️ 只认 `true` / `false` 两个字面量与 `'true'` / `'false'` / `'1'` / `'0'` 串。
 * 不做 `Boolean(value)`——`Boolean('false') === true`，人工录入串进来的假值会被翻反。
 */
import { EMPTY_PLACEHOLDER } from './read-only-row';
import { cn } from '@/lib/utils';

/**
 * 解析布尔字段值。
 *
 * @returns `true`/`false` 为确��值；`null` 表示「无法判定，应显示占位」。
 */
export function parseBoolValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  }
  return null;
}

export function ReadOnlyBool({ value, className }: { value: unknown; className?: string }) {
  const parsed = parseBoolValue(value);

  if (parsed === null) {
    // 无法判定：原样输出而不是猜（'maybe' 显示成「否」是误导）
    const blank = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    return (
      <div className={cn('min-h-[34px] px-3 py-1.5 text-[13px]', className)}>
        {blank ? EMPTY_PLACEHOLDER : String(value)}
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-[34px] items-center px-3 py-1.5', className)} data-testid="read-only-bool">
      {parsed ? (
        <span className="inline-flex items-center rounded-full border border-transparent bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
          是
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-transparent bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          否
        </span>
      )}
    </div>
  );
}
