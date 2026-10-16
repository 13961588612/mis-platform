import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Cable,
  Database,
  FileBarChart2,
  GitCompareArrows,
  ListChecks,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { summaryApi } from '@/lib/api/summary';
import { runsApi } from '@/lib/api/reports';
import type { DatasourceHealthRow, SummaryRow } from '@/types/api';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Cable;
  /** 菜单角标（第一批 §1.1）：open-diff=未处理差异数红角标；pull-warn=拉取失败橙 ! 角标 */
  badge?: 'open-diff' | 'pull-warn';
}

const NAV_ITEMS: NavItem[] = [
  { to: '/connections', label: '连接管理', icon: Cable },
  { to: '/datasources', label: '数据源管理', icon: Database },
  { to: '/scenarios', label: '场景与检查', icon: ListChecks },
  { to: '/summary', label: '对账汇总', icon: BarChart3 },
  { to: '/diffs', label: '差异处理', icon: GitCompareArrows, badge: 'open-diff' },
  { to: '/reports', label: '报告中心', icon: FileBarChart2 },
  { to: '/monitor', label: '运行监控', icon: Activity, badge: 'pull-warn' },
];

const PAGE_TITLES: Record<string, string> = {
  '/connections': '连接管理',
  '/datasources': '数据源管理',
  '/scenarios': '场景与检查',
  '/summary': '对账汇总',
  '/diffs': '差异处理',
  '/reports': '报告中心',
  '/monitor': '运行监控',
};

/** 菜单角标：红数字 = 未处理差异数（差异池存量，>99 显示 99+）；橙 ! = 拉取失败告警。 */
function NavBadge({ kind, openDiff, pullWarn }: { kind: 'open-diff' | 'pull-warn'; openDiff: number; pullWarn: boolean }) {
  if (kind === 'pull-warn') {
    if (!pullWarn) return null;
    return (
      <span
        className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold leading-none text-white"
        title="最近拉取失败"
      >
        !
      </span>
    );
  }
  if (openDiff <= 0) return null;
  return (
    <span
      className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
      title="未处理差异数"
    >
      {openDiff > 99 ? '99+' : openDiff}
    </span>
  );
}

export function AppLayout() {
  const location = useLocation();
  const current = PAGE_TITLES[location.pathname] ?? '对账平台';
  // 阶段 2：用户信息来自壳子 microApp.setData 下发（独立运行时为 null，隐藏用户区）
  const user = useAuthStore((s) => s.user);

  // 菜单角标：差异池存量（红）+ 拉取失败告警（橙 !），60s 轮询；失败静默不阻塞导航
  const [openDiff, setOpenDiff] = useState(0);
  const [pullWarn, setPullWarn] = useState(false);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const [rows, health] = await Promise.all([
        summaryApi.list({}).catch(() => [] as SummaryRow[]),
        runsApi.healthOverview().catch(() => [] as DatasourceHealthRow[]),
      ]);
      if (disposed) return;
      setOpenDiff(rows.reduce((sum, r) => sum + Number(r.diff ?? 0), 0));
      setPullWarn(
        health.some(
          (h) => h.health_status === 'error' || (h.last_err_msg != null && h.last_err_msg.trim().length > 0),
        ),
      );
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  function handleLogout() {
    // 壳内：跳壳子登录页（壳子已登录态会被 GuestRoute 拦截跳 portal）
    if (window.microApp?.router) {
      window.microApp.router.push('/login');
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 侧栏 */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GitCompareArrows className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-foreground">对账平台</div>
            <div className="text-[11px] leading-tight text-muted-foreground">Recon Admin</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  isActive &&
                    'border-l-2 border-primary bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.badge ? <NavBadge kind={item.badge} openDiff={openDiff} pullWarn={pullWarn} /> : null}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-[11px] text-muted-foreground">v0.1 · T01~T06 后端已对接</div>
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span>对账平台</span>
            <span className="text-muted-foreground/50">/</span>
            <b className="font-semibold text-foreground">{current}</b>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-[12px] text-muted-foreground lg:block">
              T07 报告/人工处理接入前，相关功能以占位展示
            </div>
            {user ? (
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {(user.realName ?? user.username ?? '?').slice(0, 1)}
                </div>
                <div className="leading-tight">
                  <div className="text-[12px] font-medium text-foreground">{user.realName ?? user.username}</div>
                  <div className="text-[10px] text-muted-foreground">{user.username}</div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="ml-1 flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="退出登录"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  退出
                </button>
              </div>
            ) : (
              <div className="text-[12px] text-muted-foreground">未登录（独立运行）</div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
