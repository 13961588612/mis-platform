import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { closeTab, useTabStore } from '@/stores/tab-store';

/**
 * 页内多 Tab 栏：一个路由页一个 Tab，点击切换、x 关闭（关闭后跳到相邻 Tab）。
 *
 * <p>页面实例由 KeepAliveOutlet 保活，切 Tab 只做显隐，页内状态不丢。
 * 壳内嵌入时本栏替代壳子的 TabBar（壳子在 /remote/* 下不渲染自己的侧栏与 Tab）。
 */
export function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = useTabStore((s) => s.tabs);
  if (tabs.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-2">
      {tabs.map((tab) => {
        const active = tab.path === location.pathname;
        return (
          <div
            key={tab.path}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs transition-colors',
              active
                ? 'border-primary/30 bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <button
              type="button"
              className="max-w-[10rem] truncate"
              title={tab.title}
              onClick={() => {
                if (!active) navigate(tab.path);
              }}
            >
              {tab.title}
            </button>
            {tabs.length > 1 ? (
              <button
                type="button"
                title="关闭"
                aria-label={`关闭 ${tab.title}`}
                onClick={() => {
                  const next = closeTab(tab.path);
                  if (next) navigate(next);
                }}
                className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/70 hover:bg-background hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
