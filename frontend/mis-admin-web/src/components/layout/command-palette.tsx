import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveNavIcon } from '@/lib/nav/icons';
import { resolveActiveHostAppCode } from '@/lib/nav/host-apps';
import { fetchApps } from '@/lib/api/platform';
import { buildSearchIndex, groupLabel } from '@/lib/search/search-registry';
import type { SearchItem } from '@/lib/search/types';
import type { AppItem } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 分组排序权重：当前 APP 置顶(0) → 其他 APP(1) → 平台级(2)。 */
function groupRank(item: SearchItem, currentApp: string): number {
  if (item.appCode === currentApp) return 0;
  if (item.appCode === null) return 2;
  return 1;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const loginAppCode = useAuthStore((s) => s.app?.code ?? null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  // P0：在面板打开时拉取 APP 列表（含 `type:'app'` 项）；失败静默降级为纯 `*_NAV`。
  const [apps, setApps] = useState<AppItem[]>([]);

  /** 当前正在使用的 APP（以路由为准，避免登录态 app 跨子系统不更新）。 */
  const currentApp = resolveActiveHostAppCode(location.pathname, loginAppCode);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchApps()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** 全量索引（6 份 `*_NAV` + APP 项），随 `apps` 变化重建。 */
  const index = useMemo(() => buildSearchIndex(apps), [apps]);

  /** 过滤 + 分组排序：当前 APP 优先 → 其他 APP → 平台级最后。 */
  const items = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const filtered = kw
      ? index.filter(
          (i) =>
            i.title.toLowerCase().includes(kw) ||
            (i.path ?? '').toLowerCase().includes(kw) ||
            (i.keywords ?? []).some((k) => k.toLowerCase().includes(kw)),
        )
      : index; // 无关键词：展示全部（分组），与既有「打开即铺开」行为一致
    // 稳定排序：同权重内保持原顺序（原顺序按 `*_NAV` 源分组，天然按 APP 连续）。
    return [...filtered].sort((a, b) => groupRank(a, currentApp) - groupRank(b, currentApp));
  }, [index, q, currentApp]);

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
              const target = items[active];
              if (target.path) go(target.path);
            }
          }}
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <Dialog.Description className="sr-only">搜索全部应用的页面与菜单并快速跳转</Dialog.Description>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索页面、菜单、应用…"
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
                const prev = items[idx - 1];
                const showHeader = !prev || prev.appCode !== item.appCode;
                return (
                  <Fragment key={item.id}>
                    {showHeader ? (
                      <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                        {groupLabel(item.appCode, item.appName)}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                        idx === active ? 'bg-accent' : 'hover:bg-accent/70',
                        !item.path && 'cursor-default opacity-60',
                      )}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        if (item.path) go(item.path);
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                      {item.type === 'app' ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          应用
                        </span>
                      ) : null}
                    </button>
                  </Fragment>
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
