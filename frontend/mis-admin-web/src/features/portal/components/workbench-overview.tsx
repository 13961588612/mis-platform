import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Clock, FileText, Mail } from 'lucide-react';
import { fetchTaskStats, type TaskStats } from '@/lib/api/tasks';
import { fetchMessageStats, type MessageStats } from '@/lib/api/messages';
import { fetchMyProcesses } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';
import { usePortalEntry, type PortalEntryTarget } from '../lib/use-portal-entry';

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
  /**
   * 点击后**门内**切到的目标（不再跳路由）。
   *
   * <p>与「查看全部」口径统一：待办类→「待办事项」Tab + 「待处理」子 Tab、
   * 消息类→「消息中心」Tab、我发起的→「待办事项」Tab + 「我发起的」子 Tab。
   */
  target: PortalEntryTarget;
}

/**
 * 工作台顶部概览条（现代商务：白底 + 浅灰分区）。
 *
 * <p>数据来自 taskflow 真实接口；任一失败仅该指标显示 "—"，不阻塞整体。
 *
 * <p><b>本轮改动（门内切 Tab）</b>：四张指标卡原先各自 `navigate('/task/...')`
 * 跳出门户，现改为经 {@link usePortalEntry} 切门户 Tab / 子 Tab，**URL 恒为
 * `/portal`**，与三个「查看全部」入口口径统一。
 */
export function WorkbenchOverview({ tenantId, userId }: WorkbenchOverviewProps) {
  const entry = usePortalEntry();
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
      target: 'pending',
    },
    {
      key: 'unread',
      label: '未读消息',
      value: msgStats?.unread ?? null,
      icon: Mail,
      target: 'inbox',
    },
    {
      key: 'sent',
      label: '我发起的',
      value: sentTotal,
      icon: FileText,
      target: 'mySent',
    },
    {
      key: 'overdue',
      label: '逾期',
      value: taskStats?.overdue ?? null,
      tone: taskStats && taskStats.overdue > 0 ? 'danger' : 'default',
      icon: Clock,
      // 逾期口径 = 待办里逾期了的那些 ⇒ 与「我的待办」同落点。
      target: 'pending',
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
            onClick={() => entry.open(m.target)}
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