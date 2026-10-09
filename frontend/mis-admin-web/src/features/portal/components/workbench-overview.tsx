import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Clock, FileText, Mail } from 'lucide-react';
import { fetchTaskStats, type TaskStats } from '@/lib/api/tasks';
import { fetchMessageStats, type MessageStats } from '@/lib/api/messages';
import { fetchMyProcesses } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';

interface WorkbenchOverviewProps {
  tenantId: string;
  userId: string;
}

interface Metric {
  key: string;
  label: string;
  value: number | null;
  hint?: string;
  tone?: 'default' | 'danger';
  icon: typeof ClipboardList;
  to: string;
}

/**
 * 工作台顶部概览条（现代商务：白底 + 浅灰分区）。
 *
 * <p>数据来自 taskflow 真实接口；任一失败仅该指标显示 "—"，不阻塞整体。
 */
export function WorkbenchOverview({ tenantId, userId }: WorkbenchOverviewProps) {
  const navigate = useNavigate();
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [msgStats, setMsgStats] = useState<MessageStats | null>(null);
  const [sentTotal, setSentTotal] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    await Promise.allSettled([
      fetchTaskStats(tenantId, userId).then(setTaskStats),
      fetchMessageStats(tenantId, userId).then(setMsgStats),
      fetchMyProcesses(tenantId, userId, undefined, 1, 1).then((r) => setSentTotal(r.total)),
    ]);
  }, [tenantId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics: Metric[] = [
    {
      key: 'pending',
      label: '我的待办',
      value: taskStats?.pending ?? null,
      hint: taskStats && taskStats.urgent > 0 ? `紧急 ${taskStats.urgent}` : undefined,
      tone: taskStats && taskStats.urgent > 0 ? 'danger' : 'default',
      icon: ClipboardList,
      to: '/task/pending',
    },
    {
      key: 'unread',
      label: '未读消息',
      value: msgStats?.unread ?? null,
      icon: Mail,
      to: '/task/inbox',
    },
    {
      key: 'sent',
      label: '我发起的',
      value: sentTotal,
      icon: FileText,
      to: '/task/my-sent',
    },
    {
      key: 'overdue',
      label: '逾期',
      value: taskStats?.overdue ?? null,
      tone: taskStats && taskStats.overdue > 0 ? 'danger' : 'default',
      icon: Clock,
      to: '/task/pending',
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-lg border bg-card sm:grid-cols-4">
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => navigate(m.to)}
            className="group flex items-center gap-3 px-4 py-3.5 text-left transition hover:bg-muted/60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition group-hover:bg-primary/10 group-hover:text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">{m.label}</span>
              <span
                className={cn(
                  'block text-xl font-semibold leading-tight tracking-tight',
                  m.tone === 'danger' && 'text-destructive',
                )}
              >
                {m.value === null ? '—' : m.value}
              </span>
            </span>
            {m.hint ? (
              <span className="ml-auto shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                {m.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default WorkbenchOverview;