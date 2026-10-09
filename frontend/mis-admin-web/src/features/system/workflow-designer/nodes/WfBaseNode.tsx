/**
 * 节点卡片基础外壳（P7）。
 *
 * <p>统一样式与 Handle 锚点；不同节点类型通过 theme 决定配色与角标。
 * 布局对齐项目约定：圆角 4px、标签 13px、主色走 CSS 变量。
 */
import { type ReactNode } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { NODE_LABELS, type WfNodeData } from '../types';

export type NodeTheme = 'green' | 'blue' | 'amber' | 'purple' | 'gray' | 'red';

const THEME: Record<NodeTheme, { border: string; bg: string; icon: string }> = {
  green: { border: 'border-primary', bg: 'bg-primary/5', icon: 'bg-primary text-primary-foreground' },
  blue: { border: 'border-blue-400', bg: 'bg-blue-50', icon: 'bg-blue-100 text-blue-600' },
  amber: { border: 'border-amber-400', bg: 'bg-amber-50', icon: 'bg-amber-100 text-amber-600' },
  purple: { border: 'border-purple-400', bg: 'bg-purple-50', icon: 'bg-purple-100 text-purple-600' },
  gray: { border: 'border-gray-400', bg: 'bg-gray-50', icon: 'bg-gray-100 text-gray-600' },
  red: { border: 'border-red-400', bg: 'bg-red-50', icon: 'bg-red-100 text-red-600' },
};

export interface WfBaseNodeProps {
  theme: NodeTheme;
  icon: ReactNode;
  hasTarget?: boolean;
  hasSource?: boolean;
}

/** 供各节点类型复用的渲染器。 */
export function renderBaseNode(
  { data, selected }: NodeProps<Node<WfNodeData>>,
  { theme, icon, hasTarget = true, hasSource = true }: WfBaseNodeProps,
) {
  const t = THEME[theme];
  return (
    <div
      className={cn(
        'w-[200px] rounded border bg-card shadow-card transition-shadow',
        t.border,
        t.bg,
        selected && 'ring-2 ring-primary/50',
      )}
    >
      {hasTarget ? <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-primary/60" /> : null}
      {hasSource ? <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-primary/60" /> : null}

      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded', t.icon)}>{icon}</span>
        <span className="truncate text-[13px] font-medium" title={data.nodeName}>
          {data.nodeName}
        </span>
        <span className="ml-auto shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {NODE_LABELS[data.kind]}
        </span>
      </div>

      {data.kind === 'APPROVAL' && data.timeoutHours ? (
        <div className="border-t border-border/50 px-2.5 py-1 text-[11px] text-muted-foreground">
          ⏱ 超时 {data.timeoutHours}h · 规则 {shortRule(data.assigneeRule)}
        </div>
      ) : null}
      {data.kind === 'CONDITIONAL' && data.conditionExpr ? (
        <div className="border-t border-border/50 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {data.conditionExpr}
        </div>
      ) : null}
    </div>
  );
}

function shortRule(rule: string): string {
  const m = /"type"\s*:\s*"([^"]+)"/.exec(rule ?? '');
  return m ? m[1] : '未配置';
}
