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
 * remote 子应用入口（构建期注入）。
 *
 * <p>网关 {@code /apps} 目前不返回 {@code entry}（AppView 无该字段），因此这里是**唯一**
 * 入口来源：生产构建须显式传 `VITE_RECON_ENTRY`，例如
 * `VITE_RECON_ENTRY=http://10.254.26.34/recon/`；未传时回落到本地 dev 地址。
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
 * remote 子应用默认落地页（进入应用但无历史 Tab 时使用）。
 *
 * <p>直接落到与子应用首页一致的路由，避免先开一个 `/remote/{code}` 空 Tab、
 * 再由子应用 `index → 首页` 重定向多开一个 Tab。
 */
const DEV_DEFAULT_LANDING: Record<string, string> = {
  recon: '/remote/recon/summary',
};

/**
 * 解析 remote 应用入口路径：子应用默认落地页，未登记则回退应用根。
 *
 * <p>壳子不再为 remote 子应用记录 Tab（页内 Tab 由子应用自己管理），
 * 故这里不再读壳子 tab store 的「上次激活路径」。
 *
 * @param code 应用编码（sys_app.code）
 */
export function resolveRemoteEntry(code: string): string {
  return DEV_DEFAULT_LANDING[code] ?? `/remote/${code}`;
}
