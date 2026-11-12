import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchApps } from '@/lib/api/platform';
import { registerIframeApps } from '@/lib/nav/iframe-apps';
import { useAuthStore } from '@/stores/auth-store';
import type { AppItem } from '@/types/api';
import { resolveAppEntry } from '@/lib/nav/host-apps';
import { WorkbenchOverview } from '../components/workbench-overview';
import { TaskBoard } from '../components/task-board';
import { MessageBoard } from '../components/message-board';
import { ProcessBoard } from '../components/process-board';
import { AppRail } from '../components/app-rail';

/**
 * 门户「首页」Tab —— 门户工作台的默认视图（PR-09）。
 *
 * <p><b>T01 说明</b>：本组件承载的是**原 `PortalPage` 的全部内容**（欢迎条 +
 * `WorkbenchOverview` + `TaskBoard` + `MessageBoard` + `ProcessBoard` + `AppRail`
 * 及其数据加载 / 应用跳转逻辑），行为与 T01 拆分前**完全一致**；仅从
 * `portal-page.tsx` 原样搬移到此，供三 Tab 容器的「首页」页签渲染。
 *
 * <p>外壳（顶栏 / 侧栏 / 命令面板 / Copilot）仍由 `AppLayout` 提供；间距遵循
 * `docs/frontend/admin-web-design.md` §4.2.1：外距只由 AppLayout 主槽
 * `p-4 md:p-6` 提供，页根不再套内层 padding。
 */
export function PortalHomeTab() {
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
          {/*
            🔴 `lg:top-0` 不要改回 `lg:top-4`：门户页根 `portal-shell` 是**唯一滚动容器**
            且按布局契约**不带内层 padding**，网格首行的自然顶边 == 滚动容器顶边。
            sticky 的 `top` 是「顶边至少距滚动口上沿 N px」的约束，N>0 时**在 scrollTop=0
            就会把侧栏整体下推 N px** —— 实测 `top-4` 下「我的应用」卡片 top=96、
            左侧欢迎条 top=80，正好低 16px（就是用户反馈的「比左侧低一点」）。
            改成 `top-0` 后静止态两侧齐平（实测均 80），滚动起来仍照常吸附在滚动口上沿
            （实测 scrollTop=60/174 时恒为 80），sticky 行为未破坏。
          */}
          <div className="lg:sticky lg:top-0">
            {error ? <p className="mb-3 text-[13px] text-destructive">{error}</p> : null}
            {loading ? <p className="mb-3 text-[13px] text-muted-foreground">加载子系统…</p> : null}
            <AppRail apps={apps} currentAppCode={currentApp?.code} onEnter={enterApp} />
          </div>
        </aside>
      </div>
    </div>
  );
}
