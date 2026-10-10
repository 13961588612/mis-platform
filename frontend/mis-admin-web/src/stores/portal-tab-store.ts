import { create } from 'zustand';

/**
 * 门户三 Tab 的激活键（首页 / 待办事项 / 消息中心）。
 *
 * <p>与 `features/portal/portal-page.tsx` 的 `Tabs value` 一一对应；类型单点定义，
 * 避免两处字符串字面量漂移。
 */
export type PortalTabKey = 'home' | 'todo' | 'message';

interface PortalTabState {
  /** 当前激活的门户 Tab。 */
  activeTab: PortalTabKey;
  /** 切换门户 Tab（不触发路由跳转，**不进 URL**）。 */
  setActiveTab: (next: PortalTabKey) => void;
}

/**
 * 门户 Tab 全局态（跨组件通信用，**不进 URL**）。
 *
 * <p><b>为什么需要它</b>：顶栏「打开消息中心」在 `components/layout/header-toolkit.tsx`，
 * 而门户三Tab 在 `features/portal/portal-page.tsx`。两者一个在布局层、一个在业务
 * feature 内，若让 layout 直接 import `features/portal`，等于让**布局层去依赖某个业务
 * feature 的内部结构**——依赖方向是反的：顶栏是全站共用的外壳，不该知道「门户」这个
 * feature 的组件组织；门户日后若改名/搬家，顶栏就得跟着改。把这份极小的状态提到
 * `src/stores/`（与 `auth-store` / `tab-store` 同层）后，两侧只依赖 `stores/`，
 * **依赖方向恢复为 layout → stores ← feature**，符合分层。
 *
 * <p>顺带一提：本仓库 eslint 的 `arch/no-cross-feature`（架构军规1：禁止跨 features
 * 直接依赖）在 `eslint.config.js` 里是「**当前文件在 `features/<x>/` 下**才生效」的
 * 实现（`if (!self) return {}`），所以 `components/layout/` 里的文件 import
 * `@/features/portal` 并不会直接报错——但那只是该规则当前实现的适用范围，不代表这种
 * 依赖方向是合理的。该规则自己的 message 也写着推荐路径：「请通过路由 / 事件 /
 * **全局 store** 通信，或把共享内容抽到 shared/」，本 store 正是其中「全局 store」
 * 那条路。
 *
 * <p><b>为什么不进 URL</b>：`/portal` 由 `keep-alive-outlet.tsx` 的
 * `PAGE_MAP['/portal']` 以 `<Comp/>` 直挂渲染，**不在任何 `<Route>` 上下文内**
 * （`useParams` 恒空），且页面常驻。做成路由段会同时撞上 `PAGE_MAP` 精确匹配与
 * `useParams` 恒空两个坑；改成 query 又会踩「切了 URL 但常驻实例不重渲染」。故用全局
 * store 承载，外部改动能即时驱动已挂载的门户页切换（这正是期望行为）。
 *
 * <p><b>测试注意</b>：本 store 是模块级单例，跨用例共享。新增门户相关测试时，
 * `beforeEach` 必须复位：`usePortalTabStore.setState({ activeTab: 'home' })`，
 * 否则上一例切到 message 会让下一例「默认选中首页」类断言假失败。
 *
 * <p>非持久化（不`persist`）：刷新后回落到「首页」是合理的默认，不值得写入
 * localStorage 把门户状态污染到下一次会话。
 */
export const usePortalTabStore = create<PortalTabState>()((set) => ({
  activeTab: 'home',
  setActiveTab: (next) => set({ activeTab: next }),
}));