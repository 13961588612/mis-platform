/**
 * A2uiButton — A2UI 基础 `button` 组件（T06''）。
 *
 * <p>渲染可点击按钮，支持 `label` / `variant` / `action`（`{ type, target }`）。
 * 点击后通过 `useA2ui().dispatchAction` 将动作回传 Gateway（参考 A2uiProvider 与
 * bff-actions.ts 的回传链路），`action.type` 缺省为 `'click'`。
 *
 * <p>节点定位信息（surfaceId / componentId）来自 `useA2uiNode`，确保 Gateway 能按
 * 路径定位该组件。
 */

import { Button, type ButtonProps } from '@/components/ui/button';
import { useA2ui, useA2uiNode } from '../a2ui-context';
import { cn } from '@/lib/utils';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

/** 后端 A2UI 动作语义（button 节点携带的 action）。 */
interface A2uiButtonAction {
  type?: 'reset' | 'submit' | 'custom' | string;
  target?: string;
}

/** 组件 variant → shadcn Button variant 映射。 */
const VARIANT_MAP: Record<string, NonNullable<ButtonProps['variant']>> = {
  primary: 'default',
  default: 'default',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  destructive: 'destructive',
  link: 'link',
};

export function A2uiButton({ props }: A2uiComponentProps) {
  const { dispatchAction } = useA2ui();
  const node = useA2uiNode();

  const label = typeof props.label === 'string' ? (props.label as string) : '按钮';
  const variantRaw = typeof props.variant === 'string' ? (props.variant as string) : 'primary';
  const variant = VARIANT_MAP[variantRaw] ?? 'default';
  const action = (props.action ?? {}) as A2uiButtonAction;
  const disabled = props.disabled === true;
  const fullWidth = props.fullWidth === true || props.block === true;
  const className = typeof props.className === 'string' ? (props.className as string) : '';

  const handleClick = (): void => {
    const actionType = action.type ?? 'click';
    dispatchAction({
      surfaceId: node?.surfaceId ?? '',
      componentId: node?.componentId ?? '',
      action: actionType,
      payload: {
        label,
        type: actionType,
        target: action.target ?? null,
      },
    });
  };

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled}
      className={cn(fullWidth && 'w-full', className)}
      onClick={handleClick}
    >
      {label}
    </Button>
  );
}

export default A2uiButton;
