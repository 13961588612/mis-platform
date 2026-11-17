import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PAGE_ROUTES } from '@/app/routes';

/**
 * basename 由壳子下发（__MICRO_APP_BASE_ROUTE__，如 /remote/recon）。
 *
 * <p>独立/子路径部署（如 Nginx 的 /recon/）时取构建期 base（VITE_BASE，见 vite.config.ts），
 * 与资源前缀保持一致；根路径部署时为 /。
 *
 * <p>嵌入与独立运行使用同一套 AppLayout（自带侧栏 + 页内多 Tab）：壳子在 /remote/*
 * 下已隐藏自己的侧栏与 Tab 栏，菜单、权限过滤、多 Tab 全由本应用负责。
 *
 * <p>高度用 h-full（#root height:100% 链条），不要用 h-screen/100svh——旧内核或 WebView
 * 解析 svh 失败会退回 height:auto，滚动容器被内容撑开后 overflow-auto 永不触发。
 */
const BASENAME =
  window.__MICRO_APP_BASE_ROUTE__ || import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

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
