import { useSyncExternalStore } from 'react';

/**
 * 页内多 Tab 状态（壳内 micro-app 嵌入 + 独立运行共用）。
 *
 * <p>零依赖轻量 store（useSyncExternalStore + 发布订阅），与 auth-store 同风格。
 * Tab 以 pathname 为唯一键：同一路径重复点击只激活、不新增。
 */
export interface WorkspaceTab {
  /** 路由路径（pathname），Tab 唯一键 */
  path: string;
  title: string;
}

interface TabState {
  tabs: WorkspaceTab[];
  activePath: string;
}

let state: TabState = { tabs: [], activePath: '' };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TabState {
  return state;
}

function setState(next: TabState) {
  state = next;
  listeners.forEach((l) => l());
}

/** 打开并激活 Tab；已存在则只刷新标题并激活 */
export function openTab(tab: WorkspaceTab) {
  const exists = state.tabs.some((t) => t.path === tab.path);
  const tabs = exists
    ? state.tabs.map((t) => (t.path === tab.path ? { ...t, title: tab.title } : t))
    : [...state.tabs, tab];
  setState({ tabs, activePath: tab.path });
}

/** 关闭 Tab；若关闭的是激活 Tab，返回应跳转的相邻 Tab 路径，否则返回 undefined */
export function closeTab(path: string): string | undefined {
  const idx = state.tabs.findIndex((t) => t.path === path);
  if (idx < 0) return undefined;
  const wasActive = state.activePath === path;
  const tabs = state.tabs.filter((t) => t.path !== path);
  const activePath = wasActive
    ? tabs[Math.min(idx, tabs.length - 1)]?.path ?? ''
    : state.activePath;
  setState({ tabs, activePath });
  return wasActive ? activePath : undefined;
}

export function useTabStore<T>(selector: (s: TabState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
