import type { ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTabStore } from '@/stores/tab-store';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import {
  ApiManagePage,
  AppManagePage,
  ConfigPage,
  DeptPage,
  DictPage,
  EmployeePage,
  LoginLogPage,
  MenuPage,
  ModulePage,
  OperLogPage,
  OrgPage,
  PostPage,
  RolePage,
  UserPage,
} from '@/features/system/admin-list-page';
import { flattenSystemNavLeaves } from '@/lib/nav/system-nav';

function ForbiddenPage() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="rounded-lg border bg-card p-8 text-center shadow-card">
        <h1 className="text-xl font-semibold">403 无权限</h1>
        <p className="mt-2 text-sm text-muted-foreground">你没有访问该页面的权限。</p>
      </div>
    </div>
  );
}

const PAGE_MAP: Record<string, ComponentType> = {
  '/dashboard': DashboardPage,
  '/403': ForbiddenPage,
  '/system/user': UserPage,
  '/system/org': OrgPage,
  '/system/dept': DeptPage,
  '/system/employee': EmployeePage,
  '/system/post': PostPage,
  '/system/app': AppManagePage,
  '/system/api': ApiManagePage,
  '/system/module': ModulePage,
  '/system/role': RolePage,
  '/system/menu': MenuPage,
  '/system/dict': DictPage,
  '/system/config': ConfigPage,
  '/monitor/login-log': LoginLogPage,
  '/monitor/oper-log': OperLogPage,
};

export const KEEP_ALIVE_META: Record<string, { title: string; icon?: string }> = Object.fromEntries(
  flattenSystemNavLeaves().map((i) => [i.path, { title: i.title, icon: i.icon }]),
);

/** 按已打开 Tab 缓存页面实例；切 Tab 仅显隐，关闭 Tab 才卸载。 */
export function KeepAliveOutlet() {
  const location = useLocation();
  const tabs = useTabStore((s) => s.tabs);
  const paths = new Set(tabs.map((t) => t.path));
  paths.add(location.pathname);

  const active = location.pathname;
  const ActiveFallback = PAGE_MAP[active];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {[...paths].map((path) => {
        const Comp = PAGE_MAP[path];
        if (!Comp) return null;
        const isActive = path === active;
        return (
          <div
            key={path}
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-auto',
              isActive ? 'relative' : 'pointer-events-none absolute inset-0 invisible',
            )}
            aria-hidden={!isActive}
          >
            <Comp />
          </div>
        );
      })}
      {!ActiveFallback ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          页面不存在
        </div>
      ) : null}
    </div>
  );
}
