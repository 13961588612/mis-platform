import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PortalHomeTab } from './tabs/portal-home-tab';
import { PortalTodoTab } from './tabs/portal-todo-tab';
import { PortalMessageTab } from './tabs/portal-message-tab';

/** 门户三 Tab 键（**本地态，绝不入 URL**）。 */
type PortalTabKey = 'home' | 'todo' | 'message';

/**
 * 门户工作台容器（T01：三 Tab 骨架）。
 *
 * <p><b>为什么用单页内 `useState` 切换、不新增路由</b>：`/portal` 由
 * `keep-alive-outlet.tsx` 的 `PAGE_MAP['/portal']` 以 `<Comp/>` 直挂渲染，
 * **不在任何 `<Route>` 上下文内**（`useParams` 恒空）——若把 Tab 做成路由段，
 * 会同时撞上 `PAGE_MAP` 精确匹配与 `useParams` 恒空两个坑。故三 Tab 一律
 * 组件内 `useState` 切换，**不进 URL、不新增路由、不触碰 router/keep-alive**。
 *
 * <p>外壳（顶栏 / 命令面板 / Copilot）由 `AppLayout` 提供；`/portal` 下由
 * `AppLayout` 隐藏左栏（见 `app-layout.tsx` 的 `hideSidebar`），主区自然占满宽度。
 *
 * <p>布局：根容器 `flex h-full flex-col`，`Tabs` 撑满剩余高度；页内**不加内层
 * padding**（外距由 AppLayout 主槽 `p-4 md:p-6` 提供），滚动交回各 Tab 内容自持
 * （首页 `overflow-auto` 为门户唯一滚动层，占位 Tab 无需滚动）。
 */
export function PortalPage() {
  const [activeTab, setActiveTab] = useState<PortalTabKey>('home');
  // 抽屉/详情态**归各 Tab 自持**（`PortalTodoTab.openId` / `PortalMessageTab.openId`，
  // 均为组件内 useState，关闭即销毁、**不入 URL**）。故容器层不持有任何抽屉状态——
  // 切 Tab 时非激活面板被 Radix 卸载（`data-[state=inactive]:!hidden` 且默认不挂载），
  // 其抽屉随之关闭，这是期望语义（T05 复核确认，无需提升到此处）。

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as PortalTabKey)}
        className="flex h-full min-h-0 flex-col"
      >
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="home">首页</TabsTrigger>
          <TabsTrigger value="todo">待办事项</TabsTrigger>
          <TabsTrigger value="message">消息中心</TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="min-h-0 flex-1">
          <PortalHomeTab />
        </TabsContent>
        <TabsContent value="todo" className="min-h-0 flex-1">
          <PortalTodoTab />
        </TabsContent>
        <TabsContent value="message" className="min-h-0 flex-1">
          <PortalMessageTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
