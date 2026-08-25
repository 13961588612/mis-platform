/**
 * A2uiInput — A2UI 基础 `input` 组件（T06''）。
 *
 * <p>表单输入框 / 只读展示框。支持 `path`（表单字段键）/ `placeholder` / `default`
 * （默认值）/ `label` / `type` / `disabled` / `readOnly`。
 *
 * <p>为避免「未知 A2UI 组件」，默认即可渲染。若仅需展示，Gateway 可下发
 * `readOnly: true` 渲染只读框；可编辑时本地维护输入值，失焦时通过
 * `useA2ui().dispatchAction` 回传 `{ path, value }` 供后端回填。
 */

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useA2ui, useA2uiNode } from '../a2ui-context';
import { cn } from '@/lib/utils';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

/** 安全读取字符串 props。 */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function A2uiInput({ props }: A2uiComponentProps) {
  const { dispatchAction } = useA2ui();
  const node = useA2uiNode();

  const path = str(props.path);
  const label = str(props.label);
  const placeholder = str(props.placeholder);
  const inputType = str(props.type, 'text');
  const disabled = props.disabled === true || props.readOnly === true;
  const className = str(props.className);

  const initialValue =
    typeof props.default === 'string'
      ? (props.default as string)
      : typeof props.value === 'string'
        ? (props.value as string)
        : '';

  const [value, setValue] = useState<string>(initialValue);

  // 外部 props 变化时同步（如 updateComponents 增量刷新）
  useEffect(() => {
    if (typeof props.value === 'string') setValue(props.value as string);
  }, [props.value]);

  const handleBlur = (): void => {
    if (disabled) return;
    dispatchAction({
      surfaceId: node?.surfaceId ?? '',
      componentId: node?.componentId ?? '',
      action: 'input_change',
      payload: { path: path || null, value },
    });
  };

  return (
    <div className={cn('w-full space-y-1', className)}>
      {label.length > 0 ? <Label className="text-xs text-muted-foreground">{label}</Label> : null}
      <Input
        type={inputType}
        value={value}
        placeholder={placeholder.length > 0 ? placeholder : undefined}
        disabled={disabled}
        readOnly={props.readOnly === true}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
      />
    </div>
  );
}

export default A2uiInput;
