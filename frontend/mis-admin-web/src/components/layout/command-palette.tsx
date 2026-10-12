import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveNavIcon } from '@/lib/nav/icons';
import { buildSearchIndex, groupLabel } from '@/lib/search/search-registry';
import type { SearchItem } from '@/lib/search/types';
import { usePortalTabStore } from '@/stores/portal-tab-store';
import { usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 条目分组键：门户三入口自成一组，其余按 `appCode`（`null` → 平台级）。 */
function groupKey(item: SearchItem): string {
  return item.portalTab ? '__portal__' : item.appCode ?? '__platform__';
}

/** 条目分组标题：门户组固定「门户」，其余走 `groupLabel`（appName / 平台级）。 */
function itemGroupLabel(item: SearchItem): string {
  return item.portalTab ? '门户' : groupLabel(item.appCode, item.appName);
}

/**
 * 命令面板（⌘K）—— 搜索「门户三入口 + 各业务 APP 菜单」。
 *
 * <p>索引来源见 `lib/search/search-registry.ts`：门户首页 / 待办事项 / 消息中心 +
 * system / agent / kb / iqd / finance 五份菜单（**不含工作台 `task`**，也不含 `type:'app'` 项）。
 *
 * <p><b>点击跳转（关键）</b>：门户三 Tab **不进 URL**（见 `stores/portal-tab-store.ts`），
 * 故命中 `portalTab` 的条目必须**先写 store 再跳路由**：`setActiveTab(tab)` → `navigate('/portal')`；
 * 其余菜单条目直接 `navigate(path)`。
 *
 * <p><b>「待办事项」子 Tab 落「全部」</b>：命中 `portalTab==='todo'` 时先写子 Tab
 * （`setActiveKey('all')`）再写主 Tab，避免待办面板以旧键挂载多打一轮请求
 * （与 `use-portal-entry.ts` 的写序约定一致）。
 *
 * <p>渲染：按分组（`appCode`）展示分组标题；保留 ↑/↓ 高亮、回车跳转、关键词过滤、空态。
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  /** 全量索引（静态，不随渲染变化）。 */
  const index = useMemo(() => buildSearchIndex(), []);

  /** 关键词过滤（命中标题 / 路径 / 别名即可）。无关键词：展示全部。 */
  const items = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return index;
    return index.filter(
      (i) =>
        i.title.toLowerCase().includes(kw) ||
        (i.path ?? '').toLowerCase().includes(kw) ||
        (i.keywords ?? []).some((k) => k.toLowerCase().includes(kw)),
    );
  }, [index, q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const go = (item: SearchItem) => {
    onOpenChange(false);
    if (item.portalTab) {
      if (item.portalTab === 'todo') {
        usePortalTodoTabStore.getState().setActiveKey('all');
      }
      usePortalTabStore.getState().setActiveTab(item.portalTab);
      navigate('/portal');
      return;
    }
    if (item.path) navigate(item.path);
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
              go(items[active]);
            }
          }}
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <Dialog.Description className="sr-only">搜索门户页面与各应用菜单并快速跳转</Dialog.Description>
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
                const prev = items[idx - 1];
                const showHeader = !prev || groupKey(prev) !== groupKey(item);
                return (
                  <Fragment key={item.id}>
                    {showHeader ? (
                      <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                        {itemGroupLabel(item)}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                        idx === active ? 'bg-accent' : 'hover:bg-accent/70',
                      )}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(item)}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
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
