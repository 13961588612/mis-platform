/**
 * A2uiContainer — A2UI 基础 `container` 组件（T06''）。
 *
 * <p>通用 flex 布局容器，接收 `direction` / `gap` / `justifyContent` / `alignItems` /
 * `className` 等 props，并将 `children`（由 SurfaceRenderer 递归注入的 A2UI 子节点）
 * 真实包裹在内层，实现嵌套布局。无权限要求（默认可见）。
 */

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

/** 安全读取字符串 props。 */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** gap 取值 → CSS（数字按 4px 栅格，与 Tailwind spacing 对齐）。 */
function resolveGap(value: unknown): string {
  if (typeof value === 'number') return `${value * 4}px`;
  if (typeof value === 'string' && value.length > 0) return value;
  return '0px';
}

export function A2uiContainer({ props, children }: A2uiComponentProps) {
  const direction = str(props.direction, 'column') === 'row' ? 'row' : 'column';
  const justifyContent = str(props.justifyContent, 'flex-start');
  const alignItems = str(props.alignItems, 'stretch');
  const gap = resolveGap(props.gap);
  const className = str(props.className);
  const style: CSSProperties = {
    flexDirection: direction,
    justifyContent,
    alignItems,
    gap,
  };

  return (
    <div className={cn('flex w-full', className)} style={style}>
      {children as ReactNode}
    </div>
  );
}

export default A2uiContainer;
