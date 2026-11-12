import { create } from 'zustand';

/**
 * 门户「待办事项」子 Tab 的键（与 `features/portal/lib/todo-tabs.ts` 的
 * `TODO_TABS` 一一对应）。
 *
 * <p>类型单点定义在本文件（`stores/` 层），`todo-tabs.ts` 的
 * `TodoTabConfig.key` 反过来引用本类型——**依赖方向是 feature → stores**，
 * 与「共享状态放 stores、两侧只依赖 stores」的既有约定一致
 * （同 `portal-tab-store.ts`）。
 *
 * <p>本轮新增 `'all'`（「全部」= 三源聚合，`source='matters'`）：它是**首项且默认**。
 */
export type TodoTabKey =
  | 'all'
  | 'pending'
  | 'approving'
  | 'approved'
  | 'rejected'
  | 'cc'
  | 'mySent'
  | 'myHandled';

/**
 * 默认子 Tab（首个：「全部」）。
 *
 * <p>`TODO_TABS` 的首项必须与本值一致：`todo-tabs.ts` 的 `key` 已受
 * {@link TodoTabKey} 约束（字面量写错即编译报错），另有
 * `features/portal/__tests__/todo-tabs.test.tsx` 的「默认键对齐」用例兜底
 * （断言 `TODO_TABS[0].key === DEFAULT_TODO_TAB_KEY`），防止两处漂移。
 */
export const DEFAULT_TODO_TAB_KEY: TodoTabKey = 'all';

interface PortalTodoTabState {
  /**
   * 当前激活的子 Tab 键。
   *
   * <p>同 {@link TodoTabKey} 的字面量集合；类型取 `string` 是因为 Radix `Tabs`
   * 的 `value` / `onValueChange` 就是 `string`，用联合类型会逼出强转
   * （`as TodoTabKey`），反而削弱类型收益。写入方只有两处、且都传字面量常量：
   * `PortalTodoTab` 的子 Tab 条（值恒来自 `TODO_TABS`）与
   * `features/portal/lib/use-portal-entry.ts` 的门内跳转映射表。
   */
  activeKey: string;
  /** 切换子 Tab（不触发路由跳转，**不进 URL**）。 */
  setActiveKey: (next: string) => void;
}

/**
 * 门户「待办事项」子 Tab 全局态（跨组件通信用，**不进 URL**）。
 *
 * <p><b>为什么需要它</b>（本轮结构改动的核心）：首页工作台的三块板
 * （`TaskBoard` / `ProcessBoard` / `WorkbenchOverview`）与「待办事项」Tab
 * 的子 Tab 条（`PortalTodoTab`）处在**两棵不同的组件树**里——前者挂在
 * `PortalHomeTab`，后者由 `PortalPage` 按 `activeTab` 条件渲染。
 * 子 Tab 键原先是 `PortalTodoTab` 的组件内 `useState`，首页那侧的「查看全部」
 * 根本改不到它，只能靠跳路由（`/task/pending` 等）绕开。用户要求这些入口
 * **门内切 Tab**（URL 恒为 `/portal`），故把这份极小的状态提升到 `src/stores/`
 * （与 `usePortalTabStore` 同层同范式），两侧只依赖 `stores/`，
 * 依赖方向为 `features/portal/components → stores ← features/portal/tabs`，
 * 不产生跨 feature 依赖。
 *
 * <p><b>为什么不进 URL</b>：与 {@link usePortalTabStore} 同源的两个坑——`/portal`
 * 由 `keep-alive-outlet.tsx` 的 `PAGE_MAP['/portal']` 以 `<Comp/>` 直挂渲染，
 * **不在任何 `<Route>` 上下文内**（`useParams` 恒空），且页面常驻；做成路由段会
 * 同时撞上 `PAGE_MAP` 精确匹配与 `useParams` 恒空。故用全局 store 承载。
 *
 * <p><b>测试注意</b>：本 store 是模块级单例，跨用例共享。新增门户相关测试时，
 * `beforeEach` 必须复位：
 * `usePortalTodoTabStore.setState({ activeKey: DEFAULT_TODO_TAB_KEY })`，
 * 否则上一例切到 `mySent` 会让下一例「默认选中待处理」类断言假失败
 * （与 `portal-tab-store` 的复位约定一致）。
 *
 * <p>非持久化（不 `persist`）：刷新后回落到「待处理」是合理的默认。
 */
export const usePortalTodoTabStore = create<PortalTodoTabState>()((set) => ({
  activeKey: DEFAULT_TODO_TAB_KEY,
  setActiveKey: (next) => set({ activeKey: next }),
}));
