/**
 * 流程进度看板：纵向图形化节点链，展示已审 / 当前待办 / 后续规则。
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import type { ProcessDetail } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';
import {
  buildProgressSteps,
  type ProgressStep,
  type ProgressStepPhase,
} from '../lib/build-progress-steps';
import { loadDefinitionByCode } from '../lib/load-definition-by-code';
import { AssigneeRuleHover } from './assignee-rule-hover';

const PHASE_META: Record<
  ProgressStepPhase,
  { label: string; ring: string; line: string; badge: string }
> = {
  done: {
    label: '已完成',
    ring: 'border-success bg-success/10 text-success',
    line: 'bg-success/40',
    badge: 'bg-success/10 text-success',
  },
  current: {
    label: '进行中',
    ring: 'border-info bg-info/10 text-info',
    line: 'bg-border',
    badge: 'bg-info/10 text-info',
  },
  future: {
    label: '未到达',
    ring: 'border-muted-foreground/40 bg-muted text-muted-foreground',
    line: 'bg-border',
    badge: 'bg-muted text-muted-foreground',
  },
};

export interface ProcessProgressBoardProps {
  detail: ProcessDetail;
}

function PhaseIcon({ phase }: { phase: ProgressStepPhase }) {
  if (phase === 'done') return <CheckCircle2 className="h-4 w-4" />;
  if (phase === 'current') return <MapPin className="h-4 w-4" />;
  return <Circle className="h-4 w-4" />;
}

function StepCard({ step, isLast }: { step: ProgressStep; isLast: boolean }) {
  const meta = PHASE_META[step.phase];
  return (
    <li className="relative flex gap-3" data-testid={`progress-step-${step.nodeCode}`}>
      <div className="flex w-8 shrink-0 flex-col items-center">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full border-2',
            meta.ring,
          )}
          aria-hidden
        >
          <PhaseIcon phase={step.phase} />
        </div>
        {!isLast ? <div className={cn('mt-1 w-0.5 flex-1 min-h-[28px]', meta.line)} /> : null}
      </div>
      <div className="mb-4 min-w-0 flex-1 rounded-md border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <AssigneeRuleHover
            ruleLabel={
              step.phase === 'current' || step.phase === 'future' ? step.ruleLabel : null
            }
            side="top"
          >
            <span
              tabIndex={step.phase === 'current' || step.phase === 'future' ? 0 : undefined}
              className={cn(
                'text-[13px] font-semibold',
                (step.phase === 'current' || step.phase === 'future') &&
                  step.ruleLabel &&
                  'cursor-help underline decoration-dotted underline-offset-2',
              )}
            >
              {step.nodeName}
            </span>
          </AssigneeRuleHover>
          <span className="text-[10px] text-muted-foreground">{step.nodeType}</span>
          <span className={cn('rounded px-1.5 py-0.5 text-[10px]', meta.badge)}>{meta.label}</span>
        </div>

        {step.people.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {step.people.map((p) => (
              <li key={p.id} className="text-[12px]">
                <span className="font-medium">{p.name}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{p.statusLabel}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {step.actions.length > 0 ? (
          <ul className="mt-2 space-y-1.5 border-t pt-2">
            {step.actions.map((a, i) => (
              <li key={`${a.operation}-${a.at}-${i}`} className="text-[12px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{a.operationLabel}</span>
                  <span className="text-muted-foreground">{a.operatorName}</span>
                  {a.at ? <span className="text-[11px] text-muted-foreground">· {a.at}</span> : null}
                </div>
                {a.comment ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">建议：{a.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {step.phase === 'future' && step.ruleLabel ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            审批规则：<span className="text-foreground">{step.ruleLabel}</span>
          </p>
        ) : null}

        {step.phase === 'current' && step.people.length === 0 && step.ruleLabel ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            审批规则：<span className="text-foreground">{step.ruleLabel}</span>
          </p>
        ) : null}

        {step.phase !== 'future' &&
        step.people.length === 0 &&
        step.actions.length === 0 &&
        !step.ruleLabel ? (
          <p className="mt-2 text-[11px] text-muted-foreground">暂无处理记录</p>
        ) : null}
      </div>
    </li>
  );
}

export function ProcessProgressBoard({ detail }: ProcessProgressBoardProps) {
  const [steps, setSteps] = useState<ProgressStep[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const def = await loadDefinitionByCode(detail.instance.definitionCode);
        if (cancelled) return;
        const built = buildProgressSteps({
          nodes: def.nodes ?? [],
          tasks: detail.tasks,
          history: detail.history,
          instance: detail.instance,
        });
        setSteps(built);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : '加载进度失败';
        setError(msg);
        toast.error(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载进度看板…
      </div>
    );
  }
  if (error) {
    return <p className="py-6 text-center text-sm text-destructive">{error}</p>;
  }
  if (!steps?.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">暂无流程节点</p>;
  }

  return (
    <div data-testid="process-progress-board" className="py-1">
      <p className="mb-3 text-[12px] text-muted-foreground">
        已完成节点显示人员与审批操作；当前节点显示待办人员；后续节点显示审批规则。
      </p>
      <ol className="m-0 list-none p-0">
        {steps.map((s, i) => (
          <StepCard key={s.nodeCode} step={s} isLast={i === steps.length - 1} />
        ))}
      </ol>
    </div>
  );
}

export default ProcessProgressBoard;
