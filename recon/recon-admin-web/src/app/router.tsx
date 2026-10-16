import { RouterProvider, createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConnectionsPage } from '@/features/connections/ConnectionsPage';
import { DatasourcesPage } from '@/features/datasources/DatasourcesPage';
import { ScenariosPage } from '@/features/scenarios/ScenariosPage';
import { SummaryPage } from '@/features/summary/SummaryPage';
import { DiffsPage } from '@/features/diffs/DiffsPage';
import { DiffDetailPage } from '@/features/diffs/DiffDetailPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { MonitorPage } from '@/features/monitor/MonitorPage';

/**
 * micro-app 嵌入模式：壳子提供导航，本应用仅渲染页面区。
 * 必须提供与独立模式 <main className="flex-1 overflow-auto"> 等价的滚动容器，
 * 否则 iframe 内 html/body/#root 虽已高度 100%、但内容溢出无处可滚。
 * 注意：高度用 h-full（跟随 #root height:100% 链条），不要用 h-screen/100svh——
 * 旧内核或 WebView 对 svh 单位解析失败会退回 height:auto，滚动容器被内容撑开后
 * overflow-auto 永不触发，出现"内容超高却滚不动"。
 */
function MicroLayout() {
  return (
    <div className="h-full overflow-auto p-5">
      <Outlet />
    </div>
  );
}

/**
 * micro-app 嵌入模式：
 * - basename 由壳子下发（__MICRO_APP_BASE_ROUTE__，如 /remote/recon），否则独立运行用 /
 * - 嵌入时壳子提供导航，本应用只渲染页面区（不套 AppLayout）
 */
const IS_MICRO = Boolean(window.__MICRO_APP_ENVIRONMENT__);
const BASENAME = window.__MICRO_APP_BASE_ROUTE__ ?? '/';

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: IS_MICRO ? <MicroLayout /> : <AppLayout />,
      children: [
        { index: true, element: <Navigate to="summary" replace /> },
        { path: 'summary', element: <SummaryPage /> },
        { path: 'connections', element: <ConnectionsPage /> },
        { path: 'datasources', element: <DatasourcesPage /> },
        { path: 'scenarios', element: <ScenariosPage /> },
        { path: 'diffs', element: <DiffsPage /> },
        { path: 'diffs/:id', element: <DiffDetailPage /> },
        { path: 'reports', element: <ReportsPage /> },
        { path: 'monitor', element: <MonitorPage /> },
      ],
    },
  ],
  { basename: BASENAME },
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
