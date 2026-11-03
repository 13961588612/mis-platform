import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReportParamCardMeta } from '@/lib/chat/types';
import { ReportParamField } from '@/components/chat/report/report-param-fields';

export interface ReportParamPanelProps {
  card: ReportParamCardMeta;
  submitting?: boolean;
  onChangeValue: (wireKey: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * 对话内模板报告参数卡（非 A2UI）。
 * active 可改参提交；submitted/cancelled 只读灰显。
 */
export function ReportParamPanel({
  card,
  submitting,
  onChangeValue,
  onSubmit,
  onCancel,
}: ReportParamPanelProps) {
  const locked = card.state !== 'active';
  const missingRequired = card.slots.some(
    (s) => s.required && !(card.values[s.wire_key] ?? '').trim(),
  );

  return (
    <div
      className={cn(
        'w-full max-w-md space-y-3 rounded-xl border bg-card p-3 shadow-sm',
        locked && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-medium text-foreground">{card.title}</div>
          <div className="text-[11px] text-muted-foreground">{card.reportCode}</div>
          {card.description ? (
            <p className="text-[11px] text-muted-foreground line-clamp-2">{card.description}</p>
          ) : null}
        </div>
        <CardStateBadge state={card.state} />
      </div>

      {card.useAiWorkflow ? (
        <p className="text-[11px] text-muted-foreground">
          将走工作流{card.workflowCode ? ` ${card.workflowCode}` : ''}
          {card.workflowPlatformCode ? `（${card.workflowPlatformCode}）` : ''}
        </p>
      ) : null}

      <div className="space-y-2.5">
        {card.slots.map((slot) => (
          <ReportParamField
            key={slot.wire_key}
            slot={slot}
            value={card.values[slot.wire_key] ?? ''}
            disabled={locked || submitting}
            onChange={onChangeValue}
          />
        ))}
      </div>

      {card.state === 'active' ? (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={submitting}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting || missingRequired}
            onClick={onSubmit}
          >
            {submitting ? '提交中…' : '生成报告'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CardStateBadge({ state }: { state: ReportParamCardMeta['state'] }) {
  if (state === 'active') {
    return (
      <Badge variant="secondary" className="shrink-0 text-[10px]">
        待提交
      </Badge>
    );
  }
  if (state === 'submitted') {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px]">
        已提交
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
      已失效
    </Badge>
  );
}
