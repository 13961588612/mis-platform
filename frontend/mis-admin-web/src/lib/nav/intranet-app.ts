import { toast } from 'sonner';
import type { AppItem } from '@/types/api';
import { resolveAppEntry } from '@/lib/nav/host-apps';
import { remoteCodeFromPath, resolveRemoteEntry } from '@/lib/nav/remote-apps';

export const INTRANET_ONLY_LABEL = '仅内网访问';

export const INTRANET_ONLY_HINT = '该应用仅限内网访问，请在公司网络或 VPN 下打开';

let catalog: AppItem[] = [];

/** 门户 / 壳子拉到 sys_app 清单后写入，供待办/消息跳转与路由守卫共用。 */
export function setAppCatalog(apps: AppItem[]) {
  catalog = apps;
}

export function getAppCatalog(): AppItem[] {
  return catalog;
}

export function appFromCatalog(code: string | null | undefined): AppItem | undefined {
  if (!code) return undefined;
  return catalog.find((a) => a.code === code);
}

export function isIntranetAppBlocked(app: Pick<AppItem, 'intranetOnly' | 'enterable'> | undefined): boolean {
  return Boolean(app?.intranetOnly && !app.enterable);
}

/** 从壳子路径解析应用 code：`/remote/{code}`、`/iframe/{code}`，或匹配 basePath。 */
export function appCodeFromPath(pathname: string): string | null {
  const path = pathname.startsWith('http') ? new URL(pathname).pathname : pathname;
  const remote = remoteCodeFromPath(path);
  if (remote) return remote;
  if (path.startsWith('/iframe/')) {
    const code = path.slice('/iframe/'.length).split('/')[0];
    return code || null;
  }
  for (const app of catalog) {
    const base = app.basePath?.trim();
    if (!base || !base.startsWith('/')) continue;
    if (path === base || path.startsWith(`${base}/`)) return app.code;
  }
  return null;
}

export function isIntranetPathBlocked(pathname: string): boolean {
  return isIntranetAppBlocked(appFromCatalog(appCodeFromPath(pathname)));
}

export function navigateIntoApp(navigate: (to: string) => void, app: AppItem): void {
  if (app.runtime === 'iframe' && app.basePath) {
    navigate(`/iframe/${app.code}`);
    return;
  }
  if (app.runtime === 'remote') {
    navigate(resolveRemoteEntry(app.code));
    return;
  }
  navigate(resolveAppEntry(app.code, app.basePath));
}

/** 非内网点仅内网应用：提示且不进入。即将上线仍由调用方 disabled。 */
export function tryEnterApp(app: AppItem, enter: (app: AppItem) => void): void {
  if (isIntranetAppBlocked(app)) {
    toast.error(INTRANET_ONLY_HINT);
    return;
  }
  if (!app.enterable) return;
  enter(app);
}

/** 待办/消息按 app_code 跳进应用；清单未就绪时不跳，避免绕过守卫。 */
export function tryEnterAppByCode(code: string | null | undefined, enter: (app: AppItem) => void): boolean {
  if (!code) return false;
  const app = appFromCatalog(code);
  if (!app) {
    toast.error('应用入口暂不可用，请稍后重试');
    return false;
  }
  tryEnterApp(app, enter);
  return true;
}

/**
 * 路由级守卫：当前 path 指向仅内网应用且本机不在内网时，回门户并提示。
 * @returns 是否拦截
 */
export function guardIntranetLocation(
  pathname: string,
  navigate: (to: string, opts?: { replace?: boolean }) => void,
): boolean {
  if (!isIntranetPathBlocked(pathname)) return false;
  toast.error(INTRANET_ONLY_HINT);
  navigate('/portal', { replace: true });
  return true;
}
