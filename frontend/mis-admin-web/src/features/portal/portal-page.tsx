import { PortalHomeTab } from './tabs/portal-home-tab';
import { PortalTodoTab } from './tabs/portal-todo-tab';
import { PortalMessageTab } from './tabs/portal-message-tab';
import { PORTAL_TAB_PANEL_ID } from '@/components/layout/portal-tab-switcher';
import { usePortalTabStore } from '@/stores/portal-tab-store';

/**
 * 门户工作台容器（三 Tab 骨架）。
 *
 * <p><b>为什么不用路由 / URL 承载 Tab</b>：`/portal` 由 `keep-alive-outlet.tsx` 的
 * `PAGE_MAP['/portal']` 以 `<Comp/>` 直挂渲染，**不在任何 `<Route>` 上下文内**
 * （`useParams` 恒空）——若把 Tab 做成路由段，会同时撞上 `PAGE_MAP` 精确匹配与
 * `useParams` 恒空两个坑；改成 query 又会踩「切了 URL 但常驻实例不重渲染」。
 * 故三 Tab **不进 URL、不新增路由、不触碰 router/keep-alive**，激活态放在
 * {@link usePortalTabStore} 全局 store 里：顶栏 tab 写它，本容器订阅它，两侧只依赖
 * `stores/`，不产生跨 feature 依赖。
 *
 * <p><b>为什么不再用 Radix `Tabs`</b>（本轮结构改动的核心）：Radix 的 `TabsList` 与
 * `TabsContent` **必须在同一个 `Tabs` root 内**才能拿到同一份上下文。本轮把 tab 条搬到
 * 顶栏（`components/layout/portal-tab-switcher.tsx`）后，tab 条与本内容区处在
 * **两棵不同的 React 树**（顶栏在 `AppLayout`，内容区在 `KeepAliveOutlet` 主槽），
 * 上下文本就连通不了。因此：
 * <ul>
 *   <li>本容器**移除** `Tabs` / `TabsList` / `TabsContent` 包装，直接订阅 `activeTab`
 *       **按值条件渲染**对应 Tab 组件；条件渲染天然只挂载激活的那一个，与原来
 *       `data-[state=inactive]:!hidden` 的语义等价（非激活面板同样不进 DOM、不进布局）；</li>
 *   <li>顶栏那三个 tab 是普通 `button`（手写 `role="tab"`），点击只写 `setActiveTab`。</li>
 * </ul>
 * 数据源唯一 = {@link usePortalTabStore}，没有第二处真相。
 *
 * <p>抽屉/详情态**仍归各 Tab / Board 自持**（组件内 `useState`，关闭即销毁、
 * **不入 URL**）。容器层不持有任何抽屉状态——切 Tab 时非激活面板被卸载，
 * 其抽屉随之关闭，这是期望语义。
 *
 * <p>外壳（顶栏 / 命令面板 / Copilot）由 `AppLayout` 提供；`/portal` 下由
 * `AppLayout` 隐藏左栏（见 `app-layout.tsx` 的 `hideSidebar`），主区自然占满宽度。
 *
 * <p>布局契约（本轮一字未动）：根容器 `flex h-full flex-col`，内容区
 * `min-h-0 flex-1`，页内**不加内层 padding**（外距由 AppLayout 主槽 `p-4 md:p-6`
 * 提供），**单层滚动**交回各 Tab 自持（首页 `portal-shell … overflow-auto`
 * 为门户唯一滚动层）。`role="tabpanel"` + `id` 供顶栏 tab 的 `aria-controls` 引用。
 * 🔴 tab 栏**顶部不放任何工具栏**（参考图没有「返回门户 / 工作台⌄」那一行），
 * 本组件也不要新增——顶栏由 `AppLayout` 提供，门户页自己再加一条就是重复导航。
 */
export function PortalPage() {
  const activeTab = usePortalTabStore((s) => s.activeTab);

  return (
    <div className="flex h-full flex-col">
      <div
        id={PORTAL_TAB_PANEL_ID}
        role="tabpanel"
        aria-label="门户内容"
        className="flex min-h-0 flex-1 flex-col"
        data-testid="portal-tab-panel"
      >
        {activeTab === 'todo' ? (
          <PortalTodoTab />
        ) : activeTab === 'message' ? (
          <PortalMessageTab />
        ) : (
          <PortalHomeTab />
        )}
      </div>
    </div>
  );
}
