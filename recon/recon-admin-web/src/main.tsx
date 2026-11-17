import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRouter } from '@/app/router';
import { queryClient } from '@/lib/query/query-client';
import { Toaster } from '@/components/ui/sonner';
import { setAuthToken } from '@/lib/api/client';
import { permissionsApi } from '@/lib/api/permissions';
import { setPermissions, setSession, type AuthUser } from '@/stores/auth-store';
import '@/styles/globals.css';

let lastPermissionToken = '';

/**
 * 后端权威校正：壳子经 setData 下发的 permissions 只作**首屏缓存**，这里再向平台
 * 拉一次当前用户的权限码覆盖它。收益：壳内与独立入口拿到同一份数据（不再依赖宿主
 * 快照时效），角色变更后重新进入即可生效。拉取失败保留下发快照，不阻塞渲染。
 */
async function refreshPermissions(token: string) {
  if (!token || token === lastPermissionToken) return;
  lastPermissionToken = token;
  try {
    setPermissions(await permissionsApi.mine());
  } catch {
    lastPermissionToken = ''; // 失败允许下次会话事件重试
  }
}

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
    void refreshPermissions(token);
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
