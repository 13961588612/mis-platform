import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  ArrowLeft,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { logout } from '@/lib/api/auth';
import { fetchApps } from '@/lib/api/platform';
import type { AppItem } from '@/types/api';
import { Button } from '@/components/ui/button';
import { TabBar } from '@/components/layout/tab-bar';
import { SideNav } from '@/components/layout/side-nav';
import { HeaderToolkit } from '@/components/layout/header-toolkit';
import { CopilotPanel } from '@/components/layout/copilot-panel';
import { KeepAliveOutlet, KEEP_ALIVE_META } from '@/components/layout/keep-alive-outlet';
import {
  CommandPalette,
  useCommandPaletteHotkey,
} from '@/components/layout/command-palette';
import { resolveNavIcon } from '@/lib/nav/icons';
import {
  SYSTEM_NAV,
  branchContainsPath,
  findSystemNavItem,
} from '@/lib/nav/system-nav';
import { useTabStore } from '@/stores/tab-store';

const GROUP_LABEL: Record<string, string> = {
  governance: '管理与治理',
  operations: '业务与运营',
  platform: '协同与平台',
};

/** 原型 .btn.btn-ghost：text-sm / font-medium / gap-2 / 无描边 */
const shellBtn =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-2.5 py-[0.4rem] text-sm font-medium leading-none text-foreground transition hover:bg-accent';

export function AppLayout() {
  const { setTheme, resolvedTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [navExpanded, setNavExpanded] = useState<Record<string, boolean>>({});
  const [cmdOpen, setCmdOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const app = useAuthStore((s) => s.app);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();
  const location = useLocation();
  const openTab = useTabStore((s) => s.openTab);

  const navItem = findSystemNavItem(location.pathname);
  const pageTitle = navItem?.title ?? KEEP_ALIVE_META[location.pathname]?.title ?? '概览';
  const pageIcon = navItem?.icon ?? KEEP_ALIVE_META[location.pathname]?.icon ?? 'LayoutDashboard';

  const openCommand = useCallback(() => setCmdOpen(true), []);
  useCommandPaletteHotkey(openCommand);

  useEffect(() => {
    const path = location.pathname;
    if (path === '/portal' || path === '/login' || path === '/change-password' || path === '/403') return;
    openTab({
      path,
      title: path === '/dashboard' ? '仪表盘' : pageTitle,
      icon: path === '/dashboard' ? 'LayoutDashboard' : pageIcon,
      pinned: path === '/dashboard',
    });
  }, [location.pathname, pageTitle, pageIcon, openTab]);

  const appsByGroup = useMemo(() => {
    const map = new Map<string, AppItem[]>();
    for (const item of apps) {
      const key = item.portalGroup || 'governance';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [apps]);

  const currentAppMeta = useMemo(
    () => apps.find((a) => a.code === app?.code) ?? null,
    [apps, app?.code],
  );
  const AppIcon = resolveNavIcon(currentAppMeta?.icon ?? 'Settings');

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    void fetchApps()
      .then(setApps)
      .catch(() => setApps([]));
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (switcherRef.current && !switcherRef.current.contains(t)) setSwitcherOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(t)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleToggleBranch = useCallback(
    (title: string) => {
      setNavExpanded((prev) => {
        const branch = SYSTEM_NAV.find((n) => n.kind === 'branch' && n.title === title);
        const defaultOpen =
          branch?.kind === 'branch' && branchContainsPath(branch, location.pathname);
        const currently = prev[title] ?? defaultOpen;
        return { ...prev, [title]: !currently };
      });
    },
    [location.pathname],
  );

  const handleLogout = async () => {
    await logout();
    clearSession();
    navigate('/login', { replace: true });
  };

  const toggleTheme = () => {
    if (!mounted) return;
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 w-full shrink-0 items-center gap-3 border-b border-border bg-card px-4 shadow-[0_1px_3px_-1px_rgb(15_23_42_/_0.06)]">
        <Link to="/portal" className={shellBtn}>
          <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} />
          返回门户
        </Link>

        <div className="relative shrink-0" ref={switcherRef}>
          <button
            type="button"
            className={shellBtn}
            onClick={() => setSwitcherOpen((v) => !v)}
          >
            <AppIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
            {app?.name ?? '子系统'}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          </button>
          {switcherOpen ? (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-card">
              {appsByGroup.map(([group, list]) => (
                <div key={group} className="mb-1 last:mb-0">
                  <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABEL[group] ?? group}
                  </div>
                  {list.map((item) => {
                    const Icon = resolveNavIcon(item.icon);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!item.enterable}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                          item.code === app?.code ? 'bg-accent' : 'hover:bg-accent',
                          !item.enterable && 'cursor-not-allowed opacity-50',
                        )}
                        onClick={() => {
                          setSwitcherOpen(false);
                          if (item.enterable && (item.code === 'system' || item.runtime === 'host')) {
                            navigate('/dashboard');
                          }
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        {!item.enterable ? (
                          <span className="text-[10px] text-muted-foreground">即将上线</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <HeaderToolkit onOpenCommand={openCommand} className="ml-auto shrink-0" />

        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={toggleTheme} aria-label="切换主题">
          {mounted && resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="AI 助手"
          onClick={() => setCopilotOpen(true)}
        >
          <Sparkles className="h-4 w-4" />
        </Button>

        <div className="relative shrink-0" ref={userMenuRef}>
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
                  <div className="truncate text-sm font-medium">
                    {user?.realName ?? user?.username}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{user?.username}</div>
                </div>
              </div>
              <Link
                to="/change-password"
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent"
                onClick={() => setUserMenuOpen(false)}
              >
                修改密码
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-destructive hover:bg-accent"
                onClick={() => void handleLogout()}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* 设计稿：侧栏常驻（非抽屉），与主区并排 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            'flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
            collapsed ? 'w-16' : 'w-64',
          )}
        >
          <div className={cn('flex items-center gap-2.5 border-b border-sidebar-border px-3 py-3', collapsed && 'justify-center')}>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white shadow-sm"
              style={{
                backgroundImage: 'linear-gradient(135deg, hsl(243 75% 64%), hsl(262 70% 58%))',
              }}
            >
              M
            </span>
            {!collapsed ? (
              <div className="min-w-0">
                <div className="truncate text-[0.9rem] font-semibold leading-tight">
                  {app?.name ?? '系统管理'}
                </div>
                <div className="truncate text-[0.68rem] uppercase tracking-[0.04em] text-sidebar-muted">
                  {app?.code ?? 'system'}
                </div>
              </div>
            ) : null}
          </div>

          <SideNav
            nodes={SYSTEM_NAV}
            pathname={location.pathname}
            collapsed={collapsed}
            expanded={navExpanded}
            onToggleBranch={handleToggleBranch}
          />

          <div className="border-t border-sidebar-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('w-full justify-start text-sidebar-muted', collapsed && 'justify-center px-0')}
              onClick={() => setCollapsed((v) => !v)}
            >
              <Menu className="h-4 w-4" />
              {!collapsed ? <span>折叠侧栏</span> : null}
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
              <KeepAliveOutlet />
            </div>
          </main>
        </div>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <CopilotPanel open={copilotOpen} onOpenChange={setCopilotOpen} />
    </div>
  );
}
