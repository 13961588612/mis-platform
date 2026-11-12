/**
 * 本轮工具步骤折叠条（Copilot）。
 *
 * <p>默认折叠：显示步数 + 最近一步；展开后列全部步骤。数据来自 chat-store.toolSteps。
 */

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Wrench, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolStep } from '@/lib/chat/types';
import { formatToolStepLine } from '@/lib/chat/tool-step-label';

export interface ToolStepsBarProps {
  steps: ToolStep[];
  className?: string;
}

function StepIcon({ status }: { status: ToolStep['status'] }) {
  if (status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  }
  if (status === 'error') {
    return <X className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  }
  return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
}

/** 工具步骤折叠条。 */
export function ToolStepsBar({ steps, className }: ToolStepsBarProps) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const running = steps.some((s) => s.status === 'running');
  const latest = steps[steps.length - 1];
  const latestLine = formatToolStepLine(latest.toolName, latest.summary);

  return (
    <div
      className={cn(
        'mx-3 mt-2 overflow-hidden rounded-md border border-border/70 bg-muted/20 text-xs text-muted-foreground',
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {open
            ? `工具步骤（${steps.length}）`
            : `${steps.length} 步 · ${latestLine}`}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
      {open ? (
        <ul className="max-h-40 space-y-1 overflow-auto border-t border-border/50 px-3 py-2">
          {steps.map((step, index) => (
            <li key={step.id} className="flex items-start gap-2">
              <StepIcon status={step.status} />
              <span className="min-w-0 flex-1 break-all">
                <span className="text-muted-foreground/80">{index + 1}. </span>
                {formatToolStepLine(step.toolName, step.summary)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
