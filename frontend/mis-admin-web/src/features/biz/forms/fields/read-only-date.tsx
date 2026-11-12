/**
 * 只读日期渲染器（方案 §3.5 映射表第 4、5 行）。
 *
 * 规则：`2026-10-09` → `2026年10月9日`；`2026-10-09T14:30:00` → `2026年10月9日 14:30`；
 * **非法值原样显示**。
 *
 * ⚠️ **不用 `new Date(str)` 解析 `YYYY-MM-DD`**：该格式被规范定为 UTC 午夜，
 * 在东八区以外会整体偏移一天（`2026-10-09` 在 UTC-5 显示成10月8日）。
 * 合同 §2.6 约定存ISO 日期字符串且「时区歧义最少」，展示侧就不能自己引入偏移。
 * 所以走正则手动取年月日，天然按本地日历解读。
 */
import { EMPTY_PLACEHOLDER, READONLY_VALUE_CLASS, isBlank } from './read-only-row';
import { cn } from '@/lib/utils';

/** `2026-10-09` / `2026/10/9` / 可带 ` 14:30:05` 或 `T14:30` 后缀。 */
const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/;

export interface ParsedDate {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/** 把非负整数限制在 [0, max]，用于给单数字补零。 */
function pad(n: number, max = 2): string {
  return String(n).padStart(max, '0');
}

/**
 * 宽松解析日期字符串。
 *
 * @returns 解析失败（含 `2026-02-30` 这类「格式对但日期不存在」）返回 null。
 */
export function parseDateValue(value: unknown): ParsedDate | null {
  if (typeof value !== 'string') return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // 真实存在性校验：Date 构造会把 2026-02-30 自动进位成 3-02，静默通过就是 bug
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null;
  }

  const result: ParsedDate = { year, month, day };
  if (m[4] !== undefined) {
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] !== undefined ? Number(m[6]) : 0;
    if (hour > 23 || minute > 59 || second > 59) return null;
    result.hour = hour;
    result.minute = minute;
    result.second = second;
  }
  return result;
}

/** 渲染成中文格式；无时间部分时只出日期。 */
export function formatDateCn(parsed: ParsedDate): string {
  const datePart = `${parsed.year}年${parsed.month}月${parsed.day}日`;
  if (parsed.hour === undefined) return datePart;
  return `${datePart} ${pad(parsed.hour)}:${pad(parsed.minute!)}`;
}

export function ReadOnlyDate({
  value,
  /** type 为 'datetime' 时置true：带出 HH:mm。 */
  showTime,
  className,
}: {
  value: unknown;
  showTime?: boolean;
  className?: string;
}) {
  if (isBlank(value)) {
    return <div className={cn(READONLY_VALUE_CLASS, className)}>{EMPTY_PLACEHOLDER}</div>;
  }

  const parsed = parseDateValue(value);
  if (parsed === null) {
    // 非法值原样显示：审批人要能看到后端到底存了什么
    return (
      <div className={cn(READONLY_VALUE_CLASS, className)} data-testid="read-only-date-raw">
        {String(value)}
      </div>
    );
  }

  // showTime 缺省时按「值里本来有没有时间」决定，避免 date 字段多出 00:00
  const withTime = showTime ?? parsed.hour !== undefined;
  const shown: ParsedDate = withTime ? parsed : { ...parsed, hour: undefined };

  return (
    <div className={cn(READONLY_VALUE_CLASS, className)} data-testid="read-only-date">
      {formatDateCn(shown)}
    </div>
  );
}
