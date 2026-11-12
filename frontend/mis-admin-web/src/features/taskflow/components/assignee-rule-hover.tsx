/**
 * 节点悬停弹出审批规则（CSS group-hover，无额外依赖）。
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface AssigneeRuleHoverProps {
  /** 审批规则文案；空则不包 popup。 */
  ruleLabel: string | null | undefined;
  children: ReactNode;
  className?: string;
  /** popup 相对位置 */
  side?: 'top' | 'bottom';
}

export function AssigneeRuleHover({
  ruleLabel,
  children,
  className,
  side = 'top',
}: AssigneeRuleHoverProps) {
  if (!ruleLabel?.trim()) {
    return <span className={className}>{children}</span>;
  }
  return (
    <span className={cn('group relative inline-flex max-w-full', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[240px] -translate-x-1/2',
          'rounded-md border bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md',
          'group-hover:block group-focus-within:block',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        <span className="font-medium text-foreground">审批规则</span>
        <span className="mt-0.5 block text-muted-foreground">{ruleLabel}</span>
      </span>
    </span>
  );
}
