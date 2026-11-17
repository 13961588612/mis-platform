import { Route, Routes, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTabStore } from '@/stores/tab-store';
import { PAGE_ROUTES } from '@/app/routes';

/**
 * 单个 Tab 面板：用 `<Routes location>` 建立**独立的路由上下文**。
 *
 * <p>不能直接渲染 route.element——那样 useParams 会读「当前激活路由」的匹配结果，
 * 保活的非激活详情页（如 /diffs/:id）会拿到错的 id。
 */
function TabPanel({ path, active }: { path: string; active: boolean }) {
  return (
    <div
      aria-hidden={!active}
      className={cn(
        'absolute inset-0 overflow-auto p-5',
        active ? 'z-10' : 'pointer-events-none z-0 hidden',
      )}
    >
      <Routes location={path}>
        {PAGE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Routes>
    </div>
  );
}

/**
 * Tab 保活容器：已打开的 Tab 全部挂载，非激活 Tab 用 display:none 隐藏；
 * 关闭 Tab 才卸载（组件状态与未提交表单随 Tab 保留）。
 */
export function KeepAliveOutlet() {
  const location = useLocation();
  const tabs = useTabStore((s) => s.tabs);
  const paths = [...new Set([...tabs.map((t) => t.path), location.pathname])];

  return (
    <div className="relative h-full min-h-0">
      {paths.map((path) => (
        <TabPanel key={path} path={path} active={path === location.pathname} />
      ))}
    </div>
  );
}
