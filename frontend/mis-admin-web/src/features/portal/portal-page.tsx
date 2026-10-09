import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchApps } from '@/lib/api/platform';
import { registerIframeApps } from '@/lib/nav/iframe-apps';
import { useAuthStore } from '@/stores/auth-store';
import type { AppItem } from '@/types/api';
import { resolveAppEntry } from '@/lib/nav/host-apps';
import { WorkbenchOverview } from './components/workbench-overview';
import { TaskBoard } from './components/task-board';
import { MessageBoard } from './components/message-board';
import { ProcessBoard } from './components/process-board';
import { AppRail } from './components/app-rail';

/**
 * 门户工作台（P0-5：外壳已归位到 AppLayout）。
 *
 * <p>此前本组件自造了整套 `<header>`（M logo、「MIS Platform」标题、主题切换、
 * 用户菜单、退出登录、HeaderToolkit）以及一份 Ctrl+J Copilot 热键，
 * 而 `/portal` 又恰好裸挂在 ProtectedRoute 下、不经过 AppLayout，于是形成
 * 「另一套外壳」。现已把 `/portal` 移进 AppLayout，本组件只保留门户独有的内容：
 * 工作台四卡片 + AppRail 应用导航。顶栏 /侧栏 / 命令面板 / Copilot 全部由 AppLayout 提供。
 *
 * <p>间距遵循 `docs/frontend/admin-web-design.md` §4.2.1：外距只由 AppLayout 主槽
 * `p-4 md:p-6` 提供，页根不再套内层 padding。
 */
export function PortalPage() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = useAuthStore((s) => s.user);
  const currentApp = useAuthStore((s) => s.app);
  const tenantId = '1';
  const userId = user?.id ?? '';
  const navigate = useNavigate();

  useEffect(() => {
    void fetchApps()
      .then((data) => {
        setApps(data);
        registerIframeApps(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const enterApp = useCallback(
    (app: AppItem) => {
      if (!app.enterable) return;
      if (app.runtime === 'iframe' && app.basePath) {
        navigate(`/iframe/${app.code}`);
        return;
      }
      if (app.code === 'system' || app.runtime === 'host') {
        navigate(resolveAppEntry(app.code, app.basePath));
      }
    },
    [navigate],
  );

  return (
    <div className="portal-shell flex h-full flex-col overflow-auto">
      <div className="grid gap-5 lg:grid-cols-3">
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
      </div>
    </div>
  );
}