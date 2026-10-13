/**
 * 「查看流程信息」内：待办及后续节点，悬停显示审批规则。
 */
import { useEffect, useState } from 'react';
import type { ProcessDetail } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';
import { buildProgressSteps, type ProgressStep } from '../lib/build-progress-steps';
import { loadDefinitionByCode } from '../lib/load-definition-by-code';
import { AssigneeRuleHover } from './assignee-rule-hover';

export interface ProcessMetaUpcomingNodesProps {
  detail: ProcessDetail;
}

export function ProcessMetaUpcomingNodes({ detail }: ProcessMetaUpcomingNodesProps) {
  const [steps, setSteps] = useState<ProgressStep[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const def = await loadDefinitionByCode(detail.instance.definitionCode);
        if (cancelled) return;
        setSteps(
          buildProgressSteps({
            nodes: def.nodes ?? [],
            tasks: detail.tasks,
            history: detail.history,
            instance: detail.instance,
          }),
        );
      } catch {
        if (!cancelled) setSteps([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  const upcoming = (steps ?? []).filter((s) => s.phase === 'current' || s.phase === 'future');
  if (steps === null) {
    return (
      <p className="mt-3 text-[11px] text-muted-foreground" data-testid="process-meta-upcoming">
        加载待办及后续节点…
      </p>
    );
  }
  if (upcoming.length === 0) {
    return (
      <p className="mt-3 text-[11px] text-muted-foreground" data-testid="process-meta-upcoming">
        无待办或后续审批节点
      </p>
    );
  }

  return (
    <div className="mt-3 border-t pt-3" data-testid="process-meta-upcoming">
      <p className="mb-2 text-[12px] text-muted-foreground">
        待办及后续节点（鼠标悬停查看审批规则）
      </p>
      <ul className="flex flex-wrap gap-2">
        {upcoming.map((s) => (
          <li key={s.nodeCode}>
            <AssigneeRuleHover ruleLabel={s.ruleLabel} side="bottom">
              <span
                tabIndex={0}
                className={cn(
                  'inline-flex cursor-default items-center gap-1 rounded-md border px-2 py-1 text-[12px]',
                  s.phase === 'current'
                    ? 'border-info/40 bg-info/10 text-info'
                    : 'border-border bg-muted/40 text-muted-foreground',
                )}
              >
                <span className="font-medium text-foreground">{s.nodeName}</span>
                <span className="text-[10px] opacity-80">
                  {s.phase === 'current' ? '待办' : '后续'}
                </span>
              </span>
            </AssigneeRuleHover>
          </li>
        ))}
      </ul>
    </div>
  );
}
