import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from '@/components/auth/protected-route';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/features/auth/login-page';
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { PortalPage } from '@/features/portal/portal-page';
import { bootstrapSession } from '@/lib/auth/bootstrap';
import { useAuthStore } from '@/stores/auth-store';

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
  return <>{children}</>;
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
            <Route path="/portal" element={<PortalPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            {/* 子路由仅作路径匹配；页面由 AppLayout 内 KeepAliveOutlet 渲染 */}
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={null} />
              <Route path="/system/*" element={null} />
              <Route path="/monitor/*" element={null} />
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
