import * as React from 'react';
import { Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * 日期字段。
 *
 * ⚠️ **刻意用原生 `<input type="date">` 而不是自建日历弹层**：
 * 1. 原生控件在桌面/移动端都有成熟的本地化与键盘录入；
 * 2. 自建日历要处理时区、周起始、闰年、时区跨日——自研必踩坑；
 * 3. 项目里有 `todayLocalDate()`（`lib/utils.ts`）已按本地时区拼 `yyyy-MM-dd`，
 *    与原生控件的 value 格式天然对齐。
 *
 * 校验：`min`/`max` 交给原生控件，不自己实现日期范围校验。
 */
export interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value' | 'defaultValue'> {
  /** `yyyy-MM-dd` 字符串（与 `form_data` 约定一致，**不带时间戳**）。 */
  value?: string;
  defaultValue?: string;
  /** 变更回调。传字符串而非 Date —— 避免调用方再处理一遍序列化。 */
  onChange?: (value: string) => void;
  /** 清空时回调（区分「没选」与「选了空」）。 */
  onClear?: () => void;
}

export function DateField({
  value,
  defaultValue,
  onChange,
  onClear,
  className,
  onClick,
  ...props
}: DateFieldProps) {
  const [inner, setInner] = React.useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const current = isControlled ? value : inner;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (!isControlled) setInner(next);
    // 清空时同时通知 onClear，让调用方能区分「清空」与「改了值」
    if (next === '') onClear?.();
    onChange?.(next);
  };

  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    onClick?.(e);
    // 原生 date 控件只有聚焦时才会弹日历；让点击任意位置都能唤起
    if (props.disabled) return;
    (e.currentTarget as HTMLInputElement).showPicker?.();
  };

  return (
    <div className="relative">
      <Input
        type="date"
        data-testid="date-field"
        value={current}
        onChange={handleChange}
        onClick={handleClick}
        className={cn('pr-9', className)}
        {...props}
      />
      <Calendar
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}

DateField.displayName = 'DateField';
