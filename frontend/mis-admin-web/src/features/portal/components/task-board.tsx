import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Inbox } from 'lucide-react';
import { fetchMyTasks, type TaskItem } from '@/lib/api/tasks';
import { cn } from '@/lib/utils';

interface TaskBoardProps {
  tenantId: string;
  userId: string;
}

const PRIORITY: Record<number, { text: string; cls: string }> = {
  4: { text: '紧急', cls: 'bg-destructive/10 text-destructive' },
  3: { text: '高', cls: 'bg-warning/10 text-warning' },
  2: { text: '普通', cls: 'bg-info/10 text-info' },
  1: { text: '低', cls: 'bg-muted text-muted-foreground' },
};

/** 从 sys_task.metadata 解析流程实例 ID（存在则进入 ProcessShell）。 */
function wfInstanceId(item: TaskItem): string | null {
  if (!item.metadata) return null;
  try {
    const parsed = JSON.parse(item.metadata) as { wfInstanceId?: number | string };
    return parsed.wfInstanceId != null ? String(parsed.wfInstanceId) : null;
  } catch {
    return null;
  }
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

  function open(item: TaskItem) {
    const inst = wfInstanceId(item);
    if (inst) navigate(`/task/process/${inst}`);
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
        <div className="flex h-28 items-center justify-center text-[13px] text-muted-foreground">加载中…</div>
      ) : error ? (
        <div className="flex h-28 flex-col items-center justify-center gap-1 text-[13px] text-destructive">
          {error}
          <button type="button" className="text-[12px] underline" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center gap-1 text-[13px] text-muted-foreground">
          <Inbox className="h-5 w-5 opacity-40" />
          暂无待办
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const pr = PRIORITY[item.priority] ?? PRIORITY[1];
            const overdue = item.dueDate != null && new Date(item.dueDate) < new Date();
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/60"
                >
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', pr.cls)}>{pr.text}</span>
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