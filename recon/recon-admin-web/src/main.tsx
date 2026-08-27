import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRouter } from '@/app/router';
import { queryClient } from '@/lib/query/query-client';
import { Toaster } from '@/components/ui/sonner';
import { setAuthToken } from '@/lib/api/client';
import { setSession, type AuthUser } from '@/stores/auth-store';
import '@/styles/globals.css';

// micro-app 嵌入模式：接收壳子下发的会话数据（{ type: 'AUTH_TOKEN', token, user, permissions }）。
// 独立运行（pnpm dev 直接访问）时无此全局，跳过。
function applyAuthData(data: Record<string, unknown> | undefined) {
  if (data && data.type === 'AUTH_TOKEN') {
    const token = String(data.token ?? '');
    setAuthToken(token);
    setSession(
      token,
      (data.user as AuthUser | undefined) ?? null,
      Array.isArray(data.permissions) ? (data.permissions as string[]) : []
    );
  }
}

if (window.__MICRO_APP_ENVIRONMENT__ && window.microApp) {
  applyAuthData(window.microApp.getData?.());
  window.microApp.addDataListener(applyAuthData);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <Toaster />
    </QueryClientProvider>
  </React.StrictMode>
);
