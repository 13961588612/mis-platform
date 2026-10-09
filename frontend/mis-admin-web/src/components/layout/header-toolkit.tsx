import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckSquare, ChevronRight, LayoutDashboard, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { fetchMyTasks, type TaskItem } from '@/lib/api/tasks';
import { fetchInbox, type MessageItem } from '@/lib/api/messages';
import { cn } from '@/lib/utils';

/** 顶栏通知项：待办优先，其次未读消息。 */
interface NotificationItem {
  id: string;
  kind: 'task' | 'message';
  title: string;
  body: string;
  time: string;
  read?: boolean;
  to: string;
}

interface HeaderToolkitProps {
  onOpenCommand: () => void;
  className?: string;
  showSearchPill?: boolean;
}

const TENANT_ID = '1';

/**
 * 全局顶栏工具区：搜索（⌘K）、通知铃铛、工作台入口。
 *
 * <p>铃铛接真实数据（待办 + 未读消息），不再使用演示占位；工作台按钮回到门户。
 */
export function HeaderToolkit({ onOpenCommand, className, showSearchPill = true }: HeaderToolkitProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [tasks, messages] = await Promise.allSettled([
        fetchMyTasks({ tenantId: TENANT_ID, assigneeId: userId, status: 'PENDING', page: 1, size: 4 }),
        fetchInbox({ tenantId: TENANT_ID, userId, page: 1, size: 4 }),
      ]);

      const out: NotificationItem[] = [];
      if (tasks.status === 'fulfilled') {
        for (const t of tasks.value.list as TaskItem[]) {
          out.push({
            id: `t-${t.id}`,
            kind: 'task',
            title: t.bizTitle,
            body: `${t.taskType} · 待你处理`,
            time: t.dueDate ? `截止 ${t.dueDate.replace('T', ' ').slice(5, 16)}` : '',
            read: false,
            to: '/task/pending',
          });
        }
      }
      if (messages.status === 'fulfilled') {
        for (const m of messages.value.list as MessageItem[]) {
          out.push({
            id: `m-${m.id}`,
            kind: 'message',
            title: m.title,
            body: m.summary ?? '',
            time: m.createdAt ? m.createdAt.replace('T', ' ').slice(5, 16) : '',
            read: m.read,
            to: '/task/inbox',
          });
        }
      }
      setItems(out.slice(0, 8));
    } catch {
      setItems([]);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {showSearchPill ? (
        <button
          type="button"
          onClick={onOpenCommand}
          className="hidden min-w-[12rem] items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground transition hover:border-primary/35 hover:bg-muted/60 sm:inline-flex"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="text-left">搜索…</span>
          <kbd className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 sm:hidden"
        aria-label="搜索"
        onClick={onOpenCommand}
      >
        <Search className="h-4 w-4" />
      </Button>

      {/* 工作台入口（回门户） */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label="工作台"
        title="工作台"
        onClick={() => navigate('/portal')}
      >
        <LayoutDashboard className="h-4 w-4" />
      </Button>

      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label="通知"
          onClick={() => setOpen((v) => !v)}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="关闭通知"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-md border bg-popover p-1 shadow-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">待办与消息</span>
                <span className="text-xs text-muted-foreground">{unread} 条未处理</span>
              </div>
              {items.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无待办或消息</div>
              ) : (
                <ul className="max-h-72 overflow-y-auto py-1">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={cn('flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left hover:bg-accent', !n.read && 'bg-primary/5')}
                        onClick={() => {
                          setOpen(false);
                          navigate(n.to);
                        }}
                      >
                        {n.kind === 'task' ? (
                          <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', n.read ? 'bg-muted-foreground/25' : 'bg-primary')} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{n.title}</span>
                            {n.kind === 'task' ? (
                              <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">待办</span>
                            ) : null}
                          </span>
                          {n.body ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body}</span> : null}
                          {n.time ? <span className="mt-1 block text-[11px] text-muted-foreground">{n.time}</span> : null}
                        </span>
                        <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="block w-full border-t px-3 py-2 text-center text-xs text-primary"
                onClick={() => {
                  setOpen(false);
                  navigate('/portal');
                }}
              >
                打开工作台
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}