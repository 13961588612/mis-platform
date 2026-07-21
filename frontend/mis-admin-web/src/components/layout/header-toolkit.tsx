import { useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  read?: boolean;
}

const DEMO_NOTIFICATIONS: NotificationItem[] = [
  {
    id: '1',
    title: '待办提醒',
    body: '有 3 条审批待你处理',
    time: '10 分钟前',
    read: false,
  },
  {
    id: '2',
    title: '安全通知',
    body: '检测到新设备登录：Chrome / Windows',
    time: '1 小时前',
    read: false,
  },
  {
    id: '3',
    title: '系统公告',
    body: '本周六 02:00–04:00 计划维护窗口',
    time: '昨天',
    read: true,
  },
];

interface HeaderToolkitProps {
  onOpenCommand: () => void;
  className?: string;
  showSearchPill?: boolean;
}

export function HeaderToolkit({
  onOpenCommand,
  className,
  showSearchPill = true,
}: HeaderToolkitProps) {
  const [open, setOpen] = useState(false);
  const unread = DEMO_NOTIFICATIONS.filter((n) => !n.read).length;

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
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-card bg-destructive" />
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
                <span className="text-sm font-medium">通知</span>
                <span className="text-xs text-muted-foreground">{unread} 条未读</span>
              </div>
              <ul className="max-h-72 overflow-y-auto py-1">
                {DEMO_NOTIFICATIONS.map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      'rounded-md px-3 py-2.5 hover:bg-accent',
                      !n.read && 'bg-primary/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{n.title}</p>
                      {!n.read ? (
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{n.time}</p>
                  </li>
                ))}
              </ul>
              <div className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
                演示数据 · 后续接入消息中心
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
