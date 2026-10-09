import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileClock } from 'lucide-react';
import { fetchMyProcesses, type WfInstance } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';

interface ProcessBoardProps {
  tenantId: string;
  userId: string;
}

const STATUS: Record<string, { text: string; cls: string }> = {
  RUNNING: { text: '进行中', cls: 'bg-info/10 text-info' },
  COMPLETED: { text: '已完成', cls: 'bg-success/10 text-success' },
  TERMINATED: { text: '已终止', cls: 'bg-destructive/10 text-destructive' },
  SUSPENDED: { text: '已挂起', cls: 'bg-warning/10 text-warning' },
};

/** 工作台主体：我发起的流程。 */
export function ProcessBoard({ tenantId, userId }: ProcessBoardProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<WfInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchMyProcesses(tenantId, userId, undefined, 1, 4);
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

  return (
    <section className="rounded-lg border bg-card shadow-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">我发起的</h2>
        <button
          type="button"
          onClick={() => navigate('/task/my-sent')}
          className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground transition hover:text-primary"
        >
          查看全部 <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </header>

      {loading ? (
        <div className="flex h-24 items-center justify-center text-[13px] text-muted-foreground">加载中…</div>
      ) : error ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 text-[13px] text-destructive">
          {error}
          <button type="button" className="text-[12px] underline" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 text-[13px] text-muted-foreground">
          <FileClock className="h-5 w-5 opacity-40" />
          暂无发起的流程
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const st = STATUS[item.status] ?? STATUS.RUNNING;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/task/process/${item.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {item.businessType} / {item.businessId}
                  </span>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.text}</span>
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

export default ProcessBoard;