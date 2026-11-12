/**
 * A2uiDivider — A2UI 基础分隔线（LLM 常输出 type=divider）。
 */

import { cn } from '@/lib/utils';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

export function A2uiDivider({ props }: A2uiComponentProps) {
  const className = typeof props.className === 'string' ? props.className : '';
  const label = typeof props.label === 'string' ? props.label : typeof props.text === 'string' ? props.text : '';

  if (label) {
    return (
      <div className={cn('flex items-center gap-2 py-2 text-xs text-muted-foreground', className)}>
        <div className="h-px flex-1 bg-border" />
        <span className="shrink-0">{label}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return <hr className={cn('my-2 border-border', className)} />;
}

export default A2uiDivider;
