import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * 数值字段。
 *
 * ⚠️ **刻意用原生 `<input type="number">` 而不是 `type="text"` + 自解析**：
 * 原生控件自带步进器、上下键增减、`e`/`E` 指数录入。
 *
 * ⚠️ 但**回调传 `number | null` 而不是字符串**：`type="number"` 的输入走 HTML 规范的
 * value sanitization 算法，非法串（`'-'` / `'1e'` / `'abc'`）会被浏览器**清成 `''`**。
 * 若直接 `Number(e.target.value)`，`Number('') === 0` ——
 * 用户「正在清空金额」会被记成「金额 = 0」，静默写坏一条业务数据。
 * 所以：空串与无法解析一律传 `null`。这比传 NaN 好，因为 NaN 一旦进 JSON 就变 `null`，
 * 排查时看不出是「用户清空」还是「后端返回空」。
 */
export interface NumberFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value' | 'defaultValue'> {
  value?: number | null;
  defaultValue?: number | null;
  /** 变更回调。无法解析成数字时传 null（不传 NaN）。 */
  onChange?: (value: number | null) => void;
  /** 展示单位，渲染在输入框内的后缀（如 '元' / '%'）。 */
  unit?: string;
}

/** 把原生 input 的字符串转成 number，无法解析时返回 null。 */
export function parseNumericInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function NumberField({ value, defaultValue, onChange, unit, className, ...props }: NumberFieldProps) {
  // 输入框内保留字符串态：受控时用外部值，非受控时自己维护
  const [inner, setInner] = React.useState(() =>
    defaultValue === null || defaultValue === undefined ? '' : String(defaultValue),
  );
  const isControlled = value !== undefined;

  // 非受控时自己维护字符串；受控时用外部值
  const display = isControlled ? (value === null || value === undefined ? '' : String(value)) : inner;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!isControlled) setInner(raw);
    onChange?.(parseNumericInput(raw));
  };

  return (
    <div className="relative">
      <Input
        type="number"
        data-testid="number-field"
        value={display}
        onChange={handleChange}
        className={cn(unit ? 'pr-12' : undefined, className)}
        {...props}
      />
      {unit ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

NumberField.displayName = 'NumberField';
