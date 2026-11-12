import { useMemo } from 'react';
import { usePortalTabStore, type PortalTabKey } from '@/stores/portal-tab-store';
import { usePortalTodoTabStore, type TodoTabKey } from '@/stores/portal-todo-tab-store';

/**
 * 门户首页**门内入口**的三个去向（取代原先跳 `/task/*` 列表页的三个路由）。
 *
 * <p>语义与旧路由一一对应，故键名沿用路由末段，便于对照：
 * <ul>
 *   <li>`pending` ← `/task/pending`（我的待办）</li>
 *   <li>`inbox` ← `/task/inbox`（消息与通知）</li>
 *   <li>`mySent` ← `/task/my-sent`（我发起的）</li>
 * </ul>
 */
export type PortalEntryTarget = 'pending' | 'inbox' | 'mySent';

/** 目标 → 主 Tab / 子 Tab 的映射表（单点定义，四块板与概览指标卡共用）。 */
interface PortalEntryRoute {
  /** 要切到的门户主 Tab。 */
  tab: Extract<PortalTabKey, 'todo' | 'message'>;
  /** 目标落在「待办事项」时的子 Tab 键；「消息中心」无子 Tab，故可选。 */
  todoKey?: TodoTabKey;
}

const ENTRY_ROUTES: Record<PortalEntryTarget, PortalEntryRoute> = {
  pending: { tab: 'todo', todoKey: 'pending' },
  mySent: { tab: 'todo', todoKey: 'mySent' },
  inbox: { tab: 'message' },
};

export interface PortalEntry {
  /**
   * 门内切到目标视图（**不触发路由跳转**，URL 恒为 `/portal`）。
   *
   * <p>先写子 Tab 键再写主 Tab：子 Tab 键是 `PortalTodoTab` 挂载时的初值来源，
   * 顺序反了（先切主 Tab）会让待办面板以旧键挂载、再被下一次渲染纠正，
   * 多一轮无意义的请求。
   */
  open: (target: PortalEntryTarget) => void;
}

/**
 * 门户首页「门内跳转」入口（本轮新增）。
 *
 * <p><b>为什么要有它</b>：首页的四块板（`WorkbenchOverview` / `TaskBoard` /
 * `MessageBoard` / `ProcessBoard`）此前各自 `navigate('/task/...')` 跳出门户。
 * 用户要求这些入口**统一改为门内切 Tab**（URL 恒为 `/portal`），三个「查看全部」
 * 与四个指标卡的口径必须一致，故把「目标 → 主 Tab / 子 Tab」的映射收在本 hook
 * 里单点定义，四处调用点不再各写一遍。
 *
 * <p><b>为什么是 hook 而不是普通函数</b>：两个 store 的 `setXxx` 取自 zustand
 * 选择器（引用稳定），普通函数也能拿到 `getState()`；但走 hook 可以让调用方
 * 只声明「我要切到哪」，不必关心 store 的读写姿势，也便于测试里整体 mock。
 *
 * <p>依赖方向：本文件在 `features/portal/lib/`，只依赖 `src/stores/`；
 * 调用方是同 feature 的 `features/portal/components/*`，无跨 feature 依赖。
 */
export function usePortalEntry(): PortalEntry {
  const setActiveTab = usePortalTabStore((s) => s.setActiveTab);
  const setTodoKey = usePortalTodoTabStore((s) => s.setActiveKey);

  return useMemo(
    () => ({
      open: (target: PortalEntryTarget) => {
        const route = ENTRY_ROUTES[target];
        if (route.todoKey) setTodoKey(route.todoKey);
        setActiveTab(route.tab);
      },
    }),
    [setActiveTab, setTodoKey],
  );
}
