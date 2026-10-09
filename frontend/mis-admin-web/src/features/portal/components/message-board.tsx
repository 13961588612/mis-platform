import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronRight } from 'lucide-react';
import { fetchInbox, type MessageItem } from '@/lib/api/messages';
import { cn } from '@/lib/utils';
import { ListError, ListLoading } from '@/components/common/empty-state';
import { UnreadDot } from '@/components/common/unread-dot';

interface MessageBoardProps {
  tenantId: string;
  userId: string;
}

/** 工作台主体：消息与通知。 */
export function MessageBoard({ tenantId, userId }: MessageBoardProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchInbox({ tenantId, userId, page: 1, size: 5 });
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
        <h2 className="text-[13px] font-semibold">消息与通知</h2>
        <button
          type="button"
          onClick={() => navigate('/task/inbox')}
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
          <Bell className="h-5 w-5 opacity-40" />
          暂无消息
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => navigate('/task/inbox')}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-muted/60"
              >
                <UnreadDot read={item.read} className="h-1.5 w-1.5" />
                <span className={cn('min-w-0 flex-1 truncate text-[13px]', !item.read && 'font-medium')}>
                  {item.title}
                </span>
                {item.referenceTaskId ? (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">待办</span>
                ) : null}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {item.createdAt?.replace('T', ' ').slice(5, 16)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default MessageBoard;