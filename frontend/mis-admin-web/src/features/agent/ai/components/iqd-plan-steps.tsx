/**
 * iqd-plan-steps.tsx — 问数执行计划步骤渲染块（T-W1-02 / B2）。
 *
 * <p>Worker（mis-iqd）编排链会把计划步骤序列化进助手 Markdown 的
 * {@code ```iqd-plan ... ```} 围栏；本组件负责：
 * <ol>
 *   <li>从助手正文中剥出围栏（{@link splitIqdPlan}，与 kb-chat-sources 同款口径）</li>
 *   <li>以步骤时间线渲染 plan[]（每步：序号 + 阶段码 + 状态 + 耗时）</li>
 * </ol>
 *
 * <p><b>不接收 {@code sql} prop</b>（§4.3 view 口径）：user 视图下 Worker 已删键，
 * 组件即使收到 sql 也不展示，避免越权泄露。
 */

export interface IqdPlanStep {
  seq: number;
  code: string;
  label: string;
  detail?: string | null;
  /** 仅 view=admin 存在；本组件一律不渲染（无 sql prop 约定）。 */
  sql?: string | null;
  status: string;
  duration_ms?: number | null;
}

const PLAN_FENCE_RE = /```iqd-plan\s*\n([\s\S]*?)\n```/i;

/** 从助手 Markdown 中剥出计划步骤围栏。 */
export function splitIqdPlan(content: string): { body: string; plan: IqdPlanStep[] } {
  const text = content ?? '';
  const fence = text.match(PLAN_FENCE_RE);
  if (!fence) {
    return { body: text, plan: [] };
  }
  return {
    body: text.replace(fence[0], '').replace(/\n{3,}/g, '\n\n').trimEnd(),
    plan: parsePlanPayload(fence[1]),
  };
}

function parsePlanPayload(raw: string): IqdPlanStep[] {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!Array.isArray(parsed)) return [];
    const steps: IqdPlanStep[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const seq = toFiniteNumber(rec.seq ?? rec.sequence);
      const code = String(rec.code ?? '').trim();
      const label = String(rec.label ?? '').trim();
      if (!code && !label) continue;
      steps.push({
        seq: seq ?? steps.length + 1,
        code,
        label: label || code,
        detail: typeof rec.detail === 'string' && rec.detail.trim() ? rec.detail : null,
        status: String(rec.status ?? 'done').trim(),
        duration_ms: toFiniteNumber(rec.duration_ms ?? rec.durationMs),
      });
    }
    return steps;
  } catch {
    return [];
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 步骤状态 → 徽标样式。 */
function statusVariant(status: string): 'default' | 'success' | 'muted' | 'error' {
  switch (status) {
    case 'done':
      return 'success';
    case 'failed':
    case 'error':
      return 'error';
    case 'skipped':
      return 'muted';
    default:
      return 'default';
  }
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_LABEL: Record<string, string> = {
  running: '执行中',
  done: '完成',
  skipped: '跳过',
  failed: '失败',
  error: '失败',
  pending: '等待',
};

/**
 * 问数执行计划步骤时间线。
 *
 * <p>每个步骤展示：序号 + 阶段码 + 标签 + 状态徽标 + 耗时；detail 可空则省略。
 * {@code totalMs} 可选：>0 时在时间线顶部渲染「本轮总耗时」条（由调用方对
 * plan[].duration_ms 求和传入；无 plan 或全 0 不显示）。
 */
export function IqdPlanSteps({
  steps,
  totalMs,
}: {
  steps: IqdPlanStep[];
  totalMs?: number | null;
}) {
  if (!steps || steps.length === 0) return null;
  const total = formatDuration(totalMs);

  return (
    <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs font-medium text-muted-foreground">执行计划 · {steps.length} 步</p>
        {total ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
            本轮总耗时 {total}
          </span>
        ) : null}
      </div>
      <ol className="space-y-1">
        {steps.map((step) => {
          const variant = statusVariant(step.status);
          const label = STATUS_LABEL[step.status] ?? step.status;
          const duration = formatDuration(step.duration_ms);
          return (
            <li
              key={`${step.seq}-${step.code}`}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/50"
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                {step.seq}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">
                <span className="font-medium text-foreground/90">{step.label}</span>
                {step.code ? (
                  <code className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    {step.code}
                  </code>
                ) : null}
                {step.detail ? (
                  <span className="ml-1.5 text-muted-foreground">{step.detail}</span>
                ) : null}
              </span>
              {duration ? <span className="shrink-0 tabular-nums text-muted-foreground">{duration}</span> : null}
              <span
                className={cnStatusBadge(variant)}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function cnStatusBadge(variant: 'default' | 'success' | 'muted' | 'error'): string {
  switch (variant) {
    case 'success':
      return 'shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600';
    case 'error':
      return 'shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive';
    case 'muted':
      return 'shrink-0 rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground';
    default:
      return 'shrink-0 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary';
  }
}

export default IqdPlanSteps;
