import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Inbox } from 'lucide-react';
import { fetchMyTasks, type TaskItem } from '@/lib/api/tasks';
import { ListError, ListLoading } from '@/components/common/empty-state';
import { PriorityBadge } from '@/components/common/priority-badge';
import { wfInstanceId } from '@/lib/api/wf-instance';
import { returnPath } from '@/lib/nav/return-path';

interface TaskBoardProps {
  tenantId: string;
  userId: string;
}

/**
 * 工作台主体：我的待办（现代商务白卡）。
 */
export function TaskBoard({ tenantId, userId }: TaskBoardProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchMyTasks({ tenantId, assigneeId: userId, status: 'PENDING', page: 1, size: 5 });
      setItems(r.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // P0-6：带上来源，详情页面包屑可回到门户工作台
  const from = returnPath('/portal', '工作台');

  function open(item: TaskItem) {
    const inst = wfInstanceId(item);
    if (inst) navigate(`/task/process/${inst}`, { state: from });
    else navigate('/task/pending');
  }

  return (
    <section className="rounded-lg border bg-card shadow-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">我的待办</h2>
        <button
          type="button"
          onClick={() => navigate('/task/pending')}
          className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground transition hover:text-primary"
        >
          查看全部 <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </header>

      {loading ? (
        <ListLoading label="加载中…" compact />
      ) : error ? (
        <ListError message={error} onRetry={() => void load()} compact />
      ) : items.length === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center gap-1 text-[13px] text-muted-foreground">
          <Inbox className="h-5 w-5 opacity-40" />
          暂无待办
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const overdue = item.dueDate != null && new Date(item.dueDate) < new Date();
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/60"
                >
                  <PriorityBadge priority={item.priority} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{item.bizTitle}</span>
                  {overdue ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3" /> 逾期
                    </span>
                  ) : item.dueDate ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      截止 {item.dueDate.replace('T', ' ').slice(5, 16)}
                    </span>
                  ) : null}
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default TaskBoard;