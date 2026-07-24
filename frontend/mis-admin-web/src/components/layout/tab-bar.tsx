import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTabStore } from '@/stores/tab-store';
import { resolveNavIcon } from '@/lib/nav/icons';

const SCROLL_STEP = 200;

export function TabBar() {
  const navigate = useNavigate();
  const tabs = useTabStore((s) => s.tabs);
  const activeId = useTabStore((s) => s.activeId);
  const activateTab = useTabStore((s) => s.activateTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const closeOthers = useTabStore((s) => s.closeOthers);
  const closeAll = useTabStore((s) => s.closeAll);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      setCanLeft(false);
      setCanRight(false);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(max > 1 && el.scrollLeft < max - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [tabs, updateScrollState]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !activeId) return;
    const activeBtn = Array.from(el.querySelectorAll<HTMLElement>('[data-tab-id]')).find(
      (n) => n.dataset.tabId === activeId,
    );
    if (!activeBtn) return;
    activeBtn.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    requestAnimationFrame(updateScrollState);
  }, [activeId, tabs, updateScrollState]);

  const scrollBy = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  if (tabs.length === 0) return null;

  return (
    <div className="relative flex shrink-0 items-end border-b border-border bg-card">
      <button
        type="button"
        aria-label="向左滚动标签"
        disabled={!canLeft}
        onClick={() => scrollBy(-SCROLL_STEP)}
        className={cn(
          'mb-0 flex h-9 w-8 shrink-0 items-end justify-center pb-2 text-muted-foreground transition',
          canLeft ? 'hover:text-foreground' : 'pointer-events-none opacity-0',
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div
        ref={scrollerRef}
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden pt-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const Icon = resolveNavIcon(tab.icon);
          return (
            <button
              key={tab.id}
              type="button"
              data-tab-id={tab.id}
              onClick={() => {
                activateTab(tab.id);
                navigate(tab.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, id: tab.id });
              }}
              className={cn(
                'group relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[0.8125rem] transition',
                active
                  ? 'border-border bg-background text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {tab.pinned ? (
                <Pin className="h-3 w-3 shrink-0 text-primary" />
              ) : (
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
              )}
              <span className="max-w-[8rem] truncate">{tab.title}</span>
              {!tab.pinned ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = closeTab(tab.id);
                    if (next) navigate(next);
                    else navigate('/dashboard');
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              ) : null}
              {active ? <span className="absolute inset-x-0 -bottom-px h-px bg-background" /> : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="向右滚动标签"
        disabled={!canRight}
        onClick={() => scrollBy(SCROLL_STEP)}
        className={cn(
          'mb-0 flex h-9 w-8 shrink-0 items-end justify-center pb-2 text-muted-foreground transition',
          canRight ? 'hover:text-foreground' : 'pointer-events-none opacity-0',
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {menu ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="关闭菜单"
            onClick={() => setMenu(null)}
          />
          <div
            className="fixed z-50 min-w-[9rem] rounded-md border bg-popover p-1 text-sm shadow-card"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              type="button"
              className="flex w-full rounded-md px-2.5 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                const next = closeTab(menu.id);
                setMenu(null);
                if (next) navigate(next);
              }}
            >
              关闭
            </button>
            <button
              type="button"
              className="flex w-full rounded-md px-2.5 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                closeOthers(menu.id);
                setMenu(null);
                navigate(menu.id);
              }}
            >
              关闭其他
            </button>
            <button
              type="button"
              className="flex w-full rounded-md px-2.5 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                const next = closeAll();
                setMenu(null);
                navigate(next ?? '/dashboard');
              }}
            >
              关闭全部
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
