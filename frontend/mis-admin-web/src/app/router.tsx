import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from '@/components/auth/protected-route';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/features/auth/login-page';
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { ProcessBarePage } from '@/features/taskflow/process-bare-page';
import { bootstrapSession } from '@/lib/auth/bootstrap';
import { useAuthStore } from '@/stores/auth-store';
import { AIProvider } from '@/features/ai/ai-context';

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const menus = useAuthStore((s) => s.menus);
  const [ready, setReady] = useState(!isAuthenticated || menus.length > 0);

  // 是否已在本次整页加载中引导过一次。用 ref 而非 state：它只做幂等守卫，
  // 触发重渲染没有意义，且必须在 `menus` 变化时仍保持「本页已引导」的判定。
  const bootedRef = useRef(false);

  /**
   * 已登录会话在**每次整页加载**都刷新一次 permissions + menus。
   *
   * <p><b>为什么不能再用 `menus.length > 0` 早退</b>：`auth-store` 是 zustand `persist`
   * （`partialize` 含 `permissions` + `menus`）。登录后 `menus` 落 localStorage，此后每次
   * 刷新页面都会命中 `menus.length > 0` 而**跳过** {@link bootstrapSession} ⇒ `permissions`
   * 永远是上次登录时的旧集合（例如 V140 授权前的那份）。`PermissionGate` 据此把「业务分类」
   * 菜单的新增 / 编辑 / 删除按钮全部隐藏，用户看到的就是「没有编辑按钮」——只有清 localStorage
   * 或重新登录才恢复。这是真缺陷，故改为按「每页加载只引导一次」的语义刷新权限。
   *
   * <p>体验保留：已有缓存 `menus` 时先 `setReady(true)` 立即渲染，避免白屏「加载会话…」；
   * 后台仍会拉取并覆盖为最新 `permissions` / `menus`。`bootedRef` 保证只引导一次，
   * 即便依赖数组含 `menus.length`、`bootstrapSession` 落库后触发重渲染也不会重复引导。
   */
  useEffect(() => {
    if (!isAuthenticated) {
      bootedRef.current = false; // 登出后重置，便于再次登录重新引导
      setReady(true);
      return;
    }
    if (bootedRef.current) return;
    if (menus.length > 0) setReady(true); // 有缓存：先渲染，避免白屏
    bootedRef.current = true;
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
            {/* 流程裸页：抽屉「在完整页打开」新标签用，无 AppLayout 壳（顶栏/侧栏/Tab） */}
            <Route path="/task/process-view/:id" element={<ProcessBarePage />} />
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
