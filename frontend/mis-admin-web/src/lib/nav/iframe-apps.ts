import { useSyncExternalStore } from 'react';
import type { AppItem } from '@/types/api';

export interface IframeAppMeta {
  code: string;
  title: string;
  icon: string;
  basePath: string;
}

const registry = new Map<string, IframeAppMeta>();
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

/** 注册 runtime === 'iframe' 的子应用（门户 / AppLayout 拉清单后调用） */
export function registerIframeApps(apps: AppItem[]) {
  let changed = false;
  for (const a of apps) {
    if (a.runtime !== 'iframe' || !a.basePath) continue;
    const next: IframeAppMeta = {
      code: a.code,
      title: a.name,
      icon: a.icon ?? 'Globe',
      basePath: a.basePath,
    };
    const prev = registry.get(a.code);
    if (
      !prev ||
      prev.basePath !== next.basePath ||
      prev.title !== next.title ||
      prev.icon !== next.icon
    ) {
      registry.set(a.code, next);
      changed = true;
    }
  }
  if (changed) emit();
}

export function getIframeApp(code: string): IframeAppMeta | undefined {
  return registry.get(code);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return version;
}

/** 订阅 iframe 注册表变更，保证 register 后 KeepAliveOutlet 会重渲染 */
export function useIframeRegistryVersion() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
