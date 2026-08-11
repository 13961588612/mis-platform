import { create } from 'zustand';
import { DEFAULT_TAB_APP_CODE } from '@/lib/tabs-config';

export interface WorkspaceTab {
  id: string;
  path: string;
  title: string;
  icon?: string | null;
  pinned?: boolean;
  /** 归属 APP（sys_app.code）。缺省视为 system（历史 tab / 初始 pinned 仪表盘）。 */
  appCode?: string;
}

interface TabState {
  tabs: WorkspaceTab[];
  activeId: string | null;
  /** 各 APP 上次激活的 path；切 APP 时优先恢复。 */
  lastActivePathByApp: Record<string, string>;
  openTab: (tab: Omit<WorkspaceTab, 'id'> & { id?: string }) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => string | null;
  closeOthers: (id: string) => void;
  closeAll: () => string | null;
  setActiveByPath: (path: string) => void;
  /** 该 APP 上次打开且仍存在的 tab path；没有则 null。 */
  getLastActivePath: (appCode: string) => string | null;
}

function tabId(path: string) {
  return path;
}

function tabAppCode(tab: Pick<WorkspaceTab, 'appCode'> | undefined): string {
  return tab?.appCode ?? DEFAULT_TAB_APP_CODE;
}

function withLastActive(
  lastActivePathByApp: Record<string, string>,
  appCode: string,
  path: string,
): Record<string, string> {
  if (lastActivePathByApp[appCode] === path) return lastActivePathByApp;
  return { ...lastActivePathByApp, [appCode]: path };
}

export const useTabStore = create<TabState>()((set, get) => ({
  tabs: [
    {
      id: '/dashboard',
      path: '/dashboard',
      title: '仪表盘',
      icon: 'LayoutDashboard',
      pinned: true,
      appCode: DEFAULT_TAB_APP_CODE,
    },
  ],
  activeId: '/dashboard',
  lastActivePathByApp: { [DEFAULT_TAB_APP_CODE]: '/dashboard' },

  openTab: (tab) => {
    const id = tab.id ?? tabId(tab.path);
    set((state) => {
      const exists = state.tabs.find((t) => t.id === id);
      const appCode = tab.appCode ?? tabAppCode(exists);
      if (exists) {
        return {
          activeId: id,
          lastActivePathByApp: withLastActive(state.lastActivePathByApp, appCode, exists.path),
          tabs: state.tabs.map((t) =>
            t.id === id
              ? {
                  ...t,
                  title: tab.title || t.title,
                  icon: tab.icon ?? t.icon,
                  pinned: tab.pinned ?? t.pinned,
                  appCode: tab.appCode ?? t.appCode,
                }
              : t,
          ),
        };
      }
      return {
        tabs: [
          ...state.tabs,
          {
            ...tab,
            id,
            pinned: tab.pinned ?? false,
            appCode,
          },
        ],
        activeId: id,
        lastActivePathByApp: withLastActive(state.lastActivePathByApp, appCode, tab.path),
      };
    });
  },

  activateTab: (id) => {
    const hit = get().tabs.find((t) => t.id === id);
    if (!hit) {
      set({ activeId: id });
      return;
    }
    set((state) => ({
      activeId: id,
      lastActivePathByApp: withLastActive(state.lastActivePathByApp, tabAppCode(hit), hit.path),
    }));
  },

  closeTab: (id) => {
    const { tabs, activeId, lastActivePathByApp } = get();
    const target = tabs.find((t) => t.id === id);
    if (!target || target.pinned) return activeId;
    const idx = tabs.findIndex((t) => t.id === id);
    const nextTabs = tabs.filter((t) => t.id !== id);
    let nextActive = activeId;
    if (activeId === id) {
      const neighbor = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0] ?? null;
      nextActive = neighbor?.id ?? null;
    }
    const nextLast = { ...lastActivePathByApp };
    if (nextLast[tabAppCode(target)] === target.path) {
      const nextHit = nextTabs.find((t) => t.id === nextActive);
      if (nextHit && tabAppCode(nextHit) === tabAppCode(target)) {
        nextLast[tabAppCode(target)] = nextHit.path;
      } else {
        const sameApp = nextTabs.find((t) => tabAppCode(t) === tabAppCode(target));
        if (sameApp) nextLast[tabAppCode(target)] = sameApp.path;
        else delete nextLast[tabAppCode(target)];
      }
    }
    set({ tabs: nextTabs, activeId: nextActive, lastActivePathByApp: nextLast });
    return nextActive;
  },

  closeOthers: (id) => {
    set((state) => {
      const keep = state.tabs.filter((t) => t.pinned || t.id === id);
      const hit = keep.find((t) => t.id === id);
      const nextLast = { ...state.lastActivePathByApp };
      for (const t of keep) {
        // 每个仍存在的 APP 至少保留一个可见 path（当前或 pinned）
        if (t.id === id || t.pinned) {
          nextLast[tabAppCode(t)] = t.path;
        }
      }
      // 清掉已无 tab 的 APP 记忆
      for (const code of Object.keys(nextLast)) {
        if (!keep.some((t) => tabAppCode(t) === code)) delete nextLast[code];
      }
      if (hit) nextLast[tabAppCode(hit)] = hit.path;
      return { tabs: keep, activeId: id, lastActivePathByApp: nextLast };
    });
  },

  closeAll: () => {
    const pinned = get().tabs.filter((t) => t.pinned);
    const next = pinned[0]?.id ?? null;
    const nextLast: Record<string, string> = {};
    for (const t of pinned) {
      nextLast[tabAppCode(t)] = t.path;
    }
    set({ tabs: pinned, activeId: next, lastActivePathByApp: nextLast });
    return next;
  },

  setActiveByPath: (path) => {
    const hit = get().tabs.find((t) => t.path === path);
    if (!hit) return;
    set((state) => ({
      activeId: hit.id,
      lastActivePathByApp: withLastActive(state.lastActivePathByApp, tabAppCode(hit), hit.path),
    }));
  },

  getLastActivePath: (appCode) => {
    const { lastActivePathByApp, tabs } = get();
    const last = lastActivePathByApp[appCode];
    if (!last) return null;
    const stillOpen = tabs.some((t) => t.path === last && tabAppCode(t) === appCode);
    return stillOpen ? last : null;
  },
}));
