import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from '@/components/auth/protected-route';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/features/auth/login-page';
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { bootstrapSession } from '@/lib/auth/bootstrap';
import { useAuthStore } from '@/stores/auth-store';
import { AIProvider } from '@/features/ai/ai-context';

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const menus = useAuthStore((s) => s.menus);
  const [ready, setReady] = useState(!isAuthenticated || menus.length > 0);

  useEffect(() => {
    if (!isAuthenticated) {
      setReady(true);
      return;
    }
    if (menus.length > 0) {
      setReady(true);
      return;
    }
    void bootstrapSession()
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [isAuthenticated, menus.length]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        加载会话…
      </div>
    );
  }
  // AIProvider 需在 Router 上下文内（消费 useLocation）；挂载于应用根，承载门禁/健康/降级
  return <AIProvider>{children}</AIProvider>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <SessionBootstrap>
        <Routes>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            {/* 子路由仅作路径匹配；页面由 AppLayout 内 KeepAliveOutlet 渲染 */}
            <Route element={<AppLayout />}>
              {/* P0-5：/portal 归位进 AppLayout（此前裸挂，自造了一套 header）。
                  页面组件由 KeepAliveOutlet 的 PAGE_MAP 解析（'/portal' -> PortalPage），
                  故element 为 null，与 /task/* 等同构。 */}
              <Route path="/portal" element={null} />
              <Route path="/dashboard" element={null} />
              <Route path="/system/*" element={null} />
              <Route path="/monitor/*" element={null} />
              <Route path="/task/*" element={null} />
              <Route path="/kb/*" element={null} />
              <Route path="/agent/*" element={null} />
              {/* V77：问数独立门户应用 /iqd/*（保留 /ai/* 容纳其余存量页） */}
              <Route path="/iqd/*" element={null} />
              <Route path="/finance/*" element={null} />
              {/* T09/T10：存量页迁移（ai-platform 后端，懒加载页面由 KeepAliveOutlet 渲染） */}
              <Route path="/ai/*" element={null} />
              <Route path="/iframe/:code" element={null} />
              <Route path="/403" element={null} />
            </Route>
          </Route>
          <Route path="/" element={<Navigate to="/portal" replace />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Routes>
      </SessionBootstrap>
    </BrowserRouter>
  );
}
