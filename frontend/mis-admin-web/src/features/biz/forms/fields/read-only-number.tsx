/**
 * 只读数值渲染器（方案 §3.5 映射表第 3 行）。
 *
 * 规则：`Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })` 千分位；
 * 带 `unit` 则拼在后面。
 *
 * ⚠️ 两条容易写错的边界：
 * 1. `0` 必须渲染成 `0` 而不是 `-`。金额 0 是有效业务值。
 * 2. **无法解析成数字的值原样输出**（不吞成 `-`）。`form_data` 是后端 JSON 透传，
 *    字段类型写错（如把订单号声明成 number）时，审批人需要看到原始值才能发现数据问题，
 *    渲染成 `-` 等于把bug 藏起来。
 */
import { EMPTY_PLACEHOLDER, READONLY_VALUE_CLASS, isBlank } from './read-only-row';
import { cn } from '@/lib/utils';

const formatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
});

/**
 * 把原始值转成可格式化的数字。
 *
 * @returns 数字；无法解析时返回 null（调用方决定原样显示还是占位）。
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // 空串已在 isBlank 里排除；这里只处理「长得像数字」的串
    if (trimmed === '' || !/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function ReadOnlyNumber({
  value,
  unit,
  className,
}: {
  value: unknown;
  /** 展示单位，如 '元' / '%'。拼在数字后面，如 `¥ 128,000.00 元`。 */
  unit?: string;
  className?: string;
}) {
  if (isBlank(value)) {
    return <div className={cn(READONLY_VALUE_CLASS, className)}>{EMPTY_PLACEHOLDER}</div>;
  }

  const n = toFiniteNumber(value);

  // 解析失败：原样输出，让数据问题暴露而不是被占位符吞掉
  if (n === null) {
    return (
      <div className={cn(READONLY_VALUE_CLASS, className)} data-testid="read-only-number-raw">
        {String(value)}
        {unit ? ` ${unit}` : ''}
      </div>
    );
  }

  return (
    <div className={cn(READONLY_VALUE_CLASS, className)} data-testid="read-only-number">
      {formatter.format(n)}
      {unit ? ` ${unit}` : ''}
    </div>
  );
}
