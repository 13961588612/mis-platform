import type { RouteObject } from 'react-router-dom';
import { ConnectionsPage } from '@/features/connections/ConnectionsPage';
import { DatasourcesPage } from '@/features/datasources/DatasourcesPage';
import { ScenariosPage } from '@/features/scenarios/ScenariosPage';
import { SummaryPage } from '@/features/summary/SummaryPage';
import { DiffsPage } from '@/features/diffs/DiffsPage';
import { DiffDetailPage } from '@/features/diffs/DiffDetailPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { MonitorPage } from '@/features/monitor/MonitorPage';

/**
 * 页面路由表：router（createBrowserRouter）与 Tab 保活容器（matchRoutes）共用，
 * 避免两处各维护一份「路径 → 组件」映射。
 */
export const PAGE_ROUTES: RouteObject[] = [
  { path: 'connections', element: <ConnectionsPage /> },
  { path: 'datasources', element: <DatasourcesPage /> },
  { path: 'scenarios', element: <ScenariosPage /> },
  { path: 'summary', element: <SummaryPage /> },
  { path: 'diffs', element: <DiffsPage /> },
  { path: 'diffs/:id', element: <DiffDetailPage /> },
  { path: 'reports', element: <ReportsPage /> },
  { path: 'monitor', element: <MonitorPage /> },
];
