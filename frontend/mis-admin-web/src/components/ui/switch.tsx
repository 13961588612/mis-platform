import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 开关（Switch / Toggle）。
 *
 * ⚠️ **没有用 `@radix-ui/react-switch`**：该包不在本项目依赖里，
 * 为一个 20行的控件引入新依赖不划算（团队约束：不为本次任务动 package.json）。
 * 改用原生 `<button role="switch">`：
 * - `role="switch"` + `aria-checked` 是 W3C ARIA 标准角色，屏幕阅读器可正确朗读；
 * - `<button>` 自带键盘可达性（Space/Enter 触发 click）与焦点环，无需额外处理；
 * - 受控/非受控两种用法都支持，与项目内其他控件一致。
 *
 * 视觉规格：h-5 w-9 轨道 + h-4 滑块，滑块位移靠 `translate-x-4`，
 * 与 shadcn 官方 switch 规格一致。
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  /** 受控值。传了就是受控组件，父组件负责改。 */
  checked?: boolean;
  /** 初始值（非受控用法）。 */
  defaultChecked?: boolean;
  /** 值变化回调。 */
  onCheckedChange?: (checked: boolean) => void;
}

export function Switch({ className, checked, defaultChecked = false, onCheckedChange, disabled, onClick, ...props }: SwitchProps) {
  // 受控优先；未传 checked 时走内部 state（非受控）
  const [inner, setInner] = React.useState(defaultChecked);
  const isControlled = checked !== undefined;
  const value = isControlled ? checked : inner;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (disabled) return;
    const next = !value;
    if (!isControlled) setInner(next);
    onCheckedChange?.(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      data-state={value ? 'checked' : 'unchecked'}
      onClick={handleClick}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        value ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...props}
    >
      <span
        data-testid="switch-thumb"
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
          value ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

Switch.displayName = 'Switch';
