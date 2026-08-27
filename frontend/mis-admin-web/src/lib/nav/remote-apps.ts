import { useSyncExternalStore } from 'react';
import type { AppItem } from '@/types/api';

/** micro-app 远程子应用（runtime='remote'）元信息 */
export interface RemoteAppMeta {
  code: string;
  title: string;
  icon: string;
  /** 子应用独立部署入口（HTML 地址，如 http://localhost:5174/） */
  entry: string;
}

const registry = new Map<string, RemoteAppMeta>();
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

/**
 * 本地联调兜底入口：sys_app 未注册 / 后端未暴露 entry 时也能跑通。
 * 生产以 sys_app 数据为准（后端暴露 mfeRemote 后经 registerRemoteApps 覆盖）。
 */
const DEV_ENTRY: Record<string, string> = {
  recon: (import.meta.env.VITE_RECON_ENTRY as string | undefined)?.trim() || 'http://localhost:5176',
};

/** 注册 runtime === 'remote' 的子应用（门户 / AppLayout 拉清单后调用） */
export function registerRemoteApps(apps: AppItem[]) {
  let changed = false;
  for (const a of apps) {
    if (a.runtime !== 'remote') continue;
    const entry = (a.entry ?? DEV_ENTRY[a.code])?.trim();
    if (!entry) continue;
    const next: RemoteAppMeta = {
      code: a.code,
      title: a.name,
      icon: a.icon ?? 'Globe',
      entry,
    };
    const prev = registry.get(a.code);
    if (!prev || prev.entry !== next.entry || prev.title !== next.title) {
      registry.set(a.code, next);
      changed = true;
    }
  }
  if (changed) emit();
}

export function getRemoteApp(code: string): RemoteAppMeta | undefined {
  const hit = registry.get(code);
  if (hit) return hit;
  const entry = DEV_ENTRY[code];
  if (entry) return { code, title: code, icon: 'Globe', entry };
  return undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return version;
}

/** 订阅 remote 注册表变更，保证 register 后 KeepAliveOutlet 会重渲染 */
export function useRemoteRegistryVersion() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 从路径解析 remote 应用 code：/remote/{code}[/...] → code；非 remote 路径返回 null */
export function remoteCodeFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/remote/')) return null;
  const code = pathname.slice('/remote/'.length).split('/')[0];
  return code || null;
}

/**
 * 把 remote 子路径归一为应用根路径：/remote/recon/connections → /remote/recon。
 * 保证一个 remote 应用只占用一个 Tab、只挂载一个 <micro-app> 实例（micro-app 不允许同名多实例）。
 */
export function normalizeRemotePath(pathname: string): string {
  const code = remoteCodeFromPath(pathname);
  return code ? `/remote/${code}` : pathname;
}
