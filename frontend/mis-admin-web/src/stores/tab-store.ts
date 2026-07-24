import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkspaceTab {
  id: string;
  path: string;
  title: string;
  icon?: string | null;
  pinned?: boolean;
}

interface TabState {
  tabs: WorkspaceTab[];
  activeId: string | null;
  openTab: (tab: Omit<WorkspaceTab, 'id'> & { id?: string }) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => string | null;
  closeOthers: (id: string) => void;
  closeAll: () => string | null;
  setActiveByPath: (path: string) => void;
}

function tabId(path: string) {
  return path;
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [
        {
          id: '/dashboard',
          path: '/dashboard',
          title: '仪表盘',
          icon: 'LayoutDashboard',
          pinned: true,
        },
      ],
      activeId: '/dashboard',
      openTab: (tab) => {
        const id = tab.id ?? tabId(tab.path);
        set((state) => {
          const exists = state.tabs.find((t) => t.id === id);
          if (exists) {
            return {
              activeId: id,
              tabs: state.tabs.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      title: tab.title || t.title,
                      icon: tab.icon ?? t.icon,
                      pinned: tab.pinned ?? t.pinned,
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
              },
            ],
            activeId: id,
          };
        });
      },
      activateTab: (id) => set({ activeId: id }),
      closeTab: (id) => {
        const { tabs, activeId } = get();
        const target = tabs.find((t) => t.id === id);
        if (!target || target.pinned) return activeId;
        const idx = tabs.findIndex((t) => t.id === id);
        const nextTabs = tabs.filter((t) => t.id !== id);
        let nextActive = activeId;
        if (activeId === id) {
          const neighbor = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0] ?? null;
          nextActive = neighbor?.id ?? null;
        }
        set({ tabs: nextTabs, activeId: nextActive });
        return nextActive;
      },
      closeOthers: (id) => {
        set((state) => ({
          tabs: state.tabs.filter((t) => t.pinned || t.id === id),
          activeId: id,
        }));
      },
      closeAll: () => {
        const pinned = get().tabs.filter((t) => t.pinned);
        const next = pinned[0]?.id ?? null;
        set({ tabs: pinned, activeId: next });
        return next;
      },
      setActiveByPath: (path) => {
        const hit = get().tabs.find((t) => t.path === path);
        if (hit) set({ activeId: hit.id });
      },
    }),
    {
      name: 'mis-workspace-tabs',
      partialize: (s) => ({ tabs: s.tabs, activeId: s.activeId }),
    },
  ),
);
