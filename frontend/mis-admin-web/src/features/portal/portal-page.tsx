import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { fetchApps } from '@/lib/api/platform';
import { registerIframeApps } from '@/lib/nav/iframe-apps';
import { logout } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/auth-store';
import { useAiStore } from '@/stores/ai-store';
import type { AppItem } from '@/types/api';
import { Button } from '@/components/ui/button';
import { resolveAppEntry } from '@/lib/nav/host-apps';
import { HeaderToolkit } from '@/components/layout/header-toolkit';
import {
  CommandPalette,
  useCommandPaletteHotkey,
} from '@/components/layout/command-palette';
import { CopilotPanel } from '@/components/layout/copilot-panel';
import { WorkbenchOverview } from './components/workbench-overview';
import { TaskBoard } from './components/task-board';
import { MessageBoard } from './components/message-board';
import { ProcessBoard } from './components/process-board';
import { AppRail } from './components/app-rail';

export function PortalPage() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const currentApp = useAuthStore((s) => s.app);
  const clearSession = useAuthStore((s) => s.clearSession);
  const tenantId = '1';
  const userId = user?.id ?? '';
  const copilotOpen = useAiStore((s) => s.copilotOpen);
  const setCopilotOpen = useAiStore((s) => s.setCopilotOpen);
  const navigate = useNavigate();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const openCommand = useCallback(() => setCmdOpen(true), []);
  useCommandPaletteHotkey(openCommand);

  // Copilot 热键：Cmd/Ctrl+J（与 AppLayout 对齐；Cmd+K 已被命令面板占用）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setCopilotOpen(!useAiStore.getState().copilotOpen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setCopilotOpen]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    void fetchApps()
      .then((data) => {
        setApps(data);
        registerIframeApps(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const enterApp = (app: AppItem) => {
    if (!app.enterable) return;
    if (app.runtime === 'iframe' && app.basePath) {
      navigate(`/iframe/${app.code}`);
      return;
    }
    if (app.code === 'system' || app.runtime === 'host') {
      navigate(resolveAppEntry(app.code, app.basePath));
    }
  };

  const handleLogout = async () => {
    await logout();
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <div className="portal-shell min-h-screen bg-background">
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

      <main className="mx-auto grid max-w-[1400px] gap-5 p-4 md:p-6 lg:grid-cols-3">
        {/* 主体：工作台（占 2/3） */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <section className="rounded-lg border bg-card px-5 py-4 shadow-card">
            <h1 className="text-lg font-semibold">你好，{user?.realName ?? user?.username}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              这里是你的工作台 —— 待办、消息与发起的流程
            </p>
          </section>

          {userId ? <WorkbenchOverview tenantId={tenantId} userId={userId} /> : null}
          {userId ? <TaskBoard tenantId={tenantId} userId={userId} /> : null}
          {userId ? <MessageBoard tenantId={tenantId} userId={userId} /> : null}
          {userId ? <ProcessBoard tenantId={tenantId} userId={userId} /> : null}
        </div>

        {/* 侧栏：模块导航（占 1/3） */}
        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-4">
            {error ? <p className="mb-3 text-[13px] text-destructive">{error}</p> : null}
            {loading ? <p className="mb-3 text-[13px] text-muted-foreground">加载子系统…</p> : null}
            <AppRail apps={apps} currentAppCode={currentApp?.code} onEnter={enterApp} />
          </div>
        </aside>
      </main>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <CopilotPanel open={copilotOpen} onOpenChange={setCopilotOpen} />
    </div>
  );
}
