import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Moon,
  Sun,
  UserRound,
  Users,
} from 'lucide-react';
import { fetchApps } from '@/lib/api/platform';
import { logout } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/auth-store';
import type { AppItem } from '@/types/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveNavIcon } from '@/lib/nav/icons';
import { HeaderToolkit } from '@/components/layout/header-toolkit';
import {
  CommandPalette,
  useCommandPaletteHotkey,
} from '@/components/layout/command-palette';
import { StatCard } from '@/components/common/stat-card';

const GROUP_LABEL: Record<string, string> = {
  governance: '管理与治理',
  operations: '业务与运营',
  platform: '协同与平台',
};

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'governance', label: '管理与治理' },
  { key: 'operations', label: '业务与运营' },
  { key: 'platform', label: '协同与平台' },
] as const;

export function PortalPage() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const user = useAuthStore((s) => s.user);
  const currentApp = useAuthStore((s) => s.app);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const openCommand = useCallback(() => setCmdOpen(true), []);
  useCommandPaletteHotkey(openCommand);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    void fetchApps()
      .then(setApps)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const filteredApps = useMemo(() => {
    if (groupFilter === 'all') return apps;
    return apps.filter((a) => (a.portalGroup || 'governance') === groupFilter);
  }, [apps, groupFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, AppItem[]>();
    for (const app of filteredApps) {
      const key = app.portalGroup || 'governance';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(app);
    }
    return map;
  }, [filteredApps]);

  const recent = useMemo(() => apps.filter((a) => a.enterable).slice(0, 4), [apps]);

  const enterApp = (app: AppItem) => {
    if (!app.enterable) return;
    if (app.code === 'system' || app.runtime === 'host') {
      navigate('/dashboard');
    }
  };

  const handleLogout = async () => {
    await logout();
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 md:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            M
          </span>
          <span className="font-semibold tracking-tight">MIS Platform</span>
        </div>
        <div className="flex items-center gap-1.5">
          <HeaderToolkit onOpenCommand={openCommand} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => mounted && setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label="切换主题"
          >
            {mounted && resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <div className="relative">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-label="用户菜单"
            >
              {(user?.realName ?? user?.username ?? '?').slice(0, 1)}
            </button>
            {userMenuOpen ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border bg-popover p-1 shadow-card">
                <div className="flex items-center gap-2 border-b px-2.5 py-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{user?.realName ?? user?.username}</div>
                    <div className="truncate text-xs text-muted-foreground">{user?.username}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-destructive hover:bg-accent"
                  onClick={() => void handleLogout()}
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <section
          className="rounded-lg border px-6 py-5 shadow-card"
          style={{ backgroundImage: 'var(--portal-gradient)' }}
        >
          <h1 className="text-xl font-semibold">你好，{user?.realName ?? user?.username}</h1>
          <p className="mt-1 text-sm text-muted-foreground">选择子系统进入工作台</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-sm font-medium text-warning">
              <AlertCircle className="h-3.5 w-3.5" />
              今日待办 8
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-3 py-1 text-sm font-medium text-info">
              <ClipboardList className="h-3.5 w-3.5" />
              待审 3
            </span>
          </div>
        </section>

        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="子系统总数" value={apps.length || '—'} icon={LayoutDashboard} description="全部业务域" />
          <StatCard label="在线用户" value="—" icon={Users} description="接入后展示" />
          <StatCard label="今日操作" value="—" icon={Activity} description="接入后展示" />
          <StatCard label="待办事项" value={8} icon={ClipboardList} description="演示占位" />
        </div>

        {recent.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">最近访问</h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recent.map((app) => {
                const Icon = resolveNavIcon(app.icon);
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => enterApp(app)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm shadow-card hover:bg-accent"
                  >
                    <Icon className="h-3.5 w-3.5 text-[hsl(var(--icon-badge-fg))]" />
                    {app.name}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <nav className="flex items-center gap-6 overflow-x-auto border-b border-border">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={cn(
                'shrink-0 border-b-2 pb-2 text-sm transition',
                groupFilter === f.key
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setGroupFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </nav>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">加载子系统…</p> : null}

        {[...grouped.entries()].map(([group, list]) => (
          <section key={group} className="space-y-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-[hsl(var(--portal-card-accent))]" />
              <h2 className="text-base font-semibold">{GROUP_LABEL[group] ?? group}</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {list.map((app) => {
                const Icon = resolveNavIcon(app.icon);
                const active = currentApp?.code === app.code;
                return (
                  <button
                    key={app.id}
                    type="button"
                    disabled={!app.enterable}
                    onClick={() => enterApp(app)}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg border bg-card px-3.5 py-3 text-left shadow-card transition',
                      app.enterable
                        ? 'hover:-translate-y-px hover:border-primary/35 hover:bg-primary/5 hover:shadow-card-hover'
                        : 'cursor-not-allowed opacity-60',
                      active && 'border-primary/40 bg-primary/5 ring-1 ring-primary/20',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute bottom-2 left-0 top-2 w-[3px] origin-center rounded-r-full bg-primary transition',
                        active
                          ? 'scale-y-100'
                          : 'scale-y-0 group-hover:scale-y-100 group-focus-visible:scale-y-100',
                      )}
                    />
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--icon-badge-bg))] text-[hsl(var(--icon-badge-fg))]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{app.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {app.description || app.code}
                      </span>
                    </span>
                    {app.enterable ? (
                      <ArrowRight className="h-4 w-4 text-primary opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">即将上线</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
