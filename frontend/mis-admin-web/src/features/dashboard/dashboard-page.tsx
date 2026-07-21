import { useQuery } from '@tanstack/react-query';
import { Activity, Building2, ChevronRight, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchDashboardStats } from '@/lib/api/platform';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { PermissionGate } from '@/components/auth/permission-gate';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

const QUICK_LINKS = [
  { to: '/system/user', title: '用户管理', desc: '账号与角色分配', permission: 'system:user:list' },
  { to: '/system/org', title: '组织管理', desc: '组织单元维护', permission: 'system:org:list' },
  { to: '/system/role', title: '角色管理', desc: '权限与菜单分配', permission: 'system:role:list' },
] as const;

export function DashboardPage() {
  const app = useAuthStore((s) => s.app);
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: fetchDashboardStats,
  });

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto">
      <PageHeader
        title={app?.name ?? '系统管理'}
        description="平台运行概览与常用入口"
        breadcrumbs={[
          { label: '门户', to: '/portal' },
          { label: app?.name ?? '系统管理' },
          { label: '概览' },
        ]}
      />

      {error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : '加载失败'}
        </p>
      ) : null}

      <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="用户数"
          value={isLoading ? '—' : (data?.userCount ?? 0)}
          icon={Users}
          description="当前租户账号"
        />
        <StatCard
          label="组织数"
          value={isLoading ? '—' : (data?.orgCount ?? 0)}
          icon={Building2}
          description="组织单元"
        />
        <StatCard
          label="今日登录"
          value={isLoading ? '—' : (data?.todayLoginCount ?? 0)}
          icon={Activity}
          description="成功登录次数"
        />
        <StatCard
          label="在线用户"
          value={isLoading ? '—' : (data?.onlineUserCount ?? 0)}
          icon={Activity}
          description="有效 Refresh 会话"
        />
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <span className="h-4 w-1 rounded-full bg-[hsl(var(--portal-card-accent))]" />
          快捷入口
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map((item) => (
            <PermissionGate key={item.to} permission={item.permission}>
              <Link
                to={item.to}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border bg-card p-4 shadow-card transition',
                  'hover:border-primary/30 hover:bg-primary/5 hover:shadow-card-hover',
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--icon-badge-bg))] text-[hsl(var(--icon-badge-fg))]">
                  <ChevronRight className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.desc}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </Link>
            </PermissionGate>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <span className="h-4 w-1 rounded-full bg-[hsl(var(--portal-card-accent))]" />
          最近操作
        </h2>
        <div className="overflow-hidden rounded-lg border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">操作人</th>
                <th className="px-4 py-3 font-medium">操作</th>
                <th className="px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  操作日志接入后将在此展示；可先前往「系统监控 · 操作日志」。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
