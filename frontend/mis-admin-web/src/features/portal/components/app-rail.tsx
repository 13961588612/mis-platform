import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import type { AppItem } from '@/types/api';
import { resolveNavIcon } from '@/lib/nav/icons';
import { APP_GROUP_LABEL } from '@/lib/nav/app-groups';
import { cn } from '@/lib/utils';

interface AppRailProps {
  apps: AppItem[];
  currentAppCode?: string | null;
  onEnter: (app: AppItem) => void;
}

/**
 * 门户右侧：模块导航（九宫格 → 竖排紧凑列表）。
 *
 * <p>按 portalGroup 分组折叠；不再需要顶部筛选 Tab。
 */
export function AppRail({ apps, currentAppCode, onEnter }: AppRailProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, AppItem[]>();
    for (const app of apps) {
      const key = app.portalGroup || 'governance';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(app);
    }
    return [...map.entries()];
  }, [apps]);

  const recent = useMemo(() => apps.filter((a) => a.enterable).slice(0, 4), [apps]);

  return (
    <div className="flex flex-col gap-3">
      {/* 我的应用 */}
      <section className="rounded-lg border bg-card shadow-card">
        <header className="border-b px-3.5 py-2.5">
          <h2 className="text-[13px] font-semibold">我的应用</h2>
        </header>
        <div className="p-1.5">
          {grouped.map(([group, list]) => {
            const isCollapsed = collapsed[group];
            return (
              <div key={group} className="mb-1 last:mb-0">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
                  className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-[11px] text-muted-foreground transition hover:bg-muted/60"
                >
                  {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {APP_GROUP_LABEL[group] ?? group}
                  <span className="ml-auto tabular-nums opacity-60">{list.length}</span>
                </button>
                {!isCollapsed ? (
                  <ul className="mt-0.5 space-y-0.5">
                    {list.map((app) => {
                      const Icon = resolveNavIcon(app.icon);
                      const active = currentAppCode === app.code;
                      return (
                        <li key={app.id}>
                          <button
                            type="button"
                            disabled={!app.enterable}
                            onClick={() => onEnter(app)}
                            className={cn(
                              'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition',
                              app.enterable
                                ? 'hover:bg-muted/70'
                                : 'cursor-not-allowed opacity-50',
                              active && 'bg-primary/8 font-medium text-primary',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-6 w-6 shrink-0 items-center justify-center rounded',
                                active
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground group-hover:text-primary',
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1 truncate">{app.name}</span>
                            {app.enterable ? (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                            ) : (
                              <span className="shrink-0 text-[10px] text-muted-foreground">即将上线</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* 最近访问 */}
      {recent.length > 0 ? (
        <section className="rounded-lg border bg-card shadow-card">
          <header className="flex items-center gap-1.5 border-b px-3.5 py-2.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold">最近访问</h2>
          </header>
          <div className="flex flex-wrap gap-1.5 p-2.5">
            {recent.map((app) => {
              const Icon = resolveNavIcon(app.icon);
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => onEnter(app)}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px] transition hover:border-primary/40 hover:bg-primary/5"
                >
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  {app.name}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default AppRail;