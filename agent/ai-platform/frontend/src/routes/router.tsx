/**
 * Router — Main route configuration for the application.
 *
 * Uses React Router v6 Routes API to define the complete route tree.
 * Includes an authentication guard wrapper that redirects unauthenticated
 * users to the login page.
 */

import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ROUTE_PATHS } from "./routeConfig";
import { getRouteDefinitions } from "./AppRoutes";
import { useAuthStore } from "../store/authStore";

// ===== Auth Guard =====

/** iframe / ?embed=1：等待父页 postMessage 推令牌，避免抢先跳登录页 */
function isEmbedMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("embed") === "1") return true;
    return window.self !== window.top;
  } catch {
    // cross-origin 访问 top 可能抛错 → 视为嵌入
    return true;
  }
}

/**
 * Wrap a route element with an authentication check.
 * If the user is not authenticated, redirect to /login.
 * 嵌入模式下先等待 AUTH_TOKEN，超时后提示而非跳登录。
 */
function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const embed = isEmbedMode();
  const [waitTimedOut, setWaitTimedOut] = useState(false);

  useEffect(() => {
    if (!embed || isAuthenticated) return;
    const t = window.setTimeout(() => setWaitTimedOut(true), 10_000);
    return () => window.clearTimeout(t);
  }, [embed, isAuthenticated]);

  if (!isAuthenticated) {
    if (embed && !waitTimedOut) {
      return (
        <div className="flex h-full min-h-[12rem] items-center justify-center bg-surface-muted px-4 text-center text-sm text-surface-dark/60">
          正在同步管理台登录态…
        </div>
      );
    }
    if (embed && waitTimedOut) {
      return (
        <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 bg-surface-muted px-4 text-center text-sm text-surface-dark/70">
          <p>未能获取管理台登录态。</p>
          <p className="text-xs text-surface-dark/50">
            请确认已登录 MIS，且 H5 已配置 VITE_PARENT_ORIGINS、网关已挂载 MIS 公钥。
          </p>
        </div>
      );
    }
    return (
      <Navigate
        to={ROUTE_PATHS.LOGIN}
        replace
        state={{ from: window.location.pathname }}
      />
    );
  }

  return children;
}

// ===== Router Component =====

/**
 * Router — renders all application routes.
 *
 * Public routes (login, root redirect, fallback) are rendered directly.
 * Protected routes are wrapped in <RequireAuth> to enforce authentication.
 */
export function Router(): JSX.Element {
  const routes = getRouteDefinitions();

  return (
    <Routes>
      {routes.map((route) => {
        if (route.isPublic) {
          return (
            <Route
              key={route.path}
              path={route.path}
              element={route.element}
            />
          );
        }
        return (
          <Route
            key={route.path}
            path={route.path}
            element={<RequireAuth>{route.element}</RequireAuth>}
          />
        );
      })}
    </Routes>
  );
}

export default Router;
