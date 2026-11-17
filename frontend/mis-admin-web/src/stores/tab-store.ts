import { create } from 'zustand';
import { DEFAULT_TAB_APP_CODE } from '@/lib/tabs-config';
import { resolveWorkspaceTabId } from '@/lib/workspace-tab-id';

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
  /** 全局最近激活顺序（id，新→旧）；关 Tab 时优先同 APP 回退。 */
  recentTabIds: string[];
  openTab: (tab: Omit<WorkspaceTab, 'id'> & { id?: string }) => void;
  activateTab: (id: string) => void;
  /** 关闭后返回下一激活 Tab 的 **path**（供 navigate）；无则 null。 */
  closeTab: (id: string) => string | null;
  closeOthers: (id: string) => void;
  /** 关闭全部后返回仍保留的 pinned Tab 的 **path**；无则 null。 */
  closeAll: () => string | null;
  setActiveByPath: (path: string) => void;
  /** 该 APP 上次打开且仍存在的 tab path；没有则 null。 */
  getLastActivePath: (appCode: string) => string | null;
}

function tabId(path: string) {
  return resolveWorkspaceTabId(path);
}

/** 取下一激活 Tab 的导航 path（id 可能因详情族合并而不等于 path）。 */
function pathOf(tabs: WorkspaceTab[], id: string | null): string | null {
  if (!id) return null;
  return tabs.find((t) => t.id === id)?.path ?? id;
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

/** 把 id 顶到最近激活列表头部（去重）。 */
function touchRecent(recentTabIds: string[], id: string): string[] {
  return [id, ...recentTabIds.filter((x) => x !== id)];
}

/** 关闭当前 Tab 后选下一激活：同 APP 最近打开 > 同 APP 任意 > 邻接回退。 */
function pickNextActiveAfterClose(
  closed: WorkspaceTab,
  closedIdx: number,
  nextTabs: WorkspaceTab[],
  recentTabIds: string[],
): string | null {
  const app = tabAppCode(closed);
  for (const rid of recentTabIds) {
    if (rid === closed.id) continue;
    const hit = nextTabs.find((t) => t.id === rid);
    if (hit && tabAppCode(hit) === app) return hit.id;
  }
  const sameApp = nextTabs.find((t) => tabAppCode(t) === app);
  if (sameApp) return sameApp.id;
  const neighbor = nextTabs[Math.max(0, closedIdx - 1)] ?? nextTabs[0] ?? null;
  return neighbor?.id ?? null;
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
  recentTabIds: ['/dashboard'],

  openTab: (tab) => {
    const id = tab.id ?? tabId(tab.path);
    set((state) => {
      const exists = state.tabs.find((t) => t.id === id);
      const appCode = tab.appCode ?? tabAppCode(exists);
      // 同族旧 Tab（修复前按完整 path 开出的残留）一并清掉，避免顶栏仍挂着多余项
      const withoutFamilyDupes = state.tabs.filter(
        (t) => t.id === id || resolveWorkspaceTabId(t.path) !== id,
      );
      if (exists) {
        return {
          activeId: id,
          lastActivePathByApp: withLastActive(state.lastActivePathByApp, appCode, tab.path),
          recentTabIds: touchRecent(state.recentTabIds, id),
          tabs: withoutFamilyDupes.map((t) =>
            t.id === id
              ? {
                  ...t,
                  // 详情二级 Tab 切 URL 时复用同一主 Tab，path 必须跟着走
                  path: tab.path,
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
          ...withoutFamilyDupes,
          {
            ...tab,
            id,
            pinned: tab.pinned ?? false,
            appCode,
          },
        ],
        activeId: id,
        lastActivePathByApp: withLastActive(state.lastActivePathByApp, appCode, tab.path),
        recentTabIds: touchRecent(state.recentTabIds, id),
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
      recentTabIds: touchRecent(state.recentTabIds, id),
    }));
  },

  closeTab: (id) => {
    const { tabs, activeId, lastActivePathByApp, recentTabIds } = get();
    const target = tabs.find((t) => t.id === id);
    if (!target || target.pinned) return pathOf(tabs, activeId);
    const idx = tabs.findIndex((t) => t.id === id);
    const nextTabs = tabs.filter((t) => t.id !== id);
    const nextRecent = recentTabIds.filter((rid) => rid !== id);
    let nextActive = activeId;
    if (activeId === id) {
      nextActive = pickNextActiveAfterClose(target, idx, nextTabs, nextRecent);
    }
    const nextLast = { ...lastActivePathByApp };
    const closedApp = tabAppCode(target);
    const nextHit = nextTabs.find((t) => t.id === nextActive);
    if (nextHit && tabAppCode(nextHit) === closedApp) {
      nextLast[closedApp] = nextHit.path;
    } else if (nextLast[closedApp] === target.path || !nextTabs.some((t) => tabAppCode(t) === closedApp)) {
      const sameApp = nextTabs.find((t) => tabAppCode(t) === closedApp);
      if (sameApp) nextLast[closedApp] = sameApp.path;
      else delete nextLast[closedApp];
    }
    set({
      tabs: nextTabs,
      activeId: nextActive,
      lastActivePathByApp: nextLast,
      recentTabIds: nextActive ? touchRecent(nextRecent, nextActive) : nextRecent,
    });
    return pathOf(nextTabs, nextActive);
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
      const keepIds = new Set(keep.map((t) => t.id));
      return {
        tabs: keep,
        activeId: id,
        lastActivePathByApp: nextLast,
        recentTabIds: touchRecent(
          state.recentTabIds.filter((rid) => keepIds.has(rid)),
          id,
        ),
      };
    });
  },

  closeAll: () => {
    const pinned = get().tabs.filter((t) => t.pinned);
    const next = pinned[0]?.id ?? null;
    const nextLast: Record<string, string> = {};
    for (const t of pinned) {
      nextLast[tabAppCode(t)] = t.path;
    }
    set({
      tabs: pinned,
      activeId: next,
      lastActivePathByApp: nextLast,
      recentTabIds: pinned.map((t) => t.id),
    });
    return pathOf(pinned, next);
  },

  setActiveByPath: (path) => {
    const id = resolveWorkspaceTabId(path);
    const hit =
      get().tabs.find((t) => t.path === path) ?? get().tabs.find((t) => t.id === id) ?? null;
    if (!hit) return;
    set((state) => ({
      activeId: hit.id,
      lastActivePathByApp: withLastActive(state.lastActivePathByApp, tabAppCode(hit), path),
      recentTabIds: touchRecent(state.recentTabIds, hit.id),
      // 按 path 激活时若命中同族主 Tab，同步 path（深链进 skills 等）
      tabs: state.tabs.map((t) => (t.id === hit.id ? { ...t, path } : t)),
    }));
  },

  getLastActivePath: (appCode) => {
    const { lastActivePathByApp, tabs } = get();
    const last = lastActivePathByApp[appCode];
    if (!last) return null;
    const stillOpen = tabs.some(
      (t) =>
        tabAppCode(t) === appCode &&
        (t.path === last || resolveWorkspaceTabId(t.path) === resolveWorkspaceTabId(last)),
    );
    if (!stillOpen) return null;
    const hit = tabs.find(
      (t) =>
        tabAppCode(t) === appCode &&
        (t.path === last || resolveWorkspaceTabId(t.path) === resolveWorkspaceTabId(last)),
    );
    return hit?.path ?? last;
  },
}));
