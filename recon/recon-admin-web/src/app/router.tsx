import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PAGE_ROUTES } from '@/app/routes';

/**
 * basename 由壳子下发（__MICRO_APP_BASE_ROUTE__，如 /remote/recon），独立运行用 /。
 *
 * <p>嵌入与独立运行使用同一套 AppLayout（自带侧栏 + 页内多 Tab）：壳子在 /remote/*
 * 下已隐藏自己的侧栏与 Tab 栏，菜单、权限过滤、多 Tab 全由本应用负责。
 *
 * <p>高度用 h-full（#root height:100% 链条），不要用 h-screen/100svh——旧内核或 WebView
 * 解析 svh 失败会退回 height:auto，滚动容器被内容撑开后 overflow-auto 永不触发。
 */
const BASENAME = window.__MICRO_APP_BASE_ROUTE__ ?? '/';

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [{ index: true, element: <Navigate to="summary" replace /> }, ...PAGE_ROUTES],
    },
  ],
  { basename: BASENAME },
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
