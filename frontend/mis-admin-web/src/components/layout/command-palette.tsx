import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveNavIcon } from '@/lib/nav/icons';
import { SYSTEM_NAV, flattenSystemNavLeaves } from '@/lib/nav/system-nav';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const leaves = flattenSystemNavLeaves().map((i) => {
      const parent = SYSTEM_NAV.find(
        (n) => n.kind === 'branch' && n.children.some((c) => c.path === i.path),
      );
      return {
        path: i.path,
        title: i.title,
        icon: i.icon,
        group: parent && parent.kind === 'branch' ? parent.title : '导航',
      };
    });
    const base = [
      { path: '/portal', title: '返回门户', icon: 'Home', group: '快捷' },
      ...leaves,
    ];
    const kw = q.trim().toLowerCase();
    if (!kw) return base;
    return base.filter(
      (i) => i.title.toLowerCase().includes(kw) || i.path.toLowerCase().includes(kw),
    );
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-[18%] z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border bg-popover shadow-card-hover outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              go(items[active].path);
            }
          }}
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <Dialog.Description className="sr-only">搜索菜单并快速跳转</Dialog.Description>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索页面、菜单…"
              className="h-12 w-full bg-transparent text-sm outline-none"
            />
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              ESC
            </kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">无匹配结果</p>
            ) : (
              items.map((item, idx) => {
                const Icon = resolveNavIcon(item.icon);
                return (
                  <button
                    key={`${item.path}-${item.title}`}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                      idx === active ? 'bg-accent' : 'hover:bg-accent/70',
                    )}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(item.path)}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                    {item.group ? (
                      <span className="truncate text-xs text-muted-foreground">{item.group}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function useCommandPaletteHotkey(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}
