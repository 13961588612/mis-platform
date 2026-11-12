/**
 * dispatch.trace 调度轻提示（Coordinator → Worker）。
 *
 * <p>仅展示最近一条委派；不暴露 Worker 选择器。运营台与 AI Copilot 共用。
 */

import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DispatchTraceEntry } from '@/lib/chat/types';

/** 常见 Worker 展示名（未知 id 原样回退）。 */
const WORKER_LABELS: Record<string, string> = {
  'spm-report': '超市报表',
  'spm-analyst': '超市分析',
  'crm-assistant': '会员 CRM',
  'bgbh-analyst': '百购分析',
  'mis-rag': '知识库',
  'mis-iqd': '智能问数',
  'mis-admin-helper': '管理助手',
  'mis-user-helper': '用户助手',
  'mis-extract': '抽取',
  'mis-summary': '摘要',
};

const STATUS_LABELS: Record<string, string> = {
  completed: '已完成',
  running: '执行中',
  failed: '失败',
  error: '失败',
  timeout: '超时',
  cancelled: '已取消',
};

function workerLabel(workerId: string): string {
  const id = workerId.trim();
  if (!id) return '';
  return WORKER_LABELS[id] ?? id;
}

function statusLabel(status: string): string {
  const s = status.trim();
  if (!s) return '';
  return STATUS_LABELS[s] ?? s;
}

function isInProgress(status: string): boolean {
  const s = status.trim().toLowerCase();
  return !s || s === 'running' || s === 'started' || s === 'pending';
}

export interface DispatchTraceHintProps {
  entries: DispatchTraceEntry[];
  className?: string;
}

/** 调度轻提示：有 trace 时展示最新一条。 */
export function DispatchTraceHint({ entries, className }: DispatchTraceHintProps) {
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  const worker = workerLabel(latest.worker_id ?? '');
  const status = statusLabel(latest.status ?? '');
  const pending = isInProgress(latest.status ?? '');
  const intent = (latest.intent ?? '').trim();

  const parts: string[] = [];
  if (worker) parts.push(worker);
  else if (latest.tool) parts.push(latest.tool);
  else parts.push('调度中');
  if (intent && intent !== 'unknown') parts.push(intent);
  if (status) parts.push(status);
  if (typeof latest.latency_ms === 'number' && latest.latency_ms > 0 && !pending) {
    parts.push(`${latest.latency_ms}ms`);
  }

  return (
    <div
      className={cn(
        'mx-3 mt-2 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
      )}
      <span className="truncate">{parts.join(' · ')}</span>
    </div>
  );
}
