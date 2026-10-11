import { useCallback, useEffect, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { fetchInbox, type MessageItem } from '@/lib/api/messages';
import { cn } from '@/lib/utils';
import { ListError, ListLoading } from '@/components/common/empty-state';
import { UnreadDot } from '@/components/common/unread-dot';
import { MessageDetailDrawer } from './message-detail-drawer';
import { usePortalEntry } from '../lib/use-portal-entry';

interface MessageBoardProps {
  tenantId: string;
  userId: string;
}

/**
 * 工作台主体：消息与通知。
 *
 * <p><b>点行的去向（UI 精修轮）</b>：点某条 → 就地打开 {@link MessageDetailDrawer}，
 * `messageId` 取**该条自己的 id**（此前无论点哪条都只 `navigate('/task/inbox')`，
 * 属于「点了等于没点」的坏体验）。抽屉临时态**由本组件自持**（`useState`，关闭即
 * 销毁、不进 URL），与门户消息 Tab 的自持约定一致。
 *
 * <p><b>本轮改动（门内切 Tab）</b>：右上角「查看全部」原先 `navigate('/task/inbox')`
 * 跳出门户，现改为经 {@link usePortalEntry} 切到门户「消息中心」Tab，
 * **URL 恒为 `/portal`**，与另外两块板的「查看全部」口径统一。
 */
export function MessageBoard({ tenantId, userId }: MessageBoardProps) {
  const entry = usePortalEntry();
  const [items, setItems] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 抽屉临时态：与门户消息 Tab 同约定（不入 URL，关闭即销毁）。
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMessageId, setDrawerMessageId] = useState<string | null>(null);

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

  /** 点某条消息：开抽屉并带上**这条**的 id（不是固定跳收件箱）。 */
  function open(item: MessageItem) {
    setDrawerMessageId(String(item.id));
    setDrawerOpen(true);
  }

  return (
    <section className="rounded-lg border bg-card shadow-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">消息与通知</h2>
        <button
          type="button"
          onClick={() => entry.open('inbox')}
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
                onClick={() => open(item)}
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

      {/*
        右侧划入抽屉（UI 精修轮新增）。`Sheet` 是独立浮层层（portal），与首页
        `overflow-auto` 容器互不影响；抽屉内容体是唯一滚动容器，内嵌 FormShell
        不再加 overflow-auto —— 单层滚动红线保持不变。
      */}
      <MessageDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        messageId={drawerMessageId}
      />
    </section>
  );
}

export default MessageBoard;